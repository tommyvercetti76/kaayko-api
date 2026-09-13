/**
 * api/admin/orderActions.js — refund and cancel from Kortex, through Stripe.
 * Stripe is mocked; the webhook (tested elsewhere) does the money bookkeeping.
 */
require('./helpers/mockSetup');
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
const request = require('supertest');
const express = require('express');
const admin = require('firebase-admin');

jest.mock('stripe', () => jest.fn(() => ({
  refunds: {
    create: jest.fn(async (params, opts) => {
      // eslint-disable-next-line global-require
      const state = require('./admin-order-actions.state');
      state.calls.push({ params, opts });
      if (state.fail) { const e = new Error(state.fail); e.statusCode = 400; e.raw = { message: state.fail }; throw e; }
      return { id: `re_${state.calls.length}`, amount: params.amount, status: 'succeeded' };
    })
  }
})));
jest.mock('./admin-order-actions.state', () => ({ calls: [], fail: null }), { virtual: true });
const stripeState = require('./admin-order-actions.state');

const { refundOrder, cancelOrder } = require('../api/admin/orderActions');

const PI = 'pi_admin_act_1';

function app() {
  const a = express();
  a.use(express.json());
  const asAdmin = (req, _res, next) => { req.user = { uid: 'admin-uid', email: 'owner@kaayko.com', scope: 'platform' }; next(); };
  a.post('/admin/orders/refund', asAdmin, refundOrder);
  a.post('/admin/orders/cancel', asAdmin, cancelOrder);
  return a;
}

function seed({ lineStatus = 'processing', paymentStatus = 'paid', refundedCents = 0 } = {}) {
  admin._mocks.docData[`payment_intents/${PI}`] = {
    paymentIntentId: PI, orderNumber: 'KAAY-1042', statusToken: 'tok', paymentStatus, refundedCents,
    totalCents: 2598, currency: 'usd', customerEmail: 'buyer@example.com', fulfillmentStatus: 'processing'
  };
  admin._mocks.docData[`orders/${PI}_item1`] = { parentOrderId: PI, itemIndex: 1, orderStatus: lineStatus, lineTotalCents: 599 };
  admin._mocks.docData[`orders/${PI}_item2`] = { parentOrderId: PI, itemIndex: 2, orderStatus: lineStatus, lineTotalCents: 1999 };
}

beforeEach(() => { stripeState.calls.length = 0; stripeState.fail = null; });

describe('POST /admin/orders/refund', () => {
  test('refunds the whole remaining amount through Stripe by default and records who asked', async () => {
    seed();
    const res = await request(app()).post('/admin/orders/refund').send({ parentOrderId: PI, reason: 'wrong size' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, refundId: 're_1', amountCents: 2598, orderNumber: 'KAAY-1042' });
    expect(stripeState.calls[0].params).toMatchObject({ payment_intent: PI, amount: 2598, reason: 'requested_by_customer' });
    expect(stripeState.calls[0].params.metadata).toMatchObject({ orderNumber: 'KAAY-1042', by: 'owner@kaayko.com', note: 'wrong size' });
    expect(stripeState.calls[0].opts.idempotencyKey).toMatch(/^refund_pi_admin_act_1_2598_/);
    const pi = admin._mocks.docData[`payment_intents/${PI}`];
    expect(JSON.stringify(pi.statusHistory)).toContain('owner@kaayko.com requested a refund of 2598 cents');
    // The money itself is NOT written here — that is the webhook's job.
    expect(pi.paymentStatus).toBe('paid');
  });

  test('a partial amount is honoured, and cannot exceed what is left', async () => {
    seed({ paymentStatus: 'partially_refunded', refundedCents: 599 });
    let res = await request(app()).post('/admin/orders/refund').send({ parentOrderId: PI, amountCents: 1000 });
    expect(res.status).toBe(200);
    expect(stripeState.calls[0].params.amount).toBe(1000);

    res = await request(app()).post('/admin/orders/refund').send({ parentOrderId: PI, amountCents: 2000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only 1999 cents/);
    res = await request(app()).post('/admin/orders/refund').send({ parentOrderId: PI, amountCents: 12.5 });
    expect(res.status).toBe(400);
  });

  test('an already-refunded order, an unknown order and a bad id are refused before Stripe', async () => {
    seed({ paymentStatus: 'refunded', refundedCents: 2598 });
    expect((await request(app()).post('/admin/orders/refund').send({ parentOrderId: PI })).status).toBe(409);
    expect((await request(app()).post('/admin/orders/refund').send({ parentOrderId: 'pi_missing_000' })).status).toBe(404);
    expect((await request(app()).post('/admin/orders/refund').send({ parentOrderId: 'nope' })).status).toBe(400);
    expect(stripeState.calls).toHaveLength(0);
  });

  test("Stripe's refusal is surfaced, not swallowed", async () => {
    seed();
    stripeState.fail = 'Charge has already been refunded.';
    const res = await request(app()).post('/admin/orders/refund').send({ parentOrderId: PI });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Charge has already been refunded.');
  });
});

describe('POST /admin/orders/cancel', () => {
  test('before shipping: full refund at Stripe and every line cancelled at once', async () => {
    seed();
    const res = await request(app()).post('/admin/orders/cancel').send({ parentOrderId: PI, reason: 'customer asked' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, refundId: 're_1', refundedCents: 2598, lines: 2 });
    expect(stripeState.calls[0].params).toMatchObject({ payment_intent: PI, amount: 2598 });
    expect(stripeState.calls[0].opts.idempotencyKey).toBe(`cancel_${PI}_2598`);
    for (const n of [1, 2]) {
      const line = admin._mocks.docData[`orders/${PI}_item${n}`];
      expect(line.orderStatus).toBe('cancelled');
      expect(line.fulfillmentStatus).toBe('cancelled');
      expect(line.cancelReason).toBe('customer asked');
    }
    const pi = admin._mocks.docData[`payment_intents/${PI}`];
    expect(pi.fulfillmentStatus).toBe('cancelled');
    expect(JSON.stringify(pi.statusHistory)).toContain('Cancelled by owner@kaayko.com before shipping');
  });

  test('a shipped order is a return, not a cancellation', async () => {
    seed({ lineStatus: 'shipped' });
    const res = await request(app()).post('/admin/orders/cancel').send({ parentOrderId: PI });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/has shipped/);
    expect(stripeState.calls).toHaveLength(0);
    expect(admin._mocks.docData[`orders/${PI}_item1`].orderStatus).toBe('shipped');
  });

  test('already cancelled is refused; already fully refunded cancels without a second refund', async () => {
    seed({ lineStatus: 'cancelled' });
    expect((await request(app()).post('/admin/orders/cancel').send({ parentOrderId: PI })).status).toBe(409);

    seed({ paymentStatus: 'refunded', refundedCents: 2598 });
    const res = await request(app()).post('/admin/orders/cancel').send({ parentOrderId: PI });
    expect(res.status).toBe(200);
    expect(res.body.refundId).toBeNull();
    expect(res.body.refundedCents).toBe(0);
    expect(stripeState.calls).toHaveLength(0);
    expect(admin._mocks.docData[`orders/${PI}_item1`].orderStatus).toBe('cancelled');
  });
});
