// The in-process model must actually be REACHABLE from the production paths.
//
// Found live on 2026-09-19 in the warmer's logs:
//   "Local model prediction failed, falling back to remote:
//    localModel: missing/non-finite features: month"
//
// `month` is one of the artifact's 19 features and NEITHER scoring path ever
// supplied it, so buildFeatureVector rejected every vector and every spot-hour
// silently went back over the network to Cloud Run -- which is the exact cold-
// start timeout the in-process model was built to remove. The artifact had
// never once been evaluated in production. The "18/18 ml-model" seen after
// v2.6.0 was the remote service answering, not the artifact.
//
// These tests assert the CONTRACT rather than any one bug: every feature the
// loaded artifact declares must be readable from the standardized feature
// object the pipeline builds.

const { standardizeForMLModel } = require('../dataStandardization');
const {
  getLocalModelInfo, buildFeatureVector, FEATURE_READERS, predictLocal
} = require('../localModel');

// A realistic mid-afternoon summer hour, shaped exactly as
// paddleScoreCompute.js shapes its call.
const RAW = {
  temperature: 24.0, feelsLike: 25.1,
  windSpeed: 7.5, gustSpeed: 11.0, windDirection: 'NNW',
  humidity: 55, cloudCover: 30, uvIndex: 6,
  visibility: 10, hasWarnings: false,
  precipMm: 0, precipChancePercent: 0,
  hour: 14, month: 7,
  latitude: 38.9979, longitude: -105.8865
};

describe('the local model is reachable from the production feature shape', () => {
  test('an artifact is loaded at all (otherwise the rest proves nothing)', () => {
    expect(getLocalModelInfo().available).toBe(true);
  });

  test('every feature the artifact declares has a reader', () => {
    const declared = getLocalModelInfo().features || [];
    const unreadable = declared.filter(f => typeof FEATURE_READERS[f] !== 'function');
    expect(unreadable).toEqual([]);
  });

  test('a standardized production feature object yields a complete vector', () => {
    const f = standardizeForMLModel(RAW, null, null);
    const names = getLocalModelInfo().features;
    // buildFeatureVector(featureNames, mlFeatures) -- two arguments. Calling it
    // with one makes `featureNames.length` undefined, the loop body never runs
    // and it returns an empty array without throwing, so a test written that
    // way passes no matter what is broken. It did, on the first draft of this
    // file, while production was throwing on this very call.
    expect(() => buildFeatureVector(names, f)).not.toThrow();
    expect(buildFeatureVector(names, f)).toHaveLength(names.length);
  });

  test('predictLocal returns a score in range for an ordinary hour', () => {
    const f = standardizeForMLModel(RAW, null, null);
    const out = predictLocal(f);
    expect(out).toBeTruthy();
    expect(out.rating).toBeGreaterThanOrEqual(1);
    expect(out.rating).toBeLessThanOrEqual(5);
  });

  test('month specifically survives standardizeForMLModel — the feature that was dropped', () => {
    const f = standardizeForMLModel(RAW, null, null);
    expect(f.month).toBe(7);
    expect(FEATURE_READERS.month(f)).toBe(7);
  });

  test('a MISSING month is refused loudly, not silently scored', () => {
    // The point of the original bug was that this failure was invisible. It
    // must stay an exception, so the "falling back to remote" log fires.
    const f = standardizeForMLModel({ ...RAW, month: undefined }, null, null);
    expect(() => buildFeatureVector(getLocalModelInfo().features, f)).toThrow(/month/);
  });
});
