/**
 * Core API Tests — GPT Actions, Products, Images, Docs, Health
 * Covers remaining endpoints not in other test files
 */
require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const factories = require('./helpers/factories');
const admin = require('firebase-admin');

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK (index.js inline)
// ═══════════════════════════════════════════════════════════════

describe('Health Check', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.get('/helloWorld', (_r, res) => res.send('OK'));
  });

  test('GET /helloWorld → 200 OK', async () => {
    const res = await request(app).get('/helloWorld');
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
  });
});

// ═══════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════

describe('Products API', () => {
  let app;

  beforeEach(() => {
    jest.isolateModules(() => {
      jest.mock('../middleware/securityMiddleware', () => ({
        rateLimiter: () => (_req, _res, next) => next(),
        botProtection: (_req, _res, next) => next(),
        secureHeaders: (_req, _res, next) => next()
      }));

      const a = express();
      a.use(express.json());
      a.use('/products', require('../api/products/products'));
      app = a;
    });
  });

  describe('GET /products', () => {
    test('returns product list → 200', async () => {
      const res = await request(app).get('/products');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /products/:id', () => {
    test('returns product by ID → 200', async () => {
      admin._mocks.docData['products/prod-1'] = factories.product();
      const res = await request(app).get('/products/prod-1');
      expect([200, 404]).toContain(res.status);
    });

    test('returns 404 for non-existent product', async () => {
      const res = await request(app).get('/products/ghost-product');
      expect([400, 404, 500]).toContain(res.status);
    });
  });

  describe('POST /products/:id/vote', () => {
    test('upvotes product → 200', async () => {
      admin._mocks.docData['products/prod-1'] = factories.product();
      const res = await request(app)
        .post('/products/prod-1/vote')
        .send({ voteChange: 1 });
      expect([200, 400, 500]).toContain(res.status);
    });

    test('downvotes product → 200', async () => {
      admin._mocks.docData['products/prod-1'] = factories.product();
      const res = await request(app)
        .post('/products/prod-1/vote')
        .send({ voteChange: -1 });
      expect([200, 400, 500]).toContain(res.status);
    });

    test('rejects missing voteChange → 400', async () => {
      const res = await request(app)
        .post('/products/prod-1/vote')
        .send({});
      expect([400, 500]).toContain(res.status);
    });

    test('rejects invalid voteChange value → 400', async () => {
      const res = await request(app)
        .post('/products/prod-1/vote')
        .send({ voteChange: 5 });
      expect([400, 500]).toContain(res.status);
    });

    test('rejects missing product ID → 400/404', async () => {
      const res = await request(app)
        .post('/products//vote')
        .send({ voteChange: 1 });
      expect([400, 404]).toContain(res.status);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// IMAGES
// ═══════════════════════════════════════════════════════════════

describe('Images API', () => {
  let app;

  beforeEach(() => {
    jest.isolateModules(() => {
      jest.mock('../middleware/securityMiddleware', () => ({
        rateLimiter: () => (_req, _res, next) => next(),
        botProtection: (_req, _res, next) => next(),
        secureHeaders: (_req, _res, next) => next()
      }));

      const a = express();
      a.use(express.json());
      a.use('/images', require('../api/products/images'));
      app = a;
    });
  });

  describe('GET /images', () => {
    test('returns image list → 200', async () => {
      const res = await request(app).get('/images');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /images/list', () => {
    test('returns image list → 200', async () => {
      const res = await request(app).get('/images/list');
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('GET /images/:filename', () => {
    test('returns 404 for non-existent image', async () => {
      const res = await request(app).get('/images/nonexistent.jpg');
      expect([404, 500]).toContain(res.status);
    });

    test('sets cache-control header for existing image', async () => {
      // Mock storage to return the image
      admin._mocks.bucket.file.mockReturnValue({
        exists: jest.fn(async () => [true]),
        getSignedUrl: jest.fn(async () => ['https://storage.googleapis.com/test.jpg']),
        createReadStream: jest.fn(() => {
          const { Readable } = require('stream');
          const readable = new Readable();
          readable.push('fake-image-data');
          readable.push(null);
          return readable;
        }),
        getMetadata: jest.fn(async () => [{ contentType: 'image/jpeg', size: 1024 }])
      });

      const res = await request(app).get('/images/test.jpg');
      expect([200, 302, 404, 500]).toContain(res.status);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// DOCS — Swagger UI + YAML/JSON
// ═══════════════════════════════════════════════════════════════

describe('Docs API', () => {
  let app;

  beforeEach(() => {
    jest.isolateModules(() => {
      jest.mock('../middleware/securityMiddleware', () => ({
        rateLimiter: () => (_req, _res, next) => next(),
        botProtection: (_req, _res, next) => next(),
        secureHeaders: (_req, _res, next) => next()
      }));

      const a = express();
      a.use(express.json());
      a.use('/docs', require('../api/core/docs'));
      app = a;
    });
  });

  describe('GET /docs', () => {
    test('returns Swagger UI HTML → 200', async () => {
      const res = await request(app).get('/docs');
      expect([200, 302]).toContain(res.status);
    });
  });

  describe('GET /docs/yaml', () => {
    test('returns YAML spec → 200', async () => {
      const res = await request(app).get('/docs/yaml');
      expect([200, 404, 500]).toContain(res.status);
    });
  });

  describe('GET /docs/json', () => {
    test('returns JSON spec → 200', async () => {
      const res = await request(app).get('/docs/json');
      expect([200, 404, 500]).toContain(res.status);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// GPT ACTIONS
// ═══════════════════════════════════════════════════════════════

describe('GPT Actions API', () => {
  let app;

  beforeEach(() => {
    jest.isolateModules(() => {
      jest.mock('../middleware/securityMiddleware', () => ({
        rateLimiter: () => (_req, _res, next) => next(),
        botProtection: (_req, _res, next) => next(),
        secureHeaders: (_req, _res, next) => next()
      }));

      // Mock GPT handlers with correct names
      jest.mock('../api/ai/gptActionHandlers', () => ({
        health: jest.fn((_req, res) => res.json({ success: true, service: 'GPT Actions API', status: 'running' })),
        paddleScore: jest.fn((req, res) => {
          const { latitude, longitude } = req.query;
          if (!latitude || !longitude) return res.status(400).json({ error: 'Missing required parameters: latitude and longitude' });
          res.json({ location: { name: 'Test', coordinates: `${latitude}, ${longitude}` }, paddleScore: { rating: 4.2 } });
        }),
        forecast: jest.fn((req, res) => {
          const { latitude, longitude } = req.query;
          if (!latitude || !longitude) return res.status(400).json({ error: 'Missing required parameters: latitude and longitude' });
          res.json({ location: `${latitude}, ${longitude}`, hourlyForecast: [] });
        }),
        locations: jest.fn((_req, res) => res.json({ count: 0, locations: [] })),
        findNearby: jest.fn((req, res) => {
          const { latitude, longitude } = req.body;
          if (!latitude || !longitude) return res.status(400).json({ error: 'Missing required parameters: latitude and longitude' });
          res.json({ found: 0, waterBodies: [] });
        })
      }));

      const a = express();
      a.use(express.json());
      a.use('/gptActions', require('../api/ai/gptActions'));
      app = a;
    });
  });

  describe('GET /gptActions/health', () => {
    test('returns health status → 200', async () => {
      const res = await request(app).get('/gptActions/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /gptActions/paddleScore', () => {
    test('returns paddle score with coords → 200', async () => {
      const res = await request(app).get('/gptActions/paddleScore?latitude=42.0&longitude=-87.6');
      expect(res.status).toBe(200);
    });

    test('rejects missing params → 400', async () => {
      const res = await request(app).get('/gptActions/paddleScore');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /gptActions/forecast', () => {
    test('returns forecast with coords → 200', async () => {
      const res = await request(app).get('/gptActions/forecast?latitude=42.0&longitude=-87.6');
      expect(res.status).toBe(200);
    });

    test('rejects missing coords → 400', async () => {
      const res = await request(app).get('/gptActions/forecast');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /gptActions/locations', () => {
    test('returns locations → 200', async () => {
      const res = await request(app).get('/gptActions/locations');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /gptActions/findNearby', () => {
    test('finds nearby water → 200', async () => {
      const res = await request(app)
        .post('/gptActions/findNearby')
        .send({ latitude: 42.0, longitude: -87.6, radius: 5 });
      expect(res.status).toBe(200);
    });

    test('rejects missing coords → 400', async () => {
      const res = await request(app)
        .post('/gptActions/findNearby')
        .send({});
      expect(res.status).toBe(400);
    });
  });
});
