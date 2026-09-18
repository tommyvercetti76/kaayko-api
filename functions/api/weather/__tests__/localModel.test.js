/**
 * localModel — in-process tree-ensemble evaluation (replaces the per-score
 * HTTPS hop to Cloud Run).
 *
 * Covers:
 *   1. validateModel / validateTree — every way an artifact must be REFUSED
 *   2. buildFeatureVector — a missing feature THROWS, it never becomes a zero
 *   3. evaluateTree / evaluateEnsemble — arithmetic against a hand-checked tree
 *   4. predictLocal — inert with no artifact, uncertainty carried, residual
 *      artifacts refused until composition is decided
 *
 * The recurring assertion is that this module returns null or throws rather
 * than producing a plausible number, because a confident wrong Paddle Score is
 * the failure this whole project exists to eliminate.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
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
  SUPPORTED_SCHEMA,
  ARTIFACT_BASENAME,
  FEATURE_READERS
} = require('../localModel');

// Two tiny trees over [wind_mph, temperature_c], hand-checkable:
//   tree 0: wind <= 10 ? +0.5 : -1.2
//   tree 1: temp <= 5  ? -0.3 : +0.2
// baseline 3.0, learning_rate 1.0
const GOOD_MODEL = {
  schema: SUPPORTED_SCHEMA,
  version: 'test-ensemble-v1',
  fitted_on: '2026-09-18',
  features: ['wind_mph', 'temperature_c'],
  baseline: 3.0,
  learning_rate: 1.0,
  trees: [
    { nodes: [{ feature: 0, threshold: 10, left: 1, right: 2 }, { leaf: 0.5 }, { leaf: -1.2 }] },
    { nodes: [{ feature: 1, threshold: 5, left: 1, right: 2 }, { leaf: -0.3 }, { leaf: 0.2 }] }
  ],
  uncertainty: {
    residual_mae: 0.588,
    ci95: [0.508, 0.668],
    n_labels: 187,
    cv: 'grouped-by-lake 5-fold, seed 42'
  }
};

const FEATURES = {
  temperature: 20, windSpeed: 8, gustSpeed: 11, windDirection: 180,
  humidity: 60, cloudCover: 30, uvIndex: 5, visibility: 10, pressure: 1013,
  precipMm: 0, precipChancePercent: 10, beaufortScale: 2,
  waveHeight: 0.1, waterTemp: 12, latitude: 39.1, longitude: -120.03, hour: 13, month: 9
};

const ENV_KEYS = ['PADDLE_LOCAL_MODEL_PATH', 'PADDLE_LOCAL_MODEL'];
let tmpDir;

function writeArtifact(obj, name = ARTIFACT_BASENAME) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
  return p;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaayko-lm-'));
  ENV_KEYS.forEach(k => delete process.env[k]);
  process.env.PADDLE_LOCAL_MODEL_PATH = path.join(tmpDir, ARTIFACT_BASENAME);
  _resetModelCache();
});

afterEach(() => {
  ENV_KEYS.forEach(k => delete process.env[k]);
  _resetModelCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Artifact validation
// ─────────────────────────────────────────────────────────────────────────────

describe('validateModel', () => {
  test('accepts a well-formed artifact', () => {
    const verdict = validateModel(GOOD_MODEL);
    expect(verdict.ok).toBe(true);
    expect(verdict.model.version).toBe('test-ensemble-v1');
    expect(verdict.model.uncertainty.residualMae).toBe(0.588);
  });

  test('REFUSES an artifact with no uncertainty — a score with no error bar', () => {
    const { uncertainty, ...noU } = GOOD_MODEL;
    expect(validateModel(noU).reason).toBe('uncertainty_missing');
    expect(validateModel({ ...GOOD_MODEL, uncertainty: { ci95: [0.5, 0.7] } }).reason)
      .toBe('uncertainty_residual_mae_missing');
    expect(validateModel({ ...GOOD_MODEL, uncertainty: { residual_mae: 0.5 } }).reason)
      .toBe('uncertainty_ci95_missing');
  });

  test('REFUSES an unsupported schema', () => {
    expect(validateModel({ ...GOOD_MODEL, schema: 'something.else.v9' }).reason)
      .toMatch(/unsupported_schema/);
  });

  test('REFUSES a feature this API cannot supply', () => {
    // No silent zero for a feature with no reader — the artifact is rejected.
    expect(validateModel({ ...GOOD_MODEL, features: ['wind_mph', 'moon_phase'] }).reason)
      .toBe('unknown_features:moon_phase');
  });

  test('REFUSES a missing version, fitted_on, baseline or trees', () => {
    const drop = (k) => { const c = { ...GOOD_MODEL }; delete c[k]; return c; };
    expect(validateModel(drop('version')).reason).toBe('version_missing');
    expect(validateModel(drop('fitted_on')).reason).toBe('fitted_on_missing');
    expect(validateModel(drop('baseline')).reason).toBe('baseline_missing');
    expect(validateModel(drop('trees')).reason).toBe('trees_missing');
    expect(validateModel(drop('features')).reason).toBe('features_missing');
  });

  test('defaults learning_rate to 1.0 but refuses a non-finite one', () => {
    const { learning_rate, ...noLr } = GOOD_MODEL;
    expect(validateModel(noLr).model.learningRate).toBe(1.0);
    expect(validateModel({ ...GOOD_MODEL, learning_rate: 'fast' }).reason).toBe('learning_rate_not_finite');
  });
});

describe('validateTree', () => {
  test('accepts a sound tree', () => {
    expect(validateTree(GOOD_MODEL.trees[0], 2)).toBeNull();
  });

  test('REFUSES a child index that points backwards — an infinite walk', () => {
    const cyclic = { nodes: [{ feature: 0, threshold: 1, left: 1, right: 2 }, { feature: 0, threshold: 1, left: 0, right: 2 }, { leaf: 1 }] };
    expect(validateTree(cyclic, 2)).toMatch(/child_not_forward/);
  });

  test('REFUSES a child index off the end of the node array', () => {
    const dangling = { nodes: [{ feature: 0, threshold: 1, left: 1, right: 9 }, { leaf: 1 }] };
    expect(validateTree(dangling, 2)).toMatch(/child_out_of_range/);
  });

  test('REFUSES a feature index outside the declared feature list', () => {
    const bad = { nodes: [{ feature: 7, threshold: 1, left: 1, right: 2 }, { leaf: 1 }, { leaf: 2 }] };
    expect(validateTree(bad, 2)).toMatch(/feature_out_of_range/);
  });

  test('REFUSES a non-finite leaf', () => {
    const bad = { nodes: [{ leaf: null }] };
    expect(validateTree(bad, 2)).toMatch(/leaf_not_finite/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Feature vector — missing data throws, never defaults
// ─────────────────────────────────────────────────────────────────────────────

describe('buildFeatureVector', () => {
  test('reads features in the order the artifact declares', () => {
    expect(buildFeatureVector(['wind_mph', 'temperature_c'], FEATURES)).toEqual([8, 20]);
    expect(buildFeatureVector(['temperature_c', 'wind_mph'], FEATURES)).toEqual([20, 8]);
  });

  test('THROWS on a missing feature — it never becomes a zero', () => {
    const { windSpeed, ...noWind } = FEATURES;
    expect(() => buildFeatureVector(['wind_mph', 'temperature_c'], noWind))
      .toThrow(/wind_mph/);
  });

  test('THROWS on a non-finite feature', () => {
    expect(() => buildFeatureVector(['wind_mph'], { ...FEATURES, windSpeed: NaN }))
      .toThrow(/wind_mph/);
    expect(() => buildFeatureVector(['wind_mph'], { ...FEATURES, windSpeed: null }))
      .toThrow(/wind_mph/);
  });

  test('a genuine zero is a value, not a missing feature', () => {
    // 0 mph wind and 0 km visibility (fog) are real readings.
    expect(buildFeatureVector(['wind_mph', 'visibility_km'], { ...FEATURES, windSpeed: 0, visibility: 0 }))
      .toEqual([0, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Evaluation arithmetic
// ─────────────────────────────────────────────────────────────────────────────

describe('evaluateTree / evaluateEnsemble', () => {
  const model = validateModel(GOOD_MODEL).model;

  test('splits LEFT on x <= threshold (sklearn convention)', () => {
    expect(evaluateTree(model.trees[0], [10, 20])).toBe(0.5);   // exactly at the threshold
    expect(evaluateTree(model.trees[0], [10.1, 20])).toBe(-1.2);
    expect(evaluateTree(model.trees[0], [0, 20])).toBe(0.5);
  });

  test('ensemble is baseline + the sum of leaf values', () => {
    // wind 8 (<=10) -> +0.5 ; temp 20 (>5) -> +0.2 ; 3.0 + 0.7 = 3.7
    expect(evaluateEnsemble(model, [8, 20])).toBeCloseTo(3.7, 10);
    // wind 25 (>10) -> -1.2 ; temp 2 (<=5) -> -0.3 ; 3.0 - 1.5 = 1.5
    expect(evaluateEnsemble(model, [25, 2])).toBeCloseTo(1.5, 10);
  });

  test('learning_rate scales the leaf contributions', () => {
    const halved = validateModel({ ...GOOD_MODEL, learning_rate: 0.5 }).model;
    expect(evaluateEnsemble(halved, [8, 20])).toBeCloseTo(3.0 + 0.35, 10);
  });

  test('a single-leaf tree is a constant', () => {
    expect(evaluateTree({ nodes: [{ leaf: -0.4 }] }, [999])).toBe(-0.4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. predictLocal
// ─────────────────────────────────────────────────────────────────────────────

describe('predictLocal', () => {
  test('returns null when the artifact is genuinely absent', () => {
    // This test previously asserted "the module is inert today" because no
    // artifact had shipped. That premise expired on 2026-09-18 when
    // data/models/paddle-score-model-v1.json (direct-hgb-mono-v2) was staged:
    // the module is now LIVE and serving scores in-process. What still needs
    // protecting is the absent-artifact path itself, so point the loader at a
    // path that does not exist rather than relying on production having none.
    const prev = process.env.PADDLE_LOCAL_MODEL_PATH;
    process.env.PADDLE_LOCAL_MODEL_PATH = '/nonexistent/paddle-score-model-v1.json';
    _resetModelCache();
    try {
      expect(predictLocal(FEATURES)).toBeNull();
      expect(loadModel().reason).toBe('artifact_not_found');
    } finally {
      if (prev === undefined) delete process.env.PADDLE_LOCAL_MODEL_PATH;
      else process.env.PADDLE_LOCAL_MODEL_PATH = prev;
      _resetModelCache();
    }
  });

  test('the shipped artifact loads and its features all have readers', () => {
    // Guards the exact defect that kept V2 from shipping: the artifact used
    // feels_like_c, gust_delta_mph and marine_available, FEATURE_READERS had
    // none of them, validateModel() rejected it with `unknown_features`, and
    // the local model stayed silently disabled while every score went over the
    // network to a Cloud Run service that was timing out.
    const fs = require('fs');
    const path = require('path');
    const shipped = path.join(__dirname, '..', '..', '..', 'data', 'models', 'paddle-score-model-v1.json');
    if (!fs.existsSync(shipped)) return;   // artifact not staged in this checkout
    const art = JSON.parse(fs.readFileSync(shipped, 'utf8'));
    const missing = art.features.filter(f => !(f in FEATURE_READERS));
    expect(missing).toEqual([]);
  });

  test('returns null when switched off even with an artifact present', () => {
    writeArtifact(GOOD_MODEL);
    process.env.PADDLE_LOCAL_MODEL = 'off';
    expect(predictLocal(FEATURES)).toBeNull();
    expect(loadModel().reason).toBe('disabled_by_env');
  });

  test('predicts, and carries the uncertainty and the version with the number', () => {
    writeArtifact(GOOD_MODEL);
    const out = predictLocal(FEATURES);
    expect(out.rating).toBeCloseTo(3.7, 10);
    expect(out.predictionSource).toBe('local-model');
    expect(out.modelVersion).toBe('test-ensemble-v1');
    expect(out.uncertainty.residualMae).toBe(0.588);
    expect(out.uncertainty.ci95).toEqual([0.508, 0.668]);
    // Not a fabricated probability.
    expect(out.confidence).toBe('measured');
  });

  test('clamps to the published 1-5 scale but keeps the raw value', () => {
    writeArtifact({ ...GOOD_MODEL, baseline: 9.0 });
    const out = predictLocal(FEATURES);
    expect(out.rating).toBe(5.0);
    expect(out.rawRating).toBeCloseTo(9.7, 10);
  });

  test('THROWS rather than scoring when a declared feature is absent', () => {
    writeArtifact({ ...GOOD_MODEL, features: ['wind_mph', 'water_temp_c'] });
    const { waterTemp, ...noWater } = FEATURES;
    expect(() => predictLocal(noWater)).toThrow(/water_temp_c/);
  });

  test('REFUSES a residual artifact until composition is decided', () => {
    writeArtifact({ ...GOOD_MODEL, residual_of: 'expert_rule_v1' });
    expect(() => predictLocal(FEATURES)).toThrow(/NOT IMPLEMENTED/);
    expect(() => composeResidual()).toThrow(/NOT IMPLEMENTED/);
  });

  test('a corrupt artifact disables the local path instead of scoring with it', () => {
    writeArtifact('{ not json');
    expect(predictLocal(FEATURES)).toBeNull();
    expect(loadModel().reason).toBe('artifact_unparseable');
  });

  test('getLocalModelInfo reports provenance without throwing', () => {
    writeArtifact(GOOD_MODEL);
    const info = getLocalModelInfo();
    expect(info.available).toBe(true);
    expect(info.version).toBe('test-ensemble-v1');
    expect(info.treeCount).toBe(2);
    expect(info.features).toEqual(['wind_mph', 'temperature_c']);
    expect(info.uncertainty.residualMae).toBe(0.588);
  });
});
