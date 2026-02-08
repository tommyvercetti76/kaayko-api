/**
 * Admin User Management API — thin router
 *
 * Endpoints for managing admin users, roles, and permissions.
 * All endpoints require authentication.
 *
 * @module api/admin/adminUsers
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireRole } = require('../../middleware/authRBAC');
const h = require('./adminUserHandlers');

router.get('/me', requireAuth, h.getMe);
router.get('/users', requireAuth, requireRole('super-admin'), h.listUsers);
router.get('/users/:uid', requireAuth, requireRole('super-admin'), h.getUser);
router.post('/users', requireAuth, requireRole('super-admin'), h.createUser);
router.put('/users/:uid', requireAuth, requireRole('super-admin'), h.updateUser);
router.delete('/users/:uid', requireAuth, requireRole('super-admin'), h.deleteUser);
router.get('/roles', requireAuth, h.getRoles);

module.exports = router;
