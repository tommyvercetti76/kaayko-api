/**
 * Public Smart Links API — thin router
 *
 * Programmatic API for external clients using API keys.
 * Enables tenant-scoped link creation, management, and analytics.
 *
 * All endpoints require API key authentication (x-api-key header).
 * Operations are automatically scoped to the API key's tenant.
 *
 * @module api/kortex/publicApiRouter
 */

const express = require('express');
const router = express.Router();
const { requireApiKey } = require('../../middleware/apiKeyMiddleware');
const { tenantRateLimit } = require('./rateLimitService');
const h = require('./publicApiHandlers');

// Tenant-level rate limiting (on top of per-key limits)
router.use(tenantRateLimit({ maxRequests: 1000, windowSeconds: 60 }));

router.post('/smartlinks', requireApiKey(['create:links']), h.createLink);
router.get('/smartlinks', requireApiKey(['read:links']), h.listLinks);
router.get('/smartlinks/:code', requireApiKey(['read:links']), h.getLink);
router.put('/smartlinks/:code', requireApiKey(['update:links']), h.updateLink);
router.delete('/smartlinks/:code', requireApiKey(['delete:links']), h.deleteLink);
router.get('/smartlinks/:code/stats', requireApiKey(['read:stats']), h.getStats);
router.get('/smartlinks/:code/attribution', requireApiKey(['read:stats']), h.getAttribution);
router.post('/smartlinks/batch', requireApiKey(['create:links']), h.batchCreate);
router.get('/health', h.health);

module.exports = router;
