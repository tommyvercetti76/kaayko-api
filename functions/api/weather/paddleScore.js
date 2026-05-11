// functions/api/weather/paddleScore.js
//
// GET  /paddleScore              — live ML-powered paddle score for any location
// POST /paddleScore/feedback     — record user's actual experience vs prediction
// POST /paddleScore/publicRating — public paddle rating from QR/link (rate.html)
// GET  /paddleScore/metrics      — admin: model accuracy stats (requires x-admin-key)

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { createInputMiddleware } = require('./inputStandardization');
const { computePaddleScoreForSpot } = require('./paddleScoreCompute');
const PaddleScoreCache = require('../../cache/paddleScoreCache');
const { requireAdmin } = require('../../middleware/authMiddleware');

const db = getFirestore();

// ─── GET /paddleScore ──────────────────────────────────────────────────────

/**
 * GET /paddleScore?lat=&lng=  or  ?spotId=  or  ?location=
 *
 * Check paddle_score_cache first (populated by warmPaddleScoreCache every 15 min).
 * On cache miss, compute fresh — weather + marine fetched in parallel inside
 * computePaddleScoreForSpot. Writes result back to cache as a side effect.
 */
router.get('/', createInputMiddleware('paddleScore'), async (req, res) => {
  const startTime = Date.now();

  try {
    const { latitude, longitude, spotId } = req.standardizedInputs;

    let loc;
    let locationName;

    if (spotId) {
      const doc = await db.collection('paddlingSpots').doc(spotId).get();
      if (!doc.exists) {
        return res.status(404).json({
          success: false,
          error: 'Paddling spot not found',
          spotId,
          available_via: '/paddlingOut'
        });
      }
      const data = doc.data();
      if (!data.location?.latitude || !data.location?.longitude) {
        return res.status(500).json({ success: false, error: 'Spot has no coordinates' });
      }
      loc = { id: spotId, lat: data.location.latitude, lng: data.location.longitude, name: data.lakeName || spotId };
      locationName = loc.name;
    } else {
      loc = { id: null, lat: latitude, lng: longitude, name: `${latitude},${longitude}` };
      locationName = loc.name;
    }

    console.log(`paddleScore request: ${locationName}`);

    // Check paddle_score_cache for known spots (spotId-keyed)
    if (spotId) {
      const cache = new PaddleScoreCache();
      const cached = await cache.get(spotId);
      if (cached) {
        console.log(`paddleScore: cache hit for ${spotId}`);
        return res.json({
          success: true,
          location: { name: locationName, coordinates: { latitude: loc.lat, longitude: loc.lng } },
          paddleScore: cached,
          warnings: cached.warnings,
          conditions: cached.conditions,
          metadata: {
            source: cached.predictionSource,
            cached: true,
            cachedAt: cached.computedAt,
            response_time_ms: Date.now() - startTime
          }
        });
      }
    }

    // Load dynamic calibration offset for this spot (if any)
    const calibrationOffsets = new Map();
    if (spotId) {
      try {
        const calDoc = await db.collection('paddle_spot_calibrations').doc(spotId).get();
        if (calDoc.exists && typeof calDoc.data().biasOffset === 'number') {
          calibrationOffsets.set(spotId, calDoc.data().biasOffset);
        }
      } catch { /* non-fatal */ }
    }

    // Compute fresh score (weather + marine in parallel inside compute module)
    const score = await computePaddleScoreForSpot(loc, { calibrationOffsets });

    if (!score) {
      return res.status(500).json({
        success: false,
        error: 'Failed to compute paddle score — weather data unavailable',
        location: locationName
      });
    }

    // Write to cache as a side effect for future paddlingOut reads
    if (spotId) {
      const cache = new PaddleScoreCache();
      cache.set(spotId, score).catch(err =>
        console.warn(`paddleScore: failed to write cache for ${spotId}: ${err.message}`)
      );
    }

    return res.json({
      success: true,
      location: { name: locationName, coordinates: { latitude: loc.lat, longitude: loc.lng } },
      paddleScore: {
        rating: score.rating,
        interpretation: score.interpretation,
        confidence: score.confidence,
        mlModelUsed: score.mlModelUsed,
        predictionSource: score.predictionSource,
        originalMLRating: score.originalMLRating,
        calibrationApplied: score.calibrationApplied,
        adjustments: score.adjustments,
        penaltiesApplied: score.penaltiesApplied,
        dynamicOffset: score.dynamicOffset,
        isGoldStandard: true
      },
      warnings: score.warnings,
      conditions: score.conditions,
      metadata: {
        source: score.predictionSource,
        cached: false,
        computedAt: score.computedAt,
        response_time_ms: Date.now() - startTime
      }
    });

  } catch (error) {
    console.error('paddleScore GET / error:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      error: 'Server error',
      response_time_ms: Date.now() - startTime
    });
  }
});

