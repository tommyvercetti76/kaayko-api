/**
 * Checkout API Router
 * Handles Stripe payment operations
 */

const express = require('express');
const router = express.Router();
const createPaymentIntent = require('./createPaymentIntent');
const updatePaymentIntentEmail = require('./updatePaymentIntentEmail');
const stripeWebhook = require('./stripeWebhook');

// POST /api/createPaymentIntent - Create Stripe payment intent
router.post('/', createPaymentIntent);

// POST /api/updatePaymentIntentEmail - Update payment intent with email
router.post('/updateEmail', updatePaymentIntentEmail);

// POST /api/stripeWebhook - Handle Stripe webhook events
// Note: This needs raw body, configured in index.js
router.post('/webhook', stripeWebhook);

module.exports = router;
