/**
 * Refunds and disputes — the webhook events that move money BACK.
 *
 * Without these handlers a refund or chargeback in Stripe left Firestore
 * claiming the order was paid. Each event must update payment_intents/{pi}
 * and every orders/{pi}_item* document, append statusHistory, alert the owner
 * once, and survive Stripe's duplicate deliveries.
 */

require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const admin = require('firebase-admin');

// ─── Stripe mock — never make a live Stripe call ───────────────
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
    charges: {
      retrieve: jest.fn(async (id) => {
        // eslint-disable-next-line global-require
        const state = require('./refunds.state');
        state.calls += 1;
        if (!state.charge) throw new Error('No such charge');
        return { id, ...state.charge };
      })
    }
  }));
});
jest.mock('./refunds.state', () => ({ charge: null, calls: 0 }), { virtual: true });
const stripeState = require('./refunds.state');

const PI_ID = 'pi_refund_1';
const CHARGE_ID = 'ch_refund_1';
const DUE_BY = 1_800_864_000; // unix seconds, as Stripe sends evidence_details.due_by
const DUE_BY_ISO = new Date(DUE_BY * 1000).toISOString();
const ORIGINAL_ENV = { ...process.env };

function buildWebhookApp() {
  const app = express();
  app.use('/webhook', express.raw({ type: 'application/json' }), require('../api/checkout/stripeWebhook'));
  return app;
}

function post(app, event, signature = 'GOOD_SIG') {
  return request(app)
    .post('/webhook')
    .set('stripe-signature', signature)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(event));
}

function mailDocs() {
  return Object.entries(admin._mocks.docData)
    .filter(([path]) => path.startsWith('mail/'))
    .map(([path, data]) => ({ path, data }));
}

/** A paid two-item order as the success webhook leaves it. */
function seedPaidOrder({ fulfillmentStatus = 'processing', orderStatus = 'pending', chargeId = CHARGE_ID } = {}) {
  admin._mocks.docData[`payment_intents/${PI_ID}`] = {
    paymentIntentId: PI_ID, chargeId, currency: 'usd',
    subtotalCents: 13996, totalCents: 13996,
    status: 'succeeded', paymentStatus: 'succeeded', fulfillmentStatus,
    customerEmail: 'buyer@example.com', statusHistory: []
  };
  for (const [n, title] of [[1, 'Straight Outta Sabarmati'], [2, 'Stay Hydrated']]) {
    admin._mocks.docData[`orders/${PI_ID}_item${n}`] = {
      orderId: `${PI_ID}_item${n}`, parentOrderId: PI_ID, itemIndex: n, totalItems: 2,
      productTitle: title, quantity: 2, unitPriceCents: 3499, lineTotalCents: 6998,
      orderStatus, fulfillmentStatus, paymentStatus: 'paid', refundedCents: 0,
      customerEmail: 'buyer@example.com', chargeId, statusHistory: []
    };
  }
}

function chargeRefunded(eventId, { amountRefunded, refunded, reason = 'requested_by_customer', paymentIntent = PI_ID, chargeId = CHARGE_ID, refundId = 're_1' } = {}) {
  return {
    id: eventId, type: 'charge.refunded', created: 1_800_000_000, livemode: false,
    data: {
      object: {
        id: chargeId, object: 'charge', payment_intent: paymentIntent,
        amount: 13996, amount_refunded: amountRefunded, refunded, currency: 'usd',
        metadata: { notifyEmail: 'rohan@kaayko.com', source: 'kaayko-store' },
        refunds: { data: [{ id: refundId, amount: amountRefunded, reason, created: 1_800_000_100, status: 'succeeded' }] }
      }
    }
  };
}

function disputeEvent(type, eventId, overrides = {}) {
  return {
    id: eventId, type, created: 1_800_000_200, livemode: false,
    data: {
      object: {
        id: 'dp_1', object: 'dispute', charge: CHARGE_ID, payment_intent: PI_ID,
        amount: 13996, currency: 'usd', reason: 'fraudulent', status: 'needs_response',
        created: 1_800_000_150,
        evidence_details: { due_by: DUE_BY, has_evidence: false, past_due: false, submission_count: 0 },
        ...overrides
      }
    }
  };
}

function pi() { return admin._mocks.docData[`payment_intents/${PI_ID}`]; }
function item(n) { return admin._mocks.docData[`orders/${PI_ID}_item${n}`]; }

