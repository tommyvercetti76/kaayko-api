/**
 * Pass 2: caps + expiry with a fallback, UTM merge + scan tagging, CSV export,
 * abuse reports with auto-hold, the tenant kill switch, and support requests.
 */

require('./helpers/mockSetup');

const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');
const safety = require('../api/kortex/destinationSafety');
const rules = require('../api/kortex/linkRules');
const utm = require('../api/kortex/utmTools');
const gate = require('../api/kortex/tenantGate');

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
  delete process.env.SENDGRID_API_KEY;
  admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'admin@kaayko.com', tenantId: 'kaayko-default', tenantIds: ['kaayko-default'] };
  admin._mocks.docData['admin_users/super-admin-uid'] = { role: 'super-admin', email: 'super@kaayko.com', tenantId: 'kaayko-default' };
});

const docs = (prefix) => Object.entries(admin._mocks.docData).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ key: k, ...v }));
const doc = (path) => admin._mocks.docData[path];
function proPlan(wsId) { admin._mocks.docData['tenants/' + wsId].plan = 'pro'; gate.resetCache(); }

async function createGuest(extra = {}, ip = '203.0.113.10') {
  return request(app).post('/kortex/guest/links').set(...UA).set('X-Forwarded-For', ip)
    .send({ destination: 'https://kaayko.com/paddlingout', title: 'Poster', ...extra });
}
const scan = (code, query = '') => request(redirectApp).get(`/l/${code}${query}`).set(...UA).set(...LANG);

describe('linkRules', () => {
  test('normalises and clears limits', () => {
    expect(rules.normalizeLimits(null)).toBeNull();
    expect(rules.normalizeLimits({})).toBeNull();
    expect(rules.normalizeLimits({ maxClicks: '', fallbackUrl: '' })).toBeNull();
    expect(rules.normalizeLimits({ maxClicks: '5' })).toEqual({ maxClicks: 5, fallbackUrl: null, version: 1 });
    expect(rules.normalizeLimits({ fallbackUrl: ' https://kaayko.com/store ' })).toEqual({ maxClicks: null, fallbackUrl: 'https://kaayko.com/store', version: 1 });
    expect(() => rules.normalizeLimits({ maxClicks: 0 })).toThrow(/whole number/);
    expect(() => rules.normalizeLimits({ maxClicks: 2.5 })).toThrow(/whole number/);
    expect(() => rules.normalizeLimits({ fallbackUrl: 'javascript:alert(1)' })).toThrow(/http/);
    expect(() => rules.normalizeLimits([])).toThrow(/object/);
  });

  test('decides expiry and caps from the link alone', () => {
    const now = new Date('2026-09-04T12:00:00Z');
    expect(rules.evaluateLimits({ clickCount: 2, limits: { maxClicks: 3 } }, now)).toEqual({ over: false });
    expect(rules.evaluateLimits({ clickCount: 3, limits: { maxClicks: 3, fallbackUrl: 'https://a.b/' } }, now)).toEqual({ over: true, reason: 'clicks', fallbackUrl: 'https://a.b/' });
    expect(rules.evaluateLimits({ expiresAt: '2026-09-01T00:00:00Z' }, now)).toEqual({ over: true, reason: 'expired', fallbackUrl: null });
    expect(rules.evaluateLimits({ expiresAt: { toDate: () => new Date('2026-12-01T00:00:00Z') } }, now)).toEqual({ over: false });
    expect(rules.evaluateLimits({}, now)).toEqual({ over: false });
  });
});

