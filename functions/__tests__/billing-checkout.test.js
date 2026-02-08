/**
 * Billing & Checkout Tests
 *
 * Billing routes (api/billing/router.js):
 *   GET  /billing/config            — public
 *   GET  /billing/subscription      — requireAuth
 *   POST /billing/create-checkout   — requireAuth + requireStripe
 *   POST /billing/downgrade         — requireAuth
 *   GET  /billing/usage             — requireAuth
 *   POST /billing/webhook           — raw body
 *
 * Checkout routes (api/checkout/router.js):
 *   POST /checkout                  — createPaymentIntent
 *   POST /checkout/updateEmail      — updatePaymentIntentEmail
 *   POST /checkout/webhook          — stripeWebhook
 */
require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const factories = require('./helpers/factories');
const admin = require('firebase-admin');

// ─── Mock Stripe package ──────────────────────────────────────
jest.mock('stripe', () => {
  return jest.fn(() => ({
    customers: {
      create: jest.fn(async () => ({ id: 'cus_test123' })),
      retrieve: jest.fn(async () => ({ id: 'cus_test123', email: 'test@test.com' }))
    },
    checkout: {
      sessions: {
        create: jest.fn(async () => ({ id: 'cs_test123', url: 'https://checkout.stripe.com/test' }))
      }
    },
    subscriptions: {
      retrieve: jest.fn(async () => ({ id: 'sub_test', status: 'active', plan: { id: 'price_pro' } })),
      update: jest.fn(async () => ({ id: 'sub_test', status: 'active' })),
      cancel: jest.fn(async () => ({ id: 'sub_test', status: 'canceled' }))
    },
    paymentIntents: {
      create: jest.fn(async () => ({ id: 'pi_test123', client_secret: 'pi_test_secret_123' })),
      update: jest.fn(async () => ({ id: 'pi_test123' }))
    },
    webhooks: {
      constructEvent: jest.fn((body, sig, secret) => {
        if (sig === 'invalid-sig') throw new Error('Invalid signature');
        return { type: 'payment_intent.succeeded', data: { object: { id: 'pi_test', metadata: {} } } };
      })
    }
  }));
});

jest.mock('../middleware/securityMiddleware', () => ({
  rateLimiter: () => (_r, _s, n) => n(),
  botProtection: (_r, _s, n) => n(),
  secureHeaders: (_r, _s, n) => n()
}));

// Mock billing handlers
jest.mock('../api/billing/billingHandlers', () => ({
  handleGetSubscription: jest.fn((req, res) => {
    res.json({ success: true, data: { plan: 'starter', status: 'active', usage: { links: 5, limit: 25 } } });
  }),
  handleCreateCheckout: jest.fn((req, res) => {
    const { plan } = req.body;
    if (!plan || !['pro', 'business'].includes(plan)) return res.status(400).json({ success: false, error: 'Invalid plan' });
    res.json({ success: true, data: { sessionId: 'cs_test', url: 'https://checkout.stripe.com/test' } });
  }),
  handleDowngrade: jest.fn((req, res) => {
    const { plan } = req.body;
    if (!plan) return res.status(400).json({ success: false, error: 'Plan required' });
    res.json({ success: true, message: 'Downgrade scheduled' });
  }),
  handleGetUsage: jest.fn((_req, res) => {
    res.json({ success: true, data: { links: 5, apiCalls: 100, plan: 'starter' } });
  }),
  handleWebhook: jest.fn((req, res) => {
    const sig = req.headers['stripe-signature'];
    if (!sig) return res.status(400).json({ error: 'Missing signature' });
    if (sig === 'invalid-sig') return res.status(400).json({ error: 'Invalid signature' });
    res.json({ received: true });
  })
}));

// Mock billingConfig
jest.mock('../api/billing/billingConfig', () => ({
  stripe: { configured: true },
  PRICE_IDS: { pro: 'price_pro', business: 'price_business' },
  PLAN_LIMITS: { starter: { links: 25 }, pro: { links: 500 }, business: { links: 2500 } },
  requireStripe: (_r, _s, n) => n()
}));

// Mock checkout handlers
jest.mock('../api/checkout/createPaymentIntent', () =>
  jest.fn((req, res) => {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Items required' });
    const hasInvalidPrice = items.some(i => !i.price || i.price <= 0);
    if (hasInvalidPrice) return res.status(400).json({ error: 'Invalid price' });
    res.json({ success: true, clientSecret: 'pi_test_secret_123' });
  })
);

jest.mock('../api/checkout/updatePaymentIntentEmail', () =>
  jest.fn((req, res) => {
    const { paymentIntentId, email } = req.body;
    if (!paymentIntentId) return res.status(400).json({ error: 'Payment intent ID required' });
    if (!email || !/\S+@\S+\.\S+/.test(email)) return res.status(400).json({ error: 'Valid email required' });
    res.json({ success: true });
  })
);

jest.mock('../api/checkout/stripeWebhook', () =>
  jest.fn((req, res) => {
    const sig = req.headers['stripe-signature'];
    if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });
    if (sig === 'invalid-sig') return res.status(400).json({ error: 'Invalid signature' });
    res.json({ received: true });
  })
);

let billingApp, checkoutApp;

beforeEach(() => {
  const bApp = express();
  bApp.use(express.json());
  bApp.use('/billing', require('../api/billing/router'));
  billingApp = bApp;

  const cApp = express();
  cApp.use(express.json());
  cApp.use('/checkout', require('../api/checkout/router'));
  checkoutApp = cApp;
});

