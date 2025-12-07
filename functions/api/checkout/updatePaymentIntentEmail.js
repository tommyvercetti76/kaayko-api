/**
 * Update Payment Intent with Customer Email
 * Updates an existing payment intent's receipt_email field
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
 * Update payment intent with customer email
 * @route POST /api/updatePaymentIntentEmail
 * @body {paymentIntentId, email}
 */
async function updatePaymentIntentEmail(req, res) {
  try {
    const { paymentIntentId, email } = req.body;

    if (!paymentIntentId || !email) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: paymentIntentId, email'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    const stripeClient = getStripe();
    
    // Update payment intent with receipt email
    const updatedPaymentIntent = await stripeClient.paymentIntents.update(
      paymentIntentId,
      {
        receipt_email: email
      }
    );

    console.log(`📧 Updated payment intent ${paymentIntentId} with email: ${email}`);

    // Email stored only in Stripe - simplifies data management
    // Stripe handles receipts, webhook handles notifications

    res.json({
      success: true,
      paymentIntentId: updatedPaymentIntent.id,
      email: email
    });

  } catch (error) {
    console.error('❌ Error updating payment intent email:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update payment intent email',
      details: error.message
    });
  }
}

module.exports = updatePaymentIntentEmail;