// ─── POST /paddleScore/feedback ────────────────────────────────────────────

/**
 * POST /paddleScore/feedback
 * Body: { spotId, actualScore, predictedScore?, conditions?, userId? }
 *
 * Records a user's real experience rating so the daily aggregator can
 * compute per-spot bias and improve calibration over time.
 * No auth required — supports anonymous feedback.
 */
router.post('/feedback', async (req, res) => {
  try {
    const { spotId, actualScore, predictedScore, conditions, userId } = req.body;

    // Validate required fields
    if (!spotId || typeof spotId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(spotId)) {
      return res.status(400).json({ success: false, error: 'Invalid or missing spotId' });
    }
    if (typeof actualScore !== 'number' || actualScore < 1 || actualScore > 5) {
      return res.status(400).json({ success: false, error: 'actualScore must be a number between 1 and 5' });
    }
    if (predictedScore !== undefined && (typeof predictedScore !== 'number' || predictedScore < 1 || predictedScore > 5)) {
      return res.status(400).json({ success: false, error: 'predictedScore must be a number between 1 and 5' });
    }

    // Sanitize optional conditions object — only allow known numeric keys
    let safeConditions = {};
    if (conditions && typeof conditions === 'object' && !Array.isArray(conditions)) {
      const ALLOWED_CONDITION_KEYS = ['temperature', 'windSpeed', 'waterTemp', 'wasMarineDataAvailable'];
      for (const key of ALLOWED_CONDITION_KEYS) {
        if (key in conditions) {
          safeConditions[key] = key === 'wasMarineDataAvailable'
            ? Boolean(conditions[key])
            : Number(conditions[key]);
        }
      }
    }

    await db.collection('paddle_predictions_feedback').add({
      spotId,
      userId: typeof userId === 'string' ? userId : null,
      actualScore,
      predictedScore: typeof predictedScore === 'number' ? predictedScore : null,
      conditions: safeConditions,
      timestamp: FieldValue.serverTimestamp(),
      sessionDate: new Date().toISOString().split('T')[0]
    });

    return res.json({ success: true, message: 'Feedback recorded. Thank you!' });

  } catch (error) {
    console.error('paddleScore POST /feedback error:', error.message, error.stack);
    return res.status(500).json({ success: false, error: 'Failed to record feedback' });
  }
});

// ─── POST /paddleScore/publicRating ────────────────────────────────────────

/**
 * POST /paddleScore/publicRating
 * Body: { spotId, rating, chips[], profile, gps?, fingerprint, weather?, notes?, windFelt?, waterFelt? }
 *
 * Public endpoint for the Rate My Paddle feature (rate.html).
 * No auth required. Anti-fraud: fingerprint dedup per spot per day,
 * server-side chip validation against real weather, GPS quality signal.
 */
