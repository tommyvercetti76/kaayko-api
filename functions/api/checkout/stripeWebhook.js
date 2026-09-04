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
 *
 * REVENUE MODEL (important): each `orders` doc carries only its OWN money
 * (`unitPriceCents`, `quantity`, `lineTotalCents`). The order-level total lives
 * exactly once, on `payment_intents/{pi}`. Summing `lineTotalCents` across the
 * `orders` collection therefore yields correct revenue.
 */

const admin = require('firebase-admin');

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

  let event;
  try {
    const stripeClient = getStripe();
    // req.body is a Buffer here because this route is mounted with express.raw().
    event = stripeClient.webhooks.constructEvent(req.body, sig, webhookSecret);
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

      default:
        // Not a failure — acknowledge so Stripe stops sending it.
        console.log(`ℹ️  Unhandled event type: ${event.type}`);
        return res.json({ received: true, ignored: true });
    }
  } catch (error) {
    if (error instanceof PermanentWebhookError) {
      console.error(`❌ Permanent webhook failure (${event.id}): ${error.message}`);
      await recordWebhookFailure(event, error).catch(() => {});
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
 */
async function queueMailOnce(db, docId, payload) {
  const ref = db.collection('mail').doc(docId);
  const existing = await ref.get();
  if (existing.exists) {
    console.log(`↩️  Mail ${docId} already queued — skipping duplicate send`);
    return false;
  }
  await ref.set(payload);
  return true;
}

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

  // 1. Update the payment intent record (order-level money lives HERE, once).
  //    set(merge) rather than update() so a missing doc does not throw NOT_FOUND.
  await db.collection('payment_intents').doc(paymentIntent.id).set({
    paymentIntentId: paymentIntent.id,
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
    currency: ctx.currency,

    orderStatus: 'pending',          // pending → processing → shipped → delivered → returned
    fulfillmentStatus: 'processing', // processing → ready_to_ship → shipped → delivered
    paymentStatus: 'paid',           // paid → refunded → partially_refunded

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
    customerPhone: paymentIntent.shipping?.phone || null,

    shippingAddress: paymentIntent.shipping?.address ? {
      name: paymentIntent.shipping.name || null,
      line1: paymentIntent.shipping.address.line1 || null,
      line2: paymentIntent.shipping.address.line2 || null,
      city: paymentIntent.shipping.address.city || null,
      state: paymentIntent.shipping.address.state || null,
      postal_code: paymentIntent.shipping.address.postal_code || null,
      country: paymentIntent.shipping.address.country || null
    } : null,

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

  // 4. Emails — exactly once per payment intent.
  const emailsSent = await sendOrderConfirmationEmails(db, paymentIntent, ctx, customerEmail);

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

  await markEventProcessed(db, event, { paymentIntentId: paymentIntent.id });

  console.log(`⚠️  Payment failed for: ${paymentIntent.id}`);
  return { failed: true };
}

// ─── Templating ────────────────────────────────────────────────

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function lookup(scope, key) {
  return String(key).split('.').reduce((o, k) => (o == null ? undefined : o[k]), scope);
}

/**
 * Minimal, dependency-free template renderer.
 *   {{#each items}} ... {{/each}}   repeat block per array element
 *   {{key}}                          HTML-ESCAPED interpolation
 *   {{{key}}}                        raw interpolation (trusted markup only)
 * All customer-supplied values (product titles, sizes, emails) go through
 * {{key}} and are therefore escaped.
 */
function renderTemplate(template, data) {
  // Blocks first so their bodies are rendered against the element scope.
  const withBlocks = template.replace(
    /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, key, body) => {
      const list = lookup(data, key);
      if (!Array.isArray(list)) return '';
      return list
        .map((entry, index) =>
          renderTemplate(body, { ...data, ...entry, '@index': index, '@number': index + 1 })
        )
        .join('');
    }
  );

  return withBlocks
    .replace(/\{\{\{\s*([\w.@]+)\s*\}\}\}/g, (_m, key) => {
      const v = lookup(data, key);
      return v == null ? '' : String(v);
    })
    .replace(/\{\{\s*([\w.@]+)\s*\}\}/g, (_m, key) => escapeHtml(lookup(data, key)));
}

function formatMoney(cents, currency = 'usd') {
  const amount = (Number(cents || 0) / 100).toFixed(2);
  const symbol = String(currency).toLowerCase() === 'usd' ? '$' : '';
  return `${symbol}${amount}`;
}

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

// ─── Emails ────────────────────────────────────────────────────

async function sendOrderConfirmationEmails(db, paymentIntent, ctx, customerEmail) {
  const fs = require('fs');
  const path = require('path');

  const adminEmail = paymentIntent.metadata?.notifyEmail || 'rohan@kaayko.com';
  const itemViews = buildItemViews(ctx);
  const orderTotal = formatMoney(ctx.totalCents, ctx.currency);
  const subtotal = formatMoney(ctx.subtotalCents, ctx.currency);
  const itemCount = itemViews.reduce((sum, i) => sum + i.quantity, 0);

  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'full',
    timeStyle: 'long'
  });

  const sent = { customer: false, admin: false };

  if (!customerEmail) {
    console.warn(`⚠️  No customer email for ${paymentIntent.id}, skipping customer notification`);
  } else {
    const customerTemplate = fs.readFileSync(
      path.join(__dirname, '../email/templates/orderConfirmation.html'), 'utf8'
    );
    const customerHtml = renderTemplate(customerTemplate, {
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
      paymentIntentId: paymentIntent.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    if (sent.customer) console.log(`📧 Customer email queued: ${customerEmail}`);
  }

  const adminTemplate = fs.readFileSync(
    path.join(__dirname, '../email/templates/newOrderNotification.html'), 'utf8'
  );
  const adminHtml = renderTemplate(adminTemplate, {
    orderId: paymentIntent.id,
    customerEmail: customerEmail || 'Not provided',
    items: itemViews,
    itemCount,
    subtotal,
    orderTotal,
    amount: orderTotal,
    status: 'SUCCEEDED',
    paymentIntentId: paymentIntent.id,
    timestamp
  });

  sent.admin = await queueMailOnce(db, `${paymentIntent.id}_admin`, {
    to: adminEmail,
    message: {
      subject: '🔔 New Order - Kaayko Store',
      html: adminHtml
    },
    paymentIntentId: paymentIntent.id,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  if (sent.admin) console.log(`📧 Admin notification queued: ${adminEmail}`);

  return sent;
}

module.exports = stripeWebhook;
module.exports.renderTemplate = renderTemplate;
module.exports.escapeHtml = escapeHtml;
module.exports.normalizeItem = normalizeItem;
module.exports.PermanentWebhookError = PermanentWebhookError;
