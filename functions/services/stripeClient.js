/**
 * stripeClient.js — one lazily-built Stripe client for routes that are not the
 * checkout or the webhook (those two keep their own, identical, construction).
 *
 * Lazy so a cold start never pays for Stripe before a request needs it, and so
 * tests can `jest.mock('stripe')` before the first call. The key is the
 * `STRIPE_SECRET_KEY` secret bound to the `api` function; Firebase secrets can
 * carry a trailing newline, hence the trim.
 */
let stripe = null;

function getStripe() {
  if (!stripe) {
    const apiKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!apiKey) throw new Error('STRIPE_SECRET_KEY not configured');
    stripe = require('stripe')(apiKey, { timeout: 30000, maxNetworkRetries: 2, telemetry: false });
  }
  return stripe;
}

module.exports = { getStripe };
