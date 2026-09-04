/**
 * Stripe Webhook Handler — Kaayko Store
 *
 * The ONLY writer of the `orders` collection. Responsibilities:
 *   1. Verify the Stripe signature (raw body — mounted with express.raw() in index.js).
 *   2. Read the authoritative, server-computed line items from
 *      `payment_intents/{paymentIntentId}` (written by createPaymentIntent.js).
 *      `metadata.items` is only a legacy fallback for in-flight payments.
 *   3. Write one `orders` document per line item, keyed `{pi}_item{n}` (idempotent).
 *   4. Queue the customer + admin emails EXACTLY once per payment intent.
 *   5. Fail loudly (5xx) on transient errors so Stripe retries; return 2xx for
 *      events we intentionally ignore and for permanent, non-retryable errors.
 *   6. Keep Firestore honest after the money moves back: `charge.refunded`
 *      (full or partial) and `charge.dispute.created/closed` update the
 *      payment intent and every line item, append statusHistory and alert the
 *      owner — otherwise a refunded or charged-back order keeps claiming to
 *      be paid. The Stripe endpoint must subscribe to those events.
 *
 * REVENUE MODEL (important): each `orders` doc carries only its OWN money
 * (`unitPriceCents`, `quantity`, `lineTotalCents`). The order-level total lives
 * exactly once, on `payment_intents/{pi}`. Summing `lineTotalCents` across the
 * `orders` collection therefore yields correct revenue.
 */

const admin = require('firebase-admin');
const { renderTemplate, escapeHtml, renderEmail, formatMoney, queueMailOnce } = require('../email/render');
const { resolveNotifyEmail } = require('../email/notifyAddress');
const { recordTaxTransaction, reverseTaxTransaction } = require('./tax');

// ─── Stripe client ─────────────────────────────────────────────
// Firebase secrets are delivered with trailing newlines, so every read of a
// secret must be trimmed (same rule as createPaymentIntent.js). There is no
// dotenv fallback here on purpose: the old one pointed at a non-existent
// ../../.env.local and silently masked the real "secret is unset" failure.
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

/**
 * An error that will never succeed on retry (malformed payload, no items
 * anywhere). We acknowledge these with 2xx so Stripe stops redelivering, and
 * record them in `webhook_failures` for manual triage.
 */
class PermanentWebhookError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentWebhookError';
  }
}

// ─── Entry point ───────────────────────────────────────────────

/**
 * Handle Stripe webhooks
 * @route POST /api/createPaymentIntent/webhook
 */
async function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!webhookSecret) {
    // Config error, not a payload error — 500 so Stripe retries once the
    // secret is wired up, and so the failure is visible in the dashboard.
    console.error('❌ STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  // Signature verification needs the EXACT bytes Stripe signed. Firebase
  // Functions parses the request body before our Express app ever sees it and
  // hands the original bytes back on `req.rawBody`, so by the time
  // express.raw() would run, req.body is already a parsed object and
  // constructEvent fails with "Payload was provided as a parsed JavaScript
  // object instead". Prefer rawBody; fall back to the Buffer express.raw()
  // gives us when running outside Firebase (tests, emulator).
  const payload = Buffer.isBuffer(req.rawBody) ? req.rawBody
                : Buffer.isBuffer(req.body)    ? req.body
                : typeof req.body === 'string' ? req.body
                : null;

  if (!payload) {
    console.error('❌ Webhook body is not raw — cannot verify signature');
    return res.status(400).send('Webhook Error: raw body unavailable');
  }

  let event;
  try {
    const stripeClient = getStripe();
    event = stripeClient.webhooks.constructEvent(payload, sig, webhookSecret);
  } catch (err) {
    console.error('⚠️  Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const result = await handlePaymentSuccess(event.data.object, event);
        return res.json({ received: true, ...result });
      }

      case 'payment_intent.payment_failed': {
        const result = await handlePaymentFailure(event.data.object, event);
        return res.json({ received: true, ...result });
      }

      case 'charge.refunded': {
        const result = await handleChargeRefunded(event.data.object, event);
        return res.json({ received: true, ...result });
      }

      case 'charge.dispute.created': {
        const result = await handleDisputeCreated(event.data.object, event);
        return res.json({ received: true, ...result });
      }

      case 'charge.dispute.closed': {
        const result = await handleDisputeClosed(event.data.object, event);
        return res.json({ received: true, ...result });
      }

      default:
        // Not a failure — acknowledge so Stripe stops sending it.
        console.log(`ℹ️  Unhandled event type: ${event.type}`);
        return res.json({ received: true, ignored: true });
    }
  } catch (error) {
    if (error instanceof PermanentWebhookError) {
      console.error(`❌ Permanent webhook failure (${event.id}): ${error.message}`);
      await recordWebhookFailure(event, error).catch(() => {});
      // A payment that Stripe took but we could not turn into an order is the
      // single worst state in the system — the buyer has been charged and
      // nobody knows to ship anything. Tell the owner, once per event.
      await notifyWebhookFailure(event, error).catch((e) =>
        console.error('Could not queue webhook-failure notification:', e.message)
      );
      // 2xx: retrying will never help, and an infinitely retried event is worse
      // than one flagged in webhook_failures.
      return res.json({ received: true, ignored: true, reason: error.message });
    }

    // Transient (Firestore unavailable, network, etc.) — 5xx so Stripe retries
    // and the paid order is not silently lost.
    console.error(`❌ Retryable webhook failure (${event.id}):`, error);
    return res.status(500).json({ received: false, error: 'Webhook processing failed' });
  }
}

// ─── Idempotency ───────────────────────────────────────────────

/**
 * Stripe retries and can also deliver the same payment through more than one
 * event id. Order documents are keyed by payment-intent id so their writes are
 * naturally idempotent, but the `mail` collection is append-only.
 *
 * Chosen guard: DETERMINISTIC MAIL DOCUMENT IDS (`{pi}_customer` / `{pi}_admin`)
 * with an existence check before writing, rather than a processed-event marker.
 * Rationale: the marker is keyed by event id, so a genuinely different event id
 * describing the same payment intent (a redelivery after a Stripe-side replay,
 * or a manual re-fire) would still double-send. Keying the mail document by the
 * payment intent makes "one confirmation per order" true by construction, and
 * it needs no extra collection on the write path. A `stripe_events/{id}` marker
 * is ALSO recorded, but only as a fast-path skip and audit trail.
 *
 * The implementation is `queueMailOnce` in ../email/render.js — shared with the
 * shipping-confirmation email sent from admin/updateOrderStatus.js so that both
 * writers obey the same rule.
 */
