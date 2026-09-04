/**
 * Order notices — customer-facing notices the owner sends by hand.
 *
 * Today: the DELAY NOTICE required by the FTC Mail, Internet, or Telephone
 * Order Merchandise Rule (16 CFR 435.2(b)). When an order cannot ship inside
 * the time promised at checkout (SHIP_TIME_TEXT in ../email/policy.js), the
 * buyer must be told the revised date and offered the choice to consent or
 * cancel for a full refund. This endpoint queues that email and records the
 * revised date on the order.
 *
 *   POST /api/admin/orders/delay-notice          (requireAuth + requireAdmin)
 *   { parentOrderId, newEstimatedDate: 'YYYY-MM-DD', reason? }
 *
 * One notice per order per date: the mail document id is
 * `{pi}_delay_{YYYYMMDD}`, so a double-click cannot send two, while a later
 * date (a second delay) sends a fresh notice.
 *
 * Consent rule encoded here: if the revised date is more than
 * DELAY_CONSENT_DAYS past the delivery window originally promised, the notice
 * says silence CANCELS the order (express consent required); otherwise silence
 * keeps it open. The cancellation and refund are still manual steps for the
 * owner — nothing here refunds automatically.
 */

const admin = require('firebase-admin');
const { renderEmail, queueMailOnce, escapeHtml } = require('../email/render');
const { DELIVERY_DAYS, DELAY_CONSENT_DAYS } = require('../email/policy');

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

// ─── Small helpers ─────────────────────────────────────────────

/** Strict YYYY-MM-DD → Date at UTC midnight, or null for anything else (incl. 2026-02-30). */
function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function compactDay(date) {
  return isoDay(date).replace(/-/g, '');
}

function formatLongDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
  });
}

/** Firestore Timestamp | Date | ISO string | epoch ms → Date (or null). */
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  return null;
}

function cleanString(value, max = 200) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/**
 * Does this revised date need the buyer's express consent?
 * The original promise was delivery within DELIVERY_DAYS.max of the order; a
 * revised date more than DELAY_CONSENT_DAYS beyond that means silence is not
 * consent (16 CFR 435.2(b)(1)). With no order date on record the standard rule
 * applies.
 */
function consentRequired(newDate, orderedAt) {
  if (!orderedAt) return false;
  const promisedBy = orderedAt.getTime() + DELIVERY_DAYS.max * DAY_MS;
  return newDate.getTime() > promisedBy + DELAY_CONSENT_DAYS * DAY_MS;
}

function buildConsentHtml({ explicit, newEstimatedDate }) {
  const date = escapeHtml(newEstimatedDate);
  return explicit
    ? `<p><strong>We need to hear from you.</strong> Because this new date is more than ${DELAY_CONSENT_DAYS} days ` +
      `later than we originally promised, we can only keep your order open with your OK. If we have not heard ` +
      `from you by <strong>${date}</strong>, we will cancel the order and refund you in full.</p>`
    : `<p>If we do not hear from you, we will keep your order open and ship it by <strong>${date}</strong>. ` +
      `You can still cancel for a full refund at any time before it ships.</p>`;
}

function buildReasonHtml(reason) {
  return reason
    ? `<p style="margin: 12px 0 0 0; color: #666; font-size: 14px;"><strong>What happened:</strong> ${escapeHtml(reason)}</p>`
    : '';
}

// ─── Endpoint ──────────────────────────────────────────────────

/**
 * Queue a delay notice to the customer and record the revised date.
 * @route POST /api/admin/orders/delay-notice
 * @body {parentOrderId, newEstimatedDate, reason?}
 */
