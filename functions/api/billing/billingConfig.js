// Billing Config – Stripe initialization, plan constants, guard middleware
// Extracted from billing/router.js for primer compliance

const admin = require('firebase-admin');
const db = admin.firestore();

// Stripe – only initialize if key is available
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// Price IDs – configure in Stripe Dashboard
const PRICE_IDS = {
  pro: process.env.STRIPE_PRICE_PRO || 'price_pro_monthly',
  business: process.env.STRIPE_PRICE_BUSINESS || 'price_business_monthly'
};

// Plan limits
const PLAN_LIMITS = {
  starter: { links: 25, api_calls: 0 },
  pro: { links: 500, api_calls: 5000 },
  business: { links: 2500, api_calls: 25000 },
  enterprise: { links: Infinity, api_calls: Infinity }
};

/**
 * Express middleware – rejects request if Stripe is not configured
 */
function requireStripe(req, res, next) {
  if (!stripe) {
    return res.status(503).json({
      success: false,
      error: 'Payment system not configured',
      message: 'Please contact support to enable payments'
    });
  }
  next();
}

module.exports = { stripe, db, PRICE_IDS, PLAN_LIMITS, requireStripe };