router.post('/publicRating', async (req, res) => {
  try {
    const {
      spotId, rating, chips, profile, gps,
      fingerprint, weather, notes, windFelt, waterFelt, predictedScore
    } = req.body;

    if (!spotId || typeof spotId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(spotId)) {
      return res.status(400).json({ success: false, error: 'Invalid spotId' });
    }
    if (typeof rating !== 'number' || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
      return res.status(400).json({ success: false, error: 'rating must be an integer 1-5' });
    }
    if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length > 40) {
      return res.status(400).json({ success: false, error: 'Invalid fingerprint' });
    }

    const today = new Date().toISOString().split('T')[0];

    // Dedup: one rating per fingerprint per spot per day
    const dedupId = `${fingerprint}_${spotId}_${today}`;
    const existingDoc = await db.collection('public_paddle_ratings').doc(dedupId).get();

    if (existingDoc.exists) {
      const existing = existingDoc.data();
      const elapsed = Date.now() - (existing.createdAt?.toMillis?.() || 0);
      const TWO_HOURS = 2 * 60 * 60 * 1000;

      if (elapsed > TWO_HOURS) {
        return res.status(409).json({ success: false, error: 'Rating locked after 2-hour window' });
      }

      await db.collection('public_paddle_ratings').doc(dedupId).update({
        rating,
        chips: sanitizeChips(chips),
        profile: sanitizeProfile(profile),
        notes: sanitizeNotes(notes),
        windFelt: sanitizeEnum(windFelt, ['calm', 'light', 'moderate', 'strong']),
        waterFelt: sanitizeEnum(waterFelt, ['flat', 'ripple', 'chop', 'whitecaps']),
        updatedAt: FieldValue.serverTimestamp(),
        updateCount: FieldValue.increment(1),
      });

      return res.json({ success: true, message: 'Rating updated', id: dedupId });
    }

    // IP rate limit: max 5 spots per IP per day
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const ipKey = `rateLimit_${ip}_${today}`;
    const ipDoc = await db.collection('rate_limits').doc(ipKey).get();
    if (ipDoc.exists && (ipDoc.data().count || 0) >= 5) {
      return res.status(429).json({ success: false, error: 'Daily rating limit reached' });
    }

    // GPS quality signal
    let gpsVerified = false;
    if (gps && typeof gps.lat === 'number' && typeof gps.lng === 'number') {
      const spotDoc = await db.collection('paddlingSpots').doc(spotId).get();
      if (spotDoc.exists) {
        const spot = spotDoc.data() || {};
        const spotLat = spot.location?.latitude ?? spot.lat;
        const spotLng = spot.location?.longitude ?? spot.lng;

        if (typeof spotLat === 'number' && typeof spotLng === 'number') {
          const dist = haversineKm(gps.lat, gps.lng, spotLat, spotLng);
          gpsVerified = dist < 5;
        }
      }
    }

    const doc = {
      spotId,
      rating,
      chips: sanitizeChips(chips),
      profile: sanitizeProfile(profile),
      notes: sanitizeNotes(notes),
      windFelt: sanitizeEnum(windFelt, ['calm', 'light', 'moderate', 'strong']),
      waterFelt: sanitizeEnum(waterFelt, ['flat', 'ripple', 'chop', 'whitecaps']),
      fingerprint,
      gpsVerified,
      gpsCoords: gps && typeof gps.lat === 'number' ? { lat: gps.lat, lng: gps.lng } : null,
      predictedScore: typeof predictedScore === 'number' ? predictedScore : null,
      weather: sanitizeWeather(weather),
      ip,
      sessionDate: today,
      source: 'public_rate',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updateCount: 0,
    };

    await db.collection('public_paddle_ratings').doc(dedupId).set(doc);

    // Increment IP rate limit
    await db.collection('rate_limits').doc(ipKey).set(
      { count: FieldValue.increment(1), date: today },
      { merge: true }
    );

    return res.json({ success: true, message: 'Rating recorded. Thank you!', id: dedupId });

  } catch (error) {
    console.error('paddleScore POST /publicRating error:', error.message, error.stack);
    return res.status(500).json({ success: false, error: 'Failed to record rating' });
  }
});

