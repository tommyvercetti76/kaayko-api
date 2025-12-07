/**
 * Stripe Webhook Handler
 * Processes payment events and sends email notifications
 */

const admin = require('firebase-admin');

// Lazy-load Stripe
let stripe = null;
function getStripe() {
  if (!stripe) {
    require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    stripe = require('stripe')(apiKey);
  }
  return stripe;
}

/**
 * Handle Stripe webhooks
 * @route POST /api/stripeWebhook
 */
async function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    console.error('❌ STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;

  try {
    const stripeClient = getStripe();
    // When using express.raw(), body is a Buffer in req.body
    const rawBody = req.body;
    event = stripeClient.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error(`⚠️  Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log(`💳 Payment succeeded: ${paymentIntent.id}`);
      await handlePaymentSuccess(paymentIntent);
      break;
      
    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log(`❌ Payment failed: ${failedPayment.id}`);
      await handlePaymentFailure(failedPayment);
      break;
      
    default:
      console.log(`ℹ️  Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
}

/**
 * Handle successful payment - send emails and update database
 */
async function handlePaymentSuccess(paymentIntent) {
  try {
    const db = admin.firestore();
    
    // Update payment intent status in Firestore with comprehensive tracking
    const now = new Date().toISOString();
    await db.collection('payment_intents').doc(paymentIntent.id).update({
      status: 'succeeded',
      paymentStatus: 'succeeded',
      fulfillmentStatus: 'processing',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      paidAt: now,
      amount: paymentIntent.amount,
      statusHistory: admin.firestore.FieldValue.arrayUnion({
        status: 'succeeded',
        timestamp: now,
        note: 'Payment successful'
      })
    });
    
    // Parse items from metadata (stored as JSON string)
    let cartItems = [];
    try {
      cartItems = JSON.parse(paymentIntent.metadata.items || '[]');
    } catch (e) {
      console.error('Failed to parse items from metadata:', e);
      // Fallback to legacy single-item format
      cartItems = [{
        productId: paymentIntent.metadata.productId,
        productTitle: paymentIntent.metadata.productTitle,
        size: paymentIntent.metadata.size,
        gender: paymentIntent.metadata.gender,
        price: paymentIntent.metadata.price
      }];
    }
    
    // Common data for all order items
    const commonData = {
      parentOrderId: paymentIntent.id, // Link all items to same payment
      totalAmount: paymentIntent.amount,
      currency: paymentIntent.currency,
      
      // Order lifecycle tracking
      orderStatus: 'pending', // pending → processing → shipped → delivered → returned
      fulfillmentStatus: 'processing', // processing → ready_to_ship → shipped → delivered
      paymentStatus: 'paid', // paid → refunded → partially_refunded
      
      // Timestamps
      createdAt: paymentIntent.metadata.timestamp,
      updatedAt: now,
      paidAt: now,
      processedAt: null,
      shippedAt: null,
      deliveredAt: null,
      returnedAt: null,
      
      // Shipping tracking
      trackingNumber: null,
      carrier: null,
      trackingUrl: null,
      estimatedDelivery: null,
      
      // Contact info (stored if user provided consent)
      customerEmail: paymentIntent.receipt_email || null,
      customerPhone: paymentIntent.shipping?.phone || null,
      
      // Shipping info (always stored - needed for fulfillment)
      shippingAddress: paymentIntent.shipping ? {
        name: paymentIntent.shipping.name,
        line1: paymentIntent.shipping.address.line1,
        line2: paymentIntent.shipping.address.line2 || null,
        city: paymentIntent.shipping.address.city,
        state: paymentIntent.shipping.address.state,
        postal_code: paymentIntent.shipping.address.postal_code,
        country: paymentIntent.shipping.address.country
      } : null,
      
      // Privacy flag
      dataRetentionConsent: paymentIntent.metadata.dataRetentionConsent === 'true' || false,
      
      // Analytics (non-PII)
      paymentMethod: paymentIntent.payment_method_types?.[0] || 'unknown',
      
      // Status history (audit trail)
      statusHistory: [
        {
          status: 'pending',
          timestamp: paymentIntent.metadata.timestamp,
          note: 'Order created'
        },
        {
          status: 'paid',
          timestamp: now,
          note: 'Payment successful'
        },
        {
          status: 'processing',
          timestamp: now,
          note: 'Order processing started'
        }
      ],
      
      // Admin notes
      internalNotes: [],
      customerNotes: null
    };
    
    // Create SEPARATE order document for EACH item
    const batch = db.batch();
    cartItems.forEach((item, index) => {
      const orderRef = db.collection('orders').doc(`${paymentIntent.id}_item${index + 1}`);
      batch.set(orderRef, {
        ...commonData,
        orderId: `${paymentIntent.id}_item${index + 1}`,
        itemIndex: index + 1,
        totalItems: cartItems.length,
        
        // Individual item details
        productId: item.productId,
        productTitle: item.productTitle,
        size: item.size,
        gender: item.gender,
        price: item.price
      });
    });
    
    await batch.commit();
    console.log(`✅ Created ${cartItems.length} separate order documents for payment ${paymentIntent.id}`);
    
    // Send email notifications
    await sendOrderConfirmationEmails(paymentIntent);
    
    console.log(`✅ Order processed successfully: ${paymentIntent.id}`);
    
  } catch (error) {
    console.error(`❌ Error handling payment success:`, error);
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailure(paymentIntent) {
  try {
    const db = admin.firestore();
    
    const now = new Date().toISOString();
    await db.collection('payment_intents').doc(paymentIntent.id).update({
      status: 'failed',
      paymentStatus: 'failed',
      fulfillmentStatus: 'cancelled',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      failedAt: now,
      cancelledAt: now,
      statusHistory: admin.firestore.FieldValue.arrayUnion({
        status: 'failed',
        timestamp: now,
        note: 'Payment failed'
      }),
      errorMessage: paymentIntent.last_payment_error?.message || 'Unknown error'
    });
    
    console.log(`⚠️  Payment failed for: ${paymentIntent.id}`);
    
  } catch (error) {
    console.error(`❌ Error handling payment failure:`, error);
  }
}

/**
 * Render email template with data
 */
function renderTemplate(template, data) {
  let rendered = template;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    rendered = rendered.replace(regex, value);
  }
  return rendered;
}

/**
 * Send order confirmation emails to customer and admin
 */
async function sendOrderConfirmationEmails(paymentIntent) {
  try {
    const db = admin.firestore();
    const fs = require('fs');
    const path = require('path');
    
    const customerEmail = paymentIntent.receipt_email;
    const adminEmail = paymentIntent.metadata.notifyEmail || 'rohan@kaayko.com';
    
    // Read email templates
    const customerTemplatePath = path.join(__dirname, '../email/templates/orderConfirmation.html');
    const adminTemplatePath = path.join(__dirname, '../email/templates/newOrderNotification.html');
    
    const customerTemplate = fs.readFileSync(customerTemplatePath, 'utf8');
    const adminTemplate = fs.readFileSync(adminTemplatePath, 'utf8');
    
    // Prepare template data
    const amount = (paymentIntent.amount / 100).toFixed(2);
    const now = new Date();
    
    if (!customerEmail) {
      console.warn('⚠️  No customer email provided, skipping customer notification');
    } else {
      // Render customer email
      const customerHtml = renderTemplate(customerTemplate, {
        orderId: paymentIntent.id,
        productName: paymentIntent.metadata.productTitle || 'Kaayko Product',
        size: paymentIntent.metadata.size || 'N/A',
        amount: amount
      });
      
      // Queue customer email
      await db.collection('mail').add({
        to: customerEmail,
        message: {
          subject: '🛶 Order Confirmation - Kaayko',
          html: customerHtml
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`📧 Customer email queued: ${customerEmail}`);
    }
    
    // Render admin email
    const adminHtml = renderTemplate(adminTemplate, {
      orderId: paymentIntent.id,
      customerEmail: customerEmail || 'Not provided',
      productName: paymentIntent.metadata.productTitle || 'Kaayko Product',
      size: paymentIntent.metadata.size || 'N/A',
      amount: amount,
      status: 'SUCCEEDED',
      paymentIntentId: paymentIntent.id,
      timestamp: now.toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        dateStyle: 'full',
        timeStyle: 'long'
      })
    });
    
    // Queue admin notification email
    await db.collection('mail').add({
      to: adminEmail,
      message: {
        subject: '🔔 New Order - Kaayko Store',
        html: adminHtml
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`📧 Admin notification queued: ${adminEmail}`);
    
  } catch (error) {
    console.error(`❌ Error sending emails:`, error);
  }
}

module.exports = stripeWebhook;
