/**
 * Attach customer contact details to a pending Payment Intent.
 *
 * Called once, from the checkout page, at the moment the shopper
 * confirms — not at page load. The previous checkout read the email and
 * consent fields while rendering, before anything had been typed, so the
 * stored consent was only ever the default state of the checkbox.
 */

const admin = require('firebase-admin');

// Lazy-load Stripe to avoid timeout during function initialization.
let stripe = null;
function getStripe() {
  if (!stripe) {
    // IMPORTANT: Firebase secrets may include trailing newlines, so we must trim.
    const apiKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    stripe = require('stripe')(apiKey, { timeout: 60000, maxNetworkRetries: 2, telemetry: false });
  }
  return stripe;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @route POST /api/createPaymentIntent/updateEmail
 * @body {paymentIntentId, email, phone?, dataRetentionConsent?}
 */
async function updatePaymentIntentEmail(req, res) {
  try {
    const { paymentIntentId, email, phone, dataRetentionConsent } = req.body || {};

    if (!paymentIntentId || !email) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: paymentIntentId, email'
      });
    }

    if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    const cleanPhone = typeof phone === 'string' && phone.trim()
      ? phone.trim().slice(0, 32)
      : null;

    // Only accept an id this API actually issued, and only while the
    // payment is still open — otherwise anyone holding a payment intent
    // id could rewrite the receipt address on a completed order.
    const db = admin.firestore();
    const ref = db.collection('payment_intents').doc(String(paymentIntentId));
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ success: false, error: 'Unknown payment intent' });
    }
    if (snap.data()?.paymentStatus === 'succeeded') {
      return res.status(409).json({ success: false, error: 'Payment already completed' });
    }

    await getStripe().paymentIntents.update(paymentIntentId, { receipt_email: email });

    await ref.update({
      customerEmail: email,
      customerPhone: cleanPhone,
      dataRetentionConsent: dataRetentionConsent === true,
      consentRecordedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`📧 Contact details attached to ${paymentIntentId}`);

    res.json({ success: true, paymentIntentId });

  } catch (error) {
    console.error('❌ Error updating payment intent contact details:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update contact details' });
  }
}

module.exports = updatePaymentIntentEmail;
