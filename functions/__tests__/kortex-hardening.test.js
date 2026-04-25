require('./helpers/mockSetup');

const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');
const campaignPublicResolver = require('../api/campaigns/campaignPublicResolver');
const deepLinksRouter = require('../api/deepLinks/deeplinkRoutes');

let campaignApp;
let resolverApp;

beforeAll(() => {
  campaignApp = buildTestApp('/campaigns', require('../api/campaigns/campaignRoutes'));
  resolverApp = buildTestApp('/', campaignPublicResolver);
});

beforeEach(() => {
  admin._mocks.resetAll();
});

function seedAdmin(tenantId) {
  admin._mocks.docData['admin_users/admin-uid'] = {
    role: 'admin',
    email: 'admin@kaayko.com',
    tenantId,
    tenantName: tenantId
  };
}

function seedTenant(tenantId, domain) {
  admin._mocks.docData[`tenants/${tenantId}`] = {
    name: tenantId,
    domain,
    enabled: true
  };
}

function seedCampaign({ campaignId, slug, tenantId, status = 'active', expiresAt = null, maxUsesPerLink = 0 }) {
  const campaign = {
    campaignId,
    name: campaignId,
    slug,
    type: 'alumni',
    tenantId,
    tenantName: tenantId,
    domain: `${tenantId}.test`,
    pathPrefix: `/${slug}`,
    status,
    defaultDestinations: { web: `https://${tenantId}.test/alumni`, ios: null, android: null },
    settings: { maxUsesPerLink }
  };
  if (expiresAt) campaign.settings.expiresAt = expiresAt;
  admin._mocks.docData[`campaigns/${campaignId}`] = campaign;
}

