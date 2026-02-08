/**
 * Nearby Water Bodies Router
 * Finds nearby lakes, rivers, reservoirs via Overpass API.
 *
 * @module api/weather/nearbyWater
 */

const express = require('express');
const { logger } = require('firebase-functions');
const { findNearbyWater } = require('./nearbyWaterService');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat || req.query.latitude);
    const lng = parseFloat(req.query.lng || req.query.longitude);
    const radius = parseInt(req.query.radius || 50);
    const publicOnly = req.query.publicOnly === 'true';

    if (!lat || !lng || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Invalid coordinates', message: 'Please provide valid lat/lng parameters' });
    }

    const data = await findNearbyWater(lat, lng, radius, publicOnly);
    res.json(data);
  } catch (error) {
    logger.error('❌ nearbyWater error:', error);
    res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
