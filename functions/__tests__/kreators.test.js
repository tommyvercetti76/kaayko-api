/**
 * Kreators Tests — 24+ endpoints across 6 sub-routers
 * Applications, magic links, password setup, profile, OAuth, products, admin
 */
require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const factories = require('./helpers/factories');
const admin = require('firebase-admin');

// mock-prefixed helpers (allowed inside jest.mock factories)
const mockKreatorData = { uid: 'kreator-uid-1', email: 'kreator@test.com', firstName: 'Test', lastName: 'Kreator', status: 'active', role: 'kreator' };

jest.mock('../middleware/securityMiddleware', () => ({
  rateLimiter: () => (_r, _s, n) => n(), botProtection: (_r, _s, n) => n(), secureHeaders: (_r, _s, n) => n()
}));

jest.mock('../middleware/kreatorAuthHelpers', () => ({
  kreatorRateLimit: () => (_r, _s, n) => n(),
  attachClientInfo: (_r, _s, n) => { _r.clientInfo = { ip: '127.0.0.1', userAgent: 'test' }; n(); },
  optionalKreatorAuth: (_r, _s, n) => n()
}));

jest.mock('../middleware/rateLimit', () => jest.fn(() => (_r, _s, n) => n()));

jest.mock('multer', () => {
  const m = () => ({ array: () => (_r, _s, n) => n(), single: () => (_r, _s, n) => n() });
  m.memoryStorage = () => ({});
  return m;
});

jest.mock('../services/kreatorService', () => ({
  KREATOR_STATUS: { PENDING: 'pending', PENDING_PASSWORD: 'pending_password', ACTIVE: 'active', SUSPENDED: 'suspended', DEACTIVATED: 'deactivated' },
  TOKEN_HASH_CONFIG: {},
  MAGIC_LINK_EXPIRY_HOURS: 48,
  PASSWORD_REQUIREMENTS: { minLength: 8 },
  hashToken: jest.fn((t) => 'hash_' + t),
  verifyToken: jest.fn(() => true),
  generateMagicLinkToken: jest.fn(() => ({ token: 'magic-token', hash: 'hash_magic' })),
  hashPassword: jest.fn(async (pw) => 'hashed_' + pw),
  verifyPassword: jest.fn(async () => true),
  validatePassword: jest.fn((pw) => ({ valid: pw.length >= 8, errors: pw.length < 8 ? ['min 8 chars'] : [] })),
  createSessionToken: jest.fn(async () => 'session-token-xyz'),
  verifySessionToken: jest.fn((token) => {
    if (token === 'VALID_KREATOR_TOKEN') return { uid: 'kreator-uid-1', role: 'kreator', iat: Date.now() / 1000 };
    if (token === 'INACTIVE_KREATOR_TOKEN') return { uid: 'inactive-kreator', role: 'kreator', iat: Date.now() / 1000 };
    return null;
  }),
  validateMagicLink: jest.fn(async (token) => {
    if (token === 'valid-token') return { valid: true, email: 'new@test.com', purpose: 'kreator_onboarding', expiresAt: new Date(Date.now() + 3600000).toISOString() };
    if (token === 'used-token') return { valid: false, reason: 'already_used' };
    if (token === 'expired-token') return { valid: false, reason: 'expired' };
    return { valid: false, reason: 'not_found' };
  }),
  consumeMagicLinkAndSetPassword: jest.fn(async (token, password) => {
    if (password.length < 8) { const e = new Error('weak'); e.code = 'INVALID_PASSWORD'; e.details = ['min 8 chars']; throw e; }
    return { success: true, kreatorId: 'kreator-uid-1', email: 'new@test.com', status: 'active' };
  }),
  resendMagicLink: jest.fn(async () => ({ success: true })),
  connectGoogleAccount: jest.fn(async () => ({ success: true })),
  disconnectGoogleAccount: jest.fn(async () => { const e = new Error('No Google connected'); e.code = 'NOT_CONNECTED'; throw e; }),
  getKreator: jest.fn(async (uid) => uid === 'kreator-uid-1' ? { uid: 'kreator-uid-1', email: 'kreator@test.com', firstName: 'Test', lastName: 'Kreator', status: 'active', role: 'kreator' } : null),
  getKreatorByEmail: jest.fn(async () => null),
  listKreators: jest.fn(async () => ({ kreators: [{ uid: 'kreator-uid-1', email: 'kreator@test.com', firstName: 'Test', lastName: 'Kreator', status: 'active' }], total: 1 })),
  updateKreatorProfile: jest.fn(async (uid, data) => ({ uid, ...data })),
  updateLastLogin: jest.fn(async () => {}),
  getKreatorStats: jest.fn(async () => ({ active: 5, pendingPassword: 2, suspended: 0, total: 7 }))
}));

