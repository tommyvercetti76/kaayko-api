/**
 * Sales tax for the Kaayko Store checkout — Stripe Tax.
 *
 * WHY THIS EXISTS
 * ---------------
 * Stripe is a payment processor, not a marketplace facilitator: it does not
 * collect or remit sales tax on Kaayko's behalf. Until this module nothing in
 * the checkout added tax at all (`pricing.js` priced the cart and the
 * PaymentIntent was created for exactly the subtotal).
 *
 * WHERE IT SITS IN THE FLOW
 * -------------------------
 *   1. POST /createPaymentIntent          — cart is priced server-side, the
 *      PaymentIntent is created for the SUBTOTAL. No address is known yet.
 *   2. The storefront mounts a Stripe Address Element (shipping, US only) and a
 *      Payment Element against that PaymentIntent's client secret.
 *   3. POST /createPaymentIntent/tax      — THIS MODULE. Once the address is
 *      complete the storefront posts it here; we run a Stripe Tax calculation
 *      against the server-priced items, raise the PaymentIntent amount to
 *      subtotal + tax, and record the result on payment_intents/{id}.
 *   4. stripe.confirmPayment()            — the shopper pays the taxed amount.
 *   5. payment_intent.succeeded webhook   — calls recordTaxTransaction() so the
 *      collected tax appears in Stripe's tax reports / filings.
 *
 * FAIL-CLOSED CONTRACT
 * --------------------
 * The feature is gated by STRIPE_TAX_ENABLED. When it is OFF the route answers
 * {enabled:false, taxCents:0} without ever calling Stripe, so checkout behaves
 * exactly as it did before this module existed. When it is ON and Stripe Tax
 * cannot be reached, the route answers 502 — it never lets a shopper pay an
 * un-taxed total while the owner believes tax is being collected.
 *
 * Amounts are integer cents throughout. Nothing money-shaped is read from the
 * request body: the items come from payment_intents/{id}, which was written by
 * createPaymentIntent.js from the catalogue.
 */

const admin = require('firebase-admin');

// ─── Stripe client (lazy; Firebase secrets carry a trailing newline) ─────────
let stripe = null;
function getStripe() {
  if (!stripe) {
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

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Stripe Tax product tax code applied when a product document carries no
 * `taxCode` of its own. txcd_30011000 = "Clothing & Footwear" (general
 * apparel). Whether apparel is taxable, and at what rate, is decided by Stripe
 * Tax per jurisdiction from this code — see docs/SALES_TAX.md.
 */
const DEFAULT_TAX_CODE = 'txcd_30011000';

const CURRENCY = 'usd';
const PI_ID_RE = /^pi_[A-Za-z0-9]{8,64}$/;
const US_STATE_RE = /^[A-Z]{2}$/;
const US_ZIP_RE = /^\d{5}(-\d{4})?$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

/** Feature flag. Anything other than the literal string "true" is OFF. */
function isTaxEnabled() {
  return String(process.env.STRIPE_TAX_ENABLED || '').trim().toLowerCase() === 'true';
}

/** Structured failure with a stable code the caller can map to an HTTP status. */
class TaxError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'TaxError';
    this.code = code;
    Object.assign(this, extra);
  }
}

// ─── Address ─────────────────────────────────────────────────────────────────

/**
 * Validate and normalise the shipping address posted by the storefront.
 *
 * The Address Element restricts the country picker to the US, but that is a
 * client-side control: anything can be posted to this route. The US check here
 * is the one that counts.
 *
 * @returns {{ok: true, address: object} | {ok: false, code: string, message: string}}
 */