describe('utmTools', () => {
  test('tags on the destination win, the link fills the gaps, a scan adds the medium', () => {
    const out = new URL(utm.mergeTrackingIntoDestination('https://x.y/p?utm_source=keep', { utm: { utm_source: 'link', utm_campaign: 'c' }, scanned: true }));
    expect(out.searchParams.get('utm_source')).toBe('keep');
    expect(out.searchParams.get('utm_campaign')).toBe('c');
    expect(out.searchParams.get('utm_medium')).toBe('qr');
    const noDefault = new URL(utm.mergeTrackingIntoDestination('https://x.y/p', { utm: { utm_medium: 'email' }, scanned: true }));
    expect(noDefault.searchParams.get('utm_medium')).toBe('email');
    expect(utm.mergeTrackingIntoDestination('https://x.y/p', {})).toBe('https://x.y/p');
  });

  test('decodes a pasted URL and marks served QR codes', () => {
    const d = utm.decodeUtm('https://x.y/p?a=1&utm_source=news&utm_campaign=spring');
    expect(d.hasTags).toBe(true);
    expect(d.tags).toEqual({ utm_source: 'news', utm_campaign: 'spring' });
    expect(d.cleanUrl).toBe('https://x.y/p?a=1');
    expect(utm.decodeUtm('not a url').ok).toBe(false);
    expect(utm.scanUrl('https://kaayko.com/l/kx-abc')).toBe('https://kaayko.com/l/kx-abc?s=qr');
    expect(utm.isQrScan({ s: 'qr' })).toBe(true);
    expect(utm.isQrScan({})).toBe(false);
  });
});

describe('Caps and expiry on a free link', () => {
  test('stops at the cap and sends people to the fallback, without counting the visit', async () => {
    const created = await createGuest({ limits: { maxClicks: 2, fallbackUrl: 'https://kaayko.com/store' } });
    expect(created.status).toBe(201);
    expect(created.body.link.limits).toEqual({ maxClicks: 2, fallbackUrl: 'https://kaayko.com/store', version: 1 });
    const code = created.body.link.code;
    admin._mocks.docData[`short_links/${code}`].clickCount = 2;
    const res = await scan(code);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://kaayko.com/store');
    expect(doc(`short_links/${code}`).clickCount).toBe(2);
  });

  test('shows a 410 page when there is no fallback', async () => {
    const created = await createGuest({ limits: { maxClicks: 1 } });
    const code = created.body.link.code;
    admin._mocks.docData[`short_links/${code}`].clickCount = 1;
    const res = await scan(code);
    expect(res.status).toBe(410);
    expect(res.text).toMatch(/Link Limit Reached/);
  });

  test('an expired link falls back too; clearing the limits and the date brings it back', async () => {
    const created = await createGuest();
    const code = created.body.link.code;
    const headers = ['X-Kortex-Guest-Session', created.body.session];
    const changed = await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...headers)
      .send({ expiresAt: '2020-01-01T00:00:00Z', limits: { fallbackUrl: 'https://kaayko.com/kortex' } });
    expect(changed.status).toBe(200);
    expect(changed.body.link.expiresAt).toBe('2020-01-01T00:00:00.000Z');
    expect((await scan(code)).headers.location).toBe('https://kaayko.com/kortex');

    const cleared = await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...headers).send({ expiresAt: null, limits: null });
    expect(cleared.body.link.limits).toBeNull();
    expect(cleared.body.link.expiresAt).toBeNull();
    const back = await scan(code);
    expect(back.status).toBe(200); // free tier interstitial
    expect(back.text).toMatch(/paddlingout/);
  });

  test('the fallback URL goes through the safety engine; a bad cap is refused', async () => {
    const blocked = await createGuest({ limits: { fallbackUrl: 'http://127.0.0.1/' } });
    expect(blocked.status).toBe(422);
    expect(docs('tenants/')).toHaveLength(0);
    const bad = await createGuest({ limits: { maxClicks: 0 } });
    expect(bad.status).toBe(400);
  });

  test('the API resolver honours the cap and the fallback', async () => {
    const created = await createGuest({ limits: { maxClicks: 1 } });
    const code = created.body.link.code;
    admin._mocks.docData[`short_links/${code}`].clickCount = 1;
    const capped = await request(app).get(`/kortex/links/${code}/resolve`).set(...UA);
    expect(capped.status).toBe(410);
    expect(capped.body.code).toBe('LINK_CAPPED');

    await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set('X-Kortex-Guest-Session', created.body.session)
      .send({ limits: { maxClicks: 1, fallbackUrl: 'https://kaayko.com/store' } });
    const fallback = await request(app).get(`/kortex/links/${code}/resolve`).set(...UA);
    expect(fallback.status).toBe(200);
    expect(fallback.body.destination).toBe('https://kaayko.com/store');
    expect(fallback.body.overLimit).toBe('clicks');
    expect(doc(`short_links/${code}`).clickCount).toBe(1);
  });
});

