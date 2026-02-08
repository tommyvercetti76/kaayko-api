/**
 * Admin Users — Integration Tests
 *
 * Tests adminUserService + adminUserHandlers against REAL Firestore.
 * Validates RBAC, CRUD, soft-delete, and audit trails.
 *
 * External mock: Firebase Auth (createUser/deleteUser). Firestore is REAL.
 */

jest.unmock('firebase-admin');
jest.unmock('firebase-admin/firestore');

const request = require('supertest');
const express = require('express');
const { db, isEmulatorRunning, clearCollections, seedDoc, getDoc, getAllDocs } = require('./helpers/firestoreHelpers');
const seed = require('./helpers/seedData');
const { TEST_USERS } = require('./helpers/testApp');

let emulatorAvailable = false;

beforeAll(async () => {
  emulatorAvailable = await isEmulatorRunning();
});

beforeEach(async () => {
  if (!emulatorAvailable) return;
  await clearCollections(['admin_users', 'admin_audit_logs']);
});

afterAll(async () => {
  if (emulatorAvailable) await clearCollections(['admin_users', 'admin_audit_logs']);
});

const skipIfNoEmulator = () => {
  if (!emulatorAvailable) return true;
  return false;
};

// ─── Service-Level Tests (direct service calls) ────────────────────

