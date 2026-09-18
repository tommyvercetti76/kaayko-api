// Audit findings #16 and #17 — the river-flow TIP must obey the same evidence
// rules as the river-flow PENALTY, and the percentile normals must be selected
// by the month AT THE SPOT rather than at Greenwich.
//
// Doctrine: a stale gauge reading is not evidence. A band with no observation
// time is not evidence. And a tip that fires where no penalty fires is two
// surfaces telling one paddler two different things about one river.

const { getPreparationTips, isHydrologyStale } = require('../paddleTips');
const { applyEnhancedPenalties } = require('../paddlePenalties');
const { resolveNormalsMonth } = require('../hydrologyService');

const HOUR = 3600000;

// Mild conditions: nothing else can push a FLOW_* tip off the 4-tip list.
const MILD = { temperature: 14, humidity: 50, windSpeed: 5, uvIndex: 2, cloudCover: 60, isDay: true, waterTempMeasured: false };

function ctx(band, ageHours, extra = {}) {
  const observedAt = new Date(Date.now() - ageHours * HOUR).toISOString();
  return {
    gaugeId: 'USGS-09380000',
    discharge: { cms: 12.3, observedAt },
    pctOfNormal: band === 'low' ? 8 : 95,
    pctOfNormalBand: band,
    stale: ageHours > 24,
    ...extra
  };
}

const tipCodes = h => getPreparationTips({ conditions: MILD, hydrology: h }).map(t => t.code);
const penaltyCodes = h => applyEnhancedPenalties({ rating: 4.5 }, { ...MILD, visibility: 20, hasWarnings: false, precipChancePercent: 0, precipMm: 0 }, null, h)
  .penaltyDetails.map(d => d.code);

describe('#16 staleness — a three-day-old gauge reading tells the paddler nothing', () => {
  test('a 72-hour-old HIGH reading produces no FLOW_HIGH tip', () => {
    expect(tipCodes(ctx('high', 72))).not.toContain('FLOW_HIGH');
  });

  test('a 72-hour-old LOW reading produces no FLOW_LOW tip', () => {
    expect(tipCodes(ctx('low', 72))).not.toContain('FLOW_LOW');
  });

  test('a one-hour-old reading of the same river DOES produce the tip', () => {
    expect(tipCodes(ctx('high', 1))).toContain('FLOW_HIGH');
    expect(tipCodes(ctx('low', 1))).toContain('FLOW_LOW');
  });

  test('the 24-hour threshold is the boundary, not a suggestion', () => {
    expect(tipCodes(ctx('high', 23.5))).toContain('FLOW_HIGH');
    expect(tipCodes(ctx('high', 24.5))).not.toContain('FLOW_HIGH');
  });

  test('stale:true overrides a fresh-looking timestamp', () => {
    expect(tipCodes(ctx('high', 1, { stale: true }))).not.toContain('FLOW_HIGH');
  });

  test('an undated band is not evidence — no timestamp, no flag, no tip', () => {
    expect(getPreparationTips({ conditions: MILD, hydrology: { pctOfNormalBand: 'high' } }).map(t => t.code)).not.toContain('FLOW_HIGH');
    expect(isHydrologyStale({ pctOfNormalBand: 'high' })).toBe(true);
    expect(isHydrologyStale(null)).toBe(true);
  });
});

describe('#16 boundary — the tip and the penalty agree on every band', () => {
  const bands = ['high', 'above', 'normal', 'below', 'low', null];

  test.each(bands)("band '%s': FLOW_HIGH tip fires iff the FLOW_HIGH penalty fires", (band) => {
    const h = ctx(band, 1);
    expect(tipCodes(h).includes('FLOW_HIGH')).toBe(penaltyCodes(h).includes('FLOW_HIGH'));
  });

  test.each(bands)("band '%s': FLOW_LOW tip fires iff the FLOW_LOW penalty fires", (band) => {
    const h = ctx(band, 1);
    expect(tipCodes(h).includes('FLOW_LOW')).toBe(penaltyCodes(h).includes('FLOW_LOW'));
  });

  test("'above' specifically fires neither — it used to fire the tip alone", () => {
    const h = ctx('above', 1);
    expect(tipCodes(h)).not.toContain('FLOW_HIGH');
    expect(penaltyCodes(h)).not.toContain('FLOW_HIGH');
  });

  test('stale readings fire neither tip nor penalty', () => {
    const h = ctx('high', 72);
    expect(tipCodes(h)).not.toContain('FLOW_HIGH');
    expect(penaltyCodes(h)).not.toContain('FLOW_HIGH');
  });
});

