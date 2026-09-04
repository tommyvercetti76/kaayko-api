/**
 * Checkout API Router
 * Handles Stripe payment operations.
 *
 * This surface is unauthenticated and creates real Stripe PaymentIntents, which
 * makes it a standing card-testing target. Two controls sit in front of it:
 *   1. per-IP rate limiting (the shared factory used elsewhere in the codebase)
 *   2. an origin allowlist matching functions/index.js' privileged-origin rule
 * The amount itself is server-computed — see ./pricing.js.
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('../../middleware/rateLimit');
const createPaymentIntent = require('./createPaymentIntent');
const updatePaymentIntentEmail = require('./updatePaymentIntentEmail');
const { applyTaxHandler } = require('./tax');
const stripeWebhook = require('./stripeWebhook');

// Mirrors ADMIN_ORIGIN_ALLOWLIST in functions/index.js. Checkout is a
// first-party-only surface: no other site has a legitimate reason to open a
// payment intent against the Kaayko catalogue.
const { KAAYKO_WEB_ORIGINS } = require('../../config/origins');
const CHECKOUT_ORIGIN_ALLOWLIST = new Set(KAAYKO_WEB_ORIGINS);

/**
 * Browser callers must come from a Kaayko origin. Non-browser callers (Stripe's
 * webhook, curl, native apps) send no Origin header and are unaffected — this is
 * defence in depth on top of the header-stripping rule in index.js, not the
 * primary control.
 */
function restrictCheckoutOrigin(req, res, next) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');

  if (!origin) return next();

  const allowed =
    CHECKOUT_ORIGIN_ALLOWLIST.has(origin) ||
    (process.env.FUNCTIONS_EMULATOR === 'true' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));

  if (!allowed) {
    res.removeHeader('Access-Control-Allow-Origin');
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'Checkout is not available from this origin',
      code: 'ORIGIN_NOT_ALLOWED'
    });
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
}

// 15 payment-intent creations per IP per 10 minutes. Generous for a real buyer
// retrying a declined card, hostile to a script cycling stolen card numbers.
const checkoutRateLimit = rateLimit(15, 10 * 60 * 1000);

// POST /api/createPaymentIntent - Create Stripe payment intent
router.post('/', restrictCheckoutOrigin, checkoutRateLimit, createPaymentIntent);
router.options('/', restrictCheckoutOrigin);

// POST /api/updatePaymentIntentEmail - Update payment intent with email
router.post('/updateEmail', restrictCheckoutOrigin, checkoutRateLimit, updatePaymentIntentEmail);
router.options('/updateEmail', restrictCheckoutOrigin);

// POST /api/createPaymentIntent/tax - Calculate sales tax for a complete
// shipping address and raise the PaymentIntent amount to subtotal + tax.
// Same origin guard and the SAME rate-limit bucket as intent creation: the
// budget is shared across the checkout routes, so the storefront must call
// this only when the Address Element reports `complete`, not on every keystroke.
router.post('/tax', restrictCheckoutOrigin, checkoutRateLimit, applyTaxHandler);
router.options('/tax', restrictCheckoutOrigin);

// POST /api/stripeWebhook - Handle Stripe webhook events
// Note: this needs the raw body, so index.js mounts it ahead of express.json();
// the route here is the fallback for direct router mounting. No origin guard and
// no rate limit — Stripe signs its requests and sends no Origin header.
router.post('/webhook', stripeWebhook);

module.exports = router;
