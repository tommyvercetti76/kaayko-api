const express = require('express');
const admin = require('firebase-admin');
const { requireAuth } = require('../../middleware/authMiddleware');
const { getTenantFromRequest, DEFAULT_TENANT_ID } = require('../smartLinks/tenantContext');
const campaignService = require('./campaignService');
const campaignLinkService = require('./campaignLinkService');
const { isTenantAdmin, loadCampaign, requireCampaignPermission } = require('./campaignPermissions');

const router = express.Router();
const db = admin.firestore();

router.get('/health', (_req, res) => {
  res.json({
    success: true,
    service: 'KORTEX Campaigns API',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

router.use(requireAuth);

router.post('/', async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    if (!isTenantAdmin(req.user)) {
      return forbidden(res, 'Tenant admin role required to create campaigns', 'INSUFFICIENT_PERMISSIONS');
    }

    const tenant = await getTenantConfig(tenantContext.tenantId);
    const campaign = await campaignService.createCampaign({
      tenant,
      actor: req.user,
      data: req.body
    });
    res.status(201).json({ success: true, campaign });
  } catch (error) {
    handleError(res, error, 'Failed to create campaign');
  }
});

router.get('/', async (req, res) => {
  try {
    const tenantContext = await getTenantFromRequest(req);
    if (!isTenantAdmin(req.user)) {
      return forbidden(res, 'Tenant admin role required to list campaigns', 'INSUFFICIENT_PERMISSIONS');
    }

    const campaigns = await campaignService.listCampaigns({
      tenantId: tenantContext.tenantId,
      includeArchived: req.query.includeArchived === 'true',
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 100
    });

    res.json({
      success: true,
      tenant: { id: tenantContext.tenantId, name: tenantContext.tenantName },
      campaigns
    });
  } catch (error) {
    handleError(res, error, 'Failed to list campaigns');
  }
});

router.get('/:campaignId', async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.campaignId);
    await requireCampaignPermission(req.user, campaign, 'campaign:read');
    res.json({ success: true, campaign });
  } catch (error) {
    handleError(res, error, 'Failed to fetch campaign');
  }
});

router.put('/:campaignId', async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.campaignId);
    await requireCampaignPermission(req.user, campaign, 'campaign:update');
    const updated = await campaignService.updateCampaign({ campaign, actor: req.user, updates: req.body });
    res.json({ success: true, campaign: updated });
  } catch (error) {
    handleError(res, error, 'Failed to update campaign');
  }
});

router.post('/:campaignId/pause', async (req, res) => setLifecycleStatus(req, res, 'paused'));
router.post('/:campaignId/resume', async (req, res) => setLifecycleStatus(req, res, 'active'));
router.post('/:campaignId/archive', async (req, res) => setLifecycleStatus(req, res, 'archived'));

router.get('/:campaignId/members', async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.campaignId);
    await requireCampaignPermission(req.user, campaign, 'members:manage');
    const members = await campaignService.listMembers(campaign.campaignId || campaign.id);
    res.json({ success: true, members });
  } catch (error) {
    handleError(res, error, 'Failed to list campaign members');
  }
});

router.post('/:campaignId/members', async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.campaignId);
    await requireCampaignPermission(req.user, campaign, 'members:manage');
    const uid = String(req.body.uid || '').trim();
    if (!uid) {
      return res.status(400).json({ success: false, error: 'uid is required', code: 'VALIDATION_ERROR' });
    }
    const member = await campaignService.upsertMember({
      tenantId: campaign.tenantId || DEFAULT_TENANT_ID,
      campaignId: campaign.campaignId || campaign.id,
      uid,
      role: req.body.role,
      actor: req.user
    });
    res.json({ success: true, member });
  } catch (error) {
    handleError(res, error, 'Failed to add campaign member');
  }
});

router.delete('/:campaignId/members/:uid', async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.campaignId);
    await requireCampaignPermission(req.user, campaign, 'members:manage');
    const removed = await campaignService.removeMember({ campaign, uid: req.params.uid, actor: req.user });
    res.json({ success: true, removed });
  } catch (error) {
    handleError(res, error, 'Failed to remove campaign member');
  }
});

// ─── Campaign Link Management (Phase 2) ──────────────────────────────────────

/**
 * POST /campaigns/:campaignId/links
 * Create a new link inside a campaign.
 * Mirrors into short_links for redirect compatibility.
 * Requires: links:create permission
 */
router.post('/:campaignId/links', async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.campaignId);
    await requireCampaignPermission(req.user, campaign, 'links:create');
    const link = await campaignLinkService.createCampaignLink({
      campaign,
      actor: req.user,
      data: req.body
    });
    res.status(201).json({ success: true, link });
  } catch (error) {
    handleError(res, error, 'Failed to create campaign link');
  }
});

/**
 * GET /campaigns/:campaignId/links
 * List all links for a campaign.
 * Requires: campaign:read permission
 */
router.get('/:campaignId/links', async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.campaignId);
    await requireCampaignPermission(req.user, campaign, 'campaign:read');
    const campaignId = campaign.campaignId || campaign.id;
    const links = await campaignLinkService.listCampaignLinks({
      campaignId,
      tenantId: campaign.tenantId,
      includeInactive: req.query.includeInactive === 'true',
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 200
    });
    res.json({ success: true, campaignId, links });
  } catch (error) {
    handleError(res, error, 'Failed to list campaign links');
  }
});

/**
 * GET /campaigns/:campaignId/links/:code
 * Get a single campaign link.
 * Requires: campaign:read permission
 */
