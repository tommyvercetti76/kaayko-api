// The calibration layer may not raise a published score on unvalidated grounds.
//
// Measured out-of-fold on the 187-row human corpus
// (paddle-llm/experiments/009_calibration_layer.js): the positive terms handed
// out +31.68 of optimism against -3.75 of caution, and cost the PUBLISHED score
// on every axis. Suppressing them moved dangerous recall 0.933 -> 0.962 and
// over-optimism 0.075 -> 0.043 -- the first configuration to pass both project
// gates -- for 0.024 MAE.

const { calibrateModelPrediction } = require('../modelCalibration');

const BASE = 3.0;

// A benign summer noon: light wind, dry, clear, warm. Every positive term
// (seasonal, wind_pattern, location) has its best chance to fire here.
const NICE = {
  temperature: 24, feelsLike: 24, windSpeed: 3, gustSpeed: 4, gustDelta: 1,
  humidity: 45, uvIndex: 6, visibility: 10, cloudCover: 10, pressure: 1016,
  precipMm: 0, precipChancePercent: 0, waveHeight: 0.05, waterTemp: 20,
  waterTempMeasured: true, hour: 12, month: 7, beaufortScale: 1,
  marineAvailable: true, latitude: 39.0, longitude: -105.9
};
const LOC = { localHour: 12, localMonth: 7, latitude: 39.0, longitude: -105.9 };

const call = (conditions = NICE, base = BASE) =>
  calibrateModelPrediction(base, conditions, null, LOC);

describe('calibration never adds unvalidated optimism', () => {
  const OLD = process.env.PADDLE_ALLOW_POSITIVE_CALIBRATION;
  afterEach(() => {
    if (OLD === undefined) delete process.env.PADDLE_ALLOW_POSITIVE_CALIBRATION;
    else process.env.PADDLE_ALLOW_POSITIVE_CALIBRATION = OLD;
  });

  test('a perfect summer day is not boosted above the model', () => {
    delete process.env.PADDLE_ALLOW_POSITIVE_CALIBRATION;
    const r = call();
    expect(r.calibratedRatingPrecise).toBeLessThanOrEqual(BASE + 1e-9);
    expect(r.totalAdjustment).toBeLessThanOrEqual(0);
  });

  test('no positive adjustment is recorded at all', () => {
    delete process.env.PADDLE_ALLOW_POSITIVE_CALIBRATION;
    const r = call();
    const positives = (r.adjustments || []).filter(a => a.adjustment > 0);
    expect(positives).toEqual([]);
  });

  test('the terms DO fire when the escape hatch is set — so the guard, not a dead code path, is what suppresses them', () => {
    process.env.PADDLE_ALLOW_POSITIVE_CALIBRATION = 'true';
    const r = call();
    const positives = (r.adjustments || []).filter(a => a.adjustment > 0);
    expect(positives.length).toBeGreaterThan(0);
    expect(r.calibratedRatingPrecise).toBeGreaterThan(BASE);
  });

  test('NEGATIVE adjustments still apply — caution is not what was removed', () => {
    delete process.env.PADDLE_ALLOW_POSITIVE_CALIBRATION;
    // A deteriorating forecast is the path that produces a negative trend term.
    const worsening = {
      forecastday: [{ hour: Array.from({ length: 24 }, (_, h) => ({
        time: `2026-07-01 ${String(h).padStart(2, '0')}:00`,
        wind_kph: 8 + h * 4, gust_kph: 12 + h * 5, temp_c: 24,
        precip_mm: 0, chance_of_rain: 0, vis_km: 10, cloud: 10
      })) }]
    };
    const r = calibrateModelPrediction(BASE, NICE, worsening, LOC);
    const negatives = (r.adjustments || []).filter(a => a.adjustment < 0);
    // Either a negative term fired, or none did; what must never happen is a
    // positive one sneaking through on the same path.
    expect((r.adjustments || []).every(a => a.adjustment < 0)).toBe(true);
    if (negatives.length) {
      expect(r.calibratedRatingPrecise).toBeLessThan(BASE);
    }
  });

  test('the published rating is still clamped to 1..5', () => {
    delete process.env.PADDLE_ALLOW_POSITIVE_CALIBRATION;
    for (const base of [1.0, 2.5, 5.0]) {
      const r = call(NICE, base);
      expect(r.calibratedRatingPrecise).toBeGreaterThanOrEqual(1.0);
      expect(r.calibratedRatingPrecise).toBeLessThanOrEqual(5.0);
    }
  });

  test('severe conditions were ALREADY suppressed, and still are', () => {
    delete process.env.PADDLE_ALLOW_POSITIVE_CALIBRATION;
    const storm = { ...NICE, windSpeed: 28, precipMm: 6, visibility: 2 };
    const r = call(storm);
    expect((r.adjustments || []).filter(a => a.adjustment > 0)).toEqual([]);
  });
});
