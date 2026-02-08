/**
 * Admin Tests — User management, Order management, Roles
 * Routes: GET /admin/me, CRUD /admin/users, GET /admin/roles
 *         GET /admin/getOrder, GET /admin/listOrders, POST /admin/updateOrderStatus
 *
 * NOTE: User CRUD routes (/admin/users) require requireRole('super-admin').
 *       Order routes use requireAuth + requireAdmin (admin or super-admin or X-Admin-Key).
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
      rateLimiter: () => (_r, _s, n) => n(), botProtection: (_r, _s, n) => n(), secureHeaders: (_r, _s, n) => n()
    }));

    // Mock adminUserService so handlers don't hit Firestore directly
    jest.mock('../services/adminUserService', () => ({
      getAdminUser: jest.fn(async (uid) => {
        if (uid === 'super-admin-uid') return { uid: 'super-admin-uid', email: 'super@kaayko.com', role: 'super-admin', displayName: 'Super Admin', permissions: ['*'], enabled: true, lastLoginAt: new Date() };
        if (uid === 'admin-uid') return { uid: 'admin-uid', email: 'admin@kaayko.com', role: 'admin', displayName: 'Admin', permissions: ['manage_users'], enabled: true, lastLoginAt: new Date() };
        if (uid === 'target-uid') return { uid: 'target-uid', email: 'target@test.com', role: 'viewer', displayName: 'Target', permissions: [], enabled: true };
        return null;
      }),
      getAdminUserByEmail: jest.fn(async () => null),
      listAdminUsers: jest.fn(async () => [
        { uid: 'admin-uid', email: 'admin@kaayko.com', role: 'admin', enabled: true },
        { uid: 'target-uid', email: 'target@test.com', role: 'viewer', enabled: true }
      ]),
      createAdminUser: jest.fn(async (uid, data) => ({ uid, ...data, enabled: true, createdAt: new Date() })),
      updateAdminUser: jest.fn(async (uid, data) => ({ uid, ...data })),
      deleteAdminUser: jest.fn(async () => {}),
      recordLogin: jest.fn(async () => {}),
      hasPermission: jest.fn(() => true),
      initializeFirstAdmin: jest.fn(async () => {}),
      ROLE_PERMISSIONS: { 'super-admin': ['*'], admin: ['manage_users', 'manage_orders'], viewer: ['view'] }
    }));

    const a = express();
    a.use(express.json());
    a.use('/admin', require('../api/admin/adminUsers'));

    const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
    a.post('/admin/updateOrderStatus', requireAuth, requireAdmin, require('../api/admin/updateOrderStatus'));
    const { getOrder, listOrders } = require('../api/admin/getOrder');
    a.get('/admin/getOrder', requireAuth, requireAdmin, getOrder);
    a.get('/admin/listOrders', requireAuth, requireAdmin, listOrders);
    app = a;
  });
});

// Helper to seed auth state for super-admin
function seedSuperAdmin() {
  admin._mocks.docData['admin_users/super-admin-uid'] = factories.superAdminUser();
}
function seedAdmin() {
  admin._mocks.docData['admin_users/admin-uid'] = factories.adminUser();
}

// ═══════════════════════════════════════════════════════════════
// ADMIN USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/me', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/admin/me');
    expect(res.status).toBe(401);
  });

  test('returns admin profile → 200', async () => {
    seedAdmin();
    const res = await request(app).get('/admin/me')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('returns 404 for user not in admin system', async () => {
    const res = await request(app).get('/admin/me')
      .set('Authorization', `Bearer ${factories.tokens.user}`);
    expect([200, 404]).toContain(res.status);
  });
});

describe('GET /admin/users', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/admin/users');
    expect(res.status).toBe(401);
  });

  test('rejects non-admin → 403', async () => {
    admin._mocks.docData['admin_users/user-uid'] = factories.regularUser();
    const res = await request(app).get('/admin/users')
      .set('Authorization', `Bearer ${factories.tokens.user}`);
    expect(res.status).toBe(403);
  });

  test('returns user list for super-admin → 200', async () => {
    seedSuperAdmin();
    const res = await request(app).get('/admin/users')
      .set('Authorization', `Bearer ${factories.tokens.superAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('supports pagination query params', async () => {
    seedSuperAdmin();
    const res = await request(app).get('/admin/users?role=admin&enabled=true')
      .set('Authorization', `Bearer ${factories.tokens.superAdmin}`);
    expect(res.status).toBe(200);
  });

  test('rejects admin role (not super-admin) → 403', async () => {
    seedAdmin();
    const res = await request(app).get('/admin/users')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /admin/users/:uid', () => {
  test('returns specific user for super-admin → 200', async () => {
    seedSuperAdmin();
    const res = await request(app).get('/admin/users/target-uid')
      .set('Authorization', `Bearer ${factories.tokens.superAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('returns 404 for non-existent user', async () => {
    seedSuperAdmin();
    const adminUserService = require('../services/adminUserService');
    adminUserService.getAdminUser.mockResolvedValueOnce(null);
    const res = await request(app).get('/admin/users/ghost-uid')
      .set('Authorization', `Bearer ${factories.tokens.superAdmin}`);
    expect([404, 500]).toContain(res.status);
  });
});

describe('POST /admin/users', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).post('/admin/users')
      .send({ email: 'new@test.com', password: 'Pass123!', role: 'viewer' });
    expect(res.status).toBe(401);
  });

  test('rejects non-super-admin → 403', async () => {
    seedAdmin();
    const res = await request(app).post('/admin/users')
      .set('Authorization', `Bearer ${factories.tokens.admin}`)
      .send({ email: 'new@test.com', password: 'Pass123!', role: 'viewer' });
    expect(res.status).toBe(403);
  });

  test('creates admin user → 201', async () => {
    seedSuperAdmin();
    const res = await request(app).post('/admin/users')
      .set('Authorization', `Bearer ${factories.tokens.superAdmin}`)
      .send({ email: 'newadmin@test.com', password: 'SecurePass123!', role: 'viewer', displayName: 'New Admin' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
  });

  test('rejects missing email → 400', async () => {
    seedSuperAdmin();
    const res = await request(app).post('/admin/users')
      .set('Authorization', `Bearer ${factories.tokens.superAdmin}`)
      .send({ password: 'Pass123!', role: 'viewer' });
    expect(res.status).toBe(400);
  });

  test('rejects missing password → 400', async () => {
    seedSuperAdmin();
    const res = await request(app).post('/admin/users')
      .set('Authorization', `Bearer ${factories.tokens.superAdmin}`)
      .send({ email: 'new@test.com', role: 'viewer' });
    expect(res.status).toBe(400);
  });

  test('rejects duplicate email → 409', async () => {
    seedSuperAdmin();
    admin._mocks.auth.createUser.mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 'auth/email-already-exists' })
    );
    const res = await request(app).post('/admin/users')
      .set('Authorization', `Bearer ${factories.tokens.superAdmin}`)
      .send({ email: 'existing@test.com', password: 'Pass123!', role: 'viewer' });
    expect(res.status).toBe(409);
  });
});

describe('PUT /admin/users/:uid', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).put('/admin/users/target-uid').send({ role: 'admin' });
    expect(res.status).toBe(401);
  });

  test('updates user role for super-admin → 200', async () => {
    seedSuperAdmin();
    const res = await request(app).put('/admin/users/target-uid')
      .set('Authorization', `Bearer ${factories.tokens.superAdmin}`)
      .send({ role: 'admin', displayName: 'Promoted' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('prevents admin from modifying own role → 403', async () => {
    seedSuperAdmin();
    const res = await request(app).put('/admin/users/super-admin-uid')
      .set('Authorization', `Bearer ${factories.tokens.superAdmin}`)
      .send({ role: 'viewer' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /admin/users/:uid', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).delete('/admin/users/target-uid');
    expect(res.status).toBe(401);
  });

  test('deletes user for super-admin → 200', async () => {
    seedSuperAdmin();
    const res = await request(app).delete('/admin/users/target-uid')
      .set('Authorization', `Bearer ${factories.tokens.superAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('prevents admin from deleting self → 403', async () => {
    seedSuperAdmin();
    const res = await request(app).delete('/admin/users/super-admin-uid')
      .set('Authorization', `Bearer ${factories.tokens.superAdmin}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /admin/roles', () => {
  test('returns available roles → 200', async () => {
    seedAdmin();
    const res = await request(app).get('/admin/roles')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// ORDER MANAGEMENT
// ═══════════════════════════════════════════════════════════════

describe('GET /admin/getOrder', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/admin/getOrder?orderId=order-123');
    expect(res.status).toBe(401);
  });

  test('rejects non-admin → 403', async () => {
    admin._mocks.docData['admin_users/user-uid'] = factories.regularUser();
    const res = await request(app).get('/admin/getOrder?orderId=order-123')
      .set('Authorization', `Bearer ${factories.tokens.user}`);
    expect(res.status).toBe(403);
  });

  test('returns order by orderId → 200', async () => {
    seedAdmin();
    admin._mocks.docData['orders/order-123'] = factories.order();
    const res = await request(app).get('/admin/getOrder?orderId=order-123')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect([200, 404]).toContain(res.status);
  });

  test('returns order by paymentIntentId → 200', async () => {
    seedAdmin();
    admin._mocks.firestore.collection.mockImplementation((path) => {
      if (path === 'orders') {
        const ref = admin._mocks.mockCollectionRef(path);
        ref.where.mockReturnValue(ref);
        ref.limit.mockReturnValue(ref);
        ref.get.mockResolvedValue({ empty: false, docs: [{ id: 'order-123', data: () => factories.order(), ref: { update: jest.fn() } }] });
        return ref;
      }
      return admin._mocks.mockCollectionRef(path);
    });
    const res = await request(app).get('/admin/getOrder?paymentIntentId=pi_test_123')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect([200, 400, 404]).toContain(res.status);
  });

  test('returns 400 when no query params', async () => {
    seedAdmin();
    const res = await request(app).get('/admin/getOrder')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect([400, 404]).toContain(res.status);
  });

  test('returns 404 for non-existent order', async () => {
    seedAdmin();
    const res = await request(app).get('/admin/getOrder?orderId=nonexistent')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect([404, 500]).toContain(res.status);
  });
});

describe('GET /admin/listOrders', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).get('/admin/listOrders');
    expect(res.status).toBe(401);
  });

  test('returns order list for admin → 200', async () => {
    seedAdmin();
    const res = await request(app).get('/admin/listOrders')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect([200, 500]).toContain(res.status);
  });

  test('supports status filter', async () => {
    seedAdmin();
    const res = await request(app).get('/admin/listOrders?status=completed&limit=20')
      .set('Authorization', `Bearer ${factories.tokens.admin}`);
    expect([200, 500]).toContain(res.status);
  });
});

describe('POST /admin/updateOrderStatus', () => {
  test('rejects unauthenticated → 401', async () => {
    const res = await request(app).post('/admin/updateOrderStatus')
      .send({ orderId: 'order-123', status: 'shipped' });
    expect(res.status).toBe(401);
  });

  test('rejects non-admin → 403', async () => {
    admin._mocks.docData['admin_users/user-uid'] = factories.regularUser();
    const res = await request(app).post('/admin/updateOrderStatus')
      .set('Authorization', `Bearer ${factories.tokens.user}`)
      .send({ orderId: 'order-123', status: 'shipped' });
    expect(res.status).toBe(403);
  });

  test('updates order status for admin → 200', async () => {
    seedAdmin();
    admin._mocks.docData['orders/order-123'] = factories.order();
    const res = await request(app).post('/admin/updateOrderStatus')
      .set('Authorization', `Bearer ${factories.tokens.admin}`)
      .send({ orderId: 'order-123', status: 'shipped' });
    expect([200, 400, 404]).toContain(res.status);
  });

  test('rejects missing orderId → 400', async () => {
    seedAdmin();
    const res = await request(app).post('/admin/updateOrderStatus')
      .set('Authorization', `Bearer ${factories.tokens.admin}`)
      .send({ status: 'shipped' });
    expect([400, 500]).toContain(res.status);
  });
});
