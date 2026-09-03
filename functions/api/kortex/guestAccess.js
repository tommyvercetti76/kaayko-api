/**
 * Guest access — the free tier without an account.
 *
 * A visitor makes a QR / dynamic link on kaayko.com/kortex and receives an
 * ACCESS CODE. The code is the only credential for that guest workspace: it
 * unlocks the stats, lets the destination be changed, and renews the links.
 * No Firebase user is ever created for a free user.
 *
 * Model
 *   tenants/{g_xxxxxx}           kind:'guest', plan:'starter', guest:{...}
 *   short_links/{kx-xxxxxx}      ordinary links owned by that tenant
 *
 * Access code   KX-<id 6>-<secret 16>   Crockford base32 (no I L O U)
 *   id      → tenant document id (`g_` + id) so verification is a doc read,
 *             never a query; the id is not secret on its own.
 *   secret  → 80 random bits. Only sha256(pepper:id:secret) is stored.
 *
 * Verification is constant-time, rate-limited per IP (fail closed) and locked
 * per workspace after repeated failures. Success mints a short-lived HMAC
 * session token bound to the workspace's codeVersion, so rotating the code
 * (recovery, "email me a new one") invalidates every old session.
 *
 * Lifetime: a workspace expires KORTEX_GUEST_LIFETIME_DAYS (365) after its
 * last check-in; every successful code entry renews it. Expired workspaces
 * have their links disabled by the housekeeping job and are revived on the
 * next successful check-in.
 *
 * @module api/kortex/guestAccess
 */

'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { PLAN_LIMITS } = require('../billing/planLimits');
const { getClientIp } = require('./clientIp');

const db = admin.firestore();

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: 32 symbols, no I L O U
const ID_LENGTH = 6;
const SECRET_LENGTH = 16;
const CODE_PREFIX = 'KX';
const TENANT_PREFIX = 'g_';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOCK_AFTER_FAILURES = 8;
const LOCK_DURATION_MS = 60 * 60 * 1000;
const GUEST_KIND = 'guest';

function guestLifetimeDays() {
  const days = Number(process.env.KORTEX_GUEST_LIFETIME_DAYS);
  return Number.isFinite(days) && days > 0 ? days : 365;
}

function guestLinkLimit() {
  return PLAN_LIMITS.starter.links;
}

function isEmulator() {
  return process.env.FUNCTIONS_EMULATOR === 'true';
}

// ─── Secrets ──────────────────────────────────────────────────────────────────

function derive(label, material) {
  return crypto.createHash('sha256').update(`${label}:${material}`).digest('hex');
}

function configError() {
  const error = new Error('Guest access is not configured on this deployment');
  error.code = 'GUEST_NOT_CONFIGURED';
  return error;
}

/** Pepper for access-code hashes. Prefers a dedicated secret; derives from the admin passphrase otherwise. */
function pepper() {
  if (process.env.KORTEX_ACCESS_PEPPER) return process.env.KORTEX_ACCESS_PEPPER;
  if (process.env.KORTEX_LINK_SIGNING_SECRET) return derive('kortex-access-pepper', process.env.KORTEX_LINK_SIGNING_SECRET);
  if (process.env.ADMIN_PASSPHRASE) return derive('kortex-access-pepper', process.env.ADMIN_PASSPHRASE);
  if (isEmulator()) return 'kx-emulator-pepper';
  throw configError();
}

/** Key for session-token HMACs. Same fallback chain as the pepper, different label. */
function sessionSecret() {
  if (process.env.KORTEX_GUEST_SESSION_SECRET) return process.env.KORTEX_GUEST_SESSION_SECRET;
  if (process.env.KORTEX_LINK_SIGNING_SECRET) return derive('kortex-guest-session', process.env.KORTEX_LINK_SIGNING_SECRET);
  if (process.env.ADMIN_PASSPHRASE) return derive('kortex-guest-session', process.env.ADMIN_PASSPHRASE);
  if (isEmulator()) return 'kx-emulator-session';
  throw configError();
}

// ─── Code format ──────────────────────────────────────────────────────────────

