/**
 * Order fulfilment — owner notification address, failure alerts, the shipped
 * transition, and shipping-address capture.
 *
 * Companion to checkout-webhook.test.js: that file proves the money and the
 * order documents are right, this one proves the owner can actually be told
 * about an order and act on it.
 */

require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const admin = require('firebase-admin');

// ─── Stripe mock — never make a live Stripe call ───────────────
// paymentIntents.retrieve is present so the webhook's "re-read the intent with
// the charge expanded" path is exercised without touching the network. Tests
// steer it through STRIPE_REFETCH.
const STRIPE_REFETCH = { value: null, calls: 0 };

jest.mock('stripe', () => {
  return jest.fn(() => ({
    webhooks: {
      constructEvent: jest.fn((rawBody, signature) => {
        if (signature !== 'GOOD_SIG') {
          throw new Error('No signatures found matching the expected signature for payload');
        }
        return JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
      })
    },
    paymentIntents: {
      retrieve: jest.fn(async (id) => {
        // eslint-disable-next-line global-require
        const state = require('./order-fulfilment.state');
        state.calls += 1;
        if (!state.value) throw new Error('No such payment_intent');
        return { id, ...state.value };
      })
    }
  }));
});

// Small shared-state module so the jest.mock factory (hoisted, cannot close
// over test-file locals) and the tests can talk to each other.
jest.mock('./order-fulfilment.state', () => ({ value: null, calls: 0 }), { virtual: true });
const stripeState = require('./order-fulfilment.state');

const PI_ID = 'pi_fulfil_1';
const ORIGINAL_ENV = { ...process.env };

function buildWebhookApp() {
  const app = express();
  app.use('/webhook', express.raw({ type: 'application/json' }), require('../api/checkout/stripeWebhook'));
  return app;
}

