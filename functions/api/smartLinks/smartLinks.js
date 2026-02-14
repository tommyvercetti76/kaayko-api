/**
 * Smart Links API v4 — Orchestrator
 * 
 * Thin router: mounts tenant sub-router, then core CRUD + analytics.
 * Route order matters — named routes BEFORE /:code catch-all.
 * 
 * Sub-routers:
 * - tenantRoutes.js → /tenant-registration, /tenants, /admin/migrate
 * 
 * Core routes (this file):
 * - GET    /health, /stats, /r/:code
 * - POST   / (create), GET / (list)
 * - GET    /:code, PUT /:code, DELETE /:code
 * - POST   /events/:type
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const db = admin.firestore();

// Services & utilities
const { handleRedirect } = require('./redirectHandler');
const LinkService = require('./smartLinkService');
const { requireAuth, requireAdmin } = require('../../middleware/authMiddleware');
const { sendLinkCreatedNotification } = require('../../services/emailNotificationService');
const { triggerWebhooks, EVENT_TYPES } = require('./webhookService');
const { botProtection, secureHeaders, honeypot } = require('../../middleware/securityMiddleware');

// Global security middleware
router.use(secureHeaders);
router.use(botProtection);

// Honeypot traps (must be before sub-routers)
router.get('/admin/api-key', honeypot);
router.post('/admin/bulk-import', honeypot);
router.get('/export-all-data', honeypot);

// ============================================================================
// MOUNT SUB-ROUTERS (before /:code catch-all)
// ============================================================================
router.use('/', require('./tenantRoutes'));

// ============================================================================
// HEALTH CHECK
// ============================================================================

router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'Smart Links API v4 - Short Codes Only',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// LINK STATISTICS (Must be BEFORE /:code)
// ============================================================================

router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await LinkService.getLinkStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('[SmartLinks] Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

// ============================================================================
// REDIRECT ROUTE (Must be BEFORE /:code)
// ============================================================================

/**
 * Redirect handler for short codes (lk1ngp, lk9xrf, etc.)
 */
router.get('/r/:code', async (req, res) => {
  const code = req.params.code;
  await handleRedirect(req, res, code, { trackAnalytics: false });
});

// ============================================================================
// CREATE SHORT LINK (Protected - Requires Authentication)
// ============================================================================

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Add creator info with default tenant values (backward compatibility)
    const linkData = {
      ...req.body,
      createdBy: req.user.email || req.user.uid,
      tenantId: 'kaayko-default',
      tenantName: 'Kaayko',
      domain: req.body.domain || 'kaayko.com',
      pathPrefix: req.body.pathPrefix || '/l'
    };
    
    const link = await LinkService.createShortLink(linkData);
    
    // Send email notification to admin (async, don't block response)
    sendLinkCreatedNotification(link, req.user).then(result => {
      if (result.success) {
        console.log('✅ Email notification sent:', result.messageId);
      } else {
        console.error('⚠️ Email notification failed:', result.error);
      }
    }).catch(err => {
      console.error('⚠️ Email notification error:', err);
    });

    // Trigger webhooks (async, don't block response)
    triggerWebhooks({
      tenantId: 'kaayko-default',
      eventType: EVENT_TYPES.LINK_CREATED,
      payload: {
        event: 'link.created',
        link: {
          code: link.code,
          shortUrl: link.shortUrl,
          title: link.title,
          destinations: link.destinations,
          createdBy: link.createdBy,
          createdAt: link.createdAt
        },
        timestamp: new Date().toISOString()
      }
    }).catch(err => {
      console.error('⚠️ Webhook trigger error:', err);
    });
    
    res.json({ 
      success: true, 
      link,
      message: `Short link created: ${link.shortUrl}`
    });
  } catch (error) {
    console.error('[SmartLinks] Error creating short link:', error);
    
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

// ============================================================================
// LIST ALL LINKS (Protected - Requires Admin Role)
// ============================================================================

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, limit } = req.query;
    
    // Build filters without tenant scoping for now (backward compatibility)
    // TODO: Re-enable tenant scoping after migration runs
    const filters = {};
    if (enabled !== undefined) filters.enabled = enabled === 'true';
    if (limit) filters.limit = parseInt(limit, 10);
    
    const result = await LinkService.listLinks(filters);
    res.json({ 
      success: true, 
      ...result
    });
  } catch (error) {
    console.error('[SmartLinks] Error listing links:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch links',
      message: error.message
    });
  }
});

// ============================================================================
// GET LINK BY CODE (Must be AFTER specific routes like /health, /stats, /r/:code)
// ============================================================================

router.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const link = await LinkService.getShortLink(code);
    res.json({ success: true, link });
  } catch (error) {
    console.error('[SmartLinks] Error fetching link:', error);
    
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'Short code not found'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch link'
    });
  }
});

// ============================================================================
// UPDATE LINK (Protected - Requires Admin Role)
// ============================================================================

router.put('/:code', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const updates = req.body;
    
    const link = await LinkService.updateShortLink(code, updates);
    res.json({ success: true, link });
  } catch (error) {
    console.error('[SmartLinks] Error updating link:', error);
    
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

// ============================================================================
// DELETE LINK (Protected - Requires Admin)
// ============================================================================

router.delete('/:code', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const result = await LinkService.deleteShortLink(code);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[SmartLinks] Error deleting link:', error);
    
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

// ============================================================================
// TRACK EVENTS (Install, Open, etc.)
// ============================================================================

router.post('/events/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { linkId, userId, platform, metadata = {} } = req.body;

    if (!linkId) {
      return res.status(400).json({
        success: false,
        error: 'linkId is required'
      });
    }

    // Track event in analytics collection
    const eventData = {
      type,
      linkId,
      userId: userId || null,
      platform: platform || 'unknown',
      metadata,
      timestamp: FieldValue.serverTimestamp()
    };

    await db.collection('link_analytics').add(eventData);

    // Update link stats if it's an install event
    if (type === 'install') {
      const linkRef = db.collection('short_links').doc(linkId);
      const linkDoc = await linkRef.get();
      
      if (linkDoc.exists) {
        await linkRef.update({
          installCount: FieldValue.increment(1)
        });
      }
    }

    res.json({ 
      success: true, 
      message: `${type} event tracked` 
    });

  } catch (error) {
    console.error('[SmartLinks] Error tracking event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track event'
    });
  }
});

module.exports = router;
