// functions/api/weather/scoringConstants.js
//
// Single source of truth for the Paddle Score algorithm version, tier thresholds,
// and rounding rules. Every scoring surface (compute pipeline, serializers,
// methodology docs) must read these — never re-implement locally.
//
// Version history lives in functions/docs/ALGORITHM_CHANGELOG.md; bump
// ALGORITHM_VERSION whenever scoring semantics change.

const ALGORITHM_VERSION = '2.0.0';

// Canonical 3-tier scale. Must match the client (KaaykoPrefs.paddleScoreColor)
// and methodology.html. Labels derive from the PRECISE rating, not the 0.5 snap.
const TIERS = { WORTH_IT: 3.7, CAREFUL: 2.7 };

function getInterpretation(rating) {
  if (rating >= TIERS.WORTH_IT) return 'Worth it';
  if (rating >= TIERS.CAREFUL) return 'Careful';
  return 'Hard pass';
}

function clampRating(x) { return Math.max(1.0, Math.min(5.0, x)); }

// Legacy display snap — `rating` keeps these semantics for old clients.
function snapHalf(x) { return Math.round(x * 2) / 2; }

// One-decimal precision for `ratingPrecise`.
function roundPrecise(x) { return Math.round(x * 10) / 10; }

module.exports = { ALGORITHM_VERSION, TIERS, getInterpretation, clampRating, snapHalf, roundPrecise };
