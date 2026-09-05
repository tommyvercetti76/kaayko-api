// functions/api/weather/paddleScore.js
//
// GET  /paddleScore              — live ML-powered paddle score for any location
// POST /paddleScore/feedback     — record user's actual experience vs prediction
// POST /paddleScore/publicRating — public paddle rating from QR/link (rate.html)
// GET  /paddleScore/metrics      — admin: model accuracy stats (requires x-admin-key)

const express = require('express');
const { getClientIp, hashClientIp } = require('../kortex/clientIp');

/**
 * Stable, non-identifying caller key for rate limiting and abuse controls.
 *
 * Every call site here previously did `x-forwarded-for.split(',')[0]`, which is
 * the CLIENT-SUPPLIED first hop — anyone could mint unlimited buckets by
 * prepending a random address, and the raw IP was then written into
 * public_paddle_ratings. api/kortex/clientIp.js resolves the chain
 * right-to-left, skipping private ranges, and hashes under a server-side salt.
 *
 * Returns a hash, never an IP. When no public IP can be established the caller
 * falls into one shared bucket, which is the safe failure mode for a limiter.
 */
/**
 * The model's predicted score as sent by the client, coerced and bounded.
 * `typeof x === 'number'` silently discarded the string values the rate page
 * actually sends, so this label was usually null in the training set.
 * @returns {number|null} 0-5 with 2 decimals, or null when unusable
 */
function coerceScore(value) {
  // Number(null) is 0 and Number('') is 0, both of which are in range — without
  // this guard an absent score would be recorded as a genuine rating of zero.
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 5) return null;
  return Math.round(n * 100) / 100;
}

function callerKey(req) {
  const ip = getClientIp(req);
  return (ip && hashClientIp(ip)) || 'unknown';
}

