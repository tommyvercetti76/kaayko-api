/**
 * The outcome stream and the shared analytics truth through the guest and admin doors.
 */
require('./helpers/mockSetup');
const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');
const safety = require('../api/kortex/destinationSafety');
const gate = require('../api/kortex/tenantGate');
const LinkService = require('../api/kortex/smartLinkService');

const UA = ['User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'];
const LANG = ['Accept-Language', 'en'];
const SUPER = ['Authorization', 'Bearer VALID_SUPER_ADMIN_TOKEN'];
let app, redirectApp;
beforeAll(() => { app = buildTestApp('/kortex', require('../api/kortex/smartLinks')); redirectApp = buildTestApp('/', require('../api/kortex/deeplinkRoutes')); });
beforeEach(() => {
  admin._mocks.resetAll(); safety.resetCaches(); gate.resetCache(); delete process.env.SENDGRID_API_KEY;
  admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'admin@kaayko.com', tenantId: 'kaayko-default', tenantIds: ['kaayko-default'] };
  admin._mocks.docData['admin_users/super-admin-uid'] = { role: 'super-admin', email: 'super@kaayko.com', tenantId: 'kaayko-default' };
});
const docs = (prefix) => Object.entries(admin._mocks.docData).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ key: k, ...v }));
const doc = (p) => admin._mocks.docData[p];
async function createGuest(extra = {}) { return request(app).post('/kortex/guest/links').set(...UA).set('X-Forwarded-For', '203.0.113.10').send({ destination: 'https://kaayko.com/paddlingout', title: 'Poster', ...extra }); }
const scan = (code, q = '') => request(redirectApp).get(`/l/${code}${q}`).set(...UA).set(...LANG);

