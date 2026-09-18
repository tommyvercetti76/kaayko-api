// File: functions/api/weather/modelCalibration.js
//
// 🎯 MODEL CALIBRATION UTILITY
//
// Applies real-world adjustments to ML model predictions based on:
// 1. Forecast trend analysis
// 2. Seasonal adjustments
// 3. Location-specific factors
// 4. Wind pattern analysis
//
// ─── TIME AND PLACE ARE INPUTS, NOT AMBIENT STATE ───────────────────────────
// Every time-dependent rule here reads the LOCATION-LOCAL clock of the hour
// being scored, supplied by the caller through `locationData`. It must never
// read `new Date()`. Three separate bugs came from that (all fixed 2026-09-18):
//
//   (a) `new Date().getMonth()` decided "is it summer?". On Cloud Functions
//       that is the SERVER's UTC month, applied identically to a lake in
//       Tasmania (where it is winter) and to a forecast hour three days away.
//   (b) `new Date().getHours()` (server UTC) was compared against forecast hour
//       strings that are LOCATION-LOCAL. At IST (UTC+5:30) that filter is off
//       by 5.5 hours, so the trend term read the wrong hours — or, far more
//       often, no hours at all (see analyzeForecastTrends).
//   (c) A water-temperature bonus was awarded from an ESTIMATED water
//       temperature after the rest of the pipeline had already adopted
//       "measured or nothing". Removed entirely — see the note below.
//
// When the caller cannot supply local time or coordinates, the affected rule
// STANDS DOWN (adjustment 0, with a reason). It never falls back to a guess:
// a silent plausible default is the exact failure mode this pipeline exists to
// eliminate.

// Obliquity of the ecliptic (IAU 2006), i.e. the latitude of the tropics.
// Between these lines the annual cycle is wet/dry, not warm/cold, so a
// mid-latitude "summer bonus" has no physical meaning.
const TROPIC_LATITUDE_DEG = 23.44;

// Polar circles. Above them the day-length cycle dominates and the temperate
// season model stops describing paddling conditions.
const POLAR_CIRCLE_LATITUDE_DEG = 66.56;

// India Meteorological Department southwest ("summer") monsoon season:
// June 1 – September 30 over the South Asian domain. During it, a NH "summer"
// month is the WETTEST, windiest part of the year — the opposite of the
// assumption the summer bonus encodes.
// Ref: IMD, Climate of India — seasons: Winter (Jan–Feb), Pre-monsoon
// (Mar–May), Southwest monsoon (Jun–Sep), Post-monsoon (Oct–Dec).
const SW_MONSOON_MONTHS = [6, 7, 8, 9];
const SW_MONSOON_DOMAIN = { minLat: 5, maxLat: 35, minLng: 65, maxLng: 95 };

/**
 * Calibrate ML model prediction with real-world adjustments.
 *
 * @param {number} baseRating - Original ML model rating (1-5)
 * @param {object} currentConditions - Current weather data for the scored hour
 * @param {object|Array} forecastData - Standardized forecast day array, or the
 *        legacy raw {forecast:{forecastday:[...]}} shape
 * @param {object} locationData - Location AND local clock of the scored hour:
 *        { latitude, longitude, localHour?, localMonth? }.
 *        `localHour` (0-23) and `localMonth` (1-12) are the LOCATION-LOCAL
 *        values for the hour being scored — not the server's, and not "now".
 *        Omit them and the time-dependent rules stand down.
 * @returns {object} Calibrated prediction with adjustments
 */
