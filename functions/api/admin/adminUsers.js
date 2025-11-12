/**
 * Admin User Management API
 * 
 * Endpoints for managing admin users, roles, and permissions
 * All endpoints require authentication
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin, requireRole } = require('../../middleware/authMiddleware');
const adminUserService = require('../../services/adminUserService');

// ============================================================================
// CURRENT USER INFO
// ============================================================================

/**
 * Get current user's profile and permissions
 * GET /api/admin/me
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await adminUserService.getAdminUser(req.user.uid);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found in admin system',
        message: 'Your account is authenticated but not registered as an admin user. Contact system administrator.'
      });
    }

    // Record login
    await adminUserService.recordLogin(req.user.uid);

    res.json({
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        permissions: user.permissions,
        lastLoginAt: user.lastLoginAt,
        enabled: user.enabled
      }
    });

  } catch (error) {
    console.error('[Admin] Error fetching user profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile'
    });
  }
});

// ============================================================================
// USER MANAGEMENT (Super-admin only)
// ============================================================================

/**
 * List all admin users
 * GET /api/admin/users
 */
router.get('/users', requireAuth, requireRole('super-admin'), async (req, res) => {
  try {
    const { role, enabled } = req.query;

    const filters = {};
    if (role) filters.role = role;
    if (enabled !== undefined) filters.enabled = enabled === 'true';

    const users = await adminUserService.listAdminUsers(filters);

    res.json({
      success: true,
      users,
      total: users.length
    });

  } catch (error) {
    console.error('[Admin] Error listing users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

/**
 * Get specific admin user
 * GET /api/admin/users/:uid
 */
router.get('/users/:uid', requireAuth, requireRole('super-admin'), async (req, res) => {
  try {
    const { uid } = req.params;
    const user = await adminUserService.getAdminUser(uid);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });

  } catch (error) {
    console.error('[Admin] Error fetching user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user'
    });
  }
});

/**
 * Create admin user
 * POST /api/admin/users
 */
router.post('/users', requireAuth, requireRole('super-admin'), async (req, res) => {
  try {
    const { email, password, displayName, role, permissions, metadata } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Create Firebase Auth user first
    const admin = require('firebase-admin');
    const userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: false,
      displayName: displayName || email.split('@')[0]
    });

    // Create admin user record in Firestore
    const user = await adminUserService.createAdminUser(userRecord.uid, {
      email,
      displayName,
      role: role || 'viewer',
      permissions,
      metadata: {
        ...metadata,
        createdBy: req.user.uid,
        createdByEmail: req.user.email
      }
    });

    res.status(201).json({
      success: true,
      user,
      message: `Admin user created: ${email}`
    });

  } catch (error) {
    console.error('[Admin] Error creating user:', error);

    if (error.code === 'auth/email-already-exists') {
      return res.status(409).json({
        success: false,
        error: 'Email already exists'
      });
    }

    res.status(400).json({
      success: false,
      error: error.message || 'Failed to create user'
    });
  }
});

/**
 * Update admin user
 * PUT /api/admin/users/:uid
 */
router.put('/users/:uid', requireAuth, requireRole('super-admin'), async (req, res) => {
  try {
    const { uid } = req.params;
    const updates = req.body;

    // Prevent users from modifying their own role (security)
    if (uid === req.user.uid && updates.role) {
      return res.status(403).json({
        success: false,
        error: 'Cannot modify your own role'
      });
    }

    const user = await adminUserService.updateAdminUser(uid, updates);

    res.json({
      success: true,
      user,
      message: 'User updated successfully'
    });

  } catch (error) {
    console.error('[Admin] Error updating user:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to update user'
    });
  }
});

/**
 * Delete admin user (soft delete)
 * DELETE /api/admin/users/:uid
 */
router.delete('/users/:uid', requireAuth, requireRole('super-admin'), async (req, res) => {
  try {
    const { uid } = req.params;

    // Prevent users from deleting themselves
    if (uid === req.user.uid) {
      return res.status(403).json({
        success: false,
        error: 'Cannot delete your own account'
      });
    }

    await adminUserService.deleteAdminUser(uid);

    res.json({
      success: true,
      message: 'User disabled successfully'
    });

  } catch (error) {
    console.error('[Admin] Error deleting user:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to delete user'
    });
  }
});

// ============================================================================
// ROLE & PERMISSION INFO
// ============================================================================

/**
 * Get available roles and their permissions
 * GET /api/admin/roles
 */
router.get('/roles', requireAuth, (req, res) => {
  res.json({
    success: true,
    roles: adminUserService.ROLE_PERMISSIONS
  });
});

module.exports = router;