// ═══════════════════════════════════════════════════════════════
// CHECKOUT
// ═══════════════════════════════════════════════════════════════

describe('POST /checkout (createPaymentIntent)', () => {
  test('creates payment intent with valid items → 200', async () => {
    const res = await request(checkoutApp).post('/checkout')
      .send({ items: [{ productId: 'prod-1', name: 'Board', price: 29.99, size: 'L', quantity: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('rejects empty items array → 400', async () => {
    const res = await request(checkoutApp).post('/checkout').send({ items: [] });
    expect(res.status).toBe(400);
  });

  test('rejects missing items → 400', async () => {
    const res = await request(checkoutApp).post('/checkout').send({});
    expect(res.status).toBe(400);
  });

  test('rejects items with invalid price → 400', async () => {
    const res = await request(checkoutApp).post('/checkout')
      .send({ items: [{ productId: 'p1', name: 'Bad', price: 0, size: 'M', quantity: 1 }] });
    expect(res.status).toBe(400);
  });

  test('rejects items with negative price → 400', async () => {
    const res = await request(checkoutApp).post('/checkout')
      .send({ items: [{ productId: 'p1', name: 'Bad', price: -5, size: 'M', quantity: 1 }] });
    expect(res.status).toBe(400);
  });
});

describe('POST /checkout/updateEmail', () => {
  test('updates email on payment intent → 200', async () => {
    const res = await request(checkoutApp).post('/checkout/updateEmail')
      .send({ paymentIntentId: 'pi_test123', email: 'customer@test.com' });
    expect(res.status).toBe(200);
  });

  test('rejects missing paymentIntentId → 400', async () => {
    const res = await request(checkoutApp).post('/checkout/updateEmail')
      .send({ email: 'customer@test.com' });
    expect(res.status).toBe(400);
  });

  test('rejects invalid email format → 400', async () => {
    const res = await request(checkoutApp).post('/checkout/updateEmail')
      .send({ paymentIntentId: 'pi_test', email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('rejects missing email → 400', async () => {
    const res = await request(checkoutApp).post('/checkout/updateEmail')
      .send({ paymentIntentId: 'pi_test' });
    expect(res.status).toBe(400);
  });
});

describe('POST /checkout/webhook', () => {
  test('accepts valid webhook → 200', async () => {
    const res = await request(checkoutApp).post('/checkout/webhook')
      .set('stripe-signature', 'valid-sig')
      .send(JSON.stringify({ type: 'payment_intent.succeeded' }));
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  test('rejects missing signature → 400', async () => {
    const res = await request(checkoutApp).post('/checkout/webhook')
      .send(JSON.stringify({ type: 'payment_intent.succeeded' }));
    expect(res.status).toBe(400);
  });

  test('rejects invalid signature → 400', async () => {
    const res = await request(checkoutApp).post('/checkout/webhook')
      .set('stripe-signature', 'invalid-sig')
      .send(JSON.stringify({ type: 'test' }));
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// BILLING
// ═══════════════════════════════════════════════════════════════

describe('GET /billing/config', () => {
  test('returns Stripe config → 200', async () => {
    const res = await request(billingApp).get('/billing/config');
    expect(res.status).toBe(200);
  });
});

describe('GET /billing/subscription', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(billingApp).get('/billing/subscription');
    expect(res.status).toBe(401);
  });

  test('returns subscription for authenticated user → 200', async () => {
    const res = await request(billingApp).get('/billing/subscription')
      .set('Authorization', `Bearer ${factories.tokens.user}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /billing/create-checkout', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(billingApp).post('/billing/create-checkout')
      .send({ plan: 'pro' });
    expect(res.status).toBe(401);
  });

  test('creates checkout session for valid plan → 200', async () => {
    const res = await request(billingApp).post('/billing/create-checkout')
      .set('Authorization', `Bearer ${factories.tokens.user}`)
      .send({ plan: 'pro' });
    expect(res.status).toBe(200);
  });

  test('rejects invalid plan → 400', async () => {
    const res = await request(billingApp).post('/billing/create-checkout')
      .set('Authorization', `Bearer ${factories.tokens.user}`)
      .send({ plan: 'nonexistent' });
    expect(res.status).toBe(400);
  });
});

describe('POST /billing/downgrade', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(billingApp).post('/billing/downgrade').send({ plan: 'starter' });
    expect(res.status).toBe(401);
  });

  test('schedules downgrade → 200', async () => {
    const res = await request(billingApp).post('/billing/downgrade')
      .set('Authorization', `Bearer ${factories.tokens.user}`)
      .send({ plan: 'starter' });
    expect(res.status).toBe(200);
  });

  test('rejects missing plan → 400', async () => {
    const res = await request(billingApp).post('/billing/downgrade')
      .set('Authorization', `Bearer ${factories.tokens.user}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /billing/usage', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(billingApp).get('/billing/usage');
    expect(res.status).toBe(401);
  });

  test('returns usage for authenticated user → 200', async () => {
    const res = await request(billingApp).get('/billing/usage')
      .set('Authorization', `Bearer ${factories.tokens.user}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /billing/webhook', () => {
  test('accepts valid webhook → 200', async () => {
    const res = await request(billingApp).post('/billing/webhook')
      .set('stripe-signature', 'valid-sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'invoice.paid' }));
    expect(res.status).toBe(200);
  });

  test('rejects missing signature → 400', async () => {
    const res = await request(billingApp).post('/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'test' }));
    expect(res.status).toBe(400);
  });
});
