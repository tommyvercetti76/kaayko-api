/**
 * Alumni Report Key Service
 *
 * Generates and validates scoped read-only report keys for alumni campaign
 * dashboards.  A report key is embedded in a Kortex smart link so that
 * school admins (or whatsapp group owners) can view live campaign data
 * with zero login friction.
 *
 * Key anatomy
 * ───────────
 *   rk_<16-hex-random>.<hmac-sha256>
 *   e.g. rk_a3f9c1d2b4e8f700.kX3zq2…
 *
 * Firestore collection: alumni_report_keys
 *   key          — the full key string (also the doc ID for fast lookup)
 *   linkCode     — parent Kortex link code (optional — for cross-linking)
 *   sourceGroup  — scope filter: only return leads from this group (null = all)
 *   sourceBatch  — optional narrower filter
 *   label        — human-readable label ("Batch 2005 WA")
 *   createdAt
 *   expiresAt    — null means no expiry; otherwise a Timestamp
 *   viewCount    — incremented on each valid access
 *   lastViewedAt
 *
 * Security properties
 * ───────────────────
 * - Key is HMAC-signed — you cannot fabricate a key without the secret
 * - Scope is stored server-side — the URL never carries the filter params
 * - Keys are read-only — this service NEVER writes alumni_leads
 * - Rate limiting at the route level (existing rateLimiter middleware)
 */

'use strict';

const crypto = require('crypto');
const admin  = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const db = admin.firestore();

// ─── helpers ────────────────────────────────────────────────────────────────

function secret() {
  return (
    process.env.ALUMNI_TOKEN_SECRET ||
    process.env.KORTEX_SYNC_KEY     ||
    'alumni-dev-secret'
  );
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Sign a raw key string with HMAC-SHA256 (first 16 chars of output) */
function signKey(rawKey) {
  return b64url(
    crypto.createHmac('sha256', secret()).update(rawKey).digest()
  ).slice(0, 16);
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Generate a new report key and persist it to Firestore.
 *
 * @param {Object} opts
 * @param {string|null} opts.linkCode     - parent Kortex link code
 * @param {string|null} opts.sourceGroup  - filter: only this group's leads
 * @param {string|null} opts.sourceBatch  - optional batch filter
 * @param {string}      opts.label        - human label for UI
 * @param {Date|null}   opts.expiresAt    - optional expiry date
 * @returns {Promise<{ key: string, docId: string }>}
 */
async function generateReportKey({ linkCode = null, sourceGroup = null, sourceBatch = null, label = '', expiresAt = null } = {}) {
  const raw = 'rk_' + crypto.randomBytes(8).toString('hex');
  const sig  = signKey(raw);
  const key  = raw + '.' + sig;

  const docRef = db.collection('alumni_report_keys').doc(key);
  await docRef.set({
    key,
    linkCode:    linkCode    || null,
    sourceGroup: sourceGroup || null,
    sourceBatch: sourceBatch || null,
    label:       label       || null,
    expiresAt:   expiresAt   ? admin.firestore.Timestamp.fromDate(expiresAt) : null,
    viewCount:   0,
    lastViewedAt: null,
    createdAt:   FieldValue.serverTimestamp(),
  });

  return { key, docId: key };
}

/**
 * Validate a report key and return its Firestore document data.
 * Increments viewCount and lastViewedAt on success.
 * Throws on invalid or expired keys.
 *
 * @param {string} key
 * @returns {Promise<Object>} Firestore doc data
 */
async function validateReportKey(key) {
  if (!key || typeof key !== 'string') {
    throw Object.assign(new Error('Missing report key'), { code: 'MISSING_KEY' });
  }

  // Structural check: rk_<16hex>.<16+ chars>
  if (!/^rk_[0-9a-f]{16}\.[A-Za-z0-9_-]{10,}$/.test(key)) {
    throw Object.assign(new Error('Malformed report key'), { code: 'BAD_KEY' });
  }

  // HMAC check — prevents key enumeration attacks
  const dotIdx = key.lastIndexOf('.');
  const raw    = key.slice(0, dotIdx);
  const sig    = key.slice(dotIdx + 1);
  const expectedSig = signKey(raw);

  const sigBuf = Buffer.from(sig, 'base64');
  const expBuf = Buffer.from(expectedSig, 'base64');
  // Lengths may differ if sig was truncated — compare what we have
  const maxLen = Math.min(sigBuf.length, expBuf.length);
  if (maxLen === 0 || !crypto.timingSafeEqual(sigBuf.slice(0, maxLen), expBuf.slice(0, maxLen))) {
    throw Object.assign(new Error('Invalid report key signature'), { code: 'BAD_KEY' });
  }

  // Firestore lookup
  const snap = await db.collection('alumni_report_keys').doc(key).get();
  if (!snap.exists) {
    throw Object.assign(new Error('Report key not found'), { code: 'KEY_NOT_FOUND' });
  }

  const data = snap.data();

  // Expiry check
  if (data.expiresAt) {
    const expMs = data.expiresAt.toMillis ? data.expiresAt.toMillis() : data.expiresAt._seconds * 1000;
    if (expMs < Date.now()) {
      throw Object.assign(new Error('Report key expired'), { code: 'KEY_EXPIRED' });
    }
  }

  // Async update — don't block response
  snap.ref.update({
    viewCount:    FieldValue.increment(1),
    lastViewedAt: FieldValue.serverTimestamp(),
  }).catch(() => {});

  return data;
}

module.exports = { generateReportKey, validateReportKey };