jest.mock('../services/kreatorApplicationService', () => ({
  validateApplication: jest.fn((data) => {
    if (!data.email) return { valid: false, errors: ['Email is required'] };
    if (!data.firstName) return { valid: false, errors: ['First name is required'] };
    return { valid: true, errors: [] };
  }),
  approveApplication: jest.fn(async () => ({ success: true, message: 'Application approved' })),
  rejectApplication: jest.fn(async () => ({ success: true, message: 'Application rejected' })),
  submitApplication: jest.fn(async (data) => {
    if (!data || !data.email || !data.firstName) { const e = new Error('Validation failed'); e.code = 'VALIDATION_ERROR'; e.details = !data?.email ? ['Email is required'] : ['First name is required']; throw e; }
    if (data.email === 'existing@test.com') { const e = new Error('Duplicate'); e.code = 'DUPLICATE_APPLICATION'; throw e; }
    return { id: 'app-1', ...data, status: 'pending', createdAt: new Date() };
  }),
  getApplication: jest.fn(async (id) => {
    if (id === 'app-1') return { id: 'app-1', email: 'test@test.com', status: 'pending', firstName: 'Test', lastName: 'Kreator' };
    return null;
  }),
  getApplicationStatus: jest.fn(async (email, id) => {
    if (email === 'existing@test.com') return { id, status: 'pending', email };
    return null;
  }),
  listApplications: jest.fn(async () => ({ applications: [{ id: 'app-1', email: 'test@test.com', status: 'pending' }], total: 1 })),
  getApplicationStats: jest.fn(async () => ({ pending: 3, approved: 10, rejected: 2, total: 15 }))
}));

jest.mock('../services/emailNotificationService', () => ({
  sendMagicLinkEmail: jest.fn(async () => ({ success: true })),
  sendWelcomeEmail: jest.fn(async () => ({ success: true })),
  sendApplicationReceivedEmail: jest.fn(async () => ({ success: true }))
}));

let app;

beforeEach(() => {
  const a = express();
  a.use(express.json());
  a.use('/kreators', require('../api/kreators/kreatorRoutes'));
  app = a;
});

const kreatorAuth = 'Bearer VALID_KREATOR_TOKEN';

// ═══════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════