function calibrateModelPrediction(baseRating, currentConditions, forecastData, locationData) {
  console.log('🎯 Starting model calibration for base rating:', baseRating);

  const loc = locationData || {};
  const localHour = normalizeLocalHour(loc.localHour);
  const localMonth = normalizeLocalMonth(loc.localMonth);

  // If conditions are already severe, positive adjustments are misleading.
  // Suppress all positive calibration when: heavy rain OR high wind OR poor visibility.
  // MISSING DATA MUST NOT READ AS GOOD WEATHER.
  // These defaults used to be `windSpeed || 0` and `visibility ?? 10`, i.e. an
  // unknown wind became flat calm and an unknown visibility became 10 km clear.
  // The effect was that `suppressPositive` — the guard that stops the pipeline
  // awarding bonuses in bad conditions — could never fire when a field was
  // absent, and analyzeWindPatterns then affirmatively added a bonus. A weather
  // outage made published scores go UP. Unknown is now treated as unsafe for the
  // purpose of the guard, and as "no information" for the purpose of a bonus.
  const num = (v) => (Number.isFinite(v) ? v : null);
  const precipMm      = num(currentConditions.precipMm) ?? num(currentConditions.precipMM);
  const rainChancePct = num(currentConditions.precipChancePercent) ?? num(currentConditions.precipChance);
  const windSpeedMph  = num(currentConditions.windSpeed);
  const visKm         = num(currentConditions.visibility);

  // Any input we need for the severity test that we do not actually have.
  const severityInputsMissing =
    windSpeedMph === null || visKm === null || precipMm === null;

  const suppressPositive =
    severityInputsMissing ||
    (precipMm !== null && precipMm >= 2) ||
    (rainChancePct !== null && rainChancePct >= 60) ||
    (windSpeedMph !== null && windSpeedMph >= 20) ||
    (visKm !== null && visKm < 5);

  let adjustedRating = baseRating;
  const adjustments = [];

  // Helper: apply adjustment, but skip positive ones when conditions are severe
  const applyAdj = (adj) => {
    if (!adj || adj.adjustment === 0) return;
    if (suppressPositive && adj.adjustment > 0) return; // never boost in rain/storm
    adjustedRating += adj.adjustment;
    adjustments.push(adj);
  };

  // NOTE: there is deliberately no water-temperature term here.
  // calibrateWaterTemperature() used to award up to +0.3 from air temperature
  // via an assumed air→water offset. paddleScoreCompute.js had already adopted
  // MEASURED OR NOTHING for water temperature (waterTempC = null when no sensor
  // exists, every water rule stands down), but this calibrator kept moving the
  // PUBLISHED score on the strength of the very estimate that had been
  // rejected — a side door around the rule. Deleted 2026-09-18. If a
  // water-temperature term is ever reinstated it must (1) fire only on a
  // MEASURED reading and (2) be fitted against labels, not hand-chosen.
  applyAdj(analyzeForecastTrends(forecastData, currentConditions, localHour)); // 1. Forecast trend
  applyAdj(applySeasonalCalibration(currentConditions, loc, localMonth));      // 2. Seasonal
  applyAdj(applyLocationCalibration(currentConditions, loc));                  // 3. Location
  applyAdj(analyzeWindPatterns(currentConditions, forecastData));              // 4. Wind pattern

  // Ensure rating stays within bounds — keep the unsnapped value for the
  // precision pipeline; the 0.5 snap survives only for legacy consumers.
  const preciseRating = Math.max(1.0, Math.min(5.0, adjustedRating));
  adjustedRating = Math.round(preciseRating * 2) / 2;

  const totalAdjustment = adjustedRating - baseRating;

  console.log('📈 Model calibration complete:', {
    baseRating,
    adjustedRating,
    totalAdjustment: totalAdjustment.toFixed(2),
    adjustmentsApplied: adjustments.length
  });

  return {
    originalRating: baseRating,
    calibratedRating: adjustedRating,
    calibratedRatingPrecise: preciseRating,
    totalAdjustment: totalAdjustment,
    adjustments: adjustments,
    calibrationApplied: true,
    // Traceability: which time-dependent rules could run at all.
    localClock: { localHour, localMonth }
  };
}

/**
 * Coerce a caller-supplied local hour to 0-23, or null when it is not usable.
 * Returns null rather than 0 — "midnight" and "unknown" are different answers.
 */
function normalizeLocalHour(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const h = Math.trunc(n);
  return h >= 0 && h <= 23 ? h : null;
}

/** Coerce a caller-supplied local month to 1-12, or null when unusable. */
function normalizeLocalMonth(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const m = Math.trunc(n);
  return m >= 1 && m <= 12 ? m : null;
}