describe('Scans, taps and campaign tags', () => {
  test('a QR scan is recorded as a scan and tagged utm_medium=qr without touching the tags the destination has', async () => {
    const created = await createGuest({ destination: 'https://kaayko.com/store?utm_source=poster' });
    const code = created.body.link.code;
    proPlan(created.body.workspace.id);
    const res = await scan(code, '?s=qr');
    expect(res.status).toBe(302);
    const to = new URL(res.headers.location);
    expect(to.searchParams.get('utm_source')).toBe('poster');
    expect(to.searchParams.get('utm_medium')).toBe('qr');
    expect(to.searchParams.has('s')).toBe(false);
    const events = docs('click_events/');
    expect(events).toHaveLength(1);
    expect(events[0].metadata.source).toBe('qr');
    expect(events[0]).toMatchObject({ schemaVersion: 2, delivered: true, outcome: 'delivered', fallbackReason: null, referrerHost: 'direct', visitorKeyVersion: 1, redirectedTo: 'https://kaayko.com/store', metadata: { source: 'qr', scheduleWindow: null } });
    expect(events[0].deviceInfo).toEqual({ deviceType: 'mobile', os: 'iOS', browser: 'Safari', parserVersion: 1 });
    expect(events[0].ip).toBeUndefined(); expect(events[0].userAgent).toBeUndefined(); expect(events[0].referrer).toBeUndefined();
  });

  test('a plain tap is a link click and gets no medium added', async () => {
    const created = await createGuest({ destination: 'https://kaayko.com/store' });
    const code = created.body.link.code;
    proPlan(created.body.workspace.id);
    const res = await scan(code);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location).searchParams.has('utm_medium')).toBe(false);
    expect(docs('click_events/')[0].metadata.source).toBe('link');
  });
});

describe('CSV export', () => {
  test('a free workspace downloads its scans and its link list; another workspace cannot', async () => {
    const created = await createGuest();
    const code = created.body.link.code;
    proPlan(created.body.workspace.id);
    await scan(code, '?s=qr');
    const session = ['X-Kortex-Guest-Session', created.body.session];

    const csv = await request(app).get(`/kortex/guest/links/${code}/analytics.csv`).set(...UA).set(...session);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/attachment/);
    expect(csv.text.charCodeAt(0)).toBe(0xFEFF);
    const lines = csv.text.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('time,link,source,platform,device,os,browser,country,referrer_host,utm_source,utm_medium,utm_campaign,utm_term,utm_content,window,sent_to,delivered,outcome,outcome_class');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(new RegExp(`,${code},qr,ios,`));
    expect(lines[1]).toMatch(/,direct,/);
    expect(lines[1]).toMatch(/,https:\/\/kaayko\.com\/paddlingout,yes,delivered,delivered$/);

    const list = await request(app).get('/kortex/guest/workspace/export.csv').set(...UA).set(...session);
    expect(list.status).toBe(200);
    expect(list.text).toMatch(new RegExp(`${code},https://kaayko.com/l/${code},Poster,active,live,`));

    const other = await createGuest({}, '203.0.113.99');
    const denied = await request(app).get(`/kortex/guest/links/${code}/analytics.csv`).set(...UA).set('X-Kortex-Guest-Session', other.body.session);
    expect(denied.status).toBe(404);
    expect(docs('kortex_audit_logs/').some(e => e.action === 'analytics.exported')).toBe(true);
  });

  test('admins export inside their tenant scope', async () => {
    const created = await createGuest();
    const code = created.body.link.code;
    const superRes = await request(app).get(`/kortex/${code}/clicks.csv`).set(...UA).set('Authorization', 'Bearer VALID_SUPER_ADMIN_TOKEN');
    expect(superRes.status).toBe(200);
    expect(superRes.headers['content-type']).toMatch(/text\/csv/);
    const adminRes = await request(app).get(`/kortex/${code}/clicks.csv`).set(...UA).set('Authorization', 'Bearer VALID_ADMIN_TOKEN');
    expect(adminRes.status).toBe(403);
  });

  test('the portfolio export lists the tenant links and is scoped', async () => {
    const created = await createGuest();
    const mine = await request(app).get('/kortex/export/links.csv').set(...UA).set('Authorization', 'Bearer VALID_ADMIN_TOKEN');
    expect(mine.status).toBe(200);
    expect(mine.headers['content-type']).toMatch(/text\/csv/);
    expect(mine.text).not.toContain(created.body.link.code); // guest link belongs to another tenant
    const all = await request(app).get('/kortex/export/links.csv?allTenants=true').set(...UA).set('Authorization', 'Bearer VALID_SUPER_ADMIN_TOKEN');
    expect(all.status).toBe(200);
    expect(all.text).toContain(created.body.link.code);
    expect(docs('kortex_audit_logs/').some(e => e.action === 'links.exported')).toBe(true);
  });

  test('cells that would run as formulas are neutralised', () => {
    const { toCsv } = require('../api/kortex/csvExport');
    const out = toCsv(['a'], [{ a: '=HYPERLINK("x")' }, { a: 'plain, text' }]);
    expect(out).toContain('"\'=HYPERLINK(""x"")"');
    expect(out).toContain('"plain, text"');
  });
});

