// functions/api/weather/paddleScore.js
//
// GET  /paddleScore          — live ML-powered paddle score for any location
// POST /paddleScore/feedback — record user's actual experience vs prediction
// GET  /paddleScore/metrics  — admin: model accuracy stats (requires x-admin-key)

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
    console.error('paddleScore GET / error:', error.message);
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
    console.error('paddleScore POST /feedback error:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to record feedback' });
  }
});

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
    console.error('paddleScore GET /metrics error:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch metrics' });
  }
});

module.exports = router;
