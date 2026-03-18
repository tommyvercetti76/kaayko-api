require('./helpers/mockSetup');
const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');

describe('Store API — Products', () => {
  test('GET /products returns success:true with products array', async () => {
    admin._mocks.collectionData['kaaykoproducts'] = [
      { id: 'prod-1', data: () => ({ title: 'River Tee', description: 'Cotton shirt', price: '$$', votes: 5, productID: 'abc123', tags: ['apparel'], availableColors: ['blue'], availableSizes: ['M', 'L'], maxQuantity: 10, imgSrc: [] }) },
      { id: 'prod-2', data: () => ({ title: 'Paddle Hat', description: 'Cap', price: '$', votes: 2, productID: 'def456', tags: ['headwear'], availableColors: ['green'], availableSizes: ['One Size'], maxQuantity: 5, imgSrc: [] }) }
    ];

    const app = buildTestApp('/products', require('../api/products/products'));
    const res = await request(app).get('/products');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.products).toHaveLength(2);
    expect(res.body.products[0].title).toBe('River Tee');
  });

  test('GET /products/:id returns success:true with product', async () => {
    admin._mocks.docData['kaaykoproducts/prod-abc'] = {
      title: 'Kayak Tee',
      description: 'Premium shirt',
      price: '$$$',
      votes: 12,
      productID: 'kayak123',
      tags: ['apparel'],
      availableColors: ['red'],
      availableSizes: ['S', 'M'],
      maxQuantity: 20,
      imgSrc: []
    };

    const app = buildTestApp('/products', require('../api/products/products'));
    const res = await request(app).get('/products/prod-abc');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.product).toBeDefined();
    expect(res.body.product.title).toBe('Kayak Tee');
  });

  test('GET /products/:id with unknown ID returns 404 with standard error shape', async () => {
    const app = buildTestApp('/products', require('../api/products/products'));
    const res = await request(app).get('/products/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.error).toBeDefined();
  });

  test('POST /products/:id/vote with voteChange: 1 returns success:true', async () => {
    admin._mocks.docData['kaaykoproducts/prod-vote'] = { title: 'Vote Test', votes: 0, productID: 'vote123', imgSrc: [] };

    const app = buildTestApp('/products', require('../api/products/products'));
    const res = await request(app)
      .post('/products/prod-vote/vote')
      .send({ voteChange: 1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /products/:id/vote with voteChange: -1 returns success:true', async () => {
    admin._mocks.docData['kaaykoproducts/prod-vote2'] = { title: 'Vote Test 2', votes: 5, productID: 'vote456', imgSrc: [] };

    const app = buildTestApp('/products', require('../api/products/products'));
    const res = await request(app)
      .post('/products/prod-vote2/vote')
      .send({ voteChange: -1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /products/:id/vote with invalid voteChange returns 400 with INVALID_VOTE_CHANGE', async () => {
    const app = buildTestApp('/products', require('../api/products/products'));
    const res = await request(app)
      .post('/products/prod-x/vote')
      .send({ voteChange: 5 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('INVALID_VOTE_CHANGE');
  });

  test('POST /products/:id/vote with missing voteChange returns 400', async () => {
    const app = buildTestApp('/products', require('../api/products/products'));
    const res = await request(app)
      .post('/products/prod-x/vote')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('Store API — Admin routes require auth', () => {
  // Build a minimal test app that mounts admin routes the same way index.js does
  let app;
  beforeAll(() => {
    const express = require('express');
    const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
    const { getOrder, listOrders } = require('../api/admin/getOrder');
    const updateOrderStatus = require('../api/admin/updateOrderStatus');

    app = express();
    app.use(express.json());
    app.post('/admin/updateOrderStatus', requireAuth, requireAdmin, updateOrderStatus);
    app.get('/admin/getOrder', requireAuth, requireAdmin, getOrder);
    app.get('/admin/listOrders', requireAuth, requireAdmin, listOrders);
  });

  test('GET /admin/getOrder without auth returns 401', async () => {
    const res = await request(app).get('/admin/getOrder?orderId=order-1');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('GET /admin/listOrders without auth returns 401', async () => {
    const res = await request(app).get('/admin/listOrders');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('POST /admin/updateOrderStatus without auth returns 401', async () => {
    const res = await request(app)
      .post('/admin/updateOrderStatus')
      .send({ orderId: 'order-1', orderStatus: 'shipped' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('GET /admin/getOrder with non-admin token returns 403', async () => {
    // VALID_USER_TOKEN verifies but user has no admin_users doc → no role
    const res = await request(app)
      .get('/admin/getOrder?orderId=order-1')
      .set('Authorization', 'Bearer VALID_USER_TOKEN');
    expect(res.status).toBe(403);
  });

  test('GET /admin/getOrder with admin token returns order data', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'admin@kaayko.com' };
    admin._mocks.docData['orders/order-123'] = { orderId: 'order-123', orderStatus: 'pending', productTitle: 'River Tee' };

    const res = await request(app)
      .get('/admin/getOrder?orderId=order-123')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order).toBeDefined();
  });
});

describe('Store API — Images health check', () => {
  test('GET /images/health returns healthy status', async () => {
    const app = buildTestApp('/images', require('../api/products/images'));
    const res = await request(app).get('/images/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  test('GET /images/:productId/:fileName for missing image returns 404 with standard error shape', async () => {
    // Mock bucket.file.exists to return false
    admin._mocks.bucket.file.mockReturnValueOnce({
      exists: jest.fn(async () => [false])
    });

    const app = buildTestApp('/images', require('../api/products/images'));
    const res = await request(app).get('/images/prod-123/photo.jpg');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('IMAGE_NOT_FOUND');
  });
});
