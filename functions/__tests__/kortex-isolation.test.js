/**
 * Tenant isolation edges closed in the trust pass, plus the audit trail.
 */

require('./helpers/mockSetup');

jest.mock('../middleware/securityMiddleware', () => ({
  secureHeaders: (req, res, next) => next(),
  botProtection: (req, res, next) => next(),
  rateLimiter: () => (req, res, next) => next(),
  honeypot: (req, res) => res.status(200).json({ success: true, honeypot: true }),
}));

const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');

const ADMIN = ['Authorization', 'Bearer VALID_ADMIN_TOKEN'];
const USER = ['Authorization', 'Bearer VALID_USER_TOKEN'];
const SUPER = ['Authorization', 'Bearer VALID_SUPER_ADMIN_TOKEN'];

let app;
let billingApp;
beforeAll(() => {
  app = buildTestApp('/kortex', require('../api/kortex/smartLinks'));
  billingApp = buildTestApp('/billing', require('../api/billing/router'));
});
beforeEach(() => admin._mocks.resetAll());

const tenantA = () => {
  admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'admin@kaayko.com', tenantId: 'tenant-a' };
  admin._mocks.docData['tenants/tenant-a'] = { name: 'Tenant A', enabled: true, plan: 'starter', createdAtMs: Date.now() - 5 * 86400000 };
};
const linkFor = (code, tenantId) => {
  admin._mocks.docData[`short_links/${code}`] = {
    code, tenantId, enabled: true, title: `Link ${code}`, status: 'active',
    destinations: { web: 'https://kaayko.com/store', ios: null, android: null }, installCount: 0
  };
};

describe('GET /kortex/:code', () => {
  test('requires authentication (no public metadata)', async () => {
    linkFor('pub1', 'tenant-b');
    const res = await request(app).get('/kortex/pub1');
    expect(res.status).toBe(401);
  });

  test('another tenant sees the same 404 as a missing code', async () => {
    tenantA();
    linkFor('other1', 'tenant-b');
    const other = await request(app).get('/kortex/other1').set(...ADMIN);
    const missing = await request(app).get('/kortex/nope').set(...ADMIN);
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(other.body).toEqual(missing.body);
  });

  test('the owning tenant reads the full document', async () => {
    tenantA();
    linkFor('mine1', 'tenant-a');
    const res = await request(app).get('/kortex/mine1').set(...ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.link.destinations.web).toBe('https://kaayko.com/store');
  });
});

