/**
 * Billing API Router (thin)
 * Config in billingConfig.js, handlers in billingHandlers.js
 *
 * GET  /billing/config           - Stripe publishable key
 * GET  /billing/subscription     - Current subscription
 * POST /billing/create-checkout  - Stripe Checkout session
 * POST /billing/downgrade        - Schedule downgrade
 * POST /billing/webhook          - Stripe webhook events
 * GET  /billing/usage            - Usage metrics
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireStripe } = require('./billingConfig');
const {
  handleGetSubscription,
  handleCreateCheckout,
  handleDowngrade,
  handleWebhook,
  handleGetUsage
} = require('./billingHandlers');

// Public
router.get('/config', (req, res) => {
  const stripe = require('./billingConfig').stripe;
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    configured: !!stripe
  });
});

// Authenticated
router.get('/subscription', requireAuth, handleGetSubscription);
router.post('/create-checkout', requireAuth, requireStripe, handleCreateCheckout);
router.post('/downgrade', requireAuth, handleDowngrade);
router.get('/usage', requireAuth, handleGetUsage);

// Stripe webhook (raw body required)
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

module.exports = router;
