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

// Import shared utilities
const {
  createRateLimitMiddleware,
  securityHeadersMiddleware,
  createAPIErrorHandler
} = require('../weather/sharedWeatherUtils');

const db = admin.firestore();

// Security configuration
const SECURITY_CONFIG = {
  MAX_REQUESTS_PER_MINUTE: 30,
  REQUEST_TIMEOUT: 10000
};

// Apply shared middleware
router.use(createRateLimitMiddleware(SECURITY_CONFIG.MAX_REQUESTS_PER_MINUTE));
router.use(securityHeadersMiddleware);
router.use(createAPIErrorHandler('PublicLink'));



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
 * Context restoration endpoint for iOS deferred deep linking.
 * Called by iOS app after installation to retrieve preserved location context.
 * Checks cookies first (fast), then falls back to database/legacy lookups.
 * 
 * @async
 * @route GET /resolve
 * 
 * @param {Express.Request} req - Express request object
 * @param {string} req.query.id - Context ID from URL parameter
 * @param {Object} req.cookies - Cookie object with preserved context
 * @param {string} req.cookies.kaayko_ctxid - Primary context identifier
 * @param {string} req.cookies.kaayko_lake_id - Legacy lake identifier
 * @param {string} req.cookies.kaayko_location - JSON-encoded location data
 * @param {Express.Response} res - Express response object
 * 
 * @returns {Promise<void>} JSON response with location context
 * @returns {boolean} success - Operation status
 * @returns {string} source - Data source ('cache', 'database', 'legacy', or 'not_found')
 * @returns {Object} context - Location data (id, name, lat, lon)
 * @returns {string} timestamp - ISO timestamp
 * 
 * @example
 * // Cookie-based resolution (fastest)
 * GET /resolve
 * Cookie: kaayko_location={"id":"antero","name":"Antero Reservoir",...}
 * // → Returns: { success: true, source: 'cache', context: {...} }
 * 
 * @example
 * // URL parameter resolution
 * GET /resolve?id=antero456
 * // → Looks up location → { success: true, source: 'database', context: {...} }
 * 
 * @example
 * // Not found
 * GET /resolve?id=invalid999
 * // → { success: false, source: 'not_found', message: 'No context...' }
 */
router.get("/resolve", async (req, res) => {
  try {
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
            context: ctxData.params,
            timestamp: new Date().toISOString()
          });
        }
      } catch (dbError) {
        console.error('[PublicLink] Database error:', dbError);
      }
    }
    
    // Context not found
    return res.status(404).json({
      success: false,
      error: 'Context not found',
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
