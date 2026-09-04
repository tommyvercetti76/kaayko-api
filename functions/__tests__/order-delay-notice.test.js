/**
 * FTC Mail Order Rule — ship-time statement and the delay notice.
 *
 *   • One constant (api/email/policy.js) states the ship time and is injected
 *     into every customer email, so the confirmation, the shipping notice and
 *     the delay notice cannot drift from each other.
 *   • POST /admin/orders/delay-notice queues the consent-or-cancel email once
 *     per order per revised date and records the date on the order.
 */

require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const admin = require('firebase-admin');

const policy = require('../api/email/policy');
const { renderEmail } = require('../api/email/render');
const { sendDelayNotice, parseIsoDate, consentRequired } = require('../api/admin/orderNotices');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

const PI_ID = 'pi_delay_1';
const DAY_MS = 86_400_000;

// Mirrors the production mount:
// apiApp.post("/admin/orders/delay-notice", requireAuth, requireAdmin, require("./api/admin/orderNotices").sendDelayNotice);
function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/admin/orders/delay-notice', requireAuth, requireAdmin, sendDelayNotice);
  return app;
}

function asAdmin(req) {
  admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin' };
  return req.set('Authorization', 'Bearer VALID_ADMIN_TOKEN');
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function daysFromNow(days) {
  return isoDay(new Date(Date.now() + days * DAY_MS));
}

function seedPaidOrder({ customerEmail = 'buyer@example.com', paidAt = new Date() } = {}) {
  admin._mocks.docData[`payment_intents/${PI_ID}`] = {
    paymentIntentId: PI_ID, currency: 'usd', totalCents: 13996,
    status: 'succeeded', paymentStatus: 'succeeded', fulfillmentStatus: 'processing',
    customerEmail, paidAt, statusHistory: []
  };
  for (const [n, title] of [[1, 'Straight Outta Sabarmati'], [2, 'Stay Hydrated']]) {
    admin._mocks.docData[`orders/${PI_ID}_item${n}`] = {
      orderId: `${PI_ID}_item${n}`, parentOrderId: PI_ID, itemIndex: n,
      productTitle: title, size: n === 1 ? 'S' : 'M', gender: n === 1 ? 'Male' : 'Female', quantity: 2,
      lineTotalCents: 6998, orderStatus: 'pending', fulfillmentStatus: 'processing', paymentStatus: 'paid',
      customerEmail, paidAt, estimatedDelivery: null, statusHistory: []
    };
  }
}

function mailDocs() {
  return Object.entries(admin._mocks.docData)
    .filter(([path]) => path.startsWith('mail/'))
    .map(([path, data]) => ({ path, data }));
}

// ────────────────────────────────────────────────────────────────
describe('Ship-time statement (FTC 16 CFR 435)', () => {
  test('there is exactly one ship-time sentence and it is the agreed one', () => {
    expect(policy.SHIP_TIME_TEXT).toBe('Made to order — ships in 5–7 business days, delivered within 7–14.');
    expect(policy.SHIP_DAYS).toEqual({ min: 5, max: 7 });
    expect(policy.DELIVERY_DAYS).toEqual({ min: 7, max: 14 });
    expect(policy.RETURNS_POLICY_URL).toBe('https://kaayko.com/legal/returns');
  });

  test('the order confirmation states the ship time, links the returns policy, and no longer says "do not reply"', () => {
    const html = renderEmail('orderConfirmation.html', {
      orderId: PI_ID, itemCount: 1, subtotal: '$34.99', orderTotal: '$34.99',
      items: [{ productTitle: 'Tee', variant: 'Male · S', quantity: 1, unitPrice: '$34.99', lineTotal: '$34.99' }]
    });
    expect(html).toContain(policy.SHIP_TIME_TEXT);
    expect(html).toContain('https://kaayko.com/legal/returns');
    expect(html).toMatch(/reply to this email/i);
    expect(html).not.toMatch(/do not reply/i);
    expect(html).not.toMatch(/automated message/i);
    expect(html).not.toContain('{{');
  });

  test('the shipping confirmation states the same ship time and links the returns policy', () => {
    const html = renderEmail('shippingConfirmation.html', {
      orderId: PI_ID, carrier: 'USPS', trackingNumber: '9400', estimatedDelivery: '2026-09-09',
      items: [{ productTitle: 'Tee', variant: 'Male · S', quantity: 1 }], trackingLinkHtml: '',
      shipName: 'R', shipLine1: '1 Main', shipLine2: '', shipCityLine: 'McKinney, TX, 75070', shipCountry: 'US'
    });
    expect(html).toContain(policy.SHIP_TIME_TEXT);
    expect(html).toContain('https://kaayko.com/legal/returns');
    expect(html).not.toContain('{{');
  });

  test('caller data cannot override the policy constant by accident', () => {
    const html = renderEmail('orderConfirmation.html', { orderId: 'x', items: [], shipTimeText: undefined });
    expect(html).toContain(policy.SHIP_TIME_TEXT);
  });
});

// ────────────────────────────────────────────────────────────────
describe('POST /admin/orders/delay-notice — access and validation', () => {
  test('requires an authenticated admin', async () => {
    seedPaidOrder();
    const app = buildApp();

    const anon = await request(app).post('/admin/orders/delay-notice').send({ parentOrderId: PI_ID, newEstimatedDate: daysFromNow(10) });
    expect(anon.status).toBe(401);

    const user = await request(app).post('/admin/orders/delay-notice')
      .set('Authorization', 'Bearer VALID_USER_TOKEN')
      .send({ parentOrderId: PI_ID, newEstimatedDate: daysFromNow(10) });
    expect(user.status).toBe(403);

    expect(mailDocs()).toHaveLength(0);
  });

  test('rejects a missing order id, a malformed or impossible date, a past date, and an unknown order', async () => {
    seedPaidOrder();
    const app = buildApp();
    const send = (body) => asAdmin(request(app).post('/admin/orders/delay-notice')).send(body);

    expect((await send({ newEstimatedDate: daysFromNow(10) })).status).toBe(400);
    expect((await send({ parentOrderId: PI_ID, newEstimatedDate: '10/06/2026' })).status).toBe(400);
    expect((await send({ parentOrderId: PI_ID, newEstimatedDate: '2026-02-30' })).status).toBe(400);
    expect((await send({ parentOrderId: PI_ID, newEstimatedDate: daysFromNow(-2) })).status).toBe(400);
    expect((await send({ parentOrderId: 'pi_nope', newEstimatedDate: daysFromNow(10) })).status).toBe(404);

    expect(mailDocs()).toHaveLength(0);
    expect(admin._mocks.docData[`orders/${PI_ID}_item1`].estimatedDelivery).toBeNull();
  });

  test('an order with no customer email cannot be noticed automatically', async () => {
    seedPaidOrder({ customerEmail: null });

    const res = await asAdmin(request(buildApp()).post('/admin/orders/delay-notice'))
      .send({ parentOrderId: PI_ID, newEstimatedDate: daysFromNow(10) });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_CUSTOMER_EMAIL');
  });

  test('parseIsoDate is strict', () => {
    expect(parseIsoDate('2026-12-31').toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-2-3')).toBeNull();
    expect(parseIsoDate('2026-12-31T00:00:00Z')).toBeNull();
    expect(parseIsoDate(20261231)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
describe('POST /admin/orders/delay-notice — the notice', () => {
  test('queues the consent-or-cancel email once, keyed by order and date, and records the revised date', async () => {
    seedPaidOrder();
    const newDate = daysFromNow(10);
    const app = buildApp();

    const res = await asAdmin(request(app).post('/admin/orders/delay-notice'))
      .send({ parentOrderId: PI_ID, newEstimatedDate: newDate, reason: 'Blank stock arrived late' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true, queued: true, parentOrderId: PI_ID, customerEmail: 'buyer@example.com',
      newEstimatedDate: newDate, consentRequired: false,
      mailId: `${PI_ID}_delay_${newDate.replace(/-/g, '')}`
    });
    expect(res.body.orderIds.sort()).toEqual([`${PI_ID}_item1`, `${PI_ID}_item2`]);

    const mail = admin._mocks.docData[`mail/${res.body.mailId}`];
    expect(mail).toBeDefined();
    expect(mail.to).toBe('buyer@example.com');
    expect(mail.kind).toBe('delay_notice');
    expect(mail.message.subject).toContain(newDate);

    const html = mail.message.html;
    const longDate = new Date(`${newDate}T00:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
    });
    expect(html).toContain(longDate);
    expect(html).toContain(policy.SHIP_TIME_TEXT);      // the promise we are missing
    expect(html).toMatch(/sorry/i);
    expect(html).toContain('Keep my order');
    expect(html).toContain('Cancel my order for a full refund');
    expect(html).toContain('reply to this email');
    expect(html).toContain('https://kaayko.com/legal/returns');
    expect(html).toContain('Blank stock arrived late');
    expect(html).toContain('Straight Outta Sabarmati');
    expect(html).toContain('Stay Hydrated');
    // A short delay: silence keeps the order open.
    expect(html).toContain('we will keep your order open');
    expect(html).not.toContain('We need to hear from you');
    expect(html).not.toContain('{{');

    for (const n of [1, 2]) {
      const item = admin._mocks.docData[`orders/${PI_ID}_item${n}`];
      expect(item.estimatedDelivery).toBe(newDate);
      expect(item.delayNoticeSentAt).toBeTruthy();
      expect(item.statusHistory).toEqual([expect.objectContaining({ status: 'delay_notice', note: expect.stringContaining(newDate) })]);
    }
    const pi = admin._mocks.docData[`payment_intents/${PI_ID}`];
    expect(pi.estimatedDelivery).toBe(newDate);
    expect(pi.delayNotices).toEqual([expect.objectContaining({ date: newDate, reason: 'Blank stock arrived late', mailId: res.body.mailId, consentRequired: false })]);
    expect(pi.statusHistory).toEqual([expect.objectContaining({ status: 'delay_notice' })]);
  });

  test('sending the same notice twice queues one email; a later date queues a second', async () => {
    seedPaidOrder();
    const app = buildApp();
    const first = daysFromNow(10);
    const later = daysFromNow(20);

    await asAdmin(request(app).post('/admin/orders/delay-notice')).send({ parentOrderId: PI_ID, newEstimatedDate: first });
    const again = await asAdmin(request(app).post('/admin/orders/delay-notice')).send({ parentOrderId: PI_ID, newEstimatedDate: first });
    expect(again.status).toBe(200);
    expect(again.body.queued).toBe(false);
    expect(again.body.reason).toBe('already_sent_for_date');
    expect(mailDocs()).toHaveLength(1);

    const second = await asAdmin(request(app).post('/admin/orders/delay-notice')).send({ parentOrderId: PI_ID, newEstimatedDate: later });
    expect(second.body.queued).toBe(true);
    expect(mailDocs()).toHaveLength(2);
    expect(admin._mocks.docData[`orders/${PI_ID}_item1`].estimatedDelivery).toBe(later);
  });

  test('a revised date more than 30 days past the original promise requires express consent', async () => {
    seedPaidOrder();
    const farOut = daysFromNow(60); // promise was 14 days; +30 grace → anything past day 44

    const res = await asAdmin(request(buildApp()).post('/admin/orders/delay-notice'))
      .send({ parentOrderId: PI_ID, newEstimatedDate: farOut });

    expect(res.body.consentRequired).toBe(true);
    const html = admin._mocks.docData[`mail/${res.body.mailId}`].message.html;
    expect(html).toContain('We need to hear from you');
    expect(html).toContain('we will cancel the order and refund you in full');
    expect(html).not.toContain('we will keep your order open');
    expect(admin._mocks.docData[`payment_intents/${PI_ID}`].statusHistory[0].note).toContain('express consent required');
  });

  test('the reason is HTML-escaped in the email', async () => {
    seedPaidOrder();

    const res = await asAdmin(request(buildApp()).post('/admin/orders/delay-notice'))
      .send({ parentOrderId: PI_ID, newEstimatedDate: daysFromNow(5), reason: '<img src=x onerror=alert(1)> supplier' });

    const html = admin._mocks.docData[`mail/${res.body.mailId}`].message.html;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  test('consentRequired counts from the order date plus the promised delivery window', () => {
    const ordered = new Date('2026-09-01T00:00:00Z');
    expect(consentRequired(new Date('2026-10-10T00:00:00Z'), ordered)).toBe(false); // day 39
    expect(consentRequired(new Date('2026-10-15T00:00:00Z'), ordered)).toBe(false); // day 44 (boundary)
    expect(consentRequired(new Date('2026-10-16T00:00:00Z'), ordered)).toBe(true);  // day 45
    expect(consentRequired(new Date('2027-01-01T00:00:00Z'), null)).toBe(false);    // unknown order date → standard rule
  });

  test('a Firestore failure is a sanitised 500', async () => {
    seedPaidOrder();
    const realCollection = admin._mocks.firestore.collection.getMockImplementation();
    // Only the orders read fails; requireAuth's admin_users lookup must still work.
    admin._mocks.firestore.collection.mockImplementation((path) => {
      if (path === 'orders') throw new Error('14 UNAVAILABLE: internal details');
      return realCollection(path);
    });
    let res;
    try {
      res = await asAdmin(request(buildApp()).post('/admin/orders/delay-notice'))
        .send({ parentOrderId: PI_ID, newEstimatedDate: daysFromNow(5) });
    } finally {
      admin._mocks.firestore.collection.mockImplementation(realCollection);
    }
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('UNAVAILABLE');
  });
});