describe('POST /kortex/events/:type', () => {
  test('rejects calls without a clickId', async () => {
    linkFor('ev1', 'tenant-b');
    const res = await request(app).post('/kortex/events/install').send({ linkId: 'ev1' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CLICK_ID_REQUIRED');
    expect(admin._mocks.docData['short_links/ev1'].installCount).toBe(0);
  });

  test('rejects a clickId that belongs to a different link', async () => {
    linkFor('ev1', 'tenant-b');
    admin._mocks.docData['click_events/c_abc'] = { clickId: 'c_abc', linkCode: 'someone-else' };
    const res = await request(app).post('/kortex/events/install').send({ linkId: 'ev1', clickId: 'c_abc' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CLICK_NOT_FOUND');
  });

  test('attributes an install once per click', async () => {
    linkFor('ev1', 'tenant-b');
    admin._mocks.docData['click_events/c_abc'] = { clickId: 'c_abc', linkCode: 'ev1', installAttributed: false };
    const first = await request(app).post('/kortex/events/install').send({ linkId: 'ev1', clickId: 'c_abc' });
    expect(first.status).toBe(200);
    expect(first.body.attributed).toBe(true);
    expect(admin._mocks.docData['click_events/c_abc'].installAttributed).toBe(true);
    const second = await request(app).post('/kortex/events/install').send({ linkId: 'ev1', clickId: 'c_abc' });
    expect(second.body.attributed).toBe(false);
  });
});

describe('POST /kortex/events (v2)', () => {
  test('rejects events without a link code', async () => {
    const res = await request(app).post('/kortex/events').send({ type: 'link_clicked', tenantId: 'victim-tenant' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LINK_CODE_REQUIRED');
  });

  test('ignores a body tenantId and derives the tenant from the link', async () => {
    linkFor('v2a', 'tenant-a');
    const res = await request(app).post('/kortex/events').send({ type: 'registration_submitted', linkCode: 'v2a', tenantId: 'victim-tenant' });
    expect(res.status).toBe(201);
    const events = Object.entries(admin._mocks.docData).filter(([k]) => k.startsWith('kortex_events/')).map(([, v]) => v);
    expect(events).toHaveLength(1);
    expect(events[0].tenantId).toBe('tenant-a');
  });

  test('unknown link codes are a 404, not a write', async () => {
    const res = await request(app).post('/kortex/events').send({ type: 'link_clicked', linkCode: 'ghost' });
    expect(res.status).toBe(404);
  });
});

describe('Privileged routes', () => {
  test('the migration route is super-admin only', async () => {
    tenantA();
    const res = await request(app).get('/kortex/admin/migrate').set(...ADMIN);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUPER_ADMIN_ONLY');
  });

  test('review decisions are super-admin only, the queue is tenant-scoped', async () => {
    tenantA();
    admin._mocks.docData['short_links/h1'] = { code: 'h1', tenantId: 'tenant-a', status: 'held', enabled: true };
    admin._mocks.docData['short_links/h2'] = { code: 'h2', tenantId: 'tenant-b', status: 'held', enabled: true };
    const queue = await request(app).get('/kortex/review').set(...ADMIN);
    expect(queue.status).toBe(200);
    expect(queue.body.links.map(l => l.code)).toEqual(['h1']);

    const denied = await request(app).post('/kortex/review/h1/approve').set(...ADMIN).send({});
    expect(denied.status).toBe(403);

    admin._mocks.docData['admin_users/super-admin-uid'] = { role: 'super-admin', email: 'super@kaayko.com' };
    const approved = await request(app).post('/kortex/review/h1/approve').set(...SUPER).send({ reason: 'Verified venue' });
    expect(approved.status).toBe(200);
    expect(approved.body.link.status).toBe('active');
    expect(approved.body.previousStatus).toBe('held');
    expect(admin._mocks.docData['short_links/h1'].status).toBe('active');

    const blocked = await request(app).post('/kortex/review/h2/block').set(...SUPER).send({ reason: 'Phishing' });
    expect(blocked.status).toBe(200);
    expect(admin._mocks.docData['short_links/h2'].status).toBe('blocked');
    expect(admin._mocks.docData['short_links/h2'].blockedBy).toBe('operator');
  });
});

describe('Billing never falls back to the house tenant', () => {
  test('an authenticated user without a tenant profile is refused', async () => {
    const res = await request(billingApp).get('/billing/subscription').set(...USER);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_REQUIRED');
  });

  test('a tenant admin still reads their own subscription', async () => {
    tenantA();
    const res = await request(billingApp).get('/billing/subscription').set(...ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.subscription.plan).toBe('starter');
  });

  test('a profile-less user cannot change the default tenant plan', async () => {
    const res = await request(billingApp).post('/billing/downgrade').set(...USER).send({ planId: 'starter' });
    expect(res.status).toBe(403);
    expect(admin._mocks.docData['tenants/kaayko-default']).toBeUndefined();
  });
});

describe('Appeals', () => {
  test('accepts a well-formed appeal for an existing link and stores it', async () => {
    linkFor('ap1', 'tenant-a');
    admin._mocks.docData['short_links/ap1'].status = 'blocked';
    const res = await request(app).post('/kortex/appeals').send({ code: 'ap1', email: 'owner@example.com', message: 'This is our legitimate ticketing page.' });
    expect(res.status).toBe(202);
    const appeals = Object.entries(admin._mocks.docData).filter(([k]) => k.startsWith('kortex_appeals/')).map(([, v]) => v);
    expect(appeals).toHaveLength(1);
    expect(appeals[0]).toMatchObject({ code: 'ap1', tenantId: 'tenant-a', status: 'open', linkStatus: 'blocked' });
  });

  test('answers 202 for an unknown code without storing anything', async () => {
    const res = await request(app).post('/kortex/appeals').send({ code: 'ghost1', email: 'owner@example.com', message: 'Please review this link.' });
    expect(res.status).toBe(202);
    expect(Object.keys(admin._mocks.docData).some(k => k.startsWith('kortex_appeals/'))).toBe(false);
  });

  test('validates input', async () => {
    const res = await request(app).post('/kortex/appeals').send({ code: 'x', email: 'nope', message: 'short' });
    expect(res.status).toBe(400);
  });
});

describe('Audit trail', () => {
  test('create, update and delete each write an entry with the actor and the diff', async () => {
    tenantA();
    const created = await request(app).post('/kortex').set(...ADMIN).send({ webDestination: 'https://kaayko.com/store', title: 'Audited' });
    expect(created.status).toBe(200);
    const code = created.body.link.code;
    await request(app).put(`/kortex/${code}`).set(...ADMIN).send({ title: 'Renamed' });
    await request(app).delete(`/kortex/${code}`).set(...ADMIN);

    const entries = Object.values(admin._mocks.docData).filter(v => v.action && v.code === code);
    const actions = entries.map(e => e.action);
    expect(actions).toEqual(expect.arrayContaining(['link.created', 'link.updated', 'link.deleted']));
    const updated = entries.find(e => e.action === 'link.updated');
    expect(updated.actor).toMatchObject({ type: 'user', uid: 'admin-uid', email: 'admin@kaayko.com' });
    expect(updated.changes.title).toEqual({ from: 'Audited', to: 'Renamed' });
  });

  test('GET /kortex/:code/audit is tenant-scoped', async () => {
    tenantA();
    linkFor('aud1', 'tenant-a');
    linkFor('aud2', 'tenant-b');
    admin._mocks.docData['kortex_audit_logs/e1'] = { action: 'link.created', code: 'aud1', tenantId: 'tenant-a', atMs: 1 };
    const own = await request(app).get('/kortex/aud1/audit').set(...ADMIN);
    expect(own.status).toBe(200);
    expect(own.body.entries).toHaveLength(1);
    const other = await request(app).get('/kortex/aud2/audit').set(...ADMIN);
    expect(other.status).toBe(403);
  });
});
