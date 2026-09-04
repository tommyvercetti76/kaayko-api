/**
 * Where owner notifications go.
 *
 * The address used to be the string literal 'rohan@kaayko.com' in two files
 * (createPaymentIntent stamped it into Stripe metadata, the webhook read it
 * back). Changing it meant a code edit and a redeploy, and a payment intent
 * created before the edit kept mailing the old address forever.
 *
 * Resolution order:
 *   1. ORDER_NOTIFY_EMAIL env var  — the operator's live switch, no deploy of
 *      new code required and it applies to in-flight payment intents too.
 *   2. paymentIntent.metadata.notifyEmail — what was stamped at creation time.
 *   3. DEFAULT_ORDER_NOTIFY_EMAIL — so the owner is NEVER silently un-notified
 *      because metadata was missing or malformed.
 *
 * Every candidate must look like an email address; a typo'd env var falls
 * through to the next candidate rather than sending mail into a black hole.
 */

const DEFAULT_ORDER_NOTIFY_EMAIL = 'rohanramekar17@gmail.com';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validEmail(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return EMAIL_RE.test(trimmed) && trimmed.length <= 254 ? trimmed : null;
}

/**
 * @param {object} [paymentIntent] Stripe PaymentIntent (optional).
 * @returns {string} a deliverable owner-notification address, never null.
 */
function resolveNotifyEmail(paymentIntent) {
  return (
    validEmail(process.env.ORDER_NOTIFY_EMAIL) ||
    validEmail(paymentIntent?.metadata?.notifyEmail) ||
    DEFAULT_ORDER_NOTIFY_EMAIL
  );
}

module.exports = { resolveNotifyEmail, validEmail, DEFAULT_ORDER_NOTIFY_EMAIL };
