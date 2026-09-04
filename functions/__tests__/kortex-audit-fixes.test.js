/**
 * Pins the fixes from the independent backend review (4 Sep 2026).
 */

require('./helpers/mockSetup');

const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');
const safety = require('../api/kortex/destinationSafety');
const gate = require('../api/kortex/tenantGate');
const LinkService = require('../api/kortex/smartLinkService');
const { hashClientIp } = require('../api/kortex/clientIp');

const UA = ['User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'];
const LANG = ['Accept-Language', 'en'];
const SUPER = ['Authorization', 'Bearer VALID_SUPER_ADMIN_TOKEN'];

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
  delete process.env.SENDGRID_API_KEY;
  admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'admin@kaayko.com', tenantId: 'kaayko-default', tenantIds: ['kaayko-default'] };
  admin._mocks.docData['admin_users/super-admin-uid'] = { role: 'super-admin', email: 'super@kaayko.com', tenantId: 'kaayko-default' };
});

const docs = (prefix) => Object.entries(admin._mocks.docData).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ key: k, ...v }));
const doc = (path) => admin._mocks.docData[path];
async function createGuest(extra = {}, ip = '203.0.113.10') {
  return request(app).post('/kortex/guest/links').set(...UA).set('X-Forwarded-For', ip)
    .send({ destination: 'https://kaayko.com/paddlingout', title: 'Poster', ...extra });
}

describe('Privilege never comes from a link document', () => {
  test('metadata.isAdmin is dropped for guests and tenant admins, kept for a super-admin on the house tenant', async () => {
    const guestLink = await createGuest({ metadata: { campaign: 'alumni', isAdmin: true } });
    expect(guestLink.status).toBe(201);
    expect(doc(`short_links/${guestLink.body.link.code}`).metadata.isAdmin).toBeUndefined();

    const viaService = await LinkService.createShortLink({ title: 'x', webDestination: 'https://kaayko.com/alumni', metadata: { campaign: 'alumni', isAdmin: true }, tenantId: 'tenant-a', actorIsSuperAdmin: false });
    expect(doc(`short_links/${viaService.code}`).metadata.isAdmin).toBeUndefined();

    const staff = await LinkService.createShortLink({ title: 'x', webDestination: 'https://kaayko.com/alumni', metadata: { campaign: 'alumni', isAdmin: true }, tenantId: 'kaayko-default', actorIsSuperAdmin: true });
    expect(doc(`short_links/${staff.code}`).metadata.isAdmin).toBe(true);

    // An unprivileged edit cannot add it, and cannot remove a staff-set one either.
    await LinkService.updateShortLink(staff.code, { metadata: { campaign: 'alumni', isAdmin: false } });
    expect(doc(`short_links/${staff.code}`).metadata.isAdmin).toBe(true);
  });
});

describe('Holds survive edits', () => {
  test('a held link stays held when its owner re-saves the destination', async () => {
    const created = await createGuest();
    const code = created.body.link.code;
    await LinkService.setLinkStatus(code, 'held', { reason: 'test', actor: 'reviewer' });
    const res = await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set('X-Kortex-Guest-Session', created.body.session)
      .send({ destination: 'https://kaayko.com/paddlingout' });
    expect(res.status).toBe(200);
    expect(doc(`short_links/${code}`).status).toBe('held');
  });
});

describe('The API resolver honours the same gates as the redirect', () => {
  test('a killed workspace answers 410 on /resolve and never falls through to the house tenant', async () => {
    const created = await createGuest();
    const code = created.body.link.code;
    const ok = await request(app).get(`/kortex/links/${code}/resolve`).set(...UA);
    expect(ok.status).toBe(200);
    expect(ok.body.tenant.id).toBeNull(); // guest ids are never handed out
    await request(app).post(`/kortex/tenants/${created.body.workspace.id}/kill`).set(...UA).set(...SUPER).send({});
    const before = doc(`short_links/${code}`).clickCount || 0;
    const off = await request(app).get(`/kortex/links/${code}/resolve?host=kaayko.com`).set(...UA);
    expect(off.status).toBe(410);
    expect(off.body.code).toBe('TENANT_DISABLED');
    expect(doc(`short_links/${code}`).clickCount || 0).toBe(before);
  });

  test('a scan through /resolve gets the same campaign-tag rules', async () => {
    const created = await createGuest({ destination: 'https://kaayko.com/store?utm_source=poster', utm: { utm_campaign: 'c' } });
    const res = await request(app).get(`/kortex/links/${created.body.link.code}/resolve?s=qr`).set(...UA);
    const to = new URL(res.body.destination);
    expect(to.searchParams.get('utm_source')).toBe('poster');
    expect(to.searchParams.get('utm_campaign')).toBe('c');
    expect(to.searchParams.get('utm_medium')).toBe('qr');
  });
});

