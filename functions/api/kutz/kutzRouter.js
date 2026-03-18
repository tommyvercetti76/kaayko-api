/**
 * KaleKutz — API Router
 *
 * All routes under /api/kutz/
 * Requires Firebase Auth (Bearer token) on all endpoints.
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/authMiddleware');

const parseFoods = require('./parseFoods');
const weeklyReport = require('./weeklyReport');

// POST /api/kutz/parseFoods
// Body: { text: string }
// Returns: { success: true, data: { foods: [...] } }
router.post('/parseFoods', requireAuth, parseFoods);

// POST /api/kutz/weeklyReport
// Returns: { success: true, data: { report: string, weekData: [...] } }
router.post('/weeklyReport', requireAuth, weeklyReport);

module.exports = router;
