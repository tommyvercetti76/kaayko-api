/**
 * Sales tax via Stripe Tax — POST /createPaymentIntent/tax, calculateTax and
 * recordTaxTransaction. Stripe is mocked at the module boundary throughout.
 */

require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const admin = require('firebase-admin');

// ─── Stripe mock ─────────────────────────────────────────────────────────────
const mockCalcCreate = jest.fn();
const mockTxnCreate = jest.fn();
const mockPiUpdate = jest.fn(async (id, params) => ({ id, ...params }));
const mockPiCreate = jest.fn(async (params) => ({
  id: 'pi_created_1',
  client_secret: 'pi_created_1_secret',
  amount: params.amount,
  currency: params.currency,
  metadata: params.metadata
}));

jest.mock('stripe', () => jest.fn(() => ({
  paymentIntents: { create: mockPiCreate, update: mockPiUpdate },
  tax: {
    calculations: { create: mockCalcCreate },
    transactions: { createFromCalculation: mockTxnCreate }
  }
})));

const tax = require('../api/checkout/tax');
const { applyTaxHandler, calculateTax, recordTaxTransaction, TaxError, DEFAULT_TAX_CODE } = tax;

// ─── Fixtures ────────────────────────────────────────────────────────────────
const PI_ID = 'pi_3TaxTest0000000001';

const US_ADDRESS = {
  line1: '5205 Tuskegee Trail',
  line2: '',
  city: 'McKinney',
  state: 'TX',
  postal_code: '75070',
  country: 'US'
};

function seedIntent(overrides = {}) {
  admin._mocks.docData[`payment_intents/${PI_ID}`] = {
    paymentIntentId: PI_ID,
    items: [{
      productId: 'prod-1', productTitle: 'River Tee', size: 'M', gender: 'Male',
      quantity: 2, unitPriceCents: 3499, lineTotalCents: 6998
    }],
    subtotalCents: 6998,
    taxCents: 0,
    totalCents: 6998,
    taxStatus: 'not_calculated',
    taxCalculationId: null,
    currency: 'usd',
    status: 'created',
    paymentStatus: 'pending',
    ...overrides
  };
  return admin._mocks.docData[`payment_intents/${PI_ID}`];
}

/** What Stripe Tax answers for a $69.98 apparel order shipped to McKinney, TX. */
function calcResponse(overrides = {}) {
  return {
    id: 'taxcalc_test_1',
    object: 'tax.calculation',
    currency: 'usd',
    amount_total: 7575,
    tax_amount_exclusive: 577,
    tax_amount_inclusive: 0,
    expires_at: 1_760_000_000,
    tax_breakdown: [
      {
        amount: 437, inclusive: false, taxable_amount: 6998, taxability_reason: 'standard_rated',
        tax_rate_details: { country: 'US', state: 'TX', percentage_decimal: '6.25', rate_type: 'percentage', tax_type: 'sales_tax', flat_amount: null }
      },
      {
        amount: 140, inclusive: false, taxable_amount: 6998, taxability_reason: 'standard_rated',
        tax_rate_details: { country: 'US', state: 'TX', percentage_decimal: '2.0', rate_type: 'percentage', tax_type: 'sales_tax', flat_amount: null }
      }
    ],
    ...overrides
  };
}

function buildHandlerApp() {
  const app = express();
  app.use(express.json());
  app.post('/tax', applyTaxHandler);
  return app;
}

function postTax(app, body, headers = {}) {
  const req = request(app).post('/tax');
  Object.entries(headers).forEach(([k, v]) => req.set(k, v));
  return req.send(body);
}

function enableTax() { process.env.STRIPE_TAX_ENABLED = 'true'; }
function disableTax() { delete process.env.STRIPE_TAX_ENABLED; }

