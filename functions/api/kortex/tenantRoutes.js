/**
 * Smart Links Tenant Routes — thin router
 *
 * Multi-tenant management endpoints: registration, listing, migration.
 *
 * Routes:
 * - POST /tenant-registration  - Register new tenant (public, rate limited)
 * - GET  /tenants              - List tenants for user (auth)
 * - GET  /admin/migrate        - Run tenant migration (admin)
 *
 * @module api/kortex/tenantRoutes
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../../middleware/authMiddleware');
const { rateLimiter } = require('../../middleware/securityMiddleware');
const h = require('./tenantHandlers');

router.get('/admin/migrate', requireAuth, requireAdmin, h.migrate);
router.post('/tenant-registration', rateLimiter('tenantRegistration'), h.register);
router.get('/tenants', requireAuth, rateLimiter('tenants'), h.listTenants);

module.exports = router;
