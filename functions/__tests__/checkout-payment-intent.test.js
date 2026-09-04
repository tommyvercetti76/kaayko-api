require('./helpers/mockSetup');
const request = require('supertest');
const admin = require('firebase-admin');
const express = require('express');

// ─── Stripe is mocked at the module boundary — no live calls, ever ───────────
const mockStripeCreate = jest.fn(async (params, options) => ({
  id: 'pi_test_123',
  client_secret: 'pi_test_123_secret_abc',
  amount: params.amount,
  currency: params.currency,
  metadata: params.metadata,
  __options: options
}));

jest.mock('stripe', () => jest.fn(() => ({
  paymentIntents: { create: mockStripeCreate, update: jest.fn(async () => ({ id: 'pi_test_123' })) }
})));

const createPaymentIntent = require('../api/checkout/createPaymentIntent');

/** Bare handler app — exercises pricing/contract without the router middleware. */
function buildHandlerApp() {
  const app = express();
  app.use(express.json());
  app.post('/createPaymentIntent', createPaymentIntent);
  return app;
}

/** Seed a catalogue document the same way the store uploader writes it. */
function seedProduct(id, overrides = {}) {
  admin._mocks.docData[`kaaykoproducts/${id}`] = {
    title: 'River Tee',
    description: 'Cotton shirt',
    price: '$$',
    actualPrice: 34.99,
    productID: `legacy_${id}`,
    availableSizes: ['S', 'M', 'L'],
    availableColors: ['blue'],
    maxQuantity: 10,
    isAvailable: true,
    imgSrc: [],
    ...overrides
  };
}

function post(app, body, headers = {}) {
  const req = request(app).post('/createPaymentIntent');
  Object.entries(headers).forEach(([k, v]) => req.set(k, v));
  return req.send(body);
}

beforeEach(() => {
  mockStripeCreate.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Checkout — server is the price authority', () => {
  test('client-supplied price is ignored; the catalogue price is charged', async () => {
    seedProduct('prod-1', { actualPrice: 69.98 });
    const app = buildHandlerApp();

    const res = await post(app, {
      items: [{ productId: 'prod-1', productTitle: 'Free Money Tee', size: 'M', gender: 'Male', price: '$0.50' }]
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.amount).toBe(6998);
    expect(mockStripeCreate).toHaveBeenCalledTimes(1);
    expect(mockStripeCreate.mock.calls[0][0].amount).toBe(6998);
  });

  test('a tampered top-level price field cannot change the total either', async () => {
    seedProduct('prod-1', { actualPrice: 29.99 });
    const app = buildHandlerApp();

    const res = await post(app, {
      items: [{ productId: 'prod-1', size: 'M', price: 1 }],
      price: '$0.01',
      amount: 1
    });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(2999);
    expect(mockStripeCreate.mock.calls[0][0].amount).toBe(2999);
  });

  test('falls back to the price tier symbol when actualPrice is absent', async () => {
    seedProduct('prod-tier', { actualPrice: undefined, price: '$$$' });
    delete admin._mocks.docData['kaaykoproducts/prod-tier'].actualPrice;
    const app = buildHandlerApp();

    const res = await post(app, { items: [{ productId: 'prod-tier', size: 'M' }] });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(3999);
  });

  test('legacy numeric price strings are parsed when actualPrice is absent', async () => {
    seedProduct('prod-legacy-price', { price: '$24.50' });
    delete admin._mocks.docData['kaaykoproducts/prod-legacy-price'].actualPrice;
    const app = buildHandlerApp();

    const res = await post(app, { items: [{ productId: 'prod-legacy-price', size: 'M' }] });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(2450);
  });
});

describe('Checkout — rejections', () => {
  test('unknown product is rejected with 400 PRODUCT_NOT_FOUND', async () => {
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'does-not-exist', size: 'M' }] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PRODUCT_NOT_FOUND');
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });

  test('zero price is rejected', async () => {
    seedProduct('prod-zero', { actualPrice: 0, price: '' });
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'prod-zero', size: 'M' }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PRODUCT_PRICE_UNAVAILABLE');
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });

  test('negative price is rejected', async () => {
    seedProduct('prod-neg', { actualPrice: -50, price: '' });
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'prod-neg', size: 'M' }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PRODUCT_PRICE_UNAVAILABLE');
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });

  test('a product with no resolvable price is rejected, not charged as NaN', async () => {
    seedProduct('prod-nan', { price: 'ask us' });
    delete admin._mocks.docData['kaaykoproducts/prod-nan'].actualPrice;
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'prod-nan', size: 'M' }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PRODUCT_PRICE_UNAVAILABLE');
  });

  test('an unavailable product (isAvailable:false) is rejected', async () => {
    seedProduct('prod-off', { isAvailable: false });
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'prod-off', size: 'M' }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PRODUCT_UNAVAILABLE');
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });

  test('a soft-deleted product (deletedAt set) is rejected', async () => {
    seedProduct('prod-deleted', { deletedAt: new Date().toISOString() });
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'prod-deleted', size: 'M' }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PRODUCT_UNAVAILABLE');
  });

  test('a size not in availableSizes is rejected', async () => {
    seedProduct('prod-size');
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'prod-size', size: 'XXXL' }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_SIZE');
  });

  test('a size in availableSizes is accepted and normalised', async () => {
    seedProduct('prod-size-ok');
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'prod-size-ok', size: 'l' }] });

    expect(res.status).toBe(200);
    expect(res.body.items[0].size).toBe('L');
  });

  test('an unrecognised gender is rejected', async () => {
    seedProduct('prod-gender');
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'prod-gender', size: 'M', gender: 'Dragon' }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_GENDER');
  });

  test('missing fields return the standard 400 error shape', async () => {
    const app = buildHandlerApp();
    const res = await post(app, {});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Bad Request',
      code: 'MISSING_ITEMS'
    });
    expect(typeof res.body.message).toBe('string');
  });

  test('an item without a productId is rejected', async () => {
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ size: 'M', price: '$29.99' }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_PRODUCT_ID');
  });
});

