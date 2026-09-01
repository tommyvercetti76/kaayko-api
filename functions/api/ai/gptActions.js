// File: functions/api/ai/gptActions.js
//
// 🤖 GPT ACTIONS API — simplified, GPT-friendly wrappers over the paddling API.
//
// v2.1.0 correctness release. Every response this router produced was wrong:
// the upstream `conditions` block is METRIC (°C, KPH, km) but values were
// labelled °F / mph / miles without conversion; water temperature read a field
// that does not exist (always "Unknown"); /locations and /findNearby parsed
// response shapes the upstream never returns (always empty); and the payload
// advertised a fabricated "99.98%" accuracy figure. All fixed here.
//
// Units: this router presents IMPERIAL to GPT consumers and converts at this
// boundary. Upstream stays metric — never change that contract.

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { sendError } = require('../lib/apiResponse');
const { renderTipDetail } = require('../weather/paddleTips');

// Self-call base URL — configurable so it isn't pinned to one deployment.
const BASE_URL = process.env.PUBLIC_API_BASE_URL
  || 'https://us-central1-kaaykostore.cloudfunctions.net/api';
const TIMEOUT_MS = 9000;

const get = (path, params) => axios.get(`${BASE_URL}${path}`, { params, timeout: TIMEOUT_MS });

// ── Unit conversion at the presentation boundary ──────────────────────────
const n = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
const cToF   = c  => { const v = n(c);  return v === null ? null : Math.round(v * 9 / 5 + 32); };
const kphToMph = k => { const v = n(k);  return v === null ? null : Math.round(v * 0.621371); };
const kmToMi = k  => { const v = n(k);  return v === null ? null : Math.round(v * 0.621371 * 10) / 10; };
const unit = (value, suffix) => value === null ? 'Unknown' : `${value}${suffix}`;

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'GPT Actions API',
    status: 'running',
    endpoints: ['/paddleScore', '/forecast', '/locations', '/findNearby'],
    units: 'imperial',
    version: '2.1.0'
  });
});

/**
 * GET /gptActions/paddleScore?latitude=&longitude=[&craft=]
 * Current paddle conditions, imperial units, GPT-shaped.
 */
router.get('/paddleScore', async (req, res) => {
  try {
    const { latitude, longitude, craft } = req.query;
    if (!latitude || !longitude) {
      return sendError(res, 'MISSING_PARAM', 'latitude and longitude are required');
    }

    const { data } = await get('/paddleScore', { lat: latitude, lng: longitude, craft });
    const c = data.conditions || {};

    return res.json({
      location: {
        name: data.location?.name || `${latitude}, ${longitude}`,
        coordinates: `${latitude}, ${longitude}`
      },
      paddleScore: {
        rating: data.paddleScore?.rating,
        interpretation: data.paddleScore?.interpretation,
        outOf: 5.0,
        craft: data.paddleScore?.craft || 'kayak',
        craftAdjustment: data.paddleScore?.craftAdjustment?.delta || 0
      },
      currentConditions: {
        temperature:      unit(cToF(c.temperature), '°F'),
        windSpeed:        unit(kphToMph(c.windSpeed), ' mph'),
        gustSpeed:        unit(kphToMph(c.gustSpeed), ' mph'),
        waterTemperature: unit(cToF(c.waterTemp), '°F'),
        humidity:         unit(n(c.humidity), '%'),
        cloudCover:       unit(n(c.cloudCover), '%'),
        uvIndex:          c.uvIndex ?? null,
        visibility:       unit(kmToMi(c.visibility), ' miles')
      },
      safetyWarnings: data.warnings?.messages || [],
      // Rendered in imperial — API consumers have no client-side unit layer
      preparationTips: (data.tips || []).map(t => ({
        title: t.title,
        detail: renderTipDetail(t, { imperial: true })
      })),
      modelDetails: {
        mlModelUsed: data.paddleScore?.mlModelUsed,
        algorithmVersion: data.paddleScore?.algorithmVersion,
        source: data.paddleScore?.predictionSource
      }
    });

  } catch (error) {
    console.error('GPT Actions paddleScore error:', error.message);
    return sendError(res, 'UPSTREAM_UNAVAILABLE', 'Failed to get paddle score');
  }
});

/**
 * GET /gptActions/forecast?latitude=&longitude=
 * 3-day hourly outlook flattened for GPT, imperial units.
 */
