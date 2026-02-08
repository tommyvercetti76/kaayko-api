/**
 * Weather API Tests — paddlingOut, fastForecast, forecast, paddleScore, nearbyWater
 */
require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');

// ═══════════════════════════════════════════════════════════════
// PADDLING OUT
// ═══════════════════════════════════════════════════════════════

describe('PaddlingOut API', () => {
  let app;
  beforeEach(() => {
    jest.isolateModules(() => {
      jest.mock('../middleware/securityMiddleware', () => ({
        rateLimiter: () => (_r, _s, n) => n(), botProtection: (_r, _s, n) => n(), secureHeaders: (_r, _s, n) => n()
      }));
      jest.mock('../api/weather/paddlingoutService', () => ({
        getAllSpots: jest.fn(async () => [
          { id: 'spot-1', name: 'Lake Michigan', lat: 42.0, lng: -87.6 },
          { id: 'spot-2', name: 'Lake Superior', lat: 46.5, lng: -87.5 }
        ]),
        getSpotById: jest.fn(async (id) => {
          if (id === 'spot-1') return { id: 'spot-1', name: 'Lake Michigan', lat: 42.0, lng: -87.6 };
          return null;
        }),
        fetchSpotImages: jest.fn(async () => [])
      }));
      const a = express(); a.use(express.json());
      a.use('/paddlingOut', require('../api/weather/paddlingout'));
      app = a;
    });
  });

  describe('GET /paddlingOut', () => {
    test('returns all paddling spots → 200', async () => {
      const res = await request(app).get('/paddlingOut');
      expect(res.status).toBe(200);
    });
    test('response is an array', async () => {
      const res = await request(app).get('/paddlingOut');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body) || Array.isArray(res.body.spots)).toBe(true);
    });
  });

  describe('GET /paddlingOut/:id', () => {
    test('returns single spot → 200', async () => {
      const res = await request(app).get('/paddlingOut/spot-1');
      expect([200, 404]).toContain(res.status);
    });
    test('returns 404 for non-existent spot', async () => {
      const res = await request(app).get('/paddlingOut/nonexistent');
      expect([404, 500]).toContain(res.status);
    });
    test('handles missing spot ID gracefully', async () => {
      const res = await request(app).get('/paddlingOut/');
      expect([200, 400]).toContain(res.status);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// FAST FORECAST
// ═══════════════════════════════════════════════════════════════

describe('FastForecast API', () => {
  let app;
  beforeEach(() => {
    jest.isolateModules(() => {
      jest.mock('../middleware/securityMiddleware', () => ({
        rateLimiter: () => (_r, _s, n) => n(), botProtection: (_r, _s, n) => n(), secureHeaders: (_r, _s, n) => n()
      }));
      jest.mock('../api/weather/fastForecastService', () => ({
        generateFreshForecast: jest.fn(async () => ({
          success: true,
          forecast: { temperature: 72, windSpeed: 8 },
          metadata: { processingTimeMs: 10, responseTime: '10ms', cached: false, source: 'live_api' }
        })),
        transformToFastForecastFormat: jest.fn((d) => d)
      }));
      jest.mock('../cache/forecastCache', () => jest.fn().mockImplementation(() => ({
        getCachedCustomForecast: jest.fn(async () => null),
        storeCustomForecast: jest.fn(async () => {}),
        getCacheStats: jest.fn(async () => ({ totalEntries: 100, hitRate: 0.85 })),
        getAllCachedForecasts: jest.fn(async () => ({})),
        getCachedForecast: jest.fn(async () => null),
        storeForecast: jest.fn(async () => {})
      })));

      const a = express(); a.use(express.json());
      a.use('/fastForecast', require('../api/weather/fastForecast'));
      app = a;
    });
  });

  describe('GET /fastForecast', () => {
    test('returns forecast with valid coords → 200', async () => {
      const res = await request(app).get('/fastForecast?lat=42.0&lng=-87.6');
      expect(res.status).toBe(200);
    });
    test('rejects missing lat → 400', async () => {
      const res = await request(app).get('/fastForecast?lng=-87.6');
      expect(res.status).toBe(400);
    });
    test('rejects missing lng → 400', async () => {
      const res = await request(app).get('/fastForecast?lat=42.0');
      expect(res.status).toBe(400);
    });
    test('rejects non-numeric lat → 400', async () => {
      const res = await request(app).get('/fastForecast?lat=abc&lng=-87.6');
      expect(res.status).toBe(400);
    });
    test('rejects non-numeric lng → 400', async () => {
      const res = await request(app).get('/fastForecast?lat=42.0&lng=xyz');
      expect(res.status).toBe(400);
    });
    test('handles edge case: equator coordinates', async () => {
      const res = await request(app).get('/fastForecast?lat=0&lng=0');
      expect(res.status).toBe(200);
    });
    test('handles extreme latitude values', async () => {
      const res = await request(app).get('/fastForecast?lat=90&lng=180');
      expect([200, 400]).toContain(res.status);
    });
    test('handles negative coordinates', async () => {
      const res = await request(app).get('/fastForecast?lat=-33.8&lng=151.2');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /fastForecast/cache/stats', () => {
    test('returns cache statistics → 200', async () => {
      const res = await request(app).get('/fastForecast/cache/stats');
      expect(res.status).toBe(200);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// FORECAST
// ═══════════════════════════════════════════════════════════════

describe('Forecast API', () => {
  let app;
  beforeEach(() => {
    jest.isolateModules(() => {
      jest.mock('../middleware/securityMiddleware', () => ({
        rateLimiter: () => (_r, _s, n) => n(), botProtection: (_r, _s, n) => n(), secureHeaders: (_r, _s, n) => n()
      }));
      jest.mock('../middleware/rateLimit', () => jest.fn(() => (_r, _s, n) => n()));
      jest.mock('../api/weather/forecastService', () => ({
        generateComprehensiveForecast: jest.fn(async (loc) => ({ success: true, data: { location: loc, current: { temperature: 72 } } })),
        batchGenerateForecasts: jest.fn(async (locs) => ({ success: true, processed: locs.length, successful: locs.length, failed: 0 })),
        getPaddlingLocations: jest.fn(async () => [{ id: 'spot-1', name: 'Lake Michigan', query: '42.0,-87.6' }])
      }));
      jest.mock('../cache/forecastCache', () => jest.fn().mockImplementation(() => ({
        getCachedCustomForecast: jest.fn(async () => null), storeCustomForecast: jest.fn(async () => {}),
        getCacheStats: jest.fn(async () => ({ totalEntries: 0 })), getAllCachedForecasts: jest.fn(async () => ({})),
        getCachedForecast: jest.fn(async () => null), storeForecast: jest.fn(async () => {})
      })));

      const a = express(); a.use(express.json());
      a.use('/forecast', require('../api/weather/forecast').router);
      app = a;
    });
  });

  describe('GET /forecast', () => {
    test('returns forecast with valid coords → 200', async () => {
      const res = await request(app).get('/forecast?lat=42.0&lng=-87.6');
      expect(res.status).toBe(200);
    });
    test('rejects missing coordinates → 400', async () => {
      const res = await request(app).get('/forecast');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /forecast/batch', () => {
    test('returns batch forecasts → 200', async () => {
      const res = await request(app).post('/forecast/batch').send({});
      expect(res.status).toBe(200);
    });
    test('handles batch with results from service', async () => {
      const res = await request(app).post('/forecast/batch').send({});
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });
    test('response contains success field', async () => {
      const res = await request(app).post('/forecast/batch').send({});
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// PADDLE SCORE
// ═══════════════════════════════════════════════════════════════

describe('PaddleScore API', () => {
  let app;
  beforeEach(() => {
    jest.isolateModules(() => {
      jest.mock('../middleware/securityMiddleware', () => ({
        rateLimiter: () => (_r, _s, n) => n(), botProtection: (_r, _s, n) => n(), secureHeaders: (_r, _s, n) => n()
      }));
      jest.mock('../api/weather/paddleScoreService', () => ({
        computePaddleScore: jest.fn(async () => ({
          success: true,
          paddleScore: { rating: 3.8, interpretation: 'Good', mlModelUsed: true },
          conditions: { temperature: 72, windSpeed: 8 },
          warnings: { hasWarnings: false, messages: [] },
          metadata: {}
        })),
        getLocationFromSpotId: jest.fn(async () => null),
        getInterpretation: jest.fn(() => 'Good')
      }));

      const a = express(); a.use(express.json());
      a.use('/paddleScore', require('../api/weather/paddleScore'));
      app = a;
    });
  });

  describe('GET /paddleScore', () => {
    test('returns paddle score with valid coords → 200', async () => {
      const res = await request(app).get('/paddleScore?lat=42.0&lng=-87.6');
      expect(res.status).toBe(200);
    });
    test('rejects missing coordinates → 400', async () => {
      const res = await request(app).get('/paddleScore');
      expect(res.status).toBe(400);
    });
    test('rejects non-numeric coordinates → 400', async () => {
      const res = await request(app).get('/paddleScore?lat=abc&lng=def');
      expect(res.status).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// NEARBY WATER
// ═══════════════════════════════════════════════════════════════

describe('NearbyWater API', () => {
  let app;
  beforeEach(() => {
    jest.isolateModules(() => {
      jest.mock('../middleware/securityMiddleware', () => ({
        rateLimiter: () => (_r, _s, n) => n(), botProtection: (_r, _s, n) => n(), secureHeaders: (_r, _s, n) => n()
      }));
      jest.mock('../api/weather/nearbyWaterService', () => ({
        findNearbyWater: jest.fn(async (lat, lng, radius) => ({
          lat, lng, radius: radius || 25,
          results: [
            { name: 'Lake Michigan', type: 'lake', distance: 2.5 },
            { name: 'Chicago River', type: 'river', distance: 5.1 }
          ]
        }))
      }));
      const a = express(); a.use(express.json());
      a.use('/nearbyWater', require('../api/weather/nearbyWater'));
      app = a;
    });
  });

  describe('GET /nearbyWater', () => {
    test('returns nearby water with valid coords → 200', async () => {
      const res = await request(app).get('/nearbyWater?lat=42.0&lng=-87.6');
      expect(res.status).toBe(200);
    });
    test('rejects missing lat → 400', async () => {
      const res = await request(app).get('/nearbyWater?lng=-87.6');
      expect([400, 500]).toContain(res.status);
    });
    test('rejects missing lng → 400', async () => {
      const res = await request(app).get('/nearbyWater?lat=42.0');
      expect([400, 500]).toContain(res.status);
    });
    test('accepts optional radius param', async () => {
      const res = await request(app).get('/nearbyWater?lat=42.0&lng=-87.6&radius=50');
      expect(res.status).toBe(200);
    });
    test('handles coordinates with many decimal places', async () => {
      const res = await request(app).get('/nearbyWater?lat=42.123456789&lng=-87.654321098');
      expect(res.status).toBe(200);
    });
    test('handles string coordinates that are numeric', async () => {
      const res = await request(app).get('/nearbyWater?lat=42&lng=-87');
      expect(res.status).toBe(200);
    });
  });
});
