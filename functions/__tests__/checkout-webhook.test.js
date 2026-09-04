require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const admin = require('firebase-admin');

// ─── Stripe mock — never make a live Stripe call ───────────────
// constructEvent parses the raw body and honours a magic bad signature so we
// can exercise the verification-failure path deterministically.
jest.mock('stripe', () => {
  return jest.fn(() => ({
    webhooks: {
      constructEvent: jest.fn((rawBody, signature) => {
        if (signature !== 'GOOD_SIG') {
          throw new Error('No signatures found matching the expected signature for payload');
        }
        return JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
      })
    }
  }));
});

// Mirrors the production mount in functions/index.js (express.raw, not json).
function buildWebhookApp() {
  const app = express();
  app.use('/webhook', express.raw({ type: 'application/json' }), require('../api/checkout/stripeWebhook'));
  return app;
}

/**
 * Mirrors how the handler ACTUALLY runs on Firebase: the platform parses the
 * body before Express sees it and exposes the signed bytes on `req.rawBody`.
 * The raw-mount above never reproduced this, which is exactly why a webhook
 * that passed every test still rejected every real Stripe delivery in
 * production with "Payload was provided as a parsed JavaScript object".
 */
function buildFirebaseStyleApp() {
  const app = express();
  app.use('/webhook', express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; }
  }), require('../api/checkout/stripeWebhook'));
  return app;
}

function post(app, event, signature = 'GOOD_SIG') {
  return request(app)
    .post('/webhook')
    .set('stripe-signature', signature)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(event));
}

function succeededEvent(eventId, paymentIntent) {
  return { id: eventId, type: 'payment_intent.succeeded', data: { object: paymentIntent } };
}

const PI_ID = 'pi_test_multi';

function basePaymentIntent(overrides = {}) {
  return {
    id: PI_ID,
    amount: 13996,
    currency: 'usd',
    receipt_email: 'buyer@example.com',
    payment_method_types: ['card'],
    shipping: {
      name: 'Rohan Ramekar',
      phone: '+15551234567',
      address: {
        line1: '5205 Tuskegee Trail', line2: null, city: 'McKinney',
        state: 'TX', postal_code: '75070', country: 'US'
      }
    },
    metadata: { notifyEmail: 'rohan@kaayko.com', dataRetentionConsent: 'true' },
    ...overrides
  };
}

// Authoritative server-computed record written by createPaymentIntent.js
function seedPaymentIntentDoc(extra = {}) {
  admin._mocks.docData[`payment_intents/${PI_ID}`] = {
    paymentIntentId: PI_ID,
    currency: 'usd',
    subtotalCents: 13996,
    totalCents: 13996,
    totalAmount: 13996,
    dataRetentionConsent: true,
    items: [
      {
        productId: 'prod-1', productTitle: 'Straight Outta Sabarmati',
        size: 'S', gender: 'Male', quantity: 2,
        unitPriceCents: 3499, lineTotalCents: 6998
      },
      {
        productId: 'prod-2', productTitle: 'Stay Hydrated',
        size: 'M', gender: 'Female', quantity: 2,
        unitPriceCents: 3499, lineTotalCents: 6998
      }
    ],
    ...extra
  };
}

function mailDocs() {
  return Object.entries(admin._mocks.docData)
    .filter(([path]) => path.startsWith('mail/'))
    .map(([path, data]) => ({ path, data }));
}

describe('Checkout Webhook — signature verification', () => {
  afterEach(() => jest.restoreAllMocks());

  test('invalid signature returns 400 and writes nothing', async () => {
    seedPaymentIntentDoc();
    const app = buildWebhookApp();

    const res = await post(app, succeededEvent('evt_bad', basePaymentIntent()), 'BAD_SIG');

    expect(res.status).toBe(400);
    expect(res.text).toContain('Webhook Error');
    expect(admin._mocks.docData[`orders/${PI_ID}_item1`]).toBeUndefined();
    expect(mailDocs()).toHaveLength(0);
  });

  test('unknown event type is acknowledged with 200 and ignored', async () => {
    const app = buildWebhookApp();
    // charge.refunded / charge.dispute.* are handled now (see
    // checkout-refunds-disputes.test.js); use a type nothing listens for.
    const res = await post(app, { id: 'evt_other', type: 'customer.created', data: { object: { id: 'cus_1' } } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, ignored: true });
  });
});

