// functions/api/weather/localModel.js
//
// IN-PROCESS PADDLE SCORE MODEL — removes the per-score HTTPS hop.
//
// The problem this replaces
// ────────────────────────
// mlService.js POSTs every single spot-hour to a Cloud Run service with a 10 s
// timeout. /fastForecast scores ~24 hours × N days per spot and the warmer
// sweeps every spot every 15 minutes, so the dominant cost of a Paddle Score is
// not arithmetic — it is TLS handshakes and cold starts on another service. A
// gradient-boosted tree ensemble of this size is a few thousand comparisons:
// microseconds of CPU wrapped in hundreds of milliseconds of network.
//
// Loading one JSON artifact per function instance and evaluating it here makes
// prediction synchronous, removes a failure mode (remote timeout → silent
// degradation to `fallback-rules` at confidence 0.7), and — the part that
// matters for the science — pins the published score to a VERSIONED ARTIFACT
// that lives in the repo instead of to whatever is currently deployed at an
// opaque Cloud Run URL.
//
// Artifact contract — kaayko.paddle-score.tree-ensemble.v1
// ────────────────────────────────────────────────────────
//   {
//     "schema":        "kaayko.paddle-score.tree-ensemble.v1",
//     "version":       "resid-hgb-2026-09-18",   // REQUIRED
//     "fitted_on":     "2026-09-18",             // REQUIRED
//     "features":      ["wind_mph", "temperature_c", ...],  // REQUIRED, ordered
//     "baseline":      3.07,                     // REQUIRED, the ensemble intercept
//     "learning_rate": 1.0,                      // OPTIONAL, default 1.0 —
//                                                //   leaf values are assumed to
//                                                //   already carry it unless set
//     "trees": [                                 // REQUIRED
//       { "nodes": [
//           {"feature": 0, "threshold": 12.5, "left": 1, "right": 2, "missing_goes_left": true},
//           {"leaf": -0.13},
//           {"leaf":  0.21}
//       ]}
//     ],
//     "uncertainty": {                           // REQUIRED — see below
//       "residual_mae": 0.588,
//       "ci95": [0.508, 0.668],
//       "n_labels": 187,
//       "cv": "grouped-by-lake 5-fold, seed 42"
//     },
//     "monotonic_cst": {"wind_mph": -1},         // OPTIONAL, provenance only
//     "residual_of":   "expert_rule_v1"          // OPTIONAL — set when the
//                                                //   ensemble predicts a
//                                                //   RESIDUAL on top of the
//                                                //   rule, not the score itself
//   }
//
// `uncertainty` is REQUIRED and the loader refuses an artifact without it.
// The project's north star is that a safety number without an uncertainty
// interval is a bug; an artifact that cannot state its own out-of-fold error
// has no business publishing a number a paddler acts on.
//
// Failure policy
// ──────────────
// Absent artifact, wrong schema, missing feature, non-finite output → THROW or
// return null. Never a plausible default. The caller (mlService) falls back to
// the existing Cloud Run path, which is a known quantity. A silent wrong number
// is worse than a slow right one.
//
// STILL OPEN (decided over the weekend, not guessed here):
//   - Which artifact ships: `direct HGB` (MAE 0.634) or `residual HGB`
//     (MAE 0.588 [0.508, 0.668]). Residual wins on MAE but rides on the rule's
//     own bias; direct is simpler to reason about. `residual_of` exists in the
//     schema so either can ship without a code change — but the residual
//     composition itself is NOT implemented here (see composeResidual).
//   - The exporter lives in the paddle-llm repo and does not exist yet.
//
// Pure module: fs/path only, no network, no Firestore, no Express.

const fs = require('fs');
const path = require('path');

const ARTIFACT_BASENAME = 'paddle-score-model-v1.json';
const SUPPORTED_SCHEMA = 'kaayko.paddle-score.tree-ensemble.v1';

