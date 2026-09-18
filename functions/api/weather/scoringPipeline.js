// functions/api/weather/scoringPipeline.js
//
// The ONE scoring core: predict → calibrate → penalize → offset → precise/snap →
// interpret (→ warnings). Every compute path (paddleScoreCompute for current
// conditions, fastForecast per-hour, /forecast) must run through scoreFromFeatures
// so the same water can never score differently across surfaces.
//
// Pure computation — no Express, no Firestore.

const crypto = require('crypto');
const { getPrediction } = require('./mlService');
const { calibrateModelPrediction } = require('./modelCalibration');
const { applyScoreCalibration } = require('./scoreCalibration');
const { applyEnhancedPenalties } = require('./paddlePenalties');
const { getSmartWarnings } = require('./smartWarnings');
const { ALGORITHM_VERSION, getInterpretation, clampRating, snapHalf, roundPrecise } = require('./scoringConstants');

/**
 * Pick the raw WeatherAPI marine hour matching the location's local hour.
 * Marine data is hourly; using hour[0] (midnight) all day distorts water temp
 * and wave inputs.
 */
function selectMarineHour(marineData, localHour = 0) {
  const hours = marineData?.forecast?.forecastday?.[0]?.hour;
  if (!Array.isArray(hours) || hours.length === 0) return null;
  return hours[Math.max(0, Math.min(hours.length - 1, localHour))] || hours[0];
}

/**
 * Build the marine shape applyEnhancedPenalties/pickValue expects.
 * getMarineData returns raw WeatherAPI JSON; nothing used to construct this
 * shape, so swell/steepness/thunder-code penalties never fired anywhere.
 */
function buildPenaltyMarine(marineHour) {
  if (!marineHour) return null;
  return {
    rawMarineHour: marineHour,
    waveHeight: marineHour.sig_ht_mt,
    swellHeight: marineHour.swell_ht_mt,
    swellPeriod: marineHour.swell_period_secs,
    swellDirection: marineHour.swell_dir,
    waterTemp: marineHour.water_temp_c
  };
}

/**
 * Parse the LOCATION-LOCAL clock of the hour being scored.
 *
 * Calibration rules that depend on the time of year or the time of day must
 * read the local clock of the scored hour, never the server's. Cloud Functions
 * run in UTC, so `new Date()` put an Indian lake 5.5 h out and gave a Tasmanian
 * lake the northern hemisphere's season.
 *
 * @param {string|Date|null} localTime  "YYYY-MM-DD HH:mm" (WeatherAPI local
 *        time / forecast hour), or a Date
 * @param {number|null} fallbackHour  mlFeatures.hour, already location-local
 * @returns {{localHour: number|null, localMonth: number|null}} nulls, never
 *          guesses — downstream rules stand down on null.
 */
function parseLocalClock(localTime, fallbackHour = null) {
  let localHour = null;
  let localMonth = null;

  if (localTime instanceof Date && !Number.isNaN(localTime.getTime())) {
    // A Date carries no zone of its own; callers passing one must already have
    // shifted it to location-local.
    localHour = localTime.getHours();
    localMonth = localTime.getMonth() + 1;
  } else if (typeof localTime === 'string' && localTime.trim()) {
    const [datePart, clockPart] = localTime.trim().split(/[ T]/);
    const month = parseInt(String(datePart).split('-')[1], 10);
    if (Number.isInteger(month) && month >= 1 && month <= 12) localMonth = month;
    if (clockPart) {
      const hour = parseInt(clockPart.split(':')[0], 10);
      if (Number.isInteger(hour) && hour >= 0 && hour <= 23) localHour = hour;
    }
  }

  if (localHour === null && Number.isInteger(fallbackHour) && fallbackHour >= 0 && fallbackHour <= 23) {
    localHour = fallbackHour;
  }

  return { localHour, localMonth };
}