describe('Checkout Webhook — Firebase pre-parsed body', () => {
  test('verifies against req.rawBody when Firebase has already parsed req.body', async () => {
    seedPaymentIntentDoc();
    const app = buildFirebaseStyleApp();

    const res = await post(app, succeededEvent('evt_raw_1', basePaymentIntent()));

    // A 200 alone would not prove the right bytes were verified — the order
    // documents must actually have been written.
    expect(res.status).toBe(200);
    expect(res.body.orders).toBe(2);
    expect(admin._mocks.docData[`orders/${PI_ID}_item1`]).toBeDefined();
  });

  test('rejects when neither a raw body nor rawBody is present', async () => {
    seedPaymentIntentDoc();
    const app = express();
    app.use('/webhook', express.json(), require('../api/checkout/stripeWebhook'));

    const res = await post(app, succeededEvent('evt_raw_2', basePaymentIntent()));

    expect(res.status).toBe(400);
  });
});

describe('Checkout Webhook — order documents', () => {
  afterEach(() => jest.restoreAllMocks());

  test('multi-item payment writes one order per line item with per-item money only', async () => {
    seedPaymentIntentDoc();
    const app = buildWebhookApp();

    const res = await post(app, succeededEvent('evt_ok_1', basePaymentIntent()));
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.orders).toBe(2);

    const item1 = admin._mocks.docData[`orders/${PI_ID}_item1`];
    const item2 = admin._mocks.docData[`orders/${PI_ID}_item2`];

    expect(item1).toBeDefined();
    expect(item2).toBeDefined();

    expect(item1.orderId).toBe(`${PI_ID}_item1`);
    expect(item1.parentOrderId).toBe(PI_ID);
    expect(item1.itemIndex).toBe(1);
    expect(item1.totalItems).toBe(2);
    expect(item1.productTitle).toBe('Straight Outta Sabarmati');
    expect(item1.size).toBe('S');
    expect(item1.gender).toBe('Male');
    expect(item1.quantity).toBe(2);
    expect(item1.unitPriceCents).toBe(3499);
    expect(item1.lineTotalCents).toBe(6998);

    // Revenue safety: the order-level total must NOT be copied onto items.
    expect(item1.totalAmount).toBeUndefined();
    expect(item2.totalAmount).toBeUndefined();
    expect(item1.lineTotalCents + item2.lineTotalCents).toBe(13996);

    // createdAt is a Firestore timestamp (serverTimestamp mock → Date), not a
    // raw metadata string.
    expect(item1.createdAt).toBeInstanceOf(Date);

    // Customer email taken from receipt_email; shipping copied for fulfilment.
    expect(item1.customerEmail).toBe('buyer@example.com');
    expect(item1.shippingAddress.postal_code).toBe('75070');

    // Order-level total lives exactly once, on the payment intent record.
    const pi = admin._mocks.docData[`payment_intents/${PI_ID}`];
    expect(pi.status).toBe('succeeded');
    expect(pi.totalCents).toBe(13996);
    expect(pi.itemsSource).toBe('firestore');
  });

  test('the charge id is stored on the payment intent and every line item for later refund/dispute matching', async () => {
    seedPaymentIntentDoc();
    const app = buildWebhookApp();

    await post(app, succeededEvent('evt_charge', basePaymentIntent({ latest_charge: 'ch_abc123' })));

    expect(admin._mocks.docData[`payment_intents/${PI_ID}`].chargeId).toBe('ch_abc123');
    expect(admin._mocks.docData[`orders/${PI_ID}_item1`].chargeId).toBe('ch_abc123');
    expect(admin._mocks.docData[`orders/${PI_ID}_item2`].chargeId).toBe('ch_abc123');
    // Nothing refunded yet, but the field exists so revenue queries can subtract it.
    expect(admin._mocks.docData[`orders/${PI_ID}_item1`].refundedCents).toBe(0);
  });

  test('an expanded latest_charge object also yields the charge id', () => {
    const { resolveChargeId } = require('../api/checkout/stripeWebhook');
    expect(resolveChargeId({ latest_charge: { id: 'ch_obj', shipping: null } })).toBe('ch_obj');
    expect(resolveChargeId({ latest_charge: null, charges: { data: [{ id: 'ch_legacy' }] } })).toBe('ch_legacy');
    expect(resolveChargeId({})).toBeNull();
  });

  test('items come from Firestore, not Stripe metadata, when both are present', async () => {
    seedPaymentIntentDoc();
    const app = buildWebhookApp();

    const pi = basePaymentIntent();
    pi.metadata.items = JSON.stringify([
      { productId: 'stale', productTitle: 'STALE METADATA TITLE', size: 'XL', price: '$999.00' }
    ]);

    await post(app, succeededEvent('evt_ok_2', pi));

    expect(admin._mocks.docData[`orders/${PI_ID}_item1`].productTitle).toBe('Straight Outta Sabarmati');
    expect(admin._mocks.docData[`orders/${PI_ID}_item3`]).toBeUndefined();
  });

  test('legacy metadata.items is used when the payment_intents doc has no items', async () => {
    const app = buildWebhookApp();

    const pi = basePaymentIntent({ amount: 6998 });
    pi.metadata.items = JSON.stringify([
      { productId: 'legacy-1', productTitle: 'Legacy Tee', size: 'L', gender: 'Unisex', price: '$69.98', priceInCents: 6998 }
    ]);

    const res = await post(app, succeededEvent('evt_legacy', pi));

    expect(res.status).toBe(200);
    const order = admin._mocks.docData[`orders/${PI_ID}_item1`];
    expect(order.productTitle).toBe('Legacy Tee');
    expect(order.quantity).toBe(1);
    expect(order.unitPriceCents).toBe(6998);
    expect(order.lineTotalCents).toBe(6998);
    expect(admin._mocks.docData[`payment_intents/${PI_ID}`].itemsSource).toBe('legacy_metadata');
  });

  test('a payment with no items anywhere is acknowledged once and flagged, not retried forever', async () => {
    const app = buildWebhookApp();
    const pi = basePaymentIntent();
    pi.metadata = {};

    const res = await post(app, succeededEvent('evt_no_items', pi));

    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(admin._mocks.docData['webhook_failures/evt_no_items']).toBeDefined();
    expect(admin._mocks.docData['webhook_failures/evt_no_items'].permanent).toBe(true);
  });
});

