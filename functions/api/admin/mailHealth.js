/**
 * Mail queue health for the admin console.
 *
 * WHY THIS EXISTS: mail is queued as a Firestore document and delivered by the
 * mailSender trigger (triggers/mailSender.js). A transient SMTP failure leaves
 * the document in RETRY, the fourth failure marks it ERROR, and a missing
 * MAIL_SMTP_URL marks it ERROR immediately. Nothing re-drives those documents
 * automatically. So a payment could succeed, the order could exist, and the
 * buyer's receipt or shipping confirmation could sit undelivered with nobody
 * looking — the order screen would still read "shipped".
 *
 * This reports COUNTS AND IDS ONLY. Mail documents contain the buyer's name,
 * address and order contents; none of that is returned here, and the route is
 * platform-admin only regardless.
 */

const admin = require('firebase-admin');

// A RETRY document older than this is stuck rather than mid-backoff.
const STALE_RETRY_MS = 60 * 60 * 1000;
const SCAN_LIMIT = 500;

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * GET /admin/mailHealth
 * @returns {{success, healthy, error, staleRetry, processingStuck, checkedAt, ids}}
 */
async function mailHealth(_req, res) {
  try {
    const db = admin.firestore();
    const snap = await db.collection('mail').limit(SCAN_LIMIT).get();
    const now = Date.now();

    const buckets = { error: [], staleRetry: [], processingStuck: [] };

    snap.docs.forEach((doc) => {
      const delivery = doc.data().delivery || {};
      const state = delivery.state || null;
      const touched = toMillis(delivery.endTime) ?? toMillis(delivery.startTime) ?? toMillis(doc.data().createdAt) ?? now;
      const age = now - touched;

      if (state === 'ERROR') buckets.error.push(doc.id);
      else if (state === 'RETRY' && age > STALE_RETRY_MS) buckets.staleRetry.push(doc.id);
      else if (state === 'PROCESSING' && age > STALE_RETRY_MS) buckets.processingStuck.push(doc.id);
    });

    const total = buckets.error.length + buckets.staleRetry.length + buckets.processingStuck.length;

    return res.json({
      success: true,
      healthy: total === 0,
      error: buckets.error.length,
      staleRetry: buckets.staleRetry.length,
      processingStuck: buckets.processingStuck.length,
      scanned: snap.size,
      truncated: snap.size >= SCAN_LIMIT,
      checkedAt: new Date().toISOString(),
      // Ids only — never subjects, recipients or bodies.
      ids: {
        error: buckets.error.slice(0, 20),
        staleRetry: buckets.staleRetry.slice(0, 20),
        processingStuck: buckets.processingStuck.slice(0, 20)
      }
    });
  } catch (err) {
    console.error('admin mailHealth failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to read mail health' });
  }
}

module.exports = { mailHealth, STALE_RETRY_MS };