describe('#17 normals month is the month AT THE SPOT', () => {
  // 1 Feb 2026 00:30 UTC. In Hawaii (UTC-10) it is still 31 January; in
  // New Zealand (UTC+13) on 31 Jan 2026 23:30 UTC it is already 1 February.
  const febUtc = Date.parse('2026-02-01T00:30:00Z');
  const janUtcLate = Date.parse('2026-01-31T23:30:00Z');

  test('UTC alone gets Hawaii wrong — this is the bug being fixed', () => {
    expect(resolveNormalsMonth({ now: febUtc })).toEqual({ month: 2, source: 'utc' });
  });

  test('Hawaii (lon -157.8) is still in January at 00:30 UTC on 1 Feb', () => {
    expect(resolveNormalsMonth({ now: febUtc, longitude: -157.8 })).toEqual({ month: 1, source: 'solar-longitude' });
  });

  test('New Zealand (lon 174.8) is already in February at 23:30 UTC on 31 Jan', () => {
    expect(resolveNormalsMonth({ now: janUtcLate, longitude: 174.8 })).toEqual({ month: 2, source: 'solar-longitude' });
  });

  test('an explicit spot-local clock beats longitude and UTC both', () => {
    expect(resolveNormalsMonth({ now: febUtc, longitude: 174.8, localTime: '2026-01-31 14:30' }))
      .toEqual({ month: 1, source: 'local-time' });
  });

  test('a nonsense longitude falls back to UTC rather than inventing a month', () => {
    expect(resolveNormalsMonth({ now: febUtc, longitude: 900 }).source).toBe('utc');
    expect(resolveNormalsMonth({ now: febUtc, longitude: null }).source).toBe('utc');
  });

  test('a malformed localTime is ignored, not parsed into a wrong month', () => {
    expect(resolveNormalsMonth({ now: febUtc, localTime: 'yesterday afternoon' }).source).toBe('utc');
    expect(resolveNormalsMonth({ now: febUtc, localTime: '2026-13-01 10:00' }).source).toBe('utc');
  });

  test('every month of a full year round-trips through the longitude path', () => {
    for (let m = 1; m <= 12; m++) {
      const mid = Date.parse(`2026-${String(m).padStart(2, '0')}-15T12:00:00Z`);
      expect(resolveNormalsMonth({ now: mid, longitude: 174.8 }).month).toBe(m);
      expect(resolveNormalsMonth({ now: mid, longitude: -157.8 }).month).toBe(m);
    }
  });
});

describe('#17 the resolved month actually selects the normals band', () => {
  // A southern-hemisphere river: February is high-summer low flow, January's
  // record is wetter. The SAME discharge bands differently in the two months,
  // so picking the wrong month publishes the wrong band — and the band is what
  // the penalty and the tip both key off.
  const monthlyNormals = {
    '1': { p10: 20, p25: 30, p50: 40, p75: 55, p90: 70 },
    '2': { p10: 2,  p25: 3,  p50: 4,  p75: 6,  p90: 8 }
  };

  test('same flow, different month, different band', () => {
    const janMonth = resolveNormalsMonth({ now: Date.parse('2026-01-31T23:30:00Z'), longitude: 174.8 }); // → Feb local
    expect(janMonth.month).toBe(2);
    const utcMonth = resolveNormalsMonth({ now: Date.parse('2026-01-31T23:30:00Z') });
    expect(utcMonth.month).toBe(1);
    // 12 m³/s: above p90 in February (8), below p10 in January (20).
    const feb = monthlyNormals[String(janMonth.month)];
    const jan = monthlyNormals[String(utcMonth.month)];
    expect(12 > feb.p90).toBe(true);
    expect(12 < jan.p10).toBe(true);
  });
});
