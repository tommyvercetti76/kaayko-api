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
  hydrologyContext = null
}) {
  const mlInputsHash = hashMLInputs(mlFeatures);

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
      reused: true
    };
  } else {
    prediction = await getPrediction(mlFeatures);
  }
  if (!prediction?.success) return null;

  // Calibration (water temp, forecast trend, seasonal, location, wind pattern)
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
    { latitude: loc.lat, longitude: loc.lng }
  );
  const calBase = calibrated.calibratedRatingPrecise ?? calibrated.calibratedRating;

  // Safety-gate penalties (marine shape unlocks swell/steepness/thunder codes;
  // hydrologyContext adds the river flow gate for gauged river spots)
  const penaltyMarine = buildPenaltyMarine(marineHour);
  // waterTempMeasured travels with the features so the penalty layer can stand
  // its water rules down when nobody measured the water (see paddlePenalties).
  const penaltyResult = applyEnhancedPenalties({ rating: calBase }, mlFeatures, penaltyMarine, hydrologyContext);

  // Per-spot dynamic offset — positive offsets never undo the safety gate
  let appliedOffset = dynamicOffset || 0;
  const majorPenaltyFired = (penaltyResult.penaltyDetails || []).some(d => (d.amount || 0) >= 1.0);
  if (appliedOffset > 0 && majorPenaltyFired) appliedOffset = 0;

  // Final: precise value computed first (kept for evals/research), displayed
  // rating snapped to 0.5. The verdict label derives from the SNAPPED rating —
  // product decision (2026-09-01): the label must always match the number users see.
  const precise = clampRating(calBase - (penaltyResult.totalPenalty || 0) + appliedOffset);
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
    confidence: prediction.confidence || 'high',
    mlModelUsed: prediction.mlModelUsed,
    predictionSource: prediction.predictionSource,
    modelType: prediction.modelType || null,
    originalMLRating: calibrated.originalRating,
    calibrationApplied: calibrated.adjustments.length > 0,
    adjustments: calibrated.adjustments,
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

module.exports = { scoreFromFeatures, selectMarineHour, buildPenaltyMarine, hashMLInputs };
