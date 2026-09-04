/**
 * Sharing v2: report tokens (`report_<publicId>.<secret>` with a hashed
 * verifier), the public report route, revoke / rotate / expiry, and tenant
 * scope on both doors.
 */
require('./helpers/mockSetup');
const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');
const safety = require('../api/kortex/destinationSafety');
const gate = require('../api/kortex/tenantGate');

const UA = ['User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'];
const SUPER = ['Authorization', 'Bearer VALID_SUPER_ADMIN_TOKEN'];
const ADMIN = ['Authorization', 'Bearer VALID_ADMIN_TOKEN'];
const TOKEN_RE = /^report_[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{32}$/;
const NOT_FOUND = { success: false, error: 'Not found' };
const DAY_MS = 86400000;

let app;
beforeAll(() => { app = buildTestApp('/kortex', require('../api/kortex/smartLinks')); });
beforeEach(() => {
  admin._mocks.resetAll(); safety.resetCaches(); gate.resetCache(); delete process.env.SENDGRID_API_KEY;
  admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'admin@kaayko.com', tenantId: 'kaayko-default', tenantIds: ['kaayko-default'] };
  admin._mocks.docData['admin_users/super-admin-uid'] = { role: 'super-admin', email: 'super@kaayko.com', tenantId: 'kaayko-default' };
});

const doc = (p) => admin._mocks.docData[p];
const tokenOf = (shareUrl) => shareUrl.split('https://kaayko.com/kortex/r/')[1];
const publicIdOf = (token) => token.slice('report_'.length).split('.')[0];
const secretOf = (token) => token.split('.')[1];
const readPublic = (token) => request(app).get(`/kortex/shared/${token}`).set(...UA);
const ownerView = (code, session) => request(app).get(`/kortex/guest/links/${code}`).set(...UA).set(...session);
const share = (code, session, body = {}) => request(app).post(`/kortex/guest/links/${code}/share`).set(...UA).set(...session).send(body);
const rotate = (code, session) => request(app).post(`/kortex/guest/links/${code}/share/rotate`).set(...UA).set(...session).send({});
const unshare = (code, session) => request(app).delete(`/kortex/guest/links/${code}/share`).set(...UA).set(...session);

async function guestLink(extra = {}) {
  const created = await request(app).post('/kortex/guest/links').set(...UA).set('X-Forwarded-For', '203.0.113.10').send({ destination: 'https://kaayko.com/paddlingout', title: 'Poster', ...extra });
  expect(created.status).toBe(201);
  return { code: created.body.link.code, session: ['X-Kortex-Guest-Session', created.body.session], tenantId: created.body.workspace.id };
}

function seedAdminLink(code, tenantId) {
  admin._mocks.docData[`short_links/${code}`] = { code, tenantId, title: 'House', enabled: true, status: 'active', destinations: { web: 'https://kaayko.com/' }, clickCount: 0, utm: {}, createdAt: new Date() };
}