describe('Credentials never sit in the mail log', () => {
  test('no bodies are stored; a sensitive message is not queued without a provider; recovery does not rotate', async () => {
    const email = require('../services/emailDelivery');
    const queued = await email.deliver({ to: 'a@example.com', subject: 's', text: 'Access code: KX-SECRET', html: '<b>KX-SECRET</b>', template: 'guest_access_code' });
    expect(queued.status).toBe('not_configured');
    expect(docs('pending_emails/')).toHaveLength(0);

    process.env.SENDGRID_API_KEY = 'SG.test';
    const sent = await email.deliver({ to: 'a@example.com', subject: 's', text: 'Access code: KX-SECRET', html: null, template: 'guest_access_code' },
      { fetchImpl: async () => ({ status: 202, ok: true, text: async () => '' }) });
    expect(sent.status).toBe('sent');
    const log = docs('pending_emails/')[0];
    expect(log.text).toBeUndefined();
    expect(log.html).toBeUndefined();
    expect(JSON.stringify(log)).not.toContain('KX-SECRET');
    delete process.env.SENDGRID_API_KEY;

    const created = await createGuest({ email: 'owner@example.com' });
    const hashBefore = doc('tenants/' + created.body.workspace.id).guest.accessCodeHash;
    const rec = await request(app).post('/kortex/guest/recover').set(...UA).send({ email: 'owner@example.com' });
    expect(rec.status).toBe(202);
    expect(doc('tenants/' + created.body.workspace.id).guest.accessCodeHash).toBe(hashBefore);
  });
});

