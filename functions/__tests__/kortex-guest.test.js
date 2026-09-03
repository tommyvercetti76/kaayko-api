/**
 * Guest (no-account) tier: access-code workspaces.
 *
 * The real securityMiddleware runs here (rate limiters + bot gate) so the
 * fail-closed behaviour is exercised; every request therefore sends a
 * browser User-Agent.
 */

require('./helpers/mockSetup');

const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');
const guest = require('../api/kortex/guestAccess');
const { expireGuestWorkspaces } = require('../api/kortex/guestJobs');
const safety = require('../api/kortex/destinationSafety');

const UA = ['User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'];
const CODE_SHAPE = /^KX-[0-9A-HJKMNP-TV-Z]{6}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/;

let app;
let redirectApp;
beforeAll(() => {
  app = buildTestApp('/kortex', require('../api/kortex/smartLinks'));
  redirectApp = buildTestApp('/', require('../api/kortex/deeplinkRoutes'));
});
beforeEach(() => {
  admin._mocks.resetAll();
  safety.resetCaches();
  delete process.env.SENDGRID_API_KEY;
});

const docs = (prefix) => Object.entries(admin._mocks.docData).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ key: k, ...v }));

async function createFirst(extra = {}) {
  const res = await request(app).post('/kortex/guest/links').set(...UA)
    .send({ destination: 'https://kaayko.com/paddlingout', title: 'Poster', ...extra });
  return res;
}