/**
 * Map a calendar month onto the month with the equivalent solar season in the
 * NORTHERN hemisphere, so one set of month rules can serve both hemispheres.
 * January in Hobart (-42.9°) is high summer; this returns 7 for it.
 *
 * @param {number} month 1-12, location-local
 * @param {number} latitude signed degrees
 * @returns {number} 1-12
 */
function toNorthernEquivalentMonth(month, latitude) {
  return latitude < 0 ? ((month + 5) % 12) + 1 : month;
}

/**
 * Classify the latitude band a season model can legitimately speak about.
 * @returns {'tropical'|'temperate'|'polar'|null}
 */
function latitudeZone(latitude) {
  if (!Number.isFinite(latitude)) return null;
  const abs = Math.abs(latitude);
  if (abs < TROPIC_LATITUDE_DEG) return 'tropical';
  if (abs > POLAR_CIRCLE_LATITUDE_DEG) return 'polar';
  return 'temperate';
}

/**
 * True inside the South Asian southwest-monsoon domain during Jun–Sep.
 * A large slice of India sits ABOVE the Tropic of Cancer (Delhi 28.6 °N,
 * Udaipur 24.6 °N), so the tropical gate alone does not cover it: without this
 * check those lakes collect a "summer" bonus in the middle of the monsoon.
 */
function isSouthwestMonsoon(month, latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (!SW_MONSOON_MONTHS.includes(month)) return false;
  return latitude >= SW_MONSOON_DOMAIN.minLat && latitude <= SW_MONSOON_DOMAIN.maxLat &&
         longitude >= SW_MONSOON_DOMAIN.minLng && longitude <= SW_MONSOON_DOMAIN.maxLng;
}

/**
 * Analyze forecast trends for stability.
 *
 * @param {object|Array} forecastData
 * @param {object} currentConditions
 * @param {number|null} localHour - LOCATION-LOCAL hour of the scored slot.
 *        null → the rule stands down; we cannot tell which forecast hours are
 *        still ahead of the paddler.
 */
function analyzeForecastTrends(forecastData, currentConditions, localHour = null) {
  // Accept both the standardized forecast day ARRAY (what the pipeline passes)
  // and the legacy raw {forecast:{forecastday:[...]}} shape.
  const days = Array.isArray(forecastData) ? forecastData : forecastData?.forecast?.forecastday;
  if (!days || days.length === 0) {
    return { type: 'forecast_trend', adjustment: 0, reason: 'No forecast data available' };
  }

  if (localHour === null) {
    // Previously this compared the SERVER's UTC hour against location-local
    // forecast timestamps. Standing down is the only honest alternative.
    return {
      type: 'forecast_trend',
      adjustment: 0,
      reason: 'No location-local hour supplied — forecast-trend calibration stood down'
    };
  }

  const today = days[0];
  const hourlyData = today.hourly || today.hour || [];

  if (hourlyData.length < 3) {
    return { type: 'forecast_trend', adjustment: 0, reason: 'Insufficient forecast data' };
  }

  // FILTER, THEN SLICE. The old order sliced hours 0-5 (midnight–05:00) and
  // only then kept hours >= the current hour, so outside the small hours the
  // filter emptied the list and this term silently never fired. "Next 6 hours"
  // means the six hours from the scored hour onward.
  const relevantHours = hourlyData
    .filter(h => {
      const hourTime = parseForecastHour(h?.time);
      return hourTime !== null && hourTime >= localHour;
    })
    .slice(0, 6);

  if (relevantHours.length < 3) {
    return { type: 'forecast_trend', adjustment: 0, reason: 'Not enough relevant forecast hours' };
  }

  // Check for improving conditions
  const windSpeeds = relevantHours.map(h => h.windKPH || 0);
  const temps = relevantHours.map(h => h.tempC || 15);

  const windSpeeds0 = windSpeeds[0] || 0;
  const windSpeedsLast = windSpeeds[windSpeeds.length - 1] || 0;
  const windImproving = windSpeeds.every((speed, i) => i === 0 || speed <= windSpeeds[i - 1] + 2);
  const windDeteriorating = windSpeedsLast > windSpeeds0 + 5; // increasing by >5kph over next hours
  const tempImproving = temps.some((temp, i) => i > 0 && temp > temps[i - 1]);
  const stableConditions = windSpeeds.every(speed => speed < 15);

  let adjustment = 0;
  let reason = '';

  if (windDeteriorating) {
    adjustment = -0.2;
    reason = 'Wind increasing in forecast (-0.2)';
  } else if (windImproving && stableConditions) {
    adjustment = +0.2;
    reason = 'Improving wind conditions in forecast (+0.2)';
  } else if (tempImproving && stableConditions) {
    adjustment = +0.1;
    reason = 'Warming trend with stable conditions (+0.1)';
  } else if (stableConditions) {
    adjustment = +0.1;
    reason = 'Stable forecast conditions (+0.1)';
  }

  return {
    type: 'forecast_trend',
    adjustment: adjustment,
    reason: reason
  };
}

