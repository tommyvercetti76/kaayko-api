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

/**
 * POST /admin/mail/redrive   { ids?: string[], all?: boolean, maxAgeDays?: number }
 * Re-runs delivery, with force, on ERROR documents: the ones the scheduled
 * redrive deliberately leaves alone. Used once after the SMTP secret is set
 * (every message queued before it failed permanently) and for hand fixes.
 * Ids only in the response, never recipients or bodies.
 */
async function mailRedrive(req, res) {
  try {
    const { deliverMailDocument } = require('../../triggers/mailSender');
    const db = admin.firestore();
    const body = req.body || {};
    const maxAgeDays = Math.max(1, Math.min(90, Number(body.maxAgeDays) || 30));
    let ids = Array.isArray(body.ids) ? body.ids.filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id)).slice(0, 50) : [];
    if (!ids.length && body.all === true) {
      const cutoff = Date.now() - maxAgeDays * 86400000;
      const snap = await db.collection('mail').where('delivery.state', '==', 'ERROR').limit(50).get();
      ids = snap.docs.filter(d => (toMillis(d.data().createdAt) ?? Date.now()) >= cutoff).map(d => d.id);
    }
    if (!ids.length) return res.json({ success: true, attempted: 0, results: [] });
    const results = [];
    for (const id of ids) {
      try {
        const r = await deliverMailDocument(id, { force: true });
        results.push({ id, sent: !!r.sent, state: r.state || null, error: r.error ? String(r.error).slice(0, 160) : null });
      } catch (e) {
        results.push({ id, sent: false, state: 'ERROR', error: String(e.message || e).slice(0, 160) });
      }
    }
    return res.json({ success: true, attempted: results.length, sent: results.filter(r => r.sent).length, results });
  } catch (err) {
    console.error('admin mailRedrive failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to redrive mail' });
  }
}

/**
 * POST /admin/mail/identity-test — queue one small mail per family member to
 * the owner. Zoho refuses a From that is not an alias of the mailbox, so the
 * mails that end in ERROR name the aliases still to be created. Body may carry
 * { to } to send elsewhere. Platform admin only (mounted in index.js).
 */
async function mailIdentityTest(req, res) {
  const { family, EMAIL_RE } = require('../../config/mailIdentity');
  const { notify } = require('../../services/notify');
  const to = typeof req.body?.to === 'string' && EMAIL_RE.test(req.body.to.trim()) ? req.body.to.trim() : require('../email/notifyAddress').resolveNotifyEmail();
  const stamp = new Date().toISOString();
  const results = [];
  for (const m of family()) {
    const r = await notify({
      product: m.product,
      kind: 'identity-test',
      to,
      subject: `[${m.product}] identity test from ${m.address}`,
      text: `This is the ${m.product} sender (${m.from}), reply-to ${m.replyTo}. Sent ${stamp}. If this arrived, Zoho accepts the alias.`,
      dedupeKey: `identity_test_${m.product}_${stamp.slice(0, 16).replace(/[:T]/g, '-')}`
    });
    results.push({ product: m.product, from: m.from, replyTo: m.replyTo, queued: r.queued, mailId: r.mailId, reason: r.reason || null });
  }
  return res.json({ success: true, to, results, next: 'Watch GET /admin/mailHealth: a member that ends in ERROR 553 is an alias Zoho does not know yet.' });
}

module.exports = { mailHealth, mailRedrive, mailIdentityTest, STALE_RETRY_MS };
