/**
 * Paddle Penalty Engine — "Fair Penalties" Edition
 *
 * Applies weather-based penalty deductions to a paddle rating.
 * Enforces 0.5 increments on a 1.0–5.0 scale.
 * Does NOT penalize for missing data.
 *
 * @module api/weather/paddlePenalties
 */

const {
  THRESHOLDS, clamp, roundToHalf, n, beaufortFromMph, angleDelta,
  pickValue, addPenalty, toLegacyStrings
} = require('./paddlePenaltyConfig');

/**
 * Apply enhanced penalties and force 0.5 increments.
 *
 * @param {Object} prediction - incoming prediction with .rating
 * @param {Object} features - extracted weather features
 * @param {Object|null} marineData - optional marine context
 * @returns {Object} updated prediction with applied penalties & metadata
 */
function applyEnhancedPenalties(prediction, features, marineData = null) {
  let rating = Number(prediction.rating);
  const details = [];
  const vals = pickValue({ features, marine: marineData });

  // 🌡️ AIR TEMPERATURE (°C)
  if (vals.airTempC != null) {
    if (vals.airTempC > THRESHOLDS.tempVeryHot) addPenalty(details, 1.0, 'TEMP_VERY_HOT', `Extreme heat (${vals.airTempC.toFixed(1)}°C)`);
    else if (vals.airTempC > THRESHOLDS.tempHot) addPenalty(details, 0.5, 'TEMP_HOT', `High heat (${vals.airTempC.toFixed(1)}°C)`);
    else if (vals.airTempC < THRESHOLDS.tempColdMajor) addPenalty(details, 1.0, 'TEMP_COLD', `Cold air (${vals.airTempC.toFixed(1)}°C)`);
    else if (vals.airTempC < THRESHOLDS.tempColdMinor) addPenalty(details, 0.5, 'TEMP_COOL', `Cool air (${vals.airTempC.toFixed(1)}°C)`);
  }

  // ☀️ UV INDEX
  if (vals.uvIndex != null) {
    if (vals.uvIndex > THRESHOLDS.uvDanger) addPenalty(details, 1.0, 'UV_DANGER', `Dangerous UV (${vals.uvIndex})`);
    else if (vals.uvIndex > THRESHOLDS.uvHigh) addPenalty(details, 0.5, 'UV_HIGH', `High UV (${vals.uvIndex})`);
    else if (vals.uvIndex > THRESHOLDS.uvModerate) addPenalty(details, 0.5, 'UV_MODERATE', `Moderate UV (${vals.uvIndex})`);
  }

  // 💨 WIND (mph) + BEAUFORT
  const windMph = vals.windMph;
  const beaufort = n(features.beaufortScale) ?? beaufortFromMph(windMph);
  if (windMph != null || beaufort != null) {
    const w = (windMph ?? 0).toFixed?.(1) || '—';
    const b = beaufort ?? '?';
    if ((windMph != null && windMph > THRESHOLDS.windDangerMph) || (beaufort != null && beaufort >= 6))
      addPenalty(details, 2.0, 'WIND_DANGEROUS', `Dangerous winds (${w} mph, B${b})`);
    else if ((windMph != null && windMph > THRESHOLDS.windStrongMph) || (beaufort != null && beaufort >= 5))
      addPenalty(details, 1.5, 'WIND_STRONG', `Strong winds (${w} mph, B${b})`);
    else if ((windMph != null && windMph > THRESHOLDS.windModerateMph) || (beaufort != null && beaufort >= 4))
      addPenalty(details, 1.0, 'WIND_MODERATE', `Moderate winds (${w} mph, B${b})`);
    else if (beaufort != null && beaufort >= THRESHOLDS.windLightBeaufort)
      addPenalty(details, 0.5, 'WIND_LIGHT_B3', `Light winds (${w} mph, B${beaufort})`);
  }

  // Gustiness
  if (vals.gustMph != null && windMph != null) {
    const delta = vals.gustMph - windMph;
    if (delta >= THRESHOLDS.gustDeltaMajor) addPenalty(details, 1.0, 'GUSTS_MAJOR', `Gusty (gusts ${vals.gustMph.toFixed(1)} mph, +${delta.toFixed(1)})`);
    else if (delta >= THRESHOLDS.gustDeltaMinor) addPenalty(details, 0.5, 'GUSTS_MINOR', `Gusty (gusts ${vals.gustMph.toFixed(1)} mph, +${delta.toFixed(1)})`);
  }

  // 🌧️ PRECIPITATION
  if (vals.popPct != null) {
    if (vals.popPct >= THRESHOLDS.popMajorPct) addPenalty(details, 1.0, 'PRECIP_PROB_HIGH', `Rain likely (PoP ${Math.round(vals.popPct)}%)`);
    else if (vals.popPct >= THRESHOLDS.popMinorPct) addPenalty(details, 0.5, 'PRECIP_PROB_MOD', `Chance of rain (PoP ${Math.round(vals.popPct)}%)`);
  }
  if (vals.precipMm != null) {
    if (vals.precipMm >= THRESHOLDS.rainHeavyMm) addPenalty(details, 1.0, 'PRECIP_AMOUNT_HEAVY', `Heavy precip (${vals.precipMm.toFixed(1)} mm)`);
    else if (vals.precipMm >= THRESHOLDS.rainModerateMm) addPenalty(details, 0.5, 'PRECIP_AMOUNT_MOD', `Moderate precip (${vals.precipMm.toFixed(1)} mm)`);
  }
  if (THRESHOLDS.warningMajor && features.hasWarnings) addPenalty(details, 1.0, 'WARNINGS', 'Weather warnings in effect');
  if (vals.weatherCode != null && THRESHOLDS.thunderstormCodes.has(vals.weatherCode)) addPenalty(details, 1.0, 'THUNDERSTORM', `Thunderstorm risk (code ${vals.weatherCode})`);

  // 🌫️ VISIBILITY (km)
  if (vals.visibilityKm != null) {
    if (vals.visibilityKm < THRESHOLDS.visPoor) addPenalty(details, 1.0, 'VIS_POOR', `Poor visibility (${vals.visibilityKm.toFixed(1)} km)`);
    else if (vals.visibilityKm < THRESHOLDS.visMarginal) addPenalty(details, 0.5, 'VIS_MARGINAL', `Marginal visibility (${vals.visibilityKm.toFixed(1)} km)`);
  }

  // 🌊 WAVES & SWELL
  if (vals.waveHeightM != null) {
    if (vals.waveHeightM > THRESHOLDS.waveLarge) addPenalty(details, 1.0, 'WAVE_LARGE', `Large waves (${vals.waveHeightM.toFixed(1)} m)`);
    else if (vals.waveHeightM > THRESHOLDS.waveModerate) addPenalty(details, 0.5, 'WAVE_MOD', `Moderate waves (${vals.waveHeightM.toFixed(1)} m)`);
  }
  if (vals.swellHeightM != null && vals.swellPeriodS != null && vals.swellPeriodS > 0) {
    const steep = vals.swellHeightM / vals.swellPeriodS;
    if (steep >= THRESHOLDS.swellSteepMajor) addPenalty(details, 1.0, 'SWELL_STEEP_MAJOR', `Steep swell (H=${vals.swellHeightM.toFixed(1)} m / T=${vals.swellPeriodS.toFixed(1)} s)`);
    else if (steep >= THRESHOLDS.swellSteepMinor) addPenalty(details, 0.5, 'SWELL_STEEP_MINOR', `Steepish swell (H=${vals.swellHeightM.toFixed(1)} m / T=${vals.swellPeriodS.toFixed(1)} s)`);
  }
  const diff = angleDelta(vals.windDeg, vals.swellDirDeg);
  if (diff != null) {
    if (Math.abs(diff - 180) <= THRESHOLDS.windAgainstSwellDelta) addPenalty(details, 0.5, 'WIND_AGAINST_SWELL', `Wind against swell (Δ=${Math.round(diff)}°)`);
    else if (Math.abs(diff - 90) <= THRESHOLDS.windCrossSwellDelta / 2) addPenalty(details, 0.5, 'WIND_CROSS_SWELL', `Cross swell (Δ=${Math.round(diff)}°)`);
  }

  // 🧊 WATER TEMPERATURE (°C)
  if (vals.waterTempC != null) {
    if (vals.waterTempC < THRESHOLDS.waterColdMajor) addPenalty(details, 1.0, 'WATER_COLD_MAJOR', `Cold water (${vals.waterTempC.toFixed(1)}°C)`);
    else if (vals.waterTempC < THRESHOLDS.waterColdMinor) addPenalty(details, 0.5, 'WATER_COLD_MINOR', `Cool water (${vals.waterTempC.toFixed(1)}°C)`);
  }

  // Sum & finalize
  const totalPenalty = details.reduce((s, d) => s + (d.amount || 0), 0);
  const adjusted = clamp(rating - totalPenalty, THRESHOLDS.minRating, THRESHOLDS.maxRating);
  const rounded = clamp(roundToHalf(adjusted), THRESHOLDS.minRating, THRESHOLDS.maxRating);

  return {
    ...prediction,
    rating: rounded, originalRating: rating,
    penaltiesApplied: toLegacyStrings(details),
    penaltyDetails: details,
    totalPenalty: Number(totalPenalty.toFixed(2)),
    roundedTo05Increments: true,
    marineDataUsed: !!marineData
  };
}

module.exports = { applyEnhancedPenalties };
