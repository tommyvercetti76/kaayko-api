/**
 * modelCalibration — LOCATION-LOCAL clock regressions (fixed 2026-09-18)
 *
 * Three bugs, all of the same shape: the calibrator read the SERVER's clock
 * instead of the clock at the water being scored.
 *
 *   (a) `new Date().getMonth()` decided "is it summer?" — so a Tasmanian lake
 *       got a July summer bonus in the middle of its winter, and an Indian lake
 *       got one through the monsoon.
 *   (b) `new Date().getHours()` (UTC on Cloud Functions) was compared against
 *       location-local forecast hour strings — 5.5 h out in IST.
 *   (c) A +0.3 water-temperature bonus was awarded from an ESTIMATED water
 *       temperature the rest of the pipeline had already refused to publish.
 *
 * These tests pin the fixed behaviour AND the stand-down behaviour, because the
 * chosen alternative to a wrong answer here is NO answer, never a default.
 */

const {
  calibrateModelPrediction,
  applySeasonalCalibration,
  analyzeForecastTrends,
  applyLocationCalibration,
  toNorthernEquivalentMonth,
  latitudeZone,
  isSouthwestMonsoon,
  parseForecastHour
} = require('../modelCalibration');

// Mild, unremarkable conditions: nothing here should trip the severe-weather
// suppression, so any change in the result comes from the clock rules.
const MILD = {
  temperature: 20, windSpeed: 8, gustSpeed: 10,
  humidity: 60, cloudCover: 30, uvIndex: 5, visibility: 10,
  precipMm: 0, precipChancePercent: 10
};

// Real water, both hemispheres, chosen so |lat| lands in the 30-60 temperate
// band where the seasonal rules are defined.
const LAKE_TAHOE   = { latitude: 39.10, longitude: -120.03 }; // California, N
const LAKE_WAKATIPU = { latitude: -45.03, longitude: 168.66 }; // New Zealand, S
const FATEH_SAGAR  = { latitude: 24.60, longitude: 73.68 };   // Udaipur, India — ABOVE the Tropic of Cancer
const POWAI_LAKE   = { latitude: 19.13, longitude: 72.91 };   // Mumbai, India — tropical

// ─────────────────────────────────────────────────────────────────────────────
// Helpers under test
// ─────────────────────────────────────────────────────────────────────────────

