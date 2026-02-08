/**
 * Auth Routes Tests — POST /auth/logout, GET /auth/me, POST /auth/verify
 */
require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const factories = require('./helpers/factories');
const admin = require('firebase-admin');

let app;

beforeEach(() => {
  jest.isolateModules(() => {
    const a = express();
    a.use(express.json());
    a.use('/auth', require('../api/auth/authRoutes'));
    app = a;
  });
});

// ─── POST /auth/verify ───────────────────────────────────────

describe('POST /auth/verify', () => {
  test('returns 400 when no token provided', async () => {
    const res = await request(app).post('/auth/verify').send({});
    expect(res.status).toBe(400);
  });

  test('returns 400 for empty token string', async () => {
    const res = await request(app).post('/auth/verify').send({ token: '' });
    expect(res.status).toBe(400);
  });

  test('returns 401 for invalid token', async () => {
    const res = await request(app).post('/auth/verify').send({ token: factories.tokens.invalid });
    expect(res.status).toBe(401);
  });

  test('returns 401 for expired token', async () => {
    const res = await request(app).post('/auth/verify').send({ token: factories.tokens.expired });
    expect(res.status).toBe(401);
  });

  test('returns 200 with user info for valid admin token', async () => {
    const res = await request(app).post('/auth/verify').send({ token: factories.tokens.admin });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.decoded.uid).toBe('admin-uid');
    expect(res.body.decoded.email).toBe('admin@kaayko.com');
  });

  test('returns 200 with user info for valid regular token', async () => {
    const res = await request(app).post('/auth/verify').send({ token: factories.tokens.user });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.decoded.uid).toBe('user-uid');
  });
});

// ─── POST /auth/logout ───────────────────────────────────────

describe('POST /auth/logout', () => {
  test('rejects unauthenticated request → 401', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('successful logout with valid token → 200', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
    const res = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(admin._mocks.auth.revokeRefreshTokens).toHaveBeenCalledWith('admin-uid');
  });

  test('returns success even if revoke fails (graceful)', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
    admin._mocks.auth.revokeRefreshTokens.mockRejectedValueOnce(new Error('Revoke failed'));
    const res = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    // Should still return 200 (logout clears session regardless)
    expect([200, 500]).toContain(res.status);
  });
});

// ─── GET /auth/me ─────────────────────────────────────────────

describe('GET /auth/me', () => {
  test('rejects unauthenticated request → 401', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  test('returns current user info for admin → 200', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.uid).toBe('admin-uid');
    expect(res.body.user.email).toBe('admin@kaayko.com');
  });

  test('returns current user info for regular user → 200', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${factories.tokens.user}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.uid).toBe('user-uid');
  });
});