describe('adminUserService — Firestore operations', () => {
  let service;

  beforeAll(() => {
    service = require('../../services/adminUserService');
  });

  test('createAdminUser writes correct doc shape', async () => {
    if (skipIfNoEmulator()) return;
    const result = await service.createAdminUser('test-uid-create', {
      email: 'newadmin@test.com',
      displayName: 'New Admin',
      role: 'editor',
      metadata: { createdBy: 'super-admin-uid', createdByEmail: 'super@kaayko.com' }
    });

    expect(result.uid).toBe('test-uid-create');
    expect(result.role).toBe('editor');

    // Verify in Firestore
    const doc = await getDoc('admin_users', 'test-uid-create');
    expect(doc.email).toBe('newadmin@test.com');
    expect(doc.displayName).toBe('New Admin');
    expect(doc.role).toBe('editor');
    expect(doc.permissions).toEqual(expect.arrayContaining(['smartlinks:create', 'smartlinks:read', 'smartlinks:update']));
    expect(doc.permissions).not.toContain('smartlinks:delete'); // editors can't delete
    expect(doc.enabled).toBe(true);
    expect(doc.metadata.environment).toBe('local'); // FUNCTIONS_EMULATOR=true
  });

  test('createAdminUser defaults displayName from email', async () => {
    if (skipIfNoEmulator()) return;
    const result = await service.createAdminUser('test-uid-default', {
      email: 'john.smith@kaayko.com',
      role: 'viewer'
    });

    const doc = await getDoc('admin_users', 'test-uid-default');
    expect(doc.displayName).toBe('john.smith');
  });

  test('createAdminUser rejects invalid role', async () => {
    if (skipIfNoEmulator()) return;
    await expect(service.createAdminUser('bad-role', {
      email: 'bad@test.com',
      role: 'overlord'
    })).rejects.toThrow(/Invalid role/);
  });

  test('getAdminUser returns null for missing uid', async () => {
    if (skipIfNoEmulator()) return;
    const result = await service.getAdminUser('nonexistent-uid');
    expect(result).toBeNull();
  });

  test('getAdminUser returns seeded doc', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('admin_users', 'seeded-uid', seed.adminUser({ uid: 'seeded-uid' }));

    const result = await service.getAdminUser('seeded-uid');
    expect(result).not.toBeNull();
    expect(result.uid).toBe('seeded-uid');
    expect(result.role).toBe('admin');
  });

  test('getAdminUserByEmail works with seeded data', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('admin_users', 'email-uid', seed.adminUser({ uid: 'email-uid', email: 'findme@test.com' }));

    const result = await service.getAdminUserByEmail('findme@test.com');
    expect(result).not.toBeNull();
    expect(result.email).toBe('findme@test.com');
  });

  test('listAdminUsers returns all users', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('admin_users', 'u1', seed.adminUser({ uid: 'u1', role: 'admin' }));
    await seedDoc('admin_users', 'u2', seed.adminUser({ uid: 'u2', role: 'viewer' }));
    await seedDoc('admin_users', 'u3', seed.superAdmin({ uid: 'u3' }));

    const result = await service.listAdminUsers();
    expect(result).toHaveLength(3);
  });

  test('listAdminUsers filters by role', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('admin_users', 'u1', seed.adminUser({ uid: 'u1', role: 'admin' }));
    await seedDoc('admin_users', 'u2', seed.adminUser({ uid: 'u2', role: 'viewer' }));

    const result = await service.listAdminUsers({ role: 'admin' });
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('admin');
  });

  test('listAdminUsers filters by enabled', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('admin_users', 'u1', seed.adminUser({ uid: 'u1', enabled: true }));
    await seedDoc('admin_users', 'u2', seed.adminUser({ uid: 'u2', enabled: false }));

    const result = await service.listAdminUsers({ enabled: false });
    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe('u2');
  });

  test('updateAdminUser changes role + auto-updates permissions', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('admin_users', 'update-uid', seed.adminUser({ uid: 'update-uid', role: 'viewer' }));

    const result = await service.updateAdminUser('update-uid', { role: 'admin' });
    expect(result.role).toBe('admin');

    const doc = await getDoc('admin_users', 'update-uid');
    expect(doc.role).toBe('admin');
    expect(doc.permissions).toContain('smartlinks:delete'); // admin can delete
  });

  test('updateAdminUser rejects invalid role', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('admin_users', 'bad-update', seed.adminUser({ uid: 'bad-update' }));

    await expect(service.updateAdminUser('bad-update', { role: 'dictator' }))
      .rejects.toThrow(/Invalid role/);
  });

  test('deleteAdminUser soft-deletes (enabled=false)', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('admin_users', 'delete-uid', seed.adminUser({ uid: 'delete-uid' }));

    await service.deleteAdminUser('delete-uid');

    const doc = await getDoc('admin_users', 'delete-uid');
    expect(doc.enabled).toBe(false);
    expect(doc.deletedAt).toBeTruthy(); // Timestamp set
  });

  test('recordLogin updates lastLoginAt', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('admin_users', 'login-uid', seed.adminUser({ uid: 'login-uid', lastLoginAt: null }));

    await service.recordLogin('login-uid');

    const doc = await getDoc('admin_users', 'login-uid');
    expect(doc.lastLoginAt).toBeTruthy();
  });

  test('hasPermission: super-admin has all', () => {
    expect(service.hasPermission({ permissions: ['*'] }, 'anything:goes')).toBe(true);
  });

  test('hasPermission: viewer lacks write permissions', () => {
    const viewer = { permissions: ['smartlinks:read', 'analytics:read'] };
    expect(service.hasPermission(viewer, 'smartlinks:create')).toBe(false);
    expect(service.hasPermission(viewer, 'smartlinks:read')).toBe(true);
  });

  test('hasPermission: null user returns false', () => {
    expect(service.hasPermission(null, 'anything')).toBe(false);
    expect(service.hasPermission({}, 'anything')).toBe(false);
  });
});

// ─── Handler-Level Tests (via HTTP) ────────────────────────────────

