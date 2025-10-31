/**
 * functions/src/api/smartLinks.js
 * 
 * Smart Links API v2 - Link Management & Analytics
 * 
 * Endpoints:
 * - POST   /api/smartlinks          → Create new smart link
 * - GET    /api/smartlinks/:id      → Get link details
 * - PUT    /api/smartlinks/:id      → Update link
 * - DELETE /api/smartlinks/:id      → Delete link
 * - GET    /api/smartlinks           → List user's links
 * - POST   /api/events/:type        → Track app events (install, open, etc.)
 * - GET    /api/stats                → Link analytics
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

const db = admin.firestore();

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Generate UUID v4
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Generate random short code (Branch-style)
 * Format: 6 alphanumeric characters (e.g., "aB3xYz")
 */
function generateShortCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Validate link ID format
 */
function isValidLinkId(id) {
  return /^[a-zA-Z0-9_-]{3,50}$/.test(id);
}

/**
 * Validate short code format
 */
function isValidShortCode(code) {
  return /^[a-zA-Z0-9]{3,12}$/.test(code);
}

/**
 * Validate space name
 */
function isValidSpace(space) {
  return ['lake', 'product', 'category', 'store', 'reads', 'spot', 'qr', 'promo', 'custom'].includes(space);
}

/**
 * Get app store URLs
 */
function getAppStoreURLs() {
  return {
    ios: process.env.IOS_APP_STORE_URL || 'https://apps.apple.com/app/kaayko/id6738596808',
    android: process.env.ANDROID_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.kaayko.app'
  };
}

/**
 * Normalize UTM parameters
 */
function normalizeUTMs(query) {
  const UTM_WHITELIST = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  const normalized = {};
  
  for (const key of UTM_WHITELIST) {
    if (query[key]) {
      normalized[key] = String(query[key]).toLowerCase().slice(0, 100);
    }
  }
  
  return normalized;
}

/**
 * Auto-enrich metadata from Firestore collections
 */
async function enrichMetadata(space, linkId) {
  try {
    switch (space) {
      case 'lake': {
        // Fetch from paddlingOutSpots collection
        const lakeDoc = await db.collection('paddlingOutSpots').doc(linkId).get();
        if (!lakeDoc.exists) return null;
        
        const data = lakeDoc.data();
        return {
          title: data.title || `${linkId} - Paddle Conditions`,
          description: data.subtitle || 'Real-time paddle forecast with ML predictions',
          imageUrl: (data.imgSrc && data.imgSrc[0]) || null,
          type: 'paddling_location',
          customFields: {
            hasParking: data.hasParking || false,
            hasRestrooms: data.hasRestrooms || false,
            youtubeLink: data.youtubeLink || null
          },
          enriched: true
        };
      }
      
      case 'product': {
        // Fetch from kaaykoproducts collection
        const productDoc = await db.collection('kaaykoproducts').doc(linkId).get();
        if (!productDoc.exists) {
          // Try by productID field
          const snapshot = await db.collection('kaaykoproducts')
            .where('productID', '==', linkId)
            .limit(1)
            .get();
          
          if (snapshot.empty) return null;
          
          const data = snapshot.docs[0].data();
          return {
            title: `${data.title || linkId} - $${data.price || '??'}`,
            description: data.description || 'Unique Kaayko apparel - Vote now, pay later',
            imageUrl: (data.imgSrc && data.imgSrc[0]) || null,
            price: data.price ? `$${data.price}` : null,
            votes: data.votes || 0,
            type: 'store_product',
            enriched: true
          };
        }
        
        const data = productDoc.data();
        return {
          title: `${data.title || linkId} - $${data.price || '??'}`,
          description: data.description || 'Unique Kaayko apparel',
          imageUrl: (data.imgSrc && data.imgSrc[0]) || null,
          price: data.price ? `$${data.price}` : null,
          votes: data.votes || 0,
          type: 'store_product',
          enriched: true
        };
      }
      
      case 'category': {
        // Query products with matching tag
        const snapshot = await db.collection('kaaykoproducts')
          .where('tags', 'array-contains', linkId)
          .limit(50)
          .get();
        
        if (snapshot.empty) return null;
        
        const products = snapshot.docs.map(d => d.data());
        const productCount = products.length;
        const prices = products.map(p => parseFloat(p.price || 0)).filter(p => p > 0);
        const minPrice = prices.length > 0 ? Math.min(...prices) : null;
        
        return {
          title: `${linkId.charAt(0).toUpperCase() + linkId.slice(1)} Collection`,
          description: `${productCount} unique designs${minPrice ? ` starting at $${minPrice}` : ''}`,
          imageUrl: (products[0]?.imgSrc && products[0].imgSrc[0]) || null,
          productCount,
          type: 'product_category',
          enriched: true
        };
      }
      
      case 'store': {
        // Store homepage - get total product count
        const snapshot = await db.collection('kaaykoproducts').count().get();
        const productCount = snapshot.data().count;
        
        return {
          title: 'Kaayko Store - Vote Now, Pay Later',
          description: `${productCount} unique designs. Sarcastic T-shirts & paddling apparel.`,
          imageUrl: 'https://kaayko.com/assets/store-hero.jpg',
          productCount,
          type: 'store_catalog',
          enriched: true
        };
      }
      
      case 'reads': {
        // Future: Fetch from blog posts collection
        return {
          title: 'Kaayko Reads - Paddling Stories',
          description: 'Adventures, tips, and insights from the paddling community',
          imageUrl: 'https://kaayko.com/assets/blog-hero.jpg',
          type: 'blog_article',
          enriched: false  // Not implemented yet
        };
      }
      
      default:
        return null;
    }
  } catch (error) {
    console.error(`Error enriching metadata for ${space}/${linkId}:`, error);
    return null;
  }
}

