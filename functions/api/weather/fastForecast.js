/**
 * Fast Forecast Router — Cached 3-day weather forecasts for frontend
 *
 * GET /fastForecast              → ultra-fast cached forecast
 * GET /fastForecast/cache/stats  → cache statistics
 *
 * @module api/weather/fastForecast
 */

const express = require('express');
const router = express.Router();
const { logger } = require('firebase-functions');
const ForecastCache = require('../../cache/forecastCache');
const { createInputMiddleware } = require('./inputStandardization');
const { generateFreshForecast } = require('./fastForecastService');

router.get('/', createInputMiddleware('fastForecast'), async (req, res) => {
  const startTime = Date.now();
  const cache = new ForecastCache();

  try {
    const { latitude, longitude, spotId } = req.standardizedInputs;
    const locationQuery = spotId || `${latitude},${longitude}`;

    console.log(`⚡ FastForecast: ${locationQuery}`);

    let forecast = await cache.getCachedCustomForecast(latitude, longitude);
    let source = 'coordinate_cache';

    if (!forecast) {
      try {
        logger.info(`Cache miss for ${latitude},${longitude} — generating forecast`);
        forecast = await generateFreshForecast(latitude, longitude);
        if (forecast.success) {
          const processingTime = Date.now() - startTime;
          forecast.metadata.processingTimeMs = processingTime;
          forecast.metadata.responseTime = `${processingTime}ms`;
          await cache.storeCustomForecast(latitude, longitude, forecast);
          source = 'api_fresh';
          forecast.metadata.cached = false;
          forecast.metadata.source = 'live_api';
        }
      } catch (error) {
        logger.error(`Failed to generate forecast: ${error.message}`);
        return res.status(503).json({
          success: false, error: 'Forecast service unavailable',
          details: error.message, suggestion: 'Try again in a few minutes'
        });
      }
    }

    const responseTime = Date.now() - startTime;
    forecast.metadata = {
      ...forecast.metadata, responseTime: `${responseTime}ms`,
      source, fastAPI: true, timestamp: new Date().toISOString()
    };

    logger.info(`✅ Fast forecast served in ${responseTime}ms (source: ${source})`);
    res.status(200).json(forecast);

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error(`❌ Fast forecast error after ${responseTime}ms: ${error.message}`);
    res.status(500).json({
      success: false, error: 'Internal server error',
      details: error.message, responseTime: `${responseTime}ms`
    });
  }
});

router.get('/cache/stats', async (req, res) => {
  try {
    const cache = new ForecastCache();
    const stats = await cache.getCacheStats();
    const allForecasts = await cache.getAllCachedForecasts();
    res.status(200).json({
      success: true, stats,
      cachedLocations: Object.keys(allForecasts),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Cache stats error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Internal server error', details: error.message });
  }
});

module.exports = router;
