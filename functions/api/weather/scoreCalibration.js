// functions/api/weather/scoreCalibration.js
//
// ISOTONIC RECALIBRATION OF THE PUBLISHED PADDLE SCORE.
//
// Why this exists
// ───────────────
// Measured on 2026-09-18 against 187 human labels over 93 lakes (grouped-by-lake
// 5-fold out-of-fold, seed 42), the production expert rule is not just noisy —
// it is BIASED OPTIMISTIC:
//
//     expert rule (production)   MAE 1.045   bias +0.869   over-optimistic 0.513
//     rule + isotonic            MAE 0.682   bias -0.001   over-optimistic 0.262
//
// "over-optimistic" = the fraction of rows where the published score was HIGHER
// than the human rating. Over half of them. A monotone recalibration — no new
// features, no machine-learned model, nothing that can reorder two conditions —
// removes the bias almost exactly and halves the over-optimism. It is the
// single largest safety gain available to this pipeline, and it is a lookup
// table.
//
// What isotonic regression is
// ───────────────────────────
// A fitted non-decreasing map g: score -> score. Monotone by construction, so
// it can never say that a worse day is a better day; it only moves the LEVEL of
// the scale to where it belongs. Fitted with sklearn IsotonicRegression
// (pool-adjacent-violators; Barlow et al. 1972, "Statistical Inference under
// Order Restrictions"), exported as knots + values, evaluated here by linear
// interpolation with clipped (flat) extrapolation — sklearn's
// out_of_bounds='clip'.
//
// Artifact contract
// ─────────────────
// Two key spellings are accepted, because the science repo ships one and the
// original interface note specified the other. Both are read; neither is
// guessed at.
//
//   paddle-llm.isotonic-calibrator.v1 (what data/models actually contains):
//     { "schema", "created_utc", "score_min", "score_max",
//       "knots_x": [...], "knots_y": [...], "fit": {...}, "metadata": {...} }
//
//   documented shape:
//     { "version", "fitted_on", "knots": [...], "values": [...] }
//
//   Common optional key, honoured from either:
//     "applies_to": ["paddle-llm"]   // the predictionSource values this curve
//                                    // was fitted on. See the source gate.
//
// The source gate — the part most likely to be argued with
// ────────────────────────────────────────────────────────
// A curve fitted on generator A is not valid for generator B. The artifact in
// the science repo says so itself: metadata.rule is the expert rule and
// metadata.intended_use reads "Apply to the raw expert-rule score before
// publishing". Production does not currently run that rule — mlService reaches
// a Cloud Run GradientBoostingRegressor. Passing its output through this curve
// would be a large, confident, unjustified change to a safety number.
//
// So: the curve is applied ONLY to prediction sources that were explicitly
// named, either by the artifact (`applies_to`) or by the operator
// (PADDLE_SCORE_CALIBRATION_SOURCES=ml-model,paddle-llm). With neither, the
// module reports `applies_to_unspecified` and returns the score unchanged.
// That is a deliberate refusal, not an oversight: the fix is one recorded
// decision, in the artifact or in config, rather than a silent default.
//
// Failure policy — READ THIS BEFORE CHANGING ANYTHING
// ───────────────────────────────────────────────────
// Missing file, unparseable JSON, non-monotone table, a curve on a different
// output scale, or an unnamed prediction source => IDENTITY (return the score
// unchanged) plus a warning and a machine-readable reason. Never a partial
// table, never an interpolated guess, never a "close enough" default curve. An
// uncalibrated score is a known quantity; a score passed through the wrong
// curve is a lie with a version number on it.
//
// Pure module: no Firestore, no network, no Express. Only fs/path to load the
// artifact once per function instance.

const fs = require('fs');
const path = require('path');

const ARTIFACT_BASENAME = 'isotonic-calibrator-v1.json';

// The published Paddle Score scale. A curve fitted on any other output range
// is not a calibrator for this score and is refused.
const SCALE_MIN = 1.0;
const SCALE_MAX = 5.0;

