/**
 * The outcome stream, the shared analytics truth, sharing, and the new fields
 * through the guest and admin doors.
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
    await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...session).send({ limits: null, expiresAt: '2020-01-01T00:00:00Z' });
    await scan(code); await new Promise(r => setTimeout(r, 60));
    const a = await request(app).get(`/kortex/guest/links/${code}/analytics?tz=Asia/Kolkata`).set(...UA).set(...session);
    expect(a.status).toBe(200);
    const an = a.body.analytics;
    expect(an.totals.events).toBe(1); // the fallback visit only
    expect(an.outcomes.undelivered).toBe(1);
    expect(an.outcomes.byOutcome[0].value).toBe('expired');
    expect(an.timeZone).toBe('Asia/Kolkata');
    expect(an.insights.missed.detail.total).toBe(1);
    expect(an.insights.fallbackUsage.detail.fallbacks).toBe(1);
    expect(an.insights.anomalies.detail.items.some(i => i.kind === 'expiredScanned')).toBe(true);
    expect(a.body.window.days).toBe(7);
    const csv = await request(app).get(`/kortex/guest/links/${code}/analytics.csv`).set(...UA).set(...session);
    expect(csv.text.split('\r\n')[0]).toMatch(/,delivered,outcome$/);
    expect(csv.text).toMatch(/,no,expired/);
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

describe('New fields and sharing', () => {
  test('placement, economics and a campaign window round-trip through the guest door and are validated', async () => {
    const created = await createGuest({ placement: ' Table Tent ', economics: { printCost: 40, valuePerVisit: 1.5, currency: 'inr' }, campaignWindow: { startAt: '2026-09-01', endAt: '2026-09-30' } });
    expect(created.status).toBe(201);
    expect(created.body.link.placement).toBe('table tent');
    expect(created.body.link.economics).toEqual({ printCost: 40, valuePerVisit: 1.5, currency: 'INR' });
    expect(created.body.link.campaignWindow.startAt).toMatch(/^2026-09-01/);
    const bad = await createGuest({ economics: { printCost: -5 } });
    expect(bad.status).toBe(400);
    const session = ['X-Kortex-Guest-Session', created.body.session];
    const cleared = await request(app).patch(`/kortex/guest/links/${created.body.link.code}`).set(...UA).set(...session).send({ placement: null, economics: null, campaignWindow: null });
    expect(cleared.body.link.placement).toBeNull();
    expect(cleared.body.link.economics).toBeNull();
    const a = await request(app).get(`/kortex/guest/links/${created.body.link.code}/analytics`).set(...UA).set(...session);
    expect(a.body.analytics.insights.roi.status).toBe('none');
  });

  test('a share token opens a public read-only report; revoking closes it; a client cannot set the token', async () => {
    const created = await createGuest({ shareToken: 'hacked-token-000000' });
    expect(doc(`short_links/${created.body.link.code}`).shareToken).toBeUndefined();
    const code = created.body.link.code; const session = ['X-Kortex-Guest-Session', created.body.session];
    admin._mocks.docData['tenants/' + created.body.workspace.id].plan = 'pro'; gate.resetCache();
    await scan(code, '?s=qr'); await new Promise(r => setTimeout(r, 60));
    const shared = await request(app).post(`/kortex/guest/links/${code}/share`).set(...UA).set(...session).send({});
    expect(shared.status).toBe(200);
    const token = shared.body.shareUrl.split('/r/')[1];
    expect(token.length).toBeGreaterThanOrEqual(20);
    const pub = await request(app).get(`/kortex/shared/${token}`).set(...UA);
    expect(pub.status).toBe(200);
    expect(pub.body.link.code).toBe(code);
    expect(pub.body.analytics.totals.events).toBe(1);
    expect(pub.body.analytics.insights.qrSplit.detail.qr).toBe(1);
    expect(pub.body.analytics.recentScans).toBeUndefined();
    expect(JSON.stringify(pub.body)).not.toMatch(/accessCodeHash|shareToken/);
    const other = await createGuest();
    const denied = await request(app).post(`/kortex/guest/links/${code}/share`).set(...UA).set('X-Kortex-Guest-Session', other.body.session).send({});
    expect(denied.status).toBe(404);
    const revoked = await request(app).delete(`/kortex/guest/links/${code}/share`).set(...UA).set(...session);
    expect(revoked.status).toBe(200);
    expect((await request(app).get(`/kortex/shared/${token}`).set(...UA)).status).toBe(404);
    expect((await request(app).get('/kortex/shared/short').set(...UA)).status).toBe(404);
  });

  test('admins share within their tenant; the sample reports carry insights', async () => {
    admin._mocks.docData['short_links/lkhouse2'] = { code: 'lkhouse2', tenantId: 'kaayko-default', title: 'House', enabled: true, status: 'active', destinations: { web: 'https://kaayko.com/' }, clickCount: 0, utm: {}, createdAt: new Date() };
    const shared = await request(app).post('/kortex/lkhouse2/share').set(...UA).set(...SUPER).send({});
    expect(shared.status).toBe(200);
    expect((await request(app).delete('/kortex/lkhouse2/share').set(...UA).set(...SUPER)).status).toBe(200);
    process.env.KORTEX_SYNC_KEY = 'sync-test-key';
    await request(app).post('/kortex/demo/seed').set(...UA).set('X-Kortex-Sync-Key', 'sync-test-key').send({});
    require('../api/kortex/demoWorkspace').resetSamplesCache();
    const full = await request(app).get('/kortex/guest/demo/samples?full=1').set(...UA);
    expect(full.body.reports.every(r => r.insights && r.insights.qualityScore && r.timeZone === 'Asia/Kolkata')).toBe(true);
    delete process.env.KORTEX_SYNC_KEY;
  }, 60000);
});