// Canonical feature names an artifact may request, mapped to how they are read
// out of the standardized mlFeatures object produced by
// dataStandardization.standardizeForMLModel.
//
// Every entry is an EXPLICIT read. There is no `?? default` anywhere in here on
// purpose: a feature the artifact declares and the request cannot supply is a
// hard error, not a zero. `waveHeight` is listed but flagged, because today it
// is a fabricated linear function of wind for every inland lake in the system
// (dataStandardization DEFAULTS.WIND_WAVE_FACTOR_MPH) — see FEATURE_CAVEATS.
const FEATURE_READERS = {
  temperature_c:  f => f.temperature,
  wind_mph:       f => f.windSpeed,
  gust_mph:       f => f.gustSpeed,
  wind_degree:    f => f.windDirection,
  humidity_pct:   f => f.humidity,
  cloud_cover_pct: f => f.cloudCover,
  uv_index:       f => f.uvIndex,
  visibility_km:  f => f.visibility,
  pressure_mb:    f => f.pressure,
  precip_mm:      f => f.precipMm,
  precip_chance_pct: f => f.precipChancePercent,
  beaufort:       f => f.beaufortScale,
  wave_height_m:  f => f.waveHeight,
  water_temp_c:   f => f.waterTemp,
  latitude:       f => f.latitude,
  longitude:      f => f.longitude,
  hour:           f => f.hour,
  month:          f => f.month,
  // Added 2026-09-18 for the V2 model. Without these three readers
  // validateModel() rejected the artifact with `unknown_features` and the local
  // model stayed silently disabled, which meant every score kept going over the
  // network to Cloud Run — where 13 of 17 spots were timing out and falling back
  // to an unevaluated heuristic.
  feels_like_c:    f => f.feelsLike,
  gust_delta_mph:  f => f.gustDelta,
  // A flag, not a measurement: the model was trained on 0/1. Absent means "no
  // marine data", which is a fact we know, not a value we are guessing.
  marine_available: f => (f.marineAvailable ? 1 : 0)
};

// Features whose VALUES are known to be partly synthetic. Anything listed here
// that an artifact actually uses gets logged once at load time, so the provenance
// of a published score is never a surprise.
const FEATURE_CAVEATS = {
  wave_height_m: 'inland lakes have no marine data; wave height is derived from wind, not measured',
  feels_like_c: 'provider-computed apparent temperature, not an independent measurement',
  water_temp_c:  'unmeasured on most spots; derived from air temperature for the model only'
};

function candidatePaths() {
  const override = (process.env.PADDLE_LOCAL_MODEL_PATH || '').trim();
  // An explicit override is EXCLUSIVE. It used to be merely the first candidate,
  // so pointing at a path that did not exist silently loaded whatever artifact
  // happened to sit at the default location — i.e. you could believe you were
  // scoring with one model and actually be scoring with another. Given the whole
  // point of this module is provenance, a wrong override must fail loudly, not
  // quietly resolve to something else.
  if (override) return [override];
  const paths = [];
  paths.push(path.join(__dirname, '..', '..', 'data', 'models', ARTIFACT_BASENAME));
  paths.push(path.join(__dirname, '..', '..', '..', '..', 'paddle-llm', 'data', 'models', ARTIFACT_BASENAME));
  return paths;
}

/**
 * The local model is used when an artifact is present AND it is not switched
 * off. It is additive: with no artifact on disk this module is inert and every
 * caller keeps the existing Cloud Run behaviour byte for byte.
 */
function isEnabled() {
  return String(process.env.PADDLE_LOCAL_MODEL || '').trim().toLowerCase() !== 'off';
}

let cached = null; // { model, reason, source } — failures are cached too

/**
 * Structural validation of a model artifact.
 * @returns {{ok: true, model: object}|{ok: false, reason: string}}
 */
function validateModel(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'artifact_not_an_object' };
  if (raw.schema !== SUPPORTED_SCHEMA) return { ok: false, reason: `unsupported_schema:${raw.schema}` };

  const version = typeof raw.version === 'string' && raw.version.trim() ? raw.version.trim() : null;
  if (!version) return { ok: false, reason: 'version_missing' };
  if (typeof raw.fitted_on !== 'string' || !raw.fitted_on.trim()) return { ok: false, reason: 'fitted_on_missing' };

  if (!Array.isArray(raw.features) || raw.features.length === 0) return { ok: false, reason: 'features_missing' };
  const unknown = raw.features.filter(name => !(name in FEATURE_READERS));
  if (unknown.length) return { ok: false, reason: `unknown_features:${unknown.join(',')}` };

  if (!Number.isFinite(raw.baseline)) return { ok: false, reason: 'baseline_missing' };

  const learningRate = raw.learning_rate === undefined ? 1.0 : raw.learning_rate;
  if (!Number.isFinite(learningRate)) return { ok: false, reason: 'learning_rate_not_finite' };

  if (!Array.isArray(raw.trees) || raw.trees.length === 0) return { ok: false, reason: 'trees_missing' };
  for (let t = 0; t < raw.trees.length; t++) {
    const problem = validateTree(raw.trees[t], raw.features.length);
    if (problem) return { ok: false, reason: `tree_${t}:${problem}` };
  }

  const u = raw.uncertainty;
  if (!u || typeof u !== 'object') return { ok: false, reason: 'uncertainty_missing' };
  if (!Number.isFinite(u.residual_mae)) return { ok: false, reason: 'uncertainty_residual_mae_missing' };
  if (!Array.isArray(u.ci95) || u.ci95.length !== 2 || !u.ci95.every(Number.isFinite)) {
    return { ok: false, reason: 'uncertainty_ci95_missing' };
  }

  return {
    ok: true,
    model: {
      version,
      fittedOn: raw.fitted_on.trim(),
      features: raw.features.slice(),
      baseline: raw.baseline,
      learningRate,
      trees: raw.trees,
      uncertainty: {
        residualMae: u.residual_mae,
        ci95: u.ci95.slice(),
        nLabels: Number.isFinite(u.n_labels) ? u.n_labels : null,
        cv: typeof u.cv === 'string' ? u.cv : null
      },
      monotonicCst: raw.monotonic_cst || null,
      residualOf: typeof raw.residual_of === 'string' ? raw.residual_of : null
    }
  };
}