// Import shared redirect handler
const { handleRedirect } = require('../utils/redirectHandler');

// ============================================================================
// REDIRECT SHORT LINKS (must be BEFORE other routes)
// ============================================================================

/**
 * GET /api/smartlinks/r/:code
 * Redirect short code links to their destinations
 * Supports both short codes (lk1ngp) and structured links (lake/trinity)
 */
router.get('/r/:code(*)', async (req, res) => {
  const code = req.params.code || req.params[0];
  return handleRedirect(req, res, code, { trackAnalytics: true });
});

// ============================================================================
// CREATE SMART LINK
// ============================================================================

/**
 * POST /api/smartlinks
 * Create a new smart link with auto-enrichment support
 */
router.post('/', async (req, res) => {
  try {
    const {
      space,
      linkId,
      iosDestination,
      androidDestination,
      webDestination,
      metadata = {},
      utm = {},
      autoEnrich = false,
      bypassSecretCheck = false,
      createdBy = 'system'  // NEW: Track who created the link
    } = req.body;

    // Validation
    if (!space || !isValidSpace(space)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid space',
        validSpaces: ['lake', 'product', 'category', 'store', 'reads', 'spot', 'qr', 'promo', 'custom']
      });
    }

    if (!linkId || !isValidLinkId(linkId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid link ID',
        details: 'ID must be 3-50 alphanumeric characters, dashes, or underscores'
      });
    }

    // Check if link already exists  
    const linkKey = `${space}_${linkId}`;  // Use underscore instead of slash for Firestore doc ID
    const existingLink = await db.collection('smart_links').doc(linkKey).get();

    if (existingLink.exists) {
      return res.status(409).json({
        success: false,
        error: 'Link already exists',
        existing: {
          space,
          linkId,
          shortUrl: `https://kaayko.com/l/${space}/${linkId}`
        }
      });
    }

    // Auto-enrich metadata if requested
    let finalMetadata = metadata;
    if (autoEnrich) {
      const enriched = await enrichMetadata(space, linkId);
      if (enriched) {
        finalMetadata = { ...metadata, ...enriched };
      }
    }

    // Generate destinations with smart defaults
    const getDefaultDestinations = () => {
      const ctxParam = '?ctx={ctxId}';
      
      switch (space) {
        case 'lake':
          return {
            ios: iosDestination || `kaayko://paddlingOut?id=${linkId}`,
            android: androidDestination || `kaayko://paddlingOut?id=${linkId}`,
            web: webDestination || `https://kaayko.com/paddlingout.html?id=${linkId}`
          };
        
        case 'product':
          return {
            ios: iosDestination || `kaayko://store?productID=${linkId}`,
            android: androidDestination || `kaayko://store?productID=${linkId}`,
            web: webDestination || `https://kaayko.com/store.html?id=${linkId}`
          };
        
        case 'category':
          return {
            ios: iosDestination || `kaayko://store?category=${linkId}`,
            android: androidDestination || `kaayko://store?category=${linkId}`,
            web: webDestination || `https://kaayko.com/store.html?category=${linkId}`
          };
        
        case 'store':
          return {
            ios: iosDestination || `kaayko://store`,
            android: androidDestination || `kaayko://store`,
            web: webDestination || `https://kaayko.com/store.html`
          };
        
        case 'reads':
          return {
            ios: iosDestination || `kaayko://reads?articleId=${linkId}`,
            android: androidDestination || `kaayko://reads?articleId=${linkId}`,
            web: webDestination || `https://kaayko.com/reads.html?article=${linkId}`
          };
        
        default:
          return {
            ios: iosDestination || `kaayko://${space}/${linkId}`,
            android: androidDestination || `kaayko://${space}/${linkId}`,
            web: webDestination || `https://kaayko.com/${space}/${linkId}`
          };
      }
    };

    const destinations = getDefaultDestinations();

    // Create link document
    const linkDoc = {
      space,
      linkId,
      shortUrl: `https://kaayko.com/l/${space}/${linkId}`,
      qrCodeUrl: `https://kaayko.com/qr/${space}/${linkId}.png`,
      destinations,
      metadata: finalMetadata,
      utm,
      bypassSecretCheck,
      clickCount: 0,
      installCount: 0,
      uniqueUsers: [],
      enabled: true,  // NEW: Links are enabled by default
      createdBy,      // NEW: Track creator
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    // Save to Firestore
    await db.collection('smart_links').doc(linkKey).set(linkDoc);

    // Return success
    res.json({
      success: true,
      link: {
        space,
        linkId,
        shortUrl: `https://kaayko.com/l/${space}/${linkId}`,
        qrCodeUrl: `https://kaayko.com/qr/${space}/${linkId}.png`,
        iosUrl: `https://kaayko.com/${space}/${linkId}?platform=ios`,
        androidUrl: `https://kaayko.com/${space}/${linkId}?platform=android`,
        webUrl: `https://kaayko.com/${space}/${linkId}`,
        metadata: finalMetadata,
        clickCount: 0,
        createdAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error creating smart link:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create link',
      details: error.message
    });
  }
});