beforeEach(() => {
  mockCalcCreate.mockReset();
  mockTxnCreate.mockReset();
  mockPiUpdate.mockClear();
  mockPiCreate.mockClear();
  mockCalcCreate.mockResolvedValue(calcResponse());
  mockTxnCreate.mockResolvedValue({ id: 'tax_txn_test_1', object: 'tax.transaction', reference: PI_ID });
  disableTax();
});

afterAll(() => disableTax());

// ─────────────────────────────────────────────────────────────────────────────

describe('Tax route — feature flag OFF (default)', () => {
  test('returns enabled:false with the subtotal and never calls Stripe', async () => {
    seedIntent();
    const res = await postTax(buildHandlerApp(), { paymentIntentId: PI_ID, address: US_ADDRESS });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      enabled: false,
      paymentIntentId: PI_ID,
      subtotalCents: 6998,
      taxCents: 0,
      totalCents: 6998,
      breakdown: []
    });
    expect(mockCalcCreate).not.toHaveBeenCalled();
    expect(mockPiUpdate).not.toHaveBeenCalled();
  });

  test('"false", "1" and "TRUE " are handled: only the literal true switches it on', async () => {
    seedIntent();
    for (const value of ['false', '1', 'yes', '']) {
      process.env.STRIPE_TAX_ENABLED = value;
      expect(tax.isTaxEnabled()).toBe(false);
    }
    process.env.STRIPE_TAX_ENABLED = ' TRUE ';
    expect(tax.isTaxEnabled()).toBe(true);
  });

  test('still records the shipping address on the payment intent (no Stripe call)', async () => {
    seedIntent();
    await postTax(buildHandlerApp(), { paymentIntentId: PI_ID, address: { ...US_ADDRESS, name: 'Rohan R' } });

    const doc = admin._mocks.docData[`payment_intents/${PI_ID}`];
    expect(doc.shippingAddress).toEqual({
      name: 'Rohan R', line1: '5205 Tuskegee Trail', line2: null, city: 'McKinney',
      state: 'TX', postal_code: '75070', country: 'US'
    });
    expect(doc.taxStatus).toBe('disabled');
    expect(doc.taxCents).toBe(0);
    expect(doc.totalCents).toBe(6998);
  });

  test('a non-US address is rejected server-side even when tax is off', async () => {
    seedIntent();
    const res = await postTax(buildHandlerApp(), {
      paymentIntentId: PI_ID,
      address: { ...US_ADDRESS, country: 'CA', state: 'ON', postal_code: '75070' }
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ADDRESS_COUNTRY_NOT_SUPPORTED');
    expect(mockCalcCreate).not.toHaveBeenCalled();
  });

  test('an unknown payment intent is 404', async () => {
    const res = await postTax(buildHandlerApp(), { paymentIntentId: 'pi_doesNotExist00001', address: US_ADDRESS });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PAYMENT_INTENT_NOT_FOUND');
  });
});

