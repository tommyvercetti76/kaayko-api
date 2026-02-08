/**
 * Middleware Tests — authMiddleware, apiKeyMiddleware, kreatorAuthMiddleware, securityMiddleware
 * Covers: token validation, role checks, API key auth, bot protection, rate limiting, security headers
 */
require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const factories = require('./helpers/factories');

// ─── Helpers ──────────────────────────────────────────────────

function app(middleware, handler) {
  const a = express();
  a.use(express.json());
  if (Array.isArray(middleware)) middleware.forEach(m => a.use(m));
  else a.use(middleware);
  a.get('/test', handler || ((_r, res) => res.json({ ok: true })));
  a.post('/test', handler || ((req, res) => res.json({ ok: true, body: req.body })));
  return a;
}

function authApp(...mw) {
  const a = express();
  a.use(express.json());
  mw.forEach(m => a.use(m));
  a.get('/test', (req, res) => res.json({ ok: true, user: req.user }));
  return a;
}

// ─── requireAuth ──────────────────────────────────────────────

describe('requireAuth middleware', () => {
  let requireAuth;
  const admin = require('firebase-admin');

  beforeEach(() => {
    jest.isolateModules(() => {
      requireAuth = require('../middleware/authMiddleware').requireAuth;
    });
  });

  test('rejects request with no Authorization header → 401 AUTH_TOKEN_MISSING', async () => {
    const a = authApp(requireAuth);
    const res = await request(a).get('/test');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
    expect(res.body.success).toBe(false);
  });

  test('rejects request with Authorization but no Bearer prefix → 401 AUTH_TOKEN_MISSING', async () => {
    const a = authApp(requireAuth);
    const res = await request(a).get('/test').set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('rejects empty Bearer token → 401', async () => {
    const a = authApp(requireAuth);
    const res = await request(a).get('/test').set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });

  test('rejects expired token → 401 AUTH_TOKEN_EXPIRED', async () => {
    const a = authApp(requireAuth);
    const res = await request(a).get('/test').set('Authorization', `Bearer ${factories.tokens.expired}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_EXPIRED');
  });

  test('rejects invalid token → 401 AUTH_TOKEN_INVALID', async () => {
    const a = authApp(requireAuth);
    const res = await request(a).get('/test').set('Authorization', `Bearer ${factories.tokens.invalid}`);
    expect(res.status).toBe(401);
  });

  test('passes valid admin token → sets req.user with uid, email, role', async () => {
    // Mock admin_users doc for the admin user
    admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();

    const a = authApp(requireAuth);
    const res = await request(a).get('/test').set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.uid).toBe('admin-uid');
    expect(res.body.user.email).toBe('admin@kaayko.com');
  });

  test('passes valid user token → sets req.user with null role when no admin_users doc', async () => {
    const a = authApp(requireAuth);
    const res = await request(a).get('/test').set('Authorization', `Bearer ${factories.tokens.user}`);
    expect(res.status).toBe(200);
    expect(res.body.user.uid).toBe('user-uid');
    expect(res.body.user.role).toBeNull();
  });
});

// ─── requireAdmin ─────────────────────────────────────────────

describe('requireAdmin middleware', () => {
  let requireAuth, requireAdmin;
  const admin = require('firebase-admin');

  beforeEach(() => {
    jest.isolateModules(() => {
      ({ requireAuth, requireAdmin } = require('../middleware/authMiddleware'));
    });
  });

  test('allows X-Admin-Key matching ADMIN_PASSPHRASE → 200', async () => {
    const a = express();
    a.use(express.json());
    a.use(requireAdmin);
    a.get('/test', (req, res) => res.json({ ok: true, role: req.user.role }));
    const res = await request(a).get('/test').set('X-Admin-Key', factories.adminKey);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
  });

  test('rejects wrong X-Admin-Key when no user → 401 AUTH_REQUIRED', async () => {
    const a = express();
    a.use(express.json());
    a.use(requireAdmin);
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test').set('X-Admin-Key', 'wrong-key');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  test('rejects authenticated user with no role → 403 NOT_ADMIN_USER', async () => {
    // Simulate requireAuth already ran and set req.user without admin role
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.user = { uid: 'u1', email: 'u@t.com', role: null }; next(); });
    a.use(requireAdmin);
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_ADMIN_USER');
  });

  test('rejects viewer role → 403 INSUFFICIENT_PERMISSIONS', async () => {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.user = { uid: 'u1', email: 'u@t.com', role: 'viewer' }; next(); });
    a.use(requireAdmin);
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  test('allows admin role user through → 200', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
    const a = express();
    a.use(express.json());
    a.use(requireAuth);
    a.use(requireAdmin);
    a.get('/test', (req, res) => res.json({ ok: true, role: req.user.role }));
    const res = await request(a).get('/test').set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
  });

  test('allows super-admin role user through → 200', async () => {
    admin._mocks.docData['admin_users/super-admin-uid'] = factories.superAdminUser();
    const a = express();
    a.use(express.json());
    a.use(requireAuth);
    a.use(requireAdmin);
    a.get('/test', (req, res) => res.json({ ok: true, role: req.user.role }));
    const res = await request(a).get('/test').set('Authorization', `Bearer ${factories.tokens.superAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('super-admin');
  });
});

// ─── requireApiKey ────────────────────────────────────────────

describe('requireApiKey middleware', () => {
  const admin = require('firebase-admin');

  beforeEach(() => {
    // Mock the apiKeyService module
    jest.mock('../middleware/apiKeyService', () => ({
      hashApiKey: jest.fn((key) => 'hashed_' + key),
      checkApiKeyRateLimit: jest.fn(async () => true)
    }));
  });

  afterEach(() => {
    jest.unmock('../middleware/apiKeyService');
  });

  test('rejects missing API key → 401 API_KEY_MISSING', async () => {
    const { requireApiKey } = require('../middleware/apiKeyMiddleware');
    const a = express();
    a.use(express.json());
    a.use(requireApiKey());
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('API_KEY_MISSING');
  });

  test('rejects API key with wrong prefix → 401 API_KEY_INVALID_FORMAT', async () => {
    const { requireApiKey } = require('../middleware/apiKeyMiddleware');
    const a = express();
    a.use(express.json());
    a.use(requireApiKey());
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test').set('x-api-key', factories.apiKeys.wrongPrefix);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('API_KEY_INVALID_FORMAT');
  });

  test('rejects API key that is too short → 401 API_KEY_INVALID_FORMAT', async () => {
    const { requireApiKey } = require('../middleware/apiKeyMiddleware');
    const a = express();
    a.use(express.json());
    a.use(requireApiKey());
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test').set('x-api-key', factories.apiKeys.tooShort);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('API_KEY_INVALID_FORMAT');
  });

  test('rejects API key not found in Firestore → 401 API_KEY_INVALID', async () => {
    const { requireApiKey } = require('../middleware/apiKeyMiddleware');
    const a = express();
    a.use(express.json());
    a.use(requireApiKey());
    a.get('/test', (req, res) => res.json({ ok: true }));

    // collection.where().limit().get() returns empty
    admin._mocks.firestore.collection.mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn(async () => ({ empty: true, docs: [] }))
        })
      })
    });

    const res = await request(a).get('/test').set('x-api-key', factories.apiKeys.valid);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('API_KEY_INVALID');
  });

  test('rejects disabled API key → 403 API_KEY_DISABLED', async () => {
    const { requireApiKey } = require('../middleware/apiKeyMiddleware');
    const a = express();
    a.use(express.json());
    a.use(requireApiKey());
    a.get('/test', (req, res) => res.json({ ok: true }));

    admin._mocks.firestore.collection.mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn(async () => ({
            empty: false,
            docs: [{ id: 'key-1', data: () => ({ disabled: true, scopes: ['*'], tenantId: 'T1' }), ref: { update: jest.fn() } }]
          }))
        })
      })
    });

    const res = await request(a).get('/test').set('x-api-key', factories.apiKeys.valid);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('API_KEY_DISABLED');
  });

  test('rejects insufficient scopes → 403 INSUFFICIENT_API_KEY_SCOPES', async () => {
    const { requireApiKey } = require('../middleware/apiKeyMiddleware');
    const a = express();
    a.use(express.json());
    a.use(requireApiKey(['smartlinks:write']));
    a.get('/test', (req, res) => res.json({ ok: true }));

    admin._mocks.firestore.collection.mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn(async () => ({
            empty: false,
            docs: [{ id: 'key-1', data: () => ({ disabled: false, scopes: ['smartlinks:read'], tenantId: 'T1' }), ref: { update: jest.fn() } }]
          }))
        })
      })
    });

    const res = await request(a).get('/test').set('x-api-key', factories.apiKeys.valid);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_API_KEY_SCOPES');
  });

  test('rejects when rate limited → 429 RATE_LIMIT_EXCEEDED', async () => {
    // Override rate limit check to return false
    const apiKeyService = require('../middleware/apiKeyService');
    apiKeyService.checkApiKeyRateLimit.mockResolvedValue(false);

    const { requireApiKey } = require('../middleware/apiKeyMiddleware');
    const a = express();
    a.use(express.json());
    a.use(requireApiKey());
    a.get('/test', (req, res) => res.json({ ok: true }));

    admin._mocks.firestore.collection.mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn(async () => ({
            empty: false,
            docs: [{ id: 'key-1', data: () => ({ disabled: false, scopes: ['*'], tenantId: 'T1', rateLimitPerMinute: 60 }), ref: { update: jest.fn() } }]
          }))
        })
      })
    });

    const res = await request(a).get('/test').set('x-api-key', factories.apiKeys.valid);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  test('passes valid API key with wildcard scopes → 200 with req.apiClient', async () => {
    const apiKeyService = require('../middleware/apiKeyService');
    apiKeyService.checkApiKeyRateLimit.mockResolvedValue(true);

    const { requireApiKey } = require('../middleware/apiKeyMiddleware');
    const a = express();
    a.use(express.json());
    a.use(requireApiKey(['smartlinks:write']));
    a.get('/test', (req, res) => res.json({ ok: true, client: req.apiClient }));

    admin._mocks.firestore.collection.mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn(async () => ({
            empty: false,
            docs: [{
              id: 'key-1',
              data: () => ({ disabled: false, scopes: ['*'], tenantId: 'T1', tenantName: 'TestTenant', name: 'TestKey' }),
              ref: { update: jest.fn(async () => {}) }
            }]
          }))
        })
      })
    });

    const res = await request(a).get('/test').set('x-api-key', factories.apiKeys.valid);
    expect(res.status).toBe(200);
    expect(res.body.client.tenantId).toBe('T1');
    expect(res.body.client.tenantName).toBe('TestTenant');
  });
});