/**
 * Validate one tree: every node is either a leaf or a split whose child indices
 * are in range and point FORWARD, which makes an infinite walk impossible.
 * @returns {string|null} a reason, or null when the tree is sound
 */
function validateTree(tree, featureCount) {
  const nodes = tree?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return 'nodes_missing';

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n || typeof n !== 'object') return `node_${i}_not_an_object`;

    if (n.leaf !== undefined) {
      if (!Number.isFinite(n.leaf)) return `node_${i}_leaf_not_finite`;
      continue;
    }

    if (!Number.isInteger(n.feature) || n.feature < 0 || n.feature >= featureCount) {
      return `node_${i}_feature_out_of_range`;
    }
    if (!Number.isFinite(n.threshold)) return `node_${i}_threshold_not_finite`;
    if (!Number.isInteger(n.left) || !Number.isInteger(n.right)) return `node_${i}_child_not_integer`;
    if (n.left <= i || n.right <= i) return `node_${i}_child_not_forward`;
    if (n.left >= nodes.length || n.right >= nodes.length) return `node_${i}_child_out_of_range`;
  }
  return null;
}

/**
 * Load (and cache) the model artifact.
 * @returns {{model: object|null, reason: string, source: string|null}}
 */
function loadModel() {
  if (cached) return cached;

  if (!isEnabled()) {
    cached = { model: null, reason: 'disabled_by_env', source: null };
    return cached;
  }

  const tried = [];
  for (const p of candidatePaths()) {
    tried.push(p);
    let text;
    try {
      text = fs.readFileSync(p, 'utf8');
    } catch {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      console.warn(`localModel: ${p} is not valid JSON (${err.message}) — local model DISABLED, remote path will be used`);
      cached = { model: null, reason: 'artifact_unparseable', source: p };
      return cached;
    }

    const verdict = validateModel(parsed);
    if (!verdict.ok) {
      console.warn(`localModel: ${p} failed validation (${verdict.reason}) — local model DISABLED, remote path will be used`);
      cached = { model: null, reason: verdict.reason, source: p };
      return cached;
    }

    const caveats = verdict.model.features.filter(f => f in FEATURE_CAVEATS);
    console.log(
      `localModel: loaded ${verdict.model.version} (fitted ${verdict.model.fittedOn}, ` +
      `${verdict.model.trees.length} trees, ${verdict.model.features.length} features, ` +
      `out-of-fold MAE ${verdict.model.uncertainty.residualMae}) from ${p}` +
      (caveats.length ? ` — CAVEAT: ${caveats.map(c => `${c}: ${FEATURE_CAVEATS[c]}`).join('; ')}` : '')
    );
    cached = { model: verdict.model, reason: 'ok', source: p };
    return cached;
  }

  // Not an error: today there is no artifact, and the remote path is the
  // intended behaviour. Logged at info level so it is not mistaken for a fault.
  console.log(`localModel: no artifact found (looked in: ${tried.join(', ')}) — using the remote ML service`);
  cached = { model: null, reason: 'artifact_not_found', source: null };
  return cached;
}

/** Drop the cached artifact. Tests and hot-reload only. */
function _resetModelCache() {
  cached = null;
}

/**
 * Build the ordered feature vector an artifact asks for.
 * Throws on any feature the request cannot supply — a model evaluated on a
 * silently zero-filled input returns a confident number about nothing.
 *
 * @param {string[]} featureNames
 * @param {object} mlFeatures - output of standardizeForMLModel
 * @returns {number[]}
 */
function buildFeatureVector(featureNames, mlFeatures) {
  const vector = new Array(featureNames.length);
  const missing = [];

  for (let i = 0; i < featureNames.length; i++) {
    const name = featureNames[i];
    const reader = FEATURE_READERS[name];
    if (!reader) { missing.push(`${name} (no reader)`); continue; }
    const value = reader(mlFeatures);
    if (!Number.isFinite(value)) { missing.push(name); continue; }
    vector[i] = value;
  }

  if (missing.length) {
    throw new Error(`localModel: missing/non-finite features: ${missing.join(', ')}`);
  }
  return vector;
}