function randomBase32(length) {
  // 256 % 32 === 0, so byte % 32 is unbiased.
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}

function formatAccessCode(id, secret) {
  const groups = secret.match(/.{1,4}/g).join('-');
  return `${CODE_PREFIX}-${id}-${groups}`;
}

/**
 * Normalise what a person typed or pasted: case, separators, and the
 * ambiguous glyphs Crockford base32 deliberately excludes.
 * @returns {{id: string, secret: string}|null}
 */
function parseAccessCode(input) {
  let raw = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.startsWith(CODE_PREFIX)) raw = raw.slice(CODE_PREFIX.length);
  raw = raw.replace(/I/g, '1').replace(/L/g, '1').replace(/O/g, '0').replace(/U/g, 'V');
  if (raw.length !== ID_LENGTH + SECRET_LENGTH) return null;
  if (![...raw].every(ch => ALPHABET.includes(ch))) return null;
  return { id: raw.slice(0, ID_LENGTH), secret: raw.slice(ID_LENGTH) };
}

function hashSecret(id, secret) {
  return crypto.createHash('sha256').update(`${pepper()}:${id}:${secret}`).digest('hex');
}

function hashEmail(email) {
  const normalised = String(email || '').trim().toLowerCase();
  if (!normalised) return null;
  return crypto.createHash('sha256').update(`${pepper()}:email:${normalised}`).digest('hex');
}

function tenantIdForGuest(id) {
  return `${TENANT_PREFIX}${id.toLowerCase()}`;
}

function maskEmail(email) {
  if (!email) return null;
  const [user, domain] = String(email).split('@');
  if (!domain) return null;
  const shown = user.length <= 2 ? user[0] : user.slice(0, 2);
  return `${shown}${'•'.repeat(Math.max(2, Math.min(6, user.length - shown.length)))}@${domain}`;
}