describe('Checkout — quantity and ceilings', () => {
  test('quantity defaults to 1 when absent', async () => {
    seedProduct('prod-q', { actualPrice: 10 });
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'prod-q', size: 'M' }] });

    expect(res.status).toBe(200);
    expect(res.body.items[0].quantity).toBe(1);
    expect(res.body.amount).toBe(1000);
  });

  test('quantity multiplies the server price', async () => {
    seedProduct('prod-q', { actualPrice: 10 });
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'prod-q', size: 'M', quantity: 3 }] });

    expect(res.body.items[0].lineTotalCents).toBe(3000);
    expect(res.body.amount).toBe(3000);
  });

  test('quantity 0 is rejected', async () => {
    seedProduct('prod-q');
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'prod-q', size: 'M', quantity: 0 }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_QUANTITY');
  });

  test('quantity above 10 is rejected', async () => {
    seedProduct('prod-q');
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'prod-q', size: 'M', quantity: 11 }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_QUANTITY');
  });

  test('a fractional quantity is rejected', async () => {
    seedProduct('prod-q');
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'prod-q', size: 'M', quantity: 1.5 }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_QUANTITY');
  });

  test('duplicate lines are merged and the merged quantity is capped', async () => {
    seedProduct('prod-q', { actualPrice: 10 });
    const app = buildHandlerApp();

    const merged = await post(app, {
      items: [
        { productId: 'prod-q', size: 'M', quantity: 2 },
        { productId: 'prod-q', size: 'M', quantity: 3 }
      ]
    });
    expect(merged.status).toBe(200);
    expect(merged.body.items).toHaveLength(1);
    expect(merged.body.items[0].quantity).toBe(5);
    expect(merged.body.amount).toBe(5000);

    const overflow = await post(app, {
      items: [
        { productId: 'prod-q', size: 'M', quantity: 6 },
        { productId: 'prod-q', size: 'M', quantity: 6 }
      ]
    });
    expect(overflow.status).toBe(400);
    expect(overflow.body.code).toBe('INVALID_QUANTITY');
  });

  test('more than 10 line items is rejected', async () => {
    for (let i = 0; i < 11; i++) seedProduct(`bulk-${i}`, { actualPrice: 10 });
    const app = buildHandlerApp();

    const items = Array.from({ length: 11 }, (_, i) => ({ productId: `bulk-${i}`, size: 'M' }));
    const res = await post(app, { items });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TOO_MANY_ITEMS');
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });

  test('a total above the $5000 ceiling is rejected', async () => {
    seedProduct('prod-expensive', { actualPrice: 900 });
    const app = buildHandlerApp();

    const res = await post(app, { items: [{ productId: 'prod-expensive', size: 'M', quantity: 10 }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TOTAL_TOO_LARGE');
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });
});

describe('Checkout — canonical identifier', () => {
  test('the Firestore document id resolves directly', async () => {
    seedProduct('doc-id-1');
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'doc-id-1', size: 'M' }] });

    expect(res.status).toBe(200);
    expect(res.body.items[0].productId).toBe('doc-id-1');
  });

  test('the legacy productID field still resolves, to the canonical doc id', async () => {
    seedProduct('doc-id-2', { productID: 'legacy_abc123' });
    const app = buildHandlerApp();
    const res = await post(app, { items: [{ productId: 'legacy_abc123', size: 'M' }] });

    expect(res.status).toBe(200);
    expect(res.body.items[0].productId).toBe('doc-id-2');
  });
});

describe('Checkout — Firestore contract for the webhook', () => {
  test('payment_intents/{id} carries the full server-computed order', async () => {
    seedProduct('contract-1', { title: 'River Tee', actualPrice: 34.99 });
    seedProduct('contract-2', { title: 'Paddle Hat', actualPrice: 19.5, availableSizes: [] });
    const app = buildHandlerApp();

    const res = await post(app, {
      items: [
        { productId: 'contract-1', size: 'M', gender: 'Male', quantity: 2, price: '$0.01' },
        { productId: 'contract-2', size: '', gender: null }
      ],
      customerEmail: 'buyer@example.com',
      dataRetentionConsent: true
    });

    expect(res.status).toBe(200);

    const doc = admin._mocks.docData['payment_intents/pi_test_123'];
    expect(doc).toBeDefined();

    // Money
    expect(doc.subtotalCents).toBe(6998 + 1950);
    expect(doc.totalCents).toBe(8948);
    expect(doc.currency).toBe('usd');
    expect(doc.itemCount).toBe(2);
    expect(doc.unitCount).toBe(3);

    // Items — exact per-entry shape the webhook reads
    expect(doc.items).toHaveLength(2);
    expect(doc.items[0]).toEqual({
      productId: 'contract-1',
      productTitle: 'River Tee',
      size: 'M',
      gender: 'Male',
      quantity: 2,
      unitPriceCents: 3499,
      lineTotalCents: 6998
    });
    expect(Object.keys(doc.items[0]).sort()).toEqual([
      'gender', 'lineTotalCents', 'productId', 'productTitle', 'quantity', 'size', 'unitPriceCents'
    ]);
    expect(doc.items[1]).toEqual({
      productId: 'contract-2',
      productTitle: 'Paddle Hat',
      size: 'One Size',
      gender: null,
      quantity: 1,
      unitPriceCents: 1950,
      lineTotalCents: 1950
    });

    // Preserved lifecycle / status / timestamp fields
    expect(doc.paymentIntentId).toBe('pi_test_123');
    expect(doc.status).toBe('created');
    expect(doc.paymentStatus).toBe('pending');
    expect(doc.fulfillmentStatus).toBe('awaiting_payment');
    expect(doc.createdAt).toBeDefined();
    expect(doc.updatedAt).toBeDefined();
    expect(doc.paidAt).toBeNull();
    expect(doc.fulfilledAt).toBeNull();
    expect(doc.cancelledAt).toBeNull();
    expect(doc.statusHistory).toHaveLength(1);
    expect(doc.statusHistory[0].status).toBe('created');

    // Legacy aliases still populated for existing readers
    expect(doc.totalAmount).toBe(8948);
    expect(doc.totalAmountFormatted).toBe('$89.48');
  });

  test('the document is written before the client secret is returned', async () => {
    seedProduct('order-1', { actualPrice: 10 });
    const app = buildHandlerApp();

    const res = await post(app, { items: [{ productId: 'order-1', size: 'M' }] });

    expect(res.body.clientSecret).toBe('pi_test_123_secret_abc');
    expect(admin._mocks.docData['payment_intents/pi_test_123']).toBeDefined();
  });

  test('provisional contact fields are nullable and flagged unconfirmed', async () => {
    seedProduct('contact-1', { actualPrice: 10 });
    const app = buildHandlerApp();

    const res = await post(app, {
      items: [{ productId: 'contact-1', size: 'M' }],
      customerEmail: '   ',
      customerPhone: '',
      dataRetentionConsent: 'yes'
    });

    expect(res.status).toBe(200);
    const doc = admin._mocks.docData['payment_intents/pi_test_123'];
    expect(doc.customerEmail).toBeNull();
    expect(doc.customerPhone).toBeNull();
    expect(doc.dataRetentionConsent).toBeNull();
    expect(doc.contactConfirmed).toBe(false);
  });
});

