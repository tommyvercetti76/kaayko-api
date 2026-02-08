/**
 * Kortex Public API Tests — programmatic API with API key auth
 *
 * Routes from api/kortex/publicApiRouter.js:
 *   POST /smartlinks           — createLink       (create:links)
 *   GET  /smartlinks           — listLinks        (read:links)
 *   GET  /smartlinks/:code     — getLink          (read:links)
 *   PUT  /smartlinks/:code     — updateLink       (update:links)
 *   DELETE /smartlinks/:code   — deleteLink       (delete:links)
 *   GET  /smartlinks/:code/stats       — getStats         (read:stats)
 *   GET  /smartlinks/:code/attribution — getAttribution   (read:stats)
 *   POST /smartlinks/batch     — batchCreate      (create:links)
 *   GET  /health               — health
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

// Mock apiKeyMiddleware — pass through and set req.apiClient
jest.mock('../middleware/apiKeyMiddleware', () => ({
  requireApiKey: (scopes) => (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ success: false, error: 'API key required', code: 'API_KEY_MISSING' });
    if (!key.startsWith('ak_')) return res.status(401).json({ success: false, error: 'Invalid key format', code: 'API_KEY_INVALID_FORMAT' });
    req.apiClient = { keyId: 'key-1', tenantId: 'T1', tenantName: 'TestTenant', scopes: ['*'] };
    next();
  }
}));

// Mock rateLimitService
jest.mock('../api/kortex/rateLimitService', () => ({
  checkRateLimit: jest.fn(async () => true),
  getRateLimitStatus: jest.fn(async () => ({ remaining: 100 })),
  tenantRateLimit: jest.fn(() => (_r, _s, n) => n())
}));

// Mock publicApiHandlers
jest.mock('../api/kortex/publicApiHandlers', () => ({
  health: jest.fn((_req, res) => res.json({ success: true, service: 'Kortex Public API', status: 'healthy' })),
  createLink: jest.fn((req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL required' });
    res.status(201).json({ success: true, data: { id: 'link-1', shortCode: 'abc123', url, tenantId: req.apiClient.tenantId } });
  }),
  listLinks: jest.fn((req, res) => {
    res.json({ success: true, data: [{ id: 'link-1', shortCode: 'abc123' }], total: 1, tenantId: req.apiClient.tenantId });
  }),
  getLink: jest.fn((req, res) => {
    if (req.params.code === 'ghost') return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: { id: 'link-1', shortCode: req.params.code, url: 'https://example.com' } });
  }),
  updateLink: jest.fn((req, res) => {
    if (req.params.code === 'ghost') return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: { shortCode: req.params.code, ...req.body } });
  }),
  deleteLink: jest.fn((req, res) => {
    if (req.params.code === 'ghost') return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, message: 'Link deleted' });
  }),
  getStats: jest.fn((req, res) => {
    if (req.params.code === 'ghost') return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: { clicks: 42, uniqueClicks: 30, topCountries: ['US'] } });
  }),
  getAttribution: jest.fn((req, res) => {
    if (req.params.code === 'ghost') return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: { sources: [{ source: 'direct', count: 20 }] } });
  }),
  batchCreate: jest.fn((req, res) => {
    const { links } = req.body;
    if (!links || !Array.isArray(links) || links.length === 0) return res.status(400).json({ success: false, error: 'Links array required' });
    if (links.length > 100) return res.status(400).json({ success: false, error: 'Max 100 links per batch' });
    res.status(201).json({ success: true, data: links.map((l, i) => ({ id: `link-${i}`, shortCode: `code${i}`, url: l.url })), total: links.length });
  })
}));

const validKey = factories.apiKeys.valid;
let app;

beforeEach(() => {
  const a = express();
  a.use(express.json());
  a.use('/public', require('../api/kortex/publicApiRouter'));
  app = a;
});

// ═══════════════════════════════════════════════════════════════
// HEALTH — no API key needed
// ═══════════════════════════════════════════════════════════════

describe('GET /public/health', () => {
  test('returns 200 without API key', async () => {
    const res = await request(app).get('/public/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// AUTH CHECKS
// ═══════════════════════════════════════════════════════════════

describe('API Key Authentication', () => {
  test('rejects missing API key → 401', async () => {
    const res = await request(app).get('/public/smartlinks');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('API_KEY_MISSING');
  });

  test('rejects invalid key format → 401', async () => {
    const res = await request(app).get('/public/smartlinks').set('x-api-key', 'bad-key');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('API_KEY_INVALID_FORMAT');
  });
});

// ═══════════════════════════════════════════════════════════════
// CRUD
// ═══════════════════════════════════════════════════════════════

describe('POST /public/smartlinks (create)', () => {
  test('creates link with valid URL → 201', async () => {
    const res = await request(app).post('/public/smartlinks')
      .set('x-api-key', validKey)
      .send({ url: 'https://example.com', title: 'Test' });
    expect(res.status).toBe(201);
    expect(res.body.data.tenantId).toBe('T1');
  });

  test('rejects missing URL → 400', async () => {
    const res = await request(app).post('/public/smartlinks')
      .set('x-api-key', validKey).send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /public/smartlinks (list)', () => {
  test('returns tenant-scoped link list → 200', async () => {
    const res = await request(app).get('/public/smartlinks').set('x-api-key', validKey);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeInstanceOf(Array);
  });
});

describe('GET /public/smartlinks/:code', () => {
  test('returns link by code → 200', async () => {
    const res = await request(app).get('/public/smartlinks/abc123').set('x-api-key', validKey);
    expect(res.status).toBe(200);
  });

  test('returns 404 for non-existent code', async () => {
    const res = await request(app).get('/public/smartlinks/ghost').set('x-api-key', validKey);
    expect(res.status).toBe(404);
  });
});

describe('PUT /public/smartlinks/:code', () => {
  test('updates link → 200', async () => {
    const res = await request(app).put('/public/smartlinks/abc123')
      .set('x-api-key', validKey).send({ title: 'Updated' });
    expect(res.status).toBe(200);
  });

  test('returns 404 for non-existent code', async () => {
    const res = await request(app).put('/public/smartlinks/ghost')
      .set('x-api-key', validKey).send({ title: 'Updated' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /public/smartlinks/:code', () => {
  test('deletes link → 200', async () => {
    const res = await request(app).delete('/public/smartlinks/abc123').set('x-api-key', validKey);
    expect(res.status).toBe(200);
  });

  test('returns 404 for non-existent code', async () => {
    const res = await request(app).delete('/public/smartlinks/ghost').set('x-api-key', validKey);
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════

describe('GET /public/smartlinks/:code/stats', () => {
  test('returns stats → 200', async () => {
    const res = await request(app).get('/public/smartlinks/abc123/stats').set('x-api-key', validKey);
    expect(res.status).toBe(200);
    expect(res.body.data.clicks).toBeDefined();
  });

  test('returns 404 for non-existent link', async () => {
    const res = await request(app).get('/public/smartlinks/ghost/stats').set('x-api-key', validKey);
    expect(res.status).toBe(404);
  });
});

describe('GET /public/smartlinks/:code/attribution', () => {
  test('returns attribution data → 200', async () => {
    const res = await request(app).get('/public/smartlinks/abc123/attribution').set('x-api-key', validKey);
    expect(res.status).toBe(200);
    expect(res.body.data.sources).toBeInstanceOf(Array);
  });
});

// ═══════════════════════════════════════════════════════════════
// BATCH
// ═══════════════════════════════════════════════════════════════

describe('POST /public/smartlinks/batch', () => {
  test('creates batch of links → 201', async () => {
    const res = await request(app).post('/public/smartlinks/batch')
      .set('x-api-key', validKey)
      .send({ links: [{ url: 'https://a.com' }, { url: 'https://b.com' }] });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);
  });

  test('rejects empty links array → 400', async () => {
    const res = await request(app).post('/public/smartlinks/batch')
      .set('x-api-key', validKey).send({ links: [] });
    expect(res.status).toBe(400);
  });

  test('rejects missing links → 400', async () => {
    const res = await request(app).post('/public/smartlinks/batch')
      .set('x-api-key', validKey).send({});
    expect(res.status).toBe(400);
  });

  test('rejects batch over 100 links → 400', async () => {
    const links = Array(101).fill({ url: 'https://example.com' });
    const res = await request(app).post('/public/smartlinks/batch')
      .set('x-api-key', validKey).send({ links });
    expect(res.status).toBe(400);
  });
});