describe('Creating a free link', () => {
  test('mints a workspace, an access code, a session and a kaayko.com/l/ link', async () => {
    const res = await createFirst();
    expect(res.status).toBe(201);
    expect(res.body.isNewWorkspace).toBe(true);
    expect(res.body.accessCode).toMatch(CODE_SHAPE);
    expect(res.body.session).toMatch(/^kxs\./);
    expect(res.body.link.shortUrl).toMatch(/^https:\/\/kaayko\.com\/l\/kx-[a-z0-9]{6}$/);
    expect(res.body.link.qrUrl).toBe(`https://kaayko.com/qr/${res.body.link.code}.png`);
    expect(res.body.qr.png).toMatch(/^data:image\/png;base64,/);
    expect(res.body.workspace).toMatchObject({ plan: 'free', links: 1, linkLimit: 25, analyticsDays: 7, hasEmail: false });

    const tenant = admin._mocks.docData[`tenants/${res.body.workspace.id}`];
    expect(tenant.kind).toBe('guest');
    expect(tenant.guest.accessCodeHash).toHaveLength(64);
    expect(tenant.guest.email).toBeNull();
    expect(JSON.stringify(tenant)).not.toContain(res.body.accessCode.replace(/-/g, '').slice(8));

    const link = admin._mocks.docData[`short_links/${res.body.link.code}`];
    expect(link.tenantId).toBe(res.body.workspace.id);
    expect(link.status).toBe('active');
  });

  test('a second link with the session joins the same workspace and never re-issues the code', async () => {
    const first = await createFirst();
    const second = await request(app).post('/kortex/guest/links').set(...UA)
      .set('X-Kortex-Guest-Session', first.body.session)
      .send({ destination: 'https://example-venue.com/tickets' });
    expect(second.status).toBe(201);
    expect(second.body.isNewWorkspace).toBe(false);
    expect(second.body.accessCode).toBeUndefined();
    expect(second.body.workspace.id).toBe(first.body.workspace.id);
    expect(second.body.workspace.links).toBe(2);
  });

  test('an unknown domain is never held for a guest (no hold, no dead QR)', async () => {
    const res = await createFirst({ destination: 'https://a-brand-new-bakery.example/menu' });
    expect(res.status).toBe(201);
    expect(res.body.link.status).toBe('active');
  });

  test('a refused destination leaves no empty workspace behind', async () => {
    const res = await createFirst({ destination: 'http://192.168.1.10/admin' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DESTINATION_BLOCKED');
    expect(docs('tenants/')).toHaveLength(0);
  });

  test('the honeypot field and a missing destination are rejected', async () => {
    expect((await createFirst({ website: 'http://spam' })).status).toBe(400);
    const empty = await request(app).post('/kortex/guest/links').set(...UA).send({ title: 'no url' });
    expect(empty.status).toBe(400);
  });

  test('an email at creation queues the access code when no provider is configured', async () => {
    const res = await createFirst({ email: 'owner@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.emailDelivery).toBe('queued');
    expect(res.body.workspace.hasEmail).toBe(true);
    expect(res.body.workspace.email).toMatch(/^ow.+@example\.com$/);
    const mail = docs('pending_emails/');
    expect(mail).toHaveLength(1);
    expect(mail[0].text).toContain(res.body.accessCode);
    expect(mail[0].status).toBe('queued');
  });

  test('sends through SendGrid when a key is present', async () => {
    process.env.SENDGRID_API_KEY = 'SG.test';
    const fetchImpl = jest.fn(async () => ({ status: 202, ok: true }));
    const emailDelivery = require('../services/emailDelivery');
    const result = await emailDelivery.sendGuestAccessCode({ to: 'x@example.com', accessCode: 'KX-TEST', link: { shortUrl: 'https://kaayko.com/l/kx-1' } }, { fetchImpl });
    expect(result.status).toBe('sent');
    const call = fetchImpl.mock.calls[0];
    expect(call[0]).toContain('api.sendgrid.com');
    expect(JSON.parse(call[1].body).personalizations[0].to[0].email).toBe('x@example.com');
  });
});

describe('Access codes', () => {
  test('the exact code, and a sloppily typed one, open a session; a wrong one does not', async () => {
    const created = await createFirst();
    const code = created.body.accessCode;

    const exact = await request(app).post('/kortex/guest/session').set(...UA).send({ accessCode: code });
    expect(exact.status).toBe(200);
    expect(exact.body.session).toMatch(/^kxs\./);
    expect(exact.body.workspace.links).toBe(1);

    const sloppy = await request(app).post('/kortex/guest/session').set(...UA)
      .send({ accessCode: code.toLowerCase().replace(/-/g, ' ').replace(/1/g, 'l') });
    expect(sloppy.status).toBe(200);

    const wrong = await request(app).post('/kortex/guest/session').set(...UA)
      .send({ accessCode: code.slice(0, -4) + (code.endsWith('AAAA') ? 'BBBB' : 'AAAA') });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_ACCESS_CODE');

    const garbage = await request(app).post('/kortex/guest/session').set(...UA).send({ accessCode: 'nope' });
    expect(garbage.status).toBe(401);
    expect(garbage.body.error).toBe(wrong.body.error);
  });

  test('locks a workspace after repeated failures', async () => {
    const created = await createFirst();
    const code = created.body.accessCode;
    const bad = code.slice(0, -4) + (code.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    for (let i = 0; i < guest.LOCK_AFTER_FAILURES; i++) {
      await request(app).post('/kortex/guest/session').set(...UA).send({ accessCode: bad });
    }
    const locked = await request(app).post('/kortex/guest/session').set(...UA).send({ accessCode: code });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('ACCESS_CODE_LOCKED');
  });

  test('each check-in renews the workspace for another lifetime', async () => {
    const created = await createFirst();
    const tenantKey = `tenants/${created.body.workspace.id}`;
    admin._mocks.docData[tenantKey].guest.expiresAtMs = Date.now() + 1000;
    const res = await request(app).post('/kortex/guest/session').set(...UA).send({ accessCode: created.body.accessCode });
    expect(res.status).toBe(200);
    const renewed = admin._mocks.docData[tenantKey].guest.expiresAtMs;
    expect(renewed).toBeGreaterThan(Date.now() + 300 * 86400000);
  });

  test('attaching an email rotates the code, mails the new one and kills old sessions', async () => {
    const created = await createFirst();
    const oldSession = created.body.session;
    const res = await request(app).post('/kortex/guest/email').set(...UA)
      .set('X-Kortex-Guest-Session', oldSession).send({ email: 'owner@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.accessCode).toMatch(CODE_SHAPE);
    expect(res.body.accessCode).not.toBe(created.body.accessCode);
    expect(res.body.emailDelivery).toBe('queued');

    const stale = await request(app).get('/kortex/guest/workspace').set(...UA).set('X-Kortex-Guest-Session', oldSession);
    expect(stale.status).toBe(401);
    const fresh = await request(app).get('/kortex/guest/workspace').set(...UA).set('X-Kortex-Guest-Session', res.body.session);
    expect(fresh.status).toBe(200);

    const oldCode = await request(app).post('/kortex/guest/session').set(...UA).send({ accessCode: created.body.accessCode });
    expect(oldCode.status).toBe(401);
    const newCode = await request(app).post('/kortex/guest/session').set(...UA).send({ accessCode: res.body.accessCode });
    expect(newCode.status).toBe(200);
  });

  test('recovery by email answers the same way for known and unknown addresses', async () => {
    const created = await createFirst({ email: 'owner@example.com' });
    admin._mocks.docData = admin._mocks.docData; // keep
    const beforeMails = docs('pending_emails/').length;

    const unknown = await request(app).post('/kortex/guest/recover').set(...UA).send({ email: 'nobody@example.com' });
    expect(unknown.status).toBe(202);
    expect(docs('pending_emails/')).toHaveLength(beforeMails);

    const known = await request(app).post('/kortex/guest/recover').set(...UA).send({ email: 'owner@example.com' });
    expect(known.status).toBe(202);
    expect(known.body.message).toBe(unknown.body.message);
    const mails = docs('pending_emails/');
    expect(mails).toHaveLength(beforeMails + 1);
    expect(mails[mails.length - 1].template).toBe('guest_code_rotated');

    const oldCode = await request(app).post('/kortex/guest/session').set(...UA).send({ accessCode: created.body.accessCode });
    expect(oldCode.status).toBe(401);
  });
});

describe('Workspace scope', () => {
  test('a guest cannot read, edit or delete another workspace link', async () => {
    const a = await createFirst();
    const b = await createFirst({ destination: 'https://kaayko.com/store' });
    const otherCode = b.body.link.code;
    const headers = ['X-Kortex-Guest-Session', a.body.session];
    expect((await request(app).get(`/kortex/guest/links/${otherCode}`).set(...UA).set(...headers)).status).toBe(404);
    expect((await request(app).patch(`/kortex/guest/links/${otherCode}`).set(...UA).set(...headers).send({ title: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/kortex/guest/links/${otherCode}`).set(...UA).set(...headers)).status).toBe(404);
    expect(admin._mocks.docData[`short_links/${otherCode}`]).toBeDefined();

    const list = await request(app).get('/kortex/guest/workspace').set(...UA).set(...headers);
    expect(list.body.links.map(l => l.code)).toEqual([a.body.link.code]);
  });

  test('editing the destination keeps the safety checks; enabling and titling work', async () => {
    const created = await createFirst();
    const code = created.body.link.code;
    const headers = ['X-Kortex-Guest-Session', created.body.session];
    const bad = await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...headers).send({ destination: 'http://127.0.0.1/' });
    expect(bad.status).toBe(422);
    const ok = await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...headers)
      .send({ destination: 'https://kaayko.com/store', title: 'Store QR', enabled: false });
    expect(ok.status).toBe(200);
    expect(ok.body.link.destinations.web).toBe('https://kaayko.com/store');
    expect(ok.body.link.enabled).toBe(false);
    expect(ok.body.link.title).toBe('Store QR');
  });

  test('analytics are clamped to the free 7-day window while lifetime totals stay', async () => {
    const created = await createFirst();
    const code = created.body.link.code;
    const now = Date.now();
    admin._mocks.docData[`short_links/${code}`].clickCount = 9;
    admin._mocks.docData['click_events/c_old'] = { clickId: 'c_old', linkCode: code, timestampMs: now - 10 * 86400000, platform: 'web', ip: 'a'.repeat(16), deviceInfo: {} };
    admin._mocks.docData['click_events/c_new'] = { clickId: 'c_new', linkCode: code, timestampMs: now - 2 * 86400000, platform: 'ios', ip: 'b'.repeat(16), deviceInfo: {} };
    const res = await request(app).get(`/kortex/guest/links/${code}/analytics`).set(...UA)
      .set('X-Kortex-Guest-Session', created.body.session);
    expect(res.status).toBe(200);
    expect(res.body.analytics.totals.events).toBe(1);
    expect(res.body.analytics.window.retentionDays).toBe(7);
    expect(res.body.lifetime.clicks).toBe(9);
  });

  test('a session token cannot be forged or reused across workspaces', async () => {
    const created = await createFirst();
    const [prefix, payload, sig] = created.body.session.split('.');
    const tampered = `${prefix}.${payload}.${sig.slice(0, -2)}AA`;
    expect((await request(app).get('/kortex/guest/workspace').set(...UA).set('X-Kortex-Guest-Session', tampered)).status).toBe(401);
    const otherPayload = Buffer.from(JSON.stringify({ t: 'g_zzzzzz', v: 1, iat: Date.now(), exp: Date.now() + 1e6 })).toString('base64url');
    expect((await request(app).get('/kortex/guest/workspace').set(...UA).set('X-Kortex-Guest-Session', `kxs.${otherPayload}.${sig}`)).status).toBe(401);
    expect(guest.verifySession('kxs.bad.bad')).toBeNull();
  });
});

describe('Claiming into an account (paid path)', () => {
  test('a signed-in user takes over the workspace and the access code stops working', async () => {
    const created = await createFirst();
    const res = await request(app).post('/kortex/guest/claim').set(...UA)
      .set('Authorization', 'Bearer VALID_USER_TOKEN')
      .send({ accessCode: created.body.accessCode, name: 'Acme Events' });
    expect(res.status).toBe(200);
    expect(res.body.tenant.id).toBe(created.body.workspace.id);
    const tenant = admin._mocks.docData[`tenants/${created.body.workspace.id}`];
    expect(tenant.kind).toBe('account');
    expect(tenant.name).toBe('Acme Events');
    const profile = admin._mocks.docData['admin_users/user-uid'];
    expect(profile).toMatchObject({ role: 'admin', tenantId: created.body.workspace.id });
    expect(admin._mocks.auth.setCustomUserClaims).toHaveBeenCalledWith('user-uid', expect.objectContaining({ role: 'admin' }));

    const guestAfter = await request(app).get('/kortex/guest/workspace').set(...UA).set('X-Kortex-Guest-Session', created.body.session);
    expect(guestAfter.status).toBe(401);
  });

  test('requires a real sign-in', async () => {
    const created = await createFirst();
    const res = await request(app).post('/kortex/guest/claim').set(...UA).send({ accessCode: created.body.accessCode });
    expect(res.status).toBe(401);
  });

  test('a live guest session on the device is enough proof to claim; no proof is refused', async () => {
    const created = await createFirst();

    const noProof = await request(app).post('/kortex/guest/claim').set(...UA)
      .set('Authorization', 'Bearer VALID_USER_TOKEN').send({});
    expect(noProof.status).toBe(400);
    expect(admin._mocks.docData[`tenants/${created.body.workspace.id}`].kind).toBe('guest');

    const res = await request(app).post('/kortex/guest/claim').set(...UA)
      .set('Authorization', 'Bearer VALID_USER_TOKEN')
      .set('X-Kortex-Guest-Session', created.body.session)
      .send({ name: 'Claimed via session' });
    expect(res.status).toBe(200);
    expect(admin._mocks.docData[`tenants/${created.body.workspace.id}`].kind).toBe('account');

    // Once the account owns a workspace, claiming another is refused.
    const again = await request(app).post('/kortex/guest/claim').set(...UA)
      .set('Authorization', 'Bearer VALID_USER_TOKEN').send({ accessCode: created.body.accessCode });
    expect(again.status).toBe(409);
  });
});

describe('Limits and housekeeping', () => {
  test('link creation answers 503 when the limiter store is down (fail closed)', async () => {
    const collection = admin._mocks.firestore.collection;
    const realImpl = collection.getMockImplementation();
    collection.mockImplementation((path) => {
      if (path === 'rate_limits') return { doc: () => ({ get: async () => { throw new Error('firestore down'); } }) };
      return realImpl(path);
    });
    try {
      const res = await createFirst();
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('RATE_LIMIT_UNAVAILABLE');
    } finally {
      collection.mockImplementation(realImpl);
    }
  });

  test('the 25-link free cap applies per workspace', async () => {
    const created = await createFirst();
    for (let i = 0; i < 24; i++) {
      admin._mocks.docData[`short_links/pad-${i}`] = { code: `pad-${i}`, tenantId: created.body.workspace.id, enabled: true };
    }
    const res = await request(app).post('/kortex/guest/links').set(...UA)
      .set('X-Kortex-Guest-Session', created.body.session).send({ destination: 'https://kaayko.com/store' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLAN_LIMIT_EXCEEDED');
  });

  test('expired workspaces have links disabled and revive on the next check-in', async () => {
    const created = await createFirst();
    const tenantKey = `tenants/${created.body.workspace.id}`;
    admin._mocks.docData[tenantKey].guest.expiresAtMs = Date.now() - 1000;

    const result = await expireGuestWorkspaces({ limit: 50 });
    expect(result.expired).toBe(1);
    expect(result.linksDisabled).toBe(1);
    const link = admin._mocks.docData[`short_links/${created.body.link.code}`];
    expect(link.enabled).toBe(false);
    expect(link.disabledReason).toBe('guest_expired');

    const session = await request(app).post('/kortex/guest/session').set(...UA).send({ accessCode: created.body.accessCode });
    expect(session.status).toBe(200);
    expect(session.body.revivedLinks).toBe(1);
    expect(admin._mocks.docData[`short_links/${created.body.link.code}`].enabled).toBe(true);
    expect(admin._mocks.docData[tenantKey].guest.expired).toBe(false);
  });
});

describe('Public QR image', () => {
  test('serves PNG and SVG for a live link and 404 for held or missing ones', async () => {
    const created = await createFirst();
    const code = created.body.link.code;
    const png = await request(redirectApp).get(`/qr/${code}.png`).set(...UA);
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toContain('image/png');
    expect(png.headers['cache-control']).toContain('max-age');
    const svg = await request(app).get(`/kortex/qr/${code}.svg`).set(...UA);
    expect(svg.status).toBe(200);
    expect(svg.headers['content-type']).toContain('image/svg+xml');
    expect((svg.text || svg.body.toString('utf8'))).toContain('<svg');

    admin._mocks.docData[`short_links/${code}`].status = 'held';
    expect((await request(redirectApp).get(`/qr/${code}.png`).set(...UA)).status).toBe(404);
    expect((await request(redirectApp).get('/qr/ghost-code.png').set(...UA)).status).toBe(404);
    expect((await request(redirectApp).get('/qr/bad%20name.png').set(...UA)).status).toBe(404);
  });
});
