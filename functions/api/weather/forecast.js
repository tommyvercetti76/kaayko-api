// File: functions/api/weather/forecast.js
//
// 🔒 PREMIUM FORECAST API — on-demand comprehensive forecast.
//
// v2.0.0: the scheduled pre-warm pipeline that lived here was deleted — its cache
// writes used a key scheme no endpoint read (forecast_<name> vs custom_<lat>_<lng>)
// and its ML calls ran on hardcoded default features, burning ~470 external calls
// a day for data never served. This route now scores live through the same
// scoringPipeline core as /paddleScore and /fastForecast.

const express = require('express');
const router = express.Router();
const rateLimit = require('../../middleware/rateLimit');
const UnifiedWeatherService = require('./unifiedWeatherService');
const { computePaddleScoreForSpot } = require('./paddleScoreCompute');
const { createInputMiddleware } = require('./inputStandardization');
const { ALGORITHM_VERSION } = require('./scoringConstants');

// Limited rate for internal/premium use only
router.use(rateLimit(10, 60_000));

router.get('/', createInputMiddleware('forecast'), async (req, res) => {
  try {
    const { latitude, longitude, locationString } = req.standardizedInputs;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ success: false, error: 'lat/lng required', code: 'BAD_COORDS' });
    }

    const weatherService = new UnifiedWeatherService();
    const [score, weatherData] = await Promise.all([
      computePaddleScoreForSpot({ id: null, lat: latitude, lng: longitude, name: locationString || `${latitude},${longitude}` }),
      weatherService.getWeatherData(`${latitude},${longitude}`, { includeForecast: true, useCache: true })
    ]);

    if (!score || !weatherData?.current) {
      // A failed upstream must be visible as a failure — never HTTP 200
      return res.status(502).json({ success: false, error: 'Forecast generation failed', code: 'UPSTREAM_UNAVAILABLE' });
    }

    return res.json({
      success: true,
      data: {
        location: weatherData.location,
        current: weatherData.current,
        paddleScore: score,
        forecast: weatherData.forecast || [],
        metadata: {
          generated: new Date().toISOString(),
          algorithmVersion: ALGORITHM_VERSION,
          source: 'live'
        }
      }
    });

  } catch (error) {
    console.error('❌ Forecast API error:', error);
    return res.status(502).json({ success: false, error: 'Forecast generation failed', code: 'UPSTREAM_ERROR' });
  }
});

module.exports = { router };