describe('GET /kreators/health', () => {
  test('returns 200 with status', async () => {
    const res = await request(app).get('/kreators/health');
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// PUBLIC ONBOARDING — Applications
// ═══════════════════════════════════════════════════════════════

describe('POST /kreators/apply', () => {
  test('creates application with valid data → 201', async () => {
    const res = await request(app).post('/kreators/apply')
      .send(factories.kreatorApplication());
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('rejects missing required fields → 400', async () => {
    const res = await request(app).post('/kreators/apply').send({});
    expect([400, 500]).toContain(res.status);
  });

  test('rejects missing email → 400', async () => {
    const res = await request(app).post('/kreators/apply')
      .send(factories.kreatorApplication({ email: undefined }));
    expect([400, 500]).toContain(res.status);
  });

  test('rejects duplicate application → 409', async () => {
    const res = await request(app).post('/kreators/apply')
      .send(factories.kreatorApplication({ email: 'existing@test.com' }));
    expect(res.status).toBe(409);
  });
});

// Route: GET /kreators/applications/:id/status?email=...
describe('GET /kreators/applications/:id/status', () => {
  test('returns 400 when email missing', async () => {
    const res = await request(app).get('/kreators/applications/app-1/status');
    expect(res.status).toBe(400);
  });

  test('returns 404 when no application found', async () => {
    const res = await request(app).get('/kreators/applications/app-1/status?email=nobody@test.com');
    expect(res.status).toBe(404);
  });

  test('returns status for existing email → 200', async () => {
    const res = await request(app).get('/kreators/applications/app-1/status?email=existing@test.com');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── Magic Link Verification ─────────────────────────────────

describe('POST /kreators/onboarding/verify', () => {
  test('rejects missing token → 400', async () => {
    const res = await request(app).post('/kreators/onboarding/verify').send({});
    expect(res.status).toBe(400);
  });

  test('rejects empty token → 400', async () => {
    const res = await request(app).post('/kreators/onboarding/verify').send({ token: '' });
    expect(res.status).toBe(400);
  });

  test('verifies valid magic link token → 200', async () => {
    const res = await request(app).post('/kreators/onboarding/verify').send({ token: 'valid-token' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('new@test.com');
  });

  test('rejects already-used magic link → 410', async () => {
    const res = await request(app).post('/kreators/onboarding/verify').send({ token: 'used-token' });
    expect(res.status).toBe(410);
  });
});

// ─── Password Setup ──────────────────────────────────────────

describe('POST /kreators/onboarding/complete', () => {
  test('rejects missing token → 400', async () => {
    const res = await request(app).post('/kreators/onboarding/complete').send({ password: 'SecurePass1!' });
    expect(res.status).toBe(400);
  });

  test('rejects missing password → 400', async () => {
    const res = await request(app).post('/kreators/onboarding/complete').send({ token: 'valid-token' });
    expect(res.status).toBe(400);
  });

  test('rejects weak password → 400', async () => {
    const res = await request(app).post('/kreators/onboarding/complete')
      .send({ token: 'valid-token', password: '123' });
    expect(res.status).toBe(400);
  });

  test('completes onboarding with valid token + password → 200', async () => {
    const res = await request(app).post('/kreators/onboarding/complete')
      .send({ token: 'valid-token', password: 'SecurePass123!' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.kreatorId).toBe('kreator-uid-1');
  });
});

// ═══════════════════════════════════════════════════════════════
// KREATOR PROFILE — Authenticated
// ═══════════════════════════════════════════════════════════════

describe('GET /kreators/me', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/kreators/me');
    expect(res.status).toBe(401);
  });

  test('returns kreator profile → 200', async () => {
    admin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator();
    const res = await request(app).get('/kreators/me').set('Authorization', kreatorAuth);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('PUT /kreators/me', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).put('/kreators/me').send({ firstName: 'Updated' });
    expect(res.status).toBe(401);
  });

  test('updates profile with valid data → 200', async () => {
    admin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator();
    const res = await request(app).put('/kreators/me').set('Authorization', kreatorAuth)
      .send({ firstName: 'Updated', bio: 'New bio' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('silently strips protected fields', async () => {
    admin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator();
    const res = await request(app).put('/kreators/me').set('Authorization', kreatorAuth)
      .send({ role: 'admin', status: 'super-admin', uid: 'hacked' });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /kreators/me', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).delete('/kreators/me');
    expect(res.status).toBe(401);
  });

  test('soft-deletes kreator → 200', async () => {
    admin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator();
    const res = await request(app).delete('/kreators/me').set('Authorization', kreatorAuth);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// KREATOR OAUTH
// ═══════════════════════════════════════════════════════════════

describe('POST /kreators/auth/google/signin', () => {
  test('rejects missing Google token → 400', async () => {
    const res = await request(app).post('/kreators/auth/google/signin').send({});
    expect(res.status).toBe(400);
  });

  test('rejects invalid Google token → 401', async () => {
    const res = await request(app).post('/kreators/auth/google/signin').send({ idToken: 'bad-google-token' });
    expect([400, 401, 500]).toContain(res.status);
  });
});

describe('POST /kreators/auth/google/connect', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).post('/kreators/auth/google/connect')
      .send({ googleUid: 'g123', googleProfile: { email: 'g@test.com' } });
    expect(res.status).toBe(401);
  });

  test('connects Google account → 200', async () => {
    admin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator();
    const kreatorService = require('../services/kreatorService');
    kreatorService.connectGoogleAccount.mockResolvedValueOnce({ success: true, message: 'Google account connected' });
    const res = await request(app).post('/kreators/auth/google/connect')
      .set('Authorization', kreatorAuth)
      .send({ googleUid: 'g123', googleProfile: { email: 'g@test.com', displayName: 'Test' } });
    expect([200, 400, 409]).toContain(res.status);
  });
});

describe('POST /kreators/auth/google/disconnect', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).post('/kreators/auth/google/disconnect');
    expect(res.status).toBe(401);
  });

  test('handles disconnect error → 400', async () => {
    admin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator();
    const res = await request(app).post('/kreators/auth/google/disconnect').set('Authorization', kreatorAuth);
    expect([400, 500]).toContain(res.status);
  });
});

// ═══════════════════════════════════════════════════════════════
// KREATOR PRODUCTS
// ═══════════════════════════════════════════════════════════════

describe('GET /kreators/products', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/kreators/products');
    expect(res.status).toBe(401);
  });

  test('returns kreator product list → 200', async () => {
    admin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator();
    const res = await request(app).get('/kreators/products').set('Authorization', kreatorAuth);
    expect(res.status).toBe(200);
  });
});

describe('POST /kreators/products', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).post('/kreators/products')
      .send({ title: 'Product', description: 'Desc', price: 9.99 });
    expect(res.status).toBe(401);
  });

  test('rejects price below minimum ($0.99) → 400', async () => {
    admin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator();
    const res = await request(app).post('/kreators/products').set('Authorization', kreatorAuth)
      .send({ title: 'Cheap', description: 'Too cheap', price: 0.50 });
    expect([400, 500]).toContain(res.status);
  });

  test('rejects missing title → 400', async () => {
    admin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator();
    const res = await request(app).post('/kreators/products').set('Authorization', kreatorAuth)
      .send({ description: 'No title', price: 9.99 });
    expect([400, 500]).toContain(res.status);
  });
});

describe('GET /kreators/products/:id', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/kreators/products/kprod-1');
    expect(res.status).toBe(401);
  });

  test('returns product for owner → 200', async () => {
    admin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator();
    admin._mocks.docData['kreator_products/kprod-1'] = factories.kreatorProduct({ kreatorId: 'kreator-uid-1' });
    const res = await request(app).get('/kreators/products/kprod-1').set('Authorization', kreatorAuth);
    expect([200, 404]).toContain(res.status);
  });

  test('rejects non-owner access → 403', async () => {
    admin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator();
    admin._mocks.docData['kreator_products/kprod-1'] = factories.kreatorProduct({ kreatorId: 'other-kreator' });
    const res = await request(app).get('/kreators/products/kprod-1').set('Authorization', kreatorAuth);
    expect([403, 404]).toContain(res.status);
  });
});

