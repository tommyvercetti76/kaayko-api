/**
 * Public order status — the customer can see their order without an account.
 *
 *   GET  /orders/:number?t=<token>   the order behind a receipt link
 *   POST /orders/lookup              { paymentIntentId, clientSecret } → the number and link,
 *                                    for the success page Stripe returns to
 *
 * Two credentials, both already in the customer's hands and nobody else's:
 *   • the status token minted at the webhook (services/orderNumber.js), carried
 *     only by the receipt link;
 *   • the PaymentIntent client secret, which Stripe put in the return URL.
 * Everything else answers 404 — a wrong token is indistinguishable from a
 * missing order, so numbers cannot be probed.
 *
 * What is returned is what the customer already knows plus the status: the
 * lines as bought (title, size, the frozen image), the money, city and state of
 * the shipping address (never the street), tracking once it exists.
 */
const express = require('express');
const admin = require('firebase-admin');
const rateLimit = require('../../middleware/rateLimit');
const { normalizeOrderNumber, tokensMatch, statusPath, statusUrl } = require('../../services/orderNumber');
const { getStripe } = require('../../services/stripeClient');

const router = express.Router();
router.use(express.json({ limit: '4kb' }));
router.use(rateLimit(60, 10 * 60 * 1000));

const notFound = (res) => res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'No order by that number.' });

const toIso = (v) => (v && typeof v.toDate === 'function') ? v.toDate().toISOString() : (typeof v === 'string' ? v : null);

const SHIPPED = new Set(['shipped', 'delivered', 'returned']);

/** One word for the whole order, from the line statuses and the payment record. */
function overallStatus(pi, items) {
  const statuses = items.map((i) => i.orderStatus || 'pending');
  if (pi.paymentStatus === 'refunded' || (pi.fulfillmentStatus === 'cancelled' && statuses.every((s) => s === 'cancelled'))) return 'refunded';
  if (statuses.every((s) => s === 'cancelled')) return 'cancelled';
  if (statuses.every((s) => s === 'delivered')) return 'delivered';
  if (statuses.some((s) => SHIPPED.has(s))) return 'shipped';
  if (statuses.some((s) => s === 'processing')) return 'making';
  return 'paid';
}

function shapeOrder(pi, items) {
  const first = items.find((i) => i.trackingNumber) || items[0] || {};
  const address = pi.shippingAddress || first.shippingAddress || null;
  return {
    orderNumber: pi.orderNumber,
    status: overallStatus(pi, items),
    placedAt: toIso(pi.paidAt) || toIso(pi.createdAt),
    shippedAt: toIso(first.shippedAt),
    deliveredAt: toIso(items.find((i) => i.deliveredAt)?.deliveredAt),
    cancelledAt: toIso(pi.cancelledAt),
    estimatedShipBy: first.estimatedDelivery || null,
    paymentStatus: pi.paymentStatus || 'paid',
    refundedCents: Number(pi.refundedCents) || 0,
    currency: pi.currency || 'usd',
    subtotalCents: Number(pi.subtotalCents) || 0,
    taxCents: Number(pi.taxCents) || 0,
    discountCents: Number(pi.discountCents) || 0,
    totalCents: Number(pi.totalCents ?? pi.totalAmount) || 0,
    items: items.map((i) => ({
      productTitle: i.productTitle || 'Kaayko Product',
      size: i.size || null,
      gender: i.gender || null,
      quantity: Number(i.quantity) || 1,
      lineTotalCents: Number(i.lineTotalCents) || 0,
      imgSrc: typeof i.imgSrc === 'string' ? i.imgSrc : null,
      status: i.orderStatus || 'pending'
    })),
    shipTo: address ? {
      name: address.name || null,
      city: address.city || null,
      state: address.state || null,
      country: address.country || null
    } : null,
    tracking: first.trackingNumber ? {
      carrier: first.carrier || null,
      number: first.trackingNumber,
      url: /^https:\/\//.test(String(first.trackingUrl || '')) ? first.trackingUrl : null
    } : null
  };
}

async function loadLines(db, paymentIntentId) {
  const snap = await db.collection('orders').where('parentOrderId', '==', paymentIntentId).get();
  return snap.docs
    .map((d) => d.data())
    .sort((a, b) => (Number(a.itemIndex) || 0) - (Number(b.itemIndex) || 0));
}

router.get('/:number', async (req, res) => {
  try {
    const number = normalizeOrderNumber(req.params.number);
    const token = String(req.query.t || '').trim();
    if (!number || !token || token.length > 128) return notFound(res);

    const db = admin.firestore();
    const q = await db.collection('payment_intents').where('orderNumber', '==', number).limit(1).get();
    if (q.empty) return notFound(res);
    const pi = q.docs[0].data();
    if (!tokensMatch(pi.statusToken, token)) return notFound(res);

    const items = await loadLines(db, q.docs[0].id);
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, order: shapeOrder(pi, items) });
  } catch (err) {
    console.error('[orders] status failed:', err.message);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR' });
  }
});

const PI_RE = /^pi_[A-Za-z0-9_]{6,64}$/;

router.post('/lookup', async (req, res) => {
  try {
    const paymentIntentId = String(req.body?.paymentIntentId || '').trim();
    const clientSecret = String(req.body?.clientSecret || '').trim();
    if (!PI_RE.test(paymentIntentId) || !clientSecret.startsWith(`${paymentIntentId}_secret_`) || clientSecret.length > 200) {
      return notFound(res);
    }

    // The client secret is verified against Stripe, not against anything we
    // stored: it is Stripe's credential, so Stripe is the authority.
    const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
    if (!intent || !tokensMatch(intent.client_secret, clientSecret)) return notFound(res);

    const snap = await admin.firestore().collection('payment_intents').doc(paymentIntentId).get();
    const pi = snap.exists ? snap.data() : null;
    res.set('Cache-Control', 'no-store');
    if (!pi || !pi.orderNumber || !pi.statusToken) {
      // Paid, but the webhook has not written the order yet. The page polls.
      return res.json({ success: true, pending: true });
    }
    return res.json({
      success: true,
      orderNumber: pi.orderNumber,
      statusPath: statusPath(pi.orderNumber, pi.statusToken),
      statusUrl: statusUrl(pi.orderNumber, pi.statusToken)
    });
  } catch (err) {
    console.error('[orders] lookup failed:', err.message);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR' });
  }
});

module.exports = router;
module.exports.shapeOrder = shapeOrder;
module.exports.overallStatus = overallStatus;