// ── Confidence: ONE representation, produced in ONE place ───────────────────
//
// AUDIT-2026-09-18 #19. Three generators feed this pipeline and each stated
// confidence in its own type:
//
//   localModel.js      confidence: 'measured'  + uncertainty {residualMae, ci95, nLabels, cv}
//   Cloud Run ml-model confidence: 0.99        (a number the service asserts, never earned
//                                               against the label corpus)
//   paddleLlmClient    confidence: 0.8         (same)
//   fallback heuristic confidence: 0.7         (a hand-written rule stack that has NEVER
//                                               been evaluated against anything)
//
// and scoreFromFeatures used to publish whichever arrived, defaulting to the
// string 'high'. A client received "high" for one spot and 0.7 for the next and
// could neither compare nor render them.
//
// The fix is NOT to coerce everything to a number. 0.99 and 0.7 are assertions;
// localModel's 'measured' is an out-of-fold error on 187 human labels. Flattening
// them onto one numeric axis would dress an unearned assertion as a measurement,
// which is the cardinal sin here. So `confidence` is a CLOSED STRING VOCABULARY,
// ordered, with the evidence kept beside it:
//
//   'measured'    the generator states its own out-of-fold error; `uncertainty` is present
//   'estimated'   a trained model produced it but states no error bar
//   'unvalidated' a heuristic produced it; nothing has ever been measured about it
//
// Ordering is explicit (CONFIDENCE_RANK) so a client can compare without parsing.
// `confidenceBasis` carries the rank, the producer, the raw value the producer
// declared, and the uncertainty block when there is one — nothing is discarded.
//
// The fallback's 0.7 becomes 'unvalidated', NOT 'estimated'. An unevaluated
// heuristic that reports 0.7 is exactly the over-confidence this project exists
// to refuse. And 'measured' is only ever awarded when a real uncertainty block
// is present: a caller that replays a cached 'measured' string without carrying
// the uncertainty forward is DOWNGRADED to 'estimated' rather than allowed to
// repeat a claim whose evidence it no longer holds.
const CONFIDENCE_LEVELS = ['unvalidated', 'estimated', 'measured'];
const CONFIDENCE_RANK = { unvalidated: 1, estimated: 2, measured: 3 };

function hasRealUncertainty(u) {
  return !!u && typeof u === 'object' && Number.isFinite(u.residualMae);
}

/**
 * Collapse any producer's confidence onto the closed vocabulary above.
 * Idempotent: re-running it on its own output returns the same level.
 *
 * @param {object} prediction  a getPrediction()-shaped result
 * @returns {{level: string, basis: object}}
 */
function normalizeConfidence(prediction = {}) {
  const declared = prediction.confidence ?? null;
  const uncertainty = hasRealUncertainty(prediction.uncertainty) ? prediction.uncertainty : null;
  const source = prediction.predictionSource || null;
  const degraded = prediction.degraded === true ||
    source === 'fallback-rules' || prediction.modelType === 'rule-based';

  let level;
  let reason;
  if (degraded) {
    // Nothing a never-evaluated heuristic asserts about itself is evidence.
    level = 'unvalidated';
    reason = 'heuristic_fallback';
  } else if (uncertainty) {
    level = 'measured';
    reason = 'out_of_fold_error_stated';
  } else if (declared === 'measured') {
    // Claimed without the evidence — refuse the claim, keep the score.
    level = 'estimated';
    reason = 'measured_claimed_without_uncertainty';
  } else {
    level = 'estimated';
    reason = 'model_states_no_error_bar';
  }

  return {
    level,
    basis: {
      level,
      rank: CONFIDENCE_RANK[level],
      // What the producer said before normalization. Kept so nothing is lost and
      // so a drift in any producer stays visible in the response.
      declared,
      declaredType: declared === null ? 'null' : typeof declared,
      source,
      reason,
      uncertainty
    }
  };
}

/**
 * Stable hash of the ML input vector — lets the warmer skip identical
 * re-predictions when the underlying weather cache hasn't changed.
 */
function hashMLInputs(mlFeatures) {
  const keys = Object.keys(mlFeatures).sort();
  const canon = keys.map(k => {
    const v = mlFeatures[k];
    return `${k}:${typeof v === 'number' ? Math.round(v * 100) / 100 : v}`;
  }).join('|');
  return crypto.createHash('sha1').update(canon).digest('hex').slice(0, 16);
}

/**
 * Run the full scoring pipeline over standardized features.
 *
 * @param {object} params
 * @param {object} params.mlFeatures  Output of standardizeForMLModel (correct marine hour included)
 * @param {object|null} params.marineHour  Raw WeatherAPI marine hour matching this score's hour
 * @param {Array|null} params.forecast  Standardized forecast day array (trend calibration)
 * @param {object} params.loc  { id?, lat, lng }
 * @param {number} params.dynamicOffset  Per-spot feedback offset (suppressed on major-penalty days)
 * @param {object|null} params.weatherData  Full standardized weather (warnings trend analysis)
 * @param {boolean} params.includeWarnings  Skip smart warnings (per-hour callers pass their own conditions)
 * @param {object|null} params.warningsConditions  Conditions object for getSmartWarnings
 * @param {object|null} params.previousMLResult  { mlInputsHash, originalMLRating, ... } to reuse an identical prediction
 * @param {string|Date|null} params.localTime  LOCATION-LOCAL timestamp of the hour
 *        being scored ("YYYY-MM-DD HH:mm"). Drives season- and hour-dependent
 *        calibration. Omit it and those rules stand down rather than guess.
 */
