// Audit finding #17, end-to-end through getHydrology(): the percentile band a
// river publishes must come from the month AT THE SPOT. Proved against the real
// function with USGS and Firestore stubbed — no network, no emulator.

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({
      doc: () => ({ get: async () => ({ exists: false }), set: async () => {} })
    })
  }),
  FieldValue: { serverTimestamp: () => 'ts' }
}));

const { getHydrology } = require('../hydrologyService');

const CFS_TO_CMS = 0.0283168;

// Southern-hemisphere river: January's record is wet, February's is dry, so one
// unchanged discharge bands 'low' in January and 'high' in February.
const META = {
  gaugeId: 'USGS-TEST-NZ',
  gaugeName: 'Test River at Wellington',
  monthlyNormals: {
    '1': { p10: 20, p25: 30, p50: 40, p75: 55, p90: 70 },
    '2': { p10: 2,  p25: 3,  p50: 4,  p75: 6,  p90: 8 }
  }
};

const CMS = 12;                       // between Jan p10 (20) and Feb p90 (8)
const CFS = CMS / CFS_TO_CMS;

// 31 Jan 2026 23:30 UTC — already 12:30 on 1 February in New Zealand.
const NOW = Date.parse('2026-01-31T23:30:00Z');

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      features: [{ properties: { value: CFS, time: new Date(NOW - 3600000).toISOString() } }]
    })
  }));
});
afterEach(() => { delete global.fetch; });

describe('getHydrology selects normals by the spot-local month', () => {
  test('a New Zealand gauge at 23:30 UTC on 31 Jan uses FEBRUARY normals', async () => {
    const h = await getHydrology(META, { longitude: 174.8, now: NOW });
    expect(h.normalsMonth).toBe(2);
    expect(h.normalsMonthSource).toBe('solar-longitude');
    expect(h.pctOfNormalBand).toBe('high');   // 12 > Feb p90 (8)
    expect(h.stale).toBe(false);
  });

  test('the same gauge read with no position falls back to UTC and bands it LOW — the bug', async () => {
    const h = await getHydrology(META, { now: NOW });
    expect(h.normalsMonth).toBe(1);
    expect(h.normalsMonthSource).toBe('utc');
    expect(h.pctOfNormalBand).toBe('low');    // 12 < Jan p10 (20)
  });

  test('an explicit spot-local clock wins over longitude', async () => {
    const h = await getHydrology(META, { longitude: 174.8, localTime: '2026-01-31 23:30', now: NOW });
    expect(h.normalsMonthSource).toBe('local-time');
    expect(h.normalsMonth).toBe(1);
    expect(h.pctOfNormalBand).toBe('low');
  });

  test('a Hawaii gauge at 00:30 UTC on 1 Feb still uses JANUARY normals', async () => {
    const febUtc = Date.parse('2026-02-01T00:30:00Z');
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ features: [{ properties: { value: CFS, time: new Date(febUtc - 3600000).toISOString() } }] })
    }));
    const h = await getHydrology(META, { longitude: -157.8, now: febUtc });
    expect(h.normalsMonth).toBe(1);
    expect(h.pctOfNormalBand).toBe('low');
  });

  test('a reading older than 24 h comes back flagged stale', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ features: [{ properties: { value: CFS, time: new Date(NOW - 72 * 3600000).toISOString() } }] })
    }));
    const h = await getHydrology(META, { longitude: 174.8, now: NOW });
    expect(h.stale).toBe(true);
  });

  test('no monthly normals for the resolved month → no band invented', async () => {
    const h = await getHydrology({ ...META, monthlyNormals: { '7': META.monthlyNormals['1'] } }, { longitude: 174.8, now: NOW });
    expect(h.pctOfNormalBand).toBeNull();
    expect(h.pctOfNormal).toBeNull();
  });
});
