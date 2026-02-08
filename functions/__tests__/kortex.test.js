/**
 * Kortex (Smart Links) Tests — CRUD, stats, tenants, events, redirect
 * Routes from api/kortex/kortex.js + tenantRoutes.js
 */
require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const factories = require('./helpers/factories');
const admin = require('firebase-admin');

jest.mock('../middleware/securityMiddleware', () => ({
  rateLimiter: () => (_r, _s, n) => n(),
  botProtection: (_r, _s, n) => n(),
  secureHeaders: (_r, _s, n) => n()
}));

jest.mock('../middleware/securityUtils', () => ({
  RATE_LIMITS: { api: { window: 60000, max: 100 } },
  isBot: jest.fn(() => false),
  getClientIp: jest.fn(() => '127.0.0.1'),
  honeypot: (_r, _s, n) => n(),
  honeypotTraps: (_r, _s, n) => n()
}));

jest.mock('../middleware/rateLimit', () => jest.fn(() => (_r, _s, n) => n()));

// Mock kortexHandlers
jest.mock('../api/kortex/kortexHandlers', () => ({
  getStats: jest.fn((_req, res) => res.json({ success: true, stats: { totalLinks: 42, totalClicks: 1000 } })),
  createLink: jest.fn((req, res) => {
    const { url, iosUrl, androidUrl } = req.body;
    if (!url && !iosUrl && !androidUrl) return res.status(400).json({ success: false, error: 'At least one destination URL required' });
    res.status(201).json({ success: true, data: { id: 'link-1', shortCode: 'abc123', url } });
  }),
  listLinks: jest.fn((_req, res) => res.json({ success: true, data: [{ id: 'link-1', shortCode: 'abc123' }], total: 1 })),
  getLink: jest.fn((req, res) => {
    if (req.params.code === 'ghost') return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: { id: req.params.code, shortCode: req.params.code, url: 'https://example.com' } });
  }),
  updateLink: jest.fn((req, res) => {
    if (req.params.code === 'ghost') return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: { id: req.params.code, ...req.body } });
  }),
  deleteLink: jest.fn((req, res) => {
    if (req.params.code === 'ghost') return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, message: 'Link deleted' });
  }),
  trackEvent: jest.fn((req, res) => {
    const { type } = req.params;
    if (!['click', 'install', 'open'].includes(type)) return res.status(400).json({ success: false, error: 'Invalid event type' });
    res.json({ success: true });
  })
}));

// Mock tenantHandlers
jest.mock('../api/kortex/tenantHandlers', () => ({
  listTenants: jest.fn((_req, res) => res.json({ success: true, data: [{ id: 'T1', name: 'Test Tenant' }] })),
  register: jest.fn((req, res) => {
    const { companyName, domain, contactEmail } = req.body;
    if (!companyName || !domain || !contactEmail) return res.status(400).json({ success: false, error: 'Missing fields' });
    res.status(201).json({ success: true, data: { id: 'T-new', companyName, domain } });
  }),
  migrate: jest.fn((_req, res) => res.json({ success: true, message: 'Migration complete' }))
}));

// Mock redirectHandler
jest.mock('../api/kortex/redirectHandler', () => ({
  handleRedirect: jest.fn((req, res) => {
    if (req.params.shortCode === 'notfound') return res.status(404).send('Not Found');
    res.redirect(302, 'https://example.com');
  })
}));

let app;

beforeEach(() => {
  const a = express();
  a.use(express.json());
  a.use('/smartlinks', require('../api/kortex/kortex'));
  app = a;
});

// ═══════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════

describe('GET /smartlinks/health', () => {
  test('returns 200 with status', async () => {
    const res = await request(app).get('/smartlinks/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// STATS — requireAuth + requireAdmin
// ═══════════════════════════════════════════════════════════════

describe('GET /smartlinks/stats', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/smartlinks/stats');
    expect(res.status).toBe(401);
  });

  test('rejects non-admin → 403', async () => {
    const res = await request(app).get('/smartlinks/stats')
      .set('Authorization', `Bearer ${factories.tokens.user}`);
    expect(res.status).toBe(403);
  });

  test('returns stats for admin → 200', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
    const res = await request(app).get('/smartlinks/stats')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// CRUD — requireAuth + requireAdmin
// ═══════════════════════════════════════════════════════════════

describe('POST /smartlinks (create)', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).post('/smartlinks').send({ url: 'https://example.com' });
    expect(res.status).toBe(401);
  });

  test('creates link with valid data → 201', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
    const res = await request(app).post('/smartlinks')
      .set('Authorization', `Bearer ${factories.tokens.admin}`)
      .send({ url: 'https://example.com', title: 'Test Link' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('rejects missing destinations → 400', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
    const res = await request(app).post('/smartlinks')
      .set('Authorization', `Bearer ${factories.tokens.admin}`)
      .send({ title: 'No URL' });
    expect(res.status).toBe(400);
  });
});

describe('GET /smartlinks (list)', () => {
  test('returns link list for admin → 200', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
    const res = await request(app).get('/smartlinks')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /smartlinks/:code (get)', () => {
  test('returns link by code → 200', async () => {
    const res = await request(app).get('/smartlinks/abc123');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('returns 404 for non-existent code', async () => {
    const res = await request(app).get('/smartlinks/ghost');
    expect(res.status).toBe(404);
  });
});

describe('PUT /smartlinks/:id (update)', () => {
  test('updates link → 200', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
    const res = await request(app).put('/smartlinks/link-1')
      .set('Authorization', `Bearer ${factories.tokens.admin}`)
      .send({ title: 'Updated' });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /smartlinks/:id (delete)', () => {
  test('deletes link → 200', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
    const res = await request(app).delete('/smartlinks/link-1')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════

describe('POST /smartlinks/events/:type', () => {
  test('tracks click event → 200', async () => {
    const res = await request(app).post('/smartlinks/events/click')
      .send({ linkId: 'link-1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('tracks install event → 200', async () => {
    const res = await request(app).post('/smartlinks/events/install')
      .send({ linkId: 'link-1' });
    expect(res.status).toBe(200);
  });

  test('rejects invalid event type → 400', async () => {
    const res = await request(app).post('/smartlinks/events/invalid')
      .send({ linkId: 'link-1' });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// TENANTS — from tenantRoutes.js
// ═══════════════════════════════════════════════════════════════

describe('GET /smartlinks/tenants', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/smartlinks/tenants');
    expect(res.status).toBe(401);
  });

  test('returns tenant list for admin → 200', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
    const res = await request(app).get('/smartlinks/tenants')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /smartlinks/tenant-registration', () => {
  test('registers tenant with valid data → 201', async () => {
    const res = await request(app).post('/smartlinks/tenant-registration')
      .send({ companyName: 'Acme', domain: 'acme.com', contactEmail: 'admin@acme.com' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('rejects missing fields → 400', async () => {
    const res = await request(app).post('/smartlinks/tenant-registration').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /smartlinks/admin/migrate', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/smartlinks/admin/migrate');
    expect(res.status).toBe(401);
  });

  test('runs migration for admin → 200', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
    const res = await request(app).get('/smartlinks/admin/migrate')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect(res.status).toBe(200);
  });
});
