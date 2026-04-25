/**
 * Public Smart Links API for External Clients
 *
 * ⚠️  NOT MOUNTED — This router is NOT registered in functions/index.js.
 *     Endpoints at /api/public/* will 404 until this is mounted.
 *     Mount when external API key access is ready to ship:
 *       apiApp.use("/api/public", require("./api/smartLinks/publicApiRouter"));
 *
 * Programmatic API for external clients using API keys.
 * Enables tenant-scoped link creation, management, and analytics.
 *
 * All endpoints require API key authentication (x-api-key header).
 * Operations are automatically scoped to the API key's tenant.
 *
 * @module api/smartLinks/publicApiRouter
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

// Apply tenant-based rate limiting to all public API routes
// API keys already have per-key rate limiting, this is an additional tenant-level limit
router.use(tenantRateLimit({
  maxRequests: 1000, // 1000 requests per minute per tenant
  windowSeconds: 60
}));

// ============================================================================
// PUBLIC API ENDPOINTS (API Key Authentication)
// ============================================================================

/**
 * Create short link (API key access)
 * POST /api/public/smartlinks
 * 
 * Requires API key with 'create:links' scope
 */
router.post('/smartlinks', requireApiKey(['create:links']), async (req, res) => {
  try {
    // Tenant is automatically inferred from API key
    const linkData = {
      ...req.body,
      tenantId: req.apiClient.tenantId,
      tenantName: req.apiClient.tenantName,
      createdBy: req.apiClient.name || req.apiClient.keyId,
      apiKeyId: req.apiClient.keyId
    };

    const link = await LinkService.createShortLink(linkData);

    res.status(201).json({
      success: true,
      link,
      message: `Short link created: ${link.shortUrl}`
    });

  } catch (error) {
    console.error('[PublicAPI] Create link error:', error);

    if (error.code === 'ALREADY_EXISTS') {
      return res.status(409).json({
        success: false,
        error: error.message,
        existing: error.existing
      });
    }

    res.status(400).json({
      success: false,
      error: error.message || 'Failed to create link'
    });
  }
});

/**
 * List links (API key access)
 * GET /api/public/smartlinks
 * 
 * Requires API key with 'read:links' scope
 * Results automatically scoped to API key's tenant
 */
router.get('/smartlinks', requireApiKey(['read:links']), async (req, res) => {
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
router.get('/smartlinks/:code', requireApiKey(['read:links']), async (req, res) => {
  try {
    const { code } = req.params;
    const link = await LinkService.getShortLink(code);

    // Verify link belongs to API key's tenant
    if (link.tenantId !== req.apiClient.tenantId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'Link belongs to different tenant'
      });
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

router.put('/smartlinks/:code', requireApiKey(['update:links']), validateUpdateRequest, async (req, res) => {
  try {
    const { code } = req.params;
    
    // First verify link belongs to tenant
    const existingLink = await LinkService.getShortLink(code);
    if (existingLink.tenantId !== req.apiClient.tenantId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    const link = await LinkService.updateShortLink(code, req.body);

    res.json({ success: true, link });

  } catch (error) {
    console.error('[PublicAPI] Update link error:', error);

    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'Link not found'
      });
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

router.delete('/smartlinks/:code', requireApiKey(['delete:links']), validateDeleteRequest, async (req, res) => {
  try {
    const { code } = req.params;

    // Verify link belongs to tenant
    const existingLink = await LinkService.getShortLink(code);
    if (existingLink.tenantId !== req.apiClient.tenantId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    const result = await LinkService.deleteShortLink(code);

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
router.get('/smartlinks/:code/stats', requireApiKey(['read:stats']), async (req, res) => {
  try {
    const { code } = req.params;
    const { startDate, endDate } = req.query;

    // Verify link belongs to tenant
    const link = await LinkService.getShortLink(code);
    if (link.tenantId !== req.apiClient.tenantId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
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
router.get('/smartlinks/:code/attribution', requireApiKey(['read:stats']), async (req, res) => {
  try {
    const { code } = req.params;

    // Verify link belongs to tenant
    const link = await LinkService.getShortLink(code);
    if (link.tenantId !== req.apiClient.tenantId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
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

router.post('/smartlinks/batch', requireApiKey(['create:links']), validateBatchRequest, async (req, res) => {
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
          ...linkData,
          tenantId: req.apiClient.tenantId,
          tenantName: req.apiClient.tenantName,
          createdBy: req.apiClient.name || req.apiClient.keyId,
          apiKeyId: req.apiClient.keyId
        });
        results.push({ success: true, link });
      } catch (error) {
        errors.push({
          success: false,
          error: error.message,
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
