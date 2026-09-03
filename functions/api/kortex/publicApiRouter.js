/**
 * Public Smart Links API for External Clients
 *
 * Mounted in functions/index.js:
 *   apiApp.use("/api/public", require("./api/kortex/publicApiRouter"));
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
const admin = require('firebase-admin');

const db = admin.firestore();
const LinkService = require('./smartLinkService');
const { requireApiKey } = require('../../middleware/apiKeyMiddleware');
const { getLinkAnalytics } = require('./clickTracking');
const { getAttributionStats } = require('./attributionService');
const { tenantRateLimit } = require('./rateLimitService');
const { pickCreateInput, pickUpdateInput } = require('./validation/linkInput');
const { recordAudit } = require('./auditLog');
const { triggerWebhooks, EVENT_TYPES } = require('./webhookService');

// Per-route guard: authenticate the API key, THEN apply the tenant-level limit.
// A router-wide `router.use(tenantRateLimit)` ran before requireApiKey, so
// req.apiClient was never set and the tenant limit silently skipped every call.
const TENANT_LIMIT = { maxRequests: 1000, windowSeconds: 60 };
const withKey = (scopes) => [requireApiKey(scopes), tenantRateLimit(TENANT_LIMIT)];

// Same 404 whether the code does not exist or belongs to another tenant, so the
// public API is not an existence oracle across tenants.
function notFound(res) {
  return res.status(404).json({ success: false, error: 'Link not found' });
}

function createError(res, error) {
  if (error.code === 'ALREADY_EXISTS') {
    return res.status(409).json({ success: false, error: error.message, code: error.code, existing: error.existing });
  }
  if (error.code === 'DESTINATION_BLOCKED') {
    return res.status(422).json({ success: false, error: error.message, code: error.code, reasons: error.reasons || [] });
  }
  if (error.code === 'INVALID_URL' || error.code === 'VALIDATION_ERROR' || error.code === 'INVALID_CODE') {
    return res.status(422).json({ success: false, error: error.message, code: error.code });
  }
  if (error.code === 'DOMAIN_NOT_WHITELISTED' || error.code === 'DOMAIN_NOT_ALLOWED' || error.code === 'PLAN_LIMIT_EXCEEDED') {
    return res.status(403).json({ success: false, error: error.message, code: error.code });
  }
  return res.status(400).json({ success: false, error: error.message || 'Failed to create link', code: error.code || 'CREATE_FAILED' });
}

function fireLinkCreated(link, tenantId) {
  triggerWebhooks({
    tenantId,
    eventType: EVENT_TYPES.LINK_CREATED,
    payload: {
      event: 'link.created',
      link: { code: link.code, shortUrl: link.shortUrl, title: link.title, destinations: link.destinations, status: link.status, createdBy: link.createdBy, createdAt: link.createdAt },
      timestamp: new Date().toISOString()
    }
  }).catch(err => console.error('[PublicAPI] webhook trigger error:', err));
}

// ============================================================================
// PUBLIC API ENDPOINTS (API Key Authentication)
// ============================================================================

/**
 * Create short link (API key access)
 * POST /api/public/smartlinks
 * 
 * Requires API key with 'create:links' scope
 */
router.post('/smartlinks', ...withKey(['create:links']), async (req, res) => {
  try {
    // Tenant is inferred from the API key; only allowlisted fields come from the body.
    const linkData = {
      ...pickCreateInput(req.body),
      tenantId: req.apiClient.tenantId,
      tenantName: req.apiClient.tenantName,
      createdBy: req.apiClient.name || req.apiClient.keyId,
      apiKeyId: req.apiClient.keyId
    };

    const link = await LinkService.createShortLink(linkData);
    recordAudit({ req, action: 'link.created', code: link.code, tenantId: req.apiClient.tenantId, after: link });
    fireLinkCreated(link, req.apiClient.tenantId);

    res.status(201).json({
      success: true,
      link,
      status: link.status,
      message: link.status === 'held'
        ? `Short link created and held for review: ${link.shortUrl}`
        : `Short link created: ${link.shortUrl}`
    });

  } catch (error) {
    console.error('[PublicAPI] Create link error:', error);
    return createError(res, error);
  }
});

/**
 * List links (API key access)
 * GET /api/public/smartlinks
 * 
 * Requires API key with 'read:links' scope
 * Results automatically scoped to API key's tenant
 */
router.get('/smartlinks', ...withKey(['read:links']), async (req, res) => {
  try {
    const { enabled, limit, offset } = req.query;

    const filters = {
      tenantId: req.apiClient.tenantId, // Auto-scope to tenant
      enabled: enabled !== undefined ? enabled === 'true' : undefined,
      limit: limit ? parseInt(limit, 10) : 100
    };

    const result = await LinkService.listLinks(filters);

    res.json({
      success: true,
      ...result,
      tenant: {
        id: req.apiClient.tenantId,
        name: req.apiClient.tenantName
      },
      pagination: {
        limit: filters.limit,
        offset: offset ? parseInt(offset, 10) : 0
      }
    });

  } catch (error) {
    console.error('[PublicAPI] List links error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch links'
    });
  }
});

/**
 * Get link by code (API key access)
 * GET /api/public/smartlinks/:code
 * 
 * Requires API key with 'read:links' scope
 */
router.get('/smartlinks/:code', ...withKey(['read:links']), async (req, res) => {
  try {
    const { code } = req.params;
    const link = await LinkService.getShortLink(code);

    // Verify link belongs to API key's tenant
    if (link.tenantId !== req.apiClient.tenantId) {
      return notFound(res);
    }

    res.json({ success: true, link });

  } catch (error) {
    console.error('[PublicAPI] Get link error:', error);

    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'Link not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to fetch link'
    });
  }
});

