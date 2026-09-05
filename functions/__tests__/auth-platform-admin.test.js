require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const admin = require('firebase-admin');

const { requireAuth, requirePlatformAdmin } = require('../middleware/authMiddleware');

/**
 * Regression tests for the 5 Sep 2026 privilege-escalation fix.
 *
 * POST /kortex/tenants/provision is guarded by requireAuth alone and writes
 * role:'admin' into admin_users/{uid} for whoever calls it, and sign-up is open
 * Google auth. requireAdmin could not tell that tenant admin apart from a
 * platform admin, so the same role reached store orders (customer PII) and the
 * catalogue (reprice anything, then buy it).
 */
function app() {
  const a = express();
  a.use(express.json());
  a.get('/admin/thing', requireAuth, requirePlatformAdmin, (_req, res) => res.json({ success: true }));
  return a;
}

const get = (token) =>
  request(app()).get('/admin/thing').set('Authorization', `Bearer ${token}`);

describe('requirePlatformAdmin', () => {
  test('super-admin is allowed', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = { role: 'super-admin', email: 'owner@kaayko.com' };
    const res = await get('VALID_ADMIN_TOKEN');
    expect(res.status).toBe(200);
  });

  test('a self-provisioned tenant admin is REFUSED', async () => {
    // Exactly what api/kortex/provisioning.js writes for a self-serve signup.
    admin._mocks.docData['admin_users/admin-uid'] = {
      role: 'admin', scope: 'tenant', provisionedVia: 'self-serve', email: 'attacker@gmail.com'
    };
    const res = await get('VALID_ADMIN_TOKEN');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  test('a bare admin with no scope is REFUSED — fails closed', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'someone@gmail.com' };
    const res = await get('VALID_ADMIN_TOKEN');
    expect(res.status).toBe(403);
  });

  test('an admin explicitly marked platform-scoped is allowed', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', scope: 'platform', email: 'staff@kaayko.com' };
    const res = await get('VALID_ADMIN_TOKEN');
    expect(res.status).toBe(200);
  });

  test('a user with no admin_users doc is refused', async () => {
    const res = await get('VALID_USER_TOKEN');
    expect(res.status).toBe(403);
  });

  test('no token at all is 401', async () => {
    const res = await request(app()).get('/admin/thing');
    expect(res.status).toBe(401);
  });
});
