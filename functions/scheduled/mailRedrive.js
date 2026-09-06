/**
 * Mail redrive — the piece that made the queue trustworthy.
 *
 * triggers/mailSender.js delivers on document CREATE. That is the whole of it:
 * a transient SMTP failure leaves the document in RETRY, an invocation that dies
 * mid-send leaves it in PROCESSING with an expired lease, and a document created
 * while the sender was not deployed is never touched at all — no state, no
 * attempts. Nothing re-drives any of them.
 *
 * That is not hypothetical. On 6 Sep 2026 four real order emails — two customer
 * receipts, two owner notifications — sat in `mail` with `state: (none)` and
 * `attempts: 0`, because mailSender had never been deployed. The buyers were
 * never told their orders existed, and no alert fired, because from every other
 * system's point of view the mail had been "sent".
 *
 * This job runs every 15 minutes and re-drives anything deliverable:
 *   • never attempted (no state)      — the sender was down or absent
 *   • RETRY under the attempt cap     — transient SMTP failure
 *   • PROCESSING with an expired lease — an invocation died mid-send
 *
 * ERROR documents are left alone. Four attempts have failed, or the failure was
 * permanent (no recipient, bad credentials); retrying forever would just burn
 * quota and hide the problem. Those are what api/admin/mailHealth.js reports.
 *
 * It also REDACTS delivered sensitive mail. Guest access codes are queued as a
 * live credential; once SMTP has accepted the message the body is no longer
 * needed, and leaving it in Firestore until retention runs at 90 days would be a
 * standing secret at rest. See services/emailDelivery.js.
 */

'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const { deliverMailDocument } = require('../triggers/mailSender');

// Matches the lease window in mailSender.
const STALE_PROCESSING_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 4;
// Bounded so one run cannot fan out unboundedly against SMTP.
const MAX_PER_RUN = 50;
const SCAN_LIMIT = 500;

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Is this document worth another delivery attempt right now?
 * @returns {{redrive: boolean, why: string}}
 */
function assess(data, now) {
  const delivery = data.delivery || {};
  const state = delivery.state || null;
  const attempts = Number(delivery.attempts) || 0;

  if (state === 'SUCCESS') return { redrive: false, why: 'delivered' };
  if (state === 'ERROR') return { redrive: false, why: 'error — needs a human, see mailHealth' };
  if (!state) return { redrive: true, why: 'never attempted' };
  if (state === 'RETRY') {
    return attempts < MAX_ATTEMPTS
      ? { redrive: true, why: `retry ${attempts}/${MAX_ATTEMPTS}` }
      : { redrive: false, why: 'retry cap reached' };
  }
  if (state === 'PROCESSING') {
    const leaseEnd = toMillis(delivery.leaseExpireTime) ?? 0;
    return leaseEnd < now - STALE_PROCESSING_MS
      ? { redrive: true, why: 'expired lease' }
      : { redrive: false, why: 'in flight' };
  }
  return { redrive: false, why: `unknown state ${state}` };
}

/**
 * Strip the body of a delivered sensitive message, leaving the envelope for
 * audit. Idempotent.
 */
async function redactDelivered(db, doc) {
  const data = doc.data();
  if (!data.sensitive) return false;
  if ((data.delivery || {}).state !== 'SUCCESS') return false;
  if (data.redactedAt) return false;
  await doc.ref.set({
    message: { subject: data.message?.subject || '', html: '[redacted after delivery]', text: '[redacted after delivery]' },
    redactedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return true;
}

/** The work, separated from the schedule so tests can call it directly. */
async function runRedrive({ db = admin.firestore(), now = Date.now() } = {}) {
  const snap = await db.collection('mail').limit(SCAN_LIMIT).get();

  const candidates = [];
  let redacted = 0;
  for (const doc of snap.docs) {
    const { redrive } = assess(doc.data(), now);
    if (redrive && candidates.length < MAX_PER_RUN) candidates.push(doc.id);
    if (await redactDelivered(db, doc).catch(() => false)) redacted++;
  }

  let delivered = 0;
  let failed = 0;
  for (const id of candidates) {
    try {
      // Sequential on purpose: this shares one SMTP connection with the trigger,
      // and a burst of parallel sends is how a provider starts rate-limiting.
      await deliverMailDocument(id);
      delivered++;
    } catch (err) {
      failed++;
      console.error(`[mailRedrive] ${id}: ${err.message}`);
    }
  }

  const summary = { scanned: snap.size, candidates: candidates.length, delivered, failed, redacted };
  console.log('[mailRedrive]', JSON.stringify(summary));
  return summary;
}

exports.mailRedrive = onSchedule(
  {
    schedule: 'every 15 minutes',
    region: 'us-central1',
    timeoutSeconds: 540,
    secrets: ['MAIL_SMTP_URL'],
  },
  async () => { await runRedrive(); }
);

exports.runRedrive = runRedrive;
exports.assess = assess;