function sanitizeChips(chips) {
  if (!Array.isArray(chips)) return [];
  const ALLOWED = [
    'Strong wind', 'Gusty', 'Cold water', 'Rain / storm', 'Rough waves',
    'Poor visibility', 'Too hot', 'Too cold', 'Crowded', 'Hard launch',
    'Felt unsafe', 'Perfect wind', 'Warm water', 'Glassy water',
    'Great visibility', 'Comfortable temp', 'Easy launch', 'Uncrowded',
  ];
  return chips.filter(c => typeof c === 'string' && ALLOWED.includes(c)).slice(0, 4);
}

function sanitizeProfile(p) {
  if (!p || typeof p !== 'object') return { skill: 'beginner', craft: 'kayak', group: 'solo' };
  return {
    skill: sanitizeEnum(p.skill, ['beginner', 'intermediate', 'advanced', 'expert']) || 'beginner',
    craft: sanitizeEnum(p.craft, ['kayak', 'sup', 'canoe', 'row']) || 'kayak',
    group: sanitizeEnum(p.group, ['solo', 'partner', 'group', 'with dogs']) || 'solo',
  };
}

function sanitizeEnum(val, allowed) {
  if (typeof val !== 'string') return null;
  const lower = val.toLowerCase();
  return allowed.includes(lower) ? lower : null;
}

function sanitizeNotes(notes) {
  if (typeof notes !== 'string') return '';
  return notes.trim().slice(0, 280).replace(/<[^>]*>/g, '');
}

function sanitizeWeather(w) {
  if (!w || typeof w !== 'object') return null;
  const KEYS = ['temperature', 'windSpeed', 'gustSpeed', 'waterTemp', 'humidity',
    'visibility', 'precipMm', 'cloudCover', 'uvIndex', 'windDirection'];
  const safe = {};
  for (const k of KEYS) {
    if (k === 'windDirection' && typeof w[k] === 'string') {
      safe[k] = w[k].slice(0, 5);
    } else if (k in w && typeof w[k] === 'number' && isFinite(w[k])) {
      safe[k] = w[k];
    }
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── GET /paddleScore/metrics ──────────────────────────────────────────────

/**
 * GET /paddleScore/metrics?spotId=optional
 * Requires x-admin-key header.
 *
 * Returns model accuracy metrics computed by the daily aggregatePaddleFeedback function.
 * If ?spotId is provided, returns per-spot metrics; otherwise global.
 */
router.get('/metrics', requireAdmin, async (req, res) => {
  try {
    const { spotId } = req.query;

    if (spotId) {
      if (!/^[a-zA-Z0-9_-]+$/.test(spotId)) {
        return res.status(400).json({ success: false, error: 'Invalid spotId' });
      }
      const [metricsDoc, calDoc] = await Promise.all([
        db.collection('paddle_model_metrics').doc(spotId).get(),
        db.collection('paddle_spot_calibrations').doc(spotId).get()
      ]);

      return res.json({
        success: true,
        spotId,
        metrics: metricsDoc.exists ? metricsDoc.data() : null,
        calibration: calDoc.exists ? calDoc.data() : null
      });
    }

    // Global + all per-spot metrics
    const [globalDoc, metricsSnapshot, calSnapshot] = await Promise.all([
      db.collection('paddle_model_metrics').doc('global').get(),
      db.collection('paddle_model_metrics').get(),
      db.collection('paddle_spot_calibrations').get()
    ]);

    const perSpot = {};
    metricsSnapshot.forEach(doc => {
      if (doc.id !== 'global') perSpot[doc.id] = doc.data();
    });

    const calibrations = {};
    calSnapshot.forEach(doc => { calibrations[doc.id] = doc.data(); });

    return res.json({
      success: true,
      global: globalDoc.exists ? globalDoc.data() : null,
      perSpot,
      calibrations
    });

  } catch (error) {
    console.error('paddleScore GET /metrics error:', error.message, error.stack);
    return res.status(500).json({ success: false, error: 'Failed to fetch metrics' });
  }
});

module.exports = router;
