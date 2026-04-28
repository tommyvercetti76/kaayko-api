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
let deepLinksApp;
beforeAll(() => {
  smartLinksApp = buildTestApp('/smartlinks', require('../api/kortex/smartLinks'));
  deepLinksApp = buildTestApp('/', require('../api/deepLinks/deeplinkRoutes'));
});

beforeEach(() => {
  admin._mocks.resetAll();
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

  test('GET /smartlinks/:code for existing link returns public-safe link data', async () => {
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
    expect(res.body.link.title).toBe('Test Link');
    expect(res.body.link.destinations).toBeUndefined();
    expect(res.body.link.metadata).toBeUndefined();
    expect(res.body.link.tenantId).toBeUndefined();
  });

  test('GET /smartlinks/tenants/:tenantSlug/bootstrap returns tenant portal routes', async () => {
    admin._mocks.docData['tenants/parishram'] = {
      name: 'Parishram Alumni',
      slug: 'parishram',
      domain: 'kaayko.com',
      alumniDomain: 'parishram.alumni.kaayko.com',
      enabled: true
    };

    const res = await request(smartLinksApp)
      .get('/smartlinks/tenants/parishram/bootstrap?host=kaayko.com&path=/a/parishram/admin');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tenant.slug).toBe('parishram');
    expect(res.body.routes.login).toBe('https://parishram.alumni.kaayko.com/login');
    expect(res.body.routes.register).toBe('/a/parishram/register');
  });

  test('GET /smartlinks/links/:code/resolve resolves namespace tenant admin aliases', async () => {
    admin._mocks.docData['tenants/parishram'] = {
      name: 'Parishram Alumni',
      slug: 'parishram',
      domain: 'kaayko.com',
      alumniDomain: 'parishram.alumni.kaayko.com',
      enabled: true
    };
    admin._mocks.docData['short_links/a_adminp12'] = {
      code: 'a_adminp12',
      title: 'Parishram Admin',
      tenantId: 'parishram',
      tenantName: 'Parishram Alumni',
      destinations: { web: 'https://parishram.alumni.kaayko.com/admin' },
      enabled: true,
      destinationType: 'tenant_admin_login',
      audience: 'admin',
      intent: 'login',
      source: 'manual',
      metadata: {
        destinationType: 'tenant_admin_login',
        audience: 'admin',
        intent: 'login'
      }
    };

    const res = await request(smartLinksApp)
      .get('/smartlinks/links/adminP12/resolve?namespace=a&host=kaayko.com&path=/a/adminP12');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.link.destinationType).toBe('tenant_admin_login');
    expect(res.body.destination).toContain('https://parishram.alumni.kaayko.com/login');
    expect(res.body.destination).toContain('kt_link=a_adminp12');
  });

  test('POST /smartlinks/events accepts KORTEX V2 conversion events', async () => {
    const res = await request(smartLinksApp)
      .post('/smartlinks/events')
      .send({
        type: 'registration_submitted',
        tenantId: 'parishram',
        linkCode: 'a_adminp12',
        source: 'qr',
        audience: 'alumni',
        intent: 'register'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.eventId).toBeDefined();
  });

  test('POST /smartlinks/tenant-links creates namespace aliases with public /a/:code URLs', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = {
      role: 'admin',
      email: 'admin@kaayko.com',
      tenantId: 'kaayko-default'
    };

    const res = await request(smartLinksApp)
      .post('/smartlinks/tenant-links')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({
        namespace: 'a',
        code: 'adminP12',
        tenantSlug: 'parishram',
        alumniDomain: 'parishram.alumni.kaayko.com',
        destinationType: 'tenant_admin_login',
        audience: 'admin',
        intent: 'login',
        title: 'Parishram Admin'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.link.code).toBe('a_adminp12');
    expect(res.body.link.publicCode).toBe('adminP12');
    expect(res.body.link.shortUrl).toBe('https://kaayko.com/a/adminP12');
    expect(admin._mocks.docData['short_links/a_adminp12']).toBeDefined();
  });

  test('GET /smartlinks/:code returns full link data to an admin in the same tenant', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = {
      role: 'admin',
      email: 'admin@kaayko.com',
      tenantId: 'tenant-a'
    };
    admin._mocks.docData['short_links/lktenanta'] = {
      code: 'lktenanta',
      title: 'Tenant A Link',
      shortUrl: 'https://go.tenant-a.test/l/lktenanta',
      destinations: { web: 'https://tenant-a.test/private' },
      metadata: { campaign: 'launch' },
      enabled: true,
      tenantId: 'tenant-a'
    };

    const res = await request(smartLinksApp)
      .get('/smartlinks/lktenanta')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.link.destinations.web).toBe('https://tenant-a.test/private');
    expect(res.body.link.metadata.campaign).toBe('launch');
    expect(res.body.link.tenantId).toBe('tenant-a');
  });

  test('GET /smartlinks/:code redacts full data from admins in other tenants', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = {
      role: 'admin',
      email: 'admin@kaayko.com',
      tenantId: 'tenant-a'
    };
    admin._mocks.docData['short_links/lktenantb'] = {
      code: 'lktenantb',
      title: 'Tenant B Link',
      shortUrl: 'https://go.tenant-b.test/l/lktenantb',
      destinations: { web: 'https://tenant-b.test/private' },
      metadata: { campaign: 'confidential' },
      enabled: true,
      tenantId: 'tenant-b'
    };

    const res = await request(smartLinksApp)
      .get('/smartlinks/lktenantb')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.link.code).toBe('lktenantb');
    expect(res.body.link.destinations).toBeUndefined();
    expect(res.body.link.metadata).toBeUndefined();
    expect(res.body.link.tenantId).toBeUndefined();
  });

  test('GET /smartlinks/stats without auth returns 401', async () => {
    const res = await request(smartLinksApp).get('/smartlinks/stats');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('GET /smartlinks/stats returns tenant-scoped aggregate stats', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = {
      role: 'admin',
      email: 'admin@kaayko.com',
      tenantId: 'tenant-a'
    };
    admin._mocks.docData['short_links/a1'] = {
      code: 'a1',
      tenantId: 'tenant-a',
      enabled: true,
      clickCount: 3
    };
    admin._mocks.docData['short_links/a2'] = {
      code: 'a2',
      tenantId: 'tenant-a',
      enabled: false,
      clickCount: 2
    };
    admin._mocks.docData['short_links/b1'] = {
      code: 'b1',
      tenantId: 'tenant-b',
      enabled: true,
      clickCount: 99
    };

    const res = await request(smartLinksApp)
      .get('/smartlinks/stats')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.tenant.id).toBe('tenant-a');
    expect(res.body.stats).toEqual({
      totalLinks: 2,
      totalClicks: 5,
      enabledLinks: 1,
      disabledLinks: 1
    });
  });
});

