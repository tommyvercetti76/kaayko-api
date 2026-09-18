// Tests for the river-flow gates in paddlePenalties.js (FLOW_HIGH / FLOW_LOW).
//
// Doctrine under test: a gate may only fire on live, non-stale, banded hydrology.
// Missing data must never manufacture a warning, exactly as it must never
// manufacture a bonus.

const { applyEnhancedPenalties } = require('../paddlePenalties');

// Benign conditions: warm air, light wind, good visibility, no marine data, and
// waterTempMeasured:false so no other gate can fire and muddy the assertions.
const CALM = {
  temperature: 22,
  windSpeed: 3,
  uvIndex: 3,
  visibility: 20,
  humidity: 50,
  cloudCover: 20,
  hasWarnings: false,
  waterTempMeasured: false,
  precipChancePercent: 0,
  precipMm: 0
};

function score(hydrologyContext, features = CALM, rating = 4.5) {
  return applyEnhancedPenalties({ rating }, features, null, hydrologyContext);
}
const codes = (res) => res.penaltyDetails.map((d) => d.code);

const lowCtx = {
  gaugeId: 'USGS-09380000',
  discharge: { cms: 1.2, observedAt: new Date().toISOString() },
  gageHeight: { m: 0.31, observedAt: new Date().toISOString() },
  pctOfNormal: 10,
  pctOfNormalBand: 'low',
  stale: false
};

describe('baseline: no flow gate fires without hydrology', () => {
  test('calm conditions with no hydrology produce no FLOW_* penalty at all', () => {
    const res = score(null);
    expect(codes(res)).not.toContain('FLOW_LOW');
    expect(codes(res)).not.toContain('FLOW_HIGH');
    expect(res.totalPenalty).toBe(0);
    expect(res.rating).toBe(4.5);
  });
});

describe('FLOW_LOW fires on a genuinely low percentile', () => {
  test("band 'low' adds exactly one 0.5 FLOW_LOW penalty", () => {
    const res = score(lowCtx);
    const hits = res.penaltyDetails.filter((d) => d.code === 'FLOW_LOW');
    expect(hits).toHaveLength(1);
    expect(hits[0].amount).toBe(0.5);
    expect(res.totalPenalty).toBe(0.5);
    expect(res.rating).toBe(4.0);
    expect(res.originalRating).toBe(4.5);
  });

  test('the paddler is told WHY, with the percentile and the consequence', () => {
    const msg = score(lowCtx).penaltyDetails.find((d) => d.code === 'FLOW_LOW').message;
    expect(msg).toMatch(/below normal/i);
    expect(msg).toMatch(/10th percentile/);
    expect(msg).toMatch(/shallow|dragging|portag/i);
    // and it reaches the legacy UI string list the same way FLOW_HIGH does
    expect(score(lowCtx).penaltiesApplied.some((s) => /below normal/i.test(s) && /-0\.5$/.test(s))).toBe(true);
  });

  test('analytics context carries the band and percentile, and no gage height', () => {
    const ctx = score(lowCtx).penaltyDetails.find((d) => d.code === 'FLOW_LOW').context;
    expect(ctx).toEqual({ pctOfNormal: 10, band: 'low', gaugeId: 'USGS-09380000' });
    expect(ctx).not.toHaveProperty('gageHeightM');
  });

  test('a missing percentile number still fires the band, with a hedged label', () => {
    const msg = score({ ...lowCtx, pctOfNormal: null }).penaltyDetails
      .find((d) => d.code === 'FLOW_LOW').message;
    expect(msg).toContain('<10th percentile');
  });
});