router.get('/forecast', async (req, res) => {
  try {
    const { latitude, longitude, craft } = req.query;
    if (!latitude || !longitude) {
      return sendError(res, 'MISSING_PARAM', 'latitude and longitude are required');
    }

    const { data } = await get('/fastForecast', { lat: latitude, lng: longitude, craft });

    const hourlyForecast = [];
    if (Array.isArray(data.forecast)) {
      data.forecast.forEach(day => {
        Object.entries(day.hourly || {}).forEach(([hour, h]) => {
          hourlyForecast.push({
            time: `${day.date} ${String(hour).padStart(2, '0')}:00`,
            paddleScore: h.rating ?? h.prediction?.rating ?? null,
            interpretation: h.interpretation ?? h.prediction?.interpretation ?? null,
            // hourly temperature/wind are °C and KPH upstream
            temperature: unit(cToF(h.temperature), '°F'),
            windSpeed:   unit(kphToMph(h.windSpeed), ' mph')
          });
        });
      });
    }
    hourlyForecast.sort((a, b) => a.time.localeCompare(b.time));

    const scored = hourlyForecast.filter(h => typeof h.paddleScore === 'number');
    const bestTime = scored.length
      ? scored.reduce((best, cur) => (cur.paddleScore > best.paddleScore ? cur : best))
      : null;

    return res.json({
      location: `${latitude}, ${longitude}`,
      bestUpcoming: bestTime ? {
        time: bestTime.time,
        score: bestTime.paddleScore,
        interpretation: bestTime.interpretation,
        conditions: `${bestTime.temperature}, ${bestTime.windSpeed} wind`
      } : null,
      hourlyForecast: hourlyForecast.slice(0, 24)
    });

  } catch (error) {
    console.error('GPT Actions forecast error:', error.message);
    return sendError(res, 'UPSTREAM_UNAVAILABLE', 'Failed to get forecast');
  }
});

/**
 * GET /gptActions/locations[?state=]
 * The curated paddling spots. /paddlingOut returns a BARE ARRAY — the old code
 * read `data.locations` and therefore always returned zero results.
 */
router.get('/locations', async (req, res) => {
  try {
    const state = (req.query.state || '').toString().trim().toLowerCase();
    const { data } = await get('/paddlingOut');
    const rows = Array.isArray(data) ? data : (data.data || data.spots || []);

    let locations = rows.map(s => ({
      id: s.id,
      name: s.title || s.lakeName || s.id,
      region: s.subtitle || '',
      waterType: s.waterType || null,
      coordinates: {
        latitude: s.location?.latitude ?? null,
        longitude: s.location?.longitude ?? null
      },
      description: s.text || '',
      amenities: {
        parking: s.parkingAvl === 'Y',
        restrooms: s.restroomsAvl === 'Y'
      },
      currentScore: s.paddleScore?.rating ?? null,
      interpretation: s.paddleScore?.interpretation ?? null
    }));

    if (state) {
      locations = locations.filter(l => l.region.toLowerCase().includes(state));
    }

    return res.json({ count: locations.length, locations });

  } catch (error) {
    console.error('GPT Actions locations error:', error.message);
    return sendError(res, 'UPSTREAM_UNAVAILABLE', 'Failed to get locations');
  }
});

/**
 * POST /gptActions/findNearby  { latitude, longitude, radius (miles) }
 * Upstream returns { waterBodies: [{ name, type, lat, lng, distanceMiles }] } —
 * the old code read `data.water` and always returned nothing.
 */
router.post('/findNearby', async (req, res) => {
  try {
    const { latitude, longitude, radius = 5 } = req.body || {};
    if (latitude === undefined || longitude === undefined) {
      return sendError(res, 'MISSING_PARAM', 'latitude and longitude are required');
    }

    const radiusMiles = Math.max(1, Math.min(50, Number(radius) || 5));
    const { data } = await get('/nearbyWater', {
      lat: latitude,
      lng: longitude,
      radius: Math.round(radiusMiles * 1.60934)   // upstream takes km
    });

    const waterBodies = (data.waterBodies || []).map(w => ({
      name: w.name,
      type: w.type || w.waterbody_class || 'water',
      distance: w.distanceMiles != null ? `${w.distanceMiles} miles` : null,
      coordinates: { latitude: w.lat, longitude: w.lng }
    }));

    return res.json({
      searchLocation: `${latitude}, ${longitude}`,
      searchRadius: `${radiusMiles} miles`,
      found: waterBodies.length,
      waterBodies: waterBodies.slice(0, 10)
    });

  } catch (error) {
    console.error('GPT Actions findNearby error:', error.message);
    return sendError(res, 'UPSTREAM_UNAVAILABLE', 'Failed to find nearby water');
  }
});

module.exports = router;
