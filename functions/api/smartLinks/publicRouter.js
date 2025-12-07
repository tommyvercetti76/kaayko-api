/**
 * @fileoverview Public Smart Link Router - Entry Point for /l/:id
 * @description Handles Smart Links (lkXXXX) only. Clean, minimal router that delegates to redirectHandler.
 * 
 * @module api/smartLinks/publicRouter
 * 
 * @routes
 * - GET /l/:id   → Smart link redirect (lkXXXX format from short_links collection)
 * - GET /resolve → Context restoration for iOS deferred deep linking
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// Import unified redirect system
const {
  handleRedirect
} = require('./redirectHandler');

// Import attribution service
const {
  resolveContext
} = require('./attributionService');

// Import rate limiting
const { ipRateLimit } = require('./rateLimitService');

const db = admin.firestore();

// Security configuration - Apply IP-based rate limiting
// More lenient for public redirects (high traffic expected)
router.use(ipRateLimit({ 
  maxRequests: 100, // 100 requests per minute per IP
  windowSeconds: 60,
  message: 'Too many link clicks from this IP. Please wait a moment.'
}));



// ============================================================================
// PUBLIC ROUTES
// ============================================================================

/**
 * Smart Link redirect handler (entry point for kaayko.com/l/:id).
 * Handles ONLY Smart Links (lkXXXX format) from short_links collection.
 * 
 * @async
 * @route GET /l/:id
 * 
 * @param {Express.Request} req - Express request object
 * @param {string} req.params.id - Short code (e.g. 'lk1ngp')
 * @param {Object} req.query - UTM parameters and other query strings
 * @param {Express.Response} res - Express response object
 * 
 * @returns {Promise<void>} Redirects user or sends error page
 * 
 * @example
 * // Smart link redirect
 * GET /l/lk1ngp?utm_source=ios&utm_campaign=share
 * // → Checks short_links collection → Redirects with platform detection + analytics
 * 
 * @example
 * // 404 error
 * GET /l/invalid999
 * // → Link not found → Branded error page
 */
router.get("/l/:id", async (req, res) => {
  // Delegate directly to handler - no pre-flight check needed
  // handleRedirect() already handles 404/410/500 internally
  return handleRedirect(req, res, req.params.id, { trackAnalytics: true });
});

/**
 * ENHANCED: Context resolution + install attribution endpoint.
 * Called by mobile apps on first open after installation.
 * 
 * Features:
 * - Click-to-install attribution via clickId
 * - Deferred deep link context resolution
 * - Backward compatible with legacy cookie/ctx_tokens resolution
 * - Tracks install events and conversion metrics
 * 
 * @async
 * @route GET /resolve
 * 
 * @param {Express.Request} req - Express request object
 * @param {string} req.query.clickId - Click ID from deep link (NEW - for attribution)
 * @param {string} req.query.deviceId - Stable device identifier (NEW)
 * @param {string} req.query.platform - ios|android (NEW)
 * @param {string} req.query.appVersion - App version string (NEW)
 * @param {string} req.query.userId - Optional user ID if logged in
 * @param {string} req.query.id - Legacy context ID (backward compatibility)
 * @param {Object} req.cookies - Cookie object with preserved context (legacy)
 * @param {Express.Response} res - Express response object
 * 
 * @returns {Promise<void>} JSON response with attribution result
 * @returns {boolean} success - Operation status
 * @returns {string} source - Data source ('click_attribution', 'cache', 'database', 'not_found')
 * @returns {boolean} attributed - Whether install was attributed to a click
 * @returns {boolean} isNewInstall - First time attribution vs. repeat call
 * @returns {Object} context - Link context (destinations, utm, metadata, campaign info)
 * @returns {string} timestamp - ISO timestamp
 * 
 * @example
 * // NEW: Attribution-based resolution (primary use case)
 * GET /resolve?clickId=c_abc123&deviceId=uuid-456&platform=ios&appVersion=1.0.0
 * // → Attributes install, returns:
 * // { success: true, source: 'click_attribution', attributed: true, 
 * //   isNewInstall: true, context: { linkCode, utm, destinations, ... } }
 * 
 * @example
 * // Legacy: Cookie-based resolution (backward compatible)
 * GET /resolve
 * Cookie: kaayko_location={"id":"antero","name":"Antero Reservoir",...}
 * // → { success: true, source: 'cache', attributed: false, context: {...} }
 * 
 * @example
 * // Organic install (no attribution)
 * GET /resolve?platform=ios&appVersion=1.0.0
 * // → { success: false, source: 'not_found', attributed: false, 
 * //     message: 'App opened without attribution context...' }
 */
router.get("/resolve", async (req, res) => {
  try {
    // NEW: Attribution-based resolution via clickId
    const clickId = req.query.clickId;
    const deviceId = req.query.deviceId;
    const platform = req.query.platform;
    const appVersion = req.query.appVersion;
    const userId = req.query.userId;

    // If clickId provided, use new attribution flow
    if (clickId || deviceId) {
      const result = await resolveContext({
        clickId,
        deviceId,
        platform,
        appVersion,
        userId,
        metadata: {
          userAgent: req.get('user-agent'),
          ip: req.ip || req.connection.remoteAddress
        }
      });
      
      return res.json(result);
    }

    // LEGACY: Cookie/database-based resolution (backward compatibility)
    const ctxId = req.query.id || 
                  (req.cookies && req.cookies.kaayko_ctxid) || 
                  (req.cookies && req.cookies.kaayko_lake_id);
    const cachedLocation = req.cookies && req.cookies.kaayko_location;
    
    // Try cookie cache first (fastest)
    if (cachedLocation) {
      try {
        const locationData = JSON.parse(cachedLocation);
        return res.json({
          success: true,
          source: 'cache',
          attributed: false,
          context: locationData,
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        console.error('[PublicLink] Cache parse error:', e);
      }
    }
    
    // Fallback to database
    if (ctxId) {
      try {
        const ctxDoc = await db.collection('ctx_tokens').doc(ctxId).get();
        if (ctxDoc.exists) {
          const ctxData = ctxDoc.data();
          return res.json({
            success: true,
            source: 'database',
            attributed: false,
            context: ctxData.params,
            timestamp: new Date().toISOString()
          });
        }
      } catch (dbError) {
        console.error('[PublicLink] Database error:', dbError);
      }
    }
    
    // Context not found (organic install)
    return res.status(404).json({
      success: false,
      source: 'not_found',
      attributed: false,
      error: 'Context not found',
      message: 'App opened without attribution context. This is normal for organic installs.',
      ctxId: ctxId || 'none',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[PublicLink] Resolve error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