describe('Abuse reports', () => {
  const report = (body, ip) => request(app).post('/kortex/report').set(...UA).set('X-Forwarded-For', ip).send(body);

  test('three different reporters hold a free link for review', async () => {
    const created = await createGuest();
    const code = created.body.link.code;
    const first = await report({ code, reason: 'phishing', details: 'Pretends to be a bank login page.' }, '198.51.100.1');
    expect(first.status).toBe(202);
    expect(doc(`short_links/${code}`).status).toBe('active');
    const second = await report({ code, reason: 'phishing', details: 'Same here.' }, '198.51.100.2');
    expect(second.status).toBe(202);
    expect(doc(`short_links/${code}`).status).toBe('active');
    const third = await report({ code, reason: 'phishing', details: 'And here.' }, '198.51.100.3');
    expect(third.status).toBe(202);
    expect(doc(`short_links/${code}`).status).toBe('held');
    expect(docs('security_alerts/').some(a => a.type === 'abuse_auto_hold' && a.code === code)).toBe(true);
    const res = await scan(code);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/being reviewed/);
  });

  test('the same reporter twice is one reporter; other reasons never auto-hold', async () => {
    const created = await createGuest();
    const code = created.body.link.code;
    for (let i = 0; i < 3; i++) await report({ code, reason: 'malware', details: 'Downloads something.' }, '198.51.100.7');
    expect(doc(`short_links/${code}`).status).toBe('active');
    for (const ip of ['198.51.100.8', '198.51.100.9', '198.51.100.10']) await report({ code, reason: 'spam', details: 'Too many posters.' }, ip);
    expect(doc(`short_links/${code}`).status).toBe('active');
  });

  test('an unknown code gets the same answer; a bad reason is refused', async () => {
    const unknown = await report({ code: 'kx-nope00', reason: 'scam', details: 'whatever' }, '198.51.100.3');
    expect(unknown.status).toBe(202);
    expect(unknown.body.message).toMatch(/reviewer/);
    const bad = await report({ code: 'kx-nope00', reason: 'ugly', details: 'no' }, '198.51.100.4');
    expect(bad.status).toBe(400);
  });

  test('super-admins list and resolve reports; tenant admins cannot', async () => {
    await report({ code: 'kx-nope01', reason: 'scam', details: 'whatever' }, '198.51.100.5');
    const list = await request(app).get('/kortex/reports').set(...UA).set('Authorization', 'Bearer VALID_SUPER_ADMIN_TOKEN');
    expect(list.status).toBe(200);
    expect(list.body.reports).toHaveLength(1);
    const resolved = await request(app).post(`/kortex/reports/${list.body.reports[0].id}/resolve`).set(...UA)
      .set('Authorization', 'Bearer VALID_SUPER_ADMIN_TOKEN').send({ resolution: 'Not phishing.' });
    expect(resolved.status).toBe(200);
    const denied = await request(app).get('/kortex/reports').set(...UA).set('Authorization', 'Bearer VALID_ADMIN_TOKEN');
    expect(denied.status).toBe(403);
  });
});

