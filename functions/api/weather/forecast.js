/**
 * Forecast Router — Internal / premium forecast API
 *
 * GET  /forecast        → comprehensive forecast for one location
 * POST /forecast/batch  → batch process all paddling locations
 *
 * @module api/weather/forecast
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('../../middleware/rateLimit');
const { createInputMiddleware } = require('./inputStandardization');
const {
  generateComprehensiveForecast,
  batchGenerateForecasts,
  getPaddlingLocations
} = require('./forecastService');

router.use(rateLimit(10, 60_000));

router.get('/', createInputMiddleware('forecast'), async (req, res) => {
  try {
    const { latitude, longitude, spotId, locationString } = req.standardizedInputs;
    const location = locationString || spotId || `${latitude},${longitude}`;
    const result = await generateComprehensiveForecast(location);
    res.json(result);
  } catch (error) {
    console.error('❌ Forecast API error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/batch', async (req, res) => {
  try {
    const locations = await getPaddlingLocations();
    if (locations.length === 0)
      return res.status(400).json({ success: false, error: 'No paddling locations found' });
    const result = await batchGenerateForecasts(locations);
    res.json(result);
  } catch (error) {
    console.error('❌ Batch forecast error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = { router };