// ============================================================================
// CREATE SHORT CODE LINK (Branch-style)
// ============================================================================

/**
 * POST /api/smartlinks/short
 * Create a Branch-style arbitrary short code link
 * 
 * Example: kaayko.com/l/aB3xYz → goes to ANY URL you specify
 */
router.post('/short', async (req, res) => {
  try {
    const {
      shortCode,  // Optional: Custom short code (e.g., "lk3425"). If not provided, auto-generates.
      destinations,  // Required: { ios, android, web }
      metadata = {},
      utm = {},
      enabled = true,
      createdBy = 'system'
    } = req.body;

    // Validate destinations
    if (!destinations || (!destinations.ios && !destinations.android && !destinations.web)) {
      return res.status(400).json({
        success: false,
        error: 'At least one destination (ios, android, or web) is required'
      });
    }

    // Generate or validate short code
    let code = shortCode;
    if (!code) {
      // Auto-generate unique short code
      let attempts = 0;
      while (attempts < 10) {
        code = generateShortCode();
        const existing = await db.collection('short_links').doc(code).get();
        if (!existing.exists) break;
        attempts++;
      }
      
      if (attempts >= 10) {
        return res.status(500).json({
          success: false,
          error: 'Failed to generate unique short code. Please try again.'
        });
      }
    } else {
      // Validate custom short code
      if (!isValidShortCode(code)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid short code',
          details: 'Code must be 3-12 alphanumeric characters'
        });
      }

      // Check if already exists
      const existing = await db.collection('short_links').doc(code).get();
      if (existing.exists) {
        return res.status(409).json({
          success: false,
          error: 'Short code already exists',
          existing: {
            shortCode: code,
            shortUrl: `https://kaayko.com/l/${code}`
          }
        });
      }
    }

    // Create short link document
    const linkDoc = {
      shortCode: code,
      type: 'short',  // Distinguish from structured links
      shortUrl: `https://kaayko.com/l/${code}`,
      qrCodeUrl: `https://kaayko.com/qr/${code}.png`,
      destinations: {
        ios: destinations.ios || destinations.web,
        android: destinations.android || destinations.web,
        web: destinations.web || destinations.ios || destinations.android
      },
      metadata,
      utm,
      clickCount: 0,
      installCount: 0,
      uniqueUsers: [],
      enabled,
      createdBy,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    // Save to Firestore
    await db.collection('short_links').doc(code).set(linkDoc);

    // Return success
    res.json({
      success: true,
      link: {
        shortCode: code,
        shortUrl: `https://kaayko.com/l/${code}`,
        qrCodeUrl: `https://kaayko.com/qr/${code}.png`,
        destinations: linkDoc.destinations,
        metadata,
        enabled,
        createdBy,
        clickCount: 0,
        createdAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error creating short code link:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create short link',
      details: error.message
    });
  }
});

