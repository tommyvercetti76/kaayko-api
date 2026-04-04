// functions/api/weather/nearbyWater.js
//
// GET /nearbyWater?lat=&lng=&radius=30
//
// Data sources (no Overpass):
//   • HydroLAKES  — 3,021 named lakes worldwide, bundled JSON, <1ms lookup
//   • USGS NHD    — US-only REST API, comprehensive regional lake/reservoir data, ~2s
//
// Caching: Firestore `water_body_index` collection, 7-day TTL.
// Repeat queries for the same 0.5° grid cell: ~50ms (Firestore read).

const express  = require('express');
const { logger } = require('firebase-functions');
const { getFirestore } = require('firebase-admin/firestore');
const { findNearby, distMiles } = require('../../data/lakeIndex');

const router = express.Router();

// ── Firestore geo-grid cache ───────────────────────────────────────────────
const COLLECTION   = 'water_body_index';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let _db;
function db() {
  if (!_db) _db = getFirestore();
  return _db;
}

// 0.5° grid ≈ 55km cells
function gridKey(lat, lng) {
  const gLat = Math.round(lat * 2) / 2;
  const gLng = Math.round(lng * 2) / 2;
  // Replace minus signs so Firestore accepts it as doc ID
  return `${gLat}_${gLng}`.replace(/-/g, 'N');
}

async function cacheGet(key) {
  try {
    const doc = await db().collection(COLLECTION).doc(key).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (!data.expiresAt || data.expiresAt.toDate() <= new Date()) return null;
    return data.waterBodies || null;
  } catch (e) {
    logger.warn(`Cache read failed ${key}:`, e.message);
    return null;
  }
}

async function cacheSet(key, waterBodies) {
  try {
    await db().collection(COLLECTION).doc(key).set({
      waterBodies,
      expiresAt:  new Date(Date.now() + CACHE_TTL_MS),
      updatedAt:  new Date(),
      count:      waterBodies.length
    });
    logger.info(`💾 Cached ${waterBodies.length} bodies for ${key}`);
  } catch (e) {
    logger.warn(`Cache write failed ${key}:`, e.message);
  }
}

// ── Main endpoint ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const lat    = parseFloat(req.query.lat || req.query.latitude);
    const lng    = parseFloat(req.query.lng || req.query.longitude);
    const radius = Math.min(parseInt(req.query.radius || 30), 60); // cap 60km
    const radiusMiles = radius * 0.621;

    if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ success: false, error: 'Invalid coordinates' });
    }

    const key          = gridKey(lat, lng);
    const forceRefresh = req.query.refresh === '1';

    // ── 1. Firestore cache ─────────────────────────────────────────────────
    if (!forceRefresh) {
      const cached = await cacheGet(key);
      if (cached) {
        logger.info(`✅ Cache HIT ${key} (${cached.length} bodies)`);

        // Re-compute distances from actual search point, re-sort, slice
        const results = cached
          .map(b => ({ ...b, distanceMiles: Math.round(distMiles(lat, lng, b.lat, b.lng) * 10) / 10 }))
          .filter(b => b.distanceMiles <= radiusMiles)
          .sort((a, b) => b.relevancy - a.relevancy || a.distanceMiles - b.distanceMiles)
          .slice(0, 20);

        return res.json({
          success: true,
          waterBodies: results,
          cached: true,
          source: 'firestore',
          location: { lat, lng, radiusKm: radius },
          timestamp: new Date().toISOString()
        });
      }
    }

    // ── 2. Live lookup: HydroLAKES + USGS NHD + OSM fallback ─────────────
    const query = (req.query.q || '').toString().trim().slice(0, 200); // original search text
    logger.info(`🔎 Live lookup for ${lat.toFixed(3)},${lng.toFixed(3)} radius ${radiusMiles.toFixed(1)}mi q="${query}"`);

    // Use a slightly wider radius for the cache so adjacent grid lookups still hit
    const fetchMiles = Math.max(radiusMiles, 35);
    const bodies     = await findNearby(lat, lng, fetchMiles, query);

    // ── 3. Persist to Firestore ────────────────────────────────────────────
    if (bodies.length > 0) {
      cacheSet(key, bodies); // fire-and-forget
    }

    // ── 4. Return filtered results ─────────────────────────────────────────
    const results = bodies
      .map(b => ({ ...b, distanceMiles: Math.round(distMiles(lat, lng, b.lat, b.lng) * 10) / 10 }))
      .filter(b => b.distanceMiles <= radiusMiles)
      .sort((a, b) => b.relevancy - a.relevancy || a.distanceMiles - b.distanceMiles)
      .slice(0, 20);

    if (results.length > 0) {
      logger.info(`✅ Returning ${results.length} bodies. Top: ${results[0].name} (${results[0].distanceMiles}mi, ${results[0].source})`);
    } else {
      logger.warn(`⚠️ No water bodies found near ${lat.toFixed(3)},${lng.toFixed(3)}`);
    }

    res.json({
      success: true,
      waterBodies: results,
      cached: false,
      source: 'live',
      location: { lat, lng, radiusKm: radius },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('nearbyWater error:', error);
    res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