async function scoreFromFeatures({
  mlFeatures,
  marineHour = null,
  forecast = null,
  loc,
  dynamicOffset = 0,
  weatherData = null,
  includeWarnings = true,
  warningsConditions = null,
  previousMLResult = null,
  hydrologyContext = null,
  localTime = null
}) {
  const mlInputsHash = hashMLInputs(mlFeatures);
  const { localHour, localMonth } = parseLocalClock(localTime, mlFeatures.hour);

  // ML prediction — reuse the previous one when inputs are byte-identical
  // (the warmer recomputes every 15 min against a 2h weather cache).
  let prediction;
  if (previousMLResult && previousMLResult.mlInputsHash === mlInputsHash &&
      Number.isFinite(previousMLResult.originalMLRating)) {
    prediction = {
      success: true,
      rating: previousMLResult.originalMLRating,
      mlModelUsed: previousMLResult.mlModelUsed,
      predictionSource: previousMLResult.predictionSource,
      modelType: previousMLResult.modelType,
      confidence: previousMLResult.confidence,
      riskClass: previousMLResult.riskClass ?? null,
      explanations: previousMLResult.explanations ?? null,
      // A reused prediction inherits the DEGRADED state of the prediction it
      // reuses. Dropping it here would let a fallback-heuristic score launder
      // itself into looking model-generated on the next warmer cycle — the
      // reuse branch already lost `uncertainty` the same way.
      degraded: previousMLResult.degraded ?? false,
      degradedReason: previousMLResult.degradedReason ?? null,
      uncertainty: previousMLResult.uncertainty ?? null,
      reused: true
    };
  } else {
    prediction = await getPrediction(mlFeatures);
  }
  if (!prediction?.success) return null;

  // Normalize confidence ONCE, here, where all three producers converge.
  const { level: confidenceLevel, basis: confidenceBasis } = normalizeConfidence(prediction);

  // Heuristic calibration (forecast trend, seasonal, location, wind pattern).
  // The water-temperature term was removed 2026-09-18: it moved the published
  // score using an ESTIMATED water temperature the pipeline had already refused
  // to publish.
  const calibrated = calibrateModelPrediction(
    prediction.rating,
    {
      temperature: mlFeatures.temperature,
      windSpeed:   mlFeatures.windSpeed,
      gustSpeed:   mlFeatures.gustSpeed,
      humidity:    mlFeatures.humidity,
      cloudCover:  mlFeatures.cloudCover,
      uvIndex:     mlFeatures.uvIndex,
      visibility:  mlFeatures.visibility,
      precipMm:    mlFeatures.precipMm,
      precipChancePercent: mlFeatures.precipChancePercent
    },
    forecast,
    // Location AND the local clock of the scored hour. Season/hour rules read
    // these; without them they stand down instead of reading the server clock.
    { latitude: loc.lat, longitude: loc.lng, localHour, localMonth }
  );
  const calBase = calibrated.calibratedRatingPrecise ?? calibrated.calibratedRating;

  // ── Isotonic recalibration ────────────────────────────────────────────────
  // Sits between the score generator and the safety gate, on purpose.
  //
  // BEFORE the penalties, because the penalties are absolute safety
  // subtractions (a 27 mph day loses 2.0 whatever the model thought) and
  // recalibrating them away would defeat the gate. AFTER the heuristic
  // adjustments, because the curve is fitted against the output of the whole
  // rule stack, which is what the labels were compared to.
  //
  // Measured 2026-09-18, n=187, grouped-by-lake 5-fold: recalibrating the rule
  // takes MAE 1.045 -> 0.682, bias +0.869 -> -0.001, and the over-optimistic
  // fraction 0.513 -> 0.262. With no artifact on disk this is the identity map
  // and nothing changes.
  const recalibrated = applyScoreCalibration(calBase, {
    predictionSource: prediction.predictionSource,
    modelType: prediction.modelType
  });
  const gateInput = recalibrated.rating;

  // ── The penalty layer carries the whole high-wind range ───────────────────
  // AUDIT-2026-09-18 #21 — LOAD-BEARING, do not weaken the wind penalties on
  // the assumption that the model already handles strong wind. It does not.
  //
  // The V2 artifact (direct-hgb-mono-v2-2026-09-18) was fitted on 187 human
  // labels which contain almost no observations above ~15 mph, so its wind
  // response FLATTENS there. Measured through the real JS evaluator on
  // 2026-09-18, all other features held constant and gust delta fixed at 5 mph:
  //
  //     mph   0     5     10    14    15    16    18    20    25    30    40    60
  //     raw   4.43  4.10  2.80  2.43  2.42  2.08  1.98  1.98  1.96  1.86  1.86  1.86
  //
  // From 30 mph up it is CONSTANT at 1.8598 — 30 mph and 60 mph are the same
  // number to the model — and across the entire 15→60 mph range it moves only
  // 0.565 of a point. A monotonic constraint guarantees the model never gets
  // MORE optimistic as wind rises; it cannot manufacture a range the training
  // data never contained.
  //
  // What actually separates a breezy day from a dangerous one is
  // applyEnhancedPenalties below: WIND_MODERATE (1.0) → WIND_STRONG (1.5) →
  // WIND_DANGEROUS (2.0), plus the gust terms. Measured end-to-end through this
  // function on the same day: 15 mph → totalPenalty 1.0, published 1.5;
  // 40 mph → totalPenalty 3.0, published 1.0.
  //
  // One consequence worth stating plainly: the published rating is clamped at
  // 1.0, and from ~18-20 mph up the penalties already drive it to the floor. So
  // 20 mph and 40 mph publish the SAME rating of 1.0 "Hard pass". That is not
  // over-optimism — 1.0 is the worst answer the scale has and it is the right
  // one for both — but it does mean the rating alone cannot express how far past
  // the floor a day is. That distinction survives only in `totalPenalty` and
  // `penaltyDetails`, which is why every surface must report them (finding #9).
  //
  // Safety-gate penalties (marine shape unlocks swell/steepness/thunder codes;
  // hydrologyContext adds the river flow gate for gauged river spots)
  const penaltyMarine = buildPenaltyMarine(marineHour);
  // waterTempMeasured travels with the features so the penalty layer can stand
  // its water rules down when nobody measured the water (see paddlePenalties).
  const penaltyResult = applyEnhancedPenalties({ rating: gateInput }, mlFeatures, penaltyMarine, hydrologyContext);

  // Per-spot dynamic offset — positive offsets never undo the safety gate
  let appliedOffset = dynamicOffset || 0;
  const majorPenaltyFired = (penaltyResult.penaltyDetails || []).some(d => (d.amount || 0) >= 1.0);
  if (appliedOffset > 0 && majorPenaltyFired) appliedOffset = 0;

  // Final: precise value computed first (kept for evals/research), displayed
  // rating snapped to 0.5. The verdict label derives from the SNAPPED rating —
  // product decision (2026-09-01): the label must always match the number users see.
  const precise = clampRating(gateInput - (penaltyResult.totalPenalty || 0) + appliedOffset);
  const ratingPrecise = roundPrecise(precise);
  const rating = snapHalf(precise);

  // Smart warnings (current-conditions callers); per-hour callers pass their own
  let warnings = [];
  if (includeWarnings && warningsConditions) {
    warnings = getSmartWarnings(warningsConditions, weatherData, { latitude: loc.lat, longitude: loc.lng });
  }

  return {
    rating,
    ratingPrecise,
    interpretation: getInterpretation(rating),
    riskClass: prediction.riskClass ?? null,
    explanations: prediction.explanations ?? null,
    // ONE representation for every producer — see normalizeConfidence above.
    // Always one of 'measured' | 'estimated' | 'unvalidated'.
    confidence: confidenceLevel,
    confidenceBasis,
    // Out-of-fold error of the model that produced this number, when the model
    // states one. A safety number with no error bar is a bug; null here means
    // "this generator cannot state its own error", not "the error is zero".
    uncertainty: confidenceBasis.uncertainty,
    mlModelUsed: prediction.mlModelUsed,
    predictionSource: prediction.predictionSource,
    modelType: prediction.modelType || null,
    // TRUE when this score did NOT come from the model. Every surface must be
    // able to say so; a silent fallback is what let 13 of 17 live spots be
    // scored by an unevaluated heuristic without anyone noticing.
    degraded: prediction.degraded === true,
    degradedReason: prediction.degradedReason ?? null,
    originalMLRating: calibrated.originalRating,
    calibrationApplied: calibrated.adjustments.length > 0,
    adjustments: calibrated.adjustments,
    // Traceability: every published score names the artifact that shaped it and
    // the local clock the season/hour rules were allowed to read.
    scoreCalibration: {
      applied: recalibrated.applied,
      version: recalibrated.version,
      reason: recalibrated.reason,
      ratingBefore: roundPrecise(recalibrated.inputRating),
      ratingAfter: roundPrecise(recalibrated.rating)
    },
    calibrationVersion: recalibrated.version,
    localClock: { localHour, localMonth },
    penaltiesApplied: penaltyResult.penaltiesApplied || [],
    penaltyDetails: penaltyResult.penaltyDetails || [],
    totalPenalty: penaltyResult.totalPenalty || 0,
    dynamicOffset: appliedOffset,
    marineDataUsed: !!penaltyMarine,
    warnings,
    mlInputsHash,
    algorithmVersion: ALGORITHM_VERSION,
    computedAt: new Date().toISOString()
  };
}

module.exports = {
  scoreFromFeatures,
  selectMarineHour,
  buildPenaltyMarine,
  hashMLInputs,
  parseLocalClock,
  normalizeConfidence,
  CONFIDENCE_LEVELS,
  CONFIDENCE_RANK
};