describe('Tax route — feature flag ON', () => {
  beforeEach(enableTax);

  test('calculates tax, raises the PaymentIntent amount and records everything', async () => {
    seedIntent();
    const res = await postTax(buildHandlerApp(), { paymentIntentId: PI_ID, address: US_ADDRESS });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      enabled: true,
      paymentIntentId: PI_ID,
      currency: 'usd',
      subtotalCents: 6998,
      taxCents: 577,
      totalCents: 7575
    });
    expect(res.body.breakdown).toHaveLength(2);
    expect(res.body.breakdown[0]).toEqual({
      amountCents: 437, taxableAmountCents: 6998, inclusive: false, taxabilityReason: 'standard_rated',
      ratePercent: '6.25', rateType: 'percentage', taxType: 'sales_tax', country: 'US', state: 'TX'
    });

    // Stripe Tax request shape
    expect(mockCalcCreate).toHaveBeenCalledTimes(1);
    const params = mockCalcCreate.mock.calls[0][0];
    expect(params.currency).toBe('usd');
    expect(params.line_items).toEqual([{
      amount: 6998, quantity: 2, reference: 'prod-1', tax_behavior: 'exclusive', tax_code: DEFAULT_TAX_CODE
    }]);
    expect(params.customer_details.address_source).toBe('shipping');
    expect(params.customer_details.address).toMatchObject({
      line1: '5205 Tuskegee Trail', city: 'McKinney', state: 'TX', postal_code: '75070', country: 'US'
    });

    // PaymentIntent amount update — the number the card is charged
    expect(mockPiUpdate).toHaveBeenCalledTimes(1);
    const [updatedId, updateParams] = mockPiUpdate.mock.calls[0];
    expect(updatedId).toBe(PI_ID);
    expect(updateParams.amount).toBe(7575);
    expect(updateParams.metadata).toMatchObject({
      taxCalculationId: 'taxcalc_test_1',
      taxCents: '577',
      totalCents: '7575',
      subtotalCents: '6998',
      taxState: 'TX'
    });

    // Firestore record
    const doc = admin._mocks.docData[`payment_intents/${PI_ID}`];
    expect(doc.taxCents).toBe(577);
    expect(doc.totalCents).toBe(7575);
    expect(doc.totalAmount).toBe(7575);
    expect(doc.totalAmountFormatted).toBe('$75.75');
    expect(doc.subtotalCents).toBe(6998);
    expect(doc.taxCalculationId).toBe('taxcalc_test_1');
    expect(doc.taxStatus).toBe('calculated');
    expect(doc.taxJurisdiction).toMatchObject({
      country: 'US', state: 'TX', postalCode: '75070', taxable: true, combinedRatePercent: 8.25,
      taxTypes: ['sales_tax'], reasons: ['standard_rated'], components: 2
    });
    expect(doc.taxBreakdown).toHaveLength(2);
    expect(doc.shippingAddress).toMatchObject({ line1: '5205 Tuskegee Trail', state: 'TX', country: 'US' });
    expect(doc.taxCalculationExpiresAt).toBe(new Date(1_760_000_000 * 1000).toISOString());
    // The webhook's contract fields are untouched
    expect(doc.items).toHaveLength(1);
    expect(doc.paymentStatus).toBe('pending');
  });

  test('a product taxCode on the stored item overrides the apparel default', async () => {
    seedIntent({
      items: [
        { productId: 'prod-1', quantity: 1, unitPriceCents: 3499, lineTotalCents: 3499, taxCode: 'txcd_99999999' },
        { productId: 'prod-2', quantity: 1, unitPriceCents: 3499, lineTotalCents: 3499 }
      ]
    });
    const res = await postTax(buildHandlerApp(), { paymentIntentId: PI_ID, address: US_ADDRESS });

    expect(res.status).toBe(200);
    const lines = mockCalcCreate.mock.calls[0][0].line_items;
    expect(lines[0].tax_code).toBe('txcd_99999999');
    expect(lines[1].tax_code).toBe(DEFAULT_TAX_CODE);
  });

  test('the same product in two sizes gets unique Stripe line references', async () => {
    seedIntent({
      items: [
        { productId: 'prod-1', size: 'M', quantity: 1, unitPriceCents: 3499, lineTotalCents: 3499 },
        { productId: 'prod-1', size: 'L', quantity: 1, unitPriceCents: 3499, lineTotalCents: 3499 }
      ]
    });
    await postTax(buildHandlerApp(), { paymentIntentId: PI_ID, address: US_ADDRESS });

    const refs = mockCalcCreate.mock.calls[0][0].line_items.map(l => l.reference);
    expect(refs).toEqual(['prod-1', 'prod-1#2']);
  });

  test('a lower-case country/state is normalised rather than rejected', async () => {
    seedIntent();
    const res = await postTax(buildHandlerApp(), {
      paymentIntentId: PI_ID,
      address: { ...US_ADDRESS, country: 'us', state: 'tx' }
    });
    expect(res.status).toBe(200);
    expect(mockCalcCreate.mock.calls[0][0].customer_details.address).toMatchObject({ country: 'US', state: 'TX' });
  });

  test('a non-US address is rejected before any Stripe call', async () => {
    seedIntent();
    const res = await postTax(buildHandlerApp(), {
      paymentIntentId: PI_ID,
      address: { line1: '1 Rue de Rivoli', city: 'Paris', state: 'ID', postal_code: '75001', country: 'FR' }
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ADDRESS_COUNTRY_NOT_SUPPORTED');
    expect(mockCalcCreate).not.toHaveBeenCalled();
    expect(mockPiUpdate).not.toHaveBeenCalled();
  });

  test.each([
    ['missing line1', { ...US_ADDRESS, line1: '' }],
    ['missing city', { ...US_ADDRESS, city: '' }],
    ['spelled-out state', { ...US_ADDRESS, state: 'Texas' }],
    ['bad ZIP', { ...US_ADDRESS, postal_code: 'ABCDE' }],
    ['not an object', 'McKinney TX'],
    ['array', [US_ADDRESS]]
  ])('an invalid address (%s) is 400 INVALID_ADDRESS', async (_label, address) => {
    seedIntent();
    const res = await postTax(buildHandlerApp(), { paymentIntentId: PI_ID, address });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ADDRESS');
    expect(mockCalcCreate).not.toHaveBeenCalled();
  });

  test('ZIP+4 is accepted', async () => {
    seedIntent();
    const res = await postTax(buildHandlerApp(), { paymentIntentId: PI_ID, address: { ...US_ADDRESS, postal_code: '75070-1234' } });
    expect(res.status).toBe(200);
  });

  test('a malformed paymentIntentId is 400', async () => {
    const res = await postTax(buildHandlerApp(), { paymentIntentId: '../orders/abc', address: US_ADDRESS });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PAYMENT_INTENT_ID');
  });

  test('a payment that already succeeded is 409 and Stripe is not touched', async () => {
    seedIntent({ status: 'succeeded', paymentStatus: 'succeeded' });
    const res = await postTax(buildHandlerApp(), { paymentIntentId: PI_ID, address: US_ADDRESS });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAYMENT_ALREADY_COMPLETED');
    expect(mockCalcCreate).not.toHaveBeenCalled();
    expect(mockPiUpdate).not.toHaveBeenCalled();
  });

  test('a legacy intent with no server-priced items is 422', async () => {
    seedIntent({ items: [] });
    const res = await postTax(buildHandlerApp(), { paymentIntentId: PI_ID, address: US_ADDRESS });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PAYMENT_INTENT_NOT_PRICED');
  });

  test('Stripe Tax failure → 502, and the shopper is NOT left on the un-taxed amount', async () => {
    seedIntent();
    mockCalcCreate.mockRejectedValueOnce(Object.assign(new Error('Stripe Tax has not been activated'), { code: 'tax_not_active' }));
    const res = await postTax(buildHandlerApp(), { paymentIntentId: PI_ID, address: US_ADDRESS });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('TAX_CALCULATION_FAILED');
    expect(mockPiUpdate).not.toHaveBeenCalled();

    const doc = admin._mocks.docData[`payment_intents/${PI_ID}`];
    expect(doc.taxCents).toBe(0);
    expect(doc.totalCents).toBe(6998);
    expect(doc.taxCalculationId).toBeNull();
    expect(doc.taxStatus).toBe('not_calculated');
  });

  test('a calculation whose total does not add up is refused (502), never charged', async () => {
    seedIntent();
    mockCalcCreate.mockResolvedValueOnce(calcResponse({ amount_total: 9999 }));
    const res = await postTax(buildHandlerApp(), { paymentIntentId: PI_ID, address: US_ADDRESS });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('TAX_CALCULATION_FAILED');
    expect(mockPiUpdate).not.toHaveBeenCalled();
  });

  test('Stripe refusing the amount change (already confirmed) → 409', async () => {
    seedIntent();
    mockPiUpdate.mockRejectedValueOnce(Object.assign(
      new Error('The PaymentIntent has already succeeded and cannot be updated'),
      { code: 'payment_intent_unexpected_state', type: 'StripeInvalidRequestError', statusCode: 400 }
    ));
    const res = await postTax(buildHandlerApp(), { paymentIntentId: PI_ID, address: US_ADDRESS });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAYMENT_ALREADY_CONFIRMED');
    const doc = admin._mocks.docData[`payment_intents/${PI_ID}`];
    expect(doc.taxCents).toBe(0);
    expect(doc.totalCents).toBe(6998);
    expect(doc.taxCalculationId).toBeNull();
  });

  test('any other failure applying the amount → 502 TAX_APPLY_FAILED', async () => {
    seedIntent();
    mockPiUpdate.mockRejectedValueOnce(new Error('connection reset'));
    const res = await postTax(buildHandlerApp(), { paymentIntentId: PI_ID, address: US_ADDRESS });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('TAX_APPLY_FAILED');
    expect(admin._mocks.docData[`payment_intents/${PI_ID}`].totalCents).toBe(6998);
  });

  test('a zero-tax jurisdiction still applies cleanly (amount unchanged, taxable:false)', async () => {
    seedIntent();
    mockCalcCreate.mockResolvedValueOnce(calcResponse({
      amount_total: 6998,
      tax_amount_exclusive: 0,
      tax_breakdown: [{
        amount: 0, inclusive: false, taxable_amount: 6998, taxability_reason: 'not_collecting',
        tax_rate_details: { country: 'US', state: 'OR', percentage_decimal: '0.0', rate_type: null, tax_type: null, flat_amount: null }
      }]
    }));
    const res = await postTax(buildHandlerApp(), { paymentIntentId: PI_ID, address: { ...US_ADDRESS, state: 'OR', city: 'Portland', postal_code: '97201' } });

    expect(res.status).toBe(200);
    expect(res.body.taxCents).toBe(0);
    expect(res.body.totalCents).toBe(6998);
    expect(mockPiUpdate.mock.calls[0][1].amount).toBe(6998);
    expect(admin._mocks.docData[`payment_intents/${PI_ID}`].taxJurisdiction).toMatchObject({
      taxable: false, combinedRatePercent: 0, reasons: ['not_collecting']
    });
  });
});

