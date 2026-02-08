/**
 * Test Utilities for Kreator API — thin router
 *
 * DEVELOPMENT/EMULATOR ONLY - These endpoints help test the API
 * without needing a real Firebase Auth flow.
 *
 * @module api/kreators/testRoutes
 */

const express = require('express');
const router = express.Router();
const h = require('./testHandlers');

router.get('/setup', h.setup);
router.get('/mock-token', h.mockToken);
router.post('/direct-approve', h.directApprove);
router.post('/direct-reject', h.directReject);
router.get('/list-all', h.listAll);
router.post('/cleanup', h.cleanup);

module.exports = router;
