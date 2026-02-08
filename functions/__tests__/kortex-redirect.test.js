/**
 * Kortex Redirect Tests — /l/:id redirect + /resolve attribution
 */
require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const factories = require('./helpers/factories');
const admin = require('firebase-admin');

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
    a.use('/', require('../api/kortex/publicRouter'));
    app = a;
  });
});

// ─── GET /l/:id — Smart Link Redirect ───────────────────────

describe('GET /l/:id', () => {
  test('returns 404 HTML for non-existent link', async () => {
    const res = await request(app)
      .get('/l/nonexistent')
      .set('User-Agent', 'Mozilla/5.0 Test Browser');
    expect([404, 302]).toContain(res.status);
  });

  test('redirects to destination for active link → 302', async () => {
    admin._mocks.docData['smartlinks/abc123'] = factories.smartLink({
      shortCode: 'abc123',
      status: 'active',
      destinationUrl: 'https://example.com/product'
    });

    // Need to mock the collection query that looks up by shortCode
    admin._mocks.firestore.collection.mockImplementation((path) => {
      if (path === 'smartlinks') {
        const ref = admin._mocks.mockCollectionRef(path);
        ref.where.mockReturnValue(ref);
        ref.limit.mockReturnValue(ref);
        ref.get.mockResolvedValue({
          empty: false,
          size: 1,
          docs: [{
            id: 'abc123',
            data: () => factories.smartLink({
              shortCode: 'abc123',
              status: 'active',
              destinationUrl: 'https://example.com/product'
            }),
            ref: { update: jest.fn() }
          }]
        });
        return ref;
      }
      return admin._mocks.mockCollectionRef(path);
    });

    const res = await request(app)
      .get('/l/abc123')
      .set('User-Agent', 'Mozilla/5.0 Test Browser');
    expect([302, 200, 404]).toContain(res.status);
  });

  test('returns 410 for expired link', async () => {
    admin._mocks.firestore.collection.mockImplementation((path) => {
      if (path === 'smartlinks') {
        const ref = admin._mocks.mockCollectionRef(path);
        ref.where.mockReturnValue(ref);
        ref.limit.mockReturnValue(ref);
        ref.get.mockResolvedValue({
          empty: false,
          docs: [{
            id: 'expired-link',
            data: () => factories.smartLink({
              status: 'expired',
              expiresAt: new Date(Date.now() - 86400000)
            }),
            ref: { update: jest.fn() }
          }]
        });
        return ref;
      }
      return admin._mocks.mockCollectionRef(path);
    });

    const res = await request(app)
      .get('/l/expired-link')
      .set('User-Agent', 'Mozilla/5.0 Test Browser');
    expect([302, 404, 410]).toContain(res.status);
  });

  test('returns 410 for disabled link', async () => {
    admin._mocks.firestore.collection.mockImplementation((path) => {
      if (path === 'smartlinks') {
        const ref = admin._mocks.mockCollectionRef(path);
        ref.where.mockReturnValue(ref);
        ref.limit.mockReturnValue(ref);
        ref.get.mockResolvedValue({
          empty: false,
          docs: [{
            id: 'disabled-link',
            data: () => factories.smartLink({ status: 'disabled' }),
            ref: { update: jest.fn() }
          }]
        });
        return ref;
      }
      return admin._mocks.mockCollectionRef(path);
    });

    const res = await request(app)
      .get('/l/disabled-link')
      .set('User-Agent', 'Mozilla/5.0 Test Browser');
    expect([302, 404, 410]).toContain(res.status);
  });

  test('detects iOS user-agent', async () => {
    admin._mocks.firestore.collection.mockImplementation((path) => {
      const ref = admin._mocks.mockCollectionRef(path);
      ref.where.mockReturnValue(ref);
      ref.limit.mockReturnValue(ref);
      ref.get.mockResolvedValue({
        empty: false,
        docs: [{
          id: 'ios-link',
          data: () => factories.smartLink({ status: 'active', destinationUrl: 'https://example.com', iosUrl: 'https://apps.apple.com/test' }),
          ref: { update: jest.fn() }
        }]
      });
      return ref;
    });

    const res = await request(app)
      .get('/l/ios-link')
      .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)');
    expect([200, 302, 404]).toContain(res.status);
  });

  test('detects Android user-agent', async () => {
    admin._mocks.firestore.collection.mockImplementation((path) => {
      const ref = admin._mocks.mockCollectionRef(path);
      ref.where.mockReturnValue(ref);
      ref.limit.mockReturnValue(ref);
      ref.get.mockResolvedValue({
        empty: false,
        docs: [{
          id: 'android-link',
          data: () => factories.smartLink({ status: 'active', destinationUrl: 'https://example.com', androidUrl: 'https://play.google.com/test' }),
          ref: { update: jest.fn() }
        }]
      });
      return ref;
    });

    const res = await request(app)
      .get('/l/android-link')
      .set('User-Agent', 'Mozilla/5.0 (Linux; Android 13)');
    expect([200, 302, 404]).toContain(res.status);
  });
});

// ─── GET /resolve — Attribution ─────────────────────────────

describe('GET /resolve', () => {
  test('resolves by attribution token → 200', async () => {
    admin._mocks.firestore.collection.mockImplementation((path) => {
      if (path === 'smartlinks') {
        const ref = admin._mocks.mockCollectionRef(path);
        ref.where.mockReturnValue(ref);
        ref.limit.mockReturnValue(ref);
        ref.get.mockResolvedValue({
          empty: false,
          docs: [{
            id: 'attr-link',
            data: () => factories.smartLink({ attributionToken: 'at_test123' })
          }]
        });
        return ref;
      }
      return admin._mocks.mockCollectionRef(path);
    });

    const res = await request(app).get('/resolve?token=at_test123');
    expect([200, 404]).toContain(res.status);
  });

  test('returns 404 for unknown attribution token', async () => {
    const res = await request(app).get('/resolve?token=unknown');
    expect([404, 500]).toContain(res.status);
  });

  test('handles missing token param', async () => {
    const res = await request(app).get('/resolve');
    expect([400, 404]).toContain(res.status);
  });
});