function normaliseAddress(raw) {
  const invalid = (message) => ({ ok: false, code: 'INVALID_ADDRESS', message });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return invalid('address must be an object with line1, city, state, postal_code and country');
  }

  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  const country = str(raw.country).toUpperCase();
  if (!COUNTRY_RE.test(country)) return invalid('address.country must be a two-letter ISO country code');
  if (country !== 'US') {
    return {
      ok: false,
      code: 'ADDRESS_COUNTRY_NOT_SUPPORTED',
      message: 'Kaayko ships within the United States only'
    };
  }

  const line1 = str(raw.line1);
  const line2 = str(raw.line2);
  const city = str(raw.city);
  const state = str(raw.state).toUpperCase();
  const postalCode = str(raw.postal_code);
  const name = str(raw.name);

  if (!line1 || line1.length > 200) return invalid('address.line1 is required');
  if (line2.length > 200) return invalid('address.line2 is too long');
  if (!city || city.length > 100) return invalid('address.city is required');
  if (!US_STATE_RE.test(state)) return invalid('address.state must be a two-letter state code');
  if (!US_ZIP_RE.test(postalCode)) return invalid('address.postal_code must be a 5-digit ZIP (optionally ZIP+4)');
  if (name.length > 100) return invalid('address.name is too long');

  return {
    ok: true,
    address: {
      name: name || null,
      line1,
      line2: line2 || null,
      city,
      state,
      postal_code: postalCode,
      country
    }
  };
}

// ─── Calculation ─────────────────────────────────────────────────────────────

/**
 * Turn server-priced items into Stripe Tax line items.
 *
 * `reference` is the productId — it is what shows up in Stripe's tax exports.
 * A cart can legitimately hold the same product twice (two sizes), and Stripe
 * requires references to be unique within a calculation, so a repeat gets a
 * "#n" suffix.
 */
function buildLineItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TaxError('TAX_ITEMS_INVALID', 'No line items to calculate tax for');
  }
  const seen = new Map();
  return items.map((item, index) => {
    const productId = typeof item?.productId === 'string' ? item.productId.trim() : '';
    const amount = item?.lineTotalCents;
    const quantity = item?.quantity ?? 1;
    if (!productId) {
      throw new TaxError('TAX_ITEMS_INVALID', `Line ${index + 1} has no productId`);
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new TaxError('TAX_ITEMS_INVALID', `Line ${index + 1} has no valid lineTotalCents`);
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new TaxError('TAX_ITEMS_INVALID', `Line ${index + 1} has no valid quantity`);
    }

    const n = (seen.get(productId) || 0) + 1;
    seen.set(productId, n);

    return {
      amount,
      quantity,
      reference: n === 1 ? productId : `${productId}#${n}`,
      tax_behavior: 'exclusive',
      tax_code: typeof item.taxCode === 'string' && item.taxCode.trim() ? item.taxCode.trim() : DEFAULT_TAX_CODE
    };
  });
}

/** Shrink one Stripe tax_breakdown entry to what we store and show. */
function mapBreakdownEntry(entry) {
  const rate = entry?.tax_rate_details || {};
  return {
    amountCents: Number.isInteger(entry?.amount) ? entry.amount : 0,
    taxableAmountCents: Number.isInteger(entry?.taxable_amount) ? entry.taxable_amount : 0,
    inclusive: entry?.inclusive === true,
    taxabilityReason: entry?.taxability_reason || null,
    ratePercent: typeof rate.percentage_decimal === 'string' ? rate.percentage_decimal : null,
    rateType: rate.rate_type || null,
    taxType: rate.tax_type || null,
    country: rate.country || null,
    state: rate.state || null
  };
}

/**
 * A short, queryable description of where and why tax was (or was not)
 * charged — the full breakdown sits next to it on the document.
 */
function summariseJurisdiction(breakdown, address, taxCents) {
  const charged = breakdown.filter(b => b.amountCents > 0 && !b.inclusive);
  const combinedRate = charged.reduce((sum, b) => sum + (parseFloat(b.ratePercent) || 0), 0);
  const unique = (values) => Array.from(new Set(values.filter(Boolean)));
  return {
    country: address.country,
    state: address.state,
    postalCode: address.postal_code,
    city: address.city,
    taxable: taxCents > 0,
    combinedRatePercent: charged.length ? Number(combinedRate.toFixed(4)) : 0,
    taxTypes: unique(breakdown.map(b => b.taxType)),
    reasons: unique(breakdown.map(b => b.taxabilityReason)),
    components: breakdown.length
  };
}

/**
 * Run a Stripe Tax calculation for server-priced items shipped to `address`.
 *
 * @param {{items: Array<{productId: string, lineTotalCents: number, quantity: number, taxCode?: string|null}>,
 *          address: {line1: string, line2?: string|null, city: string, state: string, postal_code: string, country: 'US'}}} input
 * @param {{stripe?: object}} [opts] Injectable Stripe client (tests).
 * @returns {Promise<{calculationId: string, subtotalCents: number, taxCents: number, totalCents: number,
 *   currency: string, breakdown: Array<object>, jurisdiction: object, expiresAt: string|null}>}
 * @throws {TaxError} TAX_ITEMS_INVALID | ADDRESS_* | TAX_CALCULATION_FAILED | TAX_CALCULATION_UNUSABLE
 */
