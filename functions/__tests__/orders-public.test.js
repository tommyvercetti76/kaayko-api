/**
 * api/orders/router.js — the customer's own order, without an account.
 * A wrong token or number is a 404 indistinguishable from a missing order.
 */
require('./helpers/mockSetup');
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
const request = require('supertest');
const express = require('express');
const admin = require('firebase-admin');

const RETRIEVE = { value: null, calls: 0 };
jest.mock('stripe', () => jest.fn(() => ({
  paymentIntents: {
    retrieve: jest.fn(async (id) => {
      // eslint-disable-next-line global-require
      const state = require('./orders-public.state');
      state.calls += 1;
      if (!state.value) { const e = new Error('No such payment_intent'); e.statusCode = 404; throw e; }
      return { id, ...state.value };
    })
  }
})));
jest.mock('./orders-public.state', () => ({ value: null, calls: 0 }), { virtual: true });
const stripeState = require('./orders-public.state');

const PI = 'pi_pub_order_1';
const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH';

function app() {
  const a = express();
  a.use('/orders', require('../api/orders/router'));
  return a;
}

function seed({ token = TOKEN, orderNumber = 'KAAY-1042', extraPi = {}, lines } = {}) {
  admin._mocks.docData[`payment_intents/${PI}`] = {
    paymentIntentId: PI, orderNumber, statusToken: token,
    paymentStatus: 'paid', fulfillmentStatus: 'processing',
    subtotalCents: 2598, taxCents: 0, totalCents: 2598, currency: 'usd', refundedCents: 0,
    paidAt: '2026-09-13T10:00:00.000Z',
    shippingAddress: { name: 'Priya S', line1: '1 Lake Rd', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' },
    customerEmail: 'priya@example.com',
    ...extraPi
  };
  const defaults = [
    { parentOrderId: PI, orderNumber, itemIndex: 1, productTitle: 'Gaur Magnet', size: 'One Size', gender: null, quantity: 1, lineTotalCents: 599, imgSrc: 'https://firebasestorage.googleapis.com/v0/b/x/o/gaur.webp', orderStatus: 'processing', trackingNumber: null },
    { parentOrderId: PI, orderNumber, itemIndex: 2, productTitle: 'Nagpur', size: 'M', gender: 'Unisex', quantity: 1, lineTotalCents: 1999, imgSrc: null, orderStatus: 'processing' }
  ];
  (lines || defaults).forEach((l, i) => { admin._mocks.docData[`orders/${PI}_item${i + 1}`] = l; });
}

beforeEach(() => { stripeState.value = null; stripeState.calls = 0; });

describe('GET /orders/:number', () => {
  test('the receipt token opens the order: lines, images, money, city — never the street', async () => {
    seed();
    const res = await request(app()).get(`/orders/KAAY-1042?t=${TOKEN}`);
    expect(res.status).toBe(200);
    const o = res.body.order;
    expect(o.orderNumber).toBe('KAAY-1042');
    expect(o.status).toBe('making');
    expect(o.totalCents).toBe(2598);
    expect(o.items).toHaveLength(2);
    expect(o.items[0]).toMatchObject({ productTitle: 'Gaur Magnet', lineTotalCents: 599, imgSrc: 'https://firebasestorage.googleapis.com/v0/b/x/o/gaur.webp' });
    expect(o.items[1].imgSrc).toBeNull();
    expect(o.shipTo).toEqual({ name: 'Priya S', city: 'Austin', state: 'TX', country: 'US' });
    expect(JSON.stringify(res.body)).not.toContain('1 Lake Rd');
    expect(JSON.stringify(res.body)).not.toContain('priya@example.com');
    expect(JSON.stringify(res.body)).not.toContain(PI);
    expect(o.tracking).toBeNull();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('lower-case number is accepted; wrong token, unknown number and malformed input are all 404', async () => {
    seed();
    expect((await request(app()).get(`/orders/kaay-1042?t=${TOKEN}`)).status).toBe(200);
    expect((await request(app()).get(`/orders/KAAY-1042?t=${TOKEN.slice(0, -1)}x`)).status).toBe(404);
    expect((await request(app()).get(`/orders/KAAY-1042`)).status).toBe(404);
    expect((await request(app()).get(`/orders/KAAY-9999?t=${TOKEN}`)).status).toBe(404);
    expect((await request(app()).get(`/orders/${PI}?t=${TOKEN}`)).status).toBe(404);
  });

  test('status follows the lines: shipped with tracking, cancelled, refunded', async () => {
    seed({ lines: [
      { parentOrderId: PI, itemIndex: 1, productTitle: 'A', quantity: 1, lineTotalCents: 599, orderStatus: 'shipped', trackingNumber: '9400 1234', carrier: 'USPS', trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=94001234', shippedAt: '2026-09-15T00:00:00.000Z' }
    ] });
    let res = await request(app()).get(`/orders/KAAY-1042?t=${TOKEN}`);
    expect(res.body.order.status).toBe('shipped');
    expect(res.body.order.tracking).toEqual({ carrier: 'USPS', number: '9400 1234', url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=94001234' });
    expect(res.body.order.shippedAt).toBe('2026-09-15T00:00:00.000Z');

    seed({ lines: [{ parentOrderId: PI, itemIndex: 1, productTitle: 'A', quantity: 1, lineTotalCents: 599, orderStatus: 'cancelled' }] });
    res = await request(app()).get(`/orders/KAAY-1042?t=${TOKEN}`);
    expect(res.body.order.status).toBe('cancelled');

    seed({ extraPi: { paymentStatus: 'refunded', refundedCents: 2598 }, lines: [{ parentOrderId: PI, itemIndex: 1, productTitle: 'A', quantity: 1, lineTotalCents: 599, orderStatus: 'cancelled' }] });
    res = await request(app()).get(`/orders/KAAY-1042?t=${TOKEN}`);
    expect(res.body.order.status).toBe('refunded');
    expect(res.body.order.refundedCents).toBe(2598);
  });
});

describe('POST /orders/lookup', () => {
  test('the client secret Stripe put in the return URL yields the number and the link', async () => {
    seed();
    stripeState.value = { client_secret: `${PI}_secret_abc`, status: 'succeeded' };
    const res = await request(app()).post('/orders/lookup').send({ paymentIntentId: PI, clientSecret: `${PI}_secret_abc` });
    expect(res.status).toBe(200);
    expect(res.body.orderNumber).toBe('KAAY-1042');
    expect(res.body.statusPath).toBe(`/order/KAAY-1042?t=${TOKEN}`);
    expect(res.body.statusUrl).toBe(`https://kaay.store/order/KAAY-1042?t=${TOKEN}`);
    expect(stripeState.calls).toBe(1);
  });

  test('a paid intent the webhook has not processed yet answers pending, not 404', async () => {
    stripeState.value = { client_secret: `${PI}_secret_abc` };
    const res = await request(app()).post('/orders/lookup').send({ paymentIntentId: PI, clientSecret: `${PI}_secret_abc` });
    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(true);
    expect(res.body.orderNumber).toBeUndefined();
  });

  test('a wrong or malformed secret never reaches Stripe or the order', async () => {
    seed();
    stripeState.value = { client_secret: `${PI}_secret_abc` };
    expect((await request(app()).post('/orders/lookup').send({ paymentIntentId: PI, clientSecret: `${PI}_secret_WRONG` })).status).toBe(404);
    expect(stripeState.calls).toBe(1);
    expect((await request(app()).post('/orders/lookup').send({ paymentIntentId: PI, clientSecret: 'nope' })).status).toBe(404);
    expect((await request(app()).post('/orders/lookup').send({ paymentIntentId: 'x', clientSecret: 'x_secret_1' })).status).toBe(404);
    expect(stripeState.calls).toBe(1);   // malformed input short-circuits before Stripe
  });
});
