// File: functions/src/utils/paddlePenalties.js
//
// 🚨 SHARED PADDLE PENALTY LOGIC  —  “Fair Penalties” Edition
//
// Purpose
// -------
// Provide a consistent, fair penalty system for paddling suitability that:
//  - Preserves prior behavior/shape (backward compatible).
//  - Enforces 0.5 rating increments and [1.0..5.0] bounds.
//  - Adds precipitation and richer marine/visibility logic.
//  - Uses gusts, warnings, and wave steepness for real-world “chop” fairness.
//
// Inputs (typical)
// ----------------
// prediction: { rating: number, ... }
// features: {
//   temperature (°C), uvIndex, windSpeed (mph), beaufortScale,
//   visibility (km or mi), humidity, cloudCover, hasWarnings,
//   waveHeight (m), waterTemp (°C),
//   precipProbability (0..1) or precipChancePercent (0..100),
//   precipMm (mm), precipIn (in), gustSpeed (mph) [optional],
//   windDegree (0..360) [optional],
//   ...other keys
// }
// marineData (optional): {
//   waveHeight, swellHeight, swellPeriod, swellDirection (deg),
//   waterTemp, tides:{...}, rawMarineHour:{ precip_mm, gust_mph, wind_degree, ... }
// }
//
// Output
// ------
// Returns a new prediction object with:
//  - rating (rounded to .0/.5), originalRating, totalPenalty
//  - penaltiesApplied (string list for UI), roundedTo05Increments: true
//  - marineDataUsed: boolean
//  - penaltyDetails: [{code, amount, message, context}]
//
// Notes
// -----
// - We DO NOT penalize for data we don't have. Missing marine/precip fields → no penalty.
// - Thresholds are documented below. Tune safely in small increments (e.g., ±0.5).
//

/** -----------------------------
 * Tunable thresholds & helpers
 * ------------------------------
 * Keep these central for easy calibration without touching core logic.
 */
const THRESHOLDS = {
  // Temperature (air, °C)
  tempVeryHot: 35.0,         // Extreme heat → -1.0
  tempHot: 29.5,             // High heat → -0.5
  tempColdMajor: 5.0,        // Cold air → -1.0
  tempColdMinor: 10.0,       // Cool air → -0.5

  // UV
  uvDanger: 10,              // → -1.0
  uvHigh: 8,                 // → -0.5
  uvModerate: 6,             // → -0.5

  // Wind (mph) / Beaufort (fallback)
  windDangerMph: 25,         // or B>=6 → -2.0
  windStrongMph: 18,         // or B>=5 → -1.5
  windModerateMph: 12,       // or B>=4 → -1.0
  windLightBeaufort: 3,      // → -0.5 (for small craft sensitivity)

  // Gusts (mph above sustained)
  gustDeltaMajor: 10,        // gust - wind ≥ 10 → -1.0
  gustDeltaMinor: 6,         // gust - wind ≥ 6  → -0.5

  // Waves (m)
  waveLarge: 1.5,            // → -1.0
  waveModerate: 0.8,         // → -0.5

  // Swell steepness (m / s): higher = steeper/shorter-period waves → choppier
  // rule of thumb: >0.20 is quite steep for small craft; >0.12 noticeable
  swellSteepMajor: 0.20,     // → -1.0
  swellSteepMinor: 0.12,     // → -0.5

  // Wind vs swell direction (deg). ~180° is opposing; ~0° is aligned.
  windAgainstSwellDelta: 45, // within 45° of direct opposition → penalty
  windCrossSwellDelta: 70,   // cross ~90° ±20° can be sloppy → minor penalty

  // Water temp (°C)
  waterColdMajor: 10.0,      // → -1.0
  waterColdMinor: 15.0,      // → -0.5

  // Visibility (km)
  visPoor: 5.0,              // → -1.0
  visMarginal: 10.0,         // → -0.5

  // Precipitation
  // Probabilities accept either 0..1 (prob) or 0..100 (%). Amounts from mm or in.
  popMajorPct: 80,           // PoP ≥ 80% → -1.0
  popMinorPct: 60,           // PoP ≥ 60% → -0.5
  rainHeavyMm: 6.0,          // ≥ 6 mm (≈ 0.24") in the hour → -1.0
  rainModerateMm: 2.0,       // ≥ 2 mm (≈ 0.08") in the hour → -0.5

  // Warnings / thunderstorms
  warningMajor: true,        // hasWarnings true → -1.0
  thunderstormCodes: new Set([1087, 1273, 1276, 1279, 1282]), // WeatherAPI thunderstorm-ish codes

  // Rounding & clamps
  minRating: 1.0,
  maxRating: 5.0
};

/** Utility: clamp number into [min, max] */
function clamp(x, min, max) { return Math.max(min, Math.min(max, x)); }