// Where the artifact is looked for.
//
//   PADDLE_SCORE_CALIBRATOR_PATH set  → that file and ONLY that file. An
//   explicit override that is missing is a hard miss; silently loading a
//   different artifact than the one an operator named is exactly the class of
//   surprise this module exists to prevent.
//
//   otherwise → functions/data/models/, which is the only place that survives a
//   deploy (Cloud Functions ship what lives under functions/). The artifact is
//   produced in the paddle-llm repo and must be COPIED here as a release step.
//   Reading it straight out of ../../paddle-llm was tried and removed: it made
//   local dev silently disagree with production.
function candidatePaths() {
  const override = (process.env.PADDLE_SCORE_CALIBRATOR_PATH || '').trim();
  if (override) return [override];
  return [path.join(__dirname, '..', '..', 'data', 'models', ARTIFACT_BASENAME)];
}

/** Calibration is on unless explicitly switched off. */
function isEnabled() {
  return String(process.env.PADDLE_SCORE_CALIBRATION || '').trim().toLowerCase() !== 'off';
}

// Module-level cache: one disk read per function instance, not per score.
// `null` means "not loaded yet"; a loaded result is always an object so that a
// failed load is cached too (we do not re-stat a missing file 40 000 times/day).
let cached = null;

/**
 * Validate a candidate calibrator table.
 * Returns { ok: true, table } or { ok: false, reason }.
 *
 * Every check here has a specific failure it prevents:
 *  - length < 2            → nothing to interpolate between
 *  - non-finite entries    → NaN propagates silently into a safety number
 *  - knots not increasing  → interpolation divides by zero / picks a random arm
 *  - values decreasing     → NOT isotonic; the artifact is corrupt or was
 *                            produced by something other than the fitter, and
 *                            applying it could rank a storm above a calm day
 */
function validateTable(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'artifact_not_an_object' };

  // Accept either key spelling. `??` not `||`: an empty array is a real (bad)
  // answer and must reach the length checks below, not be swapped out.
  const knots = raw.knots ?? raw.knots_x;
  const values = raw.values ?? raw.knots_y;
  if (!Array.isArray(knots) || !Array.isArray(values)) return { ok: false, reason: 'knots_or_values_missing' };
  if (knots.length !== values.length) return { ok: false, reason: 'knots_values_length_mismatch' };
  if (knots.length < 2) return { ok: false, reason: 'fewer_than_two_knots' };

  for (let i = 0; i < knots.length; i++) {
    if (!Number.isFinite(knots[i]) || !Number.isFinite(values[i])) {
      return { ok: false, reason: `non_finite_entry_at_${i}` };
    }
    if (i > 0 && !(knots[i] > knots[i - 1])) {
      return { ok: false, reason: `knots_not_strictly_increasing_at_${i}` };
    }
    if (i > 0 && values[i] < values[i - 1]) {
      return { ok: false, reason: `values_not_monotone_at_${i}` };
    }
  }

  // A curve fitted on some other output range is not a calibrator for the
  // published 1-5 Paddle Score, whatever else is right about it.
  if (raw.score_min !== undefined && raw.score_min !== SCALE_MIN) {
    return { ok: false, reason: `scale_mismatch_min:${raw.score_min}` };
  }
  if (raw.score_max !== undefined && raw.score_max !== SCALE_MAX) {
    return { ok: false, reason: `scale_mismatch_max:${raw.score_max}` };
  }

  // Traceability: every published score must name the artifact behind it.
  // `version` when the artifact states one; otherwise schema@created_utc, which
  // is just as unambiguous and is what the science repo actually emits.
  const version = str(raw.version) ||
    (str(raw.schema) && str(raw.created_utc) ? `${str(raw.schema)}@${str(raw.created_utc)}` : null);
  if (!version) return { ok: false, reason: 'version_missing' };

  const fittedOn = str(raw.fitted_on) || str(raw.created_utc);
  if (!fittedOn) return { ok: false, reason: 'fitted_on_missing' };

  const meta = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};

  return {
    ok: true,
    table: {
      version,
      fittedOn,
      knots: knots.slice(),
      values: values.slice(),
      appliesTo: Array.isArray(raw.applies_to) && raw.applies_to.length ? raw.applies_to.slice() : null,
      nLabels: Number.isFinite(raw.n_labels) ? raw.n_labels
        : Number.isFinite(meta.n_labels) ? meta.n_labels : null,
      cv: str(raw.cv) || str(meta.fold_scheme) || null,
      // Free-text provenance from the science repo, surfaced verbatim in
      // /metrics so nobody has to open the artifact to learn what it is for.
      fittedOnRule: str(meta.rule) || null,
      intendedUse: str(meta.intended_use) || null
    }
  };
}

