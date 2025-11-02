/**
 * functions/src/api/smartLinks.js
 * 
 * Smart Links API v4 - SHORT CODES ONLY!
 * Simple: kaayko.com/l/lkXXXX → anywhere you want
 * 
 * Endpoints (all under /api/smartlinks):
 * - GET    /api/smartlinks/r/:code         → Redirect handler (short codes only)
 * - POST   /api/smartlinks                  → Create short link
 * - GET    /api/smartlinks                  → List all links
 * - GET    /api/smartlinks/:code            → Get link by code
 * - PUT    /api/smartlinks/:code            → Update link
 * - DELETE /api/smartlinks/:code            → Delete link
 * - POST   /api/smartlinks/events/:type     → Track app events
 * - GET    /api/smartlinks/stats            → Link analytics
 * - GET    /api/smartlinks/health           → Health check
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const db = admin.firestore();

// Import modular utilities and services
const { handleRedirect } = require('./redirectHandler');
const LinkService = require('./smartLinkService');

// ============================================================================
// HEALTH CHECK (Must be BEFORE /:code to avoid being caught by it)
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

router.get('/stats', async (req, res) => {
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
// CREATE SHORT LINK
// ============================================================================

router.post('/', async (req, res) => {
  try {
    const link = await LinkService.createShortLink(req.body);
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
// LIST ALL LINKS
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const { enabled, limit } = req.query;
    
    const filters = {};
    if (enabled !== undefined) filters.enabled = enabled === 'true';
    if (limit) filters.limit = parseInt(limit, 10);
    
    const result = await LinkService.listLinks(filters);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[SmartLinks] Error listing links:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch links'
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
// UPDATE LINK
// ============================================================================

router.put('/:code', async (req, res) => {
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
// DELETE LINK
// ============================================================================

router.delete('/:code', async (req, res) => {
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