describe('Checkout Webhook — retry semantics', () => {
  afterEach(() => jest.restoreAllMocks());

  test('a Firestore failure surfaces as a retryable 5xx', async () => {
    seedPaymentIntentDoc();

    // admin._mocks.firestore.batch is already a jest.fn, so jest.spyOn cannot
    // restore it — swap the implementation and put it back by hand.
    const realBatch = admin._mocks.firestore.batch.getMockImplementation();
    admin._mocks.firestore.batch.mockImplementation(() => ({
      set: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn(async () => { throw new Error('14 UNAVAILABLE: Firestore unavailable'); })
    }));

    let res;
    try {
      const app = buildWebhookApp();
      res = await post(app, succeededEvent('evt_boom', basePaymentIntent()));
    } finally {
      admin._mocks.firestore.batch.mockImplementation(realBatch);
    }

    expect(res.status).toBe(500);
    expect(res.body.received).toBe(false);
    // No email may go out for an order we failed to record.
    expect(mailDocs()).toHaveLength(0);
    // Not marked processed, so Stripe's retry will be handled fresh.
    expect(admin._mocks.docData['stripe_events/evt_boom']).toBeUndefined();
  });
});

describe('Checkout Webhook — idempotency', () => {
  afterEach(() => jest.restoreAllMocks());

  test('duplicate delivery of the same event does not double-send email', async () => {
    seedPaymentIntentDoc();
    const app = buildWebhookApp();
    const event = succeededEvent('evt_dup', basePaymentIntent());

    const first = await post(app, event);
    expect(first.status).toBe(200);
    expect(mailDocs()).toHaveLength(2); // one customer, one admin

    const second = await post(app, event);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(mailDocs()).toHaveLength(2);
  });

  test('a different event id for the same payment intent still sends only one email set', async () => {
    seedPaymentIntentDoc();
    const app = buildWebhookApp();

    await post(app, succeededEvent('evt_a', basePaymentIntent()));
    expect(mailDocs()).toHaveLength(2);

    await post(app, succeededEvent('evt_b', basePaymentIntent()));

    expect(mailDocs()).toHaveLength(2);
    expect(mailDocs().map(m => m.path).sort())
      .toEqual([`mail/${PI_ID}_admin`, `mail/${PI_ID}_customer`]);
  });
});