// ============================================================================
// LIST ALL LINKS
// ============================================================================

/**
 * GET /api/smartlinks
 * List all links from both structured and short code collections
 * Query params:
 *   - limit: number of results per page (default 50, max 200)
 *   - offset: number of results to skip (for pagination)
 *   - enabled: filter by enabled status (true/false)
 *   - type: filter by type ('structured' or 'short')
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const enabledFilter = req.query.enabled === 'true' ? true : req.query.enabled === 'false' ? false : null;
    const typeFilter = req.query.type; // 'structured' or 'short'

    const allLinks = [];

    // Fetch structured links from smart_links collection (unless filtered to short only)
    if (typeFilter !== 'short') {
      let structuredQuery = db.collection('smart_links');
      
      if (enabledFilter !== null) {
        structuredQuery = structuredQuery.where('enabled', '==', enabledFilter);
      }
      
      const structuredSnapshot = await structuredQuery.get();
      
      structuredSnapshot.forEach(doc => {
        const data = doc.data();
        allLinks.push({
          id: doc.id,
          type: 'structured',
          ...data,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
        });
      });
    }

    // Fetch short code links from short_links collection (unless filtered to structured only)
    if (typeFilter !== 'structured') {
      let shortQuery = db.collection('short_links');
      
      if (enabledFilter !== null) {
        shortQuery = shortQuery.where('enabled', '==', enabledFilter);
      }
      
      const shortSnapshot = await shortQuery.get();
      
      shortSnapshot.forEach(doc => {
        const data = doc.data();
        allLinks.push({
          id: doc.id,
          type: 'short',
          code: doc.id, // Add code field for convenience
          ...data,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
        });
      });
    }

    // Sort by creation date (newest first)
    allLinks.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
      const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
      return dateB - dateA;
    });

    // Apply pagination
    const totalLinks = allLinks.length;
    const paginatedLinks = allLinks.slice(offset, offset + limit);

    res.json({
      success: true,
      links: paginatedLinks,
      pagination: {
        total: totalLinks,
        limit: limit,
        offset: offset,
        hasMore: offset + limit < totalLinks
      }
    });

  } catch (error) {
    console.error('Error listing links:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list links',
      details: error.message
    });
  }
});

// ============================================================================
// GET LINK DETAILS
// ============================================================================

/**
 * GET /api/smartlinks/:space/:id
 * Get link details
 */
router.get('/:space/:id', async (req, res) => {
  try {
    const { space, id } = req.params;

    if (!isValidSpace(space)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid space'
      });
    }

    const linkDoc = await db.collection('smart_links').doc(`${space}_${id}`).get();

    if (!linkDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Link not found'
      });
    }

    const link = linkDoc.data();

    res.json({
      success: true,
      link: {
        ...link,
        shortURL: `https://kaayko.com/l/${space}/${id}`,
        qrCodeURL: `https://kaayko.com/l/qr/${space}/${id}.png`
      }
    });

  } catch (error) {
    console.error('Error fetching link:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch link',
      details: error.message
    });
  }
});

// ============================================================================
// UPDATE LINK (Enable/Disable, Edit Metadata)
// ============================================================================

/**
 * PUT /api/smartlinks/short/:code
 * Update short code link (MUST come before /:space/:id to avoid route conflict)
 */
router.put('/short/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { enabled, metadata, destinations, utm } = req.body;

    const linkRef = db.collection('short_links').doc(code);
    const linkDoc = await linkRef.get();

    if (!linkDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Short link not found'
      });
    }

    // Build update object
    const updates = {
      updatedAt: FieldValue.serverTimestamp()
    };

    if (enabled !== undefined) updates.enabled = enabled;
    if (metadata) updates.metadata = metadata;
    if (destinations) updates.destinations = destinations;
    if (utm) updates.utm = utm;

    await linkRef.update(updates);

    const updated = await linkRef.get();
    
    res.json({
      success: true,
      link: updated.data(),
      message: 'Short link updated successfully'
    });

  } catch (error) {
    console.error('Error updating short link:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update short link',
      details: error.message
    });
  }
});