function timingSafeEqualHex(a, b) {
  const ab = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function accessError(code = 'INVALID_ACCESS_CODE', message = 'That access code is not valid.') {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function jitter() {
  await new Promise(r => setTimeout(r, 40 + Math.floor(Math.random() * 120)));
}

// ─── Workspace lifecycle ──────────────────────────────────────────────────────

/**
 * Create a guest workspace. Returns the plaintext access code exactly once.
 * @param {Object} options
 * @param {string} [options.email] - optional contact for recovery mail
 * @param {import('express').Request} [options.req]
 */
async function createGuestWorkspace({ email = null, req = null } = {}) {
  let id;
  let tenantId;
  for (let attempt = 0; attempt < 6; attempt++) {
    id = randomBase32(ID_LENGTH);
    tenantId = tenantIdForGuest(id);
    const existing = await db.collection('tenants').doc(tenantId).get();
    if (!existing.exists) break;
    tenantId = null;
  }
  if (!tenantId) throw new Error('Could not allocate a guest workspace id');

  const secret = randomBase32(SECRET_LENGTH);
  const nowMs = Date.now();
  const emailClean = email ? String(email).trim().toLowerCase().slice(0, 200) : null;

  const tenantDoc = {
    id: tenantId,
    slug: tenantId,
    kind: GUEST_KIND,
    name: 'Free workspace',
    domain: 'kaayko.com',
    pathPrefix: '/l',
    linkNamespace: 'kaayko',
    plan: 'starter',
    enabled: true,
    provisionedVia: 'guest',
    settings: { reviewUnknownDomains: false },
    trustedDomains: [],
    guest: {
      accessCodeHash: hashSecret(id, secret),
      codeVersion: 1,
      createdAtMs: nowMs,
      lastAccessAtMs: nowMs,
      expiresAtMs: nowMs + guestLifetimeDays() * 86400000,
      expired: false,
      failedAttempts: 0,
      lockedUntilMs: 0,
      email: emailClean,
      emailHash: emailClean ? hashEmail(emailClean) : null,
      createdIpHash: req ? derive('guest-ip', `${pepper()}:${getClientIp(req) || 'unknown'}`).slice(0, 16) : null
    },
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: nowMs,
    updatedAt: FieldValue.serverTimestamp()
  };

  await db.collection('tenants').doc(tenantId).set(tenantDoc);

  return {
    tenantId,
    accessCode: formatAccessCode(id, secret),
    expiresAtMs: tenantDoc.guest.expiresAtMs,
    tenant: tenantDoc
  };
}

async function reviveExpiredLinks(tenantId) {
  const snapshot = await db.collection('short_links')
    .where('tenantId', '==', tenantId)
    .where('disabledReason', '==', 'guest_expired')
    .limit(500)
    .get();
  if (snapshot.empty) return 0;
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.update(doc.ref, { enabled: true, disabledReason: null, updatedAt: FieldValue.serverTimestamp() }));
  await batch.commit();
  return snapshot.size;
}

/**
 * Verify an access code. On success the workspace is renewed and returned.
 * Every failure path takes the same shape (generic message + jitter) so a
 * caller cannot tell an unknown id from a wrong secret.
 */
async function verifyAccessCode(rawCode) {
  const parsed = parseAccessCode(rawCode);
  if (!parsed) {
    await jitter();
    throw accessError();
  }

  const tenantId = tenantIdForGuest(parsed.id);
  const ref = db.collection('tenants').doc(tenantId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().kind !== GUEST_KIND || !snap.data().guest) {
    await jitter();
    throw accessError();
  }

  const tenant = snap.data();
  const guest = tenant.guest;
  const nowMs = Date.now();

  if (guest.lockedUntilMs && guest.lockedUntilMs > nowMs) {
    throw accessError('ACCESS_CODE_LOCKED', 'Too many attempts. Try again in about an hour.');
  }

  const ok = timingSafeEqualHex(hashSecret(parsed.id, parsed.secret), guest.accessCodeHash);
  if (!ok) {
    const failures = (guest.failedAttempts || 0) + 1;
    const update = { 'guest.failedAttempts': failures, updatedAt: FieldValue.serverTimestamp() };
    if (failures >= LOCK_AFTER_FAILURES) {
      update['guest.lockedUntilMs'] = nowMs + LOCK_DURATION_MS;
      update['guest.failedAttempts'] = 0;
    }
    await ref.update(update).catch(() => {});
    await jitter();
    throw accessError();
  }

  if (tenant.enabled === false) {
    throw accessError('WORKSPACE_DISABLED', 'This workspace has been disabled. Contact support if you think this is a mistake.');
  }

  // Renew on every successful check-in; revive if housekeeping expired it.
  const update = {
    'guest.failedAttempts': 0,
    'guest.lockedUntilMs': 0,
    'guest.lastAccessAtMs': nowMs,
    'guest.expiresAtMs': nowMs + guestLifetimeDays() * 86400000,
    updatedAt: FieldValue.serverTimestamp()
  };
  let revivedLinks = 0;
  if (guest.expired === true) {
    update['guest.expired'] = false;
    revivedLinks = await reviveExpiredLinks(tenantId);
  }
  await ref.update(update);

  return {
    tenantId,
    tenant: { ...tenant, guest: { ...guest, expired: false, expiresAtMs: update['guest.expiresAtMs'], lastAccessAtMs: nowMs } },
    revivedLinks
  };
}

/** Replace the access code. Old code and every session minted for it stop working. */
async function rotateAccessCode(tenantId) {
  const ref = db.collection('tenants').doc(tenantId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().kind !== GUEST_KIND) throw accessError('NOT_FOUND', 'Workspace not found');
  const id = tenantId.slice(TENANT_PREFIX.length).toUpperCase();
  const secret = randomBase32(SECRET_LENGTH);
  const codeVersion = (snap.data().guest?.codeVersion || 1) + 1;
  await ref.update({
    'guest.accessCodeHash': hashSecret(id, secret),
    'guest.codeVersion': codeVersion,
    'guest.rotatedAtMs': Date.now(),
    'guest.failedAttempts': 0,
    'guest.lockedUntilMs': 0,
    updatedAt: FieldValue.serverTimestamp()
  });
  return { accessCode: formatAccessCode(id, secret), codeVersion };
}

async function attachEmail(tenantId, email) {
  const emailClean = String(email || '').trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) throw accessError('VALIDATION_ERROR', 'A valid email address is required');
  await db.collection('tenants').doc(tenantId).update({
    'guest.email': emailClean,
    'guest.emailHash': hashEmail(emailClean),
    'guest.emailAttachedAtMs': Date.now(),
    updatedAt: FieldValue.serverTimestamp()
  });
  return emailClean;
}

