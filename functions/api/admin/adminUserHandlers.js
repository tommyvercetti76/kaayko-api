/**
 * Admin User Handlers — user management logic
 * Extracted from adminUsers.js for primer compliance.
 *
 * @module api/admin/adminUserHandlers
 */

const adminUserService = require('../../services/adminUserService');

// ─── Current User Info ─────────────────────────────────
async function getMe(req, res) {
  try {
    const user = await adminUserService.getAdminUser(req.user.uid);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found in admin system', message: 'Your account is authenticated but not registered as an admin user. Contact system administrator.' });
    }
    await adminUserService.recordLogin(req.user.uid);
    res.json({ success: true, user: { uid: user.uid, email: user.email, displayName: user.displayName, role: user.role, permissions: user.permissions, lastLoginAt: user.lastLoginAt, enabled: user.enabled } });
  } catch (error) {
    console.error('[Admin] Error fetching user profile:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch user profile' });
  }
}

// ─── List Users ────────────────────────────────────────
async function listUsers(req, res) {
  try {
    const { role, enabled } = req.query;
    const filters = {};
    if (role) filters.role = role;
    if (enabled !== undefined) filters.enabled = enabled === 'true';
    const users = await adminUserService.listAdminUsers(filters);
    res.json({ success: true, users, total: users.length });
  } catch (error) {
    console.error('[Admin] Error listing users:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
}

// ─── Get User ──────────────────────────────────────────
async function getUser(req, res) {
  try {
    const user = await adminUserService.getAdminUser(req.params.uid);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, user });
  } catch (error) {
    console.error('[Admin] Error fetching user:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch user' });
  }
}

// ─── Create User ───────────────────────────────────────
async function createUser(req, res) {
  try {
    const { email, password, displayName, role, permissions, metadata } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password are required' });

    const admin = require('firebase-admin');
    const userRecord = await admin.auth().createUser({
      email, password, emailVerified: false, displayName: displayName || email.split('@')[0]
    });

    const user = await adminUserService.createAdminUser(userRecord.uid, {
      email, displayName, role: role || 'viewer', permissions,
      metadata: { ...metadata, createdBy: req.user.uid, createdByEmail: req.user.email }
    });
    res.status(201).json({ success: true, user, message: `Admin user created: ${email}` });
  } catch (error) {
    console.error('[Admin] Error creating user:', error);
    if (error.code === 'auth/email-already-exists') return res.status(409).json({ success: false, error: 'Email already exists' });
    res.status(400).json({ success: false, error: error.message || 'Failed to create user' });
  }
}

// ─── Update User ───────────────────────────────────────
async function updateUser(req, res) {
  try {
    const { uid } = req.params;
    if (uid === req.user.uid && req.body.role) {
      return res.status(403).json({ success: false, error: 'Cannot modify your own role' });
    }
    const user = await adminUserService.updateAdminUser(uid, req.body);
    res.json({ success: true, user, message: 'User updated successfully' });
  } catch (error) {
    console.error('[Admin] Error updating user:', error);
    res.status(400).json({ success: false, error: error.message || 'Failed to update user' });
  }
}

// ─── Delete User ───────────────────────────────────────
async function deleteUser(req, res) {
  try {
    const { uid } = req.params;
    if (uid === req.user.uid) return res.status(403).json({ success: false, error: 'Cannot delete your own account' });
    await adminUserService.deleteAdminUser(uid);
    res.json({ success: true, message: 'User disabled successfully' });
  } catch (error) {
    console.error('[Admin] Error deleting user:', error);
    res.status(400).json({ success: false, error: 'Failed to delete user' });
  }
}

// ─── Roles ─────────────────────────────────────────────
function getRoles(req, res) {
  res.json({ success: true, roles: adminUserService.ROLE_PERMISSIONS });
}

module.exports = { getMe, listUsers, getUser, createUser, updateUser, deleteUser, getRoles };