// ─── requireKreatorAuth ───────────────────────────────────────

describe('requireKreatorAuth middleware', () => {
  const admin = require('firebase-admin');

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../services/kreatorService', () => ({
      verifySessionToken: jest.fn((token) => {
        if (token === 'VALID_KREATOR_TOKEN') return { uid: 'kreator-uid-1', role: 'kreator', iat: Date.now() / 1000 };
        if (token === 'EXPIRED_KREATOR_TOKEN') return null;
        return null;
      })
    }));
  });

  afterEach(() => {
    jest.unmock('../services/kreatorService');
  });

  test('rejects missing token → 401 AUTH_TOKEN_MISSING', async () => {
    const { requireKreatorAuth } = require('../middleware/kreatorAuthMiddleware');
    const a = express();
    a.use(express.json());
    a.use(requireKreatorAuth);
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('rejects invalid kreator token → 401 AUTH_TOKEN_INVALID', async () => {
    const { requireKreatorAuth } = require('../middleware/kreatorAuthMiddleware');
    const a = express();
    a.use(express.json());
    a.use(requireKreatorAuth);
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test').set('Authorization', 'Bearer bogus-token');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_INVALID');
  });

  test('rejects kreator not in Firestore → 403 NOT_A_KREATOR', async () => {
    // kreators/kreator-uid-1 does NOT exist in mock
    const { requireKreatorAuth } = require('../middleware/kreatorAuthMiddleware');
    const a = express();
    a.use(express.json());
    a.use(requireKreatorAuth);
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test').set('Authorization', 'Bearer VALID_KREATOR_TOKEN');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_A_KREATOR');
  });

  test('rejects soft-deleted kreator → 403 KREATOR_DELETED', async () => {
    const freshAdmin = require('firebase-admin');
    freshAdmin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator({ deletedAt: new Date() });
    const { requireKreatorAuth } = require('../middleware/kreatorAuthMiddleware');
    const a = express();
    a.use(express.json());
    a.use(requireKreatorAuth);
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test').set('Authorization', 'Bearer VALID_KREATOR_TOKEN');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('KREATOR_DELETED');
  });

  test('passes valid kreator → 200 with req.kreator', async () => {
    const freshAdmin = require('firebase-admin');
    freshAdmin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator();
    const { requireKreatorAuth } = require('../middleware/kreatorAuthMiddleware');
    const a = express();
    a.use(express.json());
    a.use(requireKreatorAuth);
    a.get('/test', (req, res) => res.json({ ok: true, kreator: req.kreator }));
    const res = await request(a).get('/test').set('Authorization', 'Bearer VALID_KREATOR_TOKEN');
    expect(res.status).toBe(200);
    expect(res.body.kreator.uid).toBe('kreator-uid-1');
  });
});