/**
 * Walk one tree and return its leaf value.
 * Split convention matches sklearn: go LEFT when x <= threshold.
 * Child indices were proven forward-pointing at load time, so this terminates.
 *
 * @param {{nodes: Array}} tree
 * @param {number[]} x
 * @returns {number}
 */
function evaluateTree(tree, x) {
  const nodes = tree.nodes;
  let i = 0;
  // nodes.length is a hard bound: every step strictly increases i.
  for (let steps = 0; steps <= nodes.length; steps++) {
    const node = nodes[i];
    if (node.leaf !== undefined) return node.leaf;
    const value = x[node.feature];
    i = value <= node.threshold ? node.left : node.right;
  }
  throw new Error('localModel: tree walk did not terminate at a leaf');
}

/**
 * Evaluate the whole ensemble.
 *
 * @param {object} model - a validated model from loadModel()
 * @param {number[]} x
 * @returns {number} raw ensemble output, NOT clamped and NOT snapped
 */
function evaluateEnsemble(model, x) {
  let sum = model.baseline;
  for (const tree of model.trees) {
    sum += model.learningRate * evaluateTree(tree, x);
  }
  if (!Number.isFinite(sum)) {
    throw new Error('localModel: ensemble produced a non-finite value');
  }
  return sum;
}

/**
 * Predict in-process.
 *
 * @param {object} mlFeatures - output of standardizeForMLModel
 * @returns {null|{success: true, rating: number, mlModelUsed: true,
 *          predictionSource: 'local-model', modelType: string, confidence: number,
 *          uncertainty: object, modelVersion: string}}
 *          null when no usable artifact is loaded — the caller must then use
 *          the remote path. Throws when an artifact IS loaded but cannot be
 *          honestly evaluated on this input.
 */
function predictLocal(mlFeatures) {
  const { model } = loadModel();
  if (!model) return null;

  if (model.residualOf) {
    // The ensemble predicts a residual on top of another score; adding it to a
    // bare baseline would publish a number that is not the model's output.
    // Composition is a real decision (which rule, evaluated where, calibrated
    // before or after) and is not being guessed in production code.
    throw new Error(
      `localModel: artifact ${model.version} declares residual_of='${model.residualOf}'; ` +
      'residual composition is NOT IMPLEMENTED — see composeResidual()'
    );
  }

  const x = buildFeatureVector(model.features, mlFeatures);
  const raw = evaluateEnsemble(model, x);
  const rating = Math.max(1.0, Math.min(5.0, raw));

  return {
    success: true,
    rating,
    rawRating: raw,
    mlModelUsed: true,
    predictionSource: 'local-model',
    modelType: `tree-ensemble/${model.version}`,
    // Not a probability. The out-of-fold MAE is the only defensible statement
    // this model can make about its own error, so that is what travels.
    confidence: 'measured',
    uncertainty: {
      residualMae: model.uncertainty.residualMae,
      ci95: model.uncertainty.ci95,
      nLabels: model.uncertainty.nLabels,
      cv: model.uncertainty.cv
    },
    modelVersion: model.version
  };
}

/**
 * Compose a residual-model prediction with its base score.
 *
 * NOT IMPLEMENTED — deliberately. Getting this wrong silently republishes the
 * expert rule's +0.869 optimistic bias with an ML label on it. The open
 * questions are: which base score (the raw rule, or the rule after isotonic
 * recalibration), and whether isotonic is applied before or after the residual
 * is added. Both orders were measured separately on 2026-09-18 and neither has
 * been measured in composition.
 */
function composeResidual() {
  throw new Error('localModel.composeResidual: NOT IMPLEMENTED — base-score and calibration order are still open');
}

/** Metadata for /metrics and response traceability. Never throws. */
function getLocalModelInfo() {
  const { model, reason, source } = loadModel();
  return {
    available: !!model,
    version: model?.version || null,
    fittedOn: model?.fittedOn || null,
    treeCount: model?.trees.length || 0,
    features: model?.features || null,
    uncertainty: model?.uncertainty || null,
    residualOf: model?.residualOf || null,
    reason,
    source
  };
}

module.exports = {
  predictLocal,
  loadModel,
  getLocalModelInfo,
  validateModel,
  validateTree,
  buildFeatureVector,
  evaluateTree,
  evaluateEnsemble,
  composeResidual,
  _resetModelCache,
  FEATURE_READERS,
  FEATURE_CAVEATS,
  SUPPORTED_SCHEMA,
  ARTIFACT_BASENAME
};
