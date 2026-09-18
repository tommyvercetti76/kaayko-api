// functions/api/weather/scoringConstants.js
//
// Single source of truth for the Paddle Score algorithm version, tier thresholds,
// and rounding rules. Every scoring surface (compute pipeline, serializers,
// methodology docs) must read these — never re-implement locally.
//
// Version history lives in functions/docs/ALGORITHM_CHANGELOG.md; bump
// ALGORITHM_VERSION whenever scoring semantics change.

// NOTE (2026-09-18): this constant read '2.0.0' while ALGORITHM_CHANGELOG.md
// had already documented v2.1 through v2.4 — the two had silently drifted, so
// every response has been reporting a version that does not match the algorithm
// it describes. Realigned to the changelog, which is the stated source of truth.
//
// 2.5.0 (2026-09-18, DEPLOYED): calibration reads the LOCATION-LOCAL clock of
// the scored hour instead of the server's UTC clock; the estimated water-
// temperature bonus is removed.
//
// 2.7.0 (2026-09-19): the calibration layer's POSITIVE adjustments are
// suppressed. Measured out-of-fold on 187 human labels they handed out +31.68
// of optimism against -3.75 of caution and cost the published score on every
// axis; removing them is the first configuration to pass both project safety
// gates (dangerous recall 0.962, over-optimism 0.043).
//
// 2.6.0 (2026-09-18): the model is evaluated IN PROCESS from a JSON artifact
// (13 of 17 spots were silently falling back to a rule heuristic on Cloud Run
// cold starts); missing weather inputs no longer read as good weather; one
// water-temperature policy end to end; FLOW_LOW gate; hydrology normals use the
// spot-local month. See docs/ALGORITHM_CHANGELOG.md.
const ALGORITHM_VERSION = '2.7.0';

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