/**
 * Hour-of-day from a forecast timestamp ("2026-09-18 14:00"), or null.
 * Returns null rather than NaN/0 so callers can tell "unparseable" from "00:00".
 */
function parseForecastHour(timeString) {
  if (typeof timeString !== 'string') return null;
  const clock = timeString.trim().split(/[ T]/)[1];
  if (!clock) return null;
  const hour = parseInt(clock.split(':')[0], 10);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

/**
 * Apply seasonal calibration adjustments.
 *
 * Reads the LOCATION-LOCAL month of the scored hour and the SIGNED latitude.
 * Stands down (0) whenever the season model cannot honestly speak:
 *   - no local month (we would otherwise be scoring "now" on the server)
 *   - no usable latitude
 *   - tropical latitudes (annual cycle is wet/dry, not warm/cold)
 *   - polar latitudes (day length, not temperature, governs)
 *   - the South Asian southwest monsoon (Jun–Sep) — a NH "summer" that is the
 *     wettest and windiest part of that year
 *
 * @param {object} conditions
 * @param {object} location - { latitude, longitude }
 * @param {number|null} localMonth - 1-12, location-local, of the scored hour
 */
function applySeasonalCalibration(conditions, location, localMonth = null) {
  const stand = (reason) => ({ type: 'seasonal', adjustment: 0, reason });

  if (localMonth === null) {
    return stand('No scored-hour month supplied — seasonal calibration stood down');
  }

  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  const zone = latitudeZone(latitude);
  if (zone === null) {
    return stand('No usable latitude — seasonal calibration stood down');
  }
  if (zone === 'tropical') {
    return stand('Tropical latitude — no mid-latitude season model applies');
  }
  if (zone === 'polar') {
    return stand('Polar latitude — no mid-latitude season model applies');
  }
  if (isSouthwestMonsoon(localMonth, latitude, longitude)) {
    return stand('Southwest monsoon season (IMD Jun–Sep) — seasonal bonus stood down');
  }

  const airTemp = conditions.temperature;
  if (!Number.isFinite(airTemp)) {
    return stand('No air temperature — seasonal calibration stood down');
  }

  // One month rule set, hemisphere-corrected.
  const month = toNorthernEquivalentMonth(localMonth, latitude);
  const absLat = Math.abs(latitude);

  // Spring/Fall in temperate zones often better than model predicts
  const isSpringFall = (month >= 3 && month <= 5) || (month >= 9 && month <= 11);
  const isTemperateZone = absLat >= 30 && absLat <= 60;

  if (isSpringFall && isTemperateZone && airTemp >= 10 && airTemp <= 25) {
    return {
      type: 'seasonal',
      adjustment: +0.2,
      reason: 'Spring/Fall temperate zone adjustment (+0.2)',
      season: 'spring_fall',
      localMonth,
      hemisphere: latitude < 0 ? 'S' : 'N'
    };
  }

  // Summer adjustments for moderate temperatures
  const isSummer = month >= 6 && month <= 8;
  if (isSummer && airTemp >= 15 && airTemp <= 30) {
    return {
      type: 'seasonal',
      adjustment: +0.15,
      reason: 'Summer moderate temperature adjustment (+0.15)',
      season: 'summer',
      localMonth,
      hemisphere: latitude < 0 ? 'S' : 'N'
    };
  }

  return stand('');
}

/**
 * Apply location-specific calibrations.
 *
 * These are hand-drawn regional boxes, all of them POSITIVE, all of them North
 * American. They were never fitted against labels and are a prime suspect for
 * the measured over-optimism of the rule layer — flagged for the weekend
 * calibration run, not silently re-tuned here.
 *
 * What did change (2026-09-18): missing coordinates used to default to
 * (40, -100) — the middle of Kansas — which quietly placed unknown-location
 * scores inside the "Great Lakes"/"Southern US" boxes. No coordinates now
 * means no location adjustment.
 */
function applyLocationCalibration(conditions, location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { type: 'location', adjustment: 0, reason: 'No coordinates — location calibration stood down' };
  }

  let adjustment = 0;
  let reason = '';

  // Great Lakes region - often better conditions than model predicts
  const isGreatLakes = latitude >= 41 && latitude <= 49 && longitude >= -95 && longitude <= -76;
  if (isGreatLakes && conditions.temperature >= 8) {
    adjustment = +0.2;
    reason = 'Great Lakes region adjustment (+0.2)';
  }

  // California/Mediterranean climate
  const isCalifornia = latitude >= 32 && latitude <= 42 && longitude >= -125 && longitude <= -114;
  if (isCalifornia && conditions.temperature >= 12) {
    adjustment = +0.25;
    reason = 'California climate adjustment (+0.25)';
  }

  // Southern US - generally more paddleable
  const isSouthernUS = latitude >= 25 && latitude <= 37 && longitude >= -106 && longitude <= -75;
  if (isSouthernUS && conditions.temperature >= 10) {
    adjustment = +0.2;
    reason = 'Southern US climate adjustment (+0.2)';
  }

  return {
    type: 'location',
    adjustment: adjustment,
    reason: reason
  };
}