describe('Checkout Webhook — emails', () => {
  afterEach(() => jest.restoreAllMocks());

  test('customer email lists real product titles, sizes and totals — never "N/A"', async () => {
    seedPaymentIntentDoc();
    const app = buildWebhookApp();

    await post(app, succeededEvent('evt_mail', basePaymentIntent()));

    const customer = admin._mocks.docData[`mail/${PI_ID}_customer`];
    expect(customer).toBeDefined();
    expect(customer.to).toBe('buyer@example.com');

    const html = customer.message.html;
    expect(html).toContain('Straight Outta Sabarmati');
    expect(html).toContain('Stay Hydrated');
    expect(html).toContain('Male · S');
    expect(html).toContain('Female · M');
    expect(html).toContain('$69.98');   // line totals
    expect(html).toContain('$139.96');  // order total
    expect(html).not.toContain('N/A');
    expect(html).not.toContain('Kaayko Product');
    expect(html).not.toContain('{{');   // no unrendered placeholders
  });

  test('admin notification lists every line item and the order total', async () => {
    seedPaymentIntentDoc();
    const app = buildWebhookApp();

    await post(app, succeededEvent('evt_mail_admin', basePaymentIntent()));

    const adminMail = admin._mocks.docData[`mail/${PI_ID}_admin`];
    expect(adminMail.to).toBe('rohan@kaayko.com');

    const html = adminMail.message.html;
    expect(html).toContain('Straight Outta Sabarmati');
    expect(html).toContain('Stay Hydrated');
    expect(html).toContain('buyer@example.com');
    expect(html).toContain('$139.96');
    expect(html).not.toContain('{{');
  });

  test('customer-supplied product titles are HTML-escaped', async () => {
    seedPaymentIntentDoc({
      items: [{
        productId: 'x', productTitle: '<script>alert("xss")</script>',
        size: 'M', gender: 'Unisex', quantity: 1,
        unitPriceCents: 1000, lineTotalCents: 1000
      }]
    });
    const app = buildWebhookApp();

    await post(app, succeededEvent('evt_xss', basePaymentIntent()));

    const html = admin._mocks.docData[`mail/${PI_ID}_customer`].message.html;
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  test('customer email falls back to charge billing details when receipt_email is absent', async () => {
    seedPaymentIntentDoc();
    const app = buildWebhookApp();

    const pi = basePaymentIntent({ receipt_email: null });
    pi.charges = { data: [{ billing_details: { email: 'fallback@example.com' } }] };

    await post(app, succeededEvent('evt_fallback', pi));

    expect(admin._mocks.docData[`mail/${PI_ID}_customer`].to).toBe('fallback@example.com');
    expect(admin._mocks.docData[`orders/${PI_ID}_item1`].customerEmail).toBe('fallback@example.com');
  });

  test('missing customer email still notifies admin and does not fail the webhook', async () => {
    seedPaymentIntentDoc();
    const app = buildWebhookApp();

    const res = await post(app, succeededEvent('evt_noemail', basePaymentIntent({ receipt_email: null })));

    expect(res.status).toBe(200);
    expect(admin._mocks.docData[`mail/${PI_ID}_customer`]).toBeUndefined();
    expect(admin._mocks.docData[`mail/${PI_ID}_admin`]).toBeDefined();
  });
});

describe('Checkout Webhook — payment_intent.payment_failed', () => {
  afterEach(() => jest.restoreAllMocks());

  test('records the failure on the payment intent and creates no orders or email', async () => {
    seedPaymentIntentDoc();
    const app = buildWebhookApp();

    const res = await post(app, {
      id: 'evt_failed',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: PI_ID,
          amount: 13996,
          currency: 'usd',
          last_payment_error: { message: 'Your card was declined.' }
        }
      }
    });

    expect(res.status).toBe(200);
    expect(res.body.failed).toBe(true);

    const pi = admin._mocks.docData[`payment_intents/${PI_ID}`];
    expect(pi.status).toBe('failed');
    expect(pi.paymentStatus).toBe('failed');
    expect(pi.fulfillmentStatus).toBe('cancelled');
    expect(pi.errorMessage).toBe('Your card was declined.');

    expect(admin._mocks.docData[`orders/${PI_ID}_item1`]).toBeUndefined();

    // No order confirmation — but the owner IS told, because a run of declines
    // is a broken checkout, not a quiet week.
    expect(admin._mocks.docData[`mail/${PI_ID}_customer`]).toBeUndefined();
    expect(admin._mocks.docData[`mail/${PI_ID}_admin`]).toBeUndefined();
    const alert = admin._mocks.docData[`mail/${PI_ID}_failed`];
    expect(alert).toBeDefined();
    expect(alert.message.html).toContain('Your card was declined.');
  });

  test('duplicate failure event is acknowledged as a duplicate', async () => {
    const app = buildWebhookApp();
    const event = {
      id: 'evt_failed_dup',
      type: 'payment_intent.payment_failed',
      data: { object: { id: PI_ID, last_payment_error: { message: 'Declined' } } }
    };

    await post(app, event);
    const second = await post(app, event);

    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
  });
});
