/**
 * Recommendation checkpoints through both doors: session and writability on
 * the guest side, tenant scope on the admin side, the stored baseline and the
 * capped history, and junk refused with a 400.
 */
require('./helpers/mockSetup');
const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');
const safety = require('../api/kortex/destinationSafety');
const gate = require('../api/kortex/tenantGate');
const guestAccess = require('../api/kortex/guestAccess');

const UA = ['User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'];
const SUPER = ['Authorization', 'Bearer VALID_SUPER_ADMIN_TOKEN'];
const ADMIN = ['Authorization', 'Bearer VALID_ADMIN_TOKEN'];
const CHECKPOINT_FIELDS = ['type', 'applied', 'dismissed', 'atMs', 'baseline'];
const BASELINE_FIELDS = ['observed', 'useful', 'lost', 'rescued', 'usefulRate', 'windowDays'];

let app;
beforeAll(() => { app = buildTestApp('/kortex', require('../api/kortex/smartLinks')); });
beforeEach(() => {
  admin._mocks.resetAll(); safety.resetCaches(); gate.resetCache(); delete process.env.SENDGRID_API_KEY;
  admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'admin@kaayko.com', tenantId: 'kaayko-default', tenantIds: ['kaayko-default'] };
  admin._mocks.docData['admin_users/super-admin-uid'] = { role: 'super-admin', email: 'super@kaayko.com', tenantId: 'kaayko-default' };
});

const doc = (p) => admin._mocks.docData[p];
const docs = (prefix) => Object.entries(admin._mocks.docData).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
const settle = () => new Promise(r => setTimeout(r, 30));

async function guestLink() {
  const created = await request(app).post('/kortex/guest/links').set(...UA).set('X-Forwarded-For', '203.0.113.10').send({ destination: 'https://kaayko.com/paddlingout', title: 'Poster' });
  expect(created.status).toBe(201);
  return { code: created.body.link.code, session: ['X-Kortex-Guest-Session', created.body.session], tenantId: created.body.workspace.id };
}

/** Recent scans for a link: `useful` delivered plus `lost` capped, all inside every window. */
function seedScans(code, tenantId, { useful = 0, lost = 0 } = {}) {
  const now = Date.now();
  for (let i = 0; i < useful; i++) admin._mocks.docData[`click_events/${code}-u${i}`] = { linkCode: code, tenantId, timestampMs: now - (i + 1) * 60000, delivered: true, outcome: 'delivered', platform: 'ios', deviceInfo: { deviceType: 'mobile' }, geo: { country: 'IN' }, metadata: { source: 'qr' } };
  for (let i = 0; i < lost; i++) admin._mocks.docData[`click_events/${code}-l${i}`] = { linkCode: code, tenantId, timestampMs: now - (i + 1) * 90000, delivered: false, outcome: 'capped', platform: 'ios', deviceInfo: { deviceType: 'mobile' }, geo: { country: 'IN' }, metadata: { source: 'qr' } };
}

function seedAdminLink(code, tenantId) {
  admin._mocks.docData[`short_links/${code}`] = { code, tenantId, title: 'House', enabled: true, status: 'active', destinations: { web: 'https://kaayko.com/' }, clickCount: 0, utm: {}, createdAt: new Date() };
}

const guestPost = (code, session, body) => request(app).post(`/kortex/guest/links/${code}/actions`).set(...UA).set(...session).send(body);
const adminPost = (code, auth, body) => request(app).post(`/kortex/${code}/actions`).set(...UA).set(...auth).send(body);
const APPLIED = { type: 'ADD_FALLBACK', applied: true };
const JUNK = [
  {}, { type: 'HACK_THE_PLANET', applied: true }, { type: 'ADD_FALLBACK' }, { type: 'ADD_FALLBACK', applied: 'yes' },
  { type: 'ADD_FALLBACK', applied: false, dismissed: 'meh' }, { type: 'ADD_FALLBACK', applied: true, dismissed: 'not_relevant' }, 'ADD_FALLBACK', ['ADD_FALLBACK']
];

