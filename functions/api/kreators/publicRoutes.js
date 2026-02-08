/**
 * Kreator Public Routes — thin router
 *
 * Public-facing endpoints for application submission and onboarding.
 * No authentication required (rate limited instead).
 *
 * Routes:
 * - POST /apply              - Submit kreator application
 * - GET  /applications/:id/status - Check application status
 * - POST /onboarding/verify   - Verify magic link token
 * - POST /onboarding/complete - Set password, activate account
 *
 * @module api/kreators/publicRoutes
 */

const express = require('express');
const router = express.Router();
const { kreatorRateLimit } = require('../../middleware/kreatorAuthHelpers');
const h = require('./publicHandlers');

router.post('/apply', kreatorRateLimit('apply', 5, 3600000), h.apply);
router.get('/applications/:id/status', kreatorRateLimit('status', 10, 60000), h.statusCheck);
router.post('/onboarding/verify', kreatorRateLimit('verify', 20, 60000), h.magicLinkVerify);
router.post('/onboarding/complete', kreatorRateLimit('complete', 5, 60000), h.onboardingComplete);

module.exports = router;