describe('Tax route — mounted behind the checkout router', () => {
  function buildRouterApp() {
    const app = express();
    app.use(express.json());
    app.use('/createPaymentIntent', require('../api/checkout/router'));
    return app;
  }

  test('a non-Kaayko browser origin is refused', async () => {
    seedIntent();
    const res = await request(buildRouterApp())
      .post('/createPaymentIntent/tax')
      .set('Origin', 'https://evil.example.com')
      .set('X-Forwarded-For', '198.51.100.10')
      .send({ paymentIntentId: PI_ID, address: US_ADDRESS });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  test('a Kaayko origin reaches the handler with CORS headers', async () => {
    seedIntent();
    const res = await request(buildRouterApp())
      .post('/createPaymentIntent/tax')
      .set('Origin', 'https://kaay.store')
      .set('X-Forwarded-For', '198.51.100.11')
      .send({ paymentIntentId: PI_ID, address: US_ADDRESS });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.headers['access-control-allow-origin']).toBe('https://kaay.store');
  });

  test('OPTIONS preflight is answered', async () => {
    const res = await request(buildRouterApp())
      .options('/createPaymentIntent/tax')
      .set('Origin', 'https://kaayko.com');
    expect(res.status).toBe(204);
  });

  test('shares the per-IP checkout rate limit (429 after the window budget)', async () => {
    let router;
    jest.isolateModules(() => { router = require('../api/checkout/router'); });
    const app = express();
    app.use(express.json());
    app.use('/createPaymentIntent', router);

    seedIntent();
    const statuses = [];
    for (let i = 0; i < 17; i++) {
      const res = await request(app)
        .post('/createPaymentIntent/tax')
        .set('X-Forwarded-For', '203.0.113.77')
        .send({ paymentIntentId: PI_ID, address: US_ADDRESS });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 15).every(s => s === 200)).toBe(true);
    expect(statuses.slice(15).every(s => s === 429)).toBe(true);
  });
});