/** Utility: round to nearest 0.5 */
function roundToHalf(x) { return Math.round(x * 2) / 2; }

/** Utility: safe number (undefined/null → undefined) */
function n(x) { return (x === null || x === undefined) ? undefined : Number(x); }

/** Utility: Beaufort from mph (approx) if none provided */
function beaufortFromMph(mph) {
  if (mph == null) return undefined;
  const s = Number(mph);
  if (s < 1) return 0;
  if (s < 4) return 1;
  if (s < 8) return 2;
  if (s < 13) return 3;
  if (s < 19) return 4;
  if (s < 25) return 5;
  if (s < 32) return 6;
  if (s < 39) return 7;
  if (s < 47) return 8;
  if (s < 55) return 9;
  if (s < 64) return 10;
  if (s < 73) return 11;
  return 12;
}

/** Utility: smallest angle difference (degrees) between 2 bearings */
function angleDelta(a, b) {
  if (a == null || b == null) return undefined;
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d; // 0..180
}

/** Extract a field from features or marine raw hour if available */
function pickValue({ features, marine }) {
  const raw = marine?.rawMarineHour || {};
  return {
    // wind/gusts
    windMph: n(features.windSpeed ?? raw.wind_mph),
    gustMph: n(features.gustSpeed ?? raw.gust_mph),
    windDeg: n(features.windDegree ?? raw.wind_degree),

    // temps
    airTempC: n(features.temperature ?? raw.temp_c),
    uvIndex: n(features.uvIndex ?? raw.uv),

    // visibility (assume km if <= 25; if miles provided separately, caller can map to features.visibilityMiles)
    visibilityKm: (() => {
      const visKm = n(features.visibility ?? raw.vis_km);
      const visMiles = n(features.visibilityMiles ?? raw.vis_miles);
      if (visKm != null) return visKm;
      if (visMiles != null) return visMiles * 1.60934;
      return undefined;
    })(),

    // precip prob (0..1 or 0..100)
    popPct: (() => {
      const p0 = n(features.precipChancePercent);
      const p1 = n(features.precipProbability);
      if (p0 != null) return clamp(p0, 0, 100);
      if (p1 != null) return clamp(p1 * 100, 0, 100);
      return undefined;
    })(),

    // precip amount (mm)
    precipMm: (() => {
      const mm = n(features.precipMm ?? raw.precip_mm);
      const inches = n(features.precipIn ?? raw.precip_in);
      if (mm != null) return Math.max(0, mm);
      if (inches != null) return Math.max(0, inches * 25.4);
      return undefined;
    })(),

    // marine
    waveHeightM: n(features.waveHeight ?? marine?.waveHeight ?? raw.sig_ht_mt),
    swellHeightM: n(marine?.swellHeight ?? raw.swell_ht_mt),
    swellPeriodS: n(marine?.swellPeriod ?? raw.swell_period_secs),
    swellDirDeg: n(marine?.swellDirection ?? raw.swell_dir),
    waterTempC: n(features.waterTemp ?? marine?.waterTemp ?? raw.water_temp_c),

    // meta
    weatherCode: n(raw.condition?.code),
    hasWarnings: !!features.hasWarnings
  };
}

/**
 * Compute and append one penalty entry.
 * @param {Array} list target list
 * @param {number} amount positive number to subtract (e.g., 0.5, 1.0)
 * @param {string} code short machine code (e.g., 'WIND_MODERATE')
 * @param {string} message human readable explanation for UI/logs
 * @param {object} context optional extra values for analytics/debug
 */
function addPenalty(list, amount, code, message, context = {}) {
  if (!amount || amount <= 0) return;
  list.push({
    code,
    amount,
    message,
    context
  });
}

/**
 * Convert structured penalty details to prior string list for UI compatibility.
 */
function toLegacyStrings(details) {
  return details.map(d => `${d.message}: -${d.amount}`);
}

/**
 * 🚨 Apply Enhanced Penalties and Force 0.5 Increments
 * Backward compatible with your previous implementation.
 *
 * @param {object} prediction - incoming prediction object with .rating
 * @param {object} features - extracted features used across the app
 * @param {object|null} marineData - optional marine context
 * @returns {object} updated prediction w/ applied penalties & metadata
 */
