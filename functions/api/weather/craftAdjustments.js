// functions/api/weather/craftAdjustments.js
//
// Deterministic craft (boat-type) adjustment layer — applied AFTER cache
// retrieval, never baked into the stored base score, never an ML feature
// (training labels are comfort-only from a single kayak-baseline rater).
//
// Basis (documented with citations in /paddlingout/methodology):
// - SUP: standing body acts as a sail; beginner ceiling ~8-10 kn (~9-11.5 mph),
//   hard going past ~12-14 mph (ACA SUP guidance, mainstream SUP instruction).
// - Canoe: high freeboard/windage, open hull ships water in chop.
// - Rowboat: heavier and stable but slow to reposition in building wind.
// - Pedal boat: worst upwind capability of any rental craft; flat-water only.
// - Inflatable kayak: light, high-drag, wind-vulnerable; seated (better than SUP).
// - Kayak is the identity baseline — the base score was rated from a kayak
//   comfort perspective. Deltas are NON-POSITIVE by design: no craft handles
//   wind/waves better than the baseline hard-shell kayak.
//
// Wind thresholds in MPH (sustained). Delta = the single largest matching band
// (not cumulative), plus wave escalation when the base score already carries a
// WAVE_MOD/WAVE_LARGE penalty, plus a gust surcharge for gust-sensitive craft.

const { getInterpretation, clampRating, snapHalf, roundPrecise } = require('./scoringConstants');

const KPH_TO_MPH = 0.621371;

const CRAFT_PROFILES = {
  kayak:      { label: 'Kayak',           identity: true },
  canoe:      { label: 'Canoe',           windCaution: 10, dCaution: 0.25, windStrong: 16, dStrong: 0.5,  windSevere: 20, dSevere: 0.75, waveEscalation: 0.25, gustSensitive: false },
  sup:        { label: 'SUP',             windCaution: 9,  dCaution: 0.25, windStrong: 14, dStrong: 0.5,  windSevere: 18, dSevere: 1.0,  waveEscalation: 0.25, gustSensitive: true  },
  row:        { label: 'Rowboat',         windCaution: 12, dCaution: 0.25, windStrong: 18, dStrong: 0.5,  windSevere: 22, dSevere: 0.5,  waveEscalation: 0,    gustSensitive: false },
  pedal:      { label: 'Pedal boat',      windCaution: 8,  dCaution: 0.5,  windStrong: 12, dStrong: 1.0,  windSevere: 16, dSevere: 1.5,  waveEscalation: 0.5,  gustSensitive: true  },
  inflatable: { label: 'Inflatable kayak', windCaution: 10, dCaution: 0.25, windStrong: 15, dStrong: 0.5,  windSevere: 18, dSevere: 1.0,  waveEscalation: 0.25, gustSensitive: true  }
};

const CRAFT_IDS = Object.keys(CRAFT_PROFILES);

/** Normalize a client-supplied craft id; anything unknown = kayak (identity). */
function sanitizeCraft(craft) {
  const c = String(craft || '').toLowerCase().trim();
  return CRAFT_PROFILES[c] ? c : 'kayak';
}

/**
 * Apply the craft layer to a computed/cached score payload.
 * Returns the ORIGINAL object for kayak/identity (zero-cost default path);
 * otherwise a new object with adjusted rating/ratingPrecise/interpretation,
 * the base preserved in baseRatingPrecise, and a craftAdjustment block.
 */
function applyCraftAdjustment(scoreData, craft) {
  const id = sanitizeCraft(craft);
  const profile = CRAFT_PROFILES[id];
  if (!scoreData || profile.identity) return scoreData;
  if (scoreData.craftAdjustment) {
    // Guard against double application (route bug) — never adjust twice.
    console.warn('applyCraftAdjustment: score already craft-adjusted, skipping');
    return scoreData;
  }

  const basePrecise = Number.isFinite(scoreData.ratingPrecise) ? scoreData.ratingPrecise
                    : Number.isFinite(scoreData.rating) ? scoreData.rating : null;
  if (basePrecise == null) return scoreData;

  // Cached conditions store wind/gust in KPH for display
  const windMph = (Number(scoreData.conditions?.windSpeed) || 0) * KPH_TO_MPH;
  const gustMph = (Number(scoreData.conditions?.gustSpeed) || 0) * KPH_TO_MPH;

  let delta = 0;
  const notes = [];

  if (windMph >= profile.windSevere)       { delta -= profile.dSevere;  notes.push(`Wind ${Math.round(windMph)} mph is above the ${profile.label} handling range`); }
  else if (windMph >= profile.windStrong)  { delta -= profile.dStrong;  notes.push(`Wind ${Math.round(windMph)} mph is demanding in a ${profile.label.toLowerCase()}`); }
  else if (windMph >= profile.windCaution) { delta -= profile.dCaution; notes.push(`Wind ${Math.round(windMph)} mph asks for extra effort in a ${profile.label.toLowerCase()}`); }

  if (profile.waveEscalation > 0) {
    const waveCodes = (scoreData.penaltyDetails || []).some(d => d.code === 'WAVE_MOD' || d.code === 'WAVE_LARGE');
    if (waveCodes) { delta -= profile.waveEscalation; notes.push(`Chop hits a ${profile.label.toLowerCase()} harder`); }
  }

  if (profile.gustSensitive && gustMph - windMph >= 10) {
    delta -= 0.25;
    notes.push(`Gust spread of ${Math.round(gustMph - windMph)} mph is destabilizing`);
  }

  // Snap the delta to 0.25 and clamp; identity when nothing triggered
  delta = Math.max(-1.5, Math.min(0, Math.round(delta * 4) / 4));
  if (delta === 0) {
    return {
      ...scoreData,
      craft: id,
      craftAdjustment: { craft: id, label: profile.label, delta: 0, notes: [] }
    };
  }

  const adjustedPrecise = clampRating(basePrecise + delta);
  const ratingPrecise = roundPrecise(adjustedPrecise);
  const snapped = snapHalf(adjustedPrecise);

  return {
    ...scoreData,
    rating: snapped,
    ratingPrecise,
    // Label from the snapped rating — must always match the number users see
    interpretation: getInterpretation(snapped),
    baseRatingPrecise: roundPrecise(basePrecise),
    craft: id,
    craftAdjustment: { craft: id, label: profile.label, delta, notes }
  };
}

module.exports = { CRAFT_PROFILES, CRAFT_IDS, sanitizeCraft, applyCraftAdjustment };