/**
 * Analyze wind patterns for paddling suitability.
 * Time- and place-independent — operates only on the scored hour's wind.
 */
function analyzeWindPatterns(conditions, forecastData) {
  const windSpeed = conditions.windSpeed || 0;
  const gustSpeed = conditions.gustSpeed || windSpeed * 1.3;

  let adjustment = 0;
  let reason = '';

  // Light, steady winds — optimal for paddling
  if (windSpeed >= 3 && windSpeed <= 8 && gustSpeed <= windSpeed * 1.2) {
    adjustment = +0.2;
    reason = 'Light steady winds optimal for paddling (+0.2)';
  }
  // Moderate winds with manageable gusts
  else if (windSpeed >= 8 && windSpeed <= 12 && gustSpeed <= windSpeed * 1.3) {
    adjustment = +0.1;
    reason = 'Moderate winds with manageable gusts (+0.1)';
  }
  // Very light winds — ideal for beginners
  else if (windSpeed <= 5) {
    adjustment = +0.1;
    reason = 'Very light winds - ideal for beginners (+0.1)';
  }
  // High winds — model may under-penalise in borderline cases
  else if (windSpeed >= 20) {
    adjustment = -0.1;
    reason = 'High wind advisory conditions (-0.1)';
  }

  return {
    type: 'wind_pattern',
    adjustment: adjustment,
    reason: reason
  };
}

module.exports = {
  calibrateModelPrediction,
  // Exported for tests and for the offline replay harness — these are the
  // pieces that were wrong, so they are the pieces that must be assertable.
  analyzeForecastTrends,
  applySeasonalCalibration,
  applyLocationCalibration,
  analyzeWindPatterns,
  toNorthernEquivalentMonth,
  latitudeZone,
  isSouthwestMonsoon,
  parseForecastHour,
  TROPIC_LATITUDE_DEG,
  POLAR_CIRCLE_LATITUDE_DEG
};