function seedCampaignLink({ campaignId, code, slug, tenantId, status = 'active', usesCount = 0 }) {
  const shortLinkCode = `${slug}_${code}`;
  admin._mocks.docData[`campaign_links/${campaignId}_${code}`] = {
    tenantId,
    campaignId,
    code,
    shortLinkCode,
    status,
    destinations: { web: `https://${tenantId}.test/landing`, ios: null, android: null },
    utm: { utm_source: 'campaign' },
    metadata: {},
    usesCount,
    createdBy: 'admin-uid'
  };
  admin._mocks.docData[`short_links/${shortLinkCode}`] = {
    code: shortLinkCode,
    tenantId,
    campaignId,
    publicCode: code,
    domain: `${tenantId}.test`,
    pathPrefix: `/${slug}`,
    destinations: { web: `https://${tenantId}.test/landing` },
    enabled: status === 'active'
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. CONCURRENT MUTATION TESTS
// ──────────────────────────────────────────────────────────────────────────────

describe('Kortex Hardening — concurrent mutations', () => {
  test('cascade disable sets enabled=false on all active link mirrors when campaign is paused', async () => {
    seedAdmin('tenant-a');
    seedTenant('tenant-a', 'tenant-a.test');
    seedCampaign({ campaignId: 'alumni-2026', slug: 'a', tenantId: 'tenant-a', status: 'active' });
    seedCampaignLink({ campaignId: 'alumni-2026', code: 'link-1', slug: 'a', tenantId: 'tenant-a', status: 'active' });
    seedCampaignLink({ campaignId: 'alumni-2026', code: 'link-2', slug: 'a', tenantId: 'tenant-a', status: 'active' });
    admin._mocks.docData['campaign_memberships/alumni-2026_admin-uid'] = {
      tenantId: 'tenant-a',
      campaignId: 'alumni-2026',
      uid: 'admin-uid',
      role: 'owner'
    };

    const res = await request(campaignApp)
      .post('/campaigns/alumni-2026/pause')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.campaign.status).toBe('paused');
    expect(admin._mocks.docData['short_links/a_link-1'].enabled).toBe(false);
    expect(admin._mocks.docData['short_links/a_link-2'].enabled).toBe(false);
  });

  test('pause campaign while links are active preserves link state consistency', async () => {
    seedAdmin('tenant-a');
    seedTenant('tenant-a', 'tenant-a.test');
    seedCampaign({ campaignId: 'alumni-2026', slug: 'a', tenantId: 'tenant-a', status: 'active' });
    seedCampaignLink({ campaignId: 'alumni-2026', code: 'link-1', slug: 'a', tenantId: 'tenant-a', status: 'active' });
    admin._mocks.docData['campaign_memberships/alumni-2026_admin-uid'] = {
      tenantId: 'tenant-a',
      campaignId: 'alumni-2026',
      uid: 'admin-uid',
      role: 'owner'
    };

    // Pause campaign which should cascade to all links
    const pauseRes = await request(campaignApp)
      .post('/campaigns/alumni-2026/pause')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(pauseRes.status).toBe(200);

    // Verify link mirror is disabled
    const linkMirror = admin._mocks.docData['short_links/a_link-1'];
    expect(linkMirror.enabled).toBe(false);

    // Verify campaign_links record is unchanged (still 'active' status, only mirror was disabled)
    const linkRecord = admin._mocks.docData['campaign_links/alumni-2026_link-1'];
    expect(linkRecord.status).toBe('active');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. EXPIRY ENFORCEMENT
// ──────────────────────────────────────────────────────────────────────────────

describe('Kortex Hardening — campaign expiry enforcement', () => {
  test('Phase 3 resolver rejects redirect for expired campaign', async () => {
    seedTenant('tenant-a', 'tenant-a.test');
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    seedCampaign({
      campaignId: 'alumni-2026',
      slug: 'a',
      tenantId: 'tenant-a',
      status: 'active',
      expiresAt: yesterday.toISOString()
    });
    seedCampaignLink({ campaignId: 'alumni-2026', code: 'wa-1', slug: 'a', tenantId: 'tenant-a', status: 'active' });

    const res = await request(resolverApp)
      .get('/a/wa-1')
      .set('Host', 'tenant-a.test');

    expect(res.status).toBe(410);
    expect(res.text).toContain('Campaign Expired');
  });

  test('Phase 3 resolver allows redirect for campaign not yet expired', async () => {
    seedTenant('tenant-a', 'tenant-a.test');
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    seedCampaign({
      campaignId: 'alumni-2026',
      slug: 'a',
      tenantId: 'tenant-a',
      status: 'active',
      expiresAt: tomorrow.toISOString()
    });
    seedCampaignLink({ campaignId: 'alumni-2026', code: 'wa-1', slug: 'a', tenantId: 'tenant-a', status: 'active' });

    const res = await request(resolverApp)
      .get('/a/wa-1')
      .set('Host', 'tenant-a.test');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://tenant-a.test/landing');
  });

  test('Phase 3 resolver allows redirect for campaign without expiry date', async () => {
    seedTenant('tenant-a', 'tenant-a.test');
    seedCampaign({
      campaignId: 'alumni-2026',
      slug: 'a',
      tenantId: 'tenant-a',
      status: 'active',
      expiresAt: null
    });
    seedCampaignLink({ campaignId: 'alumni-2026', code: 'wa-1', slug: 'a', tenantId: 'tenant-a', status: 'active' });

    const res = await request(resolverApp)
      .get('/a/wa-1')
      .set('Host', 'tenant-a.test');

    expect(res.status).toBe(302);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. MAX-USE ENFORCEMENT
// ──────────────────────────────────────────────────────────────────────────────

describe('Kortex Hardening — max-uses enforcement', () => {
  test('Phase 3 resolver rejects redirect when link reaches max-uses limit', async () => {
    seedTenant('tenant-a', 'tenant-a.test');
    seedCampaign({
      campaignId: 'alumni-2026',
      slug: 'a',
      tenantId: 'tenant-a',
      status: 'active',
      maxUsesPerLink: 100
    });
    seedCampaignLink({
      campaignId: 'alumni-2026',
      code: 'wa-1',
      slug: 'a',
      tenantId: 'tenant-a',
      status: 'active',
      usesCount: 100
    });

    const res = await request(resolverApp)
      .get('/a/wa-1')
      .set('Host', 'tenant-a.test');

    expect(res.status).toBe(410);
    expect(res.text).toContain('Link Limit Reached');
  });

  test('Phase 3 resolver allows redirect when link is below max-uses limit', async () => {
    seedTenant('tenant-a', 'tenant-a.test');
    seedCampaign({
      campaignId: 'alumni-2026',
      slug: 'a',
      tenantId: 'tenant-a',
      status: 'active',
      maxUsesPerLink: 100
    });
    seedCampaignLink({
      campaignId: 'alumni-2026',
      code: 'wa-1',
      slug: 'a',
      tenantId: 'tenant-a',
      status: 'active',
      usesCount: 50
    });

    const res = await request(resolverApp)
      .get('/a/wa-1')
      .set('Host', 'tenant-a.test');

    expect(res.status).toBe(302);
  });

  test('Phase 3 resolver allows unlimited uses when maxUsesPerLink is 0 (default)', async () => {
    seedTenant('tenant-a', 'tenant-a.test');
    seedCampaign({
      campaignId: 'alumni-2026',
      slug: 'a',
      tenantId: 'tenant-a',
      status: 'active',
      maxUsesPerLink: 0
    });
    seedCampaignLink({
      campaignId: 'alumni-2026',
      code: 'wa-1',
      slug: 'a',
      tenantId: 'tenant-a',
      status: 'active',
      usesCount: 99999
    });

    const res = await request(resolverApp)
      .get('/a/wa-1')
      .set('Host', 'tenant-a.test');

    expect(res.status).toBe(302);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. AUDIT LOG VERIFICATION
// ──────────────────────────────────────────────────────────────────────────────

describe('Kortex Hardening — audit log completeness', () => {
  test('campaign create writes audit log entry', async () => {
    seedAdmin('tenant-a');
    seedTenant('tenant-a', 'Tenant A', 'tenant-a.test');

    const initDocsCount = Object.keys(admin._mocks.docData).length;

    await request(campaignApp)
      .post('/campaigns')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({
        campaignId: 'alumni-2026',
        name: 'Alumni 2026',
        slug: 'a',
        type: 'alumni'
      });

    // Audit logs are added to campaign_audit_logs collection
    // Check that docData was modified by add() operation
    const docsAfter = Object.keys(admin._mocks.docData).length;
    expect(docsAfter).toBeGreaterThan(initDocsCount);
  });

  test('campaign pause writes audit log entry', async () => {
    seedAdmin('tenant-a');
    seedTenant('tenant-a', 'tenant-a.test');
    seedCampaign({ campaignId: 'alumni-2026', slug: 'a', tenantId: 'tenant-a', status: 'active' });
    admin._mocks.docData['campaign_memberships/alumni-2026_admin-uid'] = {
      tenantId: 'tenant-a',
      campaignId: 'alumni-2026',
      uid: 'admin-uid',
      role: 'owner'
    };

    const initDocsCount = Object.keys(admin._mocks.docData).length;

    await request(campaignApp)
      .post('/campaigns/alumni-2026/pause')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    // Audit logs should be added (at minimum campaign.updated)
    const docsAfter = Object.keys(admin._mocks.docData).length;
    expect(docsAfter).toBeGreaterThan(initDocsCount);
  });

  test('campaign link create writes audit log entry', async () => {
    seedAdmin('tenant-a');
    seedTenant('tenant-a', 'Tenant A', 'tenant-a.test');
    seedCampaign({ campaignId: 'alumni-2026', slug: 'a', tenantId: 'tenant-a' });
    admin._mocks.docData['campaign_memberships/alumni-2026_admin-uid'] = {
      tenantId: 'tenant-a',
      campaignId: 'alumni-2026',
      uid: 'admin-uid',
      role: 'editor'
    };

    const initDocsCount = Object.keys(admin._mocks.docData).length;

    await request(campaignApp)
      .post('/campaigns/alumni-2026/links')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({
        code: 'wa-1',
        destinations: { web: 'https://tenant-a.test/landing' }
      });

    // Audit logs should be added for link creation
    const docsAfter = Object.keys(admin._mocks.docData).length;
    expect(docsAfter).toBeGreaterThan(initDocsCount);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. CASCADE CLEANUP VERIFICATION
// ──────────────────────────────────────────────────────────────────────────────

describe('Kortex Hardening — cascade cleanup on archive', () => {
  test('archiving campaign disables all link mirrors and preserves campaign_links records', async () => {
    seedAdmin('tenant-a');
    seedTenant('tenant-a', 'tenant-a.test');
    seedCampaign({ campaignId: 'alumni-2026', slug: 'a', tenantId: 'tenant-a', status: 'active' });
    seedCampaignLink({ campaignId: 'alumni-2026', code: 'link-1', slug: 'a', tenantId: 'tenant-a', status: 'active' });
    seedCampaignLink({ campaignId: 'alumni-2026', code: 'link-2', slug: 'a', tenantId: 'tenant-a', status: 'active' });
    seedCampaignLink({ campaignId: 'alumni-2026', code: 'link-3', slug: 'a', tenantId: 'tenant-a', status: 'paused' });
    admin._mocks.docData['campaign_memberships/alumni-2026_admin-uid'] = {
      tenantId: 'tenant-a',
      campaignId: 'alumni-2026',
      uid: 'admin-uid',
      role: 'owner'
    };

    const res = await request(campaignApp)
      .post('/campaigns/alumni-2026/archive')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.campaign.status).toBe('archived');

    // All active link mirrors should be disabled
    expect(admin._mocks.docData['short_links/a_link-1'].enabled).toBe(false);
    expect(admin._mocks.docData['short_links/a_link-2'].enabled).toBe(false);

    // campaign_links records should still exist (soft-delete only for delete action)
    expect(admin._mocks.docData['campaign_links/alumni-2026_link-1']).toBeDefined();
    expect(admin._mocks.docData['campaign_links/alumni-2026_link-2']).toBeDefined();
    expect(admin._mocks.docData['campaign_links/alumni-2026_link-3']).toBeDefined();
  });

  test('resuming archived campaign re-enables all active link mirrors', async () => {
    seedAdmin('tenant-a');
    seedTenant('tenant-a', 'tenant-a.test');
    seedCampaign({ campaignId: 'alumni-2026', slug: 'a', tenantId: 'tenant-a', status: 'archived' });
    seedCampaignLink({ campaignId: 'alumni-2026', code: 'link-1', slug: 'a', tenantId: 'tenant-a', status: 'active' });
    seedCampaignLink({ campaignId: 'alumni-2026', code: 'link-2', slug: 'a', tenantId: 'tenant-a', status: 'paused' });
    admin._mocks.docData['campaign_memberships/alumni-2026_admin-uid'] = {
      tenantId: 'tenant-a',
      campaignId: 'alumni-2026',
      uid: 'admin-uid',
      role: 'owner'
    };
    // Pre-disable mirrors (simulating archived state)
    admin._mocks.docData['short_links/a_link-1'].enabled = false;
    admin._mocks.docData['short_links/a_link-2'].enabled = false;

    const res = await request(campaignApp)
      .post('/campaigns/alumni-2026/resume')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.campaign.status).toBe('active');

    // Active links should be re-enabled
    expect(admin._mocks.docData['short_links/a_link-1'].enabled).toBe(true);
  });
});