describe('Tenant kill switch', () => {
  test('switching a workspace off stops its links and its session; restore brings them back', async () => {
    const created = await createGuest();
    const code = created.body.link.code;
    const ws = created.body.workspace.id;
    const auth = ['Authorization', 'Bearer VALID_SUPER_ADMIN_TOKEN'];

    expect((await scan(code)).status).toBe(200);
    const killed = await request(app).post(`/kortex/tenants/${ws}/kill`).set(...UA).set(...auth).send({ reason: 'phishing campaign' });
    expect(killed.status).toBe(200);
    const off = await scan(code);
    expect(off.status).toBe(410);
    expect(off.text).toMatch(/switched off/);
    const session = await request(app).get('/kortex/guest/workspace').set(...UA).set('X-Kortex-Guest-Session', created.body.session);
    expect(session.status).not.toBe(200);
    expect(docs('kortex_audit_logs/').some(e => e.action === 'tenant.killed')).toBe(true);

    const restored = await request(app).post(`/kortex/tenants/${ws}/restore`).set(...UA).set(...auth).send({});
    expect(restored.status).toBe(200);
    expect((await scan(code)).status).toBe(200);
  });

  test('the house tenant cannot be switched off, and tenant admins cannot switch anything', async () => {
    const house = await request(app).post('/kortex/tenants/kaayko-default/kill').set(...UA).set('Authorization', 'Bearer VALID_SUPER_ADMIN_TOKEN').send({});
    expect(house.status).toBe(400);
    const created = await createGuest();
    const denied = await request(app).post(`/kortex/tenants/${created.body.workspace.id}/kill`).set(...UA).set('Authorization', 'Bearer VALID_ADMIN_TOKEN').send({});
    expect(denied.status).toBe(403);
  });
});

describe('Email delivery content parts', () => {
  test('an empty HTML part is not sent to SendGrid', async () => {
    process.env.SENDGRID_API_KEY = 'SG.test';
    const email = require('../services/emailDelivery');
    const calls = [];
    const fetchImpl = async (url, opts) => { calls.push(JSON.parse(opts.body)); return { status: 202, ok: true, text: async () => '' }; };
    const result = await email.deliver({ to: 'ops@example.com', subject: 's', text: 'plain only', html: null }, { fetchImpl });
    expect(result.status).toBe('sent');
    expect(calls[0].content).toEqual([{ type: 'text/plain', value: 'plain only' }]);
    delete process.env.SENDGRID_API_KEY;
  });
});

describe('Support requests', () => {
  const ask = (body, extra = {}) => {
    let r = request(app).post('/kortex/support').set(...UA).set('X-Forwarded-For', extra.ip || '203.0.113.50');
    if (extra.session) r = r.set('X-Kortex-Guest-Session', extra.session);
    if (extra.auth) r = r.set('Authorization', `Bearer ${extra.auth}`);
    return r.send(body);
  };

  test('anyone can ask; the free target is three business days', async () => {
    const res = await ask({ email: 'me@example.com', subject: 'QR not working', message: 'The poster QR opens the wrong page.' });
    expect(res.status).toBe(201);
    expect(res.body.plan).toBe('free');
    expect(res.body.target).toBe('within 3 business days');
    const stored = docs('kortex_support_requests/')[0];
    expect(stored.priority).toBe(3);
    expect(stored.via).toBe('public');
  });

  test('a guest session attaches the workspace; validation is strict', async () => {
    const created = await createGuest();
    const res = await ask({ email: 'me@example.com', message: 'Lost my key card, still have the code.' }, { session: created.body.session });
    expect(res.status).toBe(201);
    const stored = docs('kortex_support_requests/')[0];
    expect(stored.tenantId).toBe(created.body.workspace.id);
    expect(stored.via).toBe('guest');
    expect((await ask({ email: 'nope', message: 'long enough message' })).status).toBe(400);
    expect((await ask({ email: 'me@example.com', message: 'short' })).status).toBe(400);
  });

  test('super-admins see the queue ordered by priority and can resolve', async () => {
    await ask({ email: 'a@example.com', message: 'Free tier question here.' });
    const list = await request(app).get('/kortex/support').set(...UA).set('Authorization', 'Bearer VALID_SUPER_ADMIN_TOKEN');
    expect(list.status).toBe(200);
    expect(list.body.requests).toHaveLength(1);
    const done = await request(app).post(`/kortex/support/${list.body.requests[0].id}/resolve`).set(...UA)
      .set('Authorization', 'Bearer VALID_SUPER_ADMIN_TOKEN').send({ note: 'Replied by email.' });
    expect(done.status).toBe(200);
    expect(docs('kortex_support_requests/')[0].status).toBe('resolved');
  });
});
