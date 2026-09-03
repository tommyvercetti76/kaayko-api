/**
 * Kortex destination safety — the assessment engine and its wiring into every
 * creation path (admin route, campaign links) plus the input allowlist.
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
const safety = require('../api/kortex/destinationSafety');
const { PROTECTED_FIELDS, pickCreateInput, pickUpdateInput } = require('../api/kortex/validation/linkInput');

const AUTH = ['Authorization', 'Bearer VALID_ADMIN_TOKEN'];
const SUPER = ['Authorization', 'Bearer VALID_SUPER_ADMIN_TOKEN'];
const DAY = 24 * 60 * 60 * 1000;

let app;
let campaignApp;
beforeAll(() => {
  app = buildTestApp('/kortex', require('../api/kortex/smartLinks'));
  campaignApp = buildTestApp('/campaigns', require('../api/campaigns/campaignRoutes'));
});

beforeEach(() => {
  admin._mocks.resetAll();
  safety.resetCaches();
  delete process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  delete process.env.KORTEX_SAFETY_FAIL_CLOSED;
});

const establishedTenant = () => {
  admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'admin@kaayko.com', tenantId: 'tenant-a' };
  admin._mocks.docData['tenants/tenant-a'] = { name: 'Tenant A', domain: 'kaayko.com', pathPrefix: '/l', enabled: true, plan: 'starter', createdAtMs: Date.now() - 3 * DAY };
};
const newTenant = () => {
  admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'admin@kaayko.com', tenantId: 'tenant-new' };
  admin._mocks.docData['tenants/tenant-new'] = {
    name: 'Fresh Signup', domain: 'kaayko.com', pathPrefix: '/l', enabled: true, plan: 'starter',
    createdAtMs: Date.now() - 60 * 60 * 1000, trustedDomains: ['acme-events.com']
  };
};

describe('URL shape and private hosts', () => {
  test('rejects non-http schemes and embedded credentials', () => {
    expect(safety.parseDestination('javascript:alert(1)').code).toBe('INVALID_SCHEME');
    expect(safety.parseDestination('ftp://files.example/x').code).toBe('INVALID_SCHEME');
    expect(safety.parseDestination('https://user:pw@example.com/').code).toBe('CREDENTIALS_IN_URL');
    expect(safety.parseDestination('not a url').code).toBe('INVALID_URL');
    expect(safety.parseDestination('https://example.com/path?x=1').ok).toBe(true);
  });

  test('flags loopback, private, link-local, metadata and bare hosts as internal', () => {
    for (const host of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.9.9', '169.254.169.254', '100.64.0.1', 'localhost', '[::1]', 'metadata.google.internal', 'intranet', 'printer.local']) {
      expect(safety.isInternalHost(host)).toBe(true);
    }
    expect(safety.isInternalHost('8.8.8.8')).toBe(false);
    expect(safety.isInternalHost('example.com')).toBe(false);
  });

  test('derives the registrable domain with multi-part suffixes and platform hosts', () => {
    expect(safety.getRegistrableDomain('tickets.school.ac.in')).toBe('school.ac.in');
    expect(safety.getRegistrableDomain('www.example.com')).toBe('example.com');
    expect(safety.getRegistrableDomain('alice.github.io')).toBe('alice.github.io');
    expect(safety.getRegistrableDomain('shop.example.co.uk')).toBe('example.co.uk');
  });
});

describe('assessDestination verdicts', () => {
  test('blocks private-network destinations', async () => {
    const result = await safety.assessDestination('http://169.254.169.254/latest/meta-data', { tenantId: 'tenant-a', purpose: 'create' });
    expect(result.verdict).toBe('block');
    expect(result.reasons[0].code).toBe('PRIVATE_NETWORK');
  });

  test('blocks hosts on the manual blocklist, including sub-domains', async () => {
    admin._mocks.docData['kortex_blocked_hosts/evil.example'] = { host: 'evil.example', active: true };
    const apex = await safety.assessDestination('https://evil.example/login', { tenantId: 'tenant-a', purpose: 'create' });
    const sub = await safety.assessDestination('https://pay.evil.example/login', { tenantId: 'tenant-a', purpose: 'create' });
    expect(apex.verdict).toBe('block');
    expect(sub.verdict).toBe('block');
    expect(sub.reasons[0].code).toBe('BLOCKLISTED_HOST');
  });

  test('blocks hosts from the threat-feed snapshot in Storage', async () => {
    admin._mocks.storageFiles()[safety.FEED_OBJECT_PATH] = '# feed\nphishy.example\nmalware.example\n';
    const result = await safety.assessDestination('https://phishy.example/x', { tenantId: 'tenant-a', purpose: 'create' });
    expect(result.verdict).toBe('block');
    expect(result.checks.blocklist).toBe('hit');
  });

  test('blocks on a Safe Browsing match when a key is configured', async () => {
    process.env.GOOGLE_SAFE_BROWSING_API_KEY = 'test-key';
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ matches: [{ threat: { url: 'https://phish.example/login' }, threatType: 'SOCIAL_ENGINEERING' }] })
    }));
    const hit = await safety.assessDestination('https://phish.example/login', { tenantId: 'tenant-a', purpose: 'create', fetchImpl });
    expect(hit.verdict).toBe('block');
    expect(hit.reasons[0].code).toBe('SAFE_BROWSING');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const clean = await safety.assessDestination('https://kaayko.com/store', { tenantId: 'tenant-a', purpose: 'create', fetchImpl });
    expect(clean.verdict).toBe('allow');
    expect(clean.checks.safeBrowsing).toBe('ok');
  });

  test('a Safe Browsing outage allows by default and holds when fail-closed', async () => {
    process.env.GOOGLE_SAFE_BROWSING_API_KEY = 'test-key';
    const fetchImpl = jest.fn(async () => { throw new Error('ECONNRESET'); });

    const open = await safety.assessDestination('https://kaayko.com/store', { tenantId: 'tenant-a', purpose: 'create', fetchImpl });
    expect(open.verdict).toBe('allow');
    expect(open.checks.safeBrowsing).toBe('error');

    process.env.KORTEX_SAFETY_FAIL_CLOSED = 'true';
    safety.resetCaches();
    const closed = await safety.assessDestination('https://kaayko.com/store', { tenantId: 'tenant-a', purpose: 'create', fetchImpl });
    expect(closed.verdict).toBe('hold');
    expect(closed.reasons.map(r => r.code)).toContain('SAFETY_CHECK_UNAVAILABLE');
  });

  test('skips Safe Browsing entirely without a key', async () => {
    const fetchImpl = jest.fn();
    const result = await safety.assessDestination('https://kaayko.com/store', { tenantId: 'tenant-a', purpose: 'create', fetchImpl });
    expect(result.verdict).toBe('allow');
    expect(result.checks.safeBrowsing).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Domain reputation holds', () => {
  const freshTenant = { createdAtMs: Date.now() - 60 * 60 * 1000, trustedDomains: ['acme-events.com'], settings: {} };
  const oldTenant = { createdAtMs: Date.now() - 10 * DAY, settings: {} };

  test('holds a never-seen domain for a tenant younger than the window', async () => {
    const result = await safety.assessDestination('https://brand-new-venue.example/tickets', { tenantId: 'tenant-new', tenant: freshTenant, purpose: 'create' });
    expect(result.verdict).toBe('hold');
    expect(result.reasons[0].code).toBe('UNKNOWN_DOMAIN');
  });

  test('does not hold seed domains, the tenant own domain, established tenants or super-admins', async () => {
    const seed = await safety.assessDestination('https://forms.gle/abc', { tenantId: 'tenant-new', tenant: freshTenant, purpose: 'create' });
    const own = await safety.assessDestination('https://tickets.acme-events.com/fest', { tenantId: 'tenant-new', tenant: freshTenant, purpose: 'create' });
    const established = await safety.assessDestination('https://brand-new-venue.example/tickets', { tenantId: 'tenant-a', tenant: oldTenant, purpose: 'create' });
    const superAdmin = await safety.assessDestination('https://brand-new-venue.example/tickets', { tenantId: 'tenant-new', tenant: freshTenant, purpose: 'create', actorIsSuperAdmin: true });
    const houseTenant = await safety.assessDestination('https://brand-new-venue.example/tickets', { tenantId: 'kaayko-default', tenant: null, purpose: 'create' });
    for (const r of [seed, own, established, superAdmin, houseTenant]) expect(r.verdict).toBe('allow');
  });

  test('a domain learned from an active link is no longer unknown', async () => {
    await safety.markDomainKnown('brand-new-venue.example', { source: 'link', tenantId: 'tenant-a' });
    expect(admin._mocks.docData['kortex_known_domains/brand-new-venue.example']).toBeDefined();
    const result = await safety.assessDestination('https://brand-new-venue.example/tickets', { tenantId: 'tenant-new', tenant: freshTenant, purpose: 'create' });
    expect(result.verdict).toBe('allow');
  });

  test('a tenant that opts in to review holds every unknown domain; opting out never holds', async () => {
    const optIn = { ...oldTenant, settings: { reviewUnknownDomains: true } };
    const optOut = { ...freshTenant, settings: { reviewUnknownDomains: false } };
    expect((await safety.assessDestination('https://another-new.example/', { tenantId: 't', tenant: optIn, purpose: 'create' })).verdict).toBe('hold');
    expect((await safety.assessDestination('https://another-new.example/', { tenantId: 't', tenant: optOut, purpose: 'create' })).verdict).toBe('allow');
  });

  test('raw IP destinations are held, never allowed silently', async () => {
    const result = await safety.assessDestination('http://8.8.8.8/', { tenantId: 'tenant-a', tenant: oldTenant, purpose: 'create' });
    expect(result.verdict).toBe('hold');
    expect(result.reasons[0].code).toBe('IP_LITERAL_DESTINATION');
  });

  test('re-scans only block, they never hold', async () => {
    const result = await safety.assessDestination('https://never-seen.example/', { tenantId: 'tenant-new', tenant: freshTenant, purpose: 'rescan' });
    expect(result.verdict).toBe('allow');
  });
});

describe('Admin create route wiring', () => {
  test('refuses a private-network destination with 422 DESTINATION_BLOCKED', async () => {
    establishedTenant();
    const res = await request(app).post('/kortex').set(...AUTH).send({ webDestination: 'http://10.0.0.5/admin', title: 'Internal' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DESTINATION_BLOCKED');
    expect(res.body.reasons[0].code).toBe('PRIVATE_NETWORK');
  });

  test('refuses an iOS destination on the blocklist even when the web destination is clean', async () => {
    establishedTenant();
    admin._mocks.docData['kortex_blocked_hosts/evil.example'] = { host: 'evil.example' };
    const res = await request(app).post('/kortex').set(...AUTH).send({
      webDestination: 'https://kaayko.com/store', iosDestination: 'https://evil.example/app', title: 'Mixed'
    });
    expect(res.status).toBe(422);
    expect(res.body.reasons[0].platform).toBe('ios');
  });

  test('creates a held link for a new tenant on an unknown domain and records the verdict', async () => {
    newTenant();
    const res = await request(app).post('/kortex').set(...AUTH).send({ webDestination: 'https://brand-new-venue.example/tickets', title: 'Held' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('held');
    expect(res.body.message).toMatch(/held for a quick review/);
    const stored = admin._mocks.docData[`short_links/${res.body.link.code}`];
    expect(stored.status).toBe('held');
    expect(stored.safety.verdict).toBe('hold');
    expect(stored.safety.reasons[0].code).toBe('UNKNOWN_DOMAIN');
  });

  test('a new tenant linking to its own email domain goes live immediately', async () => {
    newTenant();
    const res = await request(app).post('/kortex').set(...AUTH).send({ webDestination: 'https://acme-events.com/fest', title: 'Own domain' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  test('an established tenant learns the domain for everyone else', async () => {
    establishedTenant();
    const res = await request(app).post('/kortex').set(...AUTH).send({ webDestination: 'https://venue-learned.example/x', title: 'Learn' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    await new Promise(r => setTimeout(r, 10));
    expect(admin._mocks.docData['kortex_known_domains/venue-learned.example']).toBeDefined();
  });

  test('editing to a bad destination is refused; editing a held link to a clean one activates it', async () => {
    newTenant();
    admin._mocks.docData['short_links/held1'] = {
      code: 'held1', tenantId: 'tenant-new', status: 'held', enabled: true, title: 'Held',
      destinations: { web: 'https://brand-new-venue.example/tickets', ios: null, android: null }
    };
    const bad = await request(app).put('/kortex/held1').set(...AUTH).send({ destinations: { web: 'http://127.0.0.1/' } });
    expect(bad.status).toBe(422);
    const clean = await request(app).put('/kortex/held1').set(...AUTH).send({ destinations: { web: 'https://acme-events.com/updated' } });
    expect(clean.status).toBe(200);
    expect(clean.body.status).toBe('active');
  });

  test('an operator block survives a destination edit', async () => {
    establishedTenant();
    admin._mocks.docData['short_links/blk1'] = {
      code: 'blk1', tenantId: 'tenant-a', status: 'blocked', blockedBy: 'operator', enabled: true, title: 'Blocked',
      destinations: { web: 'https://kaayko.com/old', ios: null, android: null }
    };
    const res = await request(app).put('/kortex/blk1').set(...AUTH).send({ destinations: { web: 'https://kaayko.com/new' } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('blocked');
  });
});

describe('Input allowlist', () => {
  test('protected fields never reach the service', () => {
    const body = { title: 'x', webDestination: 'https://kaayko.com/' };
    PROTECTED_FIELDS.forEach(f => { body[f] = 'injected'; });
    const picked = pickCreateInput(body);
    PROTECTED_FIELDS.forEach(f => expect(picked[f]).toBeUndefined());
    expect(picked.title).toBe('x');
    expect(pickUpdateInput({ webDestination: 'https://kaayko.com/a', iosDestination: 'https://apps.apple.com/x' }).destinations)
      .toEqual({ web: 'https://kaayko.com/a', ios: 'https://apps.apple.com/x' });
  });

  test('bypassDomainCheck in the body cannot defeat the Kaayko whitelist', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'a@kaayko.com', tenantId: 'kaayko-default' };
    const res = await request(app).post('/kortex').set(...AUTH).send({
      webDestination: 'https://evil.example.com/x', title: 'Bypass', bypassDomainCheck: true, destinationCategory: 'custom'
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DOMAIN_NOT_WHITELISTED');
  });

  test('a client-supplied status is ignored', async () => {
    establishedTenant();
    const res = await request(app).post('/kortex').set(...AUTH).send({ webDestination: 'https://kaayko.com/store', title: 'Status', status: 'blocked', safety: { verdict: 'allow' } });
    expect(res.status).toBe(200);
    expect(admin._mocks.docData[`short_links/${res.body.link.code}`].status).toBe('active');
  });

  test('super-admins may still use the custom destination bypass', async () => {
    admin._mocks.docData['admin_users/super-admin-uid'] = { role: 'super-admin', email: 'super@kaayko.com', tenantId: 'kaayko-default' };
    const res = await request(app).post('/kortex').set(...SUPER).send({
      webDestination: 'https://partner.example/x', title: 'Custom', destinationCategory: 'custom'
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });
});

describe('Campaign links share the safety layer', () => {
  const campaignFixture = () => {
    establishedTenant();
    admin._mocks.docData['campaigns/camp-1'] = {
      campaignId: 'camp-1', tenantId: 'tenant-a', slug: 'fest', status: 'active', domain: 'kaayko.com', ownerUids: ['admin-uid'], settings: {}
    };
  };

  test('refuses a private-network destination on a campaign link', async () => {
    campaignFixture();
    const res = await request(campaignApp).post('/campaigns/camp-1/links').set(...AUTH)
      .send({ code: 'wa1', destinations: { web: 'http://192.168.0.10/x' } });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DESTINATION_BLOCKED');
  });

  test('refuses a javascript: destination that used to be stored verbatim', async () => {
    campaignFixture();
    const res = await request(campaignApp).post('/campaigns/camp-1/links').set(...AUTH)
      .send({ code: 'js1', destinations: { web: 'javascript:alert(1)' } });
    expect(res.status).toBe(422);
  });

  test('a clean campaign link mirrors status active into short_links', async () => {
    campaignFixture();
    const res = await request(campaignApp).post('/campaigns/camp-1/links').set(...AUTH)
      .send({ code: 'ok1', destinations: { web: 'https://kaayko.com/store' } });
    expect(res.status).toBe(201);
    const mirror = admin._mocks.docData['short_links/fest_ok1'];
    expect(mirror.status).toBe('active');
    expect(mirror.safety.verdict).toBe('allow');
  });
});
