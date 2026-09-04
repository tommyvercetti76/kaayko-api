/**
 * PublicReportDTO contract: an allowlist (recursive forbidden-key check over
 * the whole response), cohort suppression, the no-store / noindex /
 * no-referrer headers, and the dedicated rate-limit bucket.
 */
require('./helpers/mockSetup');
const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');
const safety = require('../api/kortex/destinationSafety');
const gate = require('../api/kortex/tenantGate');
const { buildPublicReport, PUBLIC_REPORT_HEADERS } = require('../api/kortex/publicReport');

const UA = ['User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'];
const LANG = ['Accept-Language', 'en'];
const FORBIDDEN = ['visitorKey', 'ip', 'userAgent', 'rawUserAgent', 'recentScans', 'replay', 'events', 'points', 'referrer', 'redirectedTo', 'economics', 'safetyReasons', 'createdBy', 'tenantId', 'accessCodeHash', 'shareToken', 'secretHash', 'email', 'hour', 'dow', 'ms'];
const REPORT_KEYS = ['link', 'window', 'notEnoughActivity', 'totals', 'qrSplit', 'timeline', 'devices', 'countries', 'campaign', 'findings', 'sharedAtMs', 'expiresAtMs'];
const DAY_MS = 86400000;

/** Every key at every depth of a JSON value. */
function keysDeep(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach(item => keysDeep(item, out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => { out.add(k); keysDeep(v, out); });
  return out;
}
function expectNoForbiddenKeys(body) {
  const keys = keysDeep(body);
  expect(FORBIDDEN.filter(k => keys.has(k))).toEqual([]);
}

const finding = (key, shareClass, extra = {}) => ({ key, version: 2, title: `${key} title`, status: 'info', headline: `${key} headline`, detail: { secretish: 1 }, metrics: { n: 1 }, shareClass, ...extra });

/** An owner analytics response with everything an owner may see, including what the public must not. */
function ownerAnalytics(overrides = {}) {
  return {
    code: 'kx-test',
    totals: { events: 24, observed: 30, useful: 24, delivered: 20, rescued: 4, lost: 6, usefulRate: 0.8, storedClickCount: 24, drift: 0 },
    window: { retentionDays: 7, firstEvent: '2026-09-01T00:00:00.000Z', lastEvent: '2026-09-02T23:00:00.000Z' },
    timeZone: 'Asia/Kolkata',
    unique: { distinctVisitors: 9, coveragePct: 100, coveredEvents: 24, totalEvents: 24 },
    outcomes: { undelivered: 6, classes: { delivered: 20, rescued: 4, lost: 6 }, points: [[1725000000000, 'capped', 'ios', 'IN']] },
    insights: {
      qrSplit: finding('qrSplit', 'public'),
      replay: finding('replay', 'owner_only'),
      geoDrift: finding('geoDrift', 'public'),
      trend: finding('trend', 'owner_only'),
      campaignLift: finding('campaignLift', 'public', { status: 'good', detail: { before: 1.2, during: 3.4, after: 2, lift: 183 } }),
      qualityScore: finding('qualityScore', 'public', { status: 'good' })
    },
    recentScans: [{ at: '2026-09-02T22:00:00.000Z', deviceType: 'mobile', country: 'IN' }],
    points: [[1725000000000, 'ios', 'mobile', 'IN', 'qr', null, 'direct', 'delivered']],
    timeline: [{ date: '2026-09-01', clicks: 10, uniqueVisitors: 4 }, { date: '2026-09-02', clicks: 14, uniqueVisitors: 6 }],
    breakdowns: {
      source: [{ value: 'qr', clicks: 18 }, { value: 'link', clicks: 6 }],
      deviceType: [{ value: 'mobile', clicks: 17 }, { value: 'desktop', clicks: 4 }, { value: 'tablet', clicks: 3 }],
      country: [{ value: 'IN', clicks: 14 }, { value: 'US', clicks: 6 }, { value: null, clicks: 2 }, { value: 'DE', clicks: 2 }],
      referrer: [{ value: 'https://example.com/?q=private', clicks: 1 }],
      hourOfDay: [{ hour: 0, clicks: 1 }]
    },
    ...overrides
  };
}
const ownerLink = {
  code: 'kx-test', title: 'Lobby', shortUrl: 'https://kaayko.com/l/kx-test', tenantId: 'g_abc', createdBy: 'guest',
  economics: { printCost: 40, valuePerVisit: 2, currency: 'USD' }, placement: 'poster', placementLabel: 'Lobby poster',
  destinations: { web: 'https://example.com/?ref=owner' }, share: { publicId: 'pub000000001', expiresAtMs: null, createdAtMs: 1725000000000 }
};
const grant = { publicId: 'pub000000001', linkCode: 'kx-test', tenantId: 'g_abc', createdAtMs: 1725000000000, expiresAtMs: 1727592000000 };
const NOW = 1725300000000;
const build = (overrides, link = ownerLink) => buildPublicReport({ link, analytics: ownerAnalytics(overrides), grant, nowMs: NOW }).report;

describe('PublicReportDTO', () => {
  test('is built from an allowlist: exact top-level shape, and no forbidden key at any depth', () => {
    const body = buildPublicReport({ link: ownerLink, analytics: ownerAnalytics(), grant, nowMs: NOW });
    expect(Object.keys(body)).toEqual(['success', 'report']);
    expect(Object.keys(body.report)).toEqual(REPORT_KEYS);
    expect(Object.keys(body.report.link)).toEqual(['code', 'title', 'shortUrl', 'qrUrl', 'placement']);
    expectNoForbiddenKeys(body);
    expect(JSON.stringify(body)).not.toMatch(/private|owner|secretish|pub000000001/);
  });

  test('carries identity, the window and the token dates; the placement is the owner label when there is one', () => {
    const report = build();
    expect(report.link).toEqual({ code: 'kx-test', title: 'Lobby', shortUrl: 'https://kaayko.com/l/kx-test', qrUrl: 'https://kaayko.com/qr/kx-test.png', placement: 'Lobby poster' });
    expect(report.window).toEqual({ days: 7, timeZone: 'Asia/Kolkata', from: new Date(NOW - 7 * DAY_MS).toISOString(), to: new Date(NOW).toISOString() });
    expect(report.sharedAtMs).toBe(grant.createdAtMs);
    expect(report.expiresAtMs).toBe(grant.expiresAtMs);
    expect(build({}, { ...ownerLink, placement: null, placementLabel: null }).link.placement).toBeNull();
  });

  test('below ten observed scans only identity and the window remain', () => {
    const report = build({ totals: { events: 9, observed: 9, useful: 9, delivered: 9, rescued: 0, lost: 0, usefulRate: 1 } });
    expect(report.notEnoughActivity).toBe(true);
    expect(report.link.code).toBe('kx-test');
    expect(report.window.days).toBe(7);
    for (const key of ['totals', 'qrSplit', 'timeline', 'devices', 'countries', 'campaign']) expect(report[key]).toBeNull();
    expect(report.findings).toEqual([]);
    expect(build({ totals: { events: 0 } }).notEnoughActivity).toBe(true);
  });

  test('totals are the six public counts and nothing else', () => {
    const report = build();
    expect(report.notEnoughActivity).toBe(false);
    expect(report.totals).toEqual({ observed: 30, useful: 24, delivered: 20, rescued: 4, lost: 6, usefulRate: 0.8 });
  });

  test('categories under five merge into other; a breakdown under ten in total is withheld', () => {
    const report = build();
    expect(report.devices).toEqual([{ value: 'mobile', count: 17 }, { value: 'other', count: 7 }]);
    expect(report.countries).toEqual([{ value: 'IN', count: 14 }, { value: 'US', count: 6 }, { value: 'other', count: 4 }]);

    const thin = build({ breakdowns: { source: [], deviceType: [{ value: 'mobile', clicks: 9 }], country: [{ value: 'IN', clicks: 5 }, { value: 'US', clicks: 4 }] } });
    expect(thin.devices).toBeNull();
    expect(thin.countries).toBeNull();

    const withOther = build({ breakdowns: { source: [], deviceType: [{ value: 'mobile', clicks: 10 }, { value: 'other', clicks: 6 }, { value: 'tablet', clicks: 2 }] } });
    expect(withOther.devices).toEqual([{ value: 'mobile', count: 10 }, { value: 'other', count: 8 }]);
    expect(withOther.countries).toBeNull();
    expect(build({ breakdowns: {} }).devices).toBeNull();
  });

  test('the timeline is date-level, the QR split comes from the source breakdown, the campaign only when the lift finding exists', () => {
    const report = build();
    expect(report.timeline).toEqual([{ date: '2026-09-01', useful: 10 }, { date: '2026-09-02', useful: 14 }]);
    expect(report.qrSplit).toEqual({ qr: 18, tap: 6, qrShare: 0.75 });
    expect(report.campaign).toEqual({ during: 3.4, before: 1.2, after: 2 });
    expect(build({ insights: { campaignLift: finding('campaignLift', 'public', { status: 'none', detail: null }) } }).campaign).toBeNull();
    expect(build({ insights: {} }).campaign).toBeNull();
    expect(build({ breakdowns: { source: [] } }).qrSplit).toEqual({ qr: 0, tap: 0, qrShare: 0 });
  });

  test('findings pass only when the key is public-listed and the engine marks them public, with four fields each', () => {
    const report = build();
    expect(report.findings.map(f => f.key)).toEqual(['qrSplit', 'campaignLift', 'qualityScore']);
    report.findings.forEach(f => expect(Object.keys(f)).toEqual(['key', 'title', 'status', 'headline']));
    expect(report.findings[0]).toEqual({ key: 'qrSplit', title: 'qrSplit title', status: 'info', headline: 'qrSplit headline' });
  });

  test('the missed finding is counts only: a real headline naming held or blocked never reaches the share page', () => {
    const { computeInsights } = require('../api/kortex/linkInsights');
    const now = Date.now();
    const lost = (outcome, i) => ({ ms: now - (i + 1) * 60000, outcome, outcomeClass: 'lost', platform: 'ios', country: 'IN', source: 'qr' });
    const undelivered = [lost('held', 0), lost('held', 1), lost('blocked', 2), lost('blocked', 3)];
    const events = Array.from({ length: 10 }, (_, i) => ({
      ms: now - (i + 5) * 60000, outcome: 'delivered', outcomeClass: 'delivered',
      platform: 'ios', country: 'IN', source: 'qr', visitorKey: `v${i}`, referrerHost: null
    }));
    const insights = computeInsights({ link: { code: 'kx-test', status: 'active' }, events, undelivered, windowDays: 30, timeZone: 'UTC' });
    // The owner's own headline names the reasons; that is what must not travel.
    expect(insights.missed.headline).toMatch(/held|blocked/);

    const report = build({ insights, totals: { events: 10, observed: 14, useful: 10, delivered: 10, rescued: 0, lost: 4, usefulRate: 0.714 } });
    const missed = report.findings.find(f => f.key === 'missed');
    expect(missed).toBeDefined();
    expect(missed.headline).toBe('4 of 14 scans in this window reached nothing.');
    expect(JSON.stringify(report.findings)).not.toMatch(/\bheld\b|\bblocked\b|\bpaused\b|workspace_off|churned/);
  });
});

describe('GET /kortex/shared/:token', () => {
  let app, redirectApp;
  beforeAll(() => { app = buildTestApp('/kortex', require('../api/kortex/smartLinks')); redirectApp = buildTestApp('/', require('../api/kortex/deeplinkRoutes')); });
  beforeEach(() => { admin._mocks.resetAll(); safety.resetCaches(); gate.resetCache(); delete process.env.SENDGRID_API_KEY; });

  const rateBuckets = () => Object.keys(admin._mocks.docData).filter(k => k.startsWith('rate_limits/rate_limit_')).map(k => admin._mocks.docData[k].limitType);

  async function sharedGuestLink() {
    const created = await request(app).post('/kortex/guest/links').set(...UA).set('X-Forwarded-For', '203.0.113.10').send({
      destination: 'https://kaayko.com/paddlingout?ref=owner-only', title: 'Poster', placement: 'poster',
      economics: { printCost: 40, valuePerVisit: 2 }, utm: { utm_source: 'poster', utm_medium: 'qr', utm_campaign: 'autumn' }
    });
    expect(created.status).toBe(201);
    const code = created.body.link.code;
    await request(redirectApp).get(`/l/${code}?s=qr`).set(...UA).set(...LANG);
    await request(redirectApp).get(`/l/${code}`).set(...UA).set(...LANG);
    await new Promise(r => setTimeout(r, 60));
    const shared = await request(app).post(`/kortex/guest/links/${code}/share`).set(...UA).set('X-Kortex-Guest-Session', created.body.session).send({});
    expect(shared.status).toBe(200);
    return { code, token: shared.body.shareUrl.split('/kortex/r/')[1] };
  }

  test('answers the DTO only, with no-store, noindex and no-referrer headers, from the sharedReport bucket', async () => {
    const { code, token } = await sharedGuestLink();
    const bucketsBefore = rateBuckets();
    const res = await request(app).get(`/kortex/shared/${token}`).set(...UA).set('X-Forwarded-For', '198.51.100.7');
    expect(res.status).toBe(200);
    for (const [name, value] of Object.entries(PUBLIC_REPORT_HEADERS)) expect(res.headers[name.toLowerCase()]).toBe(value);
    expect(res.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers.pragma).toBe('no-cache');
    expect(Object.keys(res.body.report)).toEqual(REPORT_KEYS);
    expect(res.body.report.link.code).toBe(code);
    expectNoForbiddenKeys(res.body);
    expect(JSON.stringify(res.body)).not.toMatch(/owner-only|autumn|printCost|203\.0\.113/);
    expect(rateBuckets().filter(b => !bucketsBefore.includes(b))).toEqual(['sharedReport']);
  });

  test('a 404 carries the same headers and leaks nothing', async () => {
    const res = await request(app).get(`/kortex/shared/report_${'a'.repeat(12)}.${'b'.repeat(32)}`).set(...UA);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Not found' });
    for (const [name, value] of Object.entries(PUBLIC_REPORT_HEADERS)) expect(res.headers[name.toLowerCase()]).toBe(value);
    expect(rateBuckets()).toEqual(['sharedReport']);
  });
});