async function markEventProcessed(db, event, extra = {}) {
  if (!event?.id) return;
  await db.collection('stripe_events').doc(event.id).set({
    eventId: event.id,
    type: event.type,
    objectId: event.data?.object?.id || null,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...extra
  });
}

async function isEventProcessed(db, event) {
  if (!event?.id) return false;
  const snap = await db.collection('stripe_events').doc(event.id).get();
  return snap.exists;
}

async function recordWebhookFailure(event, error) {
  const db = admin.firestore();
  await db.collection('webhook_failures').doc(event.id).set({
    eventId: event.id,
    type: event.type,
    objectId: event.data?.object?.id || null,
    error: error.message,
    permanent: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// ─── Item resolution ───────────────────────────────────────────

function toCents(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const cleaned = String(value).replace(/[$,\s]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/**
 * Normalise one line item into the canonical shape used by orders + emails.
 * Accepts the authoritative server-computed shape
 * ({ unitPriceCents, lineTotalCents, quantity }) and the older
 * ({ price, priceInCents }) shape from legacy metadata.
 */
function normalizeItem(raw) {
  const quantityRaw = Number(raw?.quantity);
  const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.round(quantityRaw) : 1;

  const unitPriceCents =
    toCents(raw?.unitPriceCents) ??
    toCents(raw?.priceInCents) ??
    toCents(raw?.price) ??
    0;

  const lineTotalCents = toCents(raw?.lineTotalCents) ?? unitPriceCents * quantity;

  return {
    productId: raw?.productId || null,
    productTitle: raw?.productTitle || 'Kaayko Product',
    size: raw?.size || null,
    gender: raw?.gender || null,
    quantity,
    unitPriceCents,
    lineTotalCents
  };
}

/**
 * Source of truth = payment_intents/{id}.items (server-computed).
 * Legacy fallback = paymentIntent.metadata.items (in-flight payments only).
 */
async function resolveOrderContext(db, paymentIntent) {
  const piSnap = await db.collection('payment_intents').doc(paymentIntent.id).get();
  const piDoc = piSnap.exists ? piSnap.data() : null;

  let rawItems = null;
  let source = 'firestore';

  if (piDoc && Array.isArray(piDoc.items) && piDoc.items.length > 0) {
    rawItems = piDoc.items;
  } else {
    source = 'legacy_metadata';
    console.warn(
      `⚠️  LEGACY PATH: payment_intents/${paymentIntent.id} has no items[]; ` +
      `falling back to Stripe metadata.items for this in-flight payment.`
    );
    try {
      const parsed = JSON.parse(paymentIntent.metadata?.items || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) rawItems = parsed;
    } catch (e) {
      console.error('Failed to parse legacy metadata.items:', e.message);
    }

    // Very old single-item metadata format.
    if (!rawItems && paymentIntent.metadata?.productId) {
      rawItems = [{
        productId: paymentIntent.metadata.productId,
        productTitle: paymentIntent.metadata.productTitle,
        size: paymentIntent.metadata.size,
        gender: paymentIntent.metadata.gender,
        price: paymentIntent.metadata.price
      }];
    }
  }

  if (!rawItems || rawItems.length === 0) {
    throw new PermanentWebhookError(
      `No line items found for ${paymentIntent.id} in payment_intents or metadata`
    );
  }

  const items = rawItems.map(normalizeItem);
  const summedLines = items.reduce((sum, i) => sum + i.lineTotalCents, 0);

  const subtotalCents = toCents(piDoc?.subtotalCents) ?? summedLines;
  const totalCents =
    toCents(piDoc?.totalCents) ??
    toCents(piDoc?.totalAmount) ??
    toCents(paymentIntent.amount) ??
    summedLines;

  return {
    items,
    source,
    subtotalCents,
    totalCents,
    currency: piDoc?.currency || paymentIntent.currency || 'usd',
    piDoc
  };
}

/**
 * Customer email: the frontend passes receipt_email through Stripe's
 * confirmParams, so prefer it — but fall back through the charge / billing
 * details and finally the stored payment intent document.
 */
function resolveCustomerEmail(paymentIntent, piDoc) {
  const latestCharge = paymentIntent.latest_charge;
  return (
    paymentIntent.receipt_email ||
    (typeof latestCharge === 'object' ? latestCharge?.billing_details?.email : null) ||
    (typeof latestCharge === 'object' ? latestCharge?.receipt_email : null) ||
    paymentIntent.charges?.data?.[0]?.billing_details?.email ||
    paymentIntent.charges?.data?.[0]?.receipt_email ||
    paymentIntent.customer_details?.email ||
    piDoc?.customerEmail ||
    paymentIntent.metadata?.customerEmail ||
    null
  );
}

/**
 * WHERE THE SHIPPING ADDRESS ACTUALLY LIVES
 * -----------------------------------------
 * The storefront mounts a Stripe Address Element in `mode: 'shipping'` in the
 * same Elements group as the Payment Element (kaayko/src/cart.html), so Stripe
 * attaches the collected address at confirm time. On the API versions this
 * account can be pinned to, that address is readable in more than one place and
 * the old code read exactly one of them (`paymentIntent.shipping`) — if the
 * webhook endpoint's API version does not populate it, every order document was
 * written with `shippingAddress: null` and the owner could not ship.
 *
 * So: try every known location, in order of directness, and record which one
 * won (`shippingSource`) so a future API-version change is visible in the data
 * rather than silent. As a last resort re-read the PaymentIntent from Stripe
 * with `latest_charge` expanded — the webhook payload embeds `latest_charge` as
 * a bare id string, and a Charge always carries the shipping details.
 */
function pickAddress(source) {
  const address = source?.address;
  if (!address) return null;
  // A country-only stub (what Stripe sends for a billing address that was never
  // filled in) is not an address anyone can ship to.
  if (!address.line1 && !address.postal_code) return null;
  return {
    name: source.name || null,
    line1: address.line1 || null,
    line2: address.line2 || null,
    city: address.city || null,
    state: address.state || null,
    postal_code: address.postal_code || null,
    country: address.country || null
  };
}

function resolveShippingFromObject(paymentIntent, piDoc) {
  const latestCharge = typeof paymentIntent?.latest_charge === 'object' ? paymentIntent.latest_charge : null;
  const candidates = [
    ['payment_intent.shipping', paymentIntent?.shipping],
    // 2025+ API versions surface Element-collected details here.
    ['payment_intent.collected_information', paymentIntent?.collected_information?.shipping_details],
    ['latest_charge.shipping', latestCharge?.shipping],
    ['charges.data[0].shipping', paymentIntent?.charges?.data?.[0]?.shipping],
    ['payment_intents_doc', piDoc?.shippingAddress ? { name: piDoc.shippingAddress.name, address: piDoc.shippingAddress, phone: piDoc.customerPhone } : null]
  ];

  for (const [source, candidate] of candidates) {
    const address = pickAddress(candidate);
    if (address) return { address, phone: candidate.phone || null, source };
  }
  return null;
}

/**
 * Last resort: ask Stripe directly with the charge expanded. Never throws —
 * a missing address must not fail an otherwise-good payment webhook.
 */
async function resolveShipping(paymentIntent, piDoc) {
  const direct = resolveShippingFromObject(paymentIntent, piDoc);
  if (direct) return direct;

  try {
    const stripeClient = getStripe();
    if (typeof stripeClient?.paymentIntents?.retrieve !== 'function') return null;
    const fresh = await stripeClient.paymentIntents.retrieve(paymentIntent.id, {
      expand: ['latest_charge']
    });
    const refetched = resolveShippingFromObject(fresh, piDoc);
    if (refetched) return { ...refetched, source: `refetch:${refetched.source}` };
  } catch (err) {
    console.warn(`⚠️  Could not re-read ${paymentIntent.id} from Stripe for a shipping address: ${err.message}`);
  }

  console.error(
    `❌ NO SHIPPING ADDRESS for ${paymentIntent.id} — this order cannot be fulfilled ` +
    `without opening it in the Stripe dashboard.`
  );
  return null;
}

// ─── Success handler ───────────────────────────────────────────

async function handlePaymentSuccess(paymentIntent, event) {
  const db = admin.firestore();

  if (await isEventProcessed(db, event)) {
    console.log(`↩️  Event ${event.id} already processed — acknowledging duplicate`);
    return { duplicate: true };
  }

  const ctx = await resolveOrderContext(db, paymentIntent);
  const nowIso = new Date().toISOString();
  const customerEmail = resolveCustomerEmail(paymentIntent, ctx.piDoc);
  const shipping = await resolveShipping(paymentIntent, ctx.piDoc);
  // Stored now so a later refund or dispute (which arrive as Charge objects)
  // can be matched to this order without a Stripe lookup.
  const chargeId = resolveChargeId(paymentIntent);

  // 1. Update the payment intent record (order-level money lives HERE, once).
  //    set(merge) rather than update() so a missing doc does not throw NOT_FOUND.
  await db.collection('payment_intents').doc(paymentIntent.id).set({
    paymentIntentId: paymentIntent.id,
    chargeId,
    status: 'succeeded',
    paymentStatus: 'succeeded',
    fulfillmentStatus: 'processing',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
    amount: paymentIntent.amount,
    subtotalCents: ctx.subtotalCents,
    totalCents: ctx.totalCents,
    currency: ctx.currency,
    itemCount: ctx.items.length,
    customerEmail: customerEmail,
    customerPhone: shipping?.phone || ctx.piDoc?.customerPhone || null,
    shippingAddress: shipping?.address || null,
    shippingSource: shipping?.source || null,
    // Surfaced so the owner can query "orders I cannot ship" directly.
    shippingAddressMissing: !shipping,
    itemsSource: ctx.source,
    statusHistory: admin.firestore.FieldValue.arrayUnion({
      status: 'succeeded',
      timestamp: nowIso,
      note: 'Payment successful'
    })
  }, { merge: true });

  // 2. Fields shared by every line item. NOTE: no order-level total here —
  //    that would double-count revenue across the collection.
  const sharedFields = {
    parentOrderId: paymentIntent.id,
    chargeId,
    currency: ctx.currency,

    orderStatus: 'pending',          // pending → processing → shipped → delivered → returned
    fulfillmentStatus: 'processing', // processing → ready_to_ship → shipped → delivered
    paymentStatus: 'paid',           // paid → refunded | partially_refunded | disputed | dispute_lost
    refundedCents: 0,                // per-item share of any later refund (see allocateRefund)
    refundedAt: null,

    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
    processedAt: null,
    shippedAt: null,
    deliveredAt: null,
    returnedAt: null,

    trackingNumber: null,
    carrier: null,
    trackingUrl: null,
    estimatedDelivery: null,

    customerEmail: customerEmail,
    customerPhone: shipping?.phone || ctx.piDoc?.customerPhone || null,

    // See resolveShipping() — read from every place Stripe puts it, not just
    // paymentIntent.shipping.
    shippingAddress: shipping?.address || null,
    shippingSource: shipping?.source || null,
    shippingAddressMissing: !shipping,

    dataRetentionConsent:
      ctx.piDoc?.dataRetentionConsent === true ||
      paymentIntent.metadata?.dataRetentionConsent === 'true',

    paymentMethod: paymentIntent.payment_method_types?.[0] || 'unknown',

    statusHistory: [
      { status: 'paid', timestamp: nowIso, note: 'Payment successful' },
      { status: 'processing', timestamp: nowIso, note: 'Order processing started' }
    ],

    internalNotes: [],
    customerNotes: null
  };

  // 3. One document per line item, deterministically keyed → idempotent writes.
  const batch = db.batch();
  ctx.items.forEach((item, index) => {
    const orderId = `${paymentIntent.id}_item${index + 1}`;
    batch.set(db.collection('orders').doc(orderId), {
      ...sharedFields,
      orderId,
      itemIndex: index + 1,
      totalItems: ctx.items.length,

      productId: item.productId,
      productTitle: item.productTitle,
      size: item.size,
      gender: item.gender,

      // Per-item money ONLY — safe to SUM(lineTotalCents) for revenue.
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.lineTotalCents
    });
  });
  await batch.commit();
  console.log(`✅ Wrote ${ctx.items.length} order documents for ${paymentIntent.id} (items from ${ctx.source})`);

  // 4. File the tax transaction with Stripe. Stripe Tax only remits what has
  //    been *recorded*; a calculation alone is not a filing. Deliberately
  //    before the emails and outside their try/catch: if this throws we want
  //    Stripe to redeliver the event rather than quietly under-report tax.
  let taxTransactionId = null;
  try {
    taxTransactionId = await recordTaxTransaction(paymentIntent);
    if (taxTransactionId) console.log(`🧾 Tax transaction ${taxTransactionId} filed for ${paymentIntent.id}`);
  } catch (err) {
    if (err && err.code === 'TAX_AMOUNT_MISMATCH') {
      // The charged amount does not match what tax was calculated on. Filing
      // it would be wrong; redelivering would not help. Record and alert.
      console.error(`❌ Tax amount mismatch on ${paymentIntent.id} — not filed:`, err.message);
      await db.collection('payment_intents').doc(paymentIntent.id)
        .set({ taxStatus: 'mismatch', taxError: err.message }, { merge: true });
      await notifyOwner(db, `${paymentIntent.id}_tax_mismatch`, {
        subject: '🧾 Sales tax NOT filed - Kaayko Store',
        alertTitle: '🧾 An order was charged but its tax was not filed',
        alertText: 'The amount charged does not match the amount sales tax was calculated on, so the tax transaction was not filed with Stripe. The order itself is fine and shippable. File or correct this one by hand in the Stripe dashboard before your next return.',
        rows: [
          { label: 'Payment Intent', value: paymentIntent.id },
          { label: 'Charged', value: formatMoney(paymentIntent.amount, paymentIntent.currency || 'usd') },
          { label: 'Detail', value: err.message }
        ],
        stripeUrl: `https://dashboard.stripe.com/payments/${paymentIntent.id}`,
        stripeLabel: 'Open the payment in Stripe'
      }, paymentIntent).catch(() => {});
    } else {
      throw err;   // transient — let Stripe retry the whole event
    }
  }

  // 5. Emails — exactly once per payment intent.
  const emailsSent = await sendOrderConfirmationEmails(db, paymentIntent, ctx, customerEmail, shipping);

  await markEventProcessed(db, event, { paymentIntentId: paymentIntent.id, itemCount: ctx.items.length });

  console.log(`✅ Order processed successfully: ${paymentIntent.id}`);
  return { orders: ctx.items.length, emailsSent };
}

// ─── Failure handler ───────────────────────────────────────────

async function handlePaymentFailure(paymentIntent, event) {
  const db = admin.firestore();

  if (await isEventProcessed(db, event)) {
    console.log(`↩️  Event ${event.id} already processed — acknowledging duplicate`);
    return { duplicate: true };
  }

  const nowIso = new Date().toISOString();
  await db.collection('payment_intents').doc(paymentIntent.id).set({
    paymentIntentId: paymentIntent.id,
    status: 'failed',
    paymentStatus: 'failed',
    fulfillmentStatus: 'cancelled',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    failedAt: admin.firestore.FieldValue.serverTimestamp(),
    cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    statusHistory: admin.firestore.FieldValue.arrayUnion({
      status: 'failed',
      timestamp: nowIso,
      note: 'Payment failed'
    }),
    errorMessage: paymentIntent.last_payment_error?.message || 'Unknown error'
  }, { merge: true });

  // The owner asked to be told when a payment fails, not only when one lands:
  // a run of declines is the difference between "quiet week" and "checkout is
  // broken". One email per payment intent, same idempotency rule as the
  // confirmation mail.
  const notified = await notifyOwner(db, `${paymentIntent.id}_failed`, {
    subject: '⚠️ Payment Failed - Kaayko Store',
    alertTitle: '⚠️ A payment did not go through',
    alertText: 'A shopper reached checkout and the card was declined or the payment was abandoned. No order was created and nothing needs shipping — this is here so a broken checkout cannot look like a quiet week.',
    rows: [
      { label: 'Payment Intent', value: paymentIntent.id },
      { label: 'Amount', value: formatMoney(paymentIntent.amount, paymentIntent.currency || 'usd') },
      { label: 'Customer Email', value: resolveCustomerEmail(paymentIntent, null) || 'Not provided' },
      { label: 'Reason', value: paymentIntent.last_payment_error?.message || 'Unknown error' },
      { label: 'Decline Code', value: paymentIntent.last_payment_error?.decline_code || '—' },
      { label: 'When', value: formatTimestamp() }
    ],
    stripeUrl: `https://dashboard.stripe.com/test/payments/${paymentIntent.id}`,
    stripeLabel: 'View in Stripe Dashboard →'
  }, paymentIntent);

  await markEventProcessed(db, event, { paymentIntentId: paymentIntent.id });

  console.log(`⚠️  Payment failed for: ${paymentIntent.id}`);
  return { failed: true, ownerNotified: notified };
}

// ─── Refunds & disputes ────────────────────────────────────────

function idOf(value) {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

/** The charge behind a PaymentIntent: expanded object, bare id, or the legacy charges list. */
function resolveChargeId(paymentIntent) {
  return idOf(paymentIntent?.latest_charge) || idOf(paymentIntent?.charges?.data?.[0]) || null;
}

function unixToIso(seconds, fallback = new Date()) {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : fallback.toISOString();
}

function dashboardUrl(event, path) {
  return `https://dashboard.stripe.com/${event?.livemode ? '' : 'test/'}${path}`;
}

function hasShipped(status) {
  return ['shipped', 'delivered', 'returned'].includes(status);
}

/**
 * A Charge or Dispute names its PaymentIntent directly (`payment_intent`).
 * When it does not (very old charges), the `chargeId` stored on
 * payment_intents at payment_intent.succeeded time avoids a Stripe round-trip;
 * asking Stripe for the charge is the last resort.
 */
async function resolvePaymentIntentId(db, object) {
  const direct = idOf(object?.payment_intent);
  if (direct) return direct;

  const chargeId = object?.object === 'charge' ? idOf(object) : idOf(object?.charge);
  if (chargeId) {
    const snap = await db.collection('payment_intents').where('chargeId', '==', chargeId).limit(1).get();
    if (!snap.empty) return snap.docs[0].id;

    try {
      const stripeClient = getStripe();
      if (typeof stripeClient?.charges?.retrieve === 'function') {
        const charge = await stripeClient.charges.retrieve(chargeId);
        const fromStripe = idOf(charge?.payment_intent);
        if (fromStripe) return fromStripe;
      }
    } catch (err) {
      console.warn(`⚠️  Could not read charge ${chargeId} from Stripe: ${err.message}`);
    }
  }

  throw new PermanentWebhookError(
    `Cannot resolve a payment intent for ${object?.object || 'object'} ${object?.id || '?'}`
  );
}

async function loadOrderItems(db, paymentIntentId) {
  const snap = await db.collection('orders').where('parentOrderId', '==', paymentIntentId).get();
  return snap.docs
    .map(d => ({ id: d.id, ref: d.ref, data: d.data() }))
    .sort((a, b) => (a.data.itemIndex || 0) - (b.data.itemIndex || 0));
}

/**
 * Stripe refunds carry no line items, so per-item `refundedCents` is a
 * pro-rata share of the order-level refund (largest-remainder rounding, each
 * item capped at its own line total). The authoritative figure is
 * payment_intents.refundedCents; the per-item split exists so that
 * SUM(lineTotalCents − refundedCents) over `orders` is still net revenue.
 */
function allocateRefund(lineTotals, refundedCents) {
  const lines = lineTotals.map(v => Math.max(0, toCents(v) ?? 0));
  const sum = lines.reduce((a, b) => a + b, 0);
  if (sum <= 0 || refundedCents <= 0) return lines.map(() => 0);
  if (refundedCents >= sum) return lines;

  const shares = lines.map(l => Math.floor((refundedCents * l) / sum));
  let remainder = refundedCents - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; remainder > 0 && i < shares.length; i++) {
    const add = Math.min(lines[i] - shares[i], remainder);
    shares[i] += add;
    remainder -= add;
  }
  return shares;
}

/**
 * Apply one order-level patch, one per-item patch and the same statusHistory
 * entry to the payment intent and every line item of an order. The history
 * entry's timestamp comes from Stripe, so a redelivery under a new event id
 * unions to the same entry instead of appending a twin.
 */
async function applyOrderPatch(db, paymentIntentId, { items, piPatch, itemPatch, historyEntry }) {
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.collection('payment_intents').doc(paymentIntentId).set({
    paymentIntentId,
    ...piPatch,
    updatedAt: now,
    statusHistory: admin.firestore.FieldValue.arrayUnion(historyEntry)
  }, { merge: true });

  if (items.length) {
    const batch = db.batch();
    items.forEach((item, index) => {
      const patch = typeof itemPatch === 'function' ? itemPatch(item, index) : itemPatch;
      batch.update(item.ref, {
        ...patch,
        updatedAt: now,
        statusHistory: admin.firestore.FieldValue.arrayUnion(historyEntry)
      });
    });
    await batch.commit();
  }
}

/**
 * charge.refunded — fires for every refund, full or partial, with the
 * CUMULATIVE `amount_refunded`. Marks the order (and cancels fulfilment of a
 * fully refunded order that has not shipped), then tells the owner once per
 * distinct refunded amount.
 */
async function handleChargeRefunded(charge, event) {
  const db = admin.firestore();

  if (await isEventProcessed(db, event)) {
    console.log(`↩️  Event ${event.id} already processed — acknowledging duplicate`);
    return { duplicate: true };
  }

  const paymentIntentId = await resolvePaymentIntentId(db, charge);
  const piSnap = await db.collection('payment_intents').doc(paymentIntentId).get();
  if (!piSnap.exists) {
    // The Stripe account also takes Kortex subscription payments; their
    // refunds reach this endpoint too and are not store orders.
    console.log(`ℹ️  charge.refunded for ${paymentIntentId} is not a store order — ignoring`);
    await markEventProcessed(db, event, { paymentIntentId, ignored: true });
    return { ignored: true, reason: 'not_a_store_payment' };
  }
  const piDoc = piSnap.data();

  const currency = charge.currency || piDoc.currency || 'usd';
  const amountCents = toCents(charge.amount) ?? toCents(piDoc.totalCents) ?? 0;
  const refundedCents = toCents(charge.amount_refunded) ?? 0;
  const full = charge.refunded === true || (amountCents > 0 && refundedCents >= amountCents);
  const paymentStatus = full ? 'refunded' : 'partially_refunded';
  // Since API version 2022-11-15 Stripe no longer expands `refunds` on the
  // Charge by default, so the list may be absent: the cumulative
  // `amount_refunded` is still authoritative and the event time stands in for
  // the refund time. Refund-level details are recorded only when present.
  const refundsExpanded = Array.isArray(charge.refunds?.data);
  const refunds = refundsExpanded ? charge.refunds.data : [];
  const latest = refunds[0] || null; // Stripe lists newest first
  const reason = latest?.reason || null;
  const refundedAtIso = unixToIso(latest?.created ?? event.created);

  const historyEntry = {
    status: paymentStatus,
    timestamp: refundedAtIso,
    note: `${full ? 'Full' : 'Partial'} refund: ${formatMoney(refundedCents, currency)} of ` +
          `${formatMoney(amountCents, currency)}${reason ? ` (${reason})` : ''}`
  };

  const items = await loadOrderItems(db, paymentIntentId);
  const shares = allocateRefund(items.map(i => i.data.lineTotalCents), refundedCents);
  const cancelFulfilment = full && !hasShipped(piDoc.fulfillmentStatus);

  await applyOrderPatch(db, paymentIntentId, {
    items,
    historyEntry,
    piPatch: {
      chargeId: charge.id || piDoc.chargeId || null,
      paymentStatus,
      refundedCents,
      refundedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(refundsExpanded && { refundCount: refunds.length }),
      ...(latest && { lastRefundId: latest.id || null, refundReason: reason }),
      // A fully refunded order that has not left the building must not ship.
      ...(cancelFulfilment && {
        fulfillmentStatus: 'cancelled',
        cancelledAt: admin.firestore.FieldValue.serverTimestamp()
      })
    },
    itemPatch: (item, index) => ({
      chargeId: charge.id || item.data.chargeId || null,
      paymentStatus,
      refundedCents: shares[index],
      refundedAt: refundedAtIso,
      ...(full && !hasShipped(item.data.orderStatus) && {
        orderStatus: 'cancelled',
        fulfillmentStatus: 'cancelled',
        cancelledAt: refundedAtIso
      })
    })
  });

  // Money going back has to go back in the tax ledger too. Stripe Tax remits
  // what was recorded, so a refund without a reversal leaves the shop owing
  // tax on a sale that no longer exists. Never fail the webhook over it — the
  // refund itself already happened at Stripe — but make the gap loud.
  try {
    const taxCents = Number(piDoc.taxCents) || 0;
    if (taxCents > 0) {
      const subtotal = Number(piDoc.subtotalCents) || 0;
      const total = Number(piDoc.totalCents) || (subtotal + taxCents);
      // Refunds carry no line items, so split the refund the same way the
      // order was: the tax share of what came back.
      const taxBack = full
        ? taxCents
        : (total > 0 ? Math.round(refundedCents * (taxCents / total)) : 0);
      const reversalId = await reverseTaxTransaction(paymentIntentId, {
        taxCents: taxBack, full, refundedCents
      });
      if (reversalId) console.log(`🧾 Tax reversal ${reversalId} filed for ${paymentIntentId}`);
    }
  } catch (err) {
    console.error(`❌ Tax reversal failed for ${paymentIntentId}:`, err.message);
    await db.collection('payment_intents').doc(paymentIntentId)
      .set({ taxStatus: 'reversal_failed', taxError: err.message }, { merge: true })
      .catch(() => {});
    await notifyOwner(db, `${paymentIntentId}_tax_reversal_failed_${refundedCents}`, {
      subject: '🧾 Sales tax NOT reversed - Kaayko Store',
      alertTitle: '🧾 A refund went out but its sales tax was not reversed',
      alertText: 'The buyer has their money back. The tax on that sale is still recorded with Stripe Tax, so unless it is reversed by hand you will remit tax you no longer owe. Reverse this transaction in the Stripe dashboard before your next filing.',
      rows: [
        { label: 'Payment Intent', value: paymentIntentId },
        { label: 'Refunded', value: formatMoney(refundedCents, charge.currency || 'usd') },
        { label: 'Detail', value: err.message }
      ],
      stripeUrl: `https://dashboard.stripe.com/payments/${paymentIntentId}`,
      stripeLabel: 'Open the payment in Stripe'
    }, { id: paymentIntentId }).catch(() => {});
  }

  const notified = await notifyOwner(db, `${paymentIntentId}_refund_${refundedCents}`, {
    subject: full ? '↩️ Order refunded - Kaayko Store' : '↩️ Partial refund - Kaayko Store',
    alertTitle: full ? '↩️ An order was refunded in full' : '↩️ An order was partially refunded',
    alertText: full
      ? (cancelFulfilment
        ? 'Stripe reports this charge fully refunded. The order is marked refunded and its unshipped items are cancelled — do not ship it.'
        : 'Stripe reports this charge fully refunded. The order had already shipped, so it is marked refunded but not cancelled; mark it returned when the goods come back.')
      : 'Stripe reports a partial refund on this charge. The order stays open; the refunded amount is recorded on the order record.',
    rows: [
      { label: 'Order', value: paymentIntentId },
      { label: 'Charge', value: charge.id || '—' },
      { label: 'Refunded', value: `${formatMoney(refundedCents, currency)} of ${formatMoney(amountCents, currency)}` },
      { label: 'Reason', value: reason || '—' },
      { label: 'Customer Email', value: piDoc.customerEmail || '—' },
      { label: 'When', value: formatTimestamp(new Date(refundedAtIso)) }
    ],
    stripeUrl: dashboardUrl(event, `payments/${paymentIntentId}`),
    stripeLabel: 'View in Stripe Dashboard →'
  }, { id: paymentIntentId, metadata: charge.metadata || {} });

  await markEventProcessed(db, event, { paymentIntentId, paymentStatus, refundedCents });

  console.log(`↩️  ${full ? 'Full' : 'Partial'} refund recorded for ${paymentIntentId}: ${refundedCents} cents`);
  return { refunded: true, paymentIntentId, paymentStatus, refundedCents, items: items.length, ownerNotified: notified };
}

/**
 * charge.dispute.created — a chargeback. The funds are already withheld;
 * what the owner needs is the deadline and a warning not to ship.
 */
async function handleDisputeCreated(dispute, event) {
  const db = admin.firestore();

  if (await isEventProcessed(db, event)) {
    console.log(`↩️  Event ${event.id} already processed — acknowledging duplicate`);
    return { duplicate: true };
  }

  const paymentIntentId = await resolvePaymentIntentId(db, dispute);
  const piSnap = await db.collection('payment_intents').doc(paymentIntentId).get();
  const piDoc = piSnap.exists ? piSnap.data() : null;

  const currency = dispute.currency || piDoc?.currency || 'usd';
  const reason = dispute.reason || 'unknown';
  const chargeId = idOf(dispute.charge);
  const deadlineIso = dispute.evidence_details?.due_by ? unixToIso(dispute.evidence_details.due_by) : null;
  const openedIso = unixToIso(dispute.created ?? event.created);

  const historyEntry = {
    status: 'disputed',
    timestamp: openedIso,
    note: `Dispute ${dispute.id} opened (${reason})${deadlineIso ? `; evidence due ${deadlineIso.slice(0, 10)}` : ''}`
  };

  let items = [];
  if (piDoc) {
    items = await loadOrderItems(db, paymentIntentId);
    await applyOrderPatch(db, paymentIntentId, {
      items,
      historyEntry,
      piPatch: {
        ...(chargeId && { chargeId }),
        paymentStatus: 'disputed',
        disputeId: dispute.id,
        disputeReason: reason,
        disputeStatus: dispute.status || 'needs_response',
        disputeAmountCents: toCents(dispute.amount),
        disputeDeadline: deadlineIso,
        disputedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      itemPatch: {
        paymentStatus: 'disputed',
        disputeId: dispute.id,
        disputeReason: reason,
        disputeDeadline: deadlineIso,
        disputedAt: openedIso
      }
    });
  } else {
    console.warn(`⚠️  Dispute ${dispute.id} references ${paymentIntentId}, which is not a store order — alerting only`);
  }

  const notified = await notifyOwner(db, `${paymentIntentId}_dispute_${dispute.id}`, {
    subject: '🚨 Chargeback opened - Kaayko Store',
    alertTitle: '🚨 A customer has disputed a payment',
    alertText: 'The card issuer has opened a dispute and the funds are on hold. Respond with evidence in the Stripe dashboard before the deadline below or the dispute is lost by default. The order is marked disputed — do not ship anything that has not already left until this is resolved.',
    rows: [
      { label: 'Order', value: paymentIntentId },
      { label: 'Dispute', value: dispute.id },
      { label: 'Amount', value: formatMoney(toCents(dispute.amount) ?? 0, currency) },
      { label: 'Reason', value: reason },
      { label: 'Status', value: dispute.status || '—' },
      { label: 'Respond By', value: deadlineIso ? formatTimestamp(new Date(deadlineIso)) : 'Not stated' },
      { label: 'Customer Email', value: piDoc?.customerEmail || '—' },
      { label: 'Store Order', value: piDoc ? 'Yes' : 'No — not a store order' }
    ],
    stripeUrl: dashboardUrl(event, `disputes/${dispute.id}`),
    stripeLabel: 'Respond in Stripe →'
  }, { id: paymentIntentId, metadata: {} });

  await markEventProcessed(db, event, { paymentIntentId, disputeId: dispute.id });

  console.log(`🚨 Dispute ${dispute.id} recorded for ${paymentIntentId} (${reason})`);
  return { disputed: true, paymentIntentId, disputeId: dispute.id, orderFound: !!piDoc, items: items.length, ownerNotified: notified };
}

// What a closed dispute means for the money. `won` and `warning_closed` (an
// inquiry that never became a chargeback) restore the paid state.
const DISPUTE_OUTCOME_STATUS = {
  won:             { pi: 'succeeded',    item: 'paid' },
  warning_closed:  { pi: 'succeeded',    item: 'paid' },
  lost:            { pi: 'dispute_lost', item: 'dispute_lost' },
  charge_refunded: { pi: 'refunded',     item: 'refunded' }
};

/** charge.dispute.closed — record the outcome and restore or finalise the payment state. */
async function handleDisputeClosed(dispute, event) {
  const db = admin.firestore();

  if (await isEventProcessed(db, event)) {
    console.log(`↩️  Event ${event.id} already processed — acknowledging duplicate`);
    return { duplicate: true };
  }

  const paymentIntentId = await resolvePaymentIntentId(db, dispute);
  const piSnap = await db.collection('payment_intents').doc(paymentIntentId).get();
  const piDoc = piSnap.exists ? piSnap.data() : null;

  const currency = dispute.currency || piDoc?.currency || 'usd';
  const outcome = dispute.status || 'closed';
  const mapped = DISPUTE_OUTCOME_STATUS[outcome] || { pi: 'disputed', item: 'disputed' };
  const closedIso = unixToIso(event.created);

  const historyEntry = {
    status: `dispute_${outcome}`,
    timestamp: closedIso,
    note: `Dispute ${dispute.id} closed: ${outcome}`
  };

  let items = [];
  if (piDoc) {
    items = await loadOrderItems(db, paymentIntentId);
    await applyOrderPatch(db, paymentIntentId, {
      items,
      historyEntry,
      piPatch: {
        paymentStatus: mapped.pi,
        disputeId: dispute.id,
        disputeStatus: outcome,
        disputeOutcome: outcome,
        disputeClosedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(outcome === 'lost' && { disputeLostCents: toCents(dispute.amount) })
      },
      itemPatch: {
        paymentStatus: mapped.item,
        disputeId: dispute.id,
        disputeStatus: outcome,
        disputeOutcome: outcome,
        disputeClosedAt: closedIso
      }
    });
  }

  const lost = outcome === 'lost';
  const notified = await notifyOwner(db, `${paymentIntentId}_dispute_${dispute.id}_closed`, {
    subject: lost ? '🚨 Chargeback LOST - Kaayko Store' : `✅ Chargeback closed (${outcome}) - Kaayko Store`,
    alertTitle: lost ? '🚨 A dispute was lost' : `✅ A dispute was closed: ${outcome}`,
    alertText: lost
      ? 'The card issuer sided with the customer. The disputed amount plus the dispute fee has been taken from the Stripe balance; the order is marked dispute_lost. If it has not shipped, do not ship it.'
      : outcome === 'charge_refunded'
        ? 'The dispute closed because the charge was refunded. The order is marked refunded.'
        : 'The dispute is closed and the funds are back in the Stripe balance. The order is marked paid again.',
    rows: [
      { label: 'Order', value: paymentIntentId },
      { label: 'Dispute', value: dispute.id },
      { label: 'Outcome', value: outcome },
      { label: 'Amount', value: formatMoney(toCents(dispute.amount) ?? 0, currency) },
      { label: 'Customer Email', value: piDoc?.customerEmail || '—' },
      { label: 'When', value: formatTimestamp(new Date(closedIso)) }
    ],
    stripeUrl: dashboardUrl(event, `disputes/${dispute.id}`),
    stripeLabel: 'View in Stripe →'
  }, { id: paymentIntentId, metadata: {} });

  await markEventProcessed(db, event, { paymentIntentId, disputeId: dispute.id, outcome });

  console.log(`${lost ? '🚨' : '✅'} Dispute ${dispute.id} closed for ${paymentIntentId}: ${outcome}`);
  return { disputeClosed: true, paymentIntentId, disputeId: dispute.id, outcome, paymentStatus: mapped.item, orderFound: !!piDoc, items: items.length, ownerNotified: notified };
}

// ─── View models ───────────────────────────────────────────────

function buildItemViews(ctx) {
  return ctx.items.map((item, index) => ({
    number: index + 1,
    productTitle: item.productTitle,
    size: item.size || '—',
    gender: item.gender || '—',
    quantity: item.quantity,
    unitPrice: formatMoney(item.unitPriceCents, ctx.currency),
    lineTotal: formatMoney(item.lineTotalCents, ctx.currency),
    variant: [item.gender, item.size].filter(Boolean).join(' · ') || '—'
  }));
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'full',
    timeStyle: 'long'
  });
}

/**
 * Flatten the shipping address into template fields. The owner email always
 * shows a Ship To block: when there is no address the block says so loudly
 * rather than rendering a run of blank lines the eye skips over.
 */
function buildShipToView(shipping) {
  const a = shipping?.address;
  if (!a) {
    return {
      shipName: '—',
      shipLine1: '—',
      shipLine2: '',
      shipCityLine: '—',
      shipCountry: '—',
      shipPhone: '—',
      shipNote: '⚠️ NO SHIPPING ADDRESS was captured for this order. Open it in the Stripe dashboard before shipping.'
    };
  }
  const cityLine = [a.city, a.state, a.postal_code].filter(Boolean).join(', ');
  return {
    shipName: a.name || '—',
    shipLine1: a.line1 || '—',
    shipLine2: a.line2 || '',
    shipCityLine: cityLine || '—',
    shipCountry: a.country || '—',
    shipPhone: shipping.phone || '—',
    shipNote: `Captured from Stripe (${shipping.source}).`
  };
}

// ─── Emails ────────────────────────────────────────────────────

/**
 * Queue a generic owner alert (payment failure, webhook failure). Uses the
 * shared ownerAlert template so a new alert kind is a data change, not a new
 * file, and inherits the deterministic-id idempotency rule.
 */
async function notifyOwner(db, mailDocId, view, paymentIntent) {
  const to = resolveNotifyEmail(paymentIntent);
  const html = renderEmail('ownerAlert.html', {
    ...view,
    stripeUrl: view.stripeUrl || '',
    stripeLabel: view.stripeLabel || ''
  });

  const queued = await queueMailOnce(db, mailDocId, {
    to,
    message: { subject: view.subject, html },
    paymentIntentId: paymentIntent?.id || null
  });
  if (queued) console.log(`📧 Owner alert queued (${mailDocId}) → ${to}`);
  return queued;
}

async function notifyWebhookFailure(event, error) {
  const db = admin.firestore();
  return notifyOwner(db, `${event.id}_webhook_failure`, {
    subject: '🚨 Order NOT recorded - Kaayko Store',
    alertTitle: '🚨 A Stripe event could not be turned into an order',
    alertText: 'Stripe delivered an event that this server could not process, and retrying will not help. If it was a successful payment the buyer HAS been charged and no order document exists. Check the payment in Stripe and record the order by hand.',
    rows: [
      { label: 'Event', value: event.id },
      { label: 'Event Type', value: event.type },
      { label: 'Object', value: event.data?.object?.id || '—' },
      { label: 'Error', value: error.message },
      { label: 'When', value: formatTimestamp() }
    ],
    stripeUrl: event.data?.object?.id
      ? `https://dashboard.stripe.com/test/payments/${event.data.object.id}`
      : 'https://dashboard.stripe.com/test/webhooks',
    stripeLabel: 'Open in Stripe Dashboard →'
  }, event.data?.object);
}

async function sendOrderConfirmationEmails(db, paymentIntent, ctx, customerEmail, shipping) {
  const adminEmail = resolveNotifyEmail(paymentIntent);
  const itemViews = buildItemViews(ctx);
  const orderTotal = formatMoney(ctx.totalCents, ctx.currency);
  const subtotal = formatMoney(ctx.subtotalCents, ctx.currency);
  const itemCount = itemViews.reduce((sum, i) => sum + i.quantity, 0);
  const timestamp = formatTimestamp();

  const sent = { customer: false, admin: false };

  if (!customerEmail) {
    console.warn(`⚠️  No customer email for ${paymentIntent.id}, skipping customer notification`);
  } else {
    const customerHtml = renderEmail('orderConfirmation.html', {
      orderId: paymentIntent.id,
      items: itemViews,
      itemCount,
      subtotal,
      orderTotal,
      amount: orderTotal
    });

    sent.customer = await queueMailOnce(db, `${paymentIntent.id}_customer`, {
      to: customerEmail,
      message: {
        subject: '🛶 Order Confirmation - Kaayko',
        html: customerHtml
      },
      paymentIntentId: paymentIntent.id
    });
    if (sent.customer) console.log(`📧 Customer email queued: ${customerEmail}`);
  }

  const adminHtml = renderEmail('newOrderNotification.html', {
    orderId: paymentIntent.id,
    customerEmail: customerEmail || 'Not provided',
    items: itemViews,
    itemCount,
    subtotal,
    orderTotal,
    amount: orderTotal,
    status: 'SUCCEEDED',
    paymentIntentId: paymentIntent.id,
    notifyEmail: adminEmail,
    timestamp,
    ...buildShipToView(shipping)
  });

  sent.admin = await queueMailOnce(db, `${paymentIntent.id}_admin`, {
    to: adminEmail,
    message: {
      subject: '🔔 New Order - Kaayko Store',
      html: adminHtml
    },
    paymentIntentId: paymentIntent.id
  });
  if (sent.admin) console.log(`📧 Admin notification queued: ${adminEmail}`);

  return sent;
}

module.exports = stripeWebhook;
module.exports.renderTemplate = renderTemplate;
module.exports.escapeHtml = escapeHtml;
module.exports.normalizeItem = normalizeItem;
module.exports.PermanentWebhookError = PermanentWebhookError;
module.exports.resolveShipping = resolveShipping;
module.exports.buildShipToView = buildShipToView;
module.exports.resolveChargeId = resolveChargeId;
module.exports.allocateRefund = allocateRefund;
