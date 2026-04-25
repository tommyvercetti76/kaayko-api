const admin = require('firebase-admin');
const { assertTenantAccess, DEFAULT_TENANT_ID } = require('../smartLinks/tenantContext');

const db = admin.firestore();

const ROLE_PERMISSIONS = {
  owner: ['campaign:read', 'campaign:update', 'campaign:pause', 'campaign:archive', 'members:manage', 'links:create', 'links:update', 'analytics:read'],
  editor: ['campaign:read', 'campaign:update', 'links:create', 'links:update', 'analytics:read'],
  viewer: ['campaign:read', 'analytics:read'],
  'link-operator': ['campaign:read', 'campaign:pause', 'links:update']
};

function isTenantAdmin(user) {
  return user?.role === 'super-admin' || user?.role === 'admin';
}

function hasPermission(role, permission) {
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}

async function loadCampaign(campaignId) {
  const doc = await db.collection('campaigns').doc(campaignId).get();
  if (!doc.exists) {
    const error = new Error('Campaign not found');
    error.code = 'NOT_FOUND';
    throw error;
  }
  return { id: doc.id, ...doc.data() };
}

async function loadMembership(campaignId, uid) {
  if (!campaignId || !uid) return null;
  const doc = await db.collection('campaign_memberships').doc(`${campaignId}_${uid}`).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function requireCampaignPermission(user, campaign, permission) {
  if (!user) {
    const error = new Error('Authentication required');
    error.code = 'AUTH_REQUIRED';
    throw error;
  }

  const tenantId = campaign.tenantId || DEFAULT_TENANT_ID;
  if (user.role === 'super-admin') return { mode: 'super-admin' };

  try {
    assertTenantAccess(user, tenantId);
  } catch (error) {
    const membership = await loadMembership(campaign.campaignId || campaign.id, user.uid);
    if (!membership || membership.tenantId !== tenantId || !hasPermission(membership.role, permission)) {
      error.code = 'TENANT_ACCESS_DENIED';
      throw error;
    }
    return { mode: 'campaign-member', membership };
  }

  if (isTenantAdmin(user)) return { mode: 'tenant-admin' };

  const membership = await loadMembership(campaign.campaignId || campaign.id, user.uid);
  if (membership && membership.tenantId === tenantId && hasPermission(membership.role, permission)) {
    return { mode: 'campaign-member', membership };
  }

  const error = new Error('Insufficient campaign permissions');
  error.code = 'INSUFFICIENT_CAMPAIGN_PERMISSIONS';
  throw error;
}

module.exports = {
  ROLE_PERMISSIONS,
  isTenantAdmin,
  loadCampaign,
  loadMembership,
  requireCampaignPermission
};