function applyEnhancedPenalties(prediction, features, marineData = null) {
  let rating = Number(prediction.rating);
  const details = [];
  let totalPenalty = 0;

  // Pull normalized values from features/marine raw
  const vals = pickValue({ features, marine: marineData });

  // -----------------------------
  // 🌡️ AIR TEMPERATURE (°C)
  // -----------------------------
  if (vals.airTempC != null) {
    if (vals.airTempC > THRESHOLDS.tempVeryHot) {
      addPenalty(details, 1.0, "TEMP_VERY_HOT", `Extreme heat (${vals.airTempC.toFixed(1)}°C)`);
    } else if (vals.airTempC > THRESHOLDS.tempHot) {
      addPenalty(details, 0.5, "TEMP_HOT", `High heat (${vals.airTempC.toFixed(1)}°C)`);
    } else if (vals.airTempC < THRESHOLDS.tempColdMajor) {
      addPenalty(details, 1.0, "TEMP_COLD", `Cold air (${vals.airTempC.toFixed(1)}°C)`);
    } else if (vals.airTempC < THRESHOLDS.tempColdMinor) {
      addPenalty(details, 0.5, "TEMP_COOL", `Cool air (${vals.airTempC.toFixed(1)}°C)`);
    }
  }

  // -----------------------------
  // ☀️ UV INDEX
  // -----------------------------
  if (vals.uvIndex != null) {
    if (vals.uvIndex > THRESHOLDS.uvDanger) {
      addPenalty(details, 1.0, "UV_DANGER", `Dangerous UV (${vals.uvIndex})`);
    } else if (vals.uvIndex > THRESHOLDS.uvHigh) {
      addPenalty(details, 0.5, "UV_HIGH", `High UV (${vals.uvIndex})`);
    } else if (vals.uvIndex > THRESHOLDS.uvModerate) {
      addPenalty(details, 0.5, "UV_MODERATE", `Moderate UV (${vals.uvIndex})`);
    }
    // Note: we do not penalize for low/zero UV (night) – that's fair.
  }

  // -----------------------------
  // 💨 WIND (mph) + BEAUFORT
  // -----------------------------
  const windMph = vals.windMph;
  const beaufort = n(features.beaufortScale) ?? beaufortFromMph(windMph);

  if (windMph != null || beaufort != null) {
    if ((windMph != null && windMph > THRESHOLDS.windDangerMph) || (beaufort != null && beaufort >= 6)) {
      addPenalty(details, 2.0, "WIND_DANGEROUS", `Dangerous winds (${(windMph ?? 0).toFixed?.(1) || "—"} mph, B${beaufort ?? "?"})`);
    } else if ((windMph != null && windMph > THRESHOLDS.windStrongMph) || (beaufort != null && beaufort >= 5)) {
      addPenalty(details, 1.5, "WIND_STRONG", `Strong winds (${(windMph ?? 0).toFixed?.(1) || "—"} mph, B${beaufort ?? "?"})`);
    } else if ((windMph != null && windMph > THRESHOLDS.windModerateMph) || (beaufort != null && beaufort >= 4)) {
      addPenalty(details, 1.0, "WIND_MODERATE", `Moderate winds (${(windMph ?? 0).toFixed?.(1) || "—"} mph, B${beaufort ?? "?"})`);
    } else if (beaufort != null && beaufort >= THRESHOLDS.windLightBeaufort) {
      addPenalty(details, 0.5, "WIND_LIGHT_B3", `Light winds (${(windMph ?? 0).toFixed?.(1) || "—"} mph, B${beaufort})`);
    }
  }

  // Gustiness (if we have gusts above sustained)
  if (vals.gustMph != null && windMph != null) {
    const delta = vals.gustMph - windMph;
    if (delta >= THRESHOLDS.gustDeltaMajor) {
      addPenalty(details, 1.0, "GUSTS_MAJOR", `Gusty conditions (gusts ${vals.gustMph.toFixed(1)} mph, +${delta.toFixed(1)} over wind)`);
    } else if (delta >= THRESHOLDS.gustDeltaMinor) {
      addPenalty(details, 0.5, "GUSTS_MINOR", `Gusty conditions (gusts ${vals.gustMph.toFixed(1)} mph, +${delta.toFixed(1)} over wind)`);
    }
  }

  // -----------------------------
  // 🌧️ PRECIPITATION (fairness)
  // -----------------------------
  if (vals.popPct != null) {
    if (vals.popPct >= THRESHOLDS.popMajorPct) {
      addPenalty(details, 1.0, "PRECIP_PROB_HIGH", `Rain likely (PoP ${Math.round(vals.popPct)}%)`);
    } else if (vals.popPct >= THRESHOLDS.popMinorPct) {
      addPenalty(details, 0.5, "PRECIP_PROB_MOD", `Chance of rain (PoP ${Math.round(vals.popPct)}%)`);
    }
  }
  if (vals.precipMm != null) {
    if (vals.precipMm >= THRESHOLDS.rainHeavyMm) {
      addPenalty(details, 1.0, "PRECIP_AMOUNT_HEAVY", `Heavy precip (${vals.precipMm.toFixed(1)} mm)`);
    } else if (vals.precipMm >= THRESHOLDS.rainModerateMm) {
      addPenalty(details, 0.5, "PRECIP_AMOUNT_MOD", `Moderate precip (${vals.precipMm.toFixed(1)} mm)`);
    }
  }

  // Thunderstorm / warnings
  if (THRESHOLDS.warningMajor && features.hasWarnings) {
    addPenalty(details, 1.0, "WARNINGS", "Weather warnings in effect");
  }
  if (vals.weatherCode != null && THRESHOLDS.thunderstormCodes.has(vals.weatherCode)) {
    addPenalty(details, 1.0, "THUNDERSTORM", `Thunderstorm risk (code ${vals.weatherCode})`);
  }

  // -----------------------------
  // 🌫️ VISIBILITY (km)
  // -----------------------------
  if (vals.visibilityKm != null) {
    if (vals.visibilityKm < THRESHOLDS.visPoor) {
      addPenalty(details, 1.0, "VIS_POOR", `Poor visibility (${vals.visibilityKm.toFixed(1)} km)`);
    } else if (vals.visibilityKm < THRESHOLDS.visMarginal) {
      addPenalty(details, 0.5, "VIS_MARGINAL", `Marginal visibility (${vals.visibilityKm.toFixed(1)} km)`);
    }
  }

  // -----------------------------
  // 🌊 WAVES & SWELL (marine fairness)
  // -----------------------------
  const waveH = vals.waveHeightM;
  if (waveH != null) {
    if (waveH > THRESHOLDS.waveLarge) {
      addPenalty(details, 1.0, "WAVE_LARGE", `Large waves (${waveH.toFixed(1)} m)`);
    } else if (waveH > THRESHOLDS.waveModerate) {
      addPenalty(details, 0.5, "WAVE_MOD", `Moderate waves (${waveH.toFixed(1)} m)`);
    }
  }

  // Swell steepness (height/period): higher = steeper/shorter-period
  if (vals.swellHeightM != null && vals.swellPeriodS != null && vals.swellPeriodS > 0) {
    const steep = vals.swellHeightM / vals.swellPeriodS;
    if (steep >= THRESHOLDS.swellSteepMajor) {
      addPenalty(details, 1.0, "SWELL_STEEP_MAJOR", `Steep swell (H=${vals.swellHeightM.toFixed(1)} m / T=${vals.swellPeriodS.toFixed(1)} s)`);
    } else if (steep >= THRESHOLDS.swellSteepMinor) {
      addPenalty(details, 0.5, "SWELL_STEEP_MINOR", `Steepish swell (H=${vals.swellHeightM.toFixed(1)} m / T=${vals.swellPeriodS.toFixed(1)} s)`);
    }
  }

  // Wind-against-swell (chop): if near-opposed directions, conditions get worse
  const diff = angleDelta(vals.windDeg, vals.swellDirDeg);
  if (diff != null) {
    // Near-opposed (around 180° ± windAgainstSwellDelta)
    if (Math.abs(diff - 180) <= THRESHOLDS.windAgainstSwellDelta) {
      addPenalty(details, 0.5, "WIND_AGAINST_SWELL", `Wind against swell (Δ=${Math.round(diff)}°)`);
    } else if (Math.abs(diff - 90) <= THRESHOLDS.windCrossSwellDelta / 2) {
      // Cross seas around ~90° (minor chop)
      addPenalty(details, 0.5, "WIND_CROSS_SWELL", `Cross swell (Δ=${Math.round(diff)}°)`);
    }
  }

  // -----------------------------
  // 🧊 WATER TEMPERATURE (°C)
  // -----------------------------
  if (vals.waterTempC != null) {
    if (vals.waterTempC < THRESHOLDS.waterColdMajor) {
      addPenalty(details, 1.0, "WATER_COLD_MAJOR", `Cold water (${vals.waterTempC.toFixed(1)}°C)`);
    } else if (vals.waterTempC < THRESHOLDS.waterColdMinor) {
      addPenalty(details, 0.5, "WATER_COLD_MINOR", `Cool water (${vals.waterTempC.toFixed(1)}°C)`);
    }
  }

  // -----------------------------
  // Sum & finalize
  // -----------------------------
  totalPenalty = details.reduce((s, d) => s + (d.amount || 0), 0);

  // Apply penalties fairly (do not penalize for unknowns)
  const adjusted = clamp(rating - totalPenalty, THRESHOLDS.minRating, THRESHOLDS.maxRating);

  // Enforce 0.5 increments
  const rounded = clamp(roundToHalf(adjusted), THRESHOLDS.minRating, THRESHOLDS.maxRating);

  return {
    ...prediction,
    rating: rounded,
    originalRating: rating,
    penaltiesApplied: toLegacyStrings(details),   // keeps your UI stable
    penaltyDetails: details,                      // richer analytics
    totalPenalty: Number(totalPenalty.toFixed(2)),
    roundedTo05Increments: true,
    marineDataUsed: !!marineData
  };
}

module.exports = {
  applyEnhancedPenalties
};