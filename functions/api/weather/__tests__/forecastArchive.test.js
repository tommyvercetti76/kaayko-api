// The forecast archive: the one remediation item where waiting destroys data.
//
// storeForecast() is an unconditional .set() on doc(locationId), so every
// regeneration overwrote the previous forecast. The product has therefore never
// measured its skill at any lead time above zero and cannot do so retroactively
// -- the predictions are gone. Meanwhile hour 71 ships confidence 'measured'
// with the same error bar as hour 0.
//
// These tests pin the properties a later skill analysis depends on.

jest.mock('firebase-functions', () => ({ logger: { info: jest.fn(), error: jest.fn() } }));

const writes = [];
const mockSet = jest.fn(async () => ({}));
const mockBatch = () => ({
  set: jest.fn((ref, data) => writes.push({ ref, data })),
  commit: jest.fn(async () => ({}))
});
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: (name) => ({ doc: (id) => ({ id, name, get: jest.fn(), set: mockSet }) }),
    batch: mockBatch
  }),
  FieldValue: { serverTimestamp: () => 'TS' }
}));

const ForecastCache = require('../../../cache/forecastCache');

// Three days of hours around a fixed issue time.
function payload(issueMs) {
  const mk = (offsetH) => {
    const t = new Date(issueMs + offsetH * 3600000).toISOString().slice(0, 16).replace('T', ' ');
    return {
      time: t, temperature: 20, windSpeed: 10, gustSpeed: 14, humidity: 50,
      cloudCover: 20, uvIndex: 5, visibility: 10, precipMM: 0, chanceOfRain: 0,
      waterTemp: null, waterTempMeasured: false, isDay: 1,
      prediction: { ratingPrecise: 3.4, interpretation: 'Careful',
                    predictionSource: 'local-model', degraded: false,
                    confidence: 'measured' }
    };
  };
  return {
    forecast: [
      { date: '2026-09-19', hourly: { 0: mk(-5), 1: mk(1), 2: mk(6) } },   // one PAST hour
      { date: '2026-09-20', hourly: { 0: mk(30), 1: mk(47) } },
      { date: '2026-09-21', hourly: { 0: mk(71), 1: mk(96) } }            // one BEYOND horizon
    ]
  };
}

describe('forecast archive', () => {
  beforeEach(() => { writes.length = 0; });

  test('archives every forecast hour inside the horizon', async () => {
    const n = await new ForecastCache().archiveForecast('spot_a', payload(Date.now()));
    // 7 hours offered; -5 is in the past and +96 is past the 72 h horizon.
    expect(n).toBe(5);
    expect(writes).toHaveLength(5);
  });

  test('a PAST hour is never archived as if it were a prediction', async () => {
    await new ForecastCache().archiveForecast('spot_a', payload(Date.now()));
    expect(writes.every(w => w.data.lead_hours >= 0)).toBe(true);
  });

  test('hours beyond the 72 h horizon are dropped', async () => {
    await new ForecastCache().archiveForecast('spot_a', payload(Date.now()));
    expect(writes.every(w => w.data.lead_hours <= 72)).toBe(true);
  });

  test('every row carries the lead time — the whole point of the archive', async () => {
    await new ForecastCache().archiveForecast('spot_a', payload(Date.now()));
    for (const w of writes) {
      expect(Number.isFinite(w.data.lead_hours)).toBe(true);
      expect(w.data.issued_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(w.data.valid_local).toBeTruthy();
    }
  });

  test('the INPUTS are archived too, so forecast error can later be separated from model error', async () => {
    await new ForecastCache().archiveForecast('spot_a', payload(Date.now()));
    const i = writes[0].data.inputs;
    for (const k of ['temperature', 'windSpeed', 'gustSpeed', 'precipMM', 'visibility']) {
      expect(i).toHaveProperty(k);
    }
    // Without these the archive can only say THAT we were wrong, never why.
    expect(i.waterTempMeasured).toBe(false);
  });

  test('two issues of the same valid hour are kept separately, not overwritten', async () => {
    // The whole value of the archive is comparing a 71-hour-old prediction of
    // Tuesday 14:00 against a 3-hour-old one. Same valid hour, two issues.
    const t0 = Date.now();
    const c = new ForecastCache();
    await c.archiveForecast('spot_a', payload(t0), t0);
    const first = writes.map(w => w.ref.id);
    writes.length = 0;
    // SAME forecast hours, issued six hours later.
    await c.archiveForecast('spot_a', payload(t0), t0 + 6 * 3600000);
    const second = writes.map(w => w.ref.id);
    // Overlapping ids would mean a later issue destroys an earlier prediction,
    // which is exactly the bug this collection exists to end.
    expect(first.some(id => second.includes(id))).toBe(false);
  });

  test('an empty or malformed payload archives nothing and does not throw', async () => {
    const c = new ForecastCache();
    expect(await c.archiveForecast('spot_a', {})).toBe(0);
    expect(await c.archiveForecast('spot_a', { forecast: [] })).toBe(0);
    expect(await c.archiveForecast('spot_a', { forecast: [{ hourly: {} }] })).toBe(0);
  });

  test('archiving never blocks or breaks the cache write', async () => {
    const c = new ForecastCache();
    c.archiveForecast = jest.fn(async () => { throw new Error('archive down'); });
    await expect(c.storeForecast('spot_a', payload(Date.now()))).resolves.toBe(true);
  });
});