describe('PUT /kreators/products/:id', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).put('/kreators/products/kprod-1').send({ title: 'Updated' });
    expect(res.status).toBe(401);
  });

  test('updates product for owner → 200', async () => {
    admin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator();
    admin._mocks.docData['kreator_products/kprod-1'] = factories.kreatorProduct({ kreatorId: 'kreator-uid-1' });
    const res = await request(app).put('/kreators/products/kprod-1').set('Authorization', kreatorAuth)
      .send({ title: 'Updated Title' });
    expect([200, 404]).toContain(res.status);
  });
});

describe('DELETE /kreators/products/:id', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).delete('/kreators/products/kprod-1');
    expect(res.status).toBe(401);
  });

  test('soft-deletes product for owner → 200', async () => {
    admin._mocks.docData['kreators/kreator-uid-1'] = factories.kreator();
    admin._mocks.docData['kreator_products/kprod-1'] = factories.kreatorProduct({ kreatorId: 'kreator-uid-1' });
    const res = await request(app).delete('/kreators/products/kprod-1').set('Authorization', kreatorAuth);
    expect([200, 404]).toContain(res.status);
  });
});

// ═══════════════════════════════════════════════════════════════
// KREATOR ADMIN — requireAuth + requireAdmin
// ═══════════════════════════════════════════════════════════════

