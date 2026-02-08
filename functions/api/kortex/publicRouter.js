/**
 * @fileoverview Kortex Public Router — thin router
 * @description Unified public entry point for ALL Kortex short links.
 * Smart Links handled by redirectHandler; legacy location links fall back
 * to paddlingOutSpots lookup with context preservation.
 *
 * @module api/kortex/publicRouter
 *
 * @routes
 * - GET /l/:id   → Kortex redirect (smart link first, legacy location fallback)
 * - GET /resolve → Context restoration / install attribution for mobile apps
 */

const express = require('express');
const router = express.Router();
const { ipRateLimit } = require('./rateLimitService');
const h = require('./publicRouteHandlers');

// Rate limiting — lenient for public redirects (high traffic expected)
router.use(ipRateLimit({ maxRequests: 100, windowSeconds: 60, message: 'Too many link clicks from this IP. Please wait a moment.' }));

router.get('/l/:id', h.redirectHandler);
router.get('/resolve', h.resolve);

module.exports = router;
