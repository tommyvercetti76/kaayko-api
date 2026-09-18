// Regression tests for AUDIT-2026-09-18 findings #9, #19 and #21.
//
//  #9  The forecast path applied safety penalties and reported none of them.
//      Measured on the live API: an hour whose originalMLRating was 2.5
//      published 1.5, with `penaltyDetails: []` and `totalPenalty: null`.
//      A full point of deduction, invisible.
//
//  #19 `confidence` was a string ("high") on model spots and a number (0.7) on
//      fallback spots. One field, two types, no way to compare them.
//
//  #21 The V2 model's wind response flattens above ~15 mph — it was fitted on
//      187 labels with almost nothing above that speed. The wind PENALTIES
//      carry the high end. If they ever stop doing so, the site publishes a
//      survivable-looking number for a dangerous day.
//
// These are real assertions against real behaviour, not source-text greps,
// except where the assertion IS about the shape of the response payload.

const path = require('path');
const { normalizeConfidence, CONFIDENCE_RANK } = require('../scoringPipeline');

// ───────────────────────────────────────────────────────────────────────────
// #19 — one confidence representation
// ───────────────────────────────────────────────────────────────────────────
describe('#19 confidence has ONE representation across all three producers', () => {
  const localModel = {
    success: true,
    rating: 3.2,
    predictionSource: 'local-model',
    modelType: 'direct-hgb-mono-v2-2026-09-18',
    confidence: 'measured',
    uncertainty: { residualMae: 0.6026, ci95: [-1.18, 1.18], nLabels: 187, cv: 'grouped-by-lake-5-fold' }
  };
  const remoteModel = {
    success: true,
    rating: 3.2,
    predictionSource: 'ml-model',
    modelType: 'GradientBoostingRegressor',
    confidence: 0.99
  };
  const fallback = {
    success: true,
    rating: 3.0,
    predictionSource: 'fallback-rules',
    modelType: 'rule-based',
    degraded: true,
    degradedReason: 'ML service request timed out after 10000ms',
    confidence: 0.7
  };

  test('every producer yields a STRING from the closed vocabulary — never a number', () => {
    for (const p of [localModel, remoteModel, fallback]) {
      const { level } = normalizeConfidence(p);
      expect(typeof level).toBe('string');
      expect(['measured', 'estimated', 'unvalidated']).toContain(level);
    }
  });

  test('the three producers map to three DISTINCT levels — the difference is not flattened', () => {
    expect(normalizeConfidence(localModel).level).toBe('measured');
    expect(normalizeConfidence(remoteModel).level).toBe('estimated');
    expect(normalizeConfidence(fallback).level).toBe('unvalidated');
  });

  test('the levels are ORDERED, so a client can compare without parsing', () => {
    const rank = p => normalizeConfidence(p).basis.rank;
    expect(rank(localModel)).toBeGreaterThan(rank(remoteModel));
    expect(rank(remoteModel)).toBeGreaterThan(rank(fallback));
    expect(CONFIDENCE_RANK.measured).toBe(3);
  });

  test('only the local model gets `measured`, and only because it carries an error bar', () => {
    const basis = normalizeConfidence(localModel).basis;
    expect(basis.level).toBe('measured');
    expect(basis.uncertainty.residualMae).toBeCloseTo(0.6026, 4);
    expect(basis.reason).toBe('out_of_fold_error_stated');
  });

  test('a `measured` claim with NO uncertainty block is refused and downgraded', () => {
    // This is the cache/reuse path: a caller that replays the string without
    // carrying the evidence forward must not get to repeat the claim.
    const { level, basis } = normalizeConfidence({ ...localModel, uncertainty: null });
    expect(level).toBe('estimated');
    expect(basis.reason).toBe('measured_claimed_without_uncertainty');
    expect(basis.uncertainty).toBeNull();
  });

  test('a malformed uncertainty block does not buy a `measured` label', () => {
    expect(normalizeConfidence({ ...localModel, uncertainty: {} }).level).toBe('estimated');
    expect(normalizeConfidence({ ...localModel, uncertainty: { residualMae: 'low' } }).level).toBe('estimated');
  });

  test('the never-evaluated heuristic is `unvalidated`, NOT `estimated` — 0.7 is unearned', () => {
    expect(normalizeConfidence(fallback).level).toBe('unvalidated');
    expect(normalizeConfidence({ ...fallback, confidence: 0.99 }).level).toBe('unvalidated');
    // Degraded wins even if some future producer declares a measured error bar.
    expect(normalizeConfidence({ ...fallback, uncertainty: { residualMae: 0.1 } }).level).toBe('unvalidated');
  });

  test('a rule-based result is unvalidated even when nothing set the degraded flag', () => {
    expect(normalizeConfidence({
      success: true, predictionSource: 'ml-model', modelType: 'rule-based', confidence: 0.9
    }).level).toBe('unvalidated');
  });

  test('legacy string confidences never launder themselves into `measured`', () => {
    for (const legacy of ['high', 'medium', 'low', 'very high']) {
      expect(normalizeConfidence({ success: true, predictionSource: 'ml-model', confidence: legacy }).level)
        .toBe('estimated');
    }
  });

  test('it is IDEMPOTENT — re-normalizing its own output does not drift', () => {
    for (const p of [localModel, remoteModel, fallback]) {
      const first = normalizeConfidence(p);
      const replay = { ...p, confidence: first.level, uncertainty: first.basis.uncertainty };
      expect(normalizeConfidence(replay).level).toBe(first.level);
    }
  });

  test('nothing the producer declared is discarded', () => {
    expect(normalizeConfidence(remoteModel).basis).toMatchObject({
      declared: 0.99, declaredType: 'number', source: 'ml-model'
    });
    expect(normalizeConfidence(localModel).basis).toMatchObject({
      declared: 'measured', declaredType: 'string', source: 'local-model'
    });
  });

  test('a producer that declares nothing at all is still typed, and is not measured', () => {
    const { level, basis } = normalizeConfidence({ success: true, predictionSource: 'ml-model' });
    expect(level).toBe('estimated');
    expect(basis.declared).toBeNull();
    expect(basis.declaredType).toBe('null');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// #19 — the field must be the same type on every surface that publishes it
// ───────────────────────────────────────────────────────────────────────────
describe('#19 every surface publishes the normalized field, not a producer value', () => {
  const read = f => require('fs').readFileSync(path.join(__dirname, '..', f), 'utf8');

  test('scoringPipeline publishes the normalized level, not prediction.confidence', () => {
    const src = read('scoringPipeline.js');
    expect(src).toMatch(/confidence:\s*confidenceLevel/);
    // The old default silently made an unmeasured score look "high".
    expect(src).not.toMatch(/confidence:\s*prediction\.confidence\s*\|\|\s*'high'/);
  });

  test('the hero, the forecast hour and the batch row all carry confidenceBasis', () => {
    expect(read('paddleScore.js')).toMatch(/confidenceBasis:\s*score\s*\?\s*\(score\.confidenceBasis/);
    expect(read('paddleScore.js')).toMatch(/confidenceBasis:\s*score\.confidenceBasis/);
    expect(read('fastForecast.js')).toMatch(/confidenceBasis:\s*score\.confidenceBasis/);
  });

  test('mlService no longer invents 0.99 for a service that declared nothing', () => {
    expect(read('mlService.js')).not.toMatch(/confidence:\s*result\.confidence\s*\|\|\s*0\.99/);
    expect(read('mlService.js')).toMatch(/confidence:\s*result\.confidence\s*\?\?\s*null/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// #9 — the forecast hour must report the penalties it applied
// ───────────────────────────────────────────────────────────────────────────
describe('#9 the forecast path reports the same structured penalty fields as the hero', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'fastForecast.js'), 'utf8');
  // The per-hour prediction payload, isolated so a match elsewhere in the file
  // cannot make these pass by accident.
  const predictionBlock = src.slice(src.indexOf('prediction: {'), src.indexOf('originalRating:'));

  test.each([
    ['penaltyDetails', /penaltyDetails:\s*score\.penaltyDetails/],
    ['totalPenalty', /totalPenalty:\s*score\.totalPenalty/],
    ['penaltiesApplied', /penaltiesApplied:\s*score\.penaltiesApplied/],
    ['adjustments', /adjustments:\s*score\.adjustments/]
  ])('the per-hour prediction reports %s', (_name, re) => {
    expect(predictionBlock).toMatch(re);
  });

  test('algorithmVersion and degraded are actually populated on the hour, not just present', () => {
    expect(predictionBlock).toMatch(/algorithmVersion:\s*score\.algorithmVersion/);
    expect(predictionBlock).toMatch(/degraded:\s*score\.degraded === true/);
    expect(predictionBlock).toMatch(/degradedReason:\s*score\.degradedReason/);
  });

  test('totalPenalty falls back to 0, never to null — the live defect was a null', () => {
    expect(predictionBlock).toMatch(/totalPenalty:\s*score\.totalPenalty \?\? 0/);
  });

  test('the craft layer reads the real per-hour penalties instead of a hard-coded []', () => {
    expect(src).toMatch(/penaltyDetails:\s*h\.prediction\?\.penaltyDetails \?\? \[\]/);
  });

  test('the hero reports the penalty SUM too, so both surfaces reconcile the same way', () => {
    const hero = require('fs').readFileSync(path.join(__dirname, '..', 'paddleScore.js'), 'utf8');
    expect(hero).toMatch(/totalPenalty:\s*score\.totalPenalty \?\? 0/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// #9 / #21 — end-to-end through the REAL pipeline, real model, real penalties
// ───────────────────────────────────────────────────────────────────────────
describe('#21 the penalty layer carries the wind range the model cannot express', () => {
  const { standardizeForMLModel } = require('../dataStandardization');
  const { scoreFromFeatures } = require('../scoringPipeline');
  const KPH_PER_MPH = 1 / 0.621371;

  // Everything held constant except wind. month/hour supplied explicitly so the
  // in-process V2 artifact is the generator (see the out-of-scope note in the
  // report: production does not currently supply `month`).
  const featuresAt = mph => {
    const f = standardizeForMLModel({
      temperature: 22, feelsLike: 22,
      windSpeedKph: mph * KPH_PER_MPH, windDirection: 180,
      humidity: 50, cloudCover: 30, uvIndex: 5, visibility: 10,
      precipMm: 0, precipChancePercent: 0,
      gustSpeedKph: (mph + 5) * KPH_PER_MPH,
      hasWarnings: false, hour: 12, month: 9, latitude: 40, longitude: -100
    }, null, null);
    f.waterTempMeasured = false;
    return f;
  };

  const scoreAt = mph => scoreFromFeatures({
    mlFeatures: featuresAt(mph), marineHour: null, forecast: null,
    loc: { lat: 40, lng: -100 }, localTime: '2026-09-18 12:00', includeWarnings: false
  });

  let calm, fifteen, forty;
  beforeAll(async () => {
    [calm, fifteen, forty] = await Promise.all([scoreAt(5), scoreAt(15), scoreAt(40)]);
  });

  test('the penalty layer DOES separate 15 mph from 40 mph — the whole finding rests on this', () => {
    expect(forty.totalPenalty).toBeGreaterThan(fifteen.totalPenalty);
    // Measured 2026-09-18 with this exact fixture (gust delta held at 5 mph):
    // 15 mph -> WIND_MODERATE 1.0; 40 mph -> WIND_DANGEROUS 2.0.
    expect(fifteen.totalPenalty).toBeGreaterThanOrEqual(1.0);
    expect(forty.totalPenalty).toBeGreaterThanOrEqual(2.0);
  });

  test('that separation reaches the PUBLISHED rating, not just the internals', () => {
    expect(forty.rating).toBeLessThan(fifteen.rating);
    expect(fifteen.rating).toBeLessThan(calm.rating);
  });

  test('40 mph publishes the worst verdict the scale has', () => {
    expect(forty.rating).toBeLessThanOrEqual(1.5);
    expect(forty.interpretation).toBe('Hard pass');
  });

  test('a named wind penalty fires and is reported, at both speeds', () => {
    const codes = s => (s.penaltyDetails || []).map(d => d.code);
    expect(codes(fifteen).some(c => /^WIND_/.test(c))).toBe(true);
    expect(codes(forty).some(c => /^WIND_/.test(c))).toBe(true);
    // 40 mph must escalate past whatever 15 mph fired, not merely repeat it.
    const worst = s => Math.max(...(s.penaltyDetails || []).filter(d => /^WIND_/.test(d.code)).map(d => d.amount));
    expect(worst(forty)).toBeGreaterThan(worst(fifteen));
  });

  test('every penalty that moved the score is itemized — the sum reconciles', () => {
    const itemized = (forty.penaltyDetails || []).reduce((a, d) => a + (d.amount || 0), 0);
    expect(itemized).toBeCloseTo(forty.totalPenalty, 6);
    expect(forty.penaltyDetails.length).toBeGreaterThan(0);
  });

  test('the model on its own CANNOT separate 30 from 60 mph — this is why the gate matters', () => {
    // Documents the saturation rather than asserting it is acceptable. If a
    // future model DOES separate them this test should be updated, not deleted.
    const { predictLocal } = require('../localModel');
    const at30 = predictLocal(featuresAt(30)).rating;
    const at60 = predictLocal(featuresAt(60)).rating;
    expect(at60).toBeCloseTo(at30, 6);
  });

  test('the model never gets MORE optimistic as wind rises, even while saturated', () => {
    const { predictLocal } = require('../localModel');
    let prev = Infinity;
    for (const mph of [0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60]) {
      const r = predictLocal(featuresAt(mph)).rating;
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      prev = r;
    }
  });

  test('the saturation is documented where someone would weaken the wind penalties', () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'scoringPipeline.js'), 'utf8');
    expect(src).toMatch(/#21/);
    expect(src).toMatch(/applyEnhancedPenalties/);
    expect(src).toMatch(/1\.8598/);
  });
});
