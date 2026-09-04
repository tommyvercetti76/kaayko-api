/**
 * Update Order Status — the fulfilment half of the store.
 *
 * One person packs these orders, so the endpoint is built around what that
 * person actually does: pick up a whole order (every line item bought in one
 * payment), put it in one box, and give it one tracking number. Hence:
 *
 *   • `parentOrderId` updates every line item of an order in one call.
 *     `orderId` still updates a single line item, for partial shipments.
 *   • Statuses are validated against the documented vocabulary. The old code
 *     wrote whatever string arrived, so one typo ("shiped") silently created an
 *     order that no filter would ever show again.
 *   • Moving to `shipped` emails the customer their tracking number — exactly
 *     once per shipment, via the same deterministic-mail-id rule the checkout
 *     webhook uses (see api/email/render.js).
 *
 * NOTE ON DELIVERY: the email is queued into the Firestore `mail` collection
 * and is only really sent if the `firestore-send-email` extension is installed.
 */

const admin = require('firebase-admin');
const { renderEmail, queueMailOnce } = require('../email/render');

// Vocabulary from docs/ORDER_TRACKING_SYSTEM.md — kept in sync deliberately.
const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'returned', 'cancelled'];
const FULFILLMENT_STATUSES = ['awaiting_payment', 'processing', 'ready_to_ship', 'shipped', 'delivered', 'cancelled'];

