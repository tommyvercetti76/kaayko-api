/**
 * Update Order Status
 * Admin endpoint to update fulfillment and shipping status
 */

const admin = require('firebase-admin');

/**
 * Update order status with tracking info
 * @route POST /api/admin/updateOrderStatus
 * @body {orderId, status, trackingNumber, carrier, notes}
 * @returns {success, updatedOrder}
 */
async function updateOrderStatus(req, res) {
  try {
    const { 
      orderId, 
      orderStatus, 
      fulfillmentStatus,
      trackingNumber, 
      carrier, 
      estimatedDelivery,
      internalNote,
      customerNote
    } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: 'orderId is required'
      });
    }

    const db = admin.firestore();
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    const now = new Date().toISOString();
    const updates = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Update order status
    if (orderStatus) {
      updates.orderStatus = orderStatus;
      
      // Set status-specific timestamps
      if (orderStatus === 'processing') updates.processedAt = now;
      if (orderStatus === 'shipped') updates.shippedAt = now;
      if (orderStatus === 'delivered') updates.deliveredAt = now;
      if (orderStatus === 'returned') updates.returnedAt = now;
      
      // Add to history
      updates.statusHistory = admin.firestore.FieldValue.arrayUnion({
        status: orderStatus,
        timestamp: now,
        note: internalNote || `Order status changed to ${orderStatus}`
      });
    }

    // Update fulfillment status
    if (fulfillmentStatus) {
      updates.fulfillmentStatus = fulfillmentStatus;
    }

    // Update tracking info
    if (trackingNumber) {
      updates.trackingNumber = trackingNumber;
      updates.carrier = carrier || null;
      
      // Generate tracking URL based on carrier
      if (carrier) {
        const trackingUrls = {
          'USPS': `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`,
          'UPS': `https://www.ups.com/track?tracknum=${trackingNumber}`,
          'FedEx': `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`,
          'DHL': `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`
        };
        updates.trackingUrl = trackingUrls[carrier.toUpperCase()] || null;
      }
      
      updates.statusHistory = admin.firestore.FieldValue.arrayUnion({
        status: 'tracking_updated',
        timestamp: now,
        note: `Tracking number added: ${trackingNumber} (${carrier})`
      });
    }

    if (estimatedDelivery) {
      updates.estimatedDelivery = estimatedDelivery;
    }

    if (internalNote) {
      updates.internalNotes = admin.firestore.FieldValue.arrayUnion({
        note: internalNote,
        timestamp: now,
        author: 'admin' // TODO: Add actual admin user ID
      });
    }

    if (customerNote) {
      updates.customerNotes = customerNote;
    }

    // Update order
    await orderRef.update(updates);

    // Also update parent payment_intent if all items in same order are updated
    const parentOrderId = orderDoc.data().parentOrderId;
    if (parentOrderId && orderStatus) {
      const allOrders = await db.collection('orders')
        .where('parentOrderId', '==', parentOrderId)
        .get();
      
      const allStatuses = allOrders.docs.map(doc => doc.data().orderStatus);
      const allSame = allStatuses.every(s => s === orderStatus);
      
      if (allSame) {
        // All items have same status, update parent
        await db.collection('payment_intents').doc(parentOrderId).update({
          fulfillmentStatus: fulfillmentStatus || orderStatus,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(orderStatus === 'delivered' && { fulfilledAt: now }),
          statusHistory: admin.firestore.FieldValue.arrayUnion({
            status: orderStatus,
            timestamp: now,
            note: `All items ${orderStatus}`
          })
        });
      }
    }

    console.log(`✅ Updated order ${orderId} to status: ${orderStatus || fulfillmentStatus}`);

    res.json({
      success: true,
      orderId: orderId,
      updates: updates
    });

  } catch (error) {
    console.error('❌ Error updating order status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update order status',
      details: error.message
    });
  }
}

module.exports = updateOrderStatus;