/**
 * Update link (API key access)
 * PUT /api/public/smartlinks/:code
 * 
 * Requires API key with 'update:links' scope
 */
const validateUpdateRequest = require('./validation/updateLinkRequest');

router.put('/smartlinks/:code', ...withKey(['update:links']), validateUpdateRequest, async (req, res) => {
  try {
    const { code } = req.params;
    
    // First verify link belongs to tenant
    const existingLink = await LinkService.getShortLink(code);
    if (existingLink.tenantId !== req.apiClient.tenantId) {
      return notFound(res);
    }

    const link = await LinkService.updateShortLink(code, {
      ...pickUpdateInput(req.body),
      updatedBy: req.apiClient.name || req.apiClient.keyId
    });
    recordAudit({ req, action: 'link.updated', code, tenantId: req.apiClient.tenantId, before: existingLink, after: link });

    res.json({ success: true, link });

  } catch (error) {
    console.error('[PublicAPI] Update link error:', error);

    if (error.code === 'NOT_FOUND') {
      return notFound(res);
    }
    if (error.code === 'DESTINATION_BLOCKED') {
      return res.status(422).json({ success: false, error: error.message, code: error.code, reasons: error.reasons || [] });
    }
    if (error.code === 'INVALID_URL' || error.code === 'VALIDATION_ERROR') {
      return res.status(422).json({ success: false, error: error.message, code: error.code });
    }
    if (error.code === 'DOMAIN_NOT_WHITELISTED' || error.code === 'DOMAIN_NOT_ALLOWED') {
      return res.status(403).json({ success: false, error: error.message, code: error.code });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update link'
    });
  }
});

/**
 * Delete link (API key access)
 * DELETE /api/public/smartlinks/:code
 * 
 * Requires API key with 'delete:links' scope
 */
const validateDeleteRequest = require('./validation/deleteLinkRequest');

router.delete('/smartlinks/:code', ...withKey(['delete:links']), validateDeleteRequest, async (req, res) => {
  try {
    const { code } = req.params;

    // Verify link belongs to tenant
    const existingLink = await LinkService.getShortLink(code);
    if (existingLink.tenantId !== req.apiClient.tenantId) {
      return notFound(res);
    }

    const result = await LinkService.deleteShortLink(code);
    recordAudit({ req, action: 'link.deleted', code, tenantId: req.apiClient.tenantId, before: existingLink });

    res.json({ success: true, ...result });

  } catch (error) {
    console.error('[PublicAPI] Delete link error:', error);

    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'Link not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to delete link'
    });
  }
});

/**
 * Get link statistics (API key access)
 * GET /api/public/smartlinks/:code/stats
 * 
 * Requires API key with 'read:stats' scope
 */
router.get('/smartlinks/:code/stats', ...withKey(['read:stats']), async (req, res) => {
  try {
    const { code } = req.params;
    const { startDate, endDate } = req.query;

    // Verify link belongs to tenant
    const link = await LinkService.getShortLink(code);
    if (link.tenantId !== req.apiClient.tenantId) {
      return notFound(res);
    }

    // Get analytics
    const options = {};
    if (startDate) options.startDate = new Date(startDate);
    if (endDate) options.endDate = new Date(endDate);

    const analytics = await getLinkAnalytics(code, options);

    res.json({
      success: true,
      analytics
    });

  } catch (error) {
    console.error('[PublicAPI] Get stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

/**
 * Get attribution stats (installs, conversions)
 * GET /api/public/smartlinks/:code/attribution
 * 
 * Requires API key with 'read:stats' scope
 */
router.get('/smartlinks/:code/attribution', ...withKey(['read:stats']), async (req, res) => {
  try {
    const { code } = req.params;

    // Verify link belongs to tenant
    const link = await LinkService.getShortLink(code);
    if (link.tenantId !== req.apiClient.tenantId) {
      return notFound(res);
    }

    const stats = await getAttributionStats(code);

    res.json({
      success: true,
      attribution: stats
    });

  } catch (error) {
    console.error('[PublicAPI] Get attribution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch attribution stats'
    });
  }
});

/**
 * Batch create links
 * POST /api/public/smartlinks/batch
 * 
 * Requires API key with 'create:links' scope
 */
const validateBatchRequest = require('./validation/batchLinkRequest');

router.post('/smartlinks/batch', ...withKey(['create:links']), validateBatchRequest, async (req, res) => {
  try {
    const { links } = req.body;

    if (!Array.isArray(links) || links.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'links array is required'
      });
    }

    if (links.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 100 links per batch'
      });
    }

    const results = [];
    const errors = [];

    for (const linkData of links) {
      try {
        const link = await LinkService.createShortLink({
          ...pickCreateInput(linkData),
          tenantId: req.apiClient.tenantId,
          tenantName: req.apiClient.tenantName,
          createdBy: req.apiClient.name || req.apiClient.keyId,
          apiKeyId: req.apiClient.keyId
        });
        recordAudit({ req, action: 'link.created', code: link.code, tenantId: req.apiClient.tenantId, after: link, extra: { batch: true } });
        fireLinkCreated(link, req.apiClient.tenantId);
        results.push({ success: true, link });
      } catch (error) {
        errors.push({
          success: false,
          error: error.message,
          code: error.code || null,
          reasons: error.reasons || undefined,
          linkData: linkData
        });
      }
    }

    res.json({
      success: true,
      created: results.length,
      failed: errors.length,
      results,
      errors
    });

  } catch (error) {
    console.error('[PublicAPI] Batch create error:', error);
    res.status(500).json({
      success: false,
      error: 'Batch create failed'
    });
  }
});

/**
 * Health check for public API
 * GET /api/public/health
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'Smart Links Public API v5.0',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