beforeEach(() => {
  stripeState.charge = null;
  stripeState.calls = 0;
  delete process.env.ORDER_NOTIFY_EMAIL;
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ────────────────────────────────────────────────────────────────
describe('charge.refunded — full refund', () => {
  test('marks the payment intent and every line item refunded, cancels unshipped fulfilment, alerts the owner once', async () => {
    seedPaidOrder();
    const app = buildWebhookApp();

    const res = await post(app, chargeRefunded('evt_refund_full', { amountRefunded: 13996, refunded: true }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, refunded: true, paymentStatus: 'refunded', refundedCents: 13996, items: 2, ownerNotified: true });

    expect(pi().paymentStatus).toBe('refunded');
    expect(pi().refundedCents).toBe(13996);
    expect(pi().refundedAt).toBeTruthy();
    expect(pi().lastRefundId).toBe('re_1');
    expect(pi().refundReason).toBe('requested_by_customer');
    expect(pi().chargeId).toBe(CHARGE_ID);
    // Not shipped yet → must not be shipped now.
    expect(pi().fulfillmentStatus).toBe('cancelled');
    expect(pi().statusHistory).toEqual([expect.objectContaining({ status: 'refunded', note: expect.stringContaining('$139.96 of $139.96') })]);

    for (const n of [1, 2]) {
      expect(item(n).paymentStatus).toBe('refunded');
      expect(item(n).refundedCents).toBe(6998);
      expect(item(n).refundedAt).toBe(new Date(1_800_000_100 * 1000).toISOString()); // refund.created, not wall-clock
      expect(item(n).orderStatus).toBe('cancelled');
      expect(item(n).fulfillmentStatus).toBe('cancelled');
      expect(item(n).statusHistory).toEqual([expect.objectContaining({ status: 'refunded' })]);
    }

    const alert = admin._mocks.docData[`mail/${PI_ID}_refund_13996`];
    expect(alert).toBeDefined();
    expect(alert.to).toBe('rohan@kaayko.com'); // charge metadata carries the stamped notify address
    expect(alert.message.subject).toContain('refunded');
    expect(alert.message.html).toContain('$139.96 of $139.96');
    expect(alert.message.html).toContain('do not ship');
    expect(alert.message.html).toContain('buyer@example.com');
    expect(alert.message.html).not.toContain('{{');
    expect(mailDocs()).toHaveLength(1);

    expect(admin._mocks.docData['stripe_events/evt_refund_full']).toMatchObject({ paymentIntentId: PI_ID, paymentStatus: 'refunded' });
  });

  test('a payload without the refunds list expanded (API 2022-11-15+) still records the refund from amount_refunded', async () => {
    seedPaidOrder();
    admin._mocks.docData[`payment_intents/${PI_ID}`].lastRefundId = 're_earlier';
    const event = chargeRefunded('evt_refund_unexpanded', { amountRefunded: 13996, refunded: true });
    delete event.data.object.refunds;

    const res = await post(buildWebhookApp(), event);

    expect(res.body).toMatchObject({ refunded: true, paymentStatus: 'refunded', refundedCents: 13996 });
    expect(pi().paymentStatus).toBe('refunded');
    expect(pi().refundedCents).toBe(13996);
    expect(pi().refundCount).toBeUndefined();        // unknown, not zero
    expect(pi().lastRefundId).toBe('re_earlier');    // not clobbered with null
    // Falls back to the event time for the history entry.
    expect(item(1).refundedAt).toBe(new Date(1_800_000_000 * 1000).toISOString());
    expect(admin._mocks.docData[`mail/${PI_ID}_refund_13996`]).toBeDefined();
  });

  test('a full refund of an order that already shipped is marked refunded but NOT cancelled', async () => {
    seedPaidOrder({ fulfillmentStatus: 'shipped', orderStatus: 'shipped' });

    await post(buildWebhookApp(), chargeRefunded('evt_refund_shipped', { amountRefunded: 13996, refunded: true }));

    expect(pi().paymentStatus).toBe('refunded');
    expect(pi().fulfillmentStatus).toBe('shipped');
    expect(item(1).orderStatus).toBe('shipped');
    expect(item(1).paymentStatus).toBe('refunded');
    expect(admin._mocks.docData[`mail/${PI_ID}_refund_13996`].message.html).toContain('already shipped');
  });

  test('duplicate delivery (same event id) and a replay under a new event id both send nothing more', async () => {
    seedPaidOrder();
    const app = buildWebhookApp();
    const event = chargeRefunded('evt_refund_dup', { amountRefunded: 13996, refunded: true });

    await post(app, event);
    const second = await post(app, event);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);

    const replay = await post(app, chargeRefunded('evt_refund_dup2', { amountRefunded: 13996, refunded: true }));
    expect(replay.status).toBe(200);
    expect(replay.body.ownerNotified).toBe(false);

    expect(mailDocs()).toHaveLength(1);
    expect(pi().refundedCents).toBe(13996);
  });
});

// ────────────────────────────────────────────────────────────────
describe('charge.refunded — partial refund', () => {
  test('marks partially_refunded, splits the amount pro-rata across items and leaves fulfilment alone', async () => {
    seedPaidOrder();

    const res = await post(buildWebhookApp(), chargeRefunded('evt_refund_part', { amountRefunded: 3001, refunded: false, reason: 'duplicate' }));

    expect(res.body).toMatchObject({ refunded: true, paymentStatus: 'partially_refunded', refundedCents: 3001 });
    expect(pi().paymentStatus).toBe('partially_refunded');
    expect(pi().refundedCents).toBe(3001);
    expect(pi().fulfillmentStatus).toBe('processing');

    // Equal lines: 1500.5 each → largest remainder gives the odd cent to item 1.
    expect(item(1).refundedCents).toBe(1501);
    expect(item(2).refundedCents).toBe(1500);
    expect(item(1).refundedCents + item(2).refundedCents).toBe(3001);
    expect(item(1).paymentStatus).toBe('partially_refunded');
    expect(item(1).orderStatus).toBe('pending');

    const alert = admin._mocks.docData[`mail/${PI_ID}_refund_3001`];
    expect(alert.message.subject).toContain('Partial refund');
    expect(alert.message.html).toContain('$30.01 of $139.96');
    expect(alert.message.html).toContain('duplicate');
  });

  test('a second partial refund (new cumulative amount) updates the record and alerts again; the same amount does not', async () => {
    seedPaidOrder();
    const app = buildWebhookApp();

    await post(app, chargeRefunded('evt_p1', { amountRefunded: 2000, refunded: false }));
    await post(app, chargeRefunded('evt_p1_replay', { amountRefunded: 2000, refunded: false }));
    await post(app, chargeRefunded('evt_p2', { amountRefunded: 5000, refunded: false, refundId: 're_2' }));

    expect(pi().refundedCents).toBe(5000);
    expect(pi().lastRefundId).toBe('re_2');
    expect(mailDocs().map(m => m.path).sort()).toEqual([`mail/${PI_ID}_refund_2000`, `mail/${PI_ID}_refund_5000`]);
  });

  test('allocateRefund: pro-rata, capped at each line total, remainder to the first items', () => {
    const { allocateRefund } = require('../api/checkout/stripeWebhook');
    expect(allocateRefund([6998, 6998], 13996)).toEqual([6998, 6998]);
    expect(allocateRefund([6998, 6998], 20000)).toEqual([6998, 6998]); // refund included tax/shipping
    expect(allocateRefund([1000, 3000], 1000)).toEqual([250, 750]);
    expect(allocateRefund([1000, 1000, 1000], 100)).toEqual([34, 33, 33]);
    expect(allocateRefund([0, 0], 500)).toEqual([0, 0]);
    expect(allocateRefund(['$69.98', '$69.98'], 3000)).toEqual([1500, 1500]); // legacy string amounts
    expect(allocateRefund([6998, 6998], 0)).toEqual([0, 0]);
  });
});

// ────────────────────────────────────────────────────────────────
describe('charge.refunded — resolving the order', () => {
  test('a charge with no payment_intent is matched through the chargeId stored at payment time (no Stripe call)', async () => {
    seedPaidOrder();

    const res = await post(buildWebhookApp(), chargeRefunded('evt_by_charge', { amountRefunded: 13996, refunded: true, paymentIntent: null }));

    expect(res.body.paymentIntentId).toBe(PI_ID);
    expect(pi().paymentStatus).toBe('refunded');
    expect(stripeState.calls).toBe(0);
  });

  test('an order recorded before chargeId existed is resolved by asking Stripe for the charge', async () => {
    seedPaidOrder({ chargeId: null });
    stripeState.charge = { payment_intent: PI_ID };

    const res = await post(buildWebhookApp(), chargeRefunded('evt_via_stripe', { amountRefunded: 13996, refunded: true, paymentIntent: null }));

    expect(stripeState.calls).toBe(1);
    expect(res.body.paymentIntentId).toBe(PI_ID);
    expect(pi().paymentStatus).toBe('refunded');
    expect(pi().chargeId).toBe(CHARGE_ID); // back-filled
  });

  test('a refund on a charge that is not a store order (Kortex billing) is acknowledged and ignored without an alert', async () => {
    const res = await post(buildWebhookApp(), chargeRefunded('evt_not_store', { amountRefunded: 900, refunded: true, paymentIntent: 'pi_kortex_sub', chargeId: 'ch_kortex' }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, ignored: true, reason: 'not_a_store_payment' });
    expect(mailDocs()).toHaveLength(0);
    expect(admin._mocks.docData['payment_intents/pi_kortex_sub']).toBeUndefined();
    expect(admin._mocks.docData['stripe_events/evt_not_store']).toBeDefined();
  });

  test('a refund whose order cannot be resolved at all is flagged for triage and the owner is told', async () => {
    const res = await post(buildWebhookApp(), chargeRefunded('evt_unresolvable', { amountRefunded: 500, refunded: true, paymentIntent: null, chargeId: 'ch_unknown' }));

    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(admin._mocks.docData['webhook_failures/evt_unresolvable'].permanent).toBe(true);
    expect(admin._mocks.docData['mail/evt_unresolvable_webhook_failure']).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────
describe('charge.dispute.created', () => {
  test('marks the order disputed with id, reason and evidence deadline, and alerts the owner', async () => {
    seedPaidOrder();

    const res = await post(buildWebhookApp(), disputeEvent('charge.dispute.created', 'evt_dispute'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ disputed: true, paymentIntentId: PI_ID, disputeId: 'dp_1', orderFound: true, items: 2, ownerNotified: true });

    expect(pi().paymentStatus).toBe('disputed');
    expect(pi().disputeId).toBe('dp_1');
    expect(pi().disputeReason).toBe('fraudulent');
    expect(pi().disputeStatus).toBe('needs_response');
    expect(pi().disputeAmountCents).toBe(13996);
    expect(pi().disputeDeadline).toBe(DUE_BY_ISO);
    expect(pi().disputedAt).toBeTruthy();
    expect(pi().statusHistory).toEqual([expect.objectContaining({ status: 'disputed', note: expect.stringContaining('dp_1') })]);

    for (const n of [1, 2]) {
      expect(item(n).paymentStatus).toBe('disputed');
      expect(item(n).disputeId).toBe('dp_1');
      expect(item(n).disputeDeadline).toBe(DUE_BY_ISO);
      // Fulfilment is untouched; the alert tells the owner not to ship.
      expect(item(n).orderStatus).toBe('pending');
    }

    const alert = admin._mocks.docData[`mail/${PI_ID}_dispute_dp_1`];
    expect(alert).toBeDefined();
    expect(alert.to).toBe('rohanramekar17@gmail.com'); // disputes carry no metadata → owner default
    expect(alert.message.subject).toContain('Chargeback');
    expect(alert.message.html).toContain('dp_1');
    expect(alert.message.html).toContain('fraudulent');
    expect(alert.message.html).toContain('Respond By');
    expect(alert.message.html).toContain(
      new Date(DUE_BY_ISO).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric' })
    );
    expect(alert.message.html).toContain('dashboard.stripe.com/test/disputes/dp_1');
    expect(alert.message.html).not.toContain('{{');
  });

  test('duplicate delivery does not double-alert', async () => {
    seedPaidOrder();
    const app = buildWebhookApp();
    const event = disputeEvent('charge.dispute.created', 'evt_dispute_dup');

    await post(app, event);
    const second = await post(app, event);
    expect(second.body.duplicate).toBe(true);

    await post(app, disputeEvent('charge.dispute.created', 'evt_dispute_dup2'));
    expect(mailDocs()).toHaveLength(1);
  });

  test('a dispute without a deadline still records and alerts', async () => {
    seedPaidOrder();
    await post(buildWebhookApp(), disputeEvent('charge.dispute.created', 'evt_dispute_nodl', { evidence_details: null }));
    expect(pi().disputeDeadline).toBeNull();
    expect(admin._mocks.docData[`mail/${PI_ID}_dispute_dp_1`].message.html).toContain('Not stated');
  });

  test('a dispute on a non-store charge alerts the owner but writes no order', async () => {
    const res = await post(buildWebhookApp(), disputeEvent('charge.dispute.created', 'evt_dispute_other', { payment_intent: 'pi_kortex', charge: 'ch_kortex' }));

    expect(res.body).toMatchObject({ disputed: true, orderFound: false, items: 0, ownerNotified: true });
    expect(admin._mocks.docData['payment_intents/pi_kortex']).toBeUndefined();
    expect(admin._mocks.docData['mail/pi_kortex_dispute_dp_1'].message.html).toContain('not a store order');
  });

  test('ORDER_NOTIFY_EMAIL steers the dispute alert', async () => {
    process.env.ORDER_NOTIFY_EMAIL = 'ops@kaayko.com';
    seedPaidOrder();
    await post(buildWebhookApp(), disputeEvent('charge.dispute.created', 'evt_dispute_env'));
    expect(admin._mocks.docData[`mail/${PI_ID}_dispute_dp_1`].to).toBe('ops@kaayko.com');
  });
});

// ────────────────────────────────────────────────────────────────
describe('charge.dispute.closed', () => {
  test('won: restores the paid state and records the outcome', async () => {
    seedPaidOrder();
    const app = buildWebhookApp();
    await post(app, disputeEvent('charge.dispute.created', 'evt_dc_open'));

    const res = await post(app, disputeEvent('charge.dispute.closed', 'evt_dc_won', { status: 'won' }));

    expect(res.body).toMatchObject({ disputeClosed: true, outcome: 'won', paymentStatus: 'paid', orderFound: true });
    expect(pi().paymentStatus).toBe('succeeded');
    expect(pi().disputeOutcome).toBe('won');
    expect(pi().disputeStatus).toBe('won');
    expect(pi().disputeClosedAt).toBeTruthy();
    expect(item(1).paymentStatus).toBe('paid');
    expect(item(1).disputeOutcome).toBe('won');
    expect(item(1).statusHistory).toEqual([expect.objectContaining({ status: 'dispute_won' })]);

    const alert = admin._mocks.docData[`mail/${PI_ID}_dispute_dp_1_closed`];
    expect(alert).toBeDefined();
    expect(alert.message.subject).toContain('closed (won)');
    expect(mailDocs()).toHaveLength(2); // opened + closed
  });

  test('lost: records dispute_lost and the amount taken', async () => {
    seedPaidOrder();

    const res = await post(buildWebhookApp(), disputeEvent('charge.dispute.closed', 'evt_dc_lost', { status: 'lost' }));

    expect(res.body).toMatchObject({ outcome: 'lost', paymentStatus: 'dispute_lost' });
    expect(pi().paymentStatus).toBe('dispute_lost');
    expect(pi().disputeLostCents).toBe(13996);
    expect(item(2).paymentStatus).toBe('dispute_lost');
    const alert = admin._mocks.docData[`mail/${PI_ID}_dispute_dp_1_closed`];
    expect(alert.message.subject).toContain('LOST');
    expect(alert.message.html).toContain('do not ship');
  });

  test('charge_refunded and warning_closed map to refunded / paid', async () => {
    seedPaidOrder();
    const app = buildWebhookApp();

    await post(app, disputeEvent('charge.dispute.closed', 'evt_dc_ref', { status: 'charge_refunded' }));
    expect(pi().paymentStatus).toBe('refunded');
    expect(item(1).paymentStatus).toBe('refunded');

    await post(app, disputeEvent('charge.dispute.closed', 'evt_dc_warn', { id: 'dp_2', status: 'warning_closed' }));
    expect(pi().paymentStatus).toBe('succeeded');
    expect(item(1).paymentStatus).toBe('paid');
  });

  test('duplicate closed events are acknowledged once', async () => {
    seedPaidOrder();
    const app = buildWebhookApp();
    const event = disputeEvent('charge.dispute.closed', 'evt_dc_dup', { status: 'won' });

    await post(app, event);
    const second = await post(app, event);

    expect(second.body.duplicate).toBe(true);
    expect(mailDocs()).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────
describe('retry semantics for the new events', () => {
  test('a Firestore failure while recording a refund surfaces as a retryable 5xx and sends no alert', async () => {
    seedPaidOrder();
    const realBatch = admin._mocks.firestore.batch.getMockImplementation();
    admin._mocks.firestore.batch.mockImplementation(() => ({
      set: jest.fn(), update: jest.fn(), delete: jest.fn(),
      commit: jest.fn(async () => { throw new Error('14 UNAVAILABLE: Firestore unavailable'); })
    }));

    let res;
    try {
      res = await post(buildWebhookApp(), chargeRefunded('evt_refund_boom', { amountRefunded: 13996, refunded: true }));
    } finally {
      admin._mocks.firestore.batch.mockImplementation(realBatch);
    }

    expect(res.status).toBe(500);
    expect(mailDocs()).toHaveLength(0);
    expect(admin._mocks.docData['stripe_events/evt_refund_boom']).toBeUndefined();
  });
});
