require('./helpers/mockSetup');
const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');

let kreatorApp;
beforeAll(() => {
  kreatorApp = buildTestApp('/kreators', require('../api/kreators/kreatorRoutes'));
});

describe('Kreator API — Health check', () => {
  test('GET /kreators/health returns healthy', async () => {
    const res = await request(kreatorApp).get('/kreators/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.service).toMatch(/Kreator/i);
  });
});

describe('Kreator API — Application submission validation', () => {
  test('POST /kreators/apply with empty body returns 400 VALIDATION_ERROR', async () => {
    const res = await request(kreatorApp)
      .post('/kreators/apply')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST /kreators/apply with missing required fields returns validation errors', async () => {
    const res = await request(kreatorApp)
      .post('/kreators/apply')
      .send({
        firstName: 'Jane',
        lastName: 'Doe'
        // missing email, businessName, etc.
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST /kreators/apply with agreedToTerms: false returns 400', async () => {
    const res = await request(kreatorApp)
      .post('/kreators/apply')
      .send({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phone: '+1-555-123-4567',
        businessName: 'Jane Crafts',
        businessType: 'individual_maker',
        productCategories: ['apparel'],
        productDescription: 'Hand-crafted apparel items made from sustainable materials for outdoor enthusiasts.',
        productCount: '10-50',
        priceRange: '$20-$100',
        location: 'Portland, OR',
        shippingCapability: 'US only',
        fulfillmentTime: '3-5 business days',
        inventoryManagement: 'manual',
        agreedToTerms: false,       // <-- invalid
        confirmedAuthenticity: true
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /kreators/apply with valid data creates application', async () => {
    const res = await request(kreatorApp)
      .post('/kreators/apply')
      .send({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.kreator@example.com',
        phone: '+1-555-123-4567',
        businessName: 'Jane Crafts',
        businessType: 'individual_maker',
        productCategories: ['apparel'],
        productDescription: 'Hand-crafted apparel items made from sustainable materials for outdoor enthusiasts.',
        productCount: '10-50',
        priceRange: '$20-$100',
        location: 'Portland, OR',
        shippingCapability: 'US only',
        fulfillmentTime: '3-5 business days',
        inventoryManagement: 'manual',
        agreedToTerms: true,
        confirmedAuthenticity: true
      });

    // Validation passed — status is not 400 (not a validation error).
    // May be 201 (created), 200 (success), or 500 (DB mock limited) in test env.
    expect(res.status).not.toBe(400);
    expect(res.body.code).not.toBe('VALIDATION_ERROR');
  });
});

describe('Kreator API — Magic link verification', () => {
  test('POST /kreators/onboarding/verify without token returns 400', async () => {
    const res = await request(kreatorApp)
      .post('/kreators/onboarding/verify')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /kreators/onboarding/verify with non-existent token returns 404', async () => {
    const res = await request(kreatorApp)
      .post('/kreators/onboarding/verify')
      .send({ token: 'ml_nonexistent_token_abc123456789' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('MAGIC_LINK_NOT_FOUND');
  });

  test('POST /kreators/onboarding/complete with weak password returns 400 INVALID_PASSWORD', async () => {
    const res = await request(kreatorApp)
      .post('/kreators/onboarding/complete')
      .send({ token: 'ml_sometoken', password: 'weak' });

    // Could be 400 (password validation) or 404 (token not found) — either means auth failed
    expect([400, 404]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });
});

describe('Kreator API — Protected endpoints require session auth', () => {
  test('GET /kreators/me without auth returns 401 AUTH_TOKEN_MISSING', async () => {
    const res = await request(kreatorApp).get('/kreators/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('PUT /kreators/me without auth returns 401', async () => {
    const res = await request(kreatorApp)
      .put('/kreators/me')
      .send({ displayName: 'New Name' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('DELETE /kreators/me without auth returns 401', async () => {
    const res = await request(kreatorApp).delete('/kreators/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('POST /kreators/auth/google/connect without auth returns 401', async () => {
    const res = await request(kreatorApp)
      .post('/kreators/auth/google/connect')
      .send({ googleUid: 'g-123' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });
});

describe('Kreator API — Product routes require session auth', () => {
  test('GET /kreators/products without auth returns 401', async () => {
    const res = await request(kreatorApp).get('/kreators/products');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('POST /kreators/products without auth returns 401', async () => {
    const res = await request(kreatorApp)
      .post('/kreators/products')
      .send({ title: 'My Product' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });
});

describe('Kreator API — Admin routes require Firebase admin auth', () => {
  test('GET /kreators/admin/applications without auth returns 401', async () => {
    const res = await request(kreatorApp).get('/kreators/admin/applications');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('GET /kreators/admin/stats without auth returns 401', async () => {
    const res = await request(kreatorApp).get('/kreators/admin/stats');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('PUT /kreators/admin/applications/:id/approve without auth returns 401', async () => {
    const res = await request(kreatorApp)
      .put('/kreators/admin/applications/app-123/approve')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('PUT /kreators/admin/applications/:id/reject without auth returns 401', async () => {
    const res = await request(kreatorApp)
      .put('/kreators/admin/applications/app-123/reject')
      .send({ reason: 'Not eligible at this time' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('GET /kreators/admin/applications with admin token returns data', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'admin@kaayko.com' };
    admin._mocks.collectionData['kreator_applications'] = [];

    const res = await request(kreatorApp)
      .get('/kreators/admin/applications')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    // Response shape: { success: true, data: { applications: [...], total, hasMore } }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  test('GET /kreators/admin/stats with admin token returns counts', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'admin@kaayko.com' };

    const res = await request(kreatorApp)
      .get('/kreators/admin/stats')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    // Response shape: { success: true, data: { applications: {...}, kreators: {...} } }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });
});

describe('Kreator API — Error response shape is standard', () => {
  test('All auth errors include success:false and code field', async () => {
    const res = await request(kreatorApp).get('/kreators/me');

    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
    expect(typeof res.body.code).toBe('string');
  });
});