async function sendDelayNotice(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const parentOrderId = cleanString(body.parentOrderId, 200);
    const newDate = parseIsoDate(body.newEstimatedDate);
    const reason = cleanString(body.reason, 500);

    if (!parentOrderId) {
      return res.status(400).json({ success: false, error: 'parentOrderId is required' });
    }
    if (!newDate) {
      return res.status(400).json({ success: false, error: 'newEstimatedDate must be a real date in YYYY-MM-DD form' });
    }
    const todayUtc = new Date(new Date().toISOString().slice(0, 10));
    if (newDate.getTime() < todayUtc.getTime()) {
      return res.status(400).json({ success: false, error: 'newEstimatedDate must be today or later' });
    }

    const db = admin.firestore();
    const snap = await db.collection('orders').where('parentOrderId', '==', parentOrderId).get();
    if (snap.empty) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    const items = snap.docs
      .map(d => ({ id: d.id, ref: d.ref, data: d.data() }))
      .sort((a, b) => (a.data.itemIndex || 0) - (b.data.itemIndex || 0));

    const piSnap = await db.collection('payment_intents').doc(parentOrderId).get();
    const piDoc = piSnap.exists ? piSnap.data() : null;

    const customerEmail = items.map(i => i.data.customerEmail).find(Boolean) || piDoc?.customerEmail || null;
    if (!customerEmail) {
      return res.status(400).json({
        success: false,
        error: 'Order has no customer email on record — send the notice by hand',
        code: 'NO_CUSTOMER_EMAIL'
      });
    }

    const orderedAt =
      toDate(piDoc?.paidAt) || toDate(items[0].data.paidAt) ||
      toDate(piDoc?.createdAt) || toDate(items[0].data.createdAt) || null;
    const explicit = consentRequired(newDate, orderedAt);
    const newEstimatedDate = formatLongDate(newDate);
    const newEstimatedDateIso = isoDay(newDate);
    const mailId = `${parentOrderId}_delay_${compactDay(newDate)}`;

    const html = renderEmail('delayNotice.html', {
      orderId: parentOrderId,
      newEstimatedDate,
      newEstimatedDateIso,
      items: items.map(t => ({
        productTitle: t.data.productTitle || 'Kaayko Product',
        quantity: t.data.quantity || 1,
        variant: [t.data.gender, t.data.size].filter(Boolean).join(' · ') || '—'
      })),
      reasonBlockHtml: buildReasonHtml(reason),
      consentHtml: buildConsentHtml({ explicit, newEstimatedDate })
    });

    // Queue first: the notice going out is the legally important part. If the
    // bookkeeping below fails the admin sees a 500 and the mail still leaves.
    const queued = await queueMailOnce(db, mailId, {
      to: customerEmail,
      message: {
        subject: `An update on your Kaayko order — new delivery date ${newEstimatedDateIso}`,
        html
      },
      paymentIntentId: parentOrderId,
      kind: 'delay_notice'
    });

    if (!queued) {
      return res.json({
        success: true,
        queued: false,
        reason: 'already_sent_for_date',
        mailId,
        parentOrderId,
        newEstimatedDate: newEstimatedDateIso
      });
    }

    const nowIso = new Date().toISOString();
    const author = req.user?.uid || req.user?.email || 'admin';
    const historyEntry = {
      status: 'delay_notice',
      timestamp: nowIso,
      note: `Delay notice sent: new estimated delivery ${newEstimatedDateIso}` +
            `${reason ? ` (${reason})` : ''}${explicit ? ' — express consent required' : ''}`
    };

    for (const item of items) {
      await item.ref.update({
        estimatedDelivery: newEstimatedDateIso,
        delayNoticeSentAt: nowIso,
        delayNoticeCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusHistory: admin.firestore.FieldValue.arrayUnion(historyEntry)
      });
    }

    await db.collection('payment_intents').doc(parentOrderId).set({
      paymentIntentId: parentOrderId,
      estimatedDelivery: newEstimatedDateIso,
      delayNotices: admin.firestore.FieldValue.arrayUnion({
        date: newEstimatedDateIso,
        reason: reason || null,
        sentAt: nowIso,
        mailId,
        consentRequired: explicit,
        by: author
      }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      statusHistory: admin.firestore.FieldValue.arrayUnion(historyEntry)
    }, { merge: true });

    console.log(`📧 Delay notice queued (${mailId}) → ${customerEmail}; new date ${newEstimatedDateIso}`);

    return res.json({
      success: true,
      queued: true,
      mailId,
      parentOrderId,
      orderIds: items.map(i => i.id),
      customerEmail,
      newEstimatedDate: newEstimatedDateIso,
      consentRequired: explicit
    });
  } catch (error) {
    // Never surface raw Firestore text to a client.
    console.error('❌ Error sending delay notice:', error);
    return res.status(500).json({ success: false, error: 'Failed to send delay notice' });
  }
}

module.exports = {
  sendDelayNotice,
  parseIsoDate,
  consentRequired,
  formatLongDate
};
