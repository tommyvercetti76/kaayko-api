// Regression tests for the 2026-09-18 production audit.
//
// Three defects were visible on one screen at kaayko.com/paddlingout:
//   1. the hero read 3.5 "Careful" while the 1 PM forecast hour read 1.5 "Hard
//      pass" — because the hero had silently fallen back to an unevaluated
//      heuristic after the ML call timed out, while the forecast used the model.
//   2. the hero said water temperature "No sensor" while the same hour's panel
//      published 81 F, because only one of the two paths honoured MEASURED OR
//      NOTHING.
//   3. a MEASURED 0.0 C — ice water — was discarded as falsy by `||`.
//
// These tests exist so none of the three can come back quietly.

const { standardizeForMLModel } = require('../dataStandardization');

const base = { temperature: 20, windSpeed: 5, latitude: 40, longitude: -100 };

describe('water temperature: measured or nothing', () => {
  test('a MEASURED 0.0 C survives into the model input (it is not falsy-dropped)', () => {
    const f = standardizeForMLModel(base, null, { water_temp_c: 0.0 });
    expect(f.waterTemp).toBe(0);
  });

  test('a measured non-zero temperature is passed through unchanged', () => {
    expect(standardizeForMLModel(base, null, { water_temp_c: 18.5 }).waterTemp).toBe(18.5);
  });

  test('with no marine hour the MODEL still receives a derived value', () => {
    // The model was trained with a derived water temperature, so it keeps one.
    // This is a model input, never a number shown to a paddler.
    const f = standardizeForMLModel(base, null, null);
    expect(typeof f.waterTemp).toBe('number');
    expect(Number.isFinite(f.waterTemp)).toBe(true);
  });

  test('a measured 0.0 C is NOT replaced by the warmer air-derived estimate', () => {
    const measured = standardizeForMLModel({ ...base, temperature: 25 }, null, { water_temp_c: 0.0 });
    const derived = standardizeForMLModel({ ...base, temperature: 25 }, null, null);
    expect(measured.waterTemp).toBe(0);
    expect(derived.waterTemp).toBeGreaterThan(0);
    expect(measured.waterTemp).not.toBe(derived.waterTemp);
  });
});

describe('the forecast path applies the same water policy as the hero path', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'fastForecast.js'), 'utf8');

  test('fastForecast publishes the MEASURED value, never the estimate', () => {
    expect(src).toMatch(/waterTemp:\s+waterTempPublished/);
    expect(src).toMatch(/const waterTempPublished = measuredWaterTempC/);
  });

  test('fastForecast no longer uses `||` to pick a water temperature', () => {
    expect(src).not.toMatch(/water_temp_c \|\| Math\.max/);
  });

  test('fastForecast tells the penalty layer whether the water was measured', () => {
    // paddlePenalties stands its water rules down only on an explicit `false`.
    // Leaving this undefined made the forecast path penalise an ESTIMATE while
    // the hero path did not — the same water scoring differently by surface.
    expect(src).toMatch(/mlInputData\.waterTempMeasured = measuredWaterTempC !== null/);
  });

  test('the published hourly payload carries the measured flag', () => {
    expect(src).toMatch(/waterTempMeasured: measuredWaterTempC !== null/);
  });
});

describe('a degraded (non-model) score is never silent', () => {
  const ml = require('fs').readFileSync(require('path').join(__dirname, '..', 'mlService.js'), 'utf8');
  const pipe = require('fs').readFileSync(require('path').join(__dirname, '..', 'scoringPipeline.js'), 'utf8');

  test('the fallback branch marks itself degraded', () => {
    expect(ml).toMatch(/degraded: true/);
    expect(ml).toMatch(/degradedReason/);
  });

  test('the fallback logs at ERROR severity, not as an ordinary info line', () => {
    expect(ml).toMatch(/severity: 'ERROR'/);
    expect(ml).toMatch(/ml_prediction_fallback/);
  });

  test('one retry exists, because the first call is what warms the instance', () => {
    expect(ml).toMatch(/retrying once/);
  });

  test('the pipeline carries degraded through to the response', () => {
    expect(pipe).toMatch(/degraded: prediction\.degraded === true/);
  });

  test('a REUSED cached prediction inherits its degraded state', () => {
    // Otherwise a heuristic score launders itself into looking model-generated
    // on the next warmer cycle.
    expect(pipe).toMatch(/degraded: previousMLResult\.degraded \?\? false/);
  });
});