/** Trimmed non-empty string, or null. */
function str(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Load (and cache) the calibrator artifact.
 * @returns {{table: object|null, reason: string, source: string|null}}
 */
function loadCalibrator() {
  if (cached) return cached;

  if (!isEnabled()) {
    cached = { table: null, reason: 'disabled_by_env', source: null };
    return cached;
  }

  const tried = [];
  for (const p of candidatePaths()) {
    tried.push(p);
    let text;
    try {
      text = fs.readFileSync(p, 'utf8');
    } catch {
      continue; // not here — try the next location
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      console.warn(`scoreCalibration: ${p} is not valid JSON (${err.message}) — falling back to IDENTITY (no calibration)`);
      cached = { table: null, reason: 'artifact_unparseable', source: p };
      return cached;
    }

    const verdict = validateTable(parsed);
    if (!verdict.ok) {
      console.warn(`scoreCalibration: ${p} failed validation (${verdict.reason}) — falling back to IDENTITY (no calibration)`);
      cached = { table: null, reason: verdict.reason, source: p };
      return cached;
    }

    console.log(`scoreCalibration: loaded ${verdict.table.version} (fitted ${verdict.table.fittedOn}, ${verdict.table.knots.length} knots) from ${p}`);
    cached = { table: verdict.table, reason: 'ok', source: p };
    return cached;
  }

  console.warn(`scoreCalibration: no calibrator artifact found (looked in: ${tried.join(', ')}) — publishing UNCALIBRATED scores. Measured bias of the uncalibrated rule: +0.869, over-optimistic on 51.3% of labelled rows.`);
  cached = { table: null, reason: 'artifact_not_found', source: null };
  return cached;
}

/**
 * Log a given warning once per function instance.
 * These fire per score; at ~40k scores/day an un-deduped warn is a log bill and
 * drowns everything else. The condition is instance-scoped, so once is enough.
 */
const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/** Drop the cached artifact. Tests and hot-reload only. */
function _resetCalibratorCache() {
  cached = null;
  warned.clear();
}

/**
 * Evaluate a validated isotonic table at x.
 * Pure, allocation-free, O(log n). Flat extrapolation outside the knot range
 * (sklearn out_of_bounds='clip'), output clamped to the published 1–5 scale.
 *
 * @param {{knots: number[], values: number[]}} table
 * @param {number} x
 * @returns {number|null} null when x is not a finite number — the caller must
 *          decide what to do with a non-number, and must not receive a guess.
 */
function evaluateIsotonic(table, x) {
  if (!Number.isFinite(x)) return null;
  const { knots, values } = table;
  const last = knots.length - 1;

  if (x <= knots[0]) return clampScore(values[0]);
  if (x >= knots[last]) return clampScore(values[last]);

  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (knots[mid] <= x) lo = mid; else hi = mid;
  }

  const span = knots[hi] - knots[lo];
  const t = span === 0 ? 0 : (x - knots[lo]) / span;
  return clampScore(values[lo] + t * (values[hi] - values[lo]));
}

/** The published Paddle Score scale. */
function clampScore(x) {
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, x));
}