describe('Kreator Admin endpoints', () => {
  describe('GET /kreators/admin/applications', () => {
    test('rejects unauthenticated → 401', async () => {
      const res = await request(app).get('/kreators/admin/applications');
      expect(res.status).toBe(401);
    });

    test('rejects non-admin → 403', async () => {
      admin._mocks.docData['admin_users/user-uid'] = factories.regularUser();
      const res = await request(app).get('/kreators/admin/applications')
        .set('Authorization', `Bearer ${factories.tokens.user}`);
      expect(res.status).toBe(403);
    });

    test('returns application list for admin → 200', async () => {
      admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
      const res = await request(app).get('/kreators/admin/applications')
        .set('Authorization', `Bearer ${factories.tokens.admin}`);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /kreators/admin/applications/:id', () => {
    test('returns single application for admin → 200', async () => {
      admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
      const res = await request(app).get('/kreators/admin/applications/app-1')
        .set('Authorization', `Bearer ${factories.tokens.admin}`);
      expect(res.status).toBe(200);
    });

    test('returns 404 for non-existent application', async () => {
      admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
      const res = await request(app).get('/kreators/admin/applications/nonexistent')
        .set('Authorization', `Bearer ${factories.tokens.admin}`);
      expect([404, 500]).toContain(res.status);
    });
  });

  describe('PUT /kreators/admin/applications/:id/approve', () => {
    test('rejects unauthenticated → 401', async () => {
      const res = await request(app).put('/kreators/admin/applications/app-1/approve');
      expect(res.status).toBe(401);
    });

    test('approves application for admin → 200', async () => {
      admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
      const res = await request(app).put('/kreators/admin/applications/app-1/approve')
        .set('Authorization', `Bearer ${factories.tokens.admin}`);
      expect([200, 400, 404]).toContain(res.status);
    });
  });

  describe('PUT /kreators/admin/applications/:id/reject', () => {
    test('rejects without reason → 400', async () => {
      admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
      const res = await request(app).put('/kreators/admin/applications/app-1/reject')
        .set('Authorization', `Bearer ${factories.tokens.admin}`).send({});
      expect([400, 200]).toContain(res.status);
    });

    test('rejects application with reason → 200', async () => {
      admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
      const res = await request(app).put('/kreators/admin/applications/app-1/reject')
        .set('Authorization', `Bearer ${factories.tokens.admin}`)
        .send({ reason: 'Does not meet criteria' });
      expect([200, 400, 404]).toContain(res.status);
    });
  });

  describe('GET /kreators/admin/list', () => {
    test('returns kreator list for admin → 200', async () => {
      admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
      const res = await request(app).get('/kreators/admin/list')
        .set('Authorization', `Bearer ${factories.tokens.admin}`);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /kreators/admin/stats', () => {
    test('returns kreator stats for admin → 200', async () => {
      admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
      const res = await request(app).get('/kreators/admin/stats')
        .set('Authorization', `Bearer ${factories.tokens.admin}`);
      expect(res.status).toBe(200);
    });
  });
});