async function findGuestWorkspacesByEmail(email) {
  const hash = hashEmail(email);
  if (!hash) return [];
  const snapshot = await db.collection('tenants').where('guest.emailHash', '==', hash).limit(5).get();
  return snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(t => t.kind === GUEST_KIND && t.enabled !== false);
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', sessionSecret()).update(payloadB64).digest('base64url');
}

function issueSession(tenant, { ttlMs = SESSION_TTL_MS } = {}) {
  const payload = {
    t: tenant.id,
    v: tenant.guest?.codeVersion || 1,
    iat: Date.now(),
    exp: Date.now() + ttlMs
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `kxs.${payloadB64}.${sign(payloadB64)}`;
}

function verifySession(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'kxs') return null;
  const [, payloadB64, sig] = parts;
  if (!timingSafeEqualHex(sign(payloadB64), sig)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!payload?.t || !payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

function extractSessionToken(req) {
  const header = req.headers['x-kortex-guest-session'];
  if (header) return String(header);
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer kxs.')) return auth.slice(7);
  if (req.body && typeof req.body.session === 'string') return req.body.session;
  return null;
}

/**
 * Resolve the guest workspace for a session token, or null when absent/invalid.
 */
async function resolveGuestSession(req) {
  const token = extractSessionToken(req);
  if (!token) return null;
  const payload = verifySession(token);
  if (!payload) return null;
  const snap = await db.collection('tenants').doc(payload.t).get();
  if (!snap.exists) return null;
  const tenant = { id: snap.id, ...snap.data() };
  if (tenant.kind !== GUEST_KIND || tenant.enabled === false) return null;
  if ((tenant.guest?.codeVersion || 1) !== payload.v) return null;
  return { tenantId: tenant.id, tenant, session: payload };
}

/** Express middleware: requires a valid guest session; attaches req.guest. */
async function requireGuestSession(req, res, next) {
  try {
    const guest = await resolveGuestSession(req);
    if (!guest) {
      return res.status(401).json({
        success: false,
        error: 'Enter your access code to continue',
        code: 'GUEST_SESSION_REQUIRED'
      });
    }
    req.guest = guest;
    next();
  } catch (error) {
    if (error.code === 'GUEST_NOT_CONFIGURED') {
      return res.status(503).json({ success: false, error: error.message, code: error.code });
    }
    console.error('[Guest] session resolution failed:', error);
    return res.status(500).json({ success: false, error: 'Could not verify the session' });
  }
}

function workspaceSummary(tenant, { linkCount = 0 } = {}) {
  const guest = tenant.guest || {};
  return {
    id: tenant.id,
    kind: GUEST_KIND,
    plan: 'free',
    links: linkCount,
    linkLimit: guestLinkLimit(),
    analyticsDays: PLAN_LIMITS.starter.analytics_range_days,
    expiresAt: guest.expiresAtMs ? new Date(guest.expiresAtMs).toISOString() : null,
    lifetimeDays: guestLifetimeDays(),
    email: maskEmail(guest.email),
    hasEmail: !!guest.email,
    codeVersion: guest.codeVersion || 1
  };
}

module.exports = {
  GUEST_KIND,
  SESSION_TTL_MS,
  LOCK_AFTER_FAILURES,
  guestLifetimeDays,
  guestLinkLimit,
  parseAccessCode,
  formatAccessCode,
  hashEmail,
  maskEmail,
  createGuestWorkspace,
  verifyAccessCode,
  rotateAccessCode,
  attachEmail,
  findGuestWorkspacesByEmail,
  issueSession,
  verifySession,
  resolveGuestSession,
  requireGuestSession,
  workspaceSummary,
  reviveExpiredLinks
};