router.get('/:campaignId/links/:code', async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.campaignId);
    await requireCampaignPermission(req.user, campaign, 'campaign:read');
    const link = await campaignLinkService.getCampaignLink({
      campaignId: campaign.campaignId || campaign.id,
      code: req.params.code
    });
    res.json({ success: true, link });
  } catch (error) {
    handleError(res, error, 'Failed to get campaign link');
  }
});

/**
 * PUT /campaigns/:campaignId/links/:code
 * Update a campaign link (destinations, UTM, metadata, title).
 * Syncs the short_links mirror.
 * Requires: links:update permission
 */
router.put('/:campaignId/links/:code', async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.campaignId);
    await requireCampaignPermission(req.user, campaign, 'links:update');
    const link = await campaignLinkService.getCampaignLink({
      campaignId: campaign.campaignId || campaign.id,
      code: req.params.code
    });
    const updated = await campaignLinkService.updateCampaignLink({
      campaign,
      link,
      actor: req.user,
      data: req.body
    });
    res.json({ success: true, link: updated });
  } catch (error) {
    handleError(res, error, 'Failed to update campaign link');
  }
});

/**
 * POST /campaigns/:campaignId/links/:code/pause
 * Pause a single campaign link (disables short_links mirror).
 * Requires: campaign:pause permission
 */
router.post('/:campaignId/links/:code/pause', async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.campaignId);
    await requireCampaignPermission(req.user, campaign, 'campaign:pause');
    const link = await campaignLinkService.getCampaignLink({
      campaignId: campaign.campaignId || campaign.id,
      code: req.params.code
    });
    const updated = await campaignLinkService.pauseCampaignLink({ campaign, link, actor: req.user });
    res.json({ success: true, link: updated });
  } catch (error) {
    handleError(res, error, 'Failed to pause campaign link');
  }
});

/**
 * POST /campaigns/:campaignId/links/:code/resume
 * Resume a paused campaign link (re-enables short_links mirror).
 * Requires: campaign:pause permission
 */
router.post('/:campaignId/links/:code/resume', async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.campaignId);
    await requireCampaignPermission(req.user, campaign, 'campaign:pause');
    const link = await campaignLinkService.getCampaignLink({
      campaignId: campaign.campaignId || campaign.id,
      code: req.params.code
    });
    const updated = await campaignLinkService.resumeCampaignLink({ campaign, link, actor: req.user });
    res.json({ success: true, link: updated });
  } catch (error) {
    handleError(res, error, 'Failed to resume campaign link');
  }
});

/**
 * DELETE /campaigns/:campaignId/links/:code
 * Delete a campaign link. Immediately removes the short_links mirror.
 * The campaign_links record is soft-deleted to preserve the audit trail.
 * Requires: links:update permission
 */
router.delete('/:campaignId/links/:code', async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.campaignId);
    await requireCampaignPermission(req.user, campaign, 'links:update');
    const link = await campaignLinkService.getCampaignLink({
      campaignId: campaign.campaignId || campaign.id,
      code: req.params.code
    });
    const result = await campaignLinkService.deleteCampaignLink({ campaign, link, actor: req.user });
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(res, error, 'Failed to delete campaign link');
  }
});

async function setLifecycleStatus(req, res, status) {
  try {
    const campaign = await loadCampaign(req.params.campaignId);
    await requireCampaignPermission(req.user, campaign, status === 'archived' ? 'campaign:archive' : 'campaign:pause');
    const updated = await campaignService.setCampaignStatus({ campaign, actor: req.user, status });
    res.json({ success: true, campaign: updated });
  } catch (error) {
    handleError(res, error, `Failed to set campaign status to ${status}`);
  }
}

async function getTenantConfig(tenantId) {
  if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
    return { id: DEFAULT_TENANT_ID, name: 'Kaayko', domain: 'kaayko.com' };
  }

  const tenantDoc = await db.collection('tenants').doc(tenantId).get();
  if (!tenantDoc.exists) {
    const error = new Error(`Tenant not found: ${tenantId}`);
    error.code = 'TENANT_NOT_FOUND';
    throw error;
  }

  const tenant = tenantDoc.data();
  if (tenant.enabled === false) {
    const error = new Error(`Tenant disabled: ${tenantId}`);
    error.code = 'TENANT_DISABLED';
    throw error;
  }

  return {
    id: tenantDoc.id,
    name: tenant.name || tenantDoc.id,
    domain: tenant.domain || 'kaayko.com'
  };
}

function forbidden(res, message, code) {
  return res.status(403).json({
    success: false,
    error: 'Forbidden',
    message,
    code
  });
}

function handleError(res, error, fallback) {
  console.error('[Campaigns] Error:', error);
  if (error.code === 'NOT_FOUND') {
    return res.status(404).json({ success: false, error: 'Campaign not found', code: 'NOT_FOUND' });
  }
  if (error.code === 'ALREADY_EXISTS') {
    return res.status(409).json({ success: false, error: error.message, code: error.code });
  }
  if (error.code === 'VALIDATION_ERROR') {
    return res.status(400).json({ success: false, error: error.message, code: error.code, details: error.details || [] });
  }
  if (error.code === 'TENANT_ACCESS_DENIED' || error.message?.includes('Access denied')) {
    return res.status(403).json({ success: false, error: 'Tenant access denied', code: 'TENANT_ACCESS_DENIED', message: error.message });
  }
  if (error.code === 'INSUFFICIENT_CAMPAIGN_PERMISSIONS') {
    return res.status(403).json({ success: false, error: 'Forbidden', code: error.code, message: error.message });
  }
  if (error.code === 'TENANT_NOT_FOUND' || error.code === 'TENANT_DISABLED') {
    return res.status(403).json({ success: false, error: 'Tenant unavailable', code: error.code, message: error.message });
  }
  return res.status(500).json({ success: false, error: fallback, message: error.message });
}

module.exports = router;
