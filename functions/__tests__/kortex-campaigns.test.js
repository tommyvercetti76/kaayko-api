require('./helpers/mockSetup');

const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');

let app;
beforeAll(() => {
  app = buildTestApp('/campaigns', require('../api/campaigns/campaignRoutes'));
});

beforeEach(() => {
  admin._mocks.resetAll();
});

describe('Kortex Campaigns — health and auth', () => {
  test('GET /campaigns/health returns healthy status', async () => {
    const res = await request(app).get('/campaigns/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.service).toMatch(/Campaigns/);
  });

  test('POST /campaigns without auth returns 401', async () => {
    const res = await request(app)
      .post('/campaigns')
      .send({ name: 'Alumni 2026', slug: 'a', type: 'alumni' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  test('POST /campaigns rejects non-admin tenant users', async () => {
    admin._mocks.docData['admin_users/user-uid'] = {
      role: 'viewer',
      email: 'viewer@tenant-a.test',
      tenantId: 'tenant-a'
    };

    const res = await request(app)
      .post('/campaigns')
      .set('Authorization', 'Bearer VALID_USER_TOKEN')
      .send({ name: 'Alumni 2026', slug: 'a', type: 'alumni' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});

describe('Kortex Campaigns — tenant-admin management', () => {
  test('POST /campaigns creates a tenant-owned campaign and ignores spoofed tenant fields', async () => {
    seedAdmin('tenant-a');
    seedTenant('tenant-a', 'Tenant A', 'go.tenant-a.test');

    const res = await request(app)
      .post('/campaigns')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({
        campaignId: 'alumni-2026',
        name: 'Alumni 2026',
        slug: 'a',
        type: 'alumni',
        tenantId: 'tenant-b',
        domain: 'evil.test',
        settings: {
          maxUsesPerLink: 50,
          tenantId: 'tenant-b'
        }
      });

    expect(res.status).toBe(201);
    expect(res.body.campaign.tenantId).toBe('tenant-a');
    expect(res.body.campaign.domain).toBe('go.tenant-a.test');
    expect(res.body.campaign.pathPrefix).toBe('/a');
    expect(res.body.campaign.settings.tenantId).toBeUndefined();
    expect(admin._mocks.docData['campaign_memberships/alumni-2026_admin-uid'].role).toBe('owner');
  });

  test('GET /campaigns lists only campaigns for the authenticated tenant', async () => {
    seedAdmin('tenant-a');
    admin._mocks.docData['campaigns/a-campaign'] = {
      campaignId: 'a-campaign',
      name: 'Tenant A Campaign',
      slug: 'a',
      type: 'alumni',
      tenantId: 'tenant-a',
      status: 'active'
    };
    admin._mocks.docData['campaigns/b-campaign'] = {
      campaignId: 'b-campaign',
      name: 'Tenant B Campaign',
      slug: 'b',
      type: 'brand',
      tenantId: 'tenant-b',
      status: 'active'
    };

    const res = await request(app)
      .get('/campaigns')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.tenant.id).toBe('tenant-a');
    expect(res.body.campaigns.map(campaign => campaign.campaignId)).toEqual(['a-campaign']);
  });

  test('GET /campaigns honors assigned tenant header and rejects unassigned tenant header', async () => {
    admin._mocks.docData['admin_users/admin-uid'] = {
      role: 'admin',
      email: 'admin@kaayko.com',
      tenantIds: ['tenant-a', 'tenant-c']
    };
    admin._mocks.docData['campaigns/c-campaign'] = {
      campaignId: 'c-campaign',
      name: 'Tenant C Campaign',
      slug: 'c',
      type: 'campus',
      tenantId: 'tenant-c',
      status: 'active'
    };

    const allowed = await request(app)
      .get('/campaigns')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .set('X-Kaayko-Tenant-Id', 'tenant-c');

    const denied = await request(app)
      .get('/campaigns')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .set('X-Kaayko-Tenant-Id', 'tenant-b');

    expect(allowed.status).toBe(200);
    expect(allowed.body.campaigns.map(campaign => campaign.campaignId)).toEqual(['c-campaign']);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('TENANT_ACCESS_DENIED');
  });
});

describe('Kortex Campaigns — campaign member permissions', () => {
  test('campaign owner can pause an assigned campaign without tenant admin role', async () => {
    seedViewer('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    admin._mocks.docData['campaign_memberships/alumni-2026_user-uid'] = {
      tenantId: 'tenant-a',
      campaignId: 'alumni-2026',
      uid: 'user-uid',
      role: 'owner'
    };

    const res = await request(app)
      .post('/campaigns/alumni-2026/pause')
      .set('Authorization', 'Bearer VALID_USER_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.campaign.status).toBe('paused');
    expect(admin._mocks.docData['campaigns/alumni-2026'].status).toBe('paused');
  });

  test('campaign viewer can read but cannot update an assigned campaign', async () => {
    seedViewer('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    admin._mocks.docData['campaign_memberships/alumni-2026_user-uid'] = {
      tenantId: 'tenant-a',
      campaignId: 'alumni-2026',
      uid: 'user-uid',
      role: 'viewer'
    };

    const readRes = await request(app)
      .get('/campaigns/alumni-2026')
      .set('Authorization', 'Bearer VALID_USER_TOKEN');

    const updateRes = await request(app)
      .put('/campaigns/alumni-2026')
      .set('Authorization', 'Bearer VALID_USER_TOKEN')
      .send({ name: 'Changed' });

    expect(readRes.status).toBe(200);
    expect(readRes.body.campaign.campaignId).toBe('alumni-2026');
    expect(updateRes.status).toBe(403);
    expect(updateRes.body.code).toBe('INSUFFICIENT_CAMPAIGN_PERMISSIONS');
  });

  test('campaign owner can manage members and writes membership permissions', async () => {
    seedViewer('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    admin._mocks.docData['campaign_memberships/alumni-2026_user-uid'] = {
      tenantId: 'tenant-a',
      campaignId: 'alumni-2026',
      uid: 'user-uid',
      role: 'owner'
    };

    const res = await request(app)
      .post('/campaigns/alumni-2026/members')
      .set('Authorization', 'Bearer VALID_USER_TOKEN')
      .send({ uid: 'editor-uid', role: 'editor' });

    expect(res.status).toBe(200);
    expect(res.body.member.uid).toBe('editor-uid');
    expect(res.body.member.permissions).toContain('links:create');
    expect(admin._mocks.docData['campaign_memberships/alumni-2026_editor-uid'].role).toBe('editor');
  });

  test('cross-tenant campaign access is denied without campaign membership', async () => {
    seedViewer('tenant-a');
    seedCampaign('brand-2026', 'tenant-b', 'active');

    const res = await request(app)
      .get('/campaigns/brand-2026')
      .set('Authorization', 'Bearer VALID_USER_TOKEN');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_ACCESS_DENIED');
  });
});

function seedAdmin(tenantId) {
  admin._mocks.docData['admin_users/admin-uid'] = {
    role: 'admin',
    email: 'admin@kaayko.com',
    tenantId,
    tenantName: tenantId
  };
}

function seedViewer(tenantId) {
  admin._mocks.docData['admin_users/user-uid'] = {
    role: 'viewer',
    email: 'viewer@kaayko.com',
    tenantId,
    tenantName: tenantId
  };
}

function seedTenant(tenantId, name, domain) {
  admin._mocks.docData[`tenants/${tenantId}`] = {
    name,
    domain,
    enabled: true
  };
}

function seedCampaign(campaignId, tenantId, status) {
  admin._mocks.docData[`campaigns/${campaignId}`] = {
    campaignId,
    name: campaignId,
    slug: campaignId.split('-')[0],
    type: 'alumni',
    tenantId,
    tenantName: tenantId,
    domain: `${tenantId}.test`,
    pathPrefix: '/a',
    status,
    defaultDestinations: { web: 'https://kaayko.com/alumni', ios: null, android: null }
  };
}

function seedLink(campaignId, code, tenantId, status = 'active') {
  const campaign = admin._mocks.docData[`campaigns/${campaignId}`] || {};
  const slug = campaign.slug || campaignId.split('-')[0];
  const shortLinkCode = `${slug}_${code}`;
  admin._mocks.docData[`campaign_links/${campaignId}_${code}`] = {
    tenantId,
    campaignId,
    code,
    shortLinkCode,
    status,
    destinations: { web: `https://${tenantId}.test/alumni`, ios: null, android: null },
    utm: { utm_source: 'whatsapp' },
    metadata: {},
    title: code,
    createdBy: 'admin-uid'
  };
  // Always seed the short_links mirror too
  admin._mocks.docData[`short_links/${shortLinkCode}`] = {
    tenantId,
    campaignId,
    code: shortLinkCode,
    publicCode: code,
    domain: `${tenantId}.test`,
    pathPrefix: '/a',
    destinations: { web: `https://${tenantId}.test/alumni`, ios: null, android: null },
    utm: { utm_source: 'whatsapp' },
    enabled: status === 'active',
    isCampaignLink: true
  };
  return shortLinkCode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Campaign Link Management
// ─────────────────────────────────────────────────────────────────────────────

describe('Kortex Campaign Links — create', () => {
  test('campaign editor can create a link inside an assigned campaign', async () => {
    seedAdmin('tenant-a');
    seedTenant('tenant-a', 'Tenant A', 'tenant-a.test');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    admin._mocks.docData['campaign_memberships/alumni-2026_admin-uid'] = {
      tenantId: 'tenant-a', campaignId: 'alumni-2026', uid: 'admin-uid', role: 'editor'
    };

    const res = await request(app)
      .post('/campaigns/alumni-2026/links')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({
        code: 'whatsapp-group-1',
        destinations: { web: 'https://tenant-a.test/alumni?src=wa1' },
        utm: { utm_source: 'whatsapp', utm_medium: 'group' },
        metadata: { sender: 'Priya' },
        // These must be ignored
        tenantId: 'evil-tenant',
        campaignId: 'other-campaign'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.link.code).toBe('whatsapp-group-1');
    expect(res.body.link.shortLinkCode).toBe('alumni_whatsapp-group-1');
    expect(res.body.link.tenantId).toBe('tenant-a');
    expect(res.body.link.campaignId).toBe('alumni-2026');
    expect(res.body.link.status).toBe('active');

    // Mirror written into short_links
    const mirror = admin._mocks.docData['short_links/alumni_whatsapp-group-1'];
    expect(mirror).toBeDefined();
    expect(mirror.tenantId).toBe('tenant-a');
    expect(mirror.enabled).toBe(true);
    expect(mirror.isCampaignLink).toBe(true);
    expect(mirror.metadata.campaignId).toBe('alumni-2026');
  });

  test('campaign viewer cannot create links', async () => {
    seedViewer('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    admin._mocks.docData['campaign_memberships/alumni-2026_user-uid'] = {
      tenantId: 'tenant-a', campaignId: 'alumni-2026', uid: 'user-uid', role: 'viewer'
    };

    const res = await request(app)
      .post('/campaigns/alumni-2026/links')
      .set('Authorization', 'Bearer VALID_USER_TOKEN')
      .send({ code: 'wa-1', destinations: { web: 'https://kaayko.com' } });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_CAMPAIGN_PERMISSIONS');
  });

  test('create rejects missing destination', async () => {
    seedAdmin('tenant-a');
    seedTenant('tenant-a', 'Tenant A', 'tenant-a.test');
    seedCampaign('alumni-2026', 'tenant-a', 'active');

    const res = await request(app)
      .post('/campaigns/alumni-2026/links')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({ code: 'wa-1' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details).toEqual(expect.arrayContaining([
      expect.stringMatching(/destination/)
    ]));
  });

  test('create rejects invalid link code', async () => {
    seedAdmin('tenant-a');
    seedTenant('tenant-a', 'Tenant A', 'tenant-a.test');
    seedCampaign('alumni-2026', 'tenant-a', 'active');

    const res = await request(app)
      .post('/campaigns/alumni-2026/links')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({ code: 'UPPER_CASE!', destinations: { web: 'https://kaayko.com' } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('create rejects duplicate link code', async () => {
    seedAdmin('tenant-a');
    seedTenant('tenant-a', 'Tenant A', 'tenant-a.test');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    seedLink('alumni-2026', 'wa-1', 'tenant-a');

    const res = await request(app)
      .post('/campaigns/alumni-2026/links')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({ code: 'wa-1', destinations: { web: 'https://kaayko.com' } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_EXISTS');
  });

  test('cross-tenant user cannot create link in another tenant campaign', async () => {
    seedViewer('tenant-a');
    seedCampaign('brand-2026', 'tenant-b', 'active');

    const res = await request(app)
      .post('/campaigns/brand-2026/links')
      .set('Authorization', 'Bearer VALID_USER_TOKEN')
      .send({ code: 'link-1', destinations: { web: 'https://kaayko.com' } });

    expect(res.status).toBe(403);
  });
});

describe('Kortex Campaign Links — list and get', () => {
  test('campaign member can list links for their campaign', async () => {
    seedViewer('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    admin._mocks.docData['campaign_memberships/alumni-2026_user-uid'] = {
      tenantId: 'tenant-a', campaignId: 'alumni-2026', uid: 'user-uid', role: 'viewer'
    };
    seedLink('alumni-2026', 'wa-group-1', 'tenant-a');
    seedLink('alumni-2026', 'email-batch-1', 'tenant-a');

    const res = await request(app)
      .get('/campaigns/alumni-2026/links')
      .set('Authorization', 'Bearer VALID_USER_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.links.length).toBe(2);
    expect(res.body.links.map(l => l.code)).toEqual(expect.arrayContaining(['wa-group-1', 'email-batch-1']));
  });

  test('tenant admin can get a single campaign link', async () => {
    seedAdmin('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    seedLink('alumni-2026', 'wa-group-1', 'tenant-a');

    const res = await request(app)
      .get('/campaigns/alumni-2026/links/wa-group-1')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.link.code).toBe('wa-group-1');
    expect(res.body.link.shortLinkCode).toBe('alumni_wa-group-1');
  });

  test('get returns 404 for unknown link code', async () => {
    seedAdmin('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');

    const res = await request(app)
      .get('/campaigns/alumni-2026/links/does-not-exist')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('Kortex Campaign Links — update', () => {
  test('editor can update destinations and UTM for a campaign link', async () => {
    seedAdmin('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    seedLink('alumni-2026', 'wa-group-1', 'tenant-a');

    const res = await request(app)
      .put('/campaigns/alumni-2026/links/wa-group-1')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({
        destinations: { web: 'https://tenant-a.test/alumni?v=2' },
        utm: { utm_source: 'email', utm_medium: 'newsletter' }
      });

    expect(res.status).toBe(200);
    expect(res.body.link.destinations.web).toBe('https://tenant-a.test/alumni?v=2');

    // Mirror must also have updated destinations
    const mirror = admin._mocks.docData['short_links/alumni_wa-group-1'];
    expect(mirror.destinations.web).toBe('https://tenant-a.test/alumni?v=2');
  });

  test('update strips server-owned metadata keys', async () => {
    seedAdmin('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    seedLink('alumni-2026', 'wa-group-1', 'tenant-a');

    const res = await request(app)
      .put('/campaigns/alumni-2026/links/wa-group-1')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({
        metadata: {
          sender: 'Priya',
          campaignId: 'injected-id',
          tenantId: 'evil'
        }
      });

    expect(res.status).toBe(200);
    // Service should strip campaignId and tenantId from client-provided metadata
    const stored = admin._mocks.docData['campaign_links/alumni-2026_wa-group-1'];
    expect(stored.metadata.campaignId).toBeUndefined();
    expect(stored.metadata.tenantId).toBeUndefined();
    expect(stored.metadata.sender).toBe('Priya');
  });

  test('viewer cannot update a campaign link', async () => {
    seedViewer('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    admin._mocks.docData['campaign_memberships/alumni-2026_user-uid'] = {
      tenantId: 'tenant-a', campaignId: 'alumni-2026', uid: 'user-uid', role: 'viewer'
    };
    seedLink('alumni-2026', 'wa-group-1', 'tenant-a');

    const res = await request(app)
      .put('/campaigns/alumni-2026/links/wa-group-1')
      .set('Authorization', 'Bearer VALID_USER_TOKEN')
      .send({ destinations: { web: 'https://evil.test' } });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_CAMPAIGN_PERMISSIONS');
  });
});

describe('Kortex Campaign Links — pause and resume', () => {
  test('campaign owner can pause a single link', async () => {
    seedViewer('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    admin._mocks.docData['campaign_memberships/alumni-2026_user-uid'] = {
      tenantId: 'tenant-a', campaignId: 'alumni-2026', uid: 'user-uid', role: 'owner'
    };
    seedLink('alumni-2026', 'wa-group-1', 'tenant-a', 'active');

    const res = await request(app)
      .post('/campaigns/alumni-2026/links/wa-group-1/pause')
      .set('Authorization', 'Bearer VALID_USER_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.link.status).toBe('paused');

    // Mirror must be disabled
    expect(admin._mocks.docData['short_links/alumni_wa-group-1'].enabled).toBe(false);
  });

  test('pausing one link does not affect sibling links', async () => {
    seedAdmin('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    seedLink('alumni-2026', 'wa-group-1', 'tenant-a', 'active');
    seedLink('alumni-2026', 'email-batch-1', 'tenant-a', 'active');

    await request(app)
      .post('/campaigns/alumni-2026/links/wa-group-1/pause')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(admin._mocks.docData['short_links/alumni_wa-group-1'].enabled).toBe(false);
    expect(admin._mocks.docData['short_links/alumni_email-batch-1'].enabled).toBe(true);
  });

  test('campaign owner can resume a paused link', async () => {
    seedViewer('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    admin._mocks.docData['campaign_memberships/alumni-2026_user-uid'] = {
      tenantId: 'tenant-a', campaignId: 'alumni-2026', uid: 'user-uid', role: 'owner'
    };
    seedLink('alumni-2026', 'wa-group-1', 'tenant-a', 'paused');

    const res = await request(app)
      .post('/campaigns/alumni-2026/links/wa-group-1/resume')
      .set('Authorization', 'Bearer VALID_USER_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.link.status).toBe('active');
    expect(admin._mocks.docData['short_links/alumni_wa-group-1'].enabled).toBe(true);
  });

  test('link-operator can pause links but cannot create or update them', async () => {
    seedViewer('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    admin._mocks.docData['campaign_memberships/alumni-2026_user-uid'] = {
      tenantId: 'tenant-a', campaignId: 'alumni-2026', uid: 'user-uid', role: 'link-operator'
    };
    seedLink('alumni-2026', 'wa-group-1', 'tenant-a', 'active');

    const pauseRes = await request(app)
      .post('/campaigns/alumni-2026/links/wa-group-1/pause')
      .set('Authorization', 'Bearer VALID_USER_TOKEN');
    expect(pauseRes.status).toBe(200);

    const createRes = await request(app)
      .post('/campaigns/alumni-2026/links')
      .set('Authorization', 'Bearer VALID_USER_TOKEN')
      .send({ code: 'new-link', destinations: { web: 'https://kaayko.com' } });
    expect(createRes.status).toBe(403);
  });
});

describe('Kortex Campaign Links — delete', () => {
  test('editor can delete a campaign link and mirror is removed', async () => {
    seedAdmin('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    seedLink('alumni-2026', 'wa-group-1', 'tenant-a');

    const res = await request(app)
      .delete('/campaigns/alumni-2026/links/wa-group-1')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    // short_links mirror must be removed (redirect returns 404)
    expect(admin._mocks.docData['short_links/alumni_wa-group-1']).toBeUndefined();

    // campaign_links record is soft-deleted
    const linkDoc = admin._mocks.docData['campaign_links/alumni-2026_wa-group-1'];
    expect(linkDoc.status).toBe('deleted');
  });

  test('viewer cannot delete a campaign link', async () => {
    seedViewer('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    admin._mocks.docData['campaign_memberships/alumni-2026_user-uid'] = {
      tenantId: 'tenant-a', campaignId: 'alumni-2026', uid: 'user-uid', role: 'viewer'
    };
    seedLink('alumni-2026', 'wa-group-1', 'tenant-a');

    const res = await request(app)
      .delete('/campaigns/alumni-2026/links/wa-group-1')
      .set('Authorization', 'Bearer VALID_USER_TOKEN');

    expect(res.status).toBe(403);
    // Mirror must still exist
    expect(admin._mocks.docData['short_links/alumni_wa-group-1']).toBeDefined();
  });
});

describe('Kortex Campaign Links — campaign-level cascade', () => {
  test('pausing the campaign disables all active link mirrors', async () => {
    seedAdmin('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'active');
    seedLink('alumni-2026', 'wa-group-1', 'tenant-a', 'active');
    seedLink('alumni-2026', 'email-batch-1', 'tenant-a', 'active');

    const res = await request(app)
      .post('/campaigns/alumni-2026/pause')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.campaign.status).toBe('paused');
    expect(admin._mocks.docData['short_links/alumni_wa-group-1'].enabled).toBe(false);
    expect(admin._mocks.docData['short_links/alumni_email-batch-1'].enabled).toBe(false);
  });

  test('resuming the campaign re-enables active link mirrors', async () => {
    seedAdmin('tenant-a');
    seedCampaign('alumni-2026', 'tenant-a', 'paused');
    // Links seeded as active status but mirrors disabled (as they'd be after a campaign pause)
    seedLink('alumni-2026', 'wa-group-1', 'tenant-a', 'active');
    admin._mocks.docData['short_links/alumni_wa-group-1'].enabled = false;

    const res = await request(app)
      .post('/campaigns/alumni-2026/resume')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN');

    expect(res.status).toBe(200);
    expect(res.body.campaign.status).toBe('active');
    expect(admin._mocks.docData['short_links/alumni_wa-group-1'].enabled).toBe(true);
  });

  test('tenant isolation: cross-tenant user cannot access links', async () => {
    seedViewer('tenant-a');
    seedCampaign('brand-2026', 'tenant-b', 'active');
    seedLink('brand-2026', 'wa-group-1', 'tenant-b');

    const res = await request(app)
      .get('/campaigns/brand-2026/links')
      .set('Authorization', 'Bearer VALID_USER_TOKEN');

    expect(res.status).toBe(403);
  });
});
