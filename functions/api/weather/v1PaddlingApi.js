// functions/api/weather/v1PaddlingApi.js
//
// /api/v1/* — the VERSIONED, METERED paddling API: the surface a third party
// (or a future paid tier) integrates against.
//
// Why a separate router instead of key-gating the existing paths:
//   • the unversioned routes stay anonymous for kaayko.com itself — no
//     breakage, no key shipped to a browser;
//   • this surface exposes READ endpoints only (no submitEntry, no admin);
//   • the response shape here is a deliberate contract, not whatever the
//     internal serializer happens to return, so internal refactors can't
//     silently break a paying consumer.
//
// Auth: X-API-Key with scope `read:paddling` (reuses the existing key store,
// per-key per-minute quotas and usage counters in apiKeyMiddleware).
// Versioning: additive changes only; a breaking change ships as /v2.

const express = require('express');
const router = express.Router();
const { getFirestore } = require('firebase-admin/firestore');
const { requireApiKey } = require('../../middleware/apiKeyMiddleware');
const PaddleScoreCache = require('../../cache/paddleScoreCache');
const { isPublicPaddlingSpot } = require('./communitySpotVisibility');
const { applyCraftAdjustment, CRAFT_PROFILES, CRAFT_IDS } = require('./craftAdjustments');
const { getPreparationTips, renderTipDetail } = require('./paddleTips');
const { getHydrology } = require('./hydrologyService');
const { computePaddleScoreForSpot } = require('./paddleScoreCompute');
const { ALGORITHM_VERSION, TIERS } = require('./scoringConstants');
const { sendError, setPublicCache } = require('../lib/apiResponse');

const db = getFirestore();
const SCOPE = ['read:paddling'];

// Every v1 response carries the contract version it was produced under.
router.use((req, res, next) => {
  res.set('X-Kaayko-Api-Version', '1');
  res.set('X-Kaayko-Algorithm-Version', ALGORITHM_VERSION);
  next();
});

/** Stable public shape for a score — decoupled from internal serializers. */
function scoreDto(score) {
  if (!score) return null;
  return {
    rating: score.rating,                       // 1–5, half-point steps (displayed value)
    interpretation: score.interpretation,       // 'Worth it' | 'Careful' | 'Hard pass'
    confidence: score.confidence ?? null,
    craft: score.craft || 'kayak',
    craftAdjustment: score.craftAdjustment
      ? { delta: score.craftAdjustment.delta, notes: score.craftAdjustment.notes }
      : null,
    safetyPenalties: (score.penaltyDetails || []).map(p => ({ code: p.code, amount: p.amount })),
    modelUsed: !!score.mlModelUsed,
    algorithmVersion: score.algorithmVersion || ALGORITHM_VERSION,
    computedAt: score.computedAt || null
  };
}

/** Stable public shape for conditions — metric, explicitly unit-suffixed. */
function conditionsDto(c) {
  if (!c) return null;
  return {
    temperatureC: c.temperature ?? null,
    windSpeedKph: c.windSpeed ?? null,
    gustSpeedKph: c.gustSpeed ?? null,
    windDirection: c.windDirection ?? null,
    waterTempC: c.waterTemp ?? null,
    humidityPct: c.humidity ?? null,
    cloudCoverPct: c.cloudCover ?? null,
    uvIndex: c.uvIndex ?? null,
    visibilityKm: c.visibility ?? null,
    precipMm: c.precipMm ?? null
  };
}

function spotDto(id, data, score) {
  return {
    id,
    name: data.title || data.lakeName || id,
    region: data.subtitle || '',
    waterType: data.waterType || null,
    coordinates: {
      latitude: data.location?.latitude ?? null,
      longitude: data.location?.longitude ?? null
    },
    amenities: {
      parking: data.parkingAvl === 'Y',
      restrooms: data.restroomsAvl === 'Y'
    },
    curated: data.communitySubmission !== true,
    score: scoreDto(score),
    conditions: conditionsDto(score?.conditions)
  };
}

// ── GET /v1/meta — self-describing contract ────────────────────────────────
router.get('/meta', requireApiKey(SCOPE), (req, res) => {
  setPublicCache(res, 3600, 3600);
  return res.json({
    success: true,
    apiVersion: '1',
    algorithmVersion: ALGORITHM_VERSION,
    scale: {
      range: [1, 5],
      step: 0.5,
      tiers: [
        { label: 'Worth it',  min: TIERS.WORTH_IT },
        { label: 'Careful',   min: TIERS.CAREFUL },
        { label: 'Hard pass', min: 1 }
      ]
    },
    craftTypes: CRAFT_IDS.map(id => ({ id, label: CRAFT_PROFILES[id].label })),
    units: 'metric',
    documentation: 'https://kaayko.com/paddlingout/methodology'
  });
});

