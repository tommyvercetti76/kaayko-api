/**
 * Public API Handlers — tenant-scoped link management
 * Extracted from publicApiRouter.js for primer compliance.
 *
 * @module api/kortex/publicApiHandlers
 */

const LinkService = require('./kortexService');
const { getLinkAnalytics } = require('./clickAnalytics');
const { getAttributionStats } = require('./attributionService');

// ─── Helper: verify tenant ownership ───────────────────
async function verifyTenant(code, tenantId, res) {
  const link = await LinkService.getShortLink(code);
  if (link.tenantId !== tenantId) {
    res.status(403).json({ success: false, error: 'Access denied', message: 'Link belongs to different tenant' });
    return null;
  }
  return link;
}

// ─── Create ────────────────────────────────────────────
async function createLink(req, res) {
  try {
    const linkData = { ...req.body, tenantId: req.apiClient.tenantId, tenantName: req.apiClient.tenantName,
      createdBy: req.apiClient.name || req.apiClient.keyId, apiKeyId: req.apiClient.keyId };
    const link = await LinkService.createShortLink(linkData);
    res.status(201).json({ success: true, link, message: `Short link created: ${link.shortUrl}` });
  } catch (error) {
    console.error('[PublicAPI] Create link error:', error);
    if (error.code === 'ALREADY_EXISTS') return res.status(409).json({ success: false, error: error.message, existing: error.existing });
    res.status(400).json({ success: false, error: error.message || 'Failed to create link' });
  }
}

// ─── List ──────────────────────────────────────────────
async function listLinks(req, res) {
  try {
    const { enabled, limit, offset } = req.query;
    const filters = { tenantId: req.apiClient.tenantId, enabled: enabled !== undefined ? enabled === 'true' : undefined, limit: limit ? parseInt(limit, 10) : 100 };
    const result = await LinkService.listLinks(filters);
    res.json({ success: true, ...result, tenant: { id: req.apiClient.tenantId, name: req.apiClient.tenantName },
      pagination: { limit: filters.limit, offset: offset ? parseInt(offset, 10) : 0 } });
  } catch (error) {
    console.error('[PublicAPI] List links error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch links' });
  }
}

// ─── Get ───────────────────────────────────────────────
async function getLink(req, res) {
  try {
    const link = await verifyTenant(req.params.code, req.apiClient.tenantId, res);
    if (!link) return;
    res.json({ success: true, link });
  } catch (error) {
    console.error('[PublicAPI] Get link error:', error);
    if (error.code === 'NOT_FOUND') return res.status(404).json({ success: false, error: 'Link not found' });
    res.status(500).json({ success: false, error: 'Failed to fetch link' });
  }
}

// ─── Update ────────────────────────────────────────────
async function updateLink(req, res) {
  try {
    const existing = await verifyTenant(req.params.code, req.apiClient.tenantId, res);
    if (!existing) return;
    const link = await LinkService.updateShortLink(req.params.code, req.body);
    res.json({ success: true, link });
  } catch (error) {
    console.error('[PublicAPI] Update link error:', error);
    if (error.code === 'NOT_FOUND') return res.status(404).json({ success: false, error: 'Link not found' });
    res.status(500).json({ success: false, error: 'Failed to update link' });
  }
}

// ─── Delete ────────────────────────────────────────────
async function deleteLink(req, res) {
  try {
    const existing = await verifyTenant(req.params.code, req.apiClient.tenantId, res);
    if (!existing) return;
    const result = await LinkService.deleteShortLink(req.params.code);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[PublicAPI] Delete link error:', error);
    if (error.code === 'NOT_FOUND') return res.status(404).json({ success: false, error: 'Link not found' });
    res.status(500).json({ success: false, error: 'Failed to delete link' });
  }
}

// ─── Stats ─────────────────────────────────────────────
async function getStats(req, res) {
  try {
    const link = await verifyTenant(req.params.code, req.apiClient.tenantId, res);
    if (!link) return;
    const { startDate, endDate } = req.query;
    const options = {};
    if (startDate) options.startDate = new Date(startDate);
    if (endDate) options.endDate = new Date(endDate);
    const analytics = await getLinkAnalytics(req.params.code, options);
    res.json({ success: true, analytics });
  } catch (error) {
    console.error('[PublicAPI] Get stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
}

// ─── Attribution ───────────────────────────────────────
async function getAttribution(req, res) {
  try {
    const link = await verifyTenant(req.params.code, req.apiClient.tenantId, res);
    if (!link) return;
    const stats = await getAttributionStats(req.params.code);
    res.json({ success: true, attribution: stats });
  } catch (error) {
    console.error('[PublicAPI] Get attribution error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch attribution stats' });
  }
}

// ─── Batch Create ──────────────────────────────────────
async function batchCreate(req, res) {
  try {
    const { links } = req.body;
    if (!Array.isArray(links) || links.length === 0) return res.status(400).json({ success: false, error: 'links array is required' });
    if (links.length > 100) return res.status(400).json({ success: false, error: 'Maximum 100 links per batch' });

    const results = [], errors = [];
    for (const linkData of links) {
      try {
        const link = await LinkService.createShortLink({ ...linkData, tenantId: req.apiClient.tenantId,
          tenantName: req.apiClient.tenantName, createdBy: req.apiClient.name || req.apiClient.keyId, apiKeyId: req.apiClient.keyId });
        results.push({ success: true, link });
      } catch (error) { errors.push({ success: false, error: error.message, linkData }); }
    }
    res.json({ success: true, created: results.length, failed: errors.length, results, errors });
  } catch (error) {
    console.error('[PublicAPI] Batch create error:', error);
    res.status(500).json({ success: false, error: 'Batch create failed' });
  }
}

// ─── Health ────────────────────────────────────────────
function health(req, res) {
  res.json({ success: true, service: 'Smart Links Public API v5.0', status: 'healthy', timestamp: new Date().toISOString() });
}

module.exports = { createLink, listLinks, getLink, updateLink, deleteLink, getStats, getAttribution, batchCreate, health };