/**
 * PUT /api/smartlinks/:space/:id
 * Update link properties (enable/disable, metadata, destinations)
 */
router.put('/:space/:id', async (req, res) => {
  try {
    const { space, id } = req.params;
    const { enabled, metadata, destinations, utm } = req.body;

    if (!isValidSpace(space)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid space'
      });
    }

    const linkRef = db.collection('smart_links').doc(`${space}_${id}`);
    const linkDoc = await linkRef.get();

    if (!linkDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Link not found'
      });
    }

    // Build update object
    const updates = {
      updatedAt: FieldValue.serverTimestamp()
    };

    if (enabled !== undefined) updates.enabled = enabled;
    if (metadata) updates.metadata = metadata;
    if (destinations) updates.destinations = destinations;
    if (utm) updates.utm = utm;

    await linkRef.update(updates);

    const updated = await linkRef.get();
    
    res.json({
      success: true,
      link: updated.data(),
      message: 'Link updated successfully'
    });

  } catch (error) {
    console.error('Error updating link:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update link',
      details: error.message
    });
  }
});

// ============================================================================
// DELETE LINK
// ============================================================================

/**
 * DELETE /api/smartlinks/short/:code
 * Delete a short link (MUST come before /:space/:id to avoid route conflict)
 */
router.delete('/short/:code', async (req, res) => {
  try {
    const { code } = req.params;

    const linkRef = db.collection('short_links').doc(code);
    const linkDoc = await linkRef.get();

    if (!linkDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Short link not found'
      });
    }

    await linkRef.delete();

    res.json({
      success: true,
      message: 'Short link deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting short link:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete short link',
      details: error.message
    });
  }
});

/**
 * DELETE /api/smartlinks/:space/:id
 * Delete a link
 */
router.delete('/:space/:id', async (req, res) => {
  try {
    const { space, id } = req.params;

    if (!isValidSpace(space)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid space'
      });
    }

    const linkRef = db.collection('smart_links').doc(`${space}_${id}`);
    const linkDoc = await linkRef.get();

    if (!linkDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Link not found'
      });
    }

    await linkRef.delete();

    res.json({
      success: true,
      message: 'Link deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting link:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete link',
      details: error.message
    });
  }
});

// ============================================================================
// APP EVENT TRACKING
// ============================================================================

/**
 * POST /api/events/:type
 * Track app events (install, open, purchase, custom)
 */
router.post('/events/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const {
      installId,
      os,
      osVersion,
      deviceModel,
      ctxId,
      timestamp,
      payload = {}
    } = req.body;

    if (!installId || !os) {
      return res.status(400).json({
        success: false,
        error: 'installId and os are required'
      });
    }

    // For install events, check idempotency (1 install per device per 24h)
    if (type === 'install') {
      const today = new Date().toISOString().split('T')[0];
      const idempotencyKey = `${installId}_${today}`;

      const existing = await db.collection('app_events')
        .where('type', '==', 'install')
        .where('installId', '==', installId)
        .where('idempotencyKey', '==', idempotencyKey)
        .limit(1)
        .get();

      if (!existing.empty) {
        return res.json({
          success: true,
          duplicate: true,
          message: 'Install event already recorded today'
        });
      }
    }

    // Attribution matching
    let attribution = {
      matched: false,
      linkId: null,
      matchedVia: 'none'
    };

    if (ctxId) {
      // Try to match by context token
      const ctxDoc = await db.collection('ctx_tokens').doc(ctxId).get();

      if (ctxDoc.exists) {
        const ctx = ctxDoc.data();

        if (!ctx.claimed) {
          // Match found!
          await ctxDoc.ref.update({
            claimed: true,
            claimedBy: installId,
            claimedAt: FieldValue.serverTimestamp()
          });

          attribution = {
            matched: true,
            linkId: ctx.linkId,
            space: ctx.space,
            matchedVia: 'ctxId'
          };

          // Update link stats
          if (type === 'install') {
            await db.collection('smart_links').doc(`${ctx.space}_${ctx.linkId}`).update({
              'stats.totalInstalls': admin.firestore.FieldValue.increment(1),
              [`stats.${os.toLowerCase()}Installs`]: admin.firestore.FieldValue.increment(1)
            });
          }
        }
      }
    }

    // Save event
    const eventId = generateUUID();
    const eventDoc = {
      eventId,
      type,
      os,
      osVersion: osVersion || null,
      installId,
      deviceId: payload.deviceId || null,
      deviceModel: deviceModel || null,
      timestamp: new Date(timestamp || Date.now()),
      ctxId: ctxId || null,
      matchedLinkId: attribution.linkId,
      matchedVia: attribution.matchedVia,
      payload,
      createdAt: FieldValue.serverTimestamp()
    };

    if (type === 'install') {
      const today = new Date().toISOString().split('T')[0];
      eventDoc.idempotencyKey = `${installId}_${today}`;
    }

    await db.collection('app_events').add(eventDoc);

    res.json({
      success: true,
      eventId,
      attribution
    });

  } catch (error) {
    console.error('Error tracking event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track event',
      details: error.message
    });
  }
});

