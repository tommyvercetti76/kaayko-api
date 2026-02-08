/**
 * GPT Actions API — thin router
 *
 * Simplified endpoints for ChatGPT Custom GPT.
 * Wraps existing Kaayko APIs in a GPT-friendly format.
 *
 * @module api/ai/gptActions
 */

const express = require('express');
const router = express.Router();
const h = require('./gptActionHandlers');

router.get('/health', h.health);
router.get('/paddleScore', h.paddleScore);
router.get('/forecast', h.forecast);
router.get('/locations', h.locations);
router.post('/findNearby', h.findNearby);

module.exports = router;