/**
 * Which prediction sources this curve may be applied to.
 *
 * The operator's list wins over the artifact's, so a curve can be enabled for a
 * generator without editing (and invalidating the checksum of) the artifact.
 * With neither list present the answer is `null` — unknown — and the caller
 * must refuse.
 *
 * @returns {{list: string[]|null, origin: 'env'|'artifact'|'unspecified'}}
 */
function allowedSources(table) {
  const envList = (process.env.PADDLE_SCORE_CALIBRATION_SOURCES || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (envList.length) return { list: envList, origin: 'env' };
  if (table.appliesTo) return { list: table.appliesTo, origin: 'artifact' };
  return { list: null, origin: 'unspecified' };
}

/**
 * Apply isotonic recalibration to a score.
 *
 * @param {number} rating - the score to recalibrate (post rule/ML, PRE penalty)
 * @param {object} [context]
 * @param {string} [context.predictionSource] - e.g. 'paddle-llm', 'ml-model',
 *        'local-model', 'fallback-rules'. Must appear in the artifact's
 *        `applies_to` or in PADDLE_SCORE_CALIBRATION_SOURCES. A curve fitted on
 *        one score generator is NOT valid for another, so anything unnamed
 *        returns identity with a reason rather than silently bending a
 *        different model's output.
 * @returns {{rating: number, applied: boolean, version: string|null, reason: string, inputRating: number}}
 */
function applyScoreCalibration(rating, context = {}) {
  const inputRating = rating;

  if (!Number.isFinite(rating)) {
    return { rating, applied: false, version: null, reason: 'input_not_finite', inputRating };
  }

  const { table, reason } = loadCalibrator();
  if (!table) {
    return { rating, applied: false, version: null, reason, inputRating };
  }

  const source = context.predictionSource || null;
  const { list, origin } = allowedSources(table);

  if (!list) {
    warnOnce(`applies_to_unspecified:${table.version}`,
      `scoreCalibration: ${table.version} names no prediction source it was fitted on ` +
      `(artifact says: ${table.intendedUse || 'nothing'}). NOT applying it. ` +
      'Add "applies_to" to the artifact, or set PADDLE_SCORE_CALIBRATION_SOURCES, ' +
      'to make that an explicit decision.');
    return { rating, applied: false, version: table.version, reason: 'applies_to_unspecified', inputRating };
  }
  if (!source) {
    return { rating, applied: false, version: table.version, reason: 'prediction_source_unknown', inputRating };
  }
  if (!list.includes(source)) {
    warnOnce(`source_mismatch:${table.version}:${source}`,
      `scoreCalibration: ${table.version} is valid for [${list.join(', ')}] (per ${origin}) ` +
      `but this score came from '${source}' — NOT applying it.`);
    return { rating, applied: false, version: table.version, reason: 'source_mismatch', inputRating };
  }

  const calibrated = evaluateIsotonic(table, rating);
  if (calibrated === null) {
    return { rating, applied: false, version: table.version, reason: 'evaluation_failed', inputRating };
  }

  return { rating: calibrated, applied: true, version: table.version, reason: 'ok', inputRating };
}

/** Metadata for /metrics and response traceability. Never throws. */
function getCalibratorInfo() {
  const { table, reason, source } = loadCalibrator();
  const sources = table ? allowedSources(table) : { list: null, origin: 'unspecified' };
  return {
    available: !!table,
    version: table?.version || null,
    fittedOn: table?.fittedOn || null,
    knotCount: table?.knots.length || 0,
    appliesTo: sources.list,
    appliesToOrigin: sources.origin,
    nLabels: table?.nLabels ?? null,
    cv: table?.cv || null,
    fittedOnRule: table?.fittedOnRule || null,
    intendedUse: table?.intendedUse || null,
    reason,
    source
  };
}

module.exports = {
  applyScoreCalibration,
  evaluateIsotonic,
  loadCalibrator,
  getCalibratorInfo,
  validateTable,
  allowedSources,
  clampScore,
  _resetCalibratorCache,
  ARTIFACT_BASENAME,
  SCALE_MIN,
  SCALE_MAX
};
