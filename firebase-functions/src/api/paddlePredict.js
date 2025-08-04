// File: functions/src/api/paddlePredict.js

const express = require('express');
const router = express.Router();
const rateLimit = require('../middleware/rateLimit');
const { validatePaddlePredictQuery, validateEnhanceBody } = require('../middleware/validation');
const paddlePredictController = require('../controllers/paddlePredictController');

// Apply rate limiting: 20 requests per 60 seconds
router.use(rateLimit(20, 60_000));

// GET /paddlePredict?location=... or lat=&lng=
router.get(
  '/',
  validatePaddlePredictQuery,
  paddlePredictController.getPrediction
);

// GET /paddlePredict/health
router.get('/health', paddlePredictController.healthCheck);

// GET /paddlePredict/model
router.get('/model', paddlePredictController.modelInfo);

// GET /paddlePredict/forecast?lat=&lng= (for heatmap 3-day forecast)
router.get('/forecast', paddlePredictController.getForecast);

// POST /paddlePredict/enhance
router.post(
  '/enhance',
  validateEnhanceBody,
  paddlePredictController.enhanceReports
);

module.exports = router;