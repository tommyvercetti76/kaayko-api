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
    console.error('❌ Error fetching order:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch order',
      details: error.message
    });
  }
}

/**
 * List all orders with filtering
 * @route GET /api/admin/listOrders?status=processing&limit=50
 * @returns {success, orders}
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

    res.json({
      success: true,
      orders: orders,
      count: orders.length,
      hasMore: orders.length === parseInt(limit)
    });

  } catch (error) {
    console.error('❌ Error listing orders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list orders',
      details: error.message
    });
  }
}

module.exports = { getOrder, listOrders };