const crypto = require('crypto');
const router = express.Router();
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { createInputMiddleware } = require('./inputStandardization');
const { computePaddleScoreForSpot } = require('./paddleScoreCompute');
const PaddleScoreCache = require('../../cache/paddleScoreCache');
const { requireAdmin } = require('../../middleware/authMiddleware');
const { isPublicPaddlingSpot } = require('./communitySpotVisibility');
const { applyCraftAdjustment, CRAFT_IDS } = require('./craftAdjustments');
const { getPreparationTips } = require('./paddleTips');
const { setPublicCache } = require('../lib/apiResponse');

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
    const craft = req.query.craft; // optional boat type; kayak/absent = identity

    let loc;
    let locationName;
    let resolvedSpotId = spotId || null;
    let spotEnrichment = null; // { cellCoverage, localTips } when the spot doc is in hand

    // Coordinate-only requests that land on a known spot must score identically
    // to the spotId path (same cache doc, same calibration offset) — the same
    // water previously differed by up to ±1.0 across surfaces.
    if (!spotId && Number.isFinite(latitude) && Number.isFinite(longitude)) {
      try {
        const spotsSnap = await db.collection('paddlingSpots').get();
        for (const doc of spotsSnap.docs) {
          const d = doc.data();
          if (!isPublicPaddlingSpot(d)) continue;
          const sLat = d.location?.latitude, sLng = d.location?.longitude;
          if (Number.isFinite(sLat) && Number.isFinite(sLng) &&
              haversineKm(latitude, longitude, sLat, sLng) < 0.3) {
            resolvedSpotId = doc.id;
            break;
          }
        }
      } catch { /* non-fatal — score as free coordinates */ }
    }

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
      if (!isPublicPaddlingSpot(data)) {
        return res.status(404).json({
          success: false,
          error: 'Paddling spot not found',
          spotId,
          available_via: '/paddlingOut'
        });
      }
      if (!data.location?.latitude || !data.location?.longitude) {
        return res.status(500).json({ success: false, error: 'Spot has no coordinates' });
      }
      loc = { id: spotId, lat: data.location.latitude, lng: data.location.longitude, name: data.lakeName || spotId };
      locationName = loc.name;
      spotEnrichment = { cellCoverage: data.cellCoverage || null, localTips: data.localTips || [] };
    } else {
      loc = { id: resolvedSpotId, lat: latitude, lng: longitude, name: `${latitude},${longitude}` };
      locationName = loc.name;
    }

    console.log(`paddleScore request: ${locationName}${resolvedSpotId && !spotId ? ` (matched spot ${resolvedSpotId})` : ''}`);

    // Check paddle_score_cache for known spots (spotId-keyed)
    if (resolvedSpotId) {
      const cache = new PaddleScoreCache();
      const cached = await cache.get(resolvedSpotId);
      if (cached) {
        console.log(`paddleScore: cache hit for ${resolvedSpotId}`);
        const adjustedCached = applyCraftAdjustment(cached, craft);
        // Public data, 15-min cache turnover upstream — safe for CDN reuse.
        // Query string (incl. ?craft=) is part of the cache key.
        setPublicCache(res, 60, 120);
        return res.json({
          success: true,
          location: { name: locationName, coordinates: { latitude: loc.lat, longitude: loc.lng } },
          paddleScore: adjustedCached,
          tips: getPreparationTips({
            conditions: cached.conditions,
            craft,
            spot: spotEnrichment,
            warningMessages: cached.warnings?.messages || []
          }),
          warnings: cached.warnings,
          conditions: cached.conditions,
          metadata: {
            source: cached.predictionSource,
            cached: true,
            cachedAt: cached.computedAt,
            algorithmVersion: cached.algorithmVersion || null,
            response_time_ms: Date.now() - startTime
          }
        });
      }
    }

    // Load dynamic calibration offset for this spot (if any)
    const calibrationOffsets = new Map();
    if (resolvedSpotId) {
      try {
        const calDoc = await db.collection('paddle_spot_calibrations').doc(resolvedSpotId).get();
        if (calDoc.exists && typeof calDoc.data().biasOffset === 'number') {
          calibrationOffsets.set(resolvedSpotId, calDoc.data().biasOffset);
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
    if (resolvedSpotId) {
      const cache = new PaddleScoreCache();
      cache.set(resolvedSpotId, score).catch(err =>
        console.warn(`paddleScore: failed to write cache for ${resolvedSpotId}: ${err.message}`)
      );
    }

    // Craft layer applies AFTER the base score is cached — the cache stays craft-neutral
    const adjusted = applyCraftAdjustment(score, craft) || score;

    setPublicCache(res, 60, 120);
    return res.json({
      success: true,
      location: { name: locationName, coordinates: { latitude: loc.lat, longitude: loc.lng } },
      paddleScore: {
        rating: adjusted.rating,
        ratingPrecise: adjusted.ratingPrecise,
        interpretation: adjusted.interpretation,
        baseRatingPrecise: adjusted.baseRatingPrecise,
        craft: adjusted.craft,
        craftAdjustment: adjusted.craftAdjustment,
        confidence: score.confidence,
        mlModelUsed: score.mlModelUsed,
        predictionSource: score.predictionSource,
        modelType: score.modelType,
        riskClass: score.riskClass,
        explanations: score.explanations,
        originalMLRating: score.originalMLRating,
        calibrationApplied: score.calibrationApplied,
        adjustments: score.adjustments,
        penaltiesApplied: score.penaltiesApplied,
        penaltyDetails: score.penaltyDetails,
        dynamicOffset: score.dynamicOffset,
        algorithmVersion: score.algorithmVersion,
        night: score.night || null,        // daylight-only gate (see methodology)
        isGoldStandard: !!score.mlModelUsed
      },
      tips: getPreparationTips({
        conditions: score.conditions,
        craft,
        spot: spotEnrichment,
        warningMessages: score.warnings?.messages || []
      }),
      warnings: score.warnings,
      conditions: score.conditions,
      metadata: {
        source: score.predictionSource,
        cached: false,
        computedAt: score.computedAt,
        algorithmVersion: score.algorithmVersion,
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
    const { spotId, actualScore, conditions, userId, fingerprint } = req.body;

    // Validate required fields
    if (!spotId || typeof spotId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(spotId)) {
      return res.status(400).json({ success: false, error: 'Invalid or missing spotId' });
    }
    if (typeof actualScore !== 'number' || actualScore < 1 || actualScore > 5) {
      return res.status(400).json({ success: false, error: 'actualScore must be a number between 1 and 5' });
    }

    const today = new Date().toISOString().split('T')[0];
    const ipHash = callerKey(req);   // hashed, resolved chain — never a raw IP

    // IP rate limit: max 5 feedback submissions per IP per day (mirrors /publicRating)
    const ipKey = `fbLimit_${ipHash}_${today}`;
    const ipDoc = await db.collection('rate_limits').doc(ipKey).get();
    if (ipDoc.exists && (ipDoc.data().count || 0) >= 5) {
      return res.status(429).json({ success: false, error: 'Daily feedback limit reached' });
    }

    // Dedup: one feedback per client per spot per day. Deterministic doc id makes
    // retries idempotent and flooding a no-op. Client fingerprint preferred, IP hash fallback.
    const clientKey = (typeof fingerprint === 'string' && fingerprint.length > 0 && fingerprint.length <= 40)
      ? fingerprint
      : ipHash;   // already an HMAC of the resolved client IP — no raw IP to re-hash
    const docId = `fb_${clientKey}_${spotId}_${today}`;

    // The prediction being scored against is server-authoritative: read it from
    // paddle_score_cache rather than trusting a client-supplied pair, which would
    // allow calibration poisoning. No cached score → feedback stored but excluded
    // from calibration (aggregator skips non-numeric predictedScore).
    let serverPredictedScore = null;
    try {
      const cached = await new PaddleScoreCache().get(spotId);
      if (Number.isFinite(cached?.rating)) serverPredictedScore = cached.rating;
    } catch { /* non-fatal */ }

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

    const docRef = db.collection('paddle_predictions_feedback').doc(docId);
    const alreadyExists = (await docRef.get()).exists;

    await docRef.set({
      spotId,
      userId: typeof userId === 'string' ? userId : null,
      actualScore,
      predictedScore: serverPredictedScore,
      conditions: safeConditions,
      timestamp: FieldValue.serverTimestamp(),
      sessionDate: today
    });

    // Only count new submissions against the daily limit
    if (!alreadyExists) {
      await db.collection('rate_limits').doc(ipKey).set(
        { count: FieldValue.increment(1), date: today },
        { merge: true }
      );
    }

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

    // The spot must exist AND be publicly visible before we accept a rating for
    // it. This used to be checked only when GPS was supplied, so ratings could
    // be written against typo'd, unpublished or invented spot ids — poisoning
    // the training set and creating documents nobody could ever reconcile.
    const ratedSpotDoc = await db.collection('paddlingSpots').doc(spotId).get();
    if (!ratedSpotDoc.exists || !isPublicPaddlingSpot(ratedSpotDoc.data())) {
      return res.status(404).json({ success: false, error: 'Unknown spot' });
    }
    const ratedSpot = ratedSpotDoc.data() || {};

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
    const ipHash = callerKey(req);   // hashed, resolved chain — never a raw IP
    const ipKey = `rateLimit_${ipHash}_${today}`;
    const ipDoc = await db.collection('rate_limits').doc(ipKey).get();
    if (ipDoc.exists && (ipDoc.data().count || 0) >= 5) {
      return res.status(429).json({ success: false, error: 'Daily rating limit reached' });
    }

    // GPS quality signal
    let gpsVerified = false;
    if (gps && typeof gps.lat === 'number' && typeof gps.lng === 'number') {
      const spotLat = ratedSpot.location?.latitude ?? ratedSpot.lat;
      const spotLng = ratedSpot.location?.longitude ?? ratedSpot.lng;
      if (typeof spotLat === 'number' && typeof spotLng === 'number') {
        gpsVerified = haversineKm(gps.lat, gps.lng, spotLat, spotLng) < 5;
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
      predictedScore: coerceScore(predictedScore),
      weather: sanitizeWeather(weather),
      // Raw IP is never stored. This is an HMAC under a server-side salt,
      // enough to spot abuse, useless for identifying a person.
      ipHash,
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
    craft: sanitizeEnum(p.craft, CRAFT_IDS) || 'kayak',
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
    const [globalDoc, metricsSnapshot, calSnapshot, enrichDoc] = await Promise.all([
      db.collection('paddle_model_metrics').doc('global').get(),
      db.collection('paddle_model_metrics').get(),
      db.collection('paddle_spot_calibrations').get(),
      db.collection('enrichment_status').doc('global').get()
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
      calibrations,
      enrichment: enrichDoc.exists ? enrichDoc.data() : null
    });

  } catch (error) {
    console.error('paddleScore GET /metrics error:', error.message, error.stack);
    return res.status(500).json({ success: false, error: 'Failed to fetch metrics' });
  }
});

// ─── POST /paddleScores (batch) ────────────────────────────────────────────
//
// Batch score endpoint — solves N+1 problem for search results.
// Frontend makes 1 request for 15 locations instead of 15 individual requests.
//
// POST /paddleScores
// Body: { locations: [ { lat, lng }, ... ] }
// Response: { success, scores: [ { lat, lng, score, rating }, ... ] }

router.post('/batch', async (req, res) => {
  const startTime = Date.now();

  try {
    const { locations, craft } = req.body;

    // Validate input
    if (!Array.isArray(locations)) {
      return res.status(400).json({
        success: false,
        error: 'Body must contain locations array',
        response_time_ms: Date.now() - startTime
      });
    }

    if (locations.length === 0) {
      return res.json({
        success: true,
        scores: [],
        response_time_ms: Date.now() - startTime
      });
    }

    if (locations.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 50 locations per batch',
        response_time_ms: Date.now() - startTime
      });
    }

    // IP rate limit: batch fans out to external weather/ML calls, so an anonymous
    // loop must hit a ceiling. 100/day covers heavy legitimate search use.
    const today = new Date().toISOString().split('T')[0];
    const ipHash = callerKey(req);   // hashed, resolved chain — never a raw IP
    const ipKey = `batchLimit_${ipHash}_${today}`;
    const ipDoc = await db.collection('rate_limits').doc(ipKey).get();
    if (ipDoc.exists && (ipDoc.data().count || 0) >= 100) {
      return res.status(429).json({ success: false, error: 'Daily batch limit reached' });
    }
    db.collection('rate_limits').doc(ipKey).set(
      { count: FieldValue.increment(1), date: today },
      { merge: true }
    ).catch(() => { /* non-fatal */ });

    // Validate each location — finite numbers within coordinate ranges
    const invalidIdx = locations.findIndex(loc =>
      !Number.isFinite(loc?.lat) || !Number.isFinite(loc?.lng) ||
      loc.lat < -90 || loc.lat > 90 || loc.lng < -180 || loc.lng > 180
    );
    if (invalidIdx !== -1) {
      return res.status(400).json({
        success: false,
        error: `Location ${invalidIdx}: lat/lng must be finite coordinates`,
        response_time_ms: Date.now() - startTime
      });
    }
    const validated = locations.map(loc => ({ lat: loc.lat, lng: loc.lng }));

    // Known-spot short-circuit: coordinates within ~300 m of a curated spot serve
    // that spot's warmed cache entry instead of recomputing.
    const cache = new PaddleScoreCache();
    let knownSpots = [];
    try {
      const spotsSnap = await db.collection('paddlingSpots').get();
      knownSpots = spotsSnap.docs
        .filter(doc => isPublicPaddlingSpot(doc.data()))
        .map(doc => {
          const d = doc.data();
          return { id: doc.id, lat: d.location?.latitude, lng: d.location?.longitude };
        })
        .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    } catch { /* non-fatal — fall through to coordinate scoring */ }

    // Coordinate cache key: 3 decimals (~110 m) so repeated searches over the same
    // water reuse one computation for the cache TTL window.
    const coordKey = ({ lat, lng }) =>
      `coord_${(Math.round(lat * 1000) / 1000).toFixed(3)}_${(Math.round(lng * 1000) / 1000).toFixed(3)}`;

    // Dedupe compute work within the request (repeated/nearby coordinates)
    const scoreByKey = new Map();

    const resolveScore = async (loc) => {
      const spot = knownSpots.find(s => haversineKm(loc.lat, loc.lng, s.lat, s.lng) < 0.3);
      const key = spot ? `spot_${spot.id}` : coordKey(loc);
      if (scoreByKey.has(key)) return scoreByKey.get(key);

      const promise = (async () => {
        if (spot) {
          const cachedSpot = await cache.get(spot.id);
          if (cachedSpot) return cachedSpot;
        }
        const cachedCoord = await cache.get(coordKey(loc));
        if (cachedCoord) return cachedCoord;

        const computed = await computePaddleScoreForSpot(
          { id: spot?.id || null, lat: loc.lat, lng: loc.lng, name: `${loc.lat},${loc.lng}` },
          { calibrationOffsets: new Map(), limitedWeatherFallback: true }
        );
        if (computed) {
          cache.set(spot ? spot.id : coordKey(loc), computed).catch(() => {});
        }
        return computed;
      })().catch(err => {
        console.warn(`Batch score compute failed for ${loc.lat},${loc.lng}:`, err.message);
        return null;
      });

      scoreByKey.set(key, promise);
      return promise;
    };

    const scores = await Promise.all(validated.map(resolveScore));

    // Map results back to locations (craft layer applied post-cache, one craft per batch)
    const results = validated.map((loc, idx) => {
      const score = applyCraftAdjustment(scores[idx], craft);
      return {
        lat: loc.lat,
        lng: loc.lng,
        score: score ? score.rating : null,
        rating: score ? score.rating : null,
        ratingPrecise: score ? (score.ratingPrecise ?? score.rating) : null,
        interpretation: score ? score.interpretation : null,
        confidence: score ? score.confidence : null,
        algorithmVersion: score ? (score.algorithmVersion ?? null) : null
      };
    });

    return res.json({
      success: true,
      scores: results,
      response_time_ms: Date.now() - startTime
    });

  } catch (error) {
    console.error('paddleScore POST /batch error:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      error: 'Failed to compute batch scores',
      response_time_ms: Date.now() - startTime
    });
  }
});

module.exports = router;