describe('Admin User Handlers — HTTP integration', () => {
  let app;

  beforeEach(async () => {
    if (!emulatorAvailable) return;

    // Build Express app with admin handlers, bypassing auth
    app = express();
    app.use(express.json());

    // Inject test user for all requests
    app.use((req, _res, next) => {
      const header = req.get('X-Test-User');
      req.user = header
        ? JSON.parse(header)
        : { uid: 'super-admin-uid', email: 'super@kaayko.com', role: 'super-admin' };
      next();
    });

    // Mount admin handlers directly (skip auth middleware)
    const handlers = require('../../api/admin/adminUserHandlers');
    app.get('/admin/me', handlers.getMe);
    app.get('/admin/users', handlers.listUsers);
    app.get('/admin/users/:uid', handlers.getUser);
    app.put('/admin/users/:uid', handlers.updateUser);
    app.delete('/admin/users/:uid', handlers.deleteUser);
    app.get('/admin/roles', handlers.getRoles);

    // Seed the "current user" doc so /me works
    await seedDoc('admin_users', 'super-admin-uid', seed.superAdmin());
  });

  test('GET /admin/me returns current user profile', async () => {
    if (skipIfNoEmulator()) return;
    const res = await request(app).get('/admin/me');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.uid).toBe('super-admin-uid');
    expect(res.body.user.role).toBe('super-admin');
    expect(res.body.user.permissions).toEqual(['*']);
  });

  test('GET /admin/users lists all users', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('admin_users', 'u2', seed.adminUser({ uid: 'u2' }));

    const res = await request(app).get('/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  test('GET /admin/users?role=admin filters by role', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('admin_users', 'admin1', seed.adminUser({ uid: 'admin1', role: 'admin' }));
    await seedDoc('admin_users', 'viewer1', seed.adminUser({ uid: 'viewer1', role: 'viewer' }));

    const res = await request(app).get('/admin/users?role=admin');
    expect(res.status).toBe(200);
    res.body.users.forEach(u => expect(u.role).toBe('admin'));
  });

  test('GET /admin/users/:uid returns specific user', async () => {
    if (skipIfNoEmulator()) return;
    const res = await request(app).get('/admin/users/super-admin-uid');
    expect(res.status).toBe(200);
    expect(res.body.user.uid).toBe('super-admin-uid');
  });

  test('GET /admin/users/:uid returns 404 for unknown user', async () => {
    if (skipIfNoEmulator()) return;
    const res = await request(app).get('/admin/users/unknown-uid');
    expect(res.status).toBe(404);
  });

  test('PUT /admin/users/:uid updates role', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('admin_users', 'promote-uid', seed.adminUser({ uid: 'promote-uid', role: 'viewer' }));

    const res = await request(app).put('/admin/users/promote-uid').send({ role: 'editor' });
    expect(res.status).toBe(200);

    const doc = await getDoc('admin_users', 'promote-uid');
    expect(doc.role).toBe('editor');
  });

  test('PUT /admin/users/:uid blocks self-role-change', async () => {
    if (skipIfNoEmulator()) return;
    const res = await request(app).put('/admin/users/super-admin-uid').send({ role: 'viewer' });
    expect(res.status).toBe(403);
  });

  test('DELETE /admin/users/:uid soft-deletes', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('admin_users', 'del-uid', seed.adminUser({ uid: 'del-uid' }));

    const res = await request(app).delete('/admin/users/del-uid');
    expect(res.status).toBe(200);

    const doc = await getDoc('admin_users', 'del-uid');
    expect(doc.enabled).toBe(false);
  });

  test('DELETE /admin/users/:uid blocks self-delete', async () => {
    if (skipIfNoEmulator()) return;
    const res = await request(app).delete('/admin/users/super-admin-uid');
    expect(res.status).toBe(403);
  });

  test('GET /admin/roles returns role definitions', async () => {
    if (skipIfNoEmulator()) return;
    const res = await request(app).get('/admin/roles');
    expect(res.status).toBe(200);
    expect(res.body.roles).toHaveProperty('super-admin');
    expect(res.body.roles).toHaveProperty('admin');
    expect(res.body.roles).toHaveProperty('editor');
    expect(res.body.roles).toHaveProperty('viewer');
  });
});