describe('Sharing v2 — guest door', () => {
  test('minting returns the URL once; the link keeps a share record, the token store a hash, and neither holds the secret', async () => {
    const { code, session, tenantId } = await guestLink({ shareToken: 'hacked-token-000000', share: { publicId: 'hacked000000' } });
    expect(doc(`short_links/${code}`).shareToken).toBeUndefined();
    expect(doc(`short_links/${code}`).share).toBeUndefined();

    const before = Date.now();
    const shared = await share(code, session);
    expect(shared.status).toBe(200);
    const token = tokenOf(shared.body.shareUrl);
    expect(token).toMatch(TOKEN_RE);
    const expiresAtMs = Date.parse(shared.body.expiresAt);
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(expiresAtMs).toBeLessThan(before + 31 * DAY_MS);

    const link = doc(`short_links/${code}`);
    expect(link.share).toEqual({ publicId: publicIdOf(token), expiresAtMs, createdAtMs: expect.any(Number) });
    expect(link.shareToken).toBeUndefined();
    expect(JSON.stringify(link)).not.toContain(secretOf(token));

    const stored = doc(`kortex_report_tokens/${publicIdOf(token)}`);
    expect(stored).toMatchObject({ publicId: publicIdOf(token), linkCode: code, tenantId, expiresAtMs, revokedAtMs: null, accessCount: 0, lastAccessMs: null });
    expect(stored.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(secretOf(token));

    const owner = await ownerView(code, session);
    expect(owner.body.link.shared).toBe(true);
    expect(owner.body.link.shareExpiresAt).toBe(shared.body.expiresAt);
    expect(owner.body.link.shareUrl).toBeUndefined();
    expect(JSON.stringify(owner.body)).not.toContain(secretOf(token));

    const pub = await readPublic(token);
    expect(pub.status).toBe(200);
    expect(pub.body.success).toBe(true);
    expect(pub.body.report.link.code).toBe(code);
    expect(pub.body.report.notEnoughActivity).toBe(true);
    expect(pub.body.report.totals).toBeNull();
    expect(pub.body.report.sharedAtMs).toBe(link.share.createdAtMs);
    expect(pub.body.report.expiresAtMs).toBe(expiresAtMs);
  });

  test('revoking closes the report at once; the owner sees it unshared; revoking twice is harmless', async () => {
    const { code, session } = await guestLink();
    const token = tokenOf((await share(code, session)).body.shareUrl);
    expect((await readPublic(token)).status).toBe(200);

    expect((await unshare(code, session)).status).toBe(200);
    const gone = await readPublic(token);
    expect(gone.status).toBe(404);
    expect(gone.body).toEqual(NOT_FOUND);
    expect(doc(`short_links/${code}`).share).toBeNull();
    expect(doc(`kortex_report_tokens/${publicIdOf(token)}`).revokedAtMs).toEqual(expect.any(Number));

    const owner = await ownerView(code, session);
    expect(owner.body.link.shared).toBe(false);
    expect(owner.body.link.shareExpiresAt).toBeNull();
    expect((await unshare(code, session)).status).toBe(200);
  });

  test('rotating kills the old URL and issues a new one; minting again does the same, so one URL is live at a time', async () => {
    const { code, session } = await guestLink();
    const first = tokenOf((await share(code, session)).body.shareUrl);

    const rotated = await rotate(code, session);
    expect(rotated.status).toBe(200);
    const second = tokenOf(rotated.body.shareUrl);
    expect(second).toMatch(TOKEN_RE);
    expect(second).not.toBe(first);
    expect((await readPublic(first)).status).toBe(404);
    expect((await readPublic(second)).status).toBe(200);
    expect(doc(`kortex_report_tokens/${publicIdOf(first)}`).revokedAtMs).toEqual(expect.any(Number));
    expect(doc(`short_links/${code}`).share.publicId).toBe(publicIdOf(second));

    const third = tokenOf((await share(code, session)).body.shareUrl);
    expect((await readPublic(second)).status).toBe(404);
    expect((await readPublic(third)).status).toBe(200);
  });

  test('expiry is 7 days, 30 days or never; an expired token is a 404 and the owner sees it lapsed', async () => {
    const { code, session } = await guestLink();
    expect((await share(code, session, { expiresInDays: 3 })).status).toBe(400);
    expect((await share(code, session, { expiresInDays: 'someday' })).status).toBe(400);

    const week = await share(code, session, { expiresInDays: 7 });
    expect(week.status).toBe(200);
    const untilExpiry = Date.parse(week.body.expiresAt) - Date.now();
    expect(untilExpiry).toBeLessThanOrEqual(7 * DAY_MS);
    expect(untilExpiry).toBeGreaterThan(6.9 * DAY_MS);
    const token = tokenOf(week.body.shareUrl);
    doc(`kortex_report_tokens/${publicIdOf(token)}`).expiresAtMs = Date.now() - 1000;
    doc(`short_links/${code}`).share.expiresAtMs = Date.now() - 1000;
    expect((await readPublic(token)).status).toBe(404);
    expect((await ownerView(code, session)).body.link.shared).toBe(false);

    const forever = await share(code, session, { expiresInDays: 'never' });
    expect(forever.status).toBe(200);
    expect(forever.body.expiresAt).toBeNull();
    const foreverToken = tokenOf(forever.body.shareUrl);
    expect(doc(`kortex_report_tokens/${publicIdOf(foreverToken)}`).expiresAtMs).toBeNull();
    const pub = await readPublic(foreverToken);
    expect(pub.status).toBe(200);
    expect(pub.body.report.expiresAtMs).toBeNull();
    expect((await ownerView(code, session)).body.link).toMatchObject({ shared: true, shareExpiresAt: null });
  });

  test('a wrong secret, a truncated secret, a bare publicId, a legacy-shaped token and an unknown publicId are the same 404', async () => {
    const { code, session } = await guestLink();
    const token = tokenOf((await share(code, session)).body.shareUrl);
    const [prefix, secret] = token.split('.');
    const flipped = (secret[0] === 'A' ? 'B' : 'A') + secret.slice(1);
    const bad = [`${prefix}.${flipped}`, `${prefix}.${secret.slice(0, 31)}`, prefix, 'short', 'a'.repeat(24), `report_${'x'.repeat(12)}.${'y'.repeat(32)}`];
    for (const attempt of bad) {
      const res = await readPublic(attempt);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
    expect((await readPublic(token)).status).toBe(200);
  });

  test('another workspace can neither share, rotate nor revoke the link', async () => {
    const { code } = await guestLink();
    const other = await guestLink();
    expect((await share(code, other.session)).status).toBe(404);
    expect((await rotate(code, other.session)).status).toBe(404);
    expect((await unshare(code, other.session)).status).toBe(404);
    expect(doc(`short_links/${code}`).share).toBeUndefined();
    expect(Object.keys(admin._mocks.docData).filter(k => k.startsWith('kortex_report_tokens/'))).toEqual([]);
  });

  test('a held, switched-off or workspace-off link answers 404 even with a live token', async () => {
    const { code, session, tenantId } = await guestLink();
    const token = tokenOf((await share(code, session)).body.shareUrl);
    const link = doc(`short_links/${code}`);

    link.status = 'held';
    expect((await readPublic(token)).status).toBe(404);
    link.status = 'active';
    link.enabled = false;
    expect((await readPublic(token)).status).toBe(404);
    link.enabled = true;

    doc(`tenants/${tenantId}`).enabled = false; gate.resetCache();
    expect((await readPublic(token)).status).toBe(404);
    doc(`tenants/${tenantId}`).enabled = true; gate.resetCache();
    expect((await readPublic(token)).status).toBe(200);
  });
});

describe('Sharing v2 — admin door', () => {
  test('admins share within their tenant, super-admins anywhere; the analytics link block shows state and never the URL', async () => {
    seedAdminLink('lkhouse2', 'kaayko-default');
    seedAdminLink('lkother1', 'tenant-other');

    const shared = await request(app).post('/kortex/lkhouse2/share').set(...UA).set(...ADMIN).send({ expiresInDays: 30 });
    expect(shared.status).toBe(200);
    const token = tokenOf(shared.body.shareUrl);
    expect(token).toMatch(TOKEN_RE);
    expect((await readPublic(token)).status).toBe(200);

    expect((await request(app).post('/kortex/lkother1/share').set(...UA).set(...ADMIN).send({})).status).toBe(403);
    expect((await request(app).post('/kortex/lkother1/share/rotate').set(...UA).set(...ADMIN).send({})).status).toBe(403);
    expect((await request(app).delete('/kortex/lkother1/share').set(...UA).set(...ADMIN)).status).toBe(403);
    expect((await request(app).post('/kortex/lkmissing/share').set(...UA).set(...ADMIN).send({})).status).toBe(404);
    expect((await request(app).post('/kortex/lkhouse2/share').set(...UA).send({})).status).toBe(401);
    expect((await request(app).post('/kortex/lkhouse2/share').set(...UA).set(...ADMIN).send({ expiresInDays: 90 })).status).toBe(400);

    const analytics = await request(app).get('/kortex/links/lkhouse2/analytics').set(...UA).set(...SUPER);
    expect(analytics.status).toBe(200);
    expect(analytics.body.link.shared).toBe(true);
    expect(analytics.body.link.shareExpiresAt).toBe(shared.body.expiresAt);
    expect(analytics.body.link.shareUrl).toBeUndefined();
    expect(analytics.body.link.placementLabel).toBeNull();
    expect(JSON.stringify(analytics.body)).not.toContain(secretOf(token));

    const rotated = await request(app).post('/kortex/lkhouse2/share/rotate').set(...UA).set(...SUPER).send({});
    expect(rotated.status).toBe(200);
    expect((await readPublic(token)).status).toBe(404);
    expect((await readPublic(tokenOf(rotated.body.shareUrl))).status).toBe(200);

    const theirs = await request(app).post('/kortex/lkother1/share').set(...UA).set(...SUPER).send({});
    expect(theirs.status).toBe(200);
    expect(doc('kortex_report_tokens/' + publicIdOf(tokenOf(theirs.body.shareUrl))).tenantId).toBe('tenant-other');

    expect((await request(app).delete('/kortex/lkhouse2/share').set(...UA).set(...SUPER)).status).toBe(200);
    expect((await readPublic(tokenOf(rotated.body.shareUrl))).status).toBe(404);
    expect((await readPublic(tokenOf(theirs.body.shareUrl))).status).toBe(200);
    expect((await request(app).get('/kortex/links/lkhouse2/analytics').set(...UA).set(...SUPER)).body.link).toMatchObject({ shared: false, shareExpiresAt: null });
  });
});
