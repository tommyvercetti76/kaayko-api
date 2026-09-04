/**
 * Get Order Details
 * Fetch complete order information for customer or admin view
 */

const admin = require('firebase-admin');

/**
 * Get order by ID with full details
 * @route GET /api/admin/getOrder?orderId=xxx
 * @returns {success, order}
 */
async function getOrder(req, res) {
  try {
    const { orderId, parentOrderId } = req.query;

    if (!orderId && !parentOrderId) {
      return res.status(400).json({
        success: false,
        error: 'orderId or parentOrderId is required'
      });
    }

    const db = admin.firestore();

    // Get single order
    if (orderId) {
      const orderDoc = await db.collection('orders').doc(orderId).get();
      
      if (!orderDoc.exists) {
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      return res.json({
        success: true,
        order: orderDoc.data()
      });
    }

    // Get all orders for a payment intent
    if (parentOrderId) {
      const ordersSnapshot = await db.collection('orders')
        .where('parentOrderId', '==', parentOrderId)
        .orderBy('itemIndex', 'asc')
        .get();

      const orders = ordersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Also get payment intent details
      const paymentIntentDoc = await db.collection('payment_intents').doc(parentOrderId).get();

      return res.json({
        success: true,
        paymentIntent: paymentIntentDoc.exists ? paymentIntentDoc.data() : null,
        orders: orders,
        totalItems: orders.length
      });
    }

  } catch (error) {
    // A missing composite index surfaces here — see firestore.indexes.json.
    console.error('❌ Error fetching order:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch order'
    });
  }
}

/**
 * List orders.
 *
 * Line items are the storage unit but the SHIPMENT is the unit of work, so
 * `groupByOrder=true` returns one entry per payment intent with the address,
 * the totals and every item in it — i.e. a packing list. That is the shape the
 * owner actually needs to answer "what do I ship today"; the flat list is kept
 * for anything that reasons about individual items.
 *
 * @route GET /api/admin/listOrders?orderStatus=pending&groupByOrder=true&limit=50
 * @returns {success, orders} or {success, shipments}
 */
async function listOrders(req, res) {
  try {
    const { 
      orderStatus, 
      fulfillmentStatus, 
      paymentStatus,
      limit = 50,
      startAfter 
    } = req.query;

    const db = admin.firestore();
    let query = db.collection('orders');

    // Apply filters
    if (orderStatus) {
      query = query.where('orderStatus', '==', orderStatus);
    }
    if (fulfillmentStatus) {
      query = query.where('fulfillmentStatus', '==', fulfillmentStatus);
    }
    if (paymentStatus) {
      query = query.where('paymentStatus', '==', paymentStatus);
    }

    // Order by creation time descending
    query = query.orderBy('createdAt', 'desc');

    // Pagination
    if (startAfter) {
      const startDoc = await db.collection('orders').doc(startAfter).get();
      query = query.startAfter(startDoc);
    }

    query = query.limit(parseInt(limit));

    const snapshot = await query.get();
    const orders = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    if (String(req.query.groupByOrder) === 'true') {
      const shipments = await groupIntoShipments(db, orders);
      return res.json({
        success: true,
        shipments,
        count: shipments.length,
        lineItemCount: orders.length,
        hasMore: orders.length === parseInt(limit)
      });
    }

    res.json({
      success: true,
      orders: orders,
      count: orders.length,
      hasMore: orders.length === parseInt(limit)
    });

  } catch (error) {
    // A missing composite index surfaces here — see firestore.indexes.json.
    console.error('❌ Error listing orders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list orders'
    });
  }
}

/**
 * Collapse line items into one packing-list entry per payment intent, enriched
 * with the order-level total (which by design lives only on payment_intents).
 */
async function groupIntoShipments(db, orders) {
  const byParent = new Map();

  for (const order of orders) {
    const parentId = order.parentOrderId || order.id;
    if (!byParent.has(parentId)) {
      byParent.set(parentId, {
        parentOrderId: parentId,
        createdAt: order.createdAt || null,
        orderStatus: order.orderStatus || null,
        fulfillmentStatus: order.fulfillmentStatus || null,
        paymentStatus: order.paymentStatus || null,
        customerEmail: order.customerEmail || null,
        customerPhone: order.customerPhone || null,
        shippingAddress: order.shippingAddress || null,
        // The one thing that blocks fulfilment outright.
        shippingAddressMissing: !order.shippingAddress,
        trackingNumber: order.trackingNumber || null,
        carrier: order.carrier || null,
        trackingUrl: order.trackingUrl || null,
        shippedAt: order.shippedAt || null,
        currency: order.currency || 'usd',
        items: [],
        itemsTotalCents: 0,
        unitCount: 0
      });
    }

    const shipment = byParent.get(parentId);
    shipment.items.push({
      orderId: order.id,
      itemIndex: order.itemIndex || null,
      productId: order.productId || null,
      productTitle: order.productTitle || null,
      size: order.size || null,
      gender: order.gender || null,
      quantity: order.quantity || 1,
      unitPriceCents: order.unitPriceCents || 0,
      lineTotalCents: order.lineTotalCents || 0,
      orderStatus: order.orderStatus || null
    });
    shipment.itemsTotalCents += order.lineTotalCents || 0;
    shipment.unitCount += order.quantity || 1;
    if (!shipment.shippingAddress && order.shippingAddress) {
      shipment.shippingAddress = order.shippingAddress;
      shipment.shippingAddressMissing = false;
    }
  }

  // Attach the authoritative order-level money from payment_intents.
  await Promise.all([...byParent.values()].map(async (shipment) => {
    shipment.items.sort((a, b) => (a.itemIndex || 0) - (b.itemIndex || 0));
    try {
      const piSnap = await db.collection('payment_intents').doc(shipment.parentOrderId).get();
      if (piSnap.exists) {
        const pi = piSnap.data();
        shipment.orderTotalCents = pi.totalCents ?? pi.totalAmount ?? shipment.itemsTotalCents;
        shipment.paidAt = pi.paidAt || null;
        if (!shipment.shippingAddress && pi.shippingAddress) {
          shipment.shippingAddress = pi.shippingAddress;
          shipment.shippingAddressMissing = false;
        }
      } else {
        shipment.orderTotalCents = shipment.itemsTotalCents;
      }
    } catch (err) {
      console.warn(`Could not read payment_intents/${shipment.parentOrderId}: ${err.message}`);
      shipment.orderTotalCents = shipment.itemsTotalCents;
    }
  }));

  return [...byParent.values()];
}

module.exports = { getOrder, listOrders };
