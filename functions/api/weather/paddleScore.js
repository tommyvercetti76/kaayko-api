/**
 * Paddle Score Router — ML-powered condition rating API
 *
 * GET /paddleScore?lat=…&lng=… | ?location=… | ?spotId=…
 *
 * @module api/weather/paddleScore
 */

const express = require('express');
const router = express.Router();
const { createInputMiddleware } = require('./inputStandardization');
const { computePaddleScore } = require('./paddleScoreService');

router.get('/', createInputMiddleware('paddleScore'), async (req, res) => {
  const startTime = Date.now();
  try {
    const { latitude, longitude, spotId } = req.standardizedInputs;
    const result = await computePaddleScore(latitude, longitude, spotId);

    if (!result.success) {
      return res.status(result._status || 500).json(result);
    }

    result.metadata = result.metadata || {};
    result.metadata.response_time_ms = Date.now() - startTime;
    res.json(result);
  } catch (error) {
    console.error('PaddleScore error:', error);
    res.status(500).json({
      success: false, error: 'Server error',
      details: error.message, response_time_ms: Date.now() - startTime
    });
  }
});

module.exports = router;
