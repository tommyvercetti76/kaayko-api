/**
 * Self-serve signup: tenant provisioning, email-verification gate, and the
 * fail-closed rate limiter in front of the provisioning endpoint.
 */

require('./helpers/mockSetup');

const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');
const { provisionSelfServeTenant, slugify } = require('../api/kortex/provisioning');

let app;
beforeAll(() => {
  app = buildTestApp('/kortex', require('../api/kortex/smartLinks'));
});
beforeEach(() => {
  admin._mocks.resetAll();
  admin._mocks.auth.setCustomUserClaims.mockClear();
});

const NEW_USER = ['Authorization', 'Bearer VALID_NEW_USER_TOKEN'];
const UNVERIFIED = ['Authorization', 'Bearer VALID_UNVERIFIED_TOKEN'];
const UA = ['User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1'];

describe('POST /kortex/tenants/provision', () => {
  test('requires authentication', async () => {
    const res = await request(app).post('/kortex/tenants/provision').set(...UA).send({ organization: 'Acme Events' });
    expect(res.status).toBe(401);
  });

  test('creates a starter tenant, the admin profile and the role claim for a new user', async () => {
    const res = await request(app).post('/kortex/tenants/provision').set(...NEW_USER).set(...UA)
      .send({ name: 'Rohan', organization: 'Acme Events', useCase: 'Events & Ticketing' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.existing).toBe(false);
    expect(res.body.tenant.plan).toBe('starter');
    expect(res.body.tenant.id).toMatch(/^acme-events-[a-z0-9]{4,6}$/);
    expect(res.body.next.verifyEmail).toBe(true);

    const tenant = admin._mocks.docData[`tenants/${res.body.tenant.id}`];
    expect(tenant.provisionedVia).toBe('self-serve');
    expect(tenant.trustedDomains).toEqual(['acme-events.com']);
    expect(tenant.enabled).toBe(true);

    const profile = admin._mocks.docData['admin_users/new-user-uid'];
    expect(profile.role).toBe('admin');
    expect(profile.tenantId).toBe(res.body.tenant.id);
    expect(profile.requireEmailVerification).toBe(true);

    expect(admin._mocks.auth.setCustomUserClaims).toHaveBeenCalledWith('new-user-uid', expect.objectContaining({ role: 'admin', tenantId: res.body.tenant.id }));

    const audits = Object.entries(admin._mocks.docData).filter(([k]) => k.startsWith('kortex_audit_logs/'));
    expect(audits.some(([, v]) => v.action === 'tenant.provisioned')).toBe(true);
  });

  test('is idempotent: a second call returns the existing tenant', async () => {
    const first = await request(app).post('/kortex/tenants/provision').set(...NEW_USER).set(...UA).send({ organization: 'Acme Events' });
    const second = await request(app).post('/kortex/tenants/provision').set(...NEW_USER).set(...UA).send({ organization: 'Something Else' });
    expect(second.status).toBe(200);
    expect(second.body.existing).toBe(true);
    expect(second.body.tenant.id).toBe(first.body.tenant.id);
    expect(Object.keys(admin._mocks.docData).filter(k => k.startsWith('tenants/')).length).toBe(1);
  });

  test('never grants anything above admin and rejects a missing organisation', async () => {
    const res = await request(app).post('/kortex/tenants/provision').set(...NEW_USER).set(...UA).send({ organization: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(admin._mocks.auth.setCustomUserClaims).not.toHaveBeenCalled();
  });

  test('free-mail sign-ups get no trusted domain', async () => {
    const result = await provisionSelfServeTenant({ uid: 'gmail-uid', email: 'someone@gmail.com', organization: 'Gmail Org' });
    expect(admin._mocks.docData[`tenants/${result.tenant.id}`].trustedDomains).toEqual([]);
  });

  test('slugify keeps ids URL-safe', () => {
    expect(slugify('Acme Events & Co.')).toBe('acme-events-co');
    expect(slugify('   ')).toBe('org');
    expect(slugify('Ünïcode Schule')).toBe('unicode-schule');
  });
});

describe('requireVerifiedEmail', () => {
  const selfServeUnverified = () => {
    admin._mocks.docData['admin_users/unverified-uid'] = { role: 'admin', email: 'unverified@acme-events.com', tenantId: 'tenant-u', requireEmailVerification: true };
    admin._mocks.docData['tenants/tenant-u'] = { name: 'Unverified Org', enabled: true, plan: 'starter', createdAtMs: Date.now() - 10 * 24 * 60 * 60 * 1000 };
  };

  test('blocks link creation until the address is verified, but still allows reads', async () => {
    selfServeUnverified();
    const create = await request(app).post('/kortex').set(...UNVERIFIED).set(...UA).send({ webDestination: 'https://kaayko.com/store', title: 'Nope' });
    expect(create.status).toBe(403);
    expect(create.body.code).toBe('EMAIL_NOT_VERIFIED');

    const list = await request(app).get('/kortex').set(...UNVERIFIED).set(...UA);
    expect(list.status).toBe(200);
  });

  test('blocks edits and tenant-link creation too', async () => {
    selfServeUnverified();
    admin._mocks.docData['short_links/u1'] = { code: 'u1', tenantId: 'tenant-u', enabled: true, destinations: { web: 'https://kaayko.com/' } };
    const edit = await request(app).put('/kortex/u1').set(...UNVERIFIED).set(...UA).send({ title: 'Edited' });
    expect(edit.status).toBe(403);
    const tenantLink = await request(app).post('/kortex/tenant-links').set(...UNVERIFIED).set(...UA).send({ webDestination: 'https://kaayko.com/', title: 'T' });
    expect(tenantLink.status).toBe(403);
  });

  test('hand-provisioned admins without the flag are unaffected', async () => {
    admin._mocks.docData['admin_users/unverified-uid'] = { role: 'admin', email: 'unverified@acme-events.com', tenantId: 'tenant-u' };
    admin._mocks.docData['tenants/tenant-u'] = { name: 'Legacy Org', enabled: true, plan: 'starter', createdAtMs: Date.now() - 10 * 24 * 60 * 60 * 1000 };
    const create = await request(app).post('/kortex').set(...UNVERIFIED).set(...UA).send({ webDestination: 'https://kaayko.com/store', title: 'Legacy' });
    expect(create.status).toBe(200);
  });
});

describe('Fail-closed rate limiter', () => {
  test('provisioning answers 503 when the limiter store is unreachable', async () => {
    const collection = admin._mocks.firestore.collection;
    const realImpl = collection.getMockImplementation();
    collection.mockImplementation((path) => {
      if (path === 'rate_limits') {
        return { doc: () => ({ get: async () => { throw new Error('firestore down'); } }) };
      }
      return realImpl(path);
    });
    try {
      const res = await request(app).post('/kortex/tenants/provision').set(...NEW_USER).set(...UA).send({ organization: 'Acme Events' });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('RATE_LIMIT_UNAVAILABLE');
    } finally {
      collection.mockImplementation(realImpl);
    }
  });

  test('the legacy api limiter still fails open', async () => {
    const collection = admin._mocks.firestore.collection;
    const realImpl = collection.getMockImplementation();
    collection.mockImplementation((path) => {
      if (path === 'rate_limits') {
        return { doc: () => ({ get: async () => { throw new Error('firestore down'); } }) };
      }
      return realImpl(path);
    });
    try {
      const res = await request(app).post('/kortex/events').set(...UA).send({ type: 'link_clicked' });
      expect(res.status).not.toBe(503);
    } finally {
      collection.mockImplementation(realImpl);
    }
  });
});