async function calculateTax({ items, address } = {}, opts = {}) {
  const addr = normaliseAddress(address);
  if (!addr.ok) throw new TaxError(addr.code, addr.message);

  const lineItems = buildLineItems(items);
  const subtotalCents = lineItems.reduce((sum, li) => sum + li.amount, 0);
  const client = opts.stripe || getStripe();

  let calc;
  try {
    calc = await client.tax.calculations.create({
      currency: CURRENCY,
      line_items: lineItems,
      customer_details: {
        address: {
          line1: addr.address.line1,
          line2: addr.address.line2 || undefined,
          city: addr.address.city,
          state: addr.address.state,
          postal_code: addr.address.postal_code,
          country: addr.address.country
        },
        address_source: 'shipping'
      }
    });
  } catch (err) {
    throw new TaxError('TAX_CALCULATION_FAILED', `Stripe Tax calculation failed: ${err.message}`, {
      cause: err,
      stripeCode: err?.code || null
    });
  }

  // Never trust a shape we did not verify — this number becomes the charge.
  const taxCents = calc?.tax_amount_exclusive;
  const totalCents = calc?.amount_total;
  if (typeof calc?.id !== 'string' || !calc.id) {
    throw new TaxError('TAX_CALCULATION_UNUSABLE', 'Stripe Tax returned a calculation without an id');
  }
  if (calc.currency !== CURRENCY) {
    throw new TaxError('TAX_CALCULATION_UNUSABLE', `Stripe Tax returned currency ${calc.currency}, expected ${CURRENCY}`);
  }
  if (!Number.isInteger(taxCents) || taxCents < 0) {
    throw new TaxError('TAX_CALCULATION_UNUSABLE', 'Stripe Tax returned a non-integer tax amount');
  }
  if ((calc.tax_amount_inclusive || 0) !== 0) {
    throw new TaxError('TAX_CALCULATION_UNUSABLE', 'Stripe Tax reported inclusive tax on exclusive line items');
  }
  if (totalCents !== subtotalCents + taxCents) {
    throw new TaxError(
      'TAX_CALCULATION_UNUSABLE',
      `Stripe Tax total ${totalCents} does not equal subtotal ${subtotalCents} + tax ${taxCents}`
    );
  }

  const breakdown = Array.isArray(calc.tax_breakdown) ? calc.tax_breakdown.map(mapBreakdownEntry) : [];

  return {
    calculationId: calc.id,
    subtotalCents,
    taxCents,
    totalCents,
    currency: CURRENCY,
    breakdown,
    jurisdiction: summariseJurisdiction(breakdown, addr.address, taxCents),
    expiresAt: Number.isFinite(calc.expires_at) ? new Date(calc.expires_at * 1000).toISOString() : null,
    address: addr.address
  };
}

// ─── Transaction (post-payment) ──────────────────────────────────────────────

/**
 * Record the tax collected on a SUCCEEDED PaymentIntent with Stripe Tax so it
 * appears in tax reports and filings. Call from the payment_intent.succeeded
 * webhook.
 *
 * Idempotent three ways: (1) payment_intents/{id}.taxTransactionId short-circuits
 * a repeat call without touching Stripe; (2) the Stripe idempotency key replays
 * the original response for 24h; (3) Stripe rejects a second transaction with
 * the same `reference` (the PaymentIntent id), so a duplicate can never be
 * booked even if both guards are bypassed.
 *
 * @param {object} paymentIntent The Stripe PaymentIntent object (webhook payload).
 * @param {{stripe?: object, db?: object}} [opts]
 * @returns {Promise<string|null>} The tax transaction id, or null when the
 *   PaymentIntent carries no taxCalculationId (feature off, or created before
 *   tax existed) — nothing to record in that case.
 * @throws {TaxError} TAX_AMOUNT_MISMATCH | TAX_TRANSACTION_FAILED
 */