describe('Checkout — Stripe call hygiene', () => {
  test('an idempotency key is passed to paymentIntents.create', async () => {
    seedProduct('idem-1', { actualPrice: 10 });
    const app = buildHandlerApp();
    await post(app, { items: [{ productId: 'idem-1', size: 'M' }] });

    const options = mockStripeCreate.mock.calls[0][1];
    expect(options).toBeDefined();
    expect(typeof options.idempotencyKey).toBe('string');
    expect(options.idempotencyKey.length).toBeGreaterThan(8);
  });

  test('a client-supplied idempotency key is honoured', async () => {
    seedProduct('idem-2', { actualPrice: 10 });
    const app = buildHandlerApp();
    await post(app, {
      items: [{ productId: 'idem-2', size: 'M' }],
      idempotencyKey: 'cart-session-abc12345'
    });

    expect(mockStripeCreate.mock.calls[0][1].idempotencyKey).toBe('kaayko:cart-session-abc12345');
  });

  test('metadata stays small — ids and counts only, no item JSON', async () => {
    seedProduct('meta-1', { actualPrice: 34.99, title: 'A'.repeat(120) });
    const app = buildHandlerApp();
    await post(app, { items: [{ productId: 'meta-1', size: 'M', quantity: 2 }] });

    const metadata = mockStripeCreate.mock.calls[0][0].metadata;
    expect(metadata.lineCount).toBe('1');
    expect(metadata.unitCount).toBe('2');
    expect(metadata.productIds).toBe('meta-1');
    expect(metadata.items).toBeUndefined();
    for (const value of Object.values(metadata)) {
      expect(String(value).length).toBeLessThanOrEqual(500);
    }
  });

  // Regression: the idempotency key is intentionally stable for the same cart
  // and client inside a 5 minute bucket, and Stripe REJECTS a reused key whose
  // request parameters differ. So nothing in the create payload may vary
  // between two identical carts — a wall-clock metadata.timestamp used to,
  // which turned every legitimate retry (back to the bag, then continue again)
  // into a 500.
  test('two identical carts produce byte-identical Stripe create params', async () => {
    seedProduct('stable-1', { actualPrice: 39.99 });
    const app = buildHandlerApp();

    await post(app, { items: [{ productId: 'stable-1', size: 'M' }] });
    await post(app, { items: [{ productId: 'stable-1', size: 'M' }] });

    const [firstParams] = mockStripeCreate.mock.calls[0];
    const [secondParams] = mockStripeCreate.mock.calls[1];
    expect(JSON.stringify(secondParams)).toBe(JSON.stringify(firstParams));
  });

  test('no volatile wall-clock field rides in Stripe metadata', async () => {
    seedProduct('stable-2', { actualPrice: 39.99 });
    const app = buildHandlerApp();
    await post(app, { items: [{ productId: 'stable-2', size: 'M' }] });

    expect(mockStripeCreate.mock.calls[0][0].metadata.timestamp).toBeUndefined();
  });
});

describe('Checkout — router abuse controls', () => {
  test('a non-Kaayko browser origin is refused', async () => {
    const router = require('../api/checkout/router');
    const app = express();
    app.use(express.json());
    app.use('/createPaymentIntent', router);

    seedProduct('origin-1', { actualPrice: 10 });
    const res = await post(app, { items: [{ productId: 'origin-1', size: 'M' }] }, {
      Origin: 'https://evil.example.com'
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  test('a Kaayko origin is allowed through', async () => {
    const router = require('../api/checkout/router');
    const app = express();
    app.use(express.json());
    app.use('/createPaymentIntent', router);

    seedProduct('origin-2', { actualPrice: 10 });
    const res = await post(app, { items: [{ productId: 'origin-2', size: 'M' }] }, {
      Origin: 'https://kaayko.com'
    });

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://kaayko.com');
  });

  test('per-IP rate limiting returns 429 once the window budget is spent', async () => {
    let router;
    jest.isolateModules(() => { router = require('../api/checkout/router'); });

    const app = express();
    app.use(express.json());
    app.use('/createPaymentIntent', router);

    seedProduct('rl-1', { actualPrice: 10 });

    const statuses = [];
    for (let i = 0; i < 17; i++) {
      const res = await request(app)
        .post('/createPaymentIntent')
        .set('X-Forwarded-For', '203.0.113.9')
        .send({ items: [{ productId: 'rl-1', size: 'M' }] });
      statuses.push(res.status);
      // The mock Firestore is reset between tests, not between requests.
      seedProduct('rl-1', { actualPrice: 10 });
    }

    expect(statuses.slice(0, 15).every(s => s === 200)).toBe(true);
    expect(statuses.slice(15).every(s => s === 429)).toBe(true);
  });
});
