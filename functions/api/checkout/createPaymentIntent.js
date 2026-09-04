/**
 * Create Payment Intent for Stripe Checkout.
 *
 * SECURITY CONTRACT
 * -----------------
 * The amount charged is computed ENTIRELY server-side from the Firestore
 * catalogue (see ./pricing.js). Nothing money-shaped in the request body is
 * read — a client that posts `price: "$0.50"` for a $69.98 shirt is charged
 * $69.98. The request body only selects *what* is being bought
 * (productId / size / gender / quantity).
 *
 * The `payment_intents/{paymentIntentId}` document written here is the source
 * of truth the Stripe webhook reads when it materialises orders; Stripe
 * metadata carries ids and counts only (metadata values cap at 500 chars).
 */

const crypto = require('crypto');
const admin = require('firebase-admin');
const { resolveCart } = require('./pricing');

// Lazy-load Stripe to avoid timeout during function initialization
let stripe = null;
function getStripe() {
  if (!stripe) {
    // IMPORTANT: Firebase secrets may include trailing newlines, so we must trim
    const apiKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    stripe = require('stripe')(apiKey, {
      timeout: 60000,
      maxNetworkRetries: 2,
      telemetry: false
    });
  }
  return stripe;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLIENT_KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/;
const IDEMPOTENCY_BUCKET_MS = 5 * 60 * 1000;

/**
 * The storefront posts customerEmail/customerPhone/dataRetentionConsent at
 * payment-intent creation time — BEFORE the buyer has typed anything into the
 * Payment Element. Those values are therefore provisional, never a user
 * statement. Anything that is not a well-formed value becomes null.
 */
function normaliseProvisionalContact(body) {
  const email = typeof body.customerEmail === 'string' && EMAIL_RE.test(body.customerEmail.trim())
    ? body.customerEmail.trim().slice(0, 254)
    : null;
  const phone = typeof body.customerPhone === 'string' && body.customerPhone.trim()
    ? body.customerPhone.trim().slice(0, 40)
    : null;
  // Strictly boolean, or null. `false` from an untouched checkbox is not consent
  // and neither is it a refusal, but it is at least a real boolean the checkout
  // page sent; anything else (undefined, "false", 0) is recorded as unknown.
  const consent = typeof body.dataRetentionConsent === 'boolean' ? body.dataRetentionConsent : null;
  return { email, phone, consent };
}

/**
 * Normalise both accepted request shapes into a flat list of selections.
 * The legacy comma-separated shape is still honoured, but its `price` field is
 * discarded like every other client price.
 */
function extractSelections(body) {
  const { items, productId, productTitle, size, gender, quantity } = body;

  if (Array.isArray(items) && items.length > 0) return items;

  if (productId && (size || gender)) {
    const ids = String(productId).split(',').map(s => s.trim()).filter(Boolean);
    const sizes = String(size || '').split(',').map(s => s.trim());
    const genders = String(gender || '').split(',').map(s => s.trim());
    const titles = String(productTitle || '').split(',').map(s => s.trim());
    return ids.map((id, i) => ({
      productId: id,
      productTitle: titles[i] || undefined,
      size: sizes[i] || sizes[0] || '',
      gender: genders[i] || genders[0] || null,
      quantity
    }));
  }

  return null;
}

/** Resolve a Stripe idempotency key: client-supplied when sane, else derived. */
function resolveIdempotencyKey(req, cart) {
  const supplied = typeof req.body.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
  if (CLIENT_KEY_RE.test(supplied)) return `kaayko:${supplied}`;

  let clientKey = 'unknown';
  try {
    clientKey = require('../kortex/clientIp').getClientIp(req) || req.ip || 'unknown';
  } catch (_) {
    clientKey = req.ip || 'unknown';
  }

  // A retry of the same cart from the same client within the bucket window
  // reuses the same Stripe PaymentIntent instead of creating a duplicate.
  const fingerprint = JSON.stringify({
    c: clientKey,
    t: cart.totalCents,
    i: cart.items.map(i => [i.productId, i.size, i.gender, i.quantity]),
    w: Math.floor(Date.now() / IDEMPOTENCY_BUCKET_MS)
  });
  return `kaayko:${crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 48)}`;
}

/**
 * Create a Stripe Payment Intent for a catalogue purchase.
 *
 * @route POST /api/createPaymentIntent
 * @body  {items: [{productId, size, gender, quantity}], customerEmail?, customerPhone?,
 *         dataRetentionConsent?, idempotencyKey?}
 * @returns {clientSecret, paymentIntentId, amount, currency, items}
 */
async function createPaymentIntent(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const selections = extractSelections(body);

    if (!selections) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Missing required fields: items array of { productId, size, gender, quantity }',
        code: 'MISSING_ITEMS'
      });
    }

    // ── The only price authority: the Firestore catalogue ────────────────────
    const cart = await resolveCart(selections);
    if (!cart.ok) {
      return res.status(cart.status || 400).json({
        success: false,
        error: 'Bad Request',
        message: cart.message,
        code: cart.code
      });
    }

    const { items, subtotalCents, totalCents, currency } = cart;
    const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
    const contact = normaliseProvisionalContact(body);

    console.log(
      `[checkout] Pricing ${items.length} line(s), ${totalQuantity} unit(s), total $${(totalCents / 100).toFixed(2)} (server-priced)`
    );

    const stripeClient = getStripe();
    const paymentIntent = await stripeClient.paymentIntents.create(
      {
        amount: totalCents,
        currency,
        automatic_payment_methods: { enabled: true },
        // Don't set receipt_email — it is collected via the Payment Element.
        // Metadata stays small on purpose: Stripe caps each value at 500 chars,
        // and the webhook reads payment_intents/{id} for the real item list.
        metadata: {
          source: 'kaayko-store',
          itemsRef: 'firestore:payment_intents',
          lineCount: String(items.length),
          unitCount: String(totalQuantity),
          productIds: items.map(i => i.productId).join(',').slice(0, 480),
          subtotalCents: String(subtotalCents),
          totalCents: String(totalCents),
          // Deliberately NO wall-clock timestamp here. The idempotency key
          // below is stable for the same cart + client within a 5 minute
          // bucket, and Stripe rejects a reused key whose request parameters
          // differ. A timestamp that ticks every call made every legitimate
          // retry — reopening checkout after going back to the bag — fail
          // with an idempotency error. Stripe records `created` itself, and
          // payment_intents/{id}.createdAt holds our own copy.
          notifyEmail: 'rohan@kaayko.com'
        }
      },
      { idempotencyKey: resolveIdempotencyKey(req, cart) }
    );

    // ── Authoritative order document — written BEFORE the client gets the
    //    client secret, because the webhook treats it as the source of truth. ──
    const nowIso = new Date().toISOString();
    const db = admin.firestore();
    await db.collection('payment_intents').doc(paymentIntent.id).set({
      // Identity
      paymentIntentId: paymentIntent.id,

      // Server-computed money (authoritative)
      items: items.map(item => ({
        productId: item.productId,
        productTitle: item.productTitle,
        size: item.size,
        gender: item.gender,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        lineTotalCents: item.lineTotalCents
      })),
      subtotalCents,
      totalCents,
      currency,
      itemCount: items.length,
      unitCount: totalQuantity,
      pricingSource: 'server',

      // Legacy aliases retained so existing admin/order readers keep working.
      totalAmount: totalCents,
      totalAmountFormatted: `$${(totalCents / 100).toFixed(2)}`,

      // Order lifecycle tracking
      status: 'created',                    // created → pending → succeeded → fulfilled → cancelled
      paymentStatus: 'pending',             // pending → succeeded → failed → refunded
      fulfillmentStatus: 'awaiting_payment', // awaiting_payment → processing → fulfilled → cancelled

      // Timestamps
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      paidAt: null,
      fulfilledAt: null,
      cancelledAt: null,

      // Provisional contact — captured before the buyer typed anything, so it is
      // explicitly nullable and flagged as unconfirmed. The webhook must prefer
      // the values Stripe collected in the Payment Element.
      customerEmail: contact.email,
      customerPhone: contact.phone,
      contactConfirmed: false,

      // Privacy — null means "not stated", not "declined".
      dataRetentionConsent: contact.consent,

      // Tracking history (audit trail)
      statusHistory: [{
        status: 'created',
        timestamp: nowIso,
        note: 'Payment intent created (server-priced)'
      }]
    });

    console.log(`[checkout] Stored payment_intents/${paymentIntent.id} with ${items.length} line item(s)`);

    return res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: totalCents,
      subtotalCents,
      currency,
      // Echo the server's view so the client can reconcile its cart display.
      items: items.map(i => ({
        productId: i.productId,
        productTitle: i.productTitle,
        size: i.size,
        gender: i.gender,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        lineTotalCents: i.lineTotalCents
      }))
    });

  } catch (error) {
    console.error('[checkout] Payment intent error:', error.message);
    // Do not leak internals (Stripe/Firestore messages) to the caller.
    return res.status(500).json({
      success: false,
      error: 'Server error',
      message: 'Failed to create payment intent',
      code: 'PAYMENT_INTENT_FAILED'
    });
  }
}

module.exports = createPaymentIntent;
