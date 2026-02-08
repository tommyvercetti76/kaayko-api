/**
 * Checkout & Orders — Integration Tests
 *
 * Tests the REAL handler + service + Firestore chain for:
 *   1. Payment intent creation → Firestore doc
 *   2. Webhook success → order creation
 *   3. Webhook failure → status update
 *   4. Admin: getOrder, listOrders, updateOrderStatus
 *   5. Status transitions & parent sync
 *
 * External mock: Stripe API only. Firestore is REAL (emulator).
 */

jest.unmock('firebase-admin');
jest.unmock('firebase-admin/firestore');

// Mock Stripe (external service)
jest.mock('stripe', () => {
  return jest.fn(() => ({
    paymentIntents: {
      create: jest.fn(async (params) => ({
        id: 'pi_integration_001',
        client_secret: 'pi_integration_001_secret_xxx',
        amount: params.amount,
        currency: params.currency,
        metadata: params.metadata,
        status: 'requires_payment_method'
      }))
    },
    webhooks: {
      constructEvent: jest.fn((body, sig, secret) => {
        // Parse the body to get the mock event
        const parsed = typeof body === 'string' ? JSON.parse(body) : body;
        return parsed;
      })
    }
  }));
});

const request = require('supertest');
const express = require('express');
const { db, isEmulatorRunning, clearCollections, seedDoc, getDoc, getAllDocs, countDocs } = require('./helpers/firestoreHelpers');
const seed = require('./helpers/seedData');

let emulatorAvailable = false;

beforeAll(async () => {
  emulatorAvailable = await isEmulatorRunning();
  if (!emulatorAvailable) {
    console.error('\n⚠️  Firestore emulator not running.\n');
  }
});

beforeEach(async () => {
  if (!emulatorAvailable) return;
  await clearCollections(['payment_intents', 'orders', 'mail']);
});

afterAll(async () => {
  if (emulatorAvailable) await clearCollections(['payment_intents', 'orders', 'mail']);
});

const skipIfNoEmulator = () => {
  if (!emulatorAvailable) return true;
  return false;
};

// ─── Build test apps ───────────────────────────────────────────────

function buildCheckoutApp() {
  const app = express();
  app.use(express.json());
  app.use('/createPaymentIntent', require('../../api/checkout/router'));
  return app;
}

function buildAdminOrderApp() {
  const app = express();
  app.use(express.json());
  // Bypass auth for integration tests
  app.use((req, _res, next) => {
    req.user = { uid: 'super-admin-uid', email: 'super@kaayko.com' };
    next();
  });
  const { getOrder, listOrders } = require('../../api/admin/getOrder');
  const updateOrderStatus = require('../../api/admin/updateOrderStatus');
  app.get('/admin/getOrder', getOrder);
  app.get('/admin/listOrders', listOrders);
  app.post('/admin/updateOrderStatus', updateOrderStatus);
  return app;
}

// ═══════════════════════════════════════════════════════════════════
// 1. PAYMENT INTENT CREATION
// ═══════════════════════════════════════════════════════════════════

