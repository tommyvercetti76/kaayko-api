/**
 * Kreator API Routes — Orchestrator
 * 
 * Thin router that mounts domain-specific sub-routers.
 * Each sub-router is a focused, single-responsibility module.
 * 
 * Sub-routers:
 * - publicRoutes.js    → /apply, /applications, /onboarding
 * - kreatorAuthRoutes.js → /auth/google/*
 * - profileRoutes.js   → /me (get, update, delete)
 * - adminRoutes.js     → /admin/* (applications, kreators, stats)
 * - kreatorProductRoutes.js → /products/*
 * 
 * @module api/kreators
 */

const express = require('express');
const router = express.Router();
const { attachClientInfo, optionalKreatorAuth } = require('../../middleware/kreatorAuthHelpers');

// Apply client info middleware to all routes
router.use(attachClientInfo);

// Mount test routes (emulator only)
if (process.env.FUNCTIONS_EMULATOR === 'true') {
  const testRoutes = require('./testRoutes');
  router.use('/test', testRoutes);
  console.log('[Kreator] 🧪 Test routes enabled (emulator mode)');
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'Kreator API v1',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: {
      public: [
        'POST /kreators/apply',
        'GET /kreators/applications/:id/status',
        'POST /kreators/onboarding/verify',
        'POST /kreators/onboarding/complete'
      ],
      authenticated: [
        'GET /kreators/me',
        'PUT /kreators/me',
        'POST /kreators/auth/google/connect',
        'POST /kreators/auth/google/disconnect'
      ],
      admin: [
        'GET /kreators/admin/applications',
        'PUT /kreators/admin/applications/:id/approve',
        'PUT /kreators/admin/applications/:id/reject',
        'GET /kreators/admin/list',
        'GET /kreators/admin/stats'
      ]
    }
  });
});

/**
 * GET /kreators/debug
 * Debug endpoint (development only)
 */
router.get('/debug', optionalKreatorAuth, (req, res) => {
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

  if (!isEmulator) {
    return res.status(404).json({
      success: false,
      error: 'Not found',
      message: 'Debug endpoint only available in development'
    });
  }

  res.json({
    success: true,
    environment: 'emulator',
    timestamp: new Date().toISOString(),
    user: req.user || null,
    kreator: req.kreator ? {
      uid: req.kreator.uid,
      email: req.kreator.email,
      status: req.kreator.status,
      permissions: req.kreator.permissions
    } : null,
    clientInfo: req.clientInfo,
    headers: {
      authorization: req.headers.authorization ? '***present***' : 'missing',
      contentType: req.headers['content-type']
    }
  });
});

// ============================================================================
// MOUNT SUB-ROUTERS
// ============================================================================

// Public: application + onboarding (no auth)
router.use('/', require('./publicRoutes'));

// Profile: /me endpoints (kreator auth)
router.use('/', require('./profileRoutes'));

// Auth: Google OAuth flows
router.use('/auth', require('./kreatorAuthRoutes'));

// Products: kreator product management
router.use('/products', require('./kreatorProductRoutes'));
console.log('[Kreator] 📦 Product routes mounted at /kreators/products');

// Admin: application review, kreator management, stats
router.use('/admin', require('./adminRoutes'));

module.exports = router;
