/**
 * functions/src/api/smartLinks.js
 * 
 * Smart Links API v2 - Link Management & Analytics
 * REFACTORED: Now uses modular service layer
 * 
 * Endpoints:
 * - GET    /api/smartlinks/r/:code    → Redirect handler
 * - POST   /api/smartlinks             → Create structured link
 * - POST   /api/smartlinks/short       → Create short code link
 * - GET    /api/smartlinks             → List all links
 * - GET    /api/smartlinks/:space/:id  → Get structured link
 * - PUT    /api/smartlinks/short/:code → Update short code link
 * - PUT    /api/smartlinks/:space/:id  → Update structured link
 * - DELETE /api/smartlinks/short/:code → Delete short code link
 * - DELETE /api/smartlinks/:space/:id  → Delete structured link
 * - POST   /api/smartlinks/events/:type → Track events
 * - GET    /api/smartlinks/stats       → Link analytics
 * - GET    /api/smartlinks/health      → Health check
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const db = admin.firestore();

// Import modular utilities and services (all in same folder now)
const { handleRedirect } = require('./redirectHandler');
const { normalizeUTMs, getValidSpaces } = require('./smartLinkValidation');
const LinkService = require('./smartLinkService');

// ============================================================================
// REDIRECT ROUTE
// ============================================================================

/**
 * Universal redirect handler
 * Handles both short codes (lk1ngp) and structured links (lake/trinity)
 */
router.get('/r/:code(*)', async (req, res) => {
  const linkId = req.params.code;
  await handleRedirect(req, res, linkId, { trackAnalytics: false });
});

// ============================================================================
// CREATE STRUCTURED LINK
// ============================================================================

router.post('/', async (req, res) => {
  try {
    const link = await LinkService.createStructuredLink(req.body);
    res.json({ success: true, link });
  } catch (error) {
    console.error('[SmartLinks] Error creating structured link:', error);
    
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
// CREATE SHORT CODE LINK
// ============================================================================

router.post('/short', async (req, res) => {
  try {
    const link = await LinkService.createShortCodeLink(req.body);
    res.json({ success: true, link });
  } catch (error) {
    console.error('[SmartLinks] Error creating short code link:', error);
    
    if (error.code === 'ALREADY_EXISTS') {
      return res.status(409).json({
        success: false,
        error: error.message,
        existing: error.existing
      });
    }
    
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to create short link'
    });
  }
});

// ============================================================================
// LIST ALL LINKS
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const { space, enabled, limit } = req.query;
    
    const filters = {};
    if (space) filters.space = space;
    if (enabled !== undefined) filters.enabled = enabled === 'true';
    if (limit) filters.limit = parseInt(limit, 10);
    
    const links = await LinkService.listLinks(filters);
    res.json({ success: true, ...links });
  } catch (error) {
    console.error('[SmartLinks] Error listing links:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch links'
    });
  }
});

// ============================================================================
// GET STRUCTURED LINK
// ============================================================================

router.get('/:space/:id', async (req, res) => {
  try {
    const { space, id } = req.params;
    const link = await LinkService.getStructuredLink(space, id);
    res.json({ success: true, link });
  } catch (error) {
    console.error('[SmartLinks] Error fetching link:', error);
    
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

// ============================================================================
// UPDATE SHORT CODE LINK
// ============================================================================

router.put('/short/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const updates = req.body;
    
    const link = await LinkService.updateShortCodeLink(code, updates);
    res.json({ success: true, link });
  } catch (error) {
    console.error('[SmartLinks] Error updating short link:', error);
    
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'Short code not found'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to update link'
    });
  }
});

// ============================================================================
// UPDATE STRUCTURED LINK
// ============================================================================

router.put('/:space/:id', async (req, res) => {
  try {
    const { space, id } = req.params;
    const updates = req.body;
    
    const link = await LinkService.updateStructuredLink(space, id, updates);
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
// DELETE SHORT CODE LINK
// ============================================================================

router.delete('/short/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const result = await LinkService.deleteShortCodeLink(code);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[SmartLinks] Error deleting short link:', error);
    
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'Short code not found'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to delete link'
    });
  }
});

// ============================================================================
// DELETE STRUCTURED LINK
// ============================================================================

router.delete('/:space/:id', async (req, res) => {
  try {
    const { space, id } = req.params;
    const result = await LinkService.deleteStructuredLink(space, id);
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
      // Try short link first
      const shortLinkRef = db.collection('short_links').doc(linkId);
      const shortLinkDoc = await shortLinkRef.get();
      
      if (shortLinkDoc.exists) {
        await shortLinkRef.update({
          installCount: FieldValue.increment(1)
        });
      } else {
        // Try structured link
        const structuredSnapshot = await db.collection('smart_links')
          .where('linkId', '==', linkId)
          .limit(1)
          .get();
        
        if (!structuredSnapshot.empty) {
          await structuredSnapshot.docs[0].ref.update({
            installCount: FieldValue.increment(1)
          });
        }
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

// ============================================================================
// LINK STATISTICS
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
// HEALTH CHECK
// ============================================================================

router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'Smart Links API v2',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    validSpaces: getValidSpaces()
  });
});

module.exports = router;