describe('Checkpoints — guest door', () => {
  test('needs a live, writable session for a link in the same workspace', async () => {
    const { code, session, tenantId } = await guestLink();
    expect((await request(app).post(`/kortex/guest/links/${code}/actions`).set(...UA).send(APPLIED)).status).toBe(401);
    const other = await guestLink();
    expect((await guestPost(code, other.session, APPLIED)).status).toBe(404);
    const readOnly = guestAccess.issueSession({ id: tenantId, guest: doc(`tenants/${tenantId}`).guest }, { readOnly: true });
    const refused = await guestPost(code, ['X-Kortex-Guest-Session', readOnly], APPLIED);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('READ_ONLY_DEMO');
    expect(doc(`short_links/${code}`).checkpoint).toBeUndefined();
    expect((await guestPost(code, session, APPLIED)).status).toBe(200);
  });

  test('records the checkpoint with a baseline from the current window, keeps ten previous ones, and audits', async () => {
    const { code, session, tenantId } = await guestLink();
    seedScans(code, tenantId, { useful: 5, lost: 2 });
    const before = Date.now();
    const res = await guestPost(code, session, APPLIED);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const cp = res.body.checkpoint;
    expect(Object.keys(cp).sort()).toEqual([...CHECKPOINT_FIELDS].sort());
    expect(Object.keys(cp.baseline).sort()).toEqual([...BASELINE_FIELDS].sort());
    expect(cp).toMatchObject({ type: 'ADD_FALLBACK', applied: true, dismissed: null, baseline: { observed: 7, useful: 5, lost: 2, rescued: 0, windowDays: 7 } });
    expect(cp.baseline.usefulRate).toBeCloseTo(5 / 7, 3);
    expect(cp.atMs).toBeGreaterThanOrEqual(before);
    expect(doc(`short_links/${code}`).checkpoint).toEqual(cp);
    expect(doc(`short_links/${code}`).checkpointHistory).toEqual([]);

    const dismissed = await guestPost(code, session, { type: 'RAISE_CAP', applied: false, dismissed: 'remind_later' });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.checkpoint).toMatchObject({ type: 'RAISE_CAP', applied: false, dismissed: 'remind_later' });
    expect(doc(`short_links/${code}`).checkpoint.type).toBe('RAISE_CAP');
    expect(doc(`short_links/${code}`).checkpointHistory).toEqual([cp]);

    for (let i = 0; i < 12; i++) expect((await guestPost(code, session, { type: 'PAUSE_LINK', applied: false, dismissed: 'known_event' })).status).toBe(200);
    const history = doc(`short_links/${code}`).checkpointHistory;
    expect(history).toHaveLength(10);
    expect(history.every(h => h.type === 'PAUSE_LINK')).toBe(true);

    await settle();
    const audits = docs('kortex_audit_logs/').filter(a => a.action === 'link.action' && a.code === code);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]).toMatchObject({ tenantId, extra: { type: 'ADD_FALLBACK', applied: true, dismissed: null }, actor: { type: 'guest' } });
  });

  test('junk is refused with a 400 and nothing is written', async () => {
    const { code, session } = await guestLink();
    for (const body of JUNK) {
      const res = await guestPost(code, session, body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect(doc(`short_links/${code}`).checkpoint).toBeUndefined();
    expect((await guestPost('nope', session, APPLIED)).status).toBe(404);
  });
});

describe('Checkpoints — admin door', () => {
  test('requires an admin, stays inside the caller tenant, and stores the same checkpoint shape', async () => {
    seedAdminLink('lkact01', 'kaayko-default');
    seedAdminLink('lkact02', 'g_someoneelse');
    admin._mocks.docData['tenants/g_someoneelse'] = { kind: 'guest', plan: 'starter', enabled: true };
    seedScans('lkact01', 'kaayko-default', { useful: 8, lost: 2 });
    expect((await request(app).post('/kortex/lkact01/actions').set(...UA).send(APPLIED)).status).toBe(401);

    const denied = await adminPost('lkact02', ADMIN, APPLIED);
    expect(denied.status).toBe(403);
    expect(doc('short_links/lkact02').checkpoint).toBeUndefined();

    const own = await adminPost('lkact01', ADMIN, APPLIED);
    expect(own.status).toBe(200);
    expect(Object.keys(own.body.checkpoint).sort()).toEqual([...CHECKPOINT_FIELDS].sort());
    expect(own.body.checkpoint.baseline).toMatchObject({ observed: 10, useful: 8, lost: 2, rescued: 0, usefulRate: 0.8, windowDays: 30 });
    expect(doc('short_links/lkact01').checkpoint).toEqual(own.body.checkpoint);

    const crossTenant = await adminPost('lkact02', SUPER, { type: 'REQUEST_REVIEW', applied: false, dismissed: 'bad_data' });
    expect(crossTenant.status).toBe(200);
    // No scans yet: the analytics module reports the rate as 0, and the baseline carries it as reported.
    expect(crossTenant.body.checkpoint).toMatchObject({ type: 'REQUEST_REVIEW', applied: false, dismissed: 'bad_data', baseline: { observed: 0, useful: 0, lost: 0, usefulRate: 0, windowDays: 30 } });
    expect(doc('short_links/lkact02').checkpointHistory).toEqual([]);

    await settle();
    const audit = docs('kortex_audit_logs/').find(a => a.action === 'link.action' && a.code === 'lkact01');
    expect(audit).toMatchObject({ tenantId: 'kaayko-default', extra: { type: 'ADD_FALLBACK', applied: true } });
  });

  test('junk, unknown links and malformed codes are refused', async () => {
    seedAdminLink('lkact03', 'kaayko-default');
    for (const body of JUNK) {
      const res = await adminPost('lkact03', SUPER, body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect(doc('short_links/lkact03').checkpoint).toBeUndefined();
    expect((await adminPost('lkmissing9', SUPER, APPLIED)).status).toBe(404);
    expect((await adminPost('a%20b', SUPER, APPLIED)).status).toBe(404);
  });
});