describe('hemisphere + zone helpers', () => {
  test('toNorthernEquivalentMonth mirrors the southern hemisphere by six months', () => {
    expect(toNorthernEquivalentMonth(1, 45)).toBe(1);    // N stays put
    expect(toNorthernEquivalentMonth(1, -45)).toBe(7);   // S January ≈ N July
    expect(toNorthernEquivalentMonth(7, -45)).toBe(1);   // S July ≈ N January
    expect(toNorthernEquivalentMonth(12, -45)).toBe(6);
    expect(toNorthernEquivalentMonth(6, -45)).toBe(12);
    // Round trip for every month.
    for (let m = 1; m <= 12; m++) {
      expect(toNorthernEquivalentMonth(toNorthernEquivalentMonth(m, -1), -1)).toBe(m);
    }
  });

  test('latitudeZone splits tropical / temperate / polar at the real lines', () => {
    expect(latitudeZone(0)).toBe('tropical');
    expect(latitudeZone(23.0)).toBe('tropical');
    expect(latitudeZone(-19.13)).toBe('tropical');
    expect(latitudeZone(39.1)).toBe('temperate');
    expect(latitudeZone(-45.03)).toBe('temperate');
    expect(latitudeZone(70)).toBe('polar');
    expect(latitudeZone(undefined)).toBeNull();
    expect(latitudeZone('north')).toBeNull();
  });

  test('isSouthwestMonsoon covers Jun-Sep over the South Asian domain only', () => {
    expect(isSouthwestMonsoon(7, 24.60, 73.68)).toBe(true);   // Udaipur, July
    expect(isSouthwestMonsoon(6, 24.60, 73.68)).toBe(true);
    expect(isSouthwestMonsoon(9, 24.60, 73.68)).toBe(true);
    expect(isSouthwestMonsoon(3, 24.60, 73.68)).toBe(false);  // pre-monsoon
    expect(isSouthwestMonsoon(10, 24.60, 73.68)).toBe(false); // post-monsoon
    expect(isSouthwestMonsoon(7, 39.10, -120.03)).toBe(false); // Tahoe, July
  });

  test('parseForecastHour distinguishes "unparseable" from midnight', () => {
    expect(parseForecastHour('2026-09-18 14:00')).toBe(14);
    expect(parseForecastHour('2026-09-18 00:00')).toBe(0);
    expect(parseForecastHour('2026-09-18T07:30')).toBe(7);
    expect(parseForecastHour('2026-09-18')).toBeNull();
    expect(parseForecastHour(undefined)).toBeNull();
    expect(parseForecastHour(1758203400)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) Season — hemisphere and monsoon
// ─────────────────────────────────────────────────────────────────────────────

describe('applySeasonalCalibration — season comes from the scored hour, not the server', () => {
  test('SOUTHERN HEMISPHERE: January is summer at Lake Wakatipu', () => {
    const adj = applySeasonalCalibration(MILD, LAKE_WAKATIPU, 1);
    expect(adj.adjustment).toBeCloseTo(0.15, 10);
    expect(adj.season).toBe('summer');
    expect(adj.hemisphere).toBe('S');
  });

  test('SOUTHERN HEMISPHERE: July is NOT summer at Lake Wakatipu', () => {
    // This is the bug. On the old code a July UTC month made `isSummer` true
    // everywhere on earth, so a New Zealand lake collected +0.15 in midwinter.
    const adj = applySeasonalCalibration(MILD, LAKE_WAKATIPU, 7);
    expect(adj.adjustment).toBe(0);
  });

  test('the two hemispheres are exact mirrors of each other', () => {
    for (let month = 1; month <= 12; month++) {
      const north = applySeasonalCalibration(MILD, LAKE_TAHOE, month).adjustment;
      const southSixMonthsLater = applySeasonalCalibration(
        MILD, LAKE_WAKATIPU, ((month + 5) % 12) + 1
      ).adjustment;
      expect(southSixMonthsLater).toBeCloseTo(north, 10);
    }
  });

  test('NORTHERN HEMISPHERE still behaves: July summer, January nothing', () => {
    expect(applySeasonalCalibration(MILD, LAKE_TAHOE, 7).adjustment).toBeCloseTo(0.15, 10);
    expect(applySeasonalCalibration(MILD, LAKE_TAHOE, 1).adjustment).toBe(0);
    // Spring/fall band
    expect(applySeasonalCalibration(MILD, LAKE_TAHOE, 10).adjustment).toBeCloseTo(0.2, 10);
  });

  test('INDIAN MONSOON: Udaipur in July gets NO summer bonus', () => {
    // Fateh Sagar sits at 24.6 °N, ABOVE the Tropic of Cancer, so the tropical
    // gate alone does not save it — the monsoon gate has to.
    const adj = applySeasonalCalibration(MILD, FATEH_SAGAR, 7);
    expect(adj.adjustment).toBe(0);
    expect(adj.reason).toMatch(/monsoon/i);
  });

  test('INDIAN MONSOON: the whole Jun-Sep window is stood down', () => {
    [6, 7, 8, 9].forEach(month => {
      expect(applySeasonalCalibration(MILD, FATEH_SAGAR, month).adjustment).toBe(0);
    });
  });

  test('TROPICS: a Mumbai lake gets no mid-latitude season model at all', () => {
    const adj = applySeasonalCalibration(MILD, POWAI_LAKE, 7);
    expect(adj.adjustment).toBe(0);
    expect(adj.reason).toMatch(/tropical/i);
  });

  test('STANDS DOWN rather than guessing when the month is missing', () => {
    const adj = applySeasonalCalibration(MILD, LAKE_TAHOE, null);
    expect(adj.adjustment).toBe(0);
    expect(adj.reason).toMatch(/stood down/i);
  });

  test('STANDS DOWN rather than guessing when latitude is missing', () => {
    // The old code defaulted a missing latitude to 40 — the middle of Kansas.
    const adj = applySeasonalCalibration(MILD, { longitude: -120 }, 7);
    expect(adj.adjustment).toBe(0);
    expect(adj.reason).toMatch(/latitude/i);
  });

  test('STANDS DOWN rather than guessing when air temperature is missing', () => {
    const adj = applySeasonalCalibration({ windSpeed: 5 }, LAKE_TAHOE, 7);
    expect(adj.adjustment).toBe(0);
    expect(adj.reason).toMatch(/temperature/i);
  });

  test('never produces a negative adjustment (these rules only ever added)', () => {
    for (let month = 1; month <= 12; month++) {
      [LAKE_TAHOE, LAKE_WAKATIPU, FATEH_SAGAR, POWAI_LAKE].forEach(loc => {
        expect(applySeasonalCalibration(MILD, loc, month).adjustment).toBeGreaterThanOrEqual(0);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Forecast trend — location-local hour
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeForecastTrends — hours are compared against the LOCAL hour', () => {
  // A full local day. Calm overnight, wind ramping hard through the afternoon.
  const hourly = [];
  for (let h = 0; h < 24; h++) {
    const windKPH = h >= 14 ? 6 + (h - 13) * 6 : 5; // 12, 18, 24, ... from 14:00
    hourly.push({ time: `2026-09-18 ${String(h).padStart(2, '0')}:00`, windKPH, tempC: 20 });
  }
  const forecast = [{ date: '2026-09-18', hourly }];

  test('IST AFTERNOON: 14:00 local sees the wind ramp and marks conditions DOWN', () => {
    // This is the off-by-5.5h bug. With the server at 08:30 UTC the old code
    // read hours 0-5 (calm overnight) and reported stable conditions — or, more
    // often, dropped the term entirely because it sliced before it filtered.
    const adj = analyzeForecastTrends(forecast, MILD, 14);
    expect(adj.adjustment).toBeLessThan(0);
    expect(adj.reason).toMatch(/wind increasing/i);
  });

  test('OVERNIGHT: 00:00 local sees the calm block and does not mark down', () => {
    const adj = analyzeForecastTrends(forecast, MILD, 0);
    expect(adj.adjustment).toBeGreaterThanOrEqual(0);
  });

  test('the answer genuinely depends on the local hour', () => {
    const early = analyzeForecastTrends(forecast, MILD, 2).adjustment;
    const late  = analyzeForecastTrends(forecast, MILD, 15).adjustment;
    expect(early).not.toBe(late);
  });

  test('the window is the SIX HOURS FROM THE SCORED HOUR, not hours 0-5', () => {
    // Regression for the slice-before-filter bug: at 18:00 there are six hours
    // left in the day (18-23) and the term must still be able to fire.
    const adj = analyzeForecastTrends(forecast, MILD, 18);
    expect(adj.reason).not.toMatch(/not enough relevant/i);
  });

  test('STANDS DOWN rather than guessing when the local hour is missing', () => {
    const adj = analyzeForecastTrends(forecast, MILD, null);
    expect(adj.adjustment).toBe(0);
    expect(adj.reason).toMatch(/stood down/i);
  });

  test('no forecast data is reported as such, with no adjustment', () => {
    expect(analyzeForecastTrends(null, MILD, 12).adjustment).toBe(0);
    expect(analyzeForecastTrends([], MILD, 12).adjustment).toBe(0);
  });

  test('accepts the legacy {forecast:{forecastday:[{hour:[]}]}} shape', () => {
    const legacy = { forecast: { forecastday: [{ hour: hourly }] } };
    expect(analyzeForecastTrends(legacy, MILD, 14).adjustment).toBeLessThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) The water-temperature side door is gone
// ─────────────────────────────────────────────────────────────────────────────

describe('calibrateModelPrediction — no estimate-driven water temperature bonus', () => {
  const loc = { ...LAKE_TAHOE, localHour: 13, localMonth: 7 };

  test('a warm summer day produces NO water_temperature adjustment', () => {
    // Old behaviour: summer + airTemp > 15 awarded +0.3 from an air-derived
    // water temperature the pipeline had already refused to publish.
    const result = calibrateModelPrediction(3.0, { ...MILD, temperature: 25 }, null, loc);
    expect(result.adjustments.find(a => a.type === 'water_temperature')).toBeUndefined();
  });

  test('no adjustment of any kind claims an estimated water temperature', () => {
    const result = calibrateModelPrediction(3.0, { ...MILD, temperature: 25 }, null, loc);
    result.adjustments.forEach(a => {
      expect(a.estimatedWaterTemp).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Whole-calibrator behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('calibrateModelPrediction — clock plumbed end to end', () => {
  test('the same conditions score differently in the two hemispheres in July', () => {
    const north = calibrateModelPrediction(3.0, MILD, null, { ...LAKE_TAHOE, localHour: 13, localMonth: 7 });
    const south = calibrateModelPrediction(3.0, MILD, null, { ...LAKE_WAKATIPU, localHour: 13, localMonth: 7 });
    expect(north.calibratedRatingPrecise).toBeGreaterThan(south.calibratedRatingPrecise);
  });

  test('the same southern lake scores higher in its own summer', () => {
    const jan = calibrateModelPrediction(3.0, MILD, null, { ...LAKE_WAKATIPU, localHour: 13, localMonth: 1 });
    const jul = calibrateModelPrediction(3.0, MILD, null, { ...LAKE_WAKATIPU, localHour: 13, localMonth: 7 });
    expect(jan.calibratedRatingPrecise).toBeGreaterThan(jul.calibratedRatingPrecise);
  });

  test('with no clock supplied, every time-dependent rule stands down', () => {
    const withClock = calibrateModelPrediction(3.0, MILD, null, { ...LAKE_TAHOE, localHour: 13, localMonth: 7 });
    const without   = calibrateModelPrediction(3.0, MILD, null, LAKE_TAHOE);
    expect(without.adjustments.some(a => a.type === 'seasonal')).toBe(false);
    expect(without.calibratedRatingPrecise).toBeLessThanOrEqual(withClock.calibratedRatingPrecise);
    expect(without.localClock).toEqual({ localHour: null, localMonth: null });
  });

  test('result still reports the local clock it was allowed to read', () => {
    const result = calibrateModelPrediction(3.0, MILD, null, { ...LAKE_TAHOE, localHour: 6, localMonth: 10 });
    expect(result.localClock).toEqual({ localHour: 6, localMonth: 10 });
  });

  test('output stays in [1,5] and on a 0.5 grid for every month and both hemispheres', () => {
    for (let month = 1; month <= 12; month++) {
      [LAKE_TAHOE, LAKE_WAKATIPU, FATEH_SAGAR, POWAI_LAKE].forEach(base => {
        const r = calibrateModelPrediction(4.8, MILD, null, { ...base, localHour: 12, localMonth: month });
        expect(r.calibratedRating).toBeGreaterThanOrEqual(1.0);
        expect(r.calibratedRating).toBeLessThanOrEqual(5.0);
        expect((r.calibratedRating * 10) % 5).toBe(0);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Location boxes no longer default to the middle of Kansas
// ─────────────────────────────────────────────────────────────────────────────

describe('applyLocationCalibration — no coordinates means no adjustment', () => {
  test('missing coordinates stand the rule down instead of defaulting to (40, -100)', () => {
    const adj = applyLocationCalibration(MILD, {});
    expect(adj.adjustment).toBe(0);
    expect(adj.reason).toMatch(/no coordinates/i);
  });

  test('real coordinates inside a box still fire', () => {
    expect(applyLocationCalibration(MILD, LAKE_TAHOE).adjustment).toBeCloseTo(0.25, 10);
  });
});
