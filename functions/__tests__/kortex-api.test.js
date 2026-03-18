require('./helpers/mockSetup');

// Mock security middleware — bot protection and rate limiting block supertest requests
// (no User-Agent header). These are tested separately; here we verify business logic.
jest.mock('../middleware/securityMiddleware', () => ({
  secureHeaders: (req, res, next) => next(),
  botProtection: (req, res, next) => next(),
  rateLimiter: () => (req, res, next) => next(),
  honeypot: (req, res) => res.status(200).json({ success: true, honeypot: true }),
}));

const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');

// Build the smartlinks app once for the describe blocks
let smartLinksApp;
beforeAll(() => {
  smartLinksApp = buildTestApp('/smartlinks', require('../api/smartLinks/smartLinks'));
});

describe('Kortex API — Health & Public Endpoints', () => {
  test('GET /smartlinks/health returns healthy status', async () => {
    const res = await request(smartLinksApp).get('/smartlinks/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('healthy');
    expect(res.body.service).toMatch(/Smart Links/);
  });

  test('GET /smartlinks/:code for unknown link returns 404', async () => {
    // No doc set → exists returns false
    const res = await request(smartLinksApp).get('/smartlinks/unknown-code');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('GET /smartlinks/:code for existing link returns link data', async () => {
    admin._mocks.docData['short_links/lktest1'] = {
      code: 'lktest1',
      title: 'Test Link',
      shortUrl: 'https://kaayko.com/l/lktest1',
      destinations: { ios: 'kaayko://store', android: 'kaayko://store', web: 'https://kaayko.com/store' },
      enabled: true,
      clickCount: 0,
      tenantId: 'kaayko-default',
      createdAt: new Date()
    };

    const res = await request(smartLinksApp).get('/smartlinks/lktest1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.link).toBeDefined();
    expect(res.body.link.code).toBe('lktest1');
  });
});

describe('Kortex API — Auth-protected CRUD requires admin', () => {
  test('POST /smartlinks without auth returns 401 AUTH_TOKEN_MISSING', async () => {
    const res = await request(smartLinksApp)
      .post('/smartlinks')
      .send({ webDestination: 'https://kaayko.com/store', title: 'Test' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('POST /smartlinks with non-admin token returns 403', async () => {
    // VALID_USER_TOKEN has uid=user-uid, no admin_users doc
    const res = await request(smartLinksApp)
      .post('/smartlinks')
      .send({ webDestination: 'https://kaayko.com/store', title: 'Test' })
      .set('Authorization', 'Bearer VALID_USER_TOKEN');

    expect(res.status).toBe(403);
  });

  test('GET /smartlinks (list) without auth returns 401', async () => {
    const res = await request(smartLinksApp).get('/smartlinks');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('PUT /smartlinks/:code without auth returns 401', async () => {
    const res = await request(smartLinksApp)
      .put('/smartlinks/lktest1')
      .send({ title: 'Updated' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('DELETE /smartlinks/:code without auth returns 401', async () => {
    const res = await request(smartLinksApp).delete('/smartlinks/lktest1');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('POST /smartlinks with Firebase admin token passes auth gate', async () => {
    // POST /smartlinks uses requireAuth + requireAdmin — requires a real Firebase Bearer token.
    // X-Admin-Key alone does NOT bypass requireAuth on these routes (by design).
    // Set up admin_users doc so requireAdmin recognizes the token holder as admin.
    admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'admin@kaayko.com', tenantId: 'kaayko-default' };

    const res = await request(smartLinksApp)
      .post('/smartlinks')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({
        webDestination: 'https://kaayko.com/store',
        title: 'Admin Token Test Link'
      });

    // Auth passed — may return 201 (created) or 400/500 (validation/service error),
    // but not 401 (unauthorized) or 403 (forbidden).
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe('Kortex API — Admin migration endpoint requires admin', () => {
  test('GET /smartlinks/admin/migrate without auth returns 401', async () => {
    const res = await request(smartLinksApp).get('/smartlinks/admin/migrate');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });
});

describe('Kortex API — Tenant registration is rate-limited public endpoint', () => {
  test('POST /smartlinks/tenant-registration with missing fields returns 400', async () => {
    const res = await request(smartLinksApp)
      .post('/smartlinks/tenant-registration')
      .send({ organization: { name: 'Test Org' } }); // missing required fields

    // Should reach handler and return validation error or 400
    expect([400, 422, 429]).toContain(res.status);
  });
});

describe('Kortex API — Error response shape is standard', () => {
  test('Auth errors include success:false and code field', async () => {
    const res = await request(smartLinksApp).post('/smartlinks').send({});

    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
    expect(typeof res.body.code).toBe('string');
  });
});
