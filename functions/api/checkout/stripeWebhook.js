/**
 * Stripe Webhook Handler
 * Entry point for Stripe payment event processing.
 *
 * @module api/checkout/stripeWebhook
 */

const admin = require('firebase-admin');
const { handlePaymentSuccess } = require('./stripeOrderHandler');

// Lazy-load Stripe
let stripe = null;
function getStripe() {
  if (!stripe) {
    require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) throw new Error('STRIPE_SECRET_KEY not configured');
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
    event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('⚠️  Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      console.log(`💳 Payment succeeded: ${event.data.object.id}`);
      await handlePaymentSuccess(event.data.object);
      break;
    case 'payment_intent.payment_failed':
      console.log(`❌ Payment failed: ${event.data.object.id}`);
      await handlePaymentFailure(event.data.object);
      break;
    default:
      console.log(`ℹ️  Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
}

/**
 * Handle failed payment — update Firestore status
 * @param {Object} paymentIntent
 */
async function handlePaymentFailure(paymentIntent) {
  try {
    const db = admin.firestore();
    const now = new Date().toISOString();
    await db.collection('payment_intents').doc(paymentIntent.id).update({
      status: 'failed', paymentStatus: 'failed', fulfillmentStatus: 'cancelled',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      failedAt: now, cancelledAt: now,
      statusHistory: admin.firestore.FieldValue.arrayUnion({
        status: 'failed', timestamp: now, note: 'Payment failed'
      }),
      errorMessage: paymentIntent.last_payment_error?.message || 'Unknown error'
    });
    console.log(`⚠️  Payment failed for: ${paymentIntent.id}`);
  } catch (error) {
    console.error('❌ Error handling payment failure:', error);
  }
}

module.exports = stripeWebhook;