// ============================================================================
// LINK ANALYTICS
// ============================================================================

/**
 * GET /api/stats
 * Get link analytics
 */
router.get('/stats', async (req, res) => {
  try {
    const { linkId, space, range = '7d' } = req.query;

    if (!linkId || !space) {
      return res.status(400).json({
        success: false,
        error: 'linkId and space are required'
      });
    }

    // Parse range
    const rangeDays = parseInt(range.replace('d', '')) || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - rangeDays);

    // Get link document for current stats
    const linkDoc = await db.collection('smart_links').doc(`${space}_${linkId}`).get();

    if (!linkDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Link not found'
      });
    }

    const link = linkDoc.data();

    // Get click data from last N days
    const clicksSnapshot = await db.collection('link_clicks')
      .where('linkId', '==', linkId)
      .where('space', '==', space)
      .where('timestamp', '>=', startDate)
      .orderBy('timestamp', 'desc')
      .get();

    const clicks = clicksSnapshot.docs.map(doc => doc.data());

    // Aggregate stats
    const clicksByPlatform = {
      ios: clicks.filter(c => c.os === 'iOS').length,
      android: clicks.filter(c => c.os === 'Android').length,
      web: clicks.filter(c => c.os !== 'iOS' && c.os !== 'Android').length
    };

    // Get unique clicks (by IP hash)
    const uniqueIPs = new Set(clicks.map(c => c.ip));

    // Get install events
    const installsSnapshot = await db.collection('app_events')
      .where('type', '==', 'install')
      .where('matchedLinkId', '==', linkId)
      .where('timestamp', '>=', startDate)
      .get();

    const installs = installsSnapshot.docs.map(doc => doc.data());

    const installsByPlatform = {
      ios: installs.filter(i => i.os === 'iOS').length,
      android: installs.filter(i => i.os === 'Android').length
    };

    // Group clicks by date for timeline
    const clicksByDate = {};
    clicks.forEach(click => {
      const date = new Date(click.timestamp.toDate()).toISOString().split('T')[0];
      if (!clicksByDate[date]) {
        clicksByDate[date] = { clicks: 0, installs: 0 };
      }
      clicksByDate[date].clicks++;
    });

    installs.forEach(install => {
      const date = new Date(install.timestamp.toDate()).toISOString().split('T')[0];
      if (clicksByDate[date]) {
        clicksByDate[date].installs++;
      }
    });

    const timeline = Object.entries(clicksByDate)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Top referrers
    const referrerCounts = {};
    clicks.forEach(click => {
      const source = click.paramsNorm?.utm_source || 'direct';
      referrerCounts[source] = (referrerCounts[source] || 0) + 1;
    });

    const topReferrers = Object.entries(referrerCounts)
      .map(([source, clicks]) => ({ source, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10);

    // Response
    res.json({
      success: true,
      linkId,
      space,
      range: `${rangeDays}d`,
      summary: {
        totalClicks: clicks.length,
        uniqueClicks: uniqueIPs.size,
        clicksByPlatform,
        conversionRate: clicks.length > 0 ? (installs.length / clicks.length) : 0
      },
      installs: {
        total: installs.length,
        ...installsByPlatform
      },
      timeline,
      topReferrers
    });

  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stats',
      details: error.message
    });
  }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