describe('FLOW_LOW does NOT fire on absent or unusable data', () => {
  test('hydrologyContext null → silent', () => {
    expect(codes(score(null))).not.toContain('FLOW_LOW');
  });

  test('hydrologyContext undefined (argument omitted) → silent', () => {
    const res = applyEnhancedPenalties({ rating: 4.5 }, CALM, null);
    expect(codes(res)).not.toContain('FLOW_LOW');
    expect(res.totalPenalty).toBe(0);
  });

  test('stale context → silent even though the band says low', () => {
    const res = score({ ...lowCtx, stale: true });
    expect(codes(res)).not.toContain('FLOW_LOW');
    expect(res.totalPenalty).toBe(0);
    expect(res.rating).toBe(4.5);
  });

  test('no monthlyNormals → band null → silent, even with a tiny discharge', () => {
    const res = score({ ...lowCtx, pctOfNormal: null, pctOfNormalBand: null, discharge: { cms: 0.01 } });
    expect(codes(res)).not.toContain('FLOW_LOW');
    expect(res.totalPenalty).toBe(0);
  });

  test("band 'below' (p10..p25) is ordinary seasonal variation → silent", () => {
    const res = score({ ...lowCtx, pctOfNormal: 20, pctOfNormalBand: 'below' });
    expect(codes(res)).not.toContain('FLOW_LOW');
    expect(res.totalPenalty).toBe(0);
  });

  test("band 'normal' → silent", () => {
    expect(codes(score({ ...lowCtx, pctOfNormal: 50, pctOfNormalBand: 'normal' }))).not.toContain('FLOW_LOW');
  });

  test('a low gage height alone can never fire it — stage is not a scoring input', () => {
    const res = score({ ...lowCtx, pctOfNormalBand: 'normal', pctOfNormal: 50, gageHeight: { m: 0.01 } });
    expect(codes(res)).not.toContain('FLOW_LOW');
    expect(res.totalPenalty).toBe(0);
  });
});

describe('FLOW_LOW and FLOW_HIGH never double count', () => {
  test("band 'high' fires FLOW_HIGH at 1.0 and never FLOW_LOW", () => {
    const res = score({ ...lowCtx, pctOfNormal: 90, pctOfNormalBand: 'high' });
    expect(codes(res)).toContain('FLOW_HIGH');
    expect(codes(res)).not.toContain('FLOW_LOW');
    expect(res.totalPenalty).toBe(1.0);
    expect(res.rating).toBe(3.5);
  });

  test('at most one FLOW_* penalty exists for any band', () => {
    for (const band of ['low', 'below', 'normal', 'above', 'high', null, undefined, 'garbage']) {
      const res = score({ ...lowCtx, pctOfNormalBand: band });
      const flows = res.penaltyDetails.filter((d) => d.code.startsWith('FLOW_'));
      expect(flows.length).toBeLessThanOrEqual(1);
    }
  });

  test('FLOW_LOW is strictly half of FLOW_HIGH', () => {
    const low = score(lowCtx).penaltyDetails.find((d) => d.code === 'FLOW_LOW').amount;
    const high = score({ ...lowCtx, pctOfNormalBand: 'high' }).penaltyDetails
      .find((d) => d.code === 'FLOW_HIGH').amount;
    expect(low).toBe(high / 2);
  });
});

describe('the total stays sane when FLOW_LOW stacks with other gates', () => {
  test('low water on a cold, windy, low-visibility day still lands in [1, 5] on a .5 step', () => {
    const nasty = {
      ...CALM,
      temperature: -2,      // TEMP_COLD_MAJOR
      windSpeed: 26,        // WIND danger
      visibility: 3,        // VIS_POOR
      hasWarnings: true     // WARNING
    };
    const res = score(lowCtx, nasty, 5.0);
    expect(codes(res)).toContain('FLOW_LOW');
    expect(res.rating).toBeGreaterThanOrEqual(1.0);
    expect(res.rating).toBeLessThanOrEqual(5.0);
    expect(res.rating * 2).toBe(Math.round(res.rating * 2));
    expect(res.totalPenalty).toBeGreaterThan(0.5);
  });

  test('FLOW_LOW contributes exactly 0.5 to the sum, no more', () => {
    const nasty = { ...CALM, windSpeed: 16 };
    const withLow = score(lowCtx, nasty, 5.0).totalPenalty;
    const without = score(null, nasty, 5.0).totalPenalty;
    expect(Number((withLow - without).toFixed(2))).toBe(0.5);
  });

  test('FLOW_LOW alone cannot drive the rating below the floor', () => {
    const res = score(lowCtx, CALM, 1.0);
    expect(res.rating).toBe(1.0);
  });
});
