// AUDIT #23 — a cached forecast carries SCORES, so it is only valid for the
// algorithm that produced it.
//
// Found live, not by reading: the 2.6.0 deploy went out correctly and
// kaayko.com went on showing "WATER TEMP 72F" under the heading "MEASURED NOW
// AT THE NEAREST STATION" for a lake with no sensor, because /api/fastForecast
// answered from a 1.3-hour-old cache entry built by 2.5.0. The fix was live and
// invisible for up to CACHE_TTL_HOURS (3.5).

jest.mock('firebase-functions', () => ({ logger: { info: jest.fn(), error: jest.fn() } }));

const mockGet = jest.fn();
const mockSet = jest.fn(async () => ({}));
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({ doc: () => ({ get: mockGet, set: mockSet }) })
  }),
  FieldValue: { serverTimestamp: () => new Date() }
}));

const ForecastCache = require('../../../cache/forecastCache');
const { ALGORITHM_VERSION } = require('../scoringConstants');

const fresh = () => new Date(Date.now() - 10 * 60 * 1000);   // 10 minutes old

function entry(version) {
  return {
    exists: true,
    data: () => ({
      algorithm_version: version,
      cached_at: { toDate: () => fresh() },
      forecast: { forecast: [], metadata: {} }
    })
  };
}

describe('forecast cache is invalidated by algorithm version', () => {
  beforeEach(() => { mockGet.mockReset(); mockSet.mockClear(); });

  test('an entry from the CURRENT algorithm is served', async () => {
    mockGet.mockResolvedValue(entry(ALGORITHM_VERSION));
    const hit = await new ForecastCache().getCachedForecast('custom_x');
    expect(hit).not.toBeNull();
    expect(hit.metadata.cached).toBe(true);
  });

  test('an entry from an OLDER algorithm is a miss, not a hit', async () => {
    mockGet.mockResolvedValue(entry('2.5.0'));
    expect(await new ForecastCache().getCachedForecast('custom_x')).toBeNull();
  });

  test('an entry with NO recorded version is a miss — we cannot tell what made it', async () => {
    mockGet.mockResolvedValue(entry(undefined));
    expect(await new ForecastCache().getCachedForecast('custom_x')).toBeNull();
  });

  test('a still-fresh entry is refused on version alone, before TTL is reached', async () => {
    mockGet.mockResolvedValue(entry('0.0.1'));
    expect(await new ForecastCache().getCachedForecast('custom_x')).toBeNull();
  });

  test('stored entries record the version that produced them', async () => {
    await new ForecastCache().storeForecast('custom_x', { forecast: [], metadata: {} });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ algorithm_version: ALGORITHM_VERSION })
    );
  });
});
