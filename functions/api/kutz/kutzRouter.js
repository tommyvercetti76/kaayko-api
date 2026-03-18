/**
 * KaleKutz — API Router
 *
 * All routes under /api/kutz/
 * Requires Firebase Auth (Bearer token) on all endpoints.
 */

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../../middleware/authMiddleware');

const parseFoods   = require('./parseFoods');
const weeklyReport = require('./weeklyReport');
const suggest      = require('./suggest');
const {
  fitbitInitiate,
  fitbitCallback,
  fitbitSync,
  fitbitStatus,
  fitbitDisconnect,
} = require('./fitbit');

// POST /api/kutz/parseFoods
router.post('/parseFoods', requireAuth, parseFoods);

// POST /api/kutz/weeklyReport
router.post('/weeklyReport', requireAuth, weeklyReport);

// POST /api/kutz/suggest  — today-aware meal suggestions
router.post('/suggest', requireAuth, suggest);

// ── Fitbit OAuth ─────────────────────────────────────────────────────────────
// GET  /api/kutz/fitbit/initiate    — returns { authUrl } for frontend redirect
router.get('/fitbit/initiate', requireAuth, fitbitInitiate);

// GET  /api/kutz/fitbit/callback    — Fitbit posts back here (no auth)
router.get('/fitbit/callback', fitbitCallback);

// POST /api/kutz/fitbit/sync        — sync today's steps + calories
router.post('/fitbit/sync', requireAuth, fitbitSync);

// GET  /api/kutz/fitbit/status      — check connection state
router.get('/fitbit/status', requireAuth, fitbitStatus);

// POST /api/kutz/fitbit/disconnect  — remove stored tokens
router.post('/fitbit/disconnect', requireAuth, fitbitDisconnect);

module.exports = router;