async function recordTaxTransaction(paymentIntent, opts = {}) {
  const id = typeof paymentIntent?.id === 'string' ? paymentIntent.id : '';
  if (!id) throw new TaxError('TAX_TRANSACTION_FAILED', 'recordTaxTransaction needs a PaymentIntent with an id');

  const calculationId = paymentIntent?.metadata?.taxCalculationId;
  if (typeof calculationId !== 'string' || !calculationId) return null;

  const db = opts.db || admin.firestore();
  const ref = db.collection('payment_intents').doc(id);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data()?.taxTransactionId : null;
  if (typeof existing === 'string' && existing) return existing;

  // The transaction must describe what was actually charged. Our own /tax route
  // is the only writer of both the amount and this metadata, so a mismatch
  // means something else changed the PaymentIntent — refuse rather than file
  // tax on a number the shopper did not pay.
  const expectedTotal = Number(paymentIntent?.metadata?.totalCents);
  if (Number.isInteger(expectedTotal) && Number.isInteger(paymentIntent.amount) && paymentIntent.amount !== expectedTotal) {
    throw new TaxError(
      'TAX_AMOUNT_MISMATCH',
      `PaymentIntent ${id} amount ${paymentIntent.amount} differs from taxed total ${expectedTotal}`
    );
  }

  const client = opts.stripe || getStripe();
  let transaction;
  try {
    transaction = await client.tax.transactions.createFromCalculation(
      {
        calculation: calculationId,
        reference: id,
        metadata: { paymentIntentId: id, source: 'kaayko-store' }
      },
      { idempotencyKey: `kaayko:tax-txn:${id}` }
    );
  } catch (err) {
    throw new TaxError('TAX_TRANSACTION_FAILED', `Stripe Tax transaction failed: ${err.message}`, {
      cause: err,
      stripeCode: err?.code || null
    });
  }

  if (typeof transaction?.id !== 'string' || !transaction.id) {
    throw new TaxError('TAX_TRANSACTION_FAILED', 'Stripe Tax returned a transaction without an id');
  }

  await ref.set({
    taxTransactionId: transaction.id,
    taxTransactionRecordedAt: admin.firestore.FieldValue.serverTimestamp(),
    taxStatus: 'recorded',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[checkout/tax] Recorded tax transaction ${transaction.id} for ${id}`);
  return transaction.id;
}

// ─── Route handler ───────────────────────────────────────────────────────────

/**
 * Stripe refuses an amount change once a PaymentIntent has been confirmed.
 * The documented code is payment_intent_unexpected_state; the message match is
 * a belt-and-braces for API versions that phrase it differently.
 */
function isAmountLockedError(err) {
  if (!err) return false;
  if (err.code === 'payment_intent_unexpected_state') return true;
  return /already (been )?(succeeded|confirmed|captured|canceled|cancelled)|status of (succeeded|canceled|processing|requires_capture)|cannot (be )?(update|modif)/i
    .test(String(err.message || ''));
}

function isPaymentCompleted(doc) {
  return doc?.paymentStatus === 'succeeded'
    || doc?.paymentStatus === 'refunded'
    || doc?.status === 'succeeded'
    || doc?.status === 'fulfilled';
}

function reject(res, status, code, message) {
  return res.status(status).json({ success: false, error: message, message, code });
}

/**
 * POST /api/createPaymentIntent/tax
 * @body {paymentIntentId, address: {name?, line1, line2?, city, state, postal_code, country}}
 * @returns {success, enabled, paymentIntentId, currency, subtotalCents, taxCents, totalCents, breakdown}
 *
 * Status codes the storefront must handle:
 *   400 INVALID_PAYMENT_INTENT_ID | INVALID_ADDRESS | ADDRESS_COUNTRY_NOT_SUPPORTED
 *   404 PAYMENT_INTENT_NOT_FOUND
 *   409 PAYMENT_ALREADY_COMPLETED (our record) | PAYMENT_ALREADY_CONFIRMED (Stripe refused the amount change)
 *   422 PAYMENT_INTENT_NOT_PRICED
 *   502 TAX_CALCULATION_FAILED | TAX_APPLY_FAILED  — tax is ON but could not be applied; do NOT confirm
 */
async function applyTaxHandler(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const paymentIntentId = typeof body.paymentIntentId === 'string' ? body.paymentIntentId.trim() : '';
    if (!PI_ID_RE.test(paymentIntentId)) {
      return reject(res, 400, 'INVALID_PAYMENT_INTENT_ID', 'paymentIntentId is required');
    }

    const addr = normaliseAddress(body.address);
    if (!addr.ok) return reject(res, 400, addr.code, addr.message);

    const db = admin.firestore();
    const ref = db.collection('payment_intents').doc(paymentIntentId);
    const snap = await ref.get();
    if (!snap.exists) {
      return reject(res, 404, 'PAYMENT_INTENT_NOT_FOUND', 'Unknown payment intent');
    }
    const doc = snap.data() || {};
    if (isPaymentCompleted(doc)) {
      return reject(res, 409, 'PAYMENT_ALREADY_COMPLETED', 'Payment already completed');
    }

    const items = Array.isArray(doc.items) ? doc.items : [];
    const itemsSubtotal = items.reduce((sum, i) => sum + (Number.isInteger(i?.lineTotalCents) ? i.lineTotalCents : 0), 0);
    const subtotalCents = Number.isInteger(doc.subtotalCents) ? doc.subtotalCents : itemsSubtotal;
    const currency = typeof doc.currency === 'string' ? doc.currency : CURRENCY;

    // ── Feature off: same behaviour as before tax existed, and NO Stripe call ──
    if (!isTaxEnabled()) {
      // If a calculation was applied earlier in this session (flag flipped
      // mid-checkout) the PaymentIntent still carries that amount; report what
      // will actually be charged rather than a subtotal the card will not see.
      const priorTax = doc.taxCalculationId && Number.isInteger(doc.taxCents) ? doc.taxCents : 0;
      await ref.set({
        shippingAddress: addr.address,
        shippingAddressSource: 'checkout_address',
        taxStatus: doc.taxCalculationId ? (doc.taxStatus || 'calculated') : 'disabled',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      return res.json({
        success: true,
        enabled: false,
        paymentIntentId,
        currency,
        subtotalCents,
        taxCents: priorTax,
        totalCents: subtotalCents + priorTax,
        breakdown: []
      });
    }

    if (items.length === 0) {
      return reject(res, 422, 'PAYMENT_INTENT_NOT_PRICED', 'This payment intent has no server-priced items');
    }
    if (itemsSubtotal !== subtotalCents) {
      console.warn(
        `[checkout/tax] payment_intents/${paymentIntentId} subtotalCents=${subtotalCents} but items sum to ${itemsSubtotal}; taxing the item sum`
      );
    }

    // ── Calculate ──────────────────────────────────────────────────────────
    let tax;
    try {
      tax = await calculateTax({ items, address: addr.address });
    } catch (err) {
      if (err instanceof TaxError && (err.code === 'INVALID_ADDRESS' || err.code === 'ADDRESS_COUNTRY_NOT_SUPPORTED')) {
        return reject(res, 400, err.code, err.message);
      }
      console.error(`[checkout/tax] Calculation failed for ${paymentIntentId} (${addr.address.state}): ${err.message}`);
      return reject(
        res, 502, 'TAX_CALCULATION_FAILED',
        'Sales tax could not be calculated for this address right now. Please try again in a moment.'
      );
    }

    // ── Apply to the PaymentIntent BEFORE telling the client ───────────────
    // Amount changes are only accepted before confirmation. If Stripe refuses,
    // the shopper has already paid (or is paying) the previous amount — 409 so
    // the storefront stops and does not show a total that will not be charged.
    try {
      await getStripe().paymentIntents.update(paymentIntentId, {
        amount: tax.totalCents,
        metadata: {
          taxCalculationId: tax.calculationId,
          subtotalCents: String(tax.subtotalCents),
          taxCents: String(tax.taxCents),
          totalCents: String(tax.totalCents),
          taxState: addr.address.state
        }
      });
    } catch (err) {
      if (isAmountLockedError(err)) {
        console.warn(`[checkout/tax] ${paymentIntentId} is already confirmed; amount not changed`);
        return reject(res, 409, 'PAYMENT_ALREADY_CONFIRMED', 'This payment has already been confirmed; the total can no longer change');
      }
      console.error(`[checkout/tax] Could not apply tax to ${paymentIntentId}: ${err.message}`);
      return reject(
        res, 502, 'TAX_APPLY_FAILED',
        'Sales tax could not be applied to this payment right now. Please try again in a moment.'
      );
    }

    // ── Record on our authoritative order document ─────────────────────────
    await ref.set({
      subtotalCents: tax.subtotalCents,
      taxCents: tax.taxCents,
      totalCents: tax.totalCents,
      totalAmount: tax.totalCents,
      totalAmountFormatted: `$${(tax.totalCents / 100).toFixed(2)}`,
      taxStatus: 'calculated',
      taxCalculationId: tax.calculationId,
      taxCalculationExpiresAt: tax.expiresAt,
      taxCalculatedAt: admin.firestore.FieldValue.serverTimestamp(),
      taxJurisdiction: tax.jurisdiction,
      taxBreakdown: tax.breakdown,
      shippingAddress: addr.address,
      shippingAddressSource: 'checkout_address',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(
      `[checkout/tax] ${paymentIntentId}: ${addr.address.state} tax ${tax.taxCents}c on ${tax.subtotalCents}c → total ${tax.totalCents}c (${tax.calculationId})`
    );

    return res.json({
      success: true,
      enabled: true,
      paymentIntentId,
      currency,
      subtotalCents: tax.subtotalCents,
      taxCents: tax.taxCents,
      totalCents: tax.totalCents,
      breakdown: tax.breakdown
    });
  } catch (error) {
    console.error('[checkout/tax] Route error:', error.message);
    return reject(res, 500, 'TAX_ROUTE_FAILED', 'Failed to calculate sales tax');
  }
}

/**
 * Reverse a filed tax transaction when money goes back to the buyer.
 *
 * Stripe Tax remits what has been *recorded*. A refund that does not reverse
 * its transaction leaves you having reported — and owing — tax on a sale that
 * no longer exists. A full refund files a `full` reversal; a partial one files
 * a `partial` reversal for the tax portion only, which is why the caller has
 * to say how many cents of tax came back.
 *
 * Idempotent twice over: it returns the stored reversal id if one exists, and
 * the reference it sends Stripe is derived from the payment intent and the
 * cumulative refunded amount, so a redelivered webhook reuses it.
 *
 * @returns {Promise<string|null>} reversal id, or null if there was no tax to reverse
 */
async function reverseTaxTransaction(paymentIntentId, { taxCents, full, refundedCents, db: dbOpt, stripe: stripeOpt } = {}) {
  const id = typeof paymentIntentId === 'string' ? paymentIntentId : '';
  if (!id) throw new TaxError('TAX_TRANSACTION_FAILED', 'reverseTaxTransaction needs a payment intent id');

  const db = dbOpt || admin.firestore();
  const ref = db.collection('payment_intents').doc(id);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : null;

  const transactionId = data?.taxTransactionId;
  if (typeof transactionId !== 'string' || !transactionId) return null;   // nothing was ever filed

  const key = full ? 'full' : `partial:${refundedCents}`;
  const already = data?.taxReversals && data.taxReversals[key];
  if (typeof already === 'string' && already) return already;

  const reference = `${id}-reversal-${full ? 'full' : refundedCents}`;
  const payload = full
    ? { original_transaction: transactionId, mode: 'full', reference }
    : {
        original_transaction: transactionId,
        mode: 'partial',
        reference,
        flat_amount: -Math.abs(Number(taxCents) || 0)
      };

  if (!full && !payload.flat_amount) return null;   // no tax came back — nothing to reverse

  let reversal;
  try {
    const client = stripeOpt || getStripe();
    reversal = await client.tax.transactions.createReversal(payload, {
      idempotencyKey: `kaayko:tax-rev:${reference}`
    });
  } catch (err) {
    throw new TaxError('TAX_REVERSAL_FAILED', `Stripe Tax reversal failed: ${err.message}`, {
      cause: err,
      stripeCode: err?.code || null
    });
  }

  await ref.set({
    taxReversals: { [key]: reversal.id },
    taxStatus: full ? 'reversed' : 'partially_reversed',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[checkout/tax] Reversed tax transaction ${transactionId} (${key}) for ${id}`);
  return reversal.id;
}

module.exports = {
  calculateTax,
  recordTaxTransaction,
  reverseTaxTransaction,
  applyTaxHandler,
  isTaxEnabled,
  normaliseAddress,
  buildLineItems,
  summariseJurisdiction,
  isAmountLockedError,
  TaxError,
  DEFAULT_TAX_CODE
};
