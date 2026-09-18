/**
 * scoreCalibration — isotonic recalibration of the published Paddle Score
 *
 * Covers:
 *   1. evaluateIsotonic  — knots, interpolation, clipped extrapolation, clamp
 *   2. validateTable     — every way a corrupt artifact must be REFUSED
 *   3. loadCalibrator    — search path, env override, env disable, caching
 *   4. applyScoreCalibration — identity fallbacks, source gating, monotonicity
 *
 * The point of this suite is the failure policy. A calibrator that quietly
 * falls back to a plausible curve is worse than no calibrator at all, so most
 * of these tests assert that a bad artifact produces the IDENTITY map and a
 * machine-readable reason — never a number.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  applyScoreCalibration,
  evaluateIsotonic,
  loadCalibrator,
  getCalibratorInfo,
  validateTable,
  allowedSources,
  _resetCalibratorCache,
  ARTIFACT_BASENAME
} = require('../scoreCalibration');

// A small, well-formed calibrator that maps scores DOWN in the optimistic
// middle of the range — the shape the 2026-09-18 fit actually has.
const GOOD_TABLE = {
  version: 'isotonic-test-v1',
  fitted_on: '2026-09-18',
  knots: [1.0, 2.0, 3.0, 4.0, 5.0],
  values: [1.0, 1.5, 2.2, 3.0, 4.2],
  applies_to: ['paddle-llm'],
  n_labels: 187,
  cv: 'grouped-by-lake 5-fold, seed 42'
};

// The shape the paddle-llm repo actually emits (schema
// paddle-llm.isotonic-calibrator.v1, 2026-09-18). Different key names, no
// `version`, no `fitted_on`, no `applies_to`. Values are the real fitted ones.
const SCIENCE_REPO_TABLE = {
  schema: 'paddle-llm.isotonic-calibrator.v1',
  created_utc: '2026-09-18T15:56:09+00:00',
  score_min: 1.0,
  score_max: 5.0,
  knots_x: [1.0, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5],
  knots_y: [1.0, 1.0, 1.0384615384615385, 1.894736842105263, 2.6666666666666665, 3.2325581395348837, 3.6904761904761907],
  metadata: {
    n_labels: 187,
    n_lakes: 93,
    rule: 'paddle_llm.labels.hybrid.expert_label',
    fold_scheme: 'grouped-by-lake 5-fold, seed 42',
    intended_use: 'Apply to the raw expert-rule score before publishing.'
  }
};

let tmpDir;

function writeArtifact(obj, name = ARTIFACT_BASENAME) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
  return p;
}

const ENV_KEYS = [
  'PADDLE_SCORE_CALIBRATOR_PATH',
  'PADDLE_SCORE_CALIBRATION',
  'PADDLE_SCORE_CALIBRATION_SOURCES'
];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaayko-cal-'));
  ENV_KEYS.forEach(k => delete process.env[k]);
  // Every test names its own artifact path. Without this the suite would read
  // whatever happens to be sitting in functions/data/models and stop being a
  // test of this module.
  process.env.PADDLE_SCORE_CALIBRATOR_PATH = path.join(tmpDir, ARTIFACT_BASENAME);
  _resetCalibratorCache();
});

afterEach(() => {
  ENV_KEYS.forEach(k => delete process.env[k]);
  _resetCalibratorCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. evaluateIsotonic
// ─────────────────────────────────────────────────────────────────────────────

describe('evaluateIsotonic', () => {
  const table = { knots: GOOD_TABLE.knots, values: GOOD_TABLE.values };

  test('returns the fitted value exactly at each knot', () => {
    table.knots.forEach((k, i) => {
      expect(evaluateIsotonic(table, k)).toBeCloseTo(table.values[i], 10);
    });
  });

  test('interpolates linearly between two knots', () => {
    // Midpoint of [3.0 -> 2.2] and [4.0 -> 3.0] is (2.2 + 3.0) / 2 = 2.6
    expect(evaluateIsotonic(table, 3.5)).toBeCloseTo(2.6, 10);
    // Quarter point: 2.2 + 0.25 * 0.8 = 2.4
    expect(evaluateIsotonic(table, 3.25)).toBeCloseTo(2.4, 10);
  });

  test('extrapolates FLAT outside the knot range (sklearn out_of_bounds=clip)', () => {
    expect(evaluateIsotonic(table, 0.0)).toBeCloseTo(1.0, 10);
    expect(evaluateIsotonic(table, -99)).toBeCloseTo(1.0, 10);
    expect(evaluateIsotonic(table, 9.9)).toBeCloseTo(4.2, 10);
  });

  test('clamps output to the published 1-5 scale', () => {
    const wild = { knots: [1, 5], values: [-4, 11] };
    expect(evaluateIsotonic(wild, 1)).toBe(1.0);
    expect(evaluateIsotonic(wild, 5)).toBe(5.0);
    expect(evaluateIsotonic(wild, 3)).toBeGreaterThanOrEqual(1.0);
    expect(evaluateIsotonic(wild, 3)).toBeLessThanOrEqual(5.0);
  });

  test('returns null — not a guess — for a non-finite input', () => {
    expect(evaluateIsotonic(table, NaN)).toBeNull();
    expect(evaluateIsotonic(table, Infinity)).toBeNull();
    expect(evaluateIsotonic(table, undefined)).toBeNull();
  });

  test('is monotone non-decreasing across the whole range', () => {
    // The safety property that makes isotonic recalibration acceptable at all:
    // it can move the LEVEL of the scale but can never rank a worse day higher.
    let previous = -Infinity;
    for (let x = 0.5; x <= 5.5; x += 0.05) {
      const y = evaluateIsotonic(table, x);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = y;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. validateTable — every refusal
// ─────────────────────────────────────────────────────────────────────────────

describe('validateTable', () => {
  test('accepts a well-formed table and normalizes its metadata', () => {
    const verdict = validateTable(GOOD_TABLE);
    expect(verdict.ok).toBe(true);
    expect(verdict.table.version).toBe('isotonic-test-v1');
    expect(verdict.table.fittedOn).toBe('2026-09-18');
    expect(verdict.table.appliesTo).toEqual(['paddle-llm']);
    expect(verdict.table.nLabels).toBe(187);
  });

  test('REFUSES a non-monotone values array (not isotonic → corrupt artifact)', () => {
    const bad = { ...GOOD_TABLE, values: [1.0, 1.5, 2.2, 1.9, 4.2] };
    const verdict = validateTable(bad);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/values_not_monotone/);
  });

  test('REFUSES knots that are not strictly increasing', () => {
    const bad = { ...GOOD_TABLE, knots: [1.0, 2.0, 2.0, 4.0, 5.0] };
    expect(validateTable(bad).reason).toMatch(/knots_not_strictly_increasing/);
  });

  test('REFUSES a length mismatch', () => {
    expect(validateTable({ ...GOOD_TABLE, values: [1, 2, 3] }).reason).toBe('knots_values_length_mismatch');
  });

  test('REFUSES fewer than two knots', () => {
    expect(validateTable({ ...GOOD_TABLE, knots: [1], values: [1] }).reason).toBe('fewer_than_two_knots');
  });

  test('REFUSES non-finite entries', () => {
    expect(validateTable({ ...GOOD_TABLE, values: [1.0, 1.5, null, 3.0, 4.2] }).reason).toMatch(/non_finite_entry/);
  });

  test('REFUSES an artifact with no version or no fitted_on — untraceable', () => {
    const { version, ...noVersion } = GOOD_TABLE;
    expect(validateTable(noVersion).reason).toBe('version_missing');
    const { fitted_on, ...noDate } = GOOD_TABLE;
    expect(validateTable(noDate).reason).toBe('fitted_on_missing');
  });

  test('REFUSES a non-object', () => {
    expect(validateTable(null).reason).toBe('artifact_not_an_object');
    expect(validateTable('[]').reason).toBe('artifact_not_an_object');
  });

  test('REFUSES a curve fitted on a different output scale', () => {
    expect(validateTable({ ...SCIENCE_REPO_TABLE, score_max: 10 }).reason).toMatch(/scale_mismatch_max/);
    expect(validateTable({ ...SCIENCE_REPO_TABLE, score_min: 0 }).reason).toMatch(/scale_mismatch_min/);
  });

  // ── Interop with what the science repo actually ships ────────────────────
  test('accepts the paddle-llm knots_x/knots_y spelling', () => {
    const verdict = validateTable(SCIENCE_REPO_TABLE);
    expect(verdict.ok).toBe(true);
    expect(verdict.table.knots).toEqual(SCIENCE_REPO_TABLE.knots_x);
    expect(verdict.table.values).toEqual(SCIENCE_REPO_TABLE.knots_y);
  });

  test('derives a traceable version from schema@created_utc when none is stated', () => {
    const verdict = validateTable(SCIENCE_REPO_TABLE);
    expect(verdict.table.version).toBe('paddle-llm.isotonic-calibrator.v1@2026-09-18T15:56:09+00:00');
    expect(verdict.table.fittedOn).toBe('2026-09-18T15:56:09+00:00');
  });

  test('lifts provenance out of metadata so /metrics can show it', () => {
    const verdict = validateTable(SCIENCE_REPO_TABLE);
    expect(verdict.table.nLabels).toBe(187);
    expect(verdict.table.cv).toBe('grouped-by-lake 5-fold, seed 42');
    expect(verdict.table.fittedOnRule).toBe('paddle_llm.labels.hybrid.expert_label');
    expect(verdict.table.intendedUse).toMatch(/expert-rule/);
  });

  test('the real artifact carries no applies_to — the source gate must catch it', () => {
    expect(validateTable(SCIENCE_REPO_TABLE).table.appliesTo).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2b. allowedSources — the gate that stops a curve being used on the wrong model
// ─────────────────────────────────────────────────────────────────────────────

describe('allowedSources', () => {
  test('uses the artifact list when it has one', () => {
    const table = validateTable(GOOD_TABLE).table;
    expect(allowedSources(table)).toEqual({ list: ['paddle-llm'], origin: 'artifact' });
  });

  test('the operator env list overrides the artifact', () => {
    process.env.PADDLE_SCORE_CALIBRATION_SOURCES = 'ml-model, local-model';
    const table = validateTable(GOOD_TABLE).table;
    expect(allowedSources(table)).toEqual({ list: ['ml-model', 'local-model'], origin: 'env' });
  });

  test('reports unspecified when neither exists — never a default list', () => {
    const table = validateTable(SCIENCE_REPO_TABLE).table;
    expect(allowedSources(table)).toEqual({ list: null, origin: 'unspecified' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. loadCalibrator
// ─────────────────────────────────────────────────────────────────────────────

describe('loadCalibrator', () => {
  test('loads the artifact named by PADDLE_SCORE_CALIBRATOR_PATH', () => {
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = writeArtifact(GOOD_TABLE);
    const { table, reason } = loadCalibrator();
    expect(reason).toBe('ok');
    expect(table.version).toBe('isotonic-test-v1');
    expect(table.knots).toHaveLength(5);
  });

  test('reports artifact_not_found when nothing is on disk', () => {
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = path.join(tmpDir, 'does-not-exist.json');
    const { table, reason } = loadCalibrator();
    expect(table).toBeNull();
    expect(reason).toBe('artifact_not_found');
  });

  test('an explicit override that is missing does NOT fall through to another artifact', () => {
    // Regression: the first draft of this module listed the science repo as a
    // fallback location, so naming a missing file silently loaded a DIFFERENT
    // curve. An operator who names a path gets that path or nothing.
    writeArtifact(GOOD_TABLE); // a valid artifact does exist in tmpDir
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = path.join(tmpDir, 'not-the-one-i-named.json');
    expect(loadCalibrator().reason).toBe('artifact_not_found');
  });

  test('reports artifact_unparseable for invalid JSON — never a partial read', () => {
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = writeArtifact('{"knots": [1,2', 'broken.json');
    const { table, reason } = loadCalibrator();
    expect(table).toBeNull();
    expect(reason).toBe('artifact_unparseable');
  });

  test('a corrupt table is refused at load time, not at evaluation time', () => {
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = writeArtifact({ ...GOOD_TABLE, values: [5, 4, 3, 2, 1] });
    const { table, reason } = loadCalibrator();
    expect(table).toBeNull();
    expect(reason).toMatch(/values_not_monotone/);
  });

  test('PADDLE_SCORE_CALIBRATION=off disables loading entirely', () => {
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = writeArtifact(GOOD_TABLE);
    process.env.PADDLE_SCORE_CALIBRATION = 'off';
    const { table, reason } = loadCalibrator();
    expect(table).toBeNull();
    expect(reason).toBe('disabled_by_env');
  });

  test('caches: the artifact is read once per process, not once per score', () => {
    const p = writeArtifact(GOOD_TABLE);
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = p;
    expect(loadCalibrator().table.version).toBe('isotonic-test-v1');

    // Deleting the file must not change the answer until the cache is reset.
    fs.rmSync(p);
    expect(loadCalibrator().table.version).toBe('isotonic-test-v1');

    _resetCalibratorCache();
    expect(loadCalibrator().table).toBeNull();
  });

  test('getCalibratorInfo reports provenance without throwing', () => {
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = writeArtifact(GOOD_TABLE);
    const info = getCalibratorInfo();
    expect(info.available).toBe(true);
    expect(info.version).toBe('isotonic-test-v1');
    expect(info.knotCount).toBe(5);
    expect(info.nLabels).toBe(187);
    expect(info.cv).toBe('grouped-by-lake 5-fold, seed 42');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. applyScoreCalibration
// ─────────────────────────────────────────────────────────────────────────────

describe('applyScoreCalibration', () => {
  test('falls back to IDENTITY when no artifact exists — this is today\'s state', () => {
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = path.join(tmpDir, 'nope.json');
    const out = applyScoreCalibration(4.2, { predictionSource: 'paddle-llm' });
    expect(out.rating).toBe(4.2);
    expect(out.applied).toBe(false);
    expect(out.version).toBeNull();
    expect(out.reason).toBe('artifact_not_found');
  });

  test('applies the curve and reports the version that produced the number', () => {
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = writeArtifact(GOOD_TABLE);
    const out = applyScoreCalibration(3.5, { predictionSource: 'paddle-llm' });
    expect(out.applied).toBe(true);
    expect(out.version).toBe('isotonic-test-v1');
    expect(out.rating).toBeCloseTo(2.6, 10);
    expect(out.inputRating).toBe(3.5);
  });

  test('an optimistic score is pulled DOWN, which is the whole point', () => {
    // Measured 2026-09-18: the uncalibrated rule was over-optimistic on 51.3%
    // of labelled rows (bias +0.869). Recalibration must not be able to make a
    // score more optimistic under a downward-mapping curve.
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = writeArtifact(GOOD_TABLE);
    [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0].forEach(r => {
      const out = applyScoreCalibration(r, { predictionSource: 'paddle-llm' });
      expect(out.applied).toBe(true);
      expect(out.rating).toBeLessThanOrEqual(r + 1e-12);
    });
  });

  test('REFUSES to apply a curve fitted on a different prediction source', () => {
    // A curve fitted on paddle-llm output is not valid for the Cloud Run
    // GradientBoostingRegressor. Bending a different model's numbers with it
    // would be a lie with a version number attached.
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = writeArtifact(GOOD_TABLE);
    const out = applyScoreCalibration(3.5, { predictionSource: 'ml-model' });
    expect(out.applied).toBe(false);
    expect(out.rating).toBe(3.5);
    expect(out.reason).toBe('source_mismatch');
    expect(out.version).toBe('isotonic-test-v1'); // still traceable
  });

  test('REFUSES an artifact that names no source at all — including the real one', () => {
    // This is the live situation as of 2026-09-18: the science repo's artifact
    // has no applies_to, so it does NOT silently start reshaping production
    // scores the moment it is copied into functions/data/models.
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = writeArtifact(SCIENCE_REPO_TABLE);
    const out = applyScoreCalibration(3.5, { predictionSource: 'ml-model' });
    expect(out.applied).toBe(false);
    expect(out.rating).toBe(3.5);
    expect(out.reason).toBe('applies_to_unspecified');
    expect(out.version).toBe('paddle-llm.isotonic-calibrator.v1@2026-09-18T15:56:09+00:00');
  });

  test('an operator can turn it on deliberately with PADDLE_SCORE_CALIBRATION_SOURCES', () => {
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = writeArtifact(SCIENCE_REPO_TABLE);
    process.env.PADDLE_SCORE_CALIBRATION_SOURCES = 'ml-model';
    const out = applyScoreCalibration(3.5, { predictionSource: 'ml-model' });
    expect(out.applied).toBe(true);
    // Real fitted knots: 3.5 is a knot, value 2.6666666666666665
    expect(out.rating).toBeCloseTo(2.6666666666666665, 10);
  });

  test('the real curve lowers every score in the optimistic band', () => {
    // The published effect of shipping this artifact, stated as a test rather
    // than as a claim: nothing goes up, and the middle of the range drops hard.
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = writeArtifact(SCIENCE_REPO_TABLE);
    process.env.PADDLE_SCORE_CALIBRATION_SOURCES = 'ml-model';
    const deltas = [2.5, 3.0, 3.5, 4.0, 4.5].map(r => {
      const out = applyScoreCalibration(r, { predictionSource: 'ml-model' });
      return out.rating - r;
    });
    deltas.forEach(d => expect(d).toBeLessThan(0));
    // A 3.0 ("Careful") becomes roughly 1.9 ("Hard pass") — a tier change.
    expect(deltas[1]).toBeLessThan(-1.0);
  });

  test('refuses when the prediction source is unknown', () => {
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = writeArtifact(GOOD_TABLE);
    const out = applyScoreCalibration(3.5, {});
    expect(out.applied).toBe(false);
    expect(out.reason).toBe('prediction_source_unknown');
  });

  test('passes a non-finite rating straight through and says so', () => {
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = writeArtifact(GOOD_TABLE);
    const out = applyScoreCalibration(NaN, { predictionSource: 'paddle-llm' });
    expect(out.applied).toBe(false);
    expect(out.reason).toBe('input_not_finite');
  });

  test('output always lands inside the published 1-5 scale', () => {
    process.env.PADDLE_SCORE_CALIBRATOR_PATH = writeArtifact(GOOD_TABLE);
    [-10, 0.2, 1, 3.3, 5, 40].forEach(r => {
      const out = applyScoreCalibration(r, { predictionSource: 'paddle-llm' });
      expect(out.rating).toBeGreaterThanOrEqual(1.0);
      expect(out.rating).toBeLessThanOrEqual(5.0);
    });
  });
});