describe('Kortex Redirects — Source-aware behavior', () => {
  test('GET /l/:id accepts src alias and preserves canonical utm_source on redirect', async () => {
    admin._mocks.docData['short_links/lksrc1'] = {
      code: 'lksrc1',
      title: 'Source-aware Link',
      destinations: { web: 'https://example.com/landing' },
      enabled: true,
      clickCount: 0,
      tenantId: 'kaayko-default'
    };

    const res = await request(deepLinksApp).get('/l/lksrc1?src=text');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://example.com/landing');
    expect(res.headers.location).toContain('utm_source=text');
  });

  test('GET /l/:id returns 404 when the source rule disables that source', async () => {
    admin._mocks.docData['short_links/lkblock1'] = {
      code: 'lkblock1',
      title: 'Blocked QR Link',
      destinations: { web: 'https://example.com/landing' },
      enabled: true,
      tenantId: 'kaayko-default',
      metadata: {
        sourceRules: {
          qr: { enabled: false, statusCode: 404, message: 'QR campaign stopped.' }
        }
      }
    };

    const res = await request(deepLinksApp).get('/l/lkblock1?src=qr');

    expect(res.status).toBe(404);
    expect(res.text).toContain('QR campaign stopped.');
  });

  test('GET /l/:id legacy universal-link mode renders without server error', async () => {
    const res = await request(deepLinksApp).get('/l/antero?src=ul');

    expect(res.status).toBe(200);
    expect(res.text).toContain('kaayko://lake/antero');
    expect(res.text).toContain('_kctx=');
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

  test('POST /smartlinks creates links in authenticated admin tenant and ignores spoofed domain', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = {
      role: 'admin',
      email: 'admin@kaayko.com',
      tenantId: 'tenant-a',
      tenantName: 'Tenant A'
    };
    admin._mocks.docData['tenants/tenant-a'] = {
      name: 'Tenant A',
      domain: 'go.tenant-a.test',
      pathPrefix: '/go',
      enabled: true
    };

    const res = await request(smartLinksApp)
      .post('/smartlinks')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({
        code: 'tenant-a-link',
        webDestination: 'https://tenant-a.test/content',
        title: 'Tenant A Link',
        domain: 'evil.test',
        pathPrefix: '/evil'
      });

    expect(res.status).toBe(200);
    expect(res.body.link.tenantId).toBe('tenant-a');
    expect(res.body.link.domain).toBe('go.tenant-a.test');
    expect(res.body.link.pathPrefix).toBe('/go');
    expect(res.body.link.shortUrl).toBe('https://go.tenant-a.test/go/tenant-a-link');
  });

  test('GET /smartlinks lists only the authenticated admin tenant by default', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = {
      role: 'admin',
      email: 'admin@kaayko.com',
      tenantId: 'tenant-a'
    };
    admin._mocks.docData['short_links/a1'] = {
      code: 'a1',
      title: 'Tenant A',
      destinations: { web: 'https://tenant-a.test' },
      tenantId: 'tenant-a',
      enabled: true,
      createdAt: new Date()
    };
    admin._mocks.docData['short_links/b1'] = {
      code: 'b1',
      title: 'Tenant B',
      destinations: { web: 'https://tenant-b.test' },
      tenantId: 'tenant-b',
      enabled: true,
      createdAt: new Date()
    };

    const res = await request(smartLinksApp)
      .get('/smartlinks')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.tenant.id).toBe('tenant-a');
    expect(res.body.links.map(link => link.code)).toEqual(['a1']);
  });

  test('GET /smartlinks honors X-Kaayko-Tenant-Id only for assigned tenant admins', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = {
      role: 'admin',
      email: 'admin@kaayko.com',
      tenantIds: ['tenant-a', 'tenant-c']
    };
    admin._mocks.docData['short_links/c1'] = {
      code: 'c1',
      title: 'Tenant C',
      destinations: { web: 'https://tenant-c.test' },
      tenantId: 'tenant-c',
      enabled: true,
      createdAt: new Date()
    };

    const allowed = await request(smartLinksApp)
      .get('/smartlinks')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .set('X-Kaayko-Tenant-Id', 'tenant-c');

    const denied = await request(smartLinksApp)
      .get('/smartlinks')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .set('X-Kaayko-Tenant-Id', 'tenant-b');

    expect(allowed.status).toBe(200);
    expect(allowed.body.tenant.id).toBe('tenant-c');
    expect(allowed.body.links.map(link => link.code)).toEqual(['c1']);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('TENANT_ACCESS_DENIED');
  });

  test('PUT and DELETE reject admins from other tenants', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = {
      role: 'admin',
      email: 'admin@kaayko.com',
      tenantId: 'tenant-a'
    };
    admin._mocks.docData['short_links/lktenantb'] = {
      code: 'lktenantb',
      title: 'Tenant B Link',
      destinations: { web: 'https://tenant-b.test/private' },
      enabled: true,
      tenantId: 'tenant-b'
    };

    const updateRes = await request(smartLinksApp)
      .put('/smartlinks/lktenantb')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({ title: 'Pwned' });

    const deleteRes = await request(smartLinksApp)
      .delete('/smartlinks/lktenantb')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(updateRes.status).toBe(403);
    expect(deleteRes.status).toBe(403);
    expect(admin._mocks.docData['short_links/lktenantb']).toBeDefined();
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

describe('Kortex API — Public event tracking is constrained', () => {
  test('POST /smartlinks/events/:type rejects unsupported event types', async () => {
    const res = await request(smartLinksApp)
      .post('/smartlinks/events/delete-everything')
      .send({ linkId: 'lktest1' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_EVENT_TYPE');
  });

  test('POST /smartlinks/events/:type rejects unknown links', async () => {
    const res = await request(smartLinksApp)
      .post('/smartlinks/events/install')
      .send({ linkId: 'missing-link' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Link not found');
  });

  test('POST /smartlinks/events/:type records tenant on valid events', async () => {
    admin._mocks.docData['short_links/lkevent1'] = {
      code: 'lkevent1',
      title: 'Event Link',
      destinations: { web: 'https://example.com' },
      enabled: true,
      tenantId: 'tenant-a'
    };

    const res = await request(smartLinksApp)
      .post('/smartlinks/events/open')
      .send({ linkId: 'lkevent1', platform: 'ios' });

    const analytics = Object.values(admin._mocks.docData)
      .find(value => value?.type === 'open' && value?.linkId === 'lkevent1');

    expect(res.status).toBe(200);
    expect(analytics.tenantId).toBe('tenant-a');
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
