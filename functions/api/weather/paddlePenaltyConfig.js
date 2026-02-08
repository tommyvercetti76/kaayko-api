/**
 * Paddle Penalty Configuration & Utilities
 * Extracted from paddlePenalties.js — thresholds, helpers, value extraction.
 *
 * @module api/weather/paddlePenaltyConfig
 */

/**
 * Tunable thresholds — central for easy calibration.
 */
const THRESHOLDS = {
  tempVeryHot: 35.0, tempHot: 29.5, tempColdMajor: 0.0, tempColdMinor: 5.0,
  uvDanger: 10, uvHigh: 8, uvModerate: 6,
  windDangerMph: 25, windStrongMph: 20, windModerateMph: 15, windLightBeaufort: 4,
  gustDeltaMajor: 10, gustDeltaMinor: 6,
  waveLarge: 1.5, waveModerate: 0.8,
  swellSteepMajor: 0.20, swellSteepMinor: 0.12,
  windAgainstSwellDelta: 45, windCrossSwellDelta: 70,
  waterColdMajor: 5.0, waterColdMinor: 10.0,
  visPoor: 5.0, visMarginal: 10.0,
  popMajorPct: 80, popMinorPct: 60,
  rainHeavyMm: 6.0, rainModerateMm: 2.0,
  warningMajor: true,
  thunderstormCodes: new Set([1087, 1273, 1276, 1279, 1282]),
  minRating: 1.0, maxRating: 5.0
};

/** Clamp number into [min, max] */
function clamp(x, min, max) { return Math.max(min, Math.min(max, x)); }

/** Round to nearest 0.5 */
function roundToHalf(x) { return Math.round(x * 2) / 2; }

/** Safe number (null/undefined → undefined) */
function n(x) { return (x === null || x === undefined) ? undefined : Number(x); }

/** Beaufort from mph (approx) */
function beaufortFromMph(mph) {
  if (mph == null) return undefined;
  const s = Number(mph);
  if (s < 1) return 0; if (s < 4) return 1; if (s < 8) return 2;
  if (s < 13) return 3; if (s < 19) return 4; if (s < 25) return 5;
  if (s < 32) return 6; if (s < 39) return 7; if (s < 47) return 8;
  if (s < 55) return 9; if (s < 64) return 10; if (s < 73) return 11;
  return 12;
}

/** Smallest angle difference (degrees) between 2 bearings (0..180) */
function angleDelta(a, b) {
  if (a == null || b == null) return undefined;
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Extract normalized values from features + marine raw hour */
function pickValue({ features, marine }) {
  const raw = marine?.rawMarineHour || {};
  return {
    windMph: n(features.windSpeed ?? raw.wind_mph),
    gustMph: n(features.gustSpeed ?? raw.gust_mph),
    windDeg: n(features.windDegree ?? raw.wind_degree),
    airTempC: n(features.temperature ?? raw.temp_c),
    uvIndex: n(features.uvIndex ?? raw.uv),
    visibilityKm: (() => {
      const km = n(features.visibility ?? raw.vis_km);
      const mi = n(features.visibilityMiles ?? raw.vis_miles);
      if (km != null) return km; if (mi != null) return mi * 1.60934;
      return undefined;
    })(),
    popPct: (() => {
      const p0 = n(features.precipChancePercent);
      const p1 = n(features.precipProbability);
      if (p0 != null) return clamp(p0, 0, 100);
      if (p1 != null) return clamp(p1 * 100, 0, 100);
      return undefined;
    })(),
    precipMm: (() => {
      const mm = n(features.precipMm ?? raw.precip_mm);
      const inches = n(features.precipIn ?? raw.precip_in);
      if (mm != null) return Math.max(0, mm);
      if (inches != null) return Math.max(0, inches * 25.4);
      return undefined;
    })(),
    waveHeightM: n(features.waveHeight ?? marine?.waveHeight ?? raw.sig_ht_mt),
    swellHeightM: n(marine?.swellHeight ?? raw.swell_ht_mt),
    swellPeriodS: n(marine?.swellPeriod ?? raw.swell_period_secs),
    swellDirDeg: n(marine?.swellDirection ?? raw.swell_dir),
    waterTempC: n(features.waterTemp ?? marine?.waterTemp ?? raw.water_temp_c),
    weatherCode: n(raw.condition?.code),
    hasWarnings: !!features.hasWarnings
  };
}

/** Push a penalty entry (no-op if amount ≤ 0) */
function addPenalty(list, amount, code, message, context = {}) {
  if (!amount || amount <= 0) return;
  list.push({ code, amount, message, context });
}

/** Convert structured penalty details to legacy string list for UI */
function toLegacyStrings(details) {
  return details.map(d => `${d.message}: -${d.amount}`);
}

module.exports = {
  THRESHOLDS, clamp, roundToHalf, n, beaufortFromMph, angleDelta,
  pickValue, addPenalty, toLegacyStrings
};