describe('calculateTax()', () => {
  test('returns cents, breakdown and a jurisdiction summary', async () => {
    const result = await calculateTax({
      items: [{ productId: 'prod-1', quantity: 2, lineTotalCents: 6998 }],
      address: US_ADDRESS
    });

    expect(result).toMatchObject({
      calculationId: 'taxcalc_test_1',
      subtotalCents: 6998,
      taxCents: 577,
      totalCents: 7575,
      currency: 'usd'
    });
    expect(result.breakdown).toHaveLength(2);
    expect(result.jurisdiction.combinedRatePercent).toBe(8.25);
  });

  test('rejects a non-US address without calling Stripe', async () => {
    await expect(calculateTax({
      items: [{ productId: 'prod-1', quantity: 1, lineTotalCents: 100 }],
      address: { ...US_ADDRESS, country: 'GB' }
    })).rejects.toMatchObject({ name: 'TaxError', code: 'ADDRESS_COUNTRY_NOT_SUPPORTED' });
    expect(mockCalcCreate).not.toHaveBeenCalled();
  });

  test.each([
    ['empty items', []],
    ['missing productId', [{ quantity: 1, lineTotalCents: 100 }]],
    ['zero amount', [{ productId: 'p', quantity: 1, lineTotalCents: 0 }]],
    ['fractional amount', [{ productId: 'p', quantity: 1, lineTotalCents: 10.5 }]],
    ['zero quantity', [{ productId: 'p', quantity: 0, lineTotalCents: 100 }]]
  ])('refuses malformed items (%s)', async (_label, items) => {
    await expect(calculateTax({ items, address: US_ADDRESS }))
      .rejects.toMatchObject({ code: 'TAX_ITEMS_INVALID' });
    expect(mockCalcCreate).not.toHaveBeenCalled();
  });

  test('wraps a Stripe failure as TAX_CALCULATION_FAILED and keeps the Stripe code', async () => {
    mockCalcCreate.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'api_error' }));
    await expect(calculateTax({
      items: [{ productId: 'p', quantity: 1, lineTotalCents: 100 }],
      address: US_ADDRESS
    })).rejects.toMatchObject({ code: 'TAX_CALCULATION_FAILED', stripeCode: 'api_error' });
  });

  test.each([
    ['no id', { id: null }],
    ['wrong currency', { currency: 'eur' }],
    ['inclusive tax reported', { tax_amount_inclusive: 5 }],
    ['negative tax', { tax_amount_exclusive: -1, amount_total: 6997 }],
    ['total mismatch', { amount_total: 7000 }]
  ])('refuses an unusable calculation (%s)', async (_label, overrides) => {
    mockCalcCreate.mockResolvedValueOnce(calcResponse(overrides));
    await expect(calculateTax({
      items: [{ productId: 'p', quantity: 2, lineTotalCents: 6998 }],
      address: US_ADDRESS
    })).rejects.toMatchObject({ code: 'TAX_CALCULATION_UNUSABLE' });
  });

  test('accepts an injected Stripe client', async () => {
    const client = { tax: { calculations: { create: jest.fn(async () => calcResponse()) } } };
    const result = await calculateTax({
      items: [{ productId: 'p', quantity: 2, lineTotalCents: 6998 }],
      address: US_ADDRESS
    }, { stripe: client });
    expect(client.tax.calculations.create).toHaveBeenCalledTimes(1);
    expect(mockCalcCreate).not.toHaveBeenCalled();
    expect(result.taxCents).toBe(577);
  });
});