function buildAdminApp() {
  const app = express();
  app.use(express.json());
  app.post('/updateOrderStatus', require('../api/admin/updateOrderStatus'));
  const { listOrders } = require('../api/admin/getOrder');
  app.get('/listOrders', listOrders);
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

const SHIPPING = {
  name: 'Rohan Ramekar',
  phone: '+15551234567',
  address: {
    line1: '5205 Tuskegee Trail', line2: 'Apt 2', city: 'McKinney',
    state: 'TX', postal_code: '75070', country: 'US'
  }
};

function basePaymentIntent(overrides = {}) {
  return {
    id: PI_ID,
    amount: 13996,
    currency: 'usd',
    receipt_email: 'buyer@example.com',
    payment_method_types: ['card'],
    shipping: SHIPPING,
    metadata: { notifyEmail: 'rohan@kaayko.com' },
    ...overrides
  };
}

/** Two line items, the second symbol-priced ("$34.99") like the legacy shape. */
function seedPaymentIntentDoc(extra = {}) {
  admin._mocks.docData[`payment_intents/${PI_ID}`] = {
    paymentIntentId: PI_ID,
    currency: 'usd',
    subtotalCents: 13996,
    totalCents: 13996,
    items: [
      {
        productId: 'prod-1', productTitle: 'Straight Outta Sabarmati',
        size: 'S', gender: 'Male', quantity: 2,
        unitPriceCents: 3499, lineTotalCents: 6998
      },
      {
        // Symbol-priced: no *Cents fields at all, only "$34.99" strings.
        productId: 'prod-2', productTitle: 'Stay Hydrated',
        size: 'M', gender: 'Female', quantity: 2,
        price: '$34.99', lineTotalCents: '$69.98'
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

beforeEach(() => {
  stripeState.value = null;
  stripeState.calls = 0;
  delete process.env.ORDER_NOTIFY_EMAIL;
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ────────────────────────────────────────────────────────────────
describe('Owner notification address', () => {
  const { resolveNotifyEmail, DEFAULT_ORDER_NOTIFY_EMAIL } =
    require('../api/email/notifyAddress');

  test('defaults to the owner address when nothing is configured', () => {
    expect(DEFAULT_ORDER_NOTIFY_EMAIL).toBe('rohanramekar17@gmail.com');
    expect(resolveNotifyEmail()).toBe('rohanramekar17@gmail.com');
    expect(resolveNotifyEmail({ metadata: {} })).toBe('rohanramekar17@gmail.com');
  });

  test('ORDER_NOTIFY_EMAIL overrides the address stamped on an in-flight intent', () => {
    process.env.ORDER_NOTIFY_EMAIL = 'ops@kaayko.com';
    expect(resolveNotifyEmail({ metadata: { notifyEmail: 'stale@kaayko.com' } })).toBe('ops@kaayko.com');
  });

  test('a malformed env value falls through instead of black-holing the mail', () => {
    process.env.ORDER_NOTIFY_EMAIL = 'not-an-email';
    expect(resolveNotifyEmail({ metadata: { notifyEmail: 'stamped@kaayko.com' } })).toBe('stamped@kaayko.com');
    expect(resolveNotifyEmail({ metadata: {} })).toBe('rohanramekar17@gmail.com');
  });

  test('a successful order mails the configured owner address, not the hardcoded one', async () => {
    process.env.ORDER_NOTIFY_EMAIL = 'rohanramekar17@gmail.com';
    seedPaymentIntentDoc();

    await post(buildWebhookApp(), succeededEvent('evt_notify', basePaymentIntent()));

    const adminMail = admin._mocks.docData[`mail/${PI_ID}_admin`];
    expect(adminMail.to).toBe('rohanramekar17@gmail.com');
    expect(adminMail.message.html).toContain('rohanramekar17@gmail.com');
  });
});

// ────────────────────────────────────────────────────────────────
describe('Failure notifications', () => {
  test('a failed payment emails the owner exactly once', async () => {
    process.env.ORDER_NOTIFY_EMAIL = 'rohanramekar17@gmail.com';
    const app = buildWebhookApp();
    const failure = (id) => ({
      id,
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: PI_ID, amount: 13996, currency: 'usd',
          receipt_email: 'buyer@example.com',
          last_payment_error: { message: 'Your card was declined.', decline_code: 'generic_decline' }
        }
      }
    });

    const first = await post(app, failure('evt_fail_a'));
    expect(first.status).toBe(200);
    expect(first.body.ownerNotified).toBe(true);

    const alert = admin._mocks.docData[`mail/${PI_ID}_failed`];
    expect(alert.to).toBe('rohanramekar17@gmail.com');
    expect(alert.message.subject).toContain('Payment Failed');
    expect(alert.message.html).toContain('generic_decline');
    expect(alert.message.html).toContain('buyer@example.com');
    expect(alert.message.html).not.toContain('{{');

    // A different event id for the same intent must not re-alert.
    await post(app, failure('evt_fail_b'));
    expect(mailDocs().filter(m => m.path.endsWith('_failed'))).toHaveLength(1);
  });

  test('a permanent webhook failure alerts the owner and is recorded for triage', async () => {
    process.env.ORDER_NOTIFY_EMAIL = 'rohanramekar17@gmail.com';
    const app = buildWebhookApp();

    // No payment_intents doc and no metadata.items → unprocessable forever.
    const pi = basePaymentIntent();
    pi.metadata = {};
    const res = await post(app, succeededEvent('evt_broken', pi));

    expect(res.status).toBe(200);
    expect(admin._mocks.docData['webhook_failures/evt_broken'].permanent).toBe(true);

    const alert = admin._mocks.docData['mail/evt_broken_webhook_failure'];
    expect(alert).toBeDefined();
    expect(alert.to).toBe('rohanramekar17@gmail.com');
    expect(alert.message.html).toContain('No line items found');
    expect(alert.message.html).not.toContain('{{');
  });
});

// ────────────────────────────────────────────────────────────────
describe('Shipping address capture', () => {
  test('paymentIntent.shipping reaches every order document', async () => {
    seedPaymentIntentDoc();
    await post(buildWebhookApp(), succeededEvent('evt_ship_direct', basePaymentIntent()));

    const item1 = admin._mocks.docData[`orders/${PI_ID}_item1`];
    expect(item1.shippingAddress).toEqual({
      name: 'Rohan Ramekar', line1: '5205 Tuskegee Trail', line2: 'Apt 2',
      city: 'McKinney', state: 'TX', postal_code: '75070', country: 'US'
    });
    expect(item1.shippingSource).toBe('payment_intent.shipping');
    expect(item1.shippingAddressMissing).toBe(false);
    expect(item1.customerPhone).toBe('+15551234567');
    expect(admin._mocks.docData[`payment_intents/${PI_ID}`].shippingAddress.postal_code).toBe('75070');
  });

  test('an API version that only fills collected_information is still read', async () => {
    seedPaymentIntentDoc();
    const pi = basePaymentIntent({ shipping: null });
    pi.collected_information = { shipping_details: SHIPPING };

    await post(buildWebhookApp(), succeededEvent('evt_ship_collected', pi));

    const item1 = admin._mocks.docData[`orders/${PI_ID}_item1`];
    expect(item1.shippingAddress.line1).toBe('5205 Tuskegee Trail');
    expect(item1.shippingSource).toBe('payment_intent.collected_information');
    expect(stripeState.calls).toBe(0); // no need to ask Stripe again
  });

  test('when the event carries no address at all, the intent is re-read from Stripe', async () => {
    seedPaymentIntentDoc();
    stripeState.value = { latest_charge: { shipping: SHIPPING } };

    // latest_charge arrives as a bare id string in the webhook payload — the
    // exact shape that made the old single-field read return null.
    const pi = basePaymentIntent({ shipping: null, latest_charge: 'ch_123' });

    await post(buildWebhookApp(), succeededEvent('evt_ship_refetch', pi));

    expect(stripeState.calls).toBe(1);
    const item1 = admin._mocks.docData[`orders/${PI_ID}_item1`];
    expect(item1.shippingAddress.city).toBe('McKinney');
    expect(item1.shippingSource).toBe('refetch:latest_charge.shipping');
  });

  test('a genuinely address-less order is flagged, and the owner email says so', async () => {
    seedPaymentIntentDoc();
    stripeState.value = null; // retrieve throws

    await post(buildWebhookApp(), succeededEvent('evt_ship_none', basePaymentIntent({ shipping: null })));

    const item1 = admin._mocks.docData[`orders/${PI_ID}_item1`];
    expect(item1.shippingAddress).toBeNull();
    expect(item1.shippingAddressMissing).toBe(true);

    const adminMail = admin._mocks.docData[`mail/${PI_ID}_admin`];
    expect(adminMail.message.html).toContain('NO SHIPPING ADDRESS');
  });

  test('a country-only stub is not mistaken for a shippable address', async () => {
    seedPaymentIntentDoc();
    stripeState.value = null;
    const pi = basePaymentIntent({ shipping: { name: 'Nobody', address: { country: 'US' } } });

    await post(buildWebhookApp(), succeededEvent('evt_ship_stub', pi));

    expect(admin._mocks.docData[`orders/${PI_ID}_item1`].shippingAddressMissing).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
describe('Multi-line-item emails with a symbol-priced product', () => {
  test('both emails render every line, the right totals and the ship-to block', async () => {
    process.env.ORDER_NOTIFY_EMAIL = 'rohanramekar17@gmail.com';
    seedPaymentIntentDoc();

    await post(buildWebhookApp(), succeededEvent('evt_render', basePaymentIntent()));

    const customerHtml = admin._mocks.docData[`mail/${PI_ID}_customer`].message.html;
    expect(customerHtml).toContain('Straight Outta Sabarmati');
    expect(customerHtml).toContain('Stay Hydrated');
    expect(customerHtml).toContain('$34.99');   // symbol price normalised
    expect(customerHtml).toContain('$69.98');   // both line totals
    expect(customerHtml).toContain('$139.96');  // order total
    expect(customerHtml).not.toContain('{{');
    expect(customerHtml).not.toContain('NaN');

    const adminHtml = admin._mocks.docData[`mail/${PI_ID}_admin`].message.html;
    expect(adminHtml).toContain('Ship To');
    expect(adminHtml).toContain('5205 Tuskegee Trail');
    expect(adminHtml).toContain('McKinney, TX, 75070');
    expect(adminHtml).toContain('buyer@example.com');
    expect(adminHtml).toContain('$139.96');
    expect(adminHtml).not.toContain('{{');
    expect(adminHtml).not.toContain('NaN');
  });
});

// ────────────────────────────────────────────────────────────────
describe('Fulfilment — mark shipped', () => {
  async function seedPaidOrder() {
    seedPaymentIntentDoc();
    await post(buildWebhookApp(), succeededEvent('evt_seed', basePaymentIntent()));
  }

  test('shipping a whole order updates every line item and emails the customer once', async () => {
    await seedPaidOrder();
    const app = buildAdminApp();

    const res = await request(app).post('/updateOrderStatus').send({
      parentOrderId: PI_ID,
      orderStatus: 'shipped',
      fulfillmentStatus: 'shipped',
      trackingNumber: '9400111899223197428490',
      carrier: 'USPS',
      estimatedDelivery: '2026-09-09'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orderIds.sort()).toEqual([`${PI_ID}_item1`, `${PI_ID}_item2`]);
    expect(res.body.trackingUrl).toContain('tools.usps.com');
    expect(res.body.customerNotification.queued).toBe(true);

    const item1 = admin._mocks.docData[`orders/${PI_ID}_item1`];
    const item2 = admin._mocks.docData[`orders/${PI_ID}_item2`];
    expect(item1.orderStatus).toBe('shipped');
    expect(item2.orderStatus).toBe('shipped');
    expect(item1.trackingNumber).toBe('9400111899223197428490');
    expect(item1.shippedAt).toBeTruthy();

    // Parent rolls forward only because every item agrees.
    expect(admin._mocks.docData[`payment_intents/${PI_ID}`].fulfillmentStatus).toBe('shipped');

    const mail = admin._mocks.docData[`mail/${PI_ID}_shipped`];
    expect(mail.to).toBe('buyer@example.com');
    expect(mail.message.subject).toContain('shipped');
    expect(mail.message.html).toContain('9400111899223197428490');
    expect(mail.message.html).toContain('USPS');
    expect(mail.message.html).toContain('tools.usps.com');
    expect(mail.message.html).toContain('Straight Outta Sabarmati');
    expect(mail.message.html).toContain('Stay Hydrated');
    expect(mail.message.html).toContain('5205 Tuskegee Trail');
    expect(mail.message.html).not.toContain('{{');
  });

  test('pressing "mark shipped" twice does not send a second email', async () => {
    await seedPaidOrder();
    const app = buildAdminApp();
    const body = { parentOrderId: PI_ID, orderStatus: 'shipped', trackingNumber: 'TRK1', carrier: 'UPS' };

    await request(app).post('/updateOrderStatus').send(body);
    const second = await request(app).post('/updateOrderStatus').send(body);

    expect(second.status).toBe(200);
    expect(second.body.customerNotification.queued).toBe(false);
    expect(mailDocs().filter(m => m.path.endsWith('_shipped'))).toHaveLength(1);
  });

  test('a typo\'d status is rejected instead of being written', async () => {
    await seedPaidOrder();

    const res = await request(buildAdminApp()).post('/updateOrderStatus')
      .send({ parentOrderId: PI_ID, orderStatus: 'shiped' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid orderStatus');
    expect(admin._mocks.docData[`orders/${PI_ID}_item1`].orderStatus).toBe('pending');
  });

  test('marking one item processing does not roll the whole order forward', async () => {
    await seedPaidOrder();

    const res = await request(buildAdminApp()).post('/updateOrderStatus')
      .send({ orderId: `${PI_ID}_item1`, orderStatus: 'processing', internalNote: 'printing label' });

    expect(res.status).toBe(200);
    expect(admin._mocks.docData[`orders/${PI_ID}_item1`].orderStatus).toBe('processing');
    expect(admin._mocks.docData[`orders/${PI_ID}_item2`].orderStatus).toBe('pending');
    expect(admin._mocks.docData[`payment_intents/${PI_ID}`].fulfillmentStatus).toBe('processing');
    expect(mailDocs().filter(m => m.path.endsWith('_shipped'))).toHaveLength(0);
  });

  test('an unknown order is a 404, and an empty update is a 400', async () => {
    const app = buildAdminApp();

    const missing = await request(app).post('/updateOrderStatus')
      .send({ orderId: 'pi_nope_item1', orderStatus: 'shipped' });
    expect(missing.status).toBe(404);

    const empty = await request(app).post('/updateOrderStatus').send({ parentOrderId: PI_ID });
    expect(empty.status).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────────
describe('Fulfilment — the packing list', () => {
  test('listOrders?groupByOrder=true returns one shipment with address, items and total', async () => {
    seedPaymentIntentDoc();
    await post(buildWebhookApp(), succeededEvent('evt_list', basePaymentIntent()));

    const res = await request(buildAdminApp()).get('/listOrders?groupByOrder=true');

    expect(res.status).toBe(200);
    expect(res.body.shipments).toHaveLength(1);

    const shipment = res.body.shipments[0];
    expect(shipment.parentOrderId).toBe(PI_ID);
    expect(shipment.customerEmail).toBe('buyer@example.com');
    expect(shipment.shippingAddress.line1).toBe('5205 Tuskegee Trail');
    expect(shipment.shippingAddressMissing).toBe(false);
    expect(shipment.unitCount).toBe(4);
    expect(shipment.orderTotalCents).toBe(13996);
    expect(shipment.items.map(i => i.productTitle))
      .toEqual(['Straight Outta Sabarmati', 'Stay Hydrated']);
    // Everything needed to pack the box is on the item.
    expect(shipment.items[0]).toMatchObject({ size: 'S', gender: 'Male', quantity: 2 });
  });
});
