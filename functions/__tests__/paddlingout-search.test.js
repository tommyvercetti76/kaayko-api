require('./helpers/mockSetup');
const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');

// The live lookup fans out to USGS; stub the index so tests never touch the network.
jest.mock('../data/lakeIndex', () => ({
  findNearby: jest.fn(async (lat, lng) => ([
    { name: 'Near Lake', type: 'Lake', lat: lat + 0.05, lng: lng, source: 'hydrolakes', areaKm2: 4 },
    { name: 'Far Lake', type: 'Lake', lat: lat + 2.5, lng: lng, source: 'hydrolakes', areaKm2: 9 }
  ])),
  distMiles: (a, b, c, d) => {
    const R = 3958.8, toRad = x => x * Math.PI / 180;
    const dLat = toRad(c - a), dLng = toRad(d - b);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
}));

function nearby() { return buildTestApp('/nearbyWater', require('../api/weather/nearbyWater')); }
function paddling() { return buildTestApp('/paddlingOut', require('../api/weather/paddlingout')); }

describe('GET /nearbyWater', () => {
  test('rejects bad coordinates with status:error', async () => {
    const res = await request(nearby()).get('/nearbyWater?lat=abc&lng=1');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, status: 'error' });
  });

  test('clamps radius to 1–60 km and filters by distance', async () => {
    const res = await request(nearby()).get('/nearbyWater?lat=33.1&lng=-96.9&radius=500');
    expect(res.status).toBe(200);
    expect(res.body.location.radiusKm).toBe(60);
    const names = res.body.waterBodies.map(b => b.name);
    expect(names).toContain('Near Lake');
    expect(names).not.toContain('Far Lake');          // ~170 mi away
    expect(res.body.status).toBe('found');
    expect(res.body.cached).toBe(false);
  });

  test('serves the geo-grid cache when fresh, refresh=1 bypasses it', async () => {
    admin._mocks.docData['water_body_index/33.25_N97'] = {
      waterBodies: [{ name: 'Cached Lake', type: 'Lake', lat: 33.26, lng: -96.99, source: 'usgs' }],
      expiresAt: { toDate: () => new Date(Date.now() + 60000) }
    };
    let res = await request(nearby()).get('/nearbyWater?lat=33.2&lng=-97.0&radius=30');
    expect(res.body.cached).toBe(true);
    expect(res.body.waterBodies[0].name).toBe('Cached Lake');
    res = await request(nearby()).get('/nearbyWater?lat=33.2&lng=-97.0&radius=30&refresh=1');
    expect(res.body.cached).toBe(false);
    expect(res.body.waterBodies[0].name).toBe('Near Lake');
  });

  test('no water → no_results, still success', async () => {
    const { findNearby } = require('../data/lakeIndex');
    findNearby.mockResolvedValueOnce([]);
    const res = await request(nearby()).get('/nearbyWater?lat=0.5&lng=0.5');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 'no_results', waterBodies: [] });
  });
});

describe('geocode proxies', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  test('forward: short query answers [] without calling Nominatim', async () => {
    global.fetch = jest.fn();
    const res = await request(paddling()).get('/paddlingOut/geocode?q=a');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('reverse: validates lat/lng before any upstream call', async () => {
    global.fetch = jest.fn();
    const res = await request(paddling()).get('/paddlingOut/reverse-geocode?lat=95&lng=10');
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('reverse: normalises the address and never leaks raw.name as water', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ name: 'Rawlins', display_name: 'Rawlins, Dallas, Texas, United States',
        address: { suburb: 'Rawlins', city: 'Dallas', state: 'Texas', country: 'United States', country_code: 'us' } })
    }));
    const res = await request(paddling()).get('/paddlingOut/reverse-geocode?lat=32.83&lng=-96.72');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, city: 'Dallas', region: 'Texas', country: 'United States', countryCode: 'US', water: '' });
    // second call for the same 100 m cell is served from cache
    await request(paddling()).get('/paddlingOut/reverse-geocode?lat=32.8301&lng=-96.7201');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