describe('IP handling', () => {
  test('hashes are keyed, and nothing keeps a raw address', async () => {
    expect(hashClientIp('203.0.113.9')).toMatch(/^[0-9a-f]{16}$/);
    expect(hashClientIp('203.0.113.9')).not.toBe(require('crypto').createHash('sha256').update('kortex-ip-salt:203.0.113.9').digest('hex').slice(0, 16));
    await request(app).post('/kortex/report').set(...UA).set('X-Forwarded-For', '198.51.100.44').send({ code: 'kx-nope00', reason: 'scam', details: 'x' });
    const audit = docs('kortex_audit_logs/').find(e => e.action === 'link.reported');
    expect(audit.ip).not.toBe('198.51.100.44');
    expect(audit.ip).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('No workspace lockout', () => {
  test('nine wrong codes do not lock the owner out', async () => {
    const created = await createGuest();
    const bad = created.body.accessCode.slice(0, -4) + 'ZZZZ';
    for (let i = 0; i < 9; i++) {
      const r = await request(app).post('/kortex/guest/session').set(...UA).set('X-Forwarded-For', `198.51.100.${i + 1}`).send({ accessCode: bad });
      expect(r.status).toBe(401);
    }
    const good = await request(app).post('/kortex/guest/session').set(...UA).set('X-Forwarded-For', '198.51.100.99').send({ accessCode: created.body.accessCode });
    expect(good.status).toBe(200);
  });
});

describe('Abuse reports need three voices', () => {
  const report = (code, ip) => request(app).post('/kortex/report').set(...UA).set('X-Forwarded-For', ip).send({ code, reason: 'phishing', details: 'x' });
  test('two reporters do not hold; the third does; a recent review blocks a repeat', async () => {
    const created = await createGuest();
    const code = created.body.link.code;
    await report(code, '198.51.100.1'); await report(code, '198.51.100.2');
    expect(doc(`short_links/${code}`).status).toBe('active');
    await report(code, '198.51.100.3');
    expect(doc(`short_links/${code}`).status).toBe('held');
    expect(doc(`short_links/${code}`).heldBy).toBe('abuse-reports');
    await LinkService.setLinkStatus(code, 'active', { actor: 'reviewer' });
    admin._mocks.docData[`short_links/${code}`].safety = { ...(doc(`short_links/${code}`).safety || {}), review: { approvedAtMs: Date.now() } };
    await report(code, '198.51.100.4'); await report(code, '198.51.100.5'); await report(code, '198.51.100.6');
    expect(doc(`short_links/${code}`).status).toBe('active');
  });
});

describe('Events cannot be invented', () => {
  test('a conversion needs a clickId from a real click on that link', async () => {
    const created = await createGuest();
    const code = created.body.link.code;
    const fake = await request(app).post('/kortex/events').set(...UA).send({ type: 'registration_submitted', linkCode: code, metadata: { a: 'b' } });
    expect(fake.status).toBe(400);
    expect(fake.body.code).toBe('CLICK_ID_REQUIRED');
    admin._mocks.docData['tenants/' + created.body.workspace.id].plan = 'pro'; gate.resetCache();
    await request(redirectApp).get(`/l/${code}`).set(...UA).set(...LANG);
    const click = docs('click_events/')[0];
    const real = await request(app).post('/kortex/events').set(...UA).send({ type: 'registration_submitted', linkCode: code, clickId: click.clickId, metadata: { a: 'b'.repeat(2000) } });
    expect(real.status).toBe(201);
    const stored = docs('kortex_events/').find(e => e.type === 'registration_submitted');
    expect(stored.metadata.a.length).toBe(500);
    expect(stored.ip).not.toBe('203.0.113.10');
  });

  test('an event record keeps no user-agent and no full referrer, only the referrer host', async () => {
    const created = await createGuest();
    const code = created.body.link.code;
    admin._mocks.docData['tenants/' + created.body.workspace.id].plan = 'pro'; gate.resetCache();
    await request(redirectApp).get(`/l/${code}`).set(...UA).set(...LANG);
    const click = docs('click_events/')[0];
    const posted = await request(app)
      .post('/kortex/events')
      .set(...UA)
      .set('Referer', 'https://mail.example.com/inbox?token=SECRET123')
      .send({ type: 'registration_submitted', linkCode: code, clickId: click.clickId });
    expect(posted.status).toBe(201);
    const stored = docs('kortex_events/').find(e => e.type === 'registration_submitted');
    expect(stored.userAgent).toBeUndefined();
    expect(stored.referrer).toBeUndefined();
    expect(stored.referrerHost).toBe('mail.example.com');
    expect(stored.expiresAt).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain('SECRET123');
    expect(JSON.stringify(stored)).not.toContain('iPhone');
  });
});

describe('Rate limiter counts atomically', () => {
  test('the sixth report from one address inside an hour is refused (transactional count)', async () => {
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const r = await request(app).post('/kortex/report').set(...UA).set('X-Forwarded-For', '198.51.100.77').send({ code: 'kx-nope00', reason: 'spam', details: 'x' });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 5).every(s => s === 202)).toBe(true);
    expect(statuses.slice(5).every(s => s === 429)).toBe(true);
  });
});

describe('Smaller fixes', () => {
  test('returnTo only points back into Kaayko; branded QR options are validated; house codes are random', async () => {
    const { normalizeV2Fields } = require('../api/kortex/v2LinkIntents');
    expect(normalizeV2Fields({ returnTo: 'https://evil.example/x' }).returnTo).toBeNull();
    expect(normalizeV2Fields({ returnTo: 'https://kaayko.com/store' }).returnTo).toBe('https://kaayko.com/store');
    expect(normalizeV2Fields({ returnTo: '/paddlingout' }).returnTo).toBe('/paddlingout');
    expect(normalizeV2Fields({ returnTo: '//evil.example' }).returnTo).toBeNull();
    const { generateShortCode } = require('../api/kortex/smartLinkValidation');
    expect(generateShortCode()).toMatch(/^lk[a-z0-9]{6}$/);
    const svg = await require('../api/kortex/qrService').generateQRSvg('https://kaayko.com/l/x', { logoUrl: 'javascript:alert(1)', background: '"><script>' });
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('javascript:');
  });

  test('a paused link still serves its QR image; a held one does not', async () => {
    const created = await createGuest();
    const code = created.body.link.code;
    await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set('X-Kortex-Guest-Session', created.body.session).send({ enabled: false });
    expect((await request(app).get(`/kortex/qr/${code}.svg`).set(...UA)).status).toBe(200);
    await LinkService.setLinkStatus(code, 'held', { actor: 'reviewer' });
    expect((await request(app).get(`/kortex/qr/${code}.svg`).set(...UA)).status).toBe(404);
  });
});
