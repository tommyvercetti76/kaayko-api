/**
 * Rate Limit Utilities
 * Split from rateLimitService.js — status queries and cleanup.
 *
 * @module api/kortex/rateLimitUtils
 */

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Get rate limit status for a key
 * @param {string} key - Rate limit key
 * @param {string} type - Rate limit type
 * @param {number} maxRequests - Maximum allowed requests
 * @param {number} windowSeconds - Time window
 * @returns {Promise<{count: number, remaining: number, resetAt: number}>}
 */
async function getRateLimitStatus(key, type, maxRequests, windowSeconds = 60) {
  try {
    const now = Date.now();
    const currentBucket = Math.floor(now / (windowSeconds * 1000));
    const doc = await db.collection('rate_limits').doc(`${type}_${key}_${currentBucket}`).get();
    const count = doc.exists ? (doc.data().count || 0) : 0;
    return { count, remaining: Math.max(0, maxRequests - count), resetAt: (currentBucket + 1) * windowSeconds * 1000 };
  } catch (error) {
    console.error('[RateLimit] Status check error:', error);
    return { count: 0, remaining: maxRequests, resetAt: Date.now() + (windowSeconds * 1000) };
  }
}

/**
 * Cleanup expired rate limit documents (scheduled job)
 * @returns {Promise<{deleted: number}>}
 */
async function cleanupExpiredRateLimits() {
  const expiryTs = admin.firestore.Timestamp.fromDate(new Date(Date.now() - (2 * 60 * 60 * 1000)));
  const snap = await db.collection('rate_limits').where('expiresAt', '<', expiryTs).limit(500).get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  if (snap.size > 0) { await batch.commit(); console.log(`[RateLimit] Cleaned up ${snap.size} expired documents`); }
  return { deleted: snap.size };
}

module.exports = { getRateLimitStatus, cleanupExpiredRateLimits };
