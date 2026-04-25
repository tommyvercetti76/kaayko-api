require('./helpers/mockSetup');

const express = require('express');
const request = require('supertest');
const admin = require('firebase-admin');

const campaignPublicResolver = require('../api/campaigns/campaignPublicResolver');
const deepLinksRouter = require('../api/deepLinks/deeplinkRoutes');

let app;

beforeAll(() => {
  app = express();
  app.use(express.json());

  // Mount order mirrors functions/index.js for these public routes.
  app.use('/', campaignPublicResolver);
  app.use('/', deepLinksRouter);
});

beforeEach(() => {
  admin._mocks.resetAll();
});

function seedTenant(tenantId, domain) {
  admin._mocks.docData[`tenants/${tenantId}`] = {
    name: tenantId,
    domain,
    enabled: true
  };
}

function seedCampaign({ campaignId, slug, tenantId, domain, status = 'active' }) {
  admin._mocks.docData[`campaigns/${campaignId}`] = {
    campaignId,
    name: campaignId,
    slug,
    type: 'alumni',
    tenantId,
    tenantName: tenantId,
    domain,
    pathPrefix: `/${slug}`,
    status,
    defaultDestinations: { web: `https://${domain}/alumni`, ios: null, android: null }
  };
}

function seedCampaignLink({ campaignId, code, slug, tenantId, status = 'active' }) {
  const shortLinkCode = `${slug}_${code}`;
  admin._mocks.docData[`campaign_links/${campaignId}_${code}`] = {
    tenantId,
    campaignId,
    code,
    shortLinkCode,
    status,
    destinations: { web: `https://${tenantId}.test/landing`, ios: null, android: null },
    utm: { utm_source: 'campaign' },
    metadata: {}
  };
  admin._mocks.docData[`short_links/${shortLinkCode}`] = {
    code: shortLinkCode,
    tenantId,
    campaignId,
    publicCode: code,
    domain: `${tenantId}.test`,
    pathPrefix: `/${slug}`,
    destinations: { web: `https://${tenantId}.test/landing`, ios: null, android: null },
    enabled: status === 'active'
  };
}

describe('Kortex Campaign Resolver — public namespace routing', () => {
  test('GET /:campaignSlug/:code resolves and redirects for active campaign link', async () => {
    seedTenant('tenant-a', 'tenant-a.test');
    seedCampaign({ campaignId: 'alumni-2026', slug: 'a', tenantId: 'tenant-a', domain: 'tenant-a.test', status: 'active' });
    seedCampaignLink({ campaignId: 'alumni-2026', code: 'wa-group-1', slug: 'a', tenantId: 'tenant-a', status: 'active' });

    const res = await request(app)
      .get('/a/wa-group-1')
      .set('Host', 'tenant-a.test');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://tenant-a.test/landing');
  });

  test('GET /:campaignSlug/:code returns 404 for unknown domain', async () => {
    const res = await request(app)
      .get('/a/wa-group-1')
      .set('Host', 'unknown-domain.test');

    expect(res.status).toBe(404);
    expect(res.text).toContain('Campaign Not Found');
  });

  test('GET /:campaignSlug/:code returns 404 for unknown campaign slug', async () => {
    seedTenant('tenant-a', 'tenant-a.test');

    const res = await request(app)
      .get('/a/wa-group-1')
      .set('Host', 'tenant-a.test');

    expect(res.status).toBe(404);
    expect(res.text).toContain('Campaign Not Found');
  });

  test('GET /:campaignSlug/:code returns 410 for paused campaign', async () => {
    seedTenant('tenant-a', 'tenant-a.test');
    seedCampaign({ campaignId: 'alumni-2026', slug: 'a', tenantId: 'tenant-a', domain: 'tenant-a.test', status: 'paused' });

    const res = await request(app)
      .get('/a/wa-group-1')
      .set('Host', 'tenant-a.test');

    expect(res.status).toBe(410);
    expect(res.text).toContain('Campaign Unavailable');
  });

  test('GET /:campaignSlug/:code returns 410 for paused link', async () => {
    seedTenant('tenant-a', 'tenant-a.test');
    seedCampaign({ campaignId: 'alumni-2026', slug: 'a', tenantId: 'tenant-a', domain: 'tenant-a.test', status: 'active' });
    seedCampaignLink({ campaignId: 'alumni-2026', code: 'wa-group-1', slug: 'a', tenantId: 'tenant-a', status: 'paused' });

    const res = await request(app)
      .get('/a/wa-group-1')
      .set('Host', 'tenant-a.test');

    expect(res.status).toBe(410);
    expect(res.text).toContain('Link Unavailable');
  });

  test('host-aware isolation: same slug on another tenant does not resolve', async () => {
    seedTenant('tenant-a', 'tenant-a.test');
    seedTenant('tenant-b', 'tenant-b.test');

    seedCampaign({ campaignId: 'a-tenant-campaign', slug: 'a', tenantId: 'tenant-a', domain: 'tenant-a.test', status: 'active' });
    seedCampaign({ campaignId: 'b-tenant-campaign', slug: 'a', tenantId: 'tenant-b', domain: 'tenant-b.test', status: 'active' });
    seedCampaignLink({ campaignId: 'b-tenant-campaign', code: 'shared-code', slug: 'a', tenantId: 'tenant-b', status: 'active' });

    const res = await request(app)
      .get('/a/shared-code')
      .set('Host', 'tenant-a.test');

    expect(res.status).toBe(404);
    expect(res.text).toContain('Link Not Found');
  });

  test('reserved slug bypass: /l/:id still resolves via legacy deepLinks router', async () => {
    admin._mocks.docData['short_links/lklegacy1'] = {
      code: 'lklegacy1',
      title: 'Legacy link',
      destinations: { web: 'https://example.com/legacy' },
      enabled: true,
      tenantId: 'kaayko-default'
    };

    const res = await request(app)
      .get('/l/lklegacy1')
      .set('Host', 'kaayko.com');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://example.com/legacy');
  });
});
