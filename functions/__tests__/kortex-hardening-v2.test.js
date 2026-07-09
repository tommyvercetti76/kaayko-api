/**
 * Kortex hardening v2 — regression tests for the security/product hardening pass.
 *
 * Covers: plan-quota enforcement, service-layer domain policy, API-key + webhook
 * provisioning routes, the webhook SSRF guard, V2 event tenant-derivation, and the
 * fail-closed HMAC signing secret. This suite is the required CI gate.
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

let app;
beforeAll(() => {
  app = buildTestApp('/smartlinks', require('../api/kortex/smartLinks'));
});
beforeEach(() => {
  admin._mocks.resetAll();
});

const ADMIN_A = () => {
  admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'admin@kaayko.com', tenantId: 'tenant-a' };
  admin._mocks.docData['tenants/tenant-a'] = { name: 'Tenant A', domain: 'kaayko.com', pathPrefix: '/l', enabled: true };
};
const AUTH = ['Authorization', 'Bearer VALID_ADMIN_TOKEN'];

describe('Plan quota enforcement', () => {
  test('rejects link creation when the tenant is at its plan link limit', async () => {
    ADMIN_A(); // starter plan → 25 links
    for (let i = 0; i < 25; i++) {
      admin._mocks.docData[`short_links/qa-${i}`] = { code: `qa-${i}`, tenantId: 'tenant-a', enabled: true };
    }

    const res = await request(app).post('/smartlinks').set(...AUTH).send({
      webDestination: 'https://kaayko.com/store', title: 'One too many'
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLAN_LIMIT_EXCEEDED');
  });

  test('allows creation below the plan limit', async () => {
    ADMIN_A();
    admin._mocks.docData['short_links/qa-0'] = { code: 'qa-0', tenantId: 'tenant-a', enabled: true };

    const res = await request(app).post('/smartlinks').set(...AUTH).send({
      webDestination: 'https://kaayko.com/store', title: 'Fine'
    });

    expect(res.status).not.toBe(403);
  });
});

describe('Service-layer domain policy', () => {
  test('default Kaayko tenant rejects non-whitelisted destinations', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'a@kaayko.com', tenantId: 'kaayko-default' };

    const res = await request(app).post('/smartlinks').set(...AUTH).send({
      webDestination: 'https://evil.example.com/x', title: 'Bad'
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DOMAIN_NOT_WHITELISTED');
  });

  test('default Kaayko tenant allows whitelisted destinations', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'a@kaayko.com', tenantId: 'kaayko-default' };

    const res = await request(app).post('/smartlinks').set(...AUTH).send({
      webDestination: 'https://kaayko.com/store', title: 'Good'
    });

    expect(res.status).not.toBe(403);
  });

  test('tenant with allowedDomains rejects destinations outside the list', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'a@kaayko.com', tenantId: 'tenant-a' };
    admin._mocks.docData['tenants/tenant-a'] = {
      name: 'Tenant A', domain: 'kaayko.com', pathPrefix: '/l', enabled: true,
      settings: { allowedDomains: ['tenant-a.test'] }
    };

    const res = await request(app).post('/smartlinks').set(...AUTH).send({
      webDestination: 'https://not-allowed.test/x', title: 'Nope'
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DOMAIN_NOT_ALLOWED');
  });

  test('tenant without allowedDomains is default-open to its own destinations', async () => {
    ADMIN_A();
    const res = await request(app).post('/smartlinks').set(...AUTH).send({
      webDestination: 'https://tenant-a.test/content', title: 'Own domain'
    });
    expect(res.status).not.toBe(403);
  });
});

describe('API-key provisioning', () => {
  test('creates an API key and returns the plaintext once', async () => {
    ADMIN_A();
    const res = await request(app).post('/smartlinks/api-keys').set(...AUTH)
      .send({ name: 'CI Key', scopes: ['read:links'] });

    expect(res.status).toBe(201);
    expect(res.body.apiKey).toMatch(/^ak_/);
    expect(res.body.keyId).toBeDefined();
  });

  test('rejects unknown scopes', async () => {
    ADMIN_A();
    const res = await request(app).post('/smartlinks/api-keys').set(...AUTH)
      .send({ name: 'CI Key', scopes: ['drop:database'] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_SCOPE');
  });

  test('non-super-admin cannot grant wildcard scope', async () => {
    ADMIN_A();
    const res = await request(app).post('/smartlinks/api-keys').set(...AUTH)
      .send({ name: 'CI Key', scopes: ['*'] });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SCOPE_NOT_ALLOWED');
  });

  test('requires auth', async () => {
    const res = await request(app).post('/smartlinks/api-keys').send({ name: 'x' });
    expect(res.status).toBe(401);
  });

  test('lists only the tenant’s keys', async () => {
    ADMIN_A();
    admin._mocks.docData['api_keys/k1'] = { tenantId: 'tenant-a', name: 'A key', scopes: ['read:links'], secretHash: 'h' };
    const res = await request(app).get('/smartlinks/api-keys').set(...AUTH);
    expect(res.status).toBe(200);
    expect(res.body.keys.length).toBe(1);
    expect(res.body.keys[0].secretHash).toBeUndefined();
  });

  test('cannot revoke another tenant’s key', async () => {
    ADMIN_A();
    admin._mocks.docData['api_keys/kb'] = { tenantId: 'tenant-b', name: 'B key', scopes: ['*'], secretHash: 'h' };
    const res = await request(app).delete('/smartlinks/api-keys/kb').set(...AUTH);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_ACCESS_DENIED');
  });
});

describe('Webhook provisioning + SSRF guard', () => {
  test('creates a webhook and returns the signing secret once', async () => {
    ADMIN_A();
    const res = await request(app).post('/smartlinks/webhooks').set(...AUTH)
      .send({ targetUrl: 'https://hooks.example.com/kortex', events: ['link.created'] });

    expect(res.status).toBe(201);
    expect(res.body.secret).toMatch(/^whsec_/);
  });

  test('rejects non-https targets', async () => {
    ADMIN_A();
    const res = await request(app).post('/smartlinks/webhooks').set(...AUTH)
      .send({ targetUrl: 'http://hooks.example.com/x', events: ['link.created'] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INSECURE_WEBHOOK_URL');
  });

  test('rejects private/metadata targets (SSRF)', async () => {
    ADMIN_A();
    const res = await request(app).post('/smartlinks/webhooks').set(...AUTH)
      .send({ targetUrl: 'https://169.254.169.254/computeMetadata/v1/', events: ['link.created'] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BLOCKED_WEBHOOK_URL');
  });

  test('rejects unknown event types', async () => {
    ADMIN_A();
    const res = await request(app).post('/smartlinks/webhooks').set(...AUTH)
      .send({ targetUrl: 'https://hooks.example.com/x', events: ['not.an.event'] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_EVENTS');
  });
});

describe('SSRF guard (unit)', () => {
  const { assertSafeWebhookUrl } = require('../api/kortex/ssrfGuard');
  test('accepts a public https URL', () => {
    expect(() => assertSafeWebhookUrl('https://example.com/hook')).not.toThrow();
  });
  test.each([
    ['http://example.com', 'INSECURE_WEBHOOK_URL'],
    ['https://localhost/x', 'BLOCKED_WEBHOOK_URL'],
    ['https://127.0.0.1/x', 'BLOCKED_WEBHOOK_URL'],
    ['https://10.0.0.5/x', 'BLOCKED_WEBHOOK_URL'],
    ['https://169.254.169.254/x', 'BLOCKED_WEBHOOK_URL'],
    ['https://192.168.1.1/x', 'BLOCKED_WEBHOOK_URL'],
    ['not-a-url', 'INVALID_WEBHOOK_URL'],
  ])('rejects %s', (url, code) => {
    try {
      assertSafeWebhookUrl(url);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.code).toBe(code);
    }
  });
});

describe('V2 event tenant-derivation (anti-poisoning)', () => {
  const KortexV2 = require('../api/kortex/v2LinkIntents');
  test('derives tenantId from the stored link, ignoring a spoofed body tenantId', async () => {
    admin._mocks.docData['short_links/lkreal'] = { code: 'lkreal', tenantId: 'tenant-z', enabled: true };
    const event = await KortexV2.recordEvent('registration_submitted', {
      linkCode: 'lkreal', tenantId: 'attacker-tenant'
    });
    expect(event.tenantId).toBe('tenant-z');
  });
});

describe('HMAC signing', () => {
  const sec = require('../api/kortex/linkSecurityService');

  test('an absent signature is not enforced (returns null)', () => {
    expect(sec.verifySignature('lkx', 'tenant-a', undefined)).toBeNull();
  });

  test('verification is fail-closed when unconfigured, and length-safe when configured', () => {
    const sig = sec.signCode('lkx', 'tenant-a');
    if (sig == null) {
      // No configured secret → never accept a caller-supplied signature as proof.
      expect(sec.verifySignature('lkx', 'tenant-a', 'anything')).toBeNull();
    } else {
      expect(sec.verifySignature('lkx', 'tenant-a', sig)).toBe(true);
      // Wrong same-length signature → false via timingSafeEqual (no throw).
      const wrongSameLen = 'a'.repeat(sig.length);
      expect(sec.verifySignature('lkx', 'tenant-a', wrongSameLen)).toBe(false);
      // Wrong different-length signature → guarded false (no timingSafeEqual throw).
      expect(sec.verifySignature('lkx', 'tenant-a', sig + 'xx')).toBe(false);
    }
  });
});