// ── GET /v1/spots — curated spots with current scores ──────────────────────
router.get('/spots', requireApiKey(SCOPE), async (req, res) => {
  try {
    const craft = req.query.craft;
    const [snapshot, allScores] = await Promise.all([
      db.collection('paddlingSpots').get(),
      new PaddleScoreCache().getAll()
    ]);

    const spots = snapshot.docs
      .filter(d => isPublicPaddlingSpot(d.data()))
      .map(d => spotDto(d.id, d.data(), applyCraftAdjustment(allScores.get(d.id) || null, craft)));

    setPublicCache(res, 60, 120);
    return res.json({ success: true, count: spots.length, spots });
  } catch (err) {
    console.error('v1 GET /spots error:', err.message);
    return sendError(res, 'INTERNAL');
  }
});

// ── GET /v1/spots/:id — one spot, with tips and river hydrology ────────────
router.get('/spots/:id', requireApiKey(SCOPE), async (req, res) => {
  const id = req.params.id;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return sendError(res, 'BAD_REQUEST', 'Invalid spot id');

  try {
    const [docSnap, cachedScore] = await Promise.all([
      db.collection('paddlingSpots').doc(id).get(),
      new PaddleScoreCache().get(id)
    ]);
    if (!docSnap.exists || !isPublicPaddlingSpot(docSnap.data())) {
      return sendError(res, 'NOT_FOUND', 'Spot not found');
    }

    const data = docSnap.data();
    const score = applyCraftAdjustment(cachedScore || null, req.query.craft);
    const hydrology = data.hydrology ? await getHydrology(data.hydrology).catch(() => null) : null;

    const body = spotDto(id, data, score);
    body.tips = score ? getPreparationTips({
      conditions: score.conditions,
      craft: req.query.craft,
      spot: { cellCoverage: data.cellCoverage, localTips: data.localTips },
      hydrology,
      warningMessages: score.warnings?.messages || []
    }).map(t => ({
      code: t.code,
      title: t.title,
      detail: renderTipDetail(t),          // rendered metric — this surface is metric
      values: t.values || null             // structured values kept for consumers who reformat
    })) : [];
    body.warnings = score?.warnings?.messages || [];
    body.hydrology = hydrology ? {
      gaugeId: hydrology.gaugeId,
      gaugeName: hydrology.gaugeName,
      dischargeCms: hydrology.discharge?.cms ?? null,
      gageHeightM: hydrology.gageHeight?.m ?? null,
      percentileOfNormal: hydrology.pctOfNormal,
      band: hydrology.pctOfNormalBand,
      stale: hydrology.stale,
      source: hydrology.source,
      gaugeUrl: hydrology.gaugeUrl
    } : null;

    setPublicCache(res, 60, 120);
    return res.json({ success: true, spot: body });
  } catch (err) {
    console.error(`v1 GET /spots/${id} error:`, err.message);
    return sendError(res, 'INTERNAL');
  }
});

// ── GET /v1/score?lat=&lng=[&craft=] — score any coordinate ────────────────
router.get('/score', requireApiKey(SCOPE), async (req, res) => {
  const lat = parseFloat(req.query.lat ?? req.query.latitude);
  const lng = parseFloat(req.query.lng ?? req.query.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return sendError(res, 'BAD_COORDS');
  }

  try {
    const score = await computePaddleScoreForSpot(
      { id: null, lat, lng, name: `${lat},${lng}` },
      { limitedWeatherFallback: true }
    );
    if (!score) return sendError(res, 'UPSTREAM_UNAVAILABLE', 'Weather data unavailable for this location');

    const adjusted = applyCraftAdjustment(score, req.query.craft) || score;
    setPublicCache(res, 60, 120);
    return res.json({
      success: true,
      coordinates: { latitude: lat, longitude: lng },
      score: scoreDto(adjusted),
      conditions: conditionsDto(adjusted.conditions),
      warnings: adjusted.warnings?.messages || []
    });
  } catch (err) {
    console.error('v1 GET /score error:', err.message);
    return sendError(res, 'INTERNAL');
  }
});

module.exports = router;