const TRACKING_URL_BUILDERS = {
  USPS: n => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`,
  UPS: n => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  FEDEX: n => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
  DHL: n => `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(n)}`
};

function buildTrackingUrl(carrier, trackingNumber) {
  if (!carrier || !trackingNumber) return null;
  const builder = TRACKING_URL_BUILDERS[String(carrier).toUpperCase()];
  return builder ? builder(trackingNumber) : null;
}

function cleanString(value, max = 200) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/** Load the line items this request targets: one item, or a whole order. */
async function loadTargets(db, { orderId, parentOrderId }) {
  if (orderId) {
    const snap = await db.collection('orders').doc(orderId).get();
    if (!snap.exists) return { error: 'Order not found' };
    return { docs: [{ id: orderId, data: snap.data() }] };
  }

  const snap = await db.collection('orders').where('parentOrderId', '==', parentOrderId).get();
  if (snap.empty) return { error: 'Order not found' };
  const docs = snap.docs
    .map(d => ({ id: d.id, data: d.data() }))
    .sort((a, b) => (a.data.itemIndex || 0) - (b.data.itemIndex || 0));
  return { docs };
}

function shipToView(address) {
  if (!address) {
    return { shipName: '—', shipLine1: '—', shipLine2: '', shipCityLine: '—', shipCountry: '—' };
  }
  return {
    shipName: address.name || '—',
    shipLine1: address.line1 || '—',
    shipLine2: address.line2 || '',
    shipCityLine: [address.city, address.state, address.postal_code].filter(Boolean).join(', ') || '—',
    shipCountry: address.country || '—'
  };
}

/**
 * Tell the customer their order shipped. Keyed by the payment intent (or the
 * single line item for a partial shipment) so pressing "mark shipped" twice
 * cannot send two emails.
 */
async function sendShippingConfirmation(db, { targets, parentOrderId, mailKey, trackingNumber, carrier, trackingUrl, estimatedDelivery }) {
  const customerEmail = targets.map(t => t.data.customerEmail).find(Boolean);
  if (!customerEmail) {
    console.warn(`⚠️  No customer email on ${mailKey} — cannot send shipping confirmation`);
    return { queued: false, reason: 'no_customer_email' };
  }

  const address = targets.map(t => t.data.shippingAddress).find(Boolean) || null;

  // Raw block, assembled here so a shipment with no tracking link renders no
  // dead button. Every interpolated value inside it is escaped by renderEmail.
  const trackingLinkHtml = trackingUrl
    ? renderEmail('_trackingButton.html', { trackingUrl, carrier: carrier || 'the carrier' })
    : '';

  const html = renderEmail('shippingConfirmation.html', {
    orderId: parentOrderId || targets[0].id,
    carrier: carrier || 'Not specified',
    trackingNumber: trackingNumber || 'Not available yet',
    estimatedDelivery: estimatedDelivery || 'Not specified',
    items: targets.map(t => ({
      productTitle: t.data.productTitle || 'Kaayko Product',
      quantity: t.data.quantity || 1,
      variant: [t.data.gender, t.data.size].filter(Boolean).join(' · ') || '—'
    })),
    trackingLinkHtml,
    ...shipToView(address)
  });

  const queued = await queueMailOnce(db, `${mailKey}_shipped`, {
    to: customerEmail,
    message: { subject: '📦 Your Kaayko order has shipped', html },
    paymentIntentId: parentOrderId || null
  });
  if (queued) console.log(`📧 Shipping confirmation queued → ${customerEmail}`);
  return { queued };
}

/**
 * Update order status with tracking info.
 * @route POST /api/admin/updateOrderStatus
 * @body {orderId?, parentOrderId?, orderStatus?, fulfillmentStatus?, trackingNumber?,
 *        carrier?, estimatedDelivery?, internalNote?, customerNote?, notifyCustomer?}
 */
async function updateOrderStatus(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const orderId = cleanString(body.orderId);
    const parentOrderId = cleanString(body.parentOrderId);
    const orderStatus = cleanString(body.orderStatus, 40);
    const fulfillmentStatus = cleanString(body.fulfillmentStatus, 40);
    const trackingNumber = cleanString(body.trackingNumber, 100);
    const carrier = cleanString(body.carrier, 40);
    const estimatedDelivery = cleanString(body.estimatedDelivery, 100);
    const internalNote = cleanString(body.internalNote, 1000);
    const customerNote = cleanString(body.customerNote, 1000);
    const notifyCustomer = body.notifyCustomer !== false;

    if (!orderId && !parentOrderId) {
      return res.status(400).json({ success: false, error: 'orderId or parentOrderId is required' });
    }
    if (orderStatus && !ORDER_STATUSES.includes(orderStatus)) {
      return res.status(400).json({
        success: false,
        error: `Invalid orderStatus. Expected one of: ${ORDER_STATUSES.join(', ')}`
      });
    }
    if (fulfillmentStatus && !FULFILLMENT_STATUSES.includes(fulfillmentStatus)) {
      return res.status(400).json({
        success: false,
        error: `Invalid fulfillmentStatus. Expected one of: ${FULFILLMENT_STATUSES.join(', ')}`
      });
    }
    if (!orderStatus && !fulfillmentStatus && !trackingNumber && !estimatedDelivery && !internalNote && !customerNote) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }

    const db = admin.firestore();
    const { docs: targets, error } = await loadTargets(db, { orderId, parentOrderId });
    if (error) return res.status(404).json({ success: false, error });

    const now = new Date().toISOString();
    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    const historyEntries = [];

    if (orderStatus) {
      updates.orderStatus = orderStatus;
      if (orderStatus === 'processing') updates.processedAt = now;
      if (orderStatus === 'shipped') updates.shippedAt = now;
      if (orderStatus === 'delivered') updates.deliveredAt = now;
      if (orderStatus === 'returned') updates.returnedAt = now;
      historyEntries.push({
        status: orderStatus,
        timestamp: now,
        note: internalNote || `Order status changed to ${orderStatus}`
      });
    }

    if (fulfillmentStatus) updates.fulfillmentStatus = fulfillmentStatus;

    const trackingUrl = buildTrackingUrl(carrier, trackingNumber);
    if (trackingNumber) {
      updates.trackingNumber = trackingNumber;
      updates.carrier = carrier || null;
      updates.trackingUrl = trackingUrl;
      historyEntries.push({
        status: 'tracking_updated',
        timestamp: now,
        note: `Tracking number added: ${trackingNumber}${carrier ? ` (${carrier})` : ''}`
      });
    }

    if (estimatedDelivery) updates.estimatedDelivery = estimatedDelivery;
    if (customerNote) updates.customerNotes = customerNote;
    if (historyEntries.length) {
      updates.statusHistory = admin.firestore.FieldValue.arrayUnion(...historyEntries);
    }
    if (internalNote) {
      updates.internalNotes = admin.firestore.FieldValue.arrayUnion({
        note: internalNote,
        timestamp: now,
        author: req.user?.uid || req.user?.email || 'admin'
      });
    }

    for (const target of targets) {
      await db.collection('orders').doc(target.id).update(updates);
    }

    // Roll the parent payment intent forward only when every line item agrees,
    // so a partially-shipped order is not reported as shipped.
    const parentId = parentOrderId || targets[0].data.parentOrderId;
    if (parentId && orderStatus) {
      const allSnap = await db.collection('orders').where('parentOrderId', '==', parentId).get();
      const touched = new Set(targets.map(t => t.id));
      const allSame = allSnap.docs.every(d =>
        touched.has(d.id) ? true : d.data().orderStatus === orderStatus
      );

      if (allSame) {
        await db.collection('payment_intents').doc(parentId).set({
          fulfillmentStatus: fulfillmentStatus || orderStatus,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(orderStatus === 'shipped' && { shippedAt: now }),
          ...(orderStatus === 'delivered' && { fulfilledAt: now }),
          statusHistory: admin.firestore.FieldValue.arrayUnion({
            status: orderStatus,
            timestamp: now,
            note: `All items ${orderStatus}`
          })
        }, { merge: true });
      }
    }

    // ── Tell the customer ────────────────────────────────────────
    let customerNotification = { queued: false, reason: 'not_a_shipment' };
    const isShipment = orderStatus === 'shipped' || fulfillmentStatus === 'shipped';
    if (isShipment && notifyCustomer) {
      const merged = targets.map(t => ({
        id: t.id,
        data: { ...t.data, trackingNumber: trackingNumber || t.data.trackingNumber }
      }));
      customerNotification = await sendShippingConfirmation(db, {
        targets: merged,
        parentOrderId: parentId,
        // A whole-order shipment is keyed by the payment intent; a single-item
        // partial shipment by that item, so both can be sent for one order.
        mailKey: parentOrderId ? parentId : targets[0].id,
        trackingNumber: trackingNumber || targets[0].data.trackingNumber,
        carrier: carrier || targets[0].data.carrier,
        trackingUrl: trackingUrl || targets[0].data.trackingUrl,
        estimatedDelivery: estimatedDelivery || targets[0].data.estimatedDelivery
      });
    } else if (isShipment) {
      customerNotification = { queued: false, reason: 'suppressed_by_caller' };
    }

    console.log(`✅ Updated ${targets.length} line item(s) to: ${orderStatus || fulfillmentStatus}`);

    return res.json({
      success: true,
      orderIds: targets.map(t => t.id),
      parentOrderId: parentId || null,
      orderStatus: orderStatus || null,
      fulfillmentStatus: fulfillmentStatus || null,
      trackingNumber: trackingNumber || null,
      trackingUrl: trackingUrl || null,
      customerNotification
    });

  } catch (error) {
    // Never surface raw Firestore text to a client.
    console.error('❌ Error updating order status:', error);
    return res.status(500).json({ success: false, error: 'Failed to update order status' });
  }
}

module.exports = updateOrderStatus;
module.exports.ORDER_STATUSES = ORDER_STATUSES;
module.exports.FULFILLMENT_STATUSES = FULFILLMENT_STATUSES;
module.exports.buildTrackingUrl = buildTrackingUrl;
