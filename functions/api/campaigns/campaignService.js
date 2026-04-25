const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { validateCampaignCreate, validateCampaignUpdate, validateMemberRole } = require('./campaignValidation');
const campaignLinkService = require('./campaignLinkService');

const db = admin.firestore();

async function createCampaign({ tenant, actor, data }) {
  const campaign = validateCampaignCreate(data);
  const ref = db.collection('campaigns').doc(campaign.campaignId);
  const existing = await ref.get();
  if (existing.exists) {
    const error = new Error('Campaign already exists');
    error.code = 'ALREADY_EXISTS';
    throw error;
  }

  const doc = {
    ...campaign,
    tenantId: tenant.id,
    tenantName: tenant.name,
    domain: tenant.domain,
    pathPrefix: `/${campaign.slug}`,
    ownerUids: [actor.uid],
    createdBy: actor.uid,
    createdByEmail: actor.email || null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  await ref.set(doc);
  await upsertMember({
    tenantId: tenant.id,
    campaignId: campaign.campaignId,
    uid: actor.uid,
    role: 'owner',
    actor
  });
  await writeAudit({ tenantId: tenant.id, campaignId: campaign.campaignId, actor, action: 'campaign.created', after: doc });

  return { id: campaign.campaignId, ...doc };
}

async function listCampaigns({ tenantId, includeArchived = false, limit = 100 }) {
  const query = db.collection('campaigns').where('tenantId', '==', tenantId);
  const snapshot = await query.limit(limit).get();
  return snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(campaign => includeArchived || campaign.status !== 'archived');
}

async function updateCampaign({ campaign, actor, updates }) {
  const cleanUpdates = validateCampaignUpdate(updates);
  const ref = db.collection('campaigns').doc(campaign.campaignId || campaign.id);
  const updateDoc = {
    ...cleanUpdates,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid
  };
  await ref.update(updateDoc);
  await writeAudit({
    tenantId: campaign.tenantId,
    campaignId: campaign.campaignId || campaign.id,
    actor,
    action: 'campaign.updated',
    before: campaign,
    after: updateDoc
  });
  const updated = await ref.get();
  return { id: updated.id, ...updated.data() };
}

async function setCampaignStatus({ campaign, actor, status }) {
  const tenantId = campaign.tenantId;
  const campaignId = campaign.campaignId || campaign.id;

  // Update the campaign record first
  const updated = await updateCampaign({ campaign, actor, updates: { status } });

  // Cascade to campaign links: disable mirrors when paused/archived, re-enable when active
  if (status === 'paused' || status === 'archived') {
    await campaignLinkService.disableAllCampaignLinks({ campaignId, tenantId });
  } else if (status === 'active') {
    await campaignLinkService.enableAllCampaignLinks({ campaignId, tenantId });
  }

  return updated;
}

async function upsertMember({ tenantId, campaignId, uid, role, actor }) {
  const normalizedRole = validateMemberRole(role);
  const memberRef = db.collection('campaign_memberships').doc(`${campaignId}_${uid}`);
  const member = {
    tenantId,
    campaignId,
    uid,
    role: normalizedRole,
    permissions: rolePermissions(normalizedRole),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid
  };
  const existing = await memberRef.get();
  await memberRef.set({
    ...member,
    createdAt: existing.exists ? existing.data().createdAt : FieldValue.serverTimestamp(),
    createdBy: existing.exists ? existing.data().createdBy : actor.uid
  });
  await writeAudit({ tenantId, campaignId, actor, action: 'campaign.member.upserted', after: member });
  return { id: memberRef.id, ...member };
}

async function listMembers(campaignId) {
  const snapshot = await db.collection('campaign_memberships')
    .where('campaignId', '==', campaignId)
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function removeMember({ campaign, uid, actor }) {
  await db.collection('campaign_memberships').doc(`${campaign.campaignId || campaign.id}_${uid}`).delete();
  await writeAudit({
    tenantId: campaign.tenantId,
    campaignId: campaign.campaignId || campaign.id,
    actor,
    action: 'campaign.member.removed',
    after: { uid }
  });
  return { uid };
}

function rolePermissions(role) {
  const { ROLE_PERMISSIONS } = require('./campaignPermissions');
  return ROLE_PERMISSIONS[role] || [];
}

async function writeAudit({ tenantId, campaignId, actor, action, before = null, after = null }) {
  await db.collection('campaign_audit_logs').add({
    tenantId,
    campaignId,
    actorUid: actor.uid,
    actorEmail: actor.email || null,
    action,
    before,
    after,
    timestamp: FieldValue.serverTimestamp()
  });
}

module.exports = {
  createCampaign,
  listCampaigns,
  updateCampaign,
  setCampaignStatus,
  upsertMember,
  listMembers,
  removeMember
};
