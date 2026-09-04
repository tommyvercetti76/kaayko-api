/**
 * Public report tokens (sharing v2).
 *
 * A share URL carries `report_<publicId>.<secret>`. The publicId locates
 * kortex_report_tokens/{publicId}; only a peppered SHA-256 of the secret is
 * stored there, so a copy of the database cannot produce a working URL. The
 * link document keeps `share: { publicId, expiresAtMs, createdAtMs }` and
 * nothing else — never the secret, never the URL. A link has at most one live
 * token: minting again revokes the previous one.
 *
 * Verification treats a missing, malformed, mismatched, revoked or expired
 * token identically (null) so the route can answer one uniform 404. Tokens are
 * never written to logs.
 *
 * @module api/kortex/reportTokens
 */

'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const db = admin.firestore();

const TOKENS = 'kortex_report_tokens';
const LINKS = 'short_links';
const REPORT_BASE = 'https://kaayko.com/kortex/r/';
const DAY_MS = 86400000;
const DEFAULT_EXPIRY_DAYS = 30;
const EXPIRY_CHOICES_DAYS = [7, 30];
const PUBLIC_ID_BYTES = 9; // 12 base64url chars
const SECRET_BYTES = 24; // 32 base64url chars
const TOKEN_RE = /^report_([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{32})$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const ZERO_HASH = '0'.repeat(64);

function validationError(message) { const e = new Error(message); e.code = 'VALIDATION_ERROR'; return e; }

function pepper() {
  return process.env.KORTEX_SHARE_PEPPER || process.env.KORTEX_ACCESS_PEPPER || 'dev';
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret + pepper()).digest('hex');
}

/** Constant-time comparison of two 64-hex digests. */
function digestsMatch(a, b) {
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function isoOrNull(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** 7, 30 or 'never' → expiry instant (null = never); absent → the 30-day default. */
function expiresAtFor(expiresInDays, nowMs) {
  if (expiresInDays === undefined || expiresInDays === null || expiresInDays === '') return nowMs + DEFAULT_EXPIRY_DAYS * DAY_MS;
  if (expiresInDays === 'never') return null;
  const days = Number(expiresInDays);
  if (!EXPIRY_CHOICES_DAYS.includes(days)) throw validationError('The report can expire in 7 days, 30 days, or never');
  return nowMs + days * DAY_MS;
}

/** Mark a token dead. A merge write so a lost token document cannot block revocation. */
async function retireToken(share, nowMs) {
  if (!share || !share.publicId) return false;
  await db.collection(TOKENS).doc(share.publicId).set({ revokedAtMs: nowMs }, { merge: true });
  return true;
}

/**
 * Mint a token for a link, retiring the one it already had. The URL exists
 * only in the return value; nothing stored can rebuild it.
 *
 * @param {{ linkCode: string, tenantId: string, previousShare?: object|null, expiresInDays?: number|string, nowMs?: number }} p
 * @returns {Promise<{ shareUrl: string, expiresAt: string|null, share: { publicId, expiresAtMs, createdAtMs } }>}
 */
async function issueReportToken({ linkCode, tenantId, previousShare = null, expiresInDays, nowMs = Date.now() }) {
  const expiresAtMs = expiresAtFor(expiresInDays, nowMs);
  const publicId = crypto.randomBytes(PUBLIC_ID_BYTES).toString('base64url');
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  await retireToken(previousShare, nowMs);
  await db.collection(TOKENS).doc(publicId).set({
    publicId,
    secretHash: hashSecret(secret),
    linkCode,
    tenantId,
    createdAtMs: nowMs,
    expiresAtMs,
    revokedAtMs: null,
    accessCount: 0,
    lastAccessMs: null
  });
  const share = { publicId, expiresAtMs, createdAtMs: nowMs };
  await db.collection(LINKS).doc(linkCode).update({ share, updatedAt: FieldValue.serverTimestamp() });
  return { shareUrl: `${REPORT_BASE}report_${publicId}.${secret}`, expiresAt: isoOrNull(expiresAtMs), share };
}

/**
 * Revoke a link's live token and clear its share record. Idempotent: a link
 * that was not shared is left unshared.
 */
async function revokeReportToken({ linkCode, share, nowMs = Date.now() }) {
  const retired = await retireToken(share, nowMs);
  await db.collection(LINKS).doc(linkCode).update({ share: null, updatedAt: FieldValue.serverTimestamp() });
  return retired;
}

/**
 * Resolve a token string to its live grant, or null for every kind of
 * failure. The hash comparison runs whether or not the document exists so the
 * timing of a miss does not say which part was wrong.
 *
 * @returns {Promise<null | { publicId, linkCode, tenantId, createdAtMs, expiresAtMs }>}
 */
async function verifyReportToken(token, { nowMs = Date.now() } = {}) {
  const match = TOKEN_RE.exec(String(token || ''));
  if (!match) return null;
  const [, publicId, secret] = match;
  const snap = await db.collection(TOKENS).doc(publicId).get();
  const grant = snap.exists ? snap.data() : {};
  const storedHash = HEX_64.test(grant.secretHash) ? grant.secretHash : ZERO_HASH;
  const secretMatches = digestsMatch(hashSecret(secret), storedHash);
  const live = snap.exists && !grant.revokedAtMs && (grant.expiresAtMs === null || grant.expiresAtMs > nowMs);
  if (!secretMatches || !live) return null;
  return { publicId, linkCode: grant.linkCode, tenantId: grant.tenantId, createdAtMs: grant.createdAtMs, expiresAtMs: grant.expiresAtMs };
}

/** Access aggregate, fire-and-forget: a read never waits on it or fails because of it. */
function recordReportAccess(publicId, nowMs = Date.now()) {
  db.collection(TOKENS).doc(publicId).update({ accessCount: FieldValue.increment(1), lastAccessMs: nowMs }).catch(() => {});
}

/**
 * What an owner may see about a link's public report: whether one is live and
 * when it lapses. Never the URL.
 */
function shareState(link, nowMs = Date.now()) {
  const share = link && link.share;
  const shared = !!(share && share.publicId && (share.expiresAtMs === null || share.expiresAtMs > nowMs));
  return { shared, shareExpiresAt: shared ? isoOrNull(share.expiresAtMs) : null };
}

module.exports = { issueReportToken, revokeReportToken, verifyReportToken, recordReportAccess, shareState };
