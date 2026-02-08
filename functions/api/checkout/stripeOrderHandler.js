/**
 * Stripe Order Processing
 * Split from stripeWebhook.js — payment success handling and email dispatch.
 *
 * @module api/checkout/stripeOrderHandler
 */

const admin = require('firebase-admin');

/**
 * Handle successful payment — create order docs and trigger emails
 * @param {Object} paymentIntent - Stripe PaymentIntent object
 */
async function handlePaymentSuccess(paymentIntent) {
  try {
    const db = admin.firestore();
    const now = new Date().toISOString();

    await db.collection('payment_intents').doc(paymentIntent.id).update({
      status: 'succeeded', paymentStatus: 'succeeded', fulfillmentStatus: 'processing',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(), paidAt: now,
      amount: paymentIntent.amount,
      statusHistory: admin.firestore.FieldValue.arrayUnion({
        status: 'succeeded', timestamp: now, note: 'Payment successful'
      })
    });

    let cartItems = [];
    try {
      cartItems = JSON.parse(paymentIntent.metadata.items || '[]');
    } catch (e) {
      console.error('Failed to parse items from metadata:', e);
      cartItems = [{
        productId: paymentIntent.metadata.productId,
        productTitle: paymentIntent.metadata.productTitle,
        size: paymentIntent.metadata.size,
        gender: paymentIntent.metadata.gender,
        price: paymentIntent.metadata.price
      }];
    }

    const commonData = {
      parentOrderId: paymentIntent.id,
      totalAmount: paymentIntent.amount,
      currency: paymentIntent.currency,
      orderStatus: 'pending', fulfillmentStatus: 'processing', paymentStatus: 'paid',
      createdAt: paymentIntent.metadata.timestamp, updatedAt: now, paidAt: now,
      processedAt: null, shippedAt: null, deliveredAt: null, returnedAt: null,
      trackingNumber: null, carrier: null, trackingUrl: null, estimatedDelivery: null,
      customerEmail: paymentIntent.receipt_email || null,
      customerPhone: paymentIntent.shipping?.phone || null,
      shippingAddress: paymentIntent.shipping ? {
        name: paymentIntent.shipping.name,
        line1: paymentIntent.shipping.address.line1,
        line2: paymentIntent.shipping.address.line2 || null,
        city: paymentIntent.shipping.address.city,
        state: paymentIntent.shipping.address.state,
        postal_code: paymentIntent.shipping.address.postal_code,
        country: paymentIntent.shipping.address.country
      } : null,
      dataRetentionConsent: paymentIntent.metadata.dataRetentionConsent === 'true' || false,
      paymentMethod: paymentIntent.payment_method_types?.[0] || 'unknown',
      statusHistory: [
        { status: 'pending', timestamp: paymentIntent.metadata.timestamp, note: 'Order created' },
        { status: 'paid', timestamp: now, note: 'Payment successful' },
        { status: 'processing', timestamp: now, note: 'Order processing started' }
      ],
      internalNotes: [], customerNotes: null
    };

    const batch = db.batch();
    cartItems.forEach((item, index) => {
      const orderId = `${paymentIntent.id}_item${index + 1}`;
      const orderRef = db.collection('orders').doc(orderId);
      batch.set(orderRef, {
        ...commonData, orderId, itemIndex: index + 1, totalItems: cartItems.length,
        productId: item.productId, productTitle: item.productTitle,
        size: item.size, gender: item.gender, price: item.price
      });
    });

    await batch.commit();
    console.log(`✅ Created ${cartItems.length} order documents for payment ${paymentIntent.id}`);

    await sendOrderConfirmationEmails(paymentIntent);
    console.log(`✅ Order processed successfully: ${paymentIntent.id}`);
  } catch (error) {
    console.error('❌ Error handling payment success:', error);
  }
}

/** Render simple {{key}} template */
function renderTemplate(template, data) {
  let rendered = template;
  for (const [key, value] of Object.entries(data)) {
    rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return rendered;
}

/**
 * Send order confirmation emails to customer and admin
 * @param {Object} paymentIntent
 */
async function sendOrderConfirmationEmails(paymentIntent) {
  try {
    const db = admin.firestore();
    const fs = require('fs');
    const path = require('path');

    const customerEmail = paymentIntent.receipt_email;
    const adminEmail = paymentIntent.metadata.notifyEmail || 'rohan@kaayko.com';
    const amount = (paymentIntent.amount / 100).toFixed(2);
    const now = new Date();

    const customerTemplatePath = path.join(__dirname, '../email/templates/orderConfirmation.html');
    const adminTemplatePath = path.join(__dirname, '../email/templates/newOrderNotification.html');
    const customerTemplate = fs.readFileSync(customerTemplatePath, 'utf8');
    const adminTemplate = fs.readFileSync(adminTemplatePath, 'utf8');

    if (customerEmail) {
      const customerHtml = renderTemplate(customerTemplate, {
        orderId: paymentIntent.id,
        productName: paymentIntent.metadata.productTitle || 'Kaayko Product',
        size: paymentIntent.metadata.size || 'N/A', amount
      });
      await db.collection('mail').add({
        to: customerEmail,
        message: { subject: '🛶 Order Confirmation - Kaayko', html: customerHtml },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`📧 Customer email queued: ${customerEmail}`);
    } else {
      console.warn('⚠️  No customer email provided, skipping customer notification');
    }

    const adminHtml = renderTemplate(adminTemplate, {
      orderId: paymentIntent.id,
      customerEmail: customerEmail || 'Not provided',
      productName: paymentIntent.metadata.productTitle || 'Kaayko Product',
      size: paymentIntent.metadata.size || 'N/A', amount, status: 'SUCCEEDED',
      paymentIntentId: paymentIntent.id,
      timestamp: now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'full', timeStyle: 'long' })
    });
    await db.collection('mail').add({
      to: adminEmail,
      message: { subject: '🔔 New Order - Kaayko Store', html: adminHtml },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`📧 Admin notification queued: ${adminEmail}`);
  } catch (error) {
    console.error('❌ Error sending emails:', error);
  }
}

module.exports = { handlePaymentSuccess };
