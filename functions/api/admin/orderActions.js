/**
 * Refund and cancel, from Kortex — the two things the policies promise and the
 * admin could not do until 13 Sep 2026.
 *
 *   POST /admin/orders/refund  { parentOrderId, amountCents?, reason? }
 *   POST /admin/orders/cancel  { parentOrderId, reason? }
 *
 * Both run behind requireAuth + requirePlatformAdmin (money). Both go THROUGH
 * Stripe: the refund is created there, and Stripe's `charge.refunded` webhook
 * is what records the money on the order and emails the customer — one writer,
 * so a refund made from the Stripe dashboard is treated identically.
 *
 * Cancel is a full refund plus an immediate status change (so the packing
 * list stops showing it before the webhook lands). It refuses an order that
 * has left the building: that is a return, and the Returns policy applies.
 */
const admin = require('firebase-admin');
const { getStripe } = require('../../services/stripeClient');

const PI_RE = /^pi_[A-Za-z0-9_]{6,64}$/;
const SHIPPED = new Set(['shipped', 'delivered', 'returned']);
const REASON_MAX = 300;

function badRequest(res, error) {
  return res.status(400).json({ success: false, error });
}

function cleanReason(raw) {
  return typeof raw === 'string' ? raw.trim().slice(0, REASON_MAX) : '';
}

async function loadOrder(db, parentOrderId) {
  const piSnap = await db.collection('payment_intents').doc(parentOrderId).get();
  if (!piSnap.exists) return null;
  const lines = await db.collection('orders').where('parentOrderId', '==', parentOrderId).get();
  return { pi: piSnap.data(), lines: lines.docs };
}

function refundableCents(pi) {
  const total = Number(pi.totalCents ?? pi.totalAmount ?? pi.amount) || 0;
  const already = Number(pi.refundedCents) || 0;
  return Math.max(0, total - already);
}

/** Create the refund at Stripe. The webhook does the bookkeeping. */
async function refundOrder(req, res) {
  try {
    const parentOrderId = String(req.body?.parentOrderId || '').trim();
    if (!PI_RE.test(parentOrderId)) return badRequest(res, 'parentOrderId is required');
    const reason = cleanReason(req.body?.reason);

    const db = admin.firestore();
    const order = await loadOrder(db, parentOrderId);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    const { pi } = order;
    if (pi.paymentStatus !== 'paid' && pi.paymentStatus !== 'partially_refunded' && pi.paymentStatus !== 'succeeded') {
      return res.status(409).json({ success: false, error: `Order is ${pi.paymentStatus || 'unpaid'}; nothing to refund` });
    }

    const left = refundableCents(pi);
    let amountCents = left;
    if (req.body?.amountCents !== undefined && req.body?.amountCents !== null && req.body?.amountCents !== '') {
      const n = Number(req.body.amountCents);
      if (!Number.isInteger(n) || n <= 0) return badRequest(res, 'amountCents must be a whole number of cents');
      if (n > left) return badRequest(res, `Only ${left} cents can still be refunded on this order`);
      amountCents = n;
    }
    if (amountCents <= 0) return res.status(409).json({ success: false, error: 'This order has already been refunded in full' });

    const actor = req.user?.email || req.user?.uid || 'admin';
    const refund = await getStripe().refunds.create({
      payment_intent: parentOrderId,
      amount: amountCents,
      reason: 'requested_by_customer',
      metadata: { orderNumber: pi.orderNumber || '', by: actor, note: reason }
    }, { idempotencyKey: `refund_${parentOrderId}_${amountCents}_${Date.now()}` });

    await db.collection('payment_intents').doc(parentOrderId).set({
      statusHistory: admin.firestore.FieldValue.arrayUnion({
        status: 'refund_requested',
        timestamp: new Date().toISOString(),
        note: `${actor} requested a refund of ${amountCents} cents${reason ? ` — ${reason}` : ''} (Stripe ${refund.id})`
      }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return res.json({ success: true, refundId: refund.id, amountCents, orderNumber: pi.orderNumber || null });
  } catch (err) {
    console.error('admin refundOrder failed:', err);
    const stripeMessage = err?.raw?.message || err?.message || 'Refund failed';
    return res.status(err?.statusCode && err.statusCode < 500 ? 400 : 502).json({ success: false, error: stripeMessage });
  }
}

/** Full refund and an immediate cancelled status, for an order that has not shipped. */
async function cancelOrder(req, res) {
  try {
    const parentOrderId = String(req.body?.parentOrderId || '').trim();
    if (!PI_RE.test(parentOrderId)) return badRequest(res, 'parentOrderId is required');
    const reason = cleanReason(req.body?.reason);

    const db = admin.firestore();
    const order = await loadOrder(db, parentOrderId);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    const { pi, lines } = order;

    if (lines.some((d) => SHIPPED.has(d.data().orderStatus))) {
      return res.status(409).json({ success: false, error: 'This order has shipped. Handle it as a return, not a cancellation.' });
    }
    if (lines.length && lines.every((d) => d.data().orderStatus === 'cancelled')) {
      return res.status(409).json({ success: false, error: 'This order is already cancelled' });
    }

    const actor = req.user?.email || req.user?.uid || 'admin';
    const nowIso = new Date().toISOString();
    const left = refundableCents(pi);
    let refundId = null;
    if (left > 0) {
      const refund = await getStripe().refunds.create({
        payment_intent: parentOrderId,
        amount: left,
        reason: 'requested_by_customer',
        metadata: { orderNumber: pi.orderNumber || '', by: actor, note: reason || 'cancelled before shipping' }
      }, { idempotencyKey: `cancel_${parentOrderId}_${left}` });
      refundId = refund.id;
    }

    const batch = db.batch();
    const entry = {
      status: 'cancelled',
      timestamp: nowIso,
      note: `Cancelled by ${actor} before shipping${reason ? ` — ${reason}` : ''}${refundId ? ` (refund ${refundId})` : ''}`
    };
    for (const doc of lines) {
      batch.set(doc.ref, {
        orderStatus: 'cancelled',
        fulfillmentStatus: 'cancelled',
        cancelledAt: nowIso,
        cancelReason: reason || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusHistory: admin.firestore.FieldValue.arrayUnion(entry)
      }, { merge: true });
    }
    batch.set(db.collection('payment_intents').doc(parentOrderId), {
      fulfillmentStatus: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      cancelReason: reason || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      statusHistory: admin.firestore.FieldValue.arrayUnion(entry)
    }, { merge: true });
    await batch.commit();

    return res.json({ success: true, refundId, refundedCents: left, orderNumber: pi.orderNumber || null, lines: lines.length });
  } catch (err) {
    console.error('admin cancelOrder failed:', err);
    const stripeMessage = err?.raw?.message || err?.message || 'Cancel failed';
    return res.status(err?.statusCode && err.statusCode < 500 ? 400 : 502).json({ success: false, error: stripeMessage });
  }
}

module.exports = { refundOrder, cancelOrder };
