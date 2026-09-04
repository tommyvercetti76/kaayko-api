/**
 * The sample workspace: seeded on the real link service, opened read-only.
 */

require('./helpers/mockSetup');

const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');
const safety = require('../api/kortex/destinationSafety');
const gate = require('../api/kortex/tenantGate');
const demo = require('../api/kortex/demoWorkspace');
const { expireGuestWorkspaces } = require('../api/kortex/guestJobs');

const UA = ['User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'];
const LANG = ['Accept-Language', 'en'];

let app;
let redirectApp;
beforeAll(() => {
  app = buildTestApp('/kortex', require('../api/kortex/smartLinks'));
  redirectApp = buildTestApp('/', require('../api/kortex/deeplinkRoutes'));
});
beforeEach(() => {
  admin._mocks.resetAll();
  safety.resetCaches();
  gate.resetCache();
  process.env.KORTEX_SYNC_KEY = 'sync-test-key';
  admin._mocks.docData['admin_users/super-admin-uid'] = { role: 'super-admin', email: 'super@kaayko.com', tenantId: 'kaayko-default' };
});
afterEach(() => { delete process.env.KORTEX_SYNC_KEY; });

const docs = (prefix) => Object.entries(admin._mocks.docData).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ key: k, ...v }));

describe('Seeding', () => {
  test('the sync key or a super-admin can seed; nobody else', async () => {
    const denied = await request(app).post('/kortex/demo/seed').set(...UA).send({});
    expect(denied.status).toBe(403);
    const wrongKey = await request(app).post('/kortex/demo/seed').set(...UA).set('X-Kortex-Sync-Key', 'nope').send({});
    expect(wrongKey.status).toBe(403);
    const seeded = await request(app).post('/kortex/demo/seed').set(...UA).set('X-Kortex-Sync-Key', 'sync-test-key').send({});
    expect(seeded.status).toBe(200);
    expect(seeded.body.links).toHaveLength(8);
    expect(seeded.body.events).toBeGreaterThan(2000);
    const tenant = admin._mocks.docData['tenants/' + demo.DEMO_TENANT_ID];
    expect(tenant.demo).toBe(true);
    expect(tenant.kind).toBe('guest');
    const links = docs('short_links/');
    expect(links).toHaveLength(8);
    expect(links.every(l => l.tenantId === demo.DEMO_TENANT_ID)).toBe(true);
    expect(links.every(l => /^https:\/\/kaayko\.com\//.test(l.destinations.web))).toBe(true);
    const events = docs('click_events/');
    expect(events.length).toBe(seeded.body.events);
    expect(events.some(e => e.metadata.source === 'qr')).toBe(true);
    expect(events.some(e => e.metadata.scheduleWindow === 'night')).toBe(true);
    // Event record v2: destinations carry no query or fragment, and the record
    // carries only the two metadata keys the shape allows.
    expect(events.every(e => !e.redirectedTo || !/[?#]/.test(e.redirectedTo))).toBe(true);
    expect(events.every(e => Object.keys(e.metadata).sort().join() === 'scheduleWindow,source')).toBe(true);
  }, 60000);

  test('re-seeding replaces the events instead of stacking them', async () => {
    const key = ['X-Kortex-Sync-Key', 'sync-test-key'];
    const first = await request(app).post('/kortex/demo/seed').set(...UA).set(...key).send({});
    const second = await request(app).post('/kortex/demo/seed').set(...UA).set(...key).send({});
    expect(second.status).toBe(200);
    expect(docs('click_events/').length).toBe(second.body.events);
    expect(second.body.links[0].removed).toBe(first.body.links[0].events);
    expect(docs('short_links/')).toHaveLength(8);
  }, 60000);
});

describe('Read-only sessions', () => {
  const key = ['X-Kortex-Sync-Key', 'sync-test-key'];

  test('the demo route issues a read-only session that can read everything and write nothing', async () => {
    await request(app).post('/kortex/demo/seed').set(...UA).set(...key).send({});
    const issued = await request(app).get('/kortex/guest/demo').set(...UA);
    expect(issued.status).toBe(200);
    expect(issued.body.readOnly).toBe(true);
    const session = ['X-Kortex-Guest-Session', issued.body.session];

    const ws = await request(app).get('/kortex/guest/workspace').set(...UA).set(...session);
    expect(ws.status).toBe(200);
    expect(ws.body.readOnly).toBe(true);
    expect(ws.body.workspace.demo).toBe(true);
    expect(ws.body.links).toHaveLength(8);

    const code = ws.body.links[0].code;
    const analytics = await request(app).get(`/kortex/guest/links/${code}/analytics`).set(...UA).set(...session);
    expect(analytics.status).toBe(200);
    expect(analytics.body.analytics.points.length).toBeGreaterThan(50);
    expect(analytics.body.analytics.breakdowns.source.some(r => r.value === 'qr')).toBe(true);
    expect(analytics.body.analytics.unique.distinctVisitors).toBeGreaterThan(10);

    const overview = await request(app).get('/kortex/guest/workspace/analytics').set(...UA).set(...session);
    expect(overview.status).toBe(200);
    expect(overview.body.links).toHaveLength(8);
    expect(overview.body.points.length).toBeGreaterThan(100);

    const csv = await request(app).get(`/kortex/guest/links/${code}/analytics.csv`).set(...UA).set(...session);
    expect(csv.status).toBe(200);

    for (const call of [
      request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...session).send({ title: 'x' }),
      request(app).delete(`/kortex/guest/links/${code}`).set(...UA).set(...session),
      request(app).post('/kortex/guest/rotate').set(...UA).set(...session),
      request(app).post('/kortex/guest/email').set(...UA).set(...session).send({ email: 'a@b.co' })
    ]) {
      const res = await call;
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('READ_ONLY_DEMO');
    }
    expect(admin._mocks.docData[`short_links/${code}`].title).not.toBe('x');
  }, 60000);

  test('creating a link with a demo session opens a fresh workspace instead', async () => {
    await request(app).post('/kortex/demo/seed').set(...UA).set(...key).send({});
    const issued = await request(app).get('/kortex/guest/demo').set(...UA);
    const created = await request(app).post('/kortex/guest/links').set(...UA).set('X-Kortex-Guest-Session', issued.body.session)
      .send({ destination: 'https://kaayko.com/paddlingout', title: 'Mine' });
    expect(created.status).toBe(201);
    expect(created.body.isNewWorkspace).toBe(true);
    expect(created.body.workspace.id).not.toBe(demo.DEMO_TENANT_ID);
    expect(created.body.accessCode).toMatch(/^KX-/);
  }, 60000);

  test('a demo link redirects to its Kaayko product and is never expired by housekeeping', async () => {
    await request(app).post('/kortex/demo/seed').set(...UA).set(...key).send({});
    const res = await request(redirectApp).get('/l/kx-paddle').set(...UA).set(...LANG);
    expect(res.status).toBe(200); // free tier interstitial
    expect(res.text).toMatch(/kaayko\.com\/paddlingout/);
    const result = await expireGuestWorkspaces({ nowMs: Date.now() + 200 * 365 * 86400000 });
    expect(result.expired).toBe(0);
    expect(admin._mocks.docData['tenants/' + demo.DEMO_TENANT_ID].enabled).toBe(true);
  }, 60000);

  test('the footer samples are the lightest, the median and the heaviest link, public and cached', async () => {
    await request(app).post('/kortex/demo/seed').set(...UA).set(...key).send({});
    demo.resetSamplesCache();
    const res = await request(app).get('/kortex/guest/demo/samples').set(...UA);
    expect(res.status).toBe(200);
    expect(res.body.samples.map(s => s.tier)).toEqual(['light', 'medium', 'heavy']);
    const [l, m, h] = res.body.samples;
    expect(l.events).toBeLessThanOrEqual(m.events);
    expect(m.events).toBeLessThanOrEqual(h.events);
    expect(h.timeline).toHaveLength(7);
    expect(h.qrUrl).toMatch(/^https:\/\/kaayko\.com\/qr\/kx-/);
    expect(typeof h.variation).toBe('string');
    expect(res.headers['cache-control']).toMatch(/max-age/);
    const full = await request(app).get('/kortex/guest/demo/samples?full=1').set(...UA);
    expect(full.status).toBe(200);
    expect(full.body.reports).toHaveLength(8);
    expect(full.body.reports.every(r => r.points.length > 0 && r.link && r.link.destinations)).toBe(true);
    expect(full.body.reports.every(r => r.insights.qualityScore && r.timeZone === 'Asia/Kolkata')).toBe(true);
    expect(full.body.reports.find(r => r.code === 'kx-store').link.schedule.windows[0].label).toBe('night');
    expect(full.body.reports.find(r => r.code === 'kx-ambazari').link.limits.maxClicks).toBe(500);
    expect(JSON.stringify(full.body).length).toBeLessThan(400000);
  }, 60000);

  test('without a seeded workspace the demo route says so', async () => {
    const res = await request(app).get('/kortex/guest/demo').set(...UA);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('DEMO_NOT_READY');
  });
});
