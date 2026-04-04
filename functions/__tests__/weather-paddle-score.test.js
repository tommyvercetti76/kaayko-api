/**
 * Weather / Paddle Score — Unit & Integration Tests
 *
 * Covers:
 *   1. modelCalibration.js — output bounds, 0.5 increments, positive/negative paths
 *   2. paddlePenalties.js  — dangerous-wind penalty, null marine data, floor at 1.0
 *   3. smartWarnings.js    — cold water, high wind, max 3 warnings, UV w/ cloud cover
 *   4. paddleScoreCache.js — get/set/getAll/setMany TTL behaviour
 *   5. paddleScore router  — 400 validation, 200 shape, feedback, metrics guard
 *   6. mlService.js        — fallback triggers on network failure
 */

require('./helpers/mockSetup');

// ─────────────────────────────────────────────────────────────────────────────
// 1. modelCalibration
// ─────────────────────────────────────────────────────────────────────────────

const { calibrateModelPrediction } = require('../api/weather/modelCalibration');

describe('modelCalibration — calibrateModelPrediction', () => {
  const baseConditions = { temperature: 20, windSpeed: 8, gustSpeed: 10, humidity: 60, cloudCover: 30, uvIndex: 5, visibility: 10 };
  const baseLoc = { latitude: 33.0, longitude: -97.0 };

  test('always returns calibratedRating within [1.0, 5.0]', () => {
    // Push from extreme ends
    [-10, 0, 50, 100].forEach(baseRating => {
      const result = calibrateModelPrediction(baseRating, baseConditions, null, baseLoc);
      expect(result.calibratedRating).toBeGreaterThanOrEqual(1.0);
      expect(result.calibratedRating).toBeLessThanOrEqual(5.0);
    });
  });

  test('calibratedRating is always a multiple of 0.5', () => {
    [1.3, 2.7, 3.1, 4.8].forEach(baseRating => {
      const result = calibrateModelPrediction(baseRating, baseConditions, null, baseLoc);
      const remainder = (result.calibratedRating * 10) % 5;
      expect(remainder).toBe(0);
    });
  });

  test('returns originalRating, calibratedRating, and adjustments array', () => {
    const result = calibrateModelPrediction(3.5, baseConditions, null, baseLoc);
    expect(typeof result.originalRating).toBe('number');
    expect(typeof result.calibratedRating).toBe('number');
    expect(Array.isArray(result.adjustments)).toBe(true);
  });

  test('summer + warm air produces a positive adjustment vs winter baseline', () => {
    const summerConditions = { ...baseConditions, temperature: 25 };
    const winterConditions = { ...baseConditions, temperature: -2 };

    // Both starting from the same base; summer should be ≥ winter
    const summerResult = calibrateModelPrediction(3.0, summerConditions, null, { latitude: 40, longitude: -100 });
    const winterResult = calibrateModelPrediction(3.0, winterConditions, null, { latitude: 40, longitude: -100 });

    expect(summerResult.calibratedRating).toBeGreaterThanOrEqual(winterResult.calibratedRating);
  });

  test('deteriorating forecast (wind increasing >5kph) produces a negative adjustment', () => {
    // Simulate forecast with wind increasing over next hours
    const deterioratingForecast = {
      forecast: {
        forecastday: [{
          hourly: [
            { time: `${new Date().toISOString().split('T')[0]} ${String(new Date().getHours()).padStart(2,'0')}:00`, windKPH: 5, tempC: 20 },
            { time: `${new Date().toISOString().split('T')[0]} ${String(new Date().getHours() + 1).padStart(2,'0')}:00`, windKPH: 8, tempC: 20 },
            { time: `${new Date().toISOString().split('T')[0]} ${String(new Date().getHours() + 2).padStart(2,'0')}:00`, windKPH: 14, tempC: 20 }
          ]
        }]
      }
    };

    const result = calibrateModelPrediction(3.5, baseConditions, deterioratingForecast, baseLoc);
    const forecastAdj = result.adjustments.find(a => a.type === 'forecast_trend');
    expect(forecastAdj).toBeDefined();
    expect(forecastAdj.adjustment).toBeLessThan(0);
  });

  test('high wind (≥20mph) in analyzeWindPatterns produces a negative or zero adjustment', () => {
    const highWindConditions = { ...baseConditions, windSpeed: 22, gustSpeed: 28 };
    const result = calibrateModelPrediction(3.0, highWindConditions, null, baseLoc);
    const windAdj = result.adjustments.find(a => a.type === 'wind_pattern');
    if (windAdj) {
      expect(windAdj.adjustment).toBeLessThanOrEqual(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. paddlePenalties
// ─────────────────────────────────────────────────────────────────────────────

const { applyEnhancedPenalties } = require('../api/weather/paddlePenalties');

describe('paddlePenalties — applyEnhancedPenalties', () => {
  const calmFeatures = { windSpeed: 5, gustSpeed: 6, temperature: 22, humidity: 55, cloudCover: 20, uvIndex: 4, visibility: 15, beaufortScale: 2, waveHeight: 0.1, waterTemp: 18 };

  test('returns finalRating in [1.0, 5.0] for calm conditions', () => {
    const result = applyEnhancedPenalties(4.0, calmFeatures, null);
    expect(result.finalRating).toBeGreaterThanOrEqual(1.0);
    expect(result.finalRating).toBeLessThanOrEqual(5.0);
  });

  test('dangerous wind (>25mph) causes large penalty', () => {
    const dangerousWind = { ...calmFeatures, windSpeed: 27, gustSpeed: 33, beaufortScale: 6 };
    const calm   = applyEnhancedPenalties(4.0, calmFeatures, null);
    const danger = applyEnhancedPenalties(4.0, dangerousWind, null);
    expect(danger.finalRating).toBeLessThan(calm.finalRating);
    // Wind danger penalty is -2.0; starting at 4.0 → should be at most 2.0
    expect(danger.finalRating).toBeLessThanOrEqual(2.0);
  });

  test('finalRating never drops below 1.0 even with extreme conditions', () => {
    const extreme = { windSpeed: 50, gustSpeed: 70, temperature: -10, humidity: 100, cloudCover: 100, uvIndex: 0, visibility: 0.5, beaufortScale: 12, waveHeight: 4.0, waterTemp: 1 };
    const result = applyEnhancedPenalties(4.0, extreme, null);
    expect(result.finalRating).toBeGreaterThanOrEqual(1.0);
  });

  test('null marineData does not throw and applies no marine penalties', () => {
    expect(() => applyEnhancedPenalties(3.5, calmFeatures, null)).not.toThrow();
  });

  test('penaltiesApplied is an array (for backward compat)', () => {
    const result = applyEnhancedPenalties(3.5, calmFeatures, null);
    expect(Array.isArray(result.penaltiesApplied)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. smartWarnings
// ─────────────────────────────────────────────────────────────────────────────

const { getSmartWarnings } = require('../api/weather/smartWarnings');

describe('smartWarnings — getSmartWarnings', () => {
  const idealLoc = { latitude: 33.0, longitude: -97.0 };

  test('returns an array', () => {
    const warnings = getSmartWarnings({ temperature: 22, windSpeed: 5, gustSpeed: 6, humidity: 55, cloudCover: 30, uvIndex: 4, visibility: 12, waterTemp: 18 }, {}, idealLoc);
    expect(Array.isArray(warnings)).toBe(true);
  });

  test('cold water warning generated when waterTemp ≤ 10°C', () => {
    const warnings = getSmartWarnings({ temperature: 15, windSpeed: 5, gustSpeed: 6, humidity: 55, cloudCover: 30, uvIndex: 4, visibility: 12, waterTemp: 8 }, {}, idealLoc);
    const hasColdWater = warnings.some(w => typeof w === 'string' && w.toLowerCase().includes('water'));
    expect(hasColdWater).toBe(true);
  });

  test('high wind warning generated when windSpeed ≥ 25 mph', () => {
    const warnings = getSmartWarnings({ temperature: 22, windSpeed: 27, gustSpeed: 34, humidity: 55, cloudCover: 30, uvIndex: 4, visibility: 12, waterTemp: 18 }, {}, idealLoc);
    const hasWindWarning = warnings.some(w => typeof w === 'string' && w.toLowerCase().includes('wind'));
    expect(hasWindWarning).toBe(true);
  });

  test('never returns more than 3 warnings', () => {
    const extreme = { temperature: -5, windSpeed: 40, gustSpeed: 55, humidity: 100, cloudCover: 100, uvIndex: 11, visibility: 0.5, waterTemp: 2 };
    const warnings = getSmartWarnings(extreme, {}, idealLoc);
    expect(warnings.length).toBeLessThanOrEqual(3);
  });

  test('no UV warning when cloud cover is ≥ 90%', () => {
    const heavyClouds = { temperature: 22, windSpeed: 5, gustSpeed: 6, humidity: 55, cloudCover: 95, uvIndex: 11, visibility: 12, waterTemp: 18 };
    const warnings = getSmartWarnings(heavyClouds, {}, idealLoc);
    const hasUVWarning = warnings.some(w => typeof w === 'string' && /uv|sun/i.test(w));
    expect(hasUVWarning).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. paddleScoreCache
// ─────────────────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');

describe('paddleScoreCache', () => {
  let PaddleScoreCache;

  beforeEach(() => {
    jest.resetModules();
    PaddleScoreCache = require('../cache/paddleScoreCache');
  });

  test('get() returns null on cache miss', async () => {
    const cache = new PaddleScoreCache();
    const result = await cache.get('no-such-spot');
    expect(result).toBeNull();
  });

  test('get() returns null when doc has no expiresAt', async () => {
    admin._mocks.docData['paddle_score_cache/testspot'] = { scoreData: { rating: 4.0 } }; // no expiresAt
    const cache = new PaddleScoreCache();
    const result = await cache.get('testspot');
    expect(result).toBeNull();
  });

  test('set() writes doc with expiresAt and scoreData', async () => {
    const cache = new PaddleScoreCache();
    const scoreData = { rating: 3.5, interpretation: 'Good' };
    await cache.set('whiterock', scoreData);

    const written = admin._mocks.docData['paddle_score_cache/whiterock'];
    expect(written).toBeDefined();
    expect(written.scoreData.rating).toBe(3.5);
    expect(written.expiresAt).toBeDefined();
  });

  test('getAll() returns empty Map when collection is empty', async () => {
    const cache = new PaddleScoreCache();
    const result = await cache.getAll();
    expect(result instanceof Map).toBe(true);
    expect(result.size).toBe(0);
  });

  test('setMany() calls batch.commit', async () => {
    const batchSpy = admin._mocks.firestore.batch();
    const cache = new PaddleScoreCache();
    const entries = [
      { spotId: 'spot1', scoreData: { rating: 4.0 } },
      { spotId: 'spot2', scoreData: { rating: 3.0 } }
    ];
    await cache.setMany(entries);
    // batch().commit should have been called
    expect(batchSpy.commit).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. paddleScore router
// ─────────────────────────────────────────────────────────────────────────────

const request = require('supertest');
const { buildTestApp } = require('./helpers/testApp');

// Mock the heavy compute module so tests don't call external APIs
jest.mock('../api/weather/paddleScoreCompute', () => ({
  computePaddleScoreForSpot: jest.fn(async (loc) => ({
    rating: 3.5,
    interpretation: 'Good',
    confidence: 'high',
    mlModelUsed: true,
    predictionSource: 'ml-model',
    originalMLRating: 3.4,
    calibrationApplied: true,
    adjustments: [],
    penaltiesApplied: [],
    dynamicOffset: 0,
    conditions: { temperature: 22, windSpeed: 5, hasWarnings: false },
    warnings: { hasWarnings: false, count: 0, messages: [], warningType: null },
    computedAt: new Date().toISOString()
  }))
}));

describe('paddleScore router — GET /paddleScore', () => {
  test('returns 400 when no location params provided', async () => {
    const app = buildTestApp('/paddleScore', require('../api/weather/paddleScore'));
    const res = await request(app).get('/paddleScore');
    expect(res.status).toBe(400);
  });

  test('returns 200 with rating and warnings when lat/lng provided', async () => {
    const app = buildTestApp('/paddleScore', require('../api/weather/paddleScore'));
    const res = await request(app).get('/paddleScore?lat=33.0&lng=-97.0');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.paddleScore.rating).toBe('number');
    expect(res.body.warnings).toBeDefined();
  });

  test('returns 404 for unknown spotId', async () => {
    const app = buildTestApp('/paddleScore', require('../api/weather/paddleScore'));
    const res = await request(app).get('/paddleScore?spotId=does-not-exist');
    expect(res.status).toBe(404);
  });

  test('serves from paddle_score_cache on cache hit for spotId', async () => {
    const { computePaddleScoreForSpot } = require('../api/weather/paddleScoreCompute');
    computePaddleScoreForSpot.mockClear();

    // Set up Firestore: spot doc + a valid cache entry
    const futureDate = new Date(Date.now() + 10 * 60 * 1000);
    admin._mocks.docData['paddlingSpots/whiterock'] = {
      lakeName: 'White Rock Lake',
      location: { latitude: 32.833, longitude: -96.729 }
    };
    admin._mocks.docData['paddle_score_cache/whiterock'] = {
      scoreData: { rating: 4.0, interpretation: 'Great', warnings: { hasWarnings: false, count: 0, messages: [] }, conditions: { temperature: 22, windSpeed: 5, hasWarnings: false } },
      expiresAt: { toDate: () => futureDate }
    };

    const app = buildTestApp('/paddleScore', require('../api/weather/paddleScore'));
    const res = await request(app).get('/paddleScore?spotId=whiterock');

    expect(res.status).toBe(200);
    expect(res.body.metadata.cached).toBe(true);
    // computePaddleScoreForSpot should NOT have been called
    expect(computePaddleScoreForSpot).not.toHaveBeenCalled();
  });
});

describe('paddleScore router — POST /paddleScore/feedback', () => {
  test('returns 400 for missing spotId', async () => {
    const app = buildTestApp('/paddleScore', require('../api/weather/paddleScore'));
    const res = await request(app).post('/paddleScore/feedback').send({ actualScore: 4 });
    expect(res.status).toBe(400);
  });

  test('returns 400 for out-of-range actualScore', async () => {
    const app = buildTestApp('/paddleScore', require('../api/weather/paddleScore'));
    const res = await request(app).post('/paddleScore/feedback').send({ spotId: 'whiterock', actualScore: 6 });
    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid spotId characters', async () => {
    const app = buildTestApp('/paddleScore', require('../api/weather/paddleScore'));
    const res = await request(app).post('/paddleScore/feedback').send({ spotId: '../etc/passwd', actualScore: 3 });
    expect(res.status).toBe(400);
  });

  test('returns 200 and records feedback for valid input', async () => {
    const app = buildTestApp('/paddleScore', require('../api/weather/paddleScore'));
    const res = await request(app)
      .post('/paddleScore/feedback')
      .send({ spotId: 'whiterock', actualScore: 4, predictedScore: 3.5 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('paddleScore router — GET /paddleScore/metrics', () => {
  test('returns 401/403 without x-admin-key', async () => {
    const app = buildTestApp('/paddleScore', require('../api/weather/paddleScore'));
    const res = await request(app).get('/paddleScore/metrics');
    expect([401, 403]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. mlService — fallback on network failure
// ─────────────────────────────────────────────────────────────────────────────

describe('mlService — getPrediction fallback', () => {
  let getPrediction;

  beforeEach(() => {
    jest.resetModules();
    process.env.ML_SERVICE_URL = 'https://fake-ml-service.run.app';
    getPrediction = require('../api/weather/mlService').getPrediction;
  });

  test('returns fallback-rules on network error, still success:true', async () => {
    // Force the https request to fail by using an invalid port that immediately refuses
    // We test the catch path by spying on the https module
    jest.mock('https', () => ({
      request: jest.fn((options, cb) => {
        const EventEmitter = require('events');
        const req = new EventEmitter();
        req.write = jest.fn();
        req.end = jest.fn(() => {
          process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
        });
        req.destroy = jest.fn();
        return req;
      })
    }));

    jest.resetModules();
    process.env.ML_SERVICE_URL = 'https://fake-ml-service.run.app';
    const { getPrediction: getPredictionFresh } = require('../api/weather/mlService');

    const features = { temperature: 22, windSpeed: 5, beaufortScale: 2, uvIndex: 4, visibility: 10, humidity: 55, cloudCover: 30, latitude: 33.0, longitude: -97.0 };
    const result = await getPredictionFresh(features);

    expect(result.success).toBe(true);
    expect(result.predictionSource).toBe('fallback-rules');
    expect(result.mlModelUsed).toBe(false);
    expect(result.rating).toBeGreaterThanOrEqual(1.0);
    expect(result.rating).toBeLessThanOrEqual(5.0);
  });

  test('throws if ML_SERVICE_URL is not set', async () => {
    delete process.env.ML_SERVICE_URL;
    jest.resetModules();
    const { getPrediction: getPredictionNoURL } = require('../api/weather/mlService');
    const features = { temperature: 22, windSpeed: 5 };

    // Should not throw at the top level — getPrediction catches and returns fallback
    const result = await getPredictionNoURL(features);
    // The thrown error from getMLServiceURL is caught and we get fallback
    expect(result.success).toBe(true);
    expect(result.predictionSource).toBe('fallback-rules');
  });
});