describe('Payment Intent → Firestore', () => {
  test('POST /createPaymentIntent with items array creates Firestore doc', async () => {
    if (skipIfNoEmulator()) return;
    const app = buildCheckoutApp();

    const res = await request(app)
      .post('/createPaymentIntent')
      .send({
        items: [
          { productId: 'prod_A', productTitle: 'Test Paddle', size: 'M', gender: 'Men', price: '$25.00' },
          { productId: 'prod_B', productTitle: 'Test Cap', size: 'OS', gender: 'Unisex', price: '$15.00' }
        ],
        customerEmail: 'buyer@test.com',
        dataRetentionConsent: true
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.paymentIntentId).toBe('pi_integration_001');
    expect(res.body.clientSecret).toBeTruthy();

    // Verify Firestore document
    const doc = await getDoc('payment_intents', 'pi_integration_001');
    expect(doc).not.toBeNull();
    expect(doc.totalAmount).toBe(4000); // $25 + $15 = $40 = 4000 cents
    expect(doc.itemCount).toBe(2);
    expect(doc.status).toBe('created');
    expect(doc.paymentStatus).toBe('pending');
    expect(doc.fulfillmentStatus).toBe('awaiting_payment');
    expect(doc.items).toHaveLength(2);
    expect(doc.customerEmail).toBe('buyer@test.com');
    expect(doc.dataRetentionConsent).toBe(true);
    expect(doc.statusHistory).toHaveLength(1);
    expect(doc.statusHistory[0].status).toBe('created');
  });

  test('POST /createPaymentIntent with legacy format (comma-separated)', async () => {
    if (skipIfNoEmulator()) return;
    const app = buildCheckoutApp();

    const res = await request(app)
      .post('/createPaymentIntent')
      .send({
        productId: 'prod_C',
        productTitle: 'Single Item',
        size: 'L',
        gender: 'Women',
        price: '$30.00'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const doc = await getDoc('payment_intents', 'pi_integration_001');
    expect(doc.totalAmount).toBe(3000);
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].productId).toBe('prod_C');
  });

  test('rejects request with no items', async () => {
    if (skipIfNoEmulator()) return;
    const app = buildCheckoutApp();

    const res = await request(app)
      .post('/createPaymentIntent')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. PAYMENT SUCCESS → ORDER CREATION
// ═══════════════════════════════════════════════════════════════════

describe('Payment Success → Orders', () => {
  test('handlePaymentSuccess creates per-item order docs', async () => {
    if (skipIfNoEmulator()) return;

    // Seed the payment intent (as if createPaymentIntent just ran)
    await seedDoc('payment_intents', 'pi_success_test', seed.paymentIntent({ id: 'pi_success_test' }));

    // Simulate webhook payload
    const { handlePaymentSuccess } = require('../../api/checkout/stripeOrderHandler');
    await handlePaymentSuccess({
      id: 'pi_success_test',
      amount: 3500,
      currency: 'usd',
      receipt_email: 'customer@test.com',
      shipping: {
        name: 'Test User',
        phone: '+15551234567',
        address: {
          line1: '456 River Road',
          line2: 'Apt 2',
          city: 'Seattle',
          state: 'WA',
          postal_code: '98101',
          country: 'US'
        }
      },
      payment_method_types: ['card'],
      metadata: {
        items: JSON.stringify([
          { productId: 'prod_001', productTitle: 'Paddle Jersey', size: 'M', gender: 'Men', price: '$20.00' },
          { productId: 'prod_002', productTitle: 'Kayak Cap', size: 'OS', gender: 'Unisex', price: '$15.00' }
        ]),
        timestamp: '2025-01-01T00:00:00.000Z',
        notifyEmail: 'rohan@kaayko.com',
        dataRetentionConsent: 'true'
      }
    });

    // Verify payment intent was updated
    const piDoc = await getDoc('payment_intents', 'pi_success_test');
    expect(piDoc.status).toBe('succeeded');
    expect(piDoc.paymentStatus).toBe('succeeded');
    expect(piDoc.fulfillmentStatus).toBe('processing');
    expect(piDoc.paidAt).toBeTruthy();

    // Verify order docs were created
    const order1 = await getDoc('orders', 'pi_success_test_item1');
    expect(order1).not.toBeNull();
    expect(order1.parentOrderId).toBe('pi_success_test');
    expect(order1.itemIndex).toBe(1);
    expect(order1.totalItems).toBe(2);
    expect(order1.productId).toBe('prod_001');
    expect(order1.orderStatus).toBe('pending');
    expect(order1.paymentStatus).toBe('paid');
    expect(order1.shippingAddress).toEqual(expect.objectContaining({
      name: 'Test User',
      city: 'Seattle',
      state: 'WA'
    }));

    const order2 = await getDoc('orders', 'pi_success_test_item2');
    expect(order2).not.toBeNull();
    expect(order2.productId).toBe('prod_002');
    expect(order2.itemIndex).toBe(2);

    // Verify emails were queued
    const mailDocs = await getAllDocs('mail');
    expect(mailDocs.length).toBeGreaterThanOrEqual(1); // At least admin notification
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. ADMIN: GET ORDER / LIST ORDERS
// ═══════════════════════════════════════════════════════════════════

describe('Admin Order Management', () => {
  let app;

  beforeEach(async () => {
    if (!emulatorAvailable) return;
    app = buildAdminOrderApp();

    // Seed a realistic order set
    await seedDoc('payment_intents', 'pi_admin_test', seed.succeededPaymentIntent({ id: 'pi_admin_test' }));
    await seedDoc('orders', 'pi_admin_test_item1', seed.order({
      parentOrderId: 'pi_admin_test', itemIndex: 1, orderStatus: 'processing'
    }));
    await seedDoc('orders', 'pi_admin_test_item2', seed.order({
      parentOrderId: 'pi_admin_test', itemIndex: 2, productId: 'prod_002',
      productTitle: 'Kayak Cap', orderStatus: 'processing'
    }));
  });

  test('GET /admin/getOrder?orderId=xxx returns order', async () => {
    if (skipIfNoEmulator()) return;
    const res = await request(app).get('/admin/getOrder?orderId=pi_admin_test_item1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order.orderId).toBe('pi_admin_test_item1');
    expect(res.body.order.parentOrderId).toBe('pi_admin_test');
  });

  test('GET /admin/getOrder?parentOrderId=xxx returns all items + payment intent', async () => {
    if (skipIfNoEmulator()) return;
    const res = await request(app).get('/admin/getOrder?parentOrderId=pi_admin_test');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orders).toHaveLength(2);
    expect(res.body.paymentIntent).not.toBeNull();
    expect(res.body.totalItems).toBe(2);
  });

  test('GET /admin/listOrders returns paginated results', async () => {
    if (skipIfNoEmulator()) return;
    const res = await request(app).get('/admin/listOrders?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orders.length).toBeGreaterThanOrEqual(2);
    expect(res.body.count).toBeGreaterThanOrEqual(2);
  });

  test('GET /admin/listOrders?orderStatus=processing filters correctly', async () => {
    if (skipIfNoEmulator()) return;
    // Add a shipped order to mix
    await seedDoc('orders', 'pi_admin_test_shipped', seed.shippedOrder());

    const res = await request(app).get('/admin/listOrders?orderStatus=processing');
    expect(res.status).toBe(200);
    res.body.orders.forEach(o => expect(o.orderStatus).toBe('processing'));
  });

  test('GET /admin/getOrder returns 404 for unknown order', async () => {
    if (skipIfNoEmulator()) return;
    const res = await request(app).get('/admin/getOrder?orderId=nonexistent');
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. UPDATE ORDER STATUS — Full Lifecycle
// ═══════════════════════════════════════════════════════════════════

describe('Order Status Transitions', () => {
  let app;

  beforeEach(async () => {
    if (!emulatorAvailable) return;
    app = buildAdminOrderApp();

    // Seed parent + 2 orders
    await seedDoc('payment_intents', 'pi_lifecycle', seed.succeededPaymentIntent({ id: 'pi_lifecycle' }));
    await seedDoc('orders', 'pi_lifecycle_item1', seed.order({ parentOrderId: 'pi_lifecycle', itemIndex: 1 }));
    await seedDoc('orders', 'pi_lifecycle_item2', seed.order({ parentOrderId: 'pi_lifecycle', itemIndex: 2 }));
  });

  test('pending → processing: sets processedAt', async () => {
    if (skipIfNoEmulator()) return;
    const res = await request(app)
      .post('/admin/updateOrderStatus')
      .send({ orderId: 'pi_lifecycle_item1', orderStatus: 'processing' });

    expect(res.status).toBe(200);
    const doc = await getDoc('orders', 'pi_lifecycle_item1');
    expect(doc.orderStatus).toBe('processing');
    expect(doc.processedAt).toBeTruthy();
  });

  test('processing → shipped: sets tracking info + trackingUrl', async () => {
    if (skipIfNoEmulator()) return;
    const res = await request(app)
      .post('/admin/updateOrderStatus')
      .send({
        orderId: 'pi_lifecycle_item1',
        orderStatus: 'shipped',
        trackingNumber: '1Z999AA10123456784',
        carrier: 'UPS',
        estimatedDelivery: '2025-02-15'
      });

    expect(res.status).toBe(200);
    const doc = await getDoc('orders', 'pi_lifecycle_item1');
    expect(doc.orderStatus).toBe('shipped');
    expect(doc.trackingNumber).toBe('1Z999AA10123456784');
    expect(doc.carrier).toBe('UPS');
    expect(doc.trackingUrl).toContain('ups.com');
    expect(doc.estimatedDelivery).toBe('2025-02-15');
    expect(doc.shippedAt).toBeTruthy();
  });

  test('shipped → delivered: sets deliveredAt', async () => {
    if (skipIfNoEmulator()) return;
    // First ship it
    await request(app).post('/admin/updateOrderStatus').send({
      orderId: 'pi_lifecycle_item1', orderStatus: 'shipped', trackingNumber: 'TEST123', carrier: 'USPS'
    });
    // Then deliver
    const res = await request(app).post('/admin/updateOrderStatus').send({
      orderId: 'pi_lifecycle_item1', orderStatus: 'delivered'
    });

    expect(res.status).toBe(200);
    const doc = await getDoc('orders', 'pi_lifecycle_item1');
    expect(doc.orderStatus).toBe('delivered');
    expect(doc.deliveredAt).toBeTruthy();
  });

  test('all items delivered → parent payment_intent synced', async () => {
    if (skipIfNoEmulator()) return;
    // Deliver both items
    await request(app).post('/admin/updateOrderStatus').send({
      orderId: 'pi_lifecycle_item1', orderStatus: 'delivered'
    });
    await request(app).post('/admin/updateOrderStatus').send({
      orderId: 'pi_lifecycle_item2', orderStatus: 'delivered'
    });

    // Parent should be synced
    const piDoc = await getDoc('payment_intents', 'pi_lifecycle');
    expect(piDoc.fulfilledAt).toBeTruthy();
  });

  test('internal notes are appended', async () => {
    if (skipIfNoEmulator()) return;
    await request(app).post('/admin/updateOrderStatus').send({
      orderId: 'pi_lifecycle_item1', internalNote: 'Customer called about sizing'
    });
    await request(app).post('/admin/updateOrderStatus').send({
      orderId: 'pi_lifecycle_item1', internalNote: 'Sent replacement size'
    });

    const doc = await getDoc('orders', 'pi_lifecycle_item1');
    expect(doc.internalNotes.length).toBeGreaterThanOrEqual(2);
    expect(doc.internalNotes[0].note).toContain('sizing');
  });

  test('statusHistory grows with each transition', async () => {
    if (skipIfNoEmulator()) return;
    await request(app).post('/admin/updateOrderStatus').send({
      orderId: 'pi_lifecycle_item1', orderStatus: 'processing'
    });
    await request(app).post('/admin/updateOrderStatus').send({
      orderId: 'pi_lifecycle_item1', orderStatus: 'shipped', trackingNumber: 'T123', carrier: 'FedEx'
    });

    const doc = await getDoc('orders', 'pi_lifecycle_item1');
    // Original 3 + processing + shipped + tracking_updated = 6
    expect(doc.statusHistory.length).toBeGreaterThanOrEqual(5);
  });

  test('rejects update for nonexistent order', async () => {
    if (skipIfNoEmulator()) return;
    const res = await request(app).post('/admin/updateOrderStatus').send({
      orderId: 'nonexistent_order', orderStatus: 'shipped'
    });
    expect(res.status).toBe(404);
  });

  test('rejects update with no orderId', async () => {
    if (skipIfNoEmulator()) return;
    const res = await request(app).post('/admin/updateOrderStatus').send({ orderStatus: 'shipped' });
    expect(res.status).toBe(400);
  });
});
