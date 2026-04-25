/**
 * Alumni Visit Token Service
 *
 * Issues and consumes HMAC-signed single-use visit tokens.
 * A token is issued when a campaign link is clicked; the token is then
 * required to submit the alumni interest form.
 *
 * Token format: <base64url(payload)>.<base64url(hmac-sha256)>
 * Payload fields:
 *   vid  — unique visit ID  (v_<16 hex>)
 *   lc   — link code
 *   sg   — source group
 *   sb   — source batch
 *   src  — tracking source / channel (email, qr, text, ...)
 *   ih   — SHA-256 of requester IP (privacy-safe)
 *   iat  — issued-at unix seconds
 *   exp  — expires-at unix seconds (iat + 86400)
 */

'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const db = admin.firestore();

const TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Return the HMAC secret. Falls back to KORTEX_SYNC_KEY if the dedicated
 * secret is not yet configured, so nothing breaks before the env var is set.
 */
function secret() {
  return (
    process.env.ALUMNI_TOKEN_SECRET ||
    process.env.KORTEX_SYNC_KEY ||
    'alumni-dev-secret'
  );
}

/** Produce URL-safe base64 */
function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Generate a unique visit ID */
function generateVisitId() {
  return 'v_' + crypto.randomBytes(8).toString('hex');
}

/** Hash an IP for storage (privacy-safe) */
function hashIp(ip) {
  return crypto.createHash('sha256').update(ip + (process.env.ALUMNI_TOKEN_SECRET || '')).digest('hex').slice(0, 16);
}

function normalizeSource(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase().slice(0, 100);
  return normalized || null;
}

/**
 * Issue a single-use visit token.
 * Stores a record in `alumni_visit_tokens` and returns the token string.
 *
 * @param {string} linkCode
 * @param {string} ip        - requester's IP address
 * @param {Object} meta      - { sourceGroup, sourceBatch, campaign, sender }
 * @returns {Promise<{ token: string, reused: boolean }>}
 */
async function issueVisitToken(linkCode, ip, meta = {}) {
  const ipHash = hashIp(ip);
  const nowSec = Math.floor(Date.now() / 1000);
  const source = normalizeSource(meta.source);

  // If this IP already has an unused, unexpired token for this link, reuse it.
  // This prevents opening the same link in multiple tabs from yielding multiple submissions.
  const existing = await db.collection('alumni_visit_tokens')
    .where('linkCode', '==', linkCode)
    .where('ip_hash', '==', ipHash)
    .where('used', '==', false)
    .limit(5)
    .get();

  const matchingDoc = existing.docs.find(doc => normalizeSource(doc.data().source) === source);
  if (matchingDoc) {
    const existingToken = matchingDoc.data().token;
    // Verify it isn't expired before reusing
    const result = verifyVisitToken(existingToken);
    if (result.valid) {
      return { token: existingToken, reused: true };
    }
    // Expired — fall through and mint a fresh one
  }

  const vid = generateVisitId();
  const iat = nowSec;
  const exp = iat + TOKEN_TTL_SECONDS;

  const payload = {
    vid,
    lc: linkCode,
    sg: meta.sourceGroup || null,
    sb: meta.sourceBatch || null,
    src: source,
    ih: ipHash,
    iat,
    exp,
  };

  const payloadBuf = Buffer.from(JSON.stringify(payload));
  const payloadB64 = b64url(payloadBuf);

  const sig = b64url(
    crypto.createHmac('sha256', secret()).update(payloadB64).digest()
  );

  const token = `${payloadB64}.${sig}`;

  // Persist so we can mark it consumed after form submission
  await db.collection('alumni_visit_tokens').doc(vid).set({
    vid,
    token,
    linkCode,
    sourceGroup: meta.sourceGroup || null,
    sourceBatch: meta.sourceBatch || null,
    campaign: meta.campaign || 'alumni',
    sender: meta.sender || null,
    source,
    ip_hash: ipHash,
    used: false,
    usedAt: null,
    issuedAt: FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(exp * 1000),
  });

  return { token, reused: false };
}

/**
 * Verify a visit token's signature and TTL.
 * Does NOT mark it as consumed. Call consumeVisitToken separately.
 *
 * @param {string} token
 * @returns {{ valid: boolean, vid?: string, data?: Object, error?: string }}
 */
function verifyVisitToken(token) {
  try {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'missing_token' };
    }

    const parts = token.split('.');
    if (parts.length !== 2) return { valid: false, error: 'malformed_token' };

    const [payloadB64, receivedSig] = parts;

    // Verify signature
    const expectedSig = b64url(
      crypto.createHmac('sha256', secret()).update(payloadB64).digest()
    );

    // Constant-time comparison
    const sigBuf = Buffer.from(receivedSig, 'base64');
    const expBuf = Buffer.from(expectedSig, 'base64');
    if (sigBuf.length !== expBuf.length) return { valid: false, error: 'bad_signature' };
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return { valid: false, error: 'bad_signature' };

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));

    // Check expiry
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) return { valid: false, error: 'token_expired' };

    return { valid: true, vid: payload.vid, data: payload };
  } catch (err) {
    return { valid: false, error: 'parse_error' };
  }
}

/**
 * Mark a visit token as consumed.
 * Returns false if the token was already used or does not exist.
 *
 * @param {string} vid  - visit ID from the verified payload
 * @returns {Promise<boolean>}
 */
async function consumeVisitToken(vid) {
  const ref = db.collection('alumni_visit_tokens').doc(vid);
  let consumed = false;

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw Object.assign(new Error('Token not found'), { code: 'NOT_FOUND' });
    if (doc.data().used) throw Object.assign(new Error('Token already used'), { code: 'ALREADY_USED' });
    tx.update(ref, { used: true, usedAt: FieldValue.serverTimestamp() });
    consumed = true;
  });

  return consumed;
}

module.exports = { issueVisitToken, verifyVisitToken, consumeVisitToken, hashIp, normalizeSource };