describe('Outcomes are recorded, never counted', () => {
  test('capped without a fallback, expired, paused and held scans become undelivered outcomes', async () => {
    const created = await createGuest({ limits: { maxClicks: 1 } });
    const code = created.body.link.code; const session = ['X-Kortex-Guest-Session', created.body.session];
    admin._mocks.docData[`short_links/${code}`].clickCount = 1;
    expect((await scan(code, '?s=qr')).status).toBe(410);
    await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...session).send({ limits: null, expiresAt: '2020-01-01T00:00:00Z' });
    expect((await scan(code)).status).toBe(410);
    await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...session).send({ expiresAt: null, enabled: false });
    expect((await scan(code)).status).toBe(410);
    await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...session).send({ enabled: true });
    await LinkService.setLinkStatus(code, 'held', { actor: 'reviewer' });
    expect((await scan(code)).status).toBe(200);
    await new Promise(r => setTimeout(r, 60));
    const outs = docs('click_events/').filter(e => e.delivered === false).map(e => e.outcome).sort();
    expect(outs).toEqual(['capped', 'expired', 'held', 'paused']);
    expect(doc(`short_links/${code}`).clickCount).toBe(1); // never incremented by a miss
    expect(docs('click_events/').find(e => e.outcome === 'capped').metadata.source).toBe('qr');
  });

  test('a fallback is a delivered visit with its reason; analytics keep misses apart and explain them', async () => {
    const created = await createGuest({ limits: { maxClicks: 1, fallbackUrl: 'https://kaayko.com/store' } });
    const code = created.body.link.code; const session = ['X-Kortex-Guest-Session', created.body.session];
    admin._mocks.docData[`short_links/${code}`].clickCount = 1;
    const res = await scan(code);
    expect(res.status).toBe(302);
    await new Promise(r => setTimeout(r, 60));
    const fb = docs('click_events/').find(e => e.outcome === 'fallback');
    expect(fb.delivered).toBe(true); expect(fb.fallbackReason).toBe('clicks'); expect(fb.redirectedTo).toBe('https://kaayko.com/store');
    expect(fb).toMatchObject({ schemaVersion: 2, destinationKey: 'fallback', referrerHost: 'direct', visitorKeyVersion: 1, metadata: { source: 'link', scheduleWindow: null } });
    expect(fb).toHaveProperty('visitorKey');
    expect(fb.ip).toBeUndefined(); expect(fb.userAgent).toBeUndefined(); expect(fb.deviceInfo.rawUserAgent).toBeUndefined();
    await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...session).send({ limits: null, expiresAt: '2020-01-01T00:00:00Z' });
    await scan(code); await new Promise(r => setTimeout(r, 60));
    const a = await request(app).get(`/kortex/guest/links/${code}/analytics?tz=Asia/Kolkata`).set(...UA).set(...session);
    expect(a.status).toBe(200);
    const an = a.body.analytics;
    expect(an.totals.events).toBe(1); // the fallback visit only
    expect(an.totals).toMatchObject({ observed: 2, delivered: 0, rescued: 1, lost: 1, useful: 1, usefulRate: 0.5, lostRate: 0.5 });
    expect(an.outcomes.classes).toEqual({ delivered: 0, rescued: 1, lost: 1 });
    expect(an.outcomes.undelivered).toBe(1);
    expect(an.outcomes.byOutcome[0].value).toBe('expired');
    expect(an.unique.totalEvents).toBe(1);
    expect(an.truncated).toBe(false);
    expect(an.checkpoint).toBeNull();
    expect(an.points[0]).toHaveLength(8); expect(an.points[0][7]).toBe('fallback');
    expect(an.outcomes.points[0]).toHaveLength(4);
    expect(an.timeZone).toBe('Asia/Kolkata');
    expect(an.insights.missed.detail.total).toBe(1);
    expect(an.insights.fallbackUsage.detail.fallbacks).toBe(1);
    expect(an.insights.anomalies.detail.items.some(i => i.kind === 'expiredScanned')).toBe(true);
    expect(a.body.window.days).toBe(7);
    const csv = await request(app).get(`/kortex/guest/links/${code}/analytics.csv`).set(...UA).set(...session);
    expect(csv.text.split('\r\n')[0]).toMatch(/,delivered,outcome,outcome_class$/);
    expect(csv.text).toMatch(/,no,expired,lost/);
    expect(csv.text).toMatch(/,https:\/\/kaayko\.com\/store,yes,fallback,rescued/);
  });

  test('the API resolver records the same outcomes', async () => {
    const created = await createGuest({ limits: { maxClicks: 1 } });
    const code = created.body.link.code;
    admin._mocks.docData[`short_links/${code}`].clickCount = 1;
    expect((await request(app).get(`/kortex/links/${code}/resolve`).set(...UA)).status).toBe(410);
    await new Promise(r => setTimeout(r, 60));
    expect(docs('click_events/').some(e => e.outcome === 'capped' && e.delivered === false)).toBe(true);
  });
});

describe('One truth for both doors', () => {
  test('the admin analytics route clamps to the tenant plan and takes a zone; super-admins see 30 days', async () => {
    const created = await createGuest();
    const code = created.body.link.code;
    const res = await request(app).get(`/kortex/links/${code}/analytics?tz=Europe/London`).set(...UA).set(...SUPER);
    expect(res.status).toBe(200);
    expect(res.body.analytics.window.retentionDays).toBe(30);
    expect(res.body.analytics.timeZone).toBe('Europe/London');
    expect(res.body.analytics.insights).toBeDefined();
    expect(res.body.analytics).toHaveProperty('actionCenter');
    expect(res.body.analytics.totals).toMatchObject({ events: 0, observed: 0, useful: 0, lost: 0 });
    expect(res.body.analytics.truncated).toBe(false);
  });

  test('the admin workspace analytics uses the same module as the free dashboard', async () => {
    admin._mocks.docData['short_links/lkhouse1'] = { code: 'lkhouse1', tenantId: 'kaayko-default', title: 'House', enabled: true, status: 'active', destinations: { web: 'https://kaayko.com/' }, clickCount: 3, placement: 'poster', utm: {}, createdAt: new Date() };
    const res = await request(app).get('/kortex/workspace/analytics?tz=Asia/Kolkata').set(...UA).set(...SUPER);
    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe('kaayko-default');
    expect(res.body.links.some(l => l.code === 'lkhouse1')).toBe(true);
    expect(res.body.insights.placementPerformance).toBeDefined();
    expect(res.body.insights.safetyImpact).toBeDefined();
    expect(res.body.window.timeZone).toBe('Asia/Kolkata');
  });
});