// ─── requireActiveKreator ─────────────────────────────────────

describe('requireActiveKreator middleware', () => {
  test('rejects missing kreator context → 401 AUTH_REQUIRED', async () => {
    const { requireActiveKreator } = require('../middleware/kreatorAuthMiddleware');
    const a = express();
    a.use(express.json());
    a.use(requireActiveKreator);
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  test.each([
    ['pending_password', 'KREATOR_PENDING_PASSWORD'],
    ['suspended', 'KREATOR_SUSPENDED'],
    ['deactivated', 'KREATOR_DEACTIVATED'],
    ['unknown_status', 'INVALID_KREATOR_STATUS'],
  ])('rejects kreator with status "%s" → 403 %s', async (status, expectedCode) => {
    const { requireActiveKreator } = require('../middleware/kreatorAuthMiddleware');
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.kreator = { status }; next(); });
    a.use(requireActiveKreator);
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(expectedCode);
  });

  test('allows active kreator through → 200', async () => {
    const { requireActiveKreator } = require('../middleware/kreatorAuthMiddleware');
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.kreator = { status: 'active' }; next(); });
    a.use(requireActiveKreator);
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test');
    expect(res.status).toBe(200);
  });
});

// ─── botProtection ────────────────────────────────────────────

describe('botProtection middleware', () => {
  let botProtection;

  beforeEach(() => {
    jest.isolateModules(() => {
      jest.mock('../middleware/securityUtils', () => ({
        RATE_LIMITS: { api: { window: 60000, max: 100 } },
        isBot: jest.fn((ua) => /bot|crawler|spider|scraper/i.test(ua)),
        getClientIp: jest.fn(() => '127.0.0.1')
      }));
      botProtection = require('../middleware/securityMiddleware').botProtection;
    });
  });

  test('blocks generic bots → 403', async () => {
    const a = express();
    a.use(botProtection);
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test').set('User-Agent', 'evil-bot/1.0');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Access denied');
  });

  test('allows Googlebot through', async () => {
    // Need to also ensure isBot returns true for googlebot, but botProtection
    // allows search engine bots. Since our mock isBot returns true for anything
    // with 'bot' in it, and the code checks for googlebot specifically, this works.
    jest.isolateModules(() => {
      // Use the real securityMiddleware logic
      jest.mock('../middleware/securityUtils', () => ({
        RATE_LIMITS: { api: { window: 60000, max: 100 } },
        isBot: jest.fn((ua) => /bot|crawler|spider|scraper/i.test(ua)),
        getClientIp: jest.fn(() => '127.0.0.1')
      }));
      const { botProtection: bp } = require('../middleware/securityMiddleware');
      const a = express();
      a.use(bp);
      a.get('/test', (req, res) => res.json({ ok: true }));
      return request(a).get('/test').set('User-Agent', 'Googlebot/2.1').then(res => {
        expect(res.status).toBe(200);
      });
    });
  });

  test('blocks requests with missing or very short user-agent → 403', async () => {
    const a = express();
    a.use(botProtection);
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test').set('User-Agent', 'x');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Access denied');
  });

  test('allows normal browser user-agent → 200', async () => {
    const a = express();
    a.use(botProtection);
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test').set('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(res.status).toBe(200);
  });
});

// ─── secureHeaders ────────────────────────────────────────────

describe('secureHeaders middleware', () => {
  let secureHeaders;

  beforeEach(() => {
    jest.isolateModules(() => {
      jest.mock('../middleware/securityUtils', () => ({
        RATE_LIMITS: {},
        isBot: jest.fn(() => false),
        getClientIp: jest.fn(() => '127.0.0.1')
      }));
      secureHeaders = require('../middleware/securityMiddleware').secureHeaders;
    });
  });

  test('sets all security headers', async () => {
    const a = express();
    a.use(secureHeaders);
    a.get('/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/test');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-xss-protection']).toBe('1; mode=block');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  test('sets CORS for admin paths from allowed origin', async () => {
    const a = express();
    a.use(secureHeaders);
    a.get('/admin/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/admin/test').set('Origin', 'https://kaayko.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://kaayko.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  test('does not set CORS for admin paths from unknown origin', async () => {
    const a = express();
    a.use(secureHeaders);
    a.get('/admin/test', (req, res) => res.json({ ok: true }));
    const res = await request(a).get('/admin/test').set('Origin', 'https://evil.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