describe('recordTaxTransaction()', () => {
  function succeededIntent(overrides = {}) {
    return {
      id: PI_ID,
      amount: 7575,
      currency: 'usd',
      status: 'succeeded',
      metadata: { taxCalculationId: 'taxcalc_test_1', totalCents: '7575', taxCents: '577' },
      ...overrides
    };
  }

  test('creates the Stripe Tax transaction from the calculation, keyed by the PaymentIntent id', async () => {
    seedIntent({ status: 'succeeded', paymentStatus: 'succeeded', taxCalculationId: 'taxcalc_test_1' });
    const id = await recordTaxTransaction(succeededIntent());

    expect(id).toBe('tax_txn_test_1');
    expect(mockTxnCreate).toHaveBeenCalledTimes(1);
    const [params, options] = mockTxnCreate.mock.calls[0];
    expect(params).toMatchObject({ calculation: 'taxcalc_test_1', reference: PI_ID });
    expect(options.idempotencyKey).toContain(PI_ID);

    const doc = admin._mocks.docData[`payment_intents/${PI_ID}`];
    expect(doc.taxTransactionId).toBe('tax_txn_test_1');
    expect(doc.taxStatus).toBe('recorded');
  });

  test('is idempotent: a second call returns the stored id without calling Stripe again', async () => {
    seedIntent({ status: 'succeeded', paymentStatus: 'succeeded' });
    const first = await recordTaxTransaction(succeededIntent());
    const second = await recordTaxTransaction(succeededIntent());

    expect(first).toBe('tax_txn_test_1');
    expect(second).toBe('tax_txn_test_1');
    expect(mockTxnCreate).toHaveBeenCalledTimes(1);
  });

  test('returns null and does nothing when the PaymentIntent carries no taxCalculationId', async () => {
    seedIntent({ status: 'succeeded', paymentStatus: 'succeeded' });
    const id = await recordTaxTransaction(succeededIntent({ metadata: { source: 'kaayko-store' } }));

    expect(id).toBeNull();
    expect(mockTxnCreate).not.toHaveBeenCalled();
    expect(admin._mocks.docData[`payment_intents/${PI_ID}`].taxTransactionId).toBeUndefined();
  });

  test('refuses to file tax when the charged amount is not the taxed total', async () => {
    seedIntent({ status: 'succeeded', paymentStatus: 'succeeded' });
    await expect(recordTaxTransaction(succeededIntent({ amount: 6998 })))
      .rejects.toMatchObject({ name: 'TaxError', code: 'TAX_AMOUNT_MISMATCH' });
    expect(mockTxnCreate).not.toHaveBeenCalled();
  });

  test('a Stripe failure surfaces as TAX_TRANSACTION_FAILED and nothing is recorded', async () => {
    seedIntent({ status: 'succeeded', paymentStatus: 'succeeded' });
    mockTxnCreate.mockRejectedValueOnce(new Error('rate limited'));

    await expect(recordTaxTransaction(succeededIntent())).rejects.toMatchObject({ code: 'TAX_TRANSACTION_FAILED' });
    expect(admin._mocks.docData[`payment_intents/${PI_ID}`].taxTransactionId).toBeUndefined();

    // …and the retry (e.g. Stripe redelivering the webhook) then succeeds.
    const id = await recordTaxTransaction(succeededIntent());
    expect(id).toBe('tax_txn_test_1');
  });

  test('works even when our payment_intents document is missing (metadata is authoritative)', async () => {
    const id = await recordTaxTransaction(succeededIntent());
    expect(id).toBe('tax_txn_test_1');
    expect(admin._mocks.docData[`payment_intents/${PI_ID}`].taxTransactionId).toBe('tax_txn_test_1');
  });

  test('a PaymentIntent without an id is rejected', async () => {
    await expect(recordTaxTransaction({ metadata: { taxCalculationId: 'x' } }))
      .rejects.toBeInstanceOf(TaxError);
  });
});
