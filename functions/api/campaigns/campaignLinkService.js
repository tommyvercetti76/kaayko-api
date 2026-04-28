/**
 * Campaign Link Service — Phase 2
 *
 * Manages links that belong to a campaign.
 *
 * Each campaign link lives in TWO places:
 *  1. campaign_links/{campaignId_code}  — the source of truth for campaign management
 *  2. short_links/{shortLinkCode}       — the redirect compatibility mirror
 *
 * The mirror is the only thing the redirect handler (redirectHandler.js) reads.
 * It is written on create, kept in sync on update/pause/resume, and deleted on delete.
 *
 * Short link code format: `{campaignSlug}_{code}`
 *   e.g. campaign slug "a", link code "whatsapp-group-1" → short code "a_whatsapp-group-1"
 *
 * Pausing a single link sets enabled=false on the short_links mirror.
 * Pausing the parent campaign is handled in campaignService and cascades via
 * disableAllCampaignLinks (called from there) — it does NOT delete mirrors, only disables them.
 */

'use strict';

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { validateLinkCreate, validateLinkUpdate, validateLinkCode } = require('./campaignValidation');

const db = admin.firestore();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the short_links mirror document for a campaign link.
 * Only redirect-critical fields are written to short_links.
 */
function buildShortLinkMirror(campaign, link) {
  return {
    tenantId: campaign.tenantId,
    tenantName: campaign.tenantName || campaign.tenantId,
    campaignId: campaign.campaignId || campaign.id,
    campaignSlug: campaign.slug,
    domain: campaign.domain || 'kaayko.com',
    pathPrefix: campaign.pathPrefix || `/${campaign.slug}`,
    code: link.shortLinkCode,
    publicCode: link.code,
    shortUrl: `https://${campaign.domain || 'kaayko.com'}${campaign.pathPrefix || `/${campaign.slug}`}/${link.code}`,
    destinations: link.destinations || { web: null, ios: null, android: null },
    utm: link.utm || {},
    metadata: {
      campaignId: campaign.campaignId || campaign.id,
      campaignType: campaign.type || '',
      campaignSlug: campaign.slug,
      destinationType: link.metadata?.destinationType || (campaign.type === 'philanthropy' ? 'philanthropy_campaign' : 'campaign_landing'),
      audience: link.metadata?.audience || 'public',
      intent: link.metadata?.intent || 'view',
      source: link.metadata?.source || 'manual',
      requiresAuth: link.metadata?.requiresAuth === 'true' || link.metadata?.requiresAuth === true,
      ...(link.metadata || {})
    },
    destinationType: link.metadata?.destinationType || (campaign.type === 'philanthropy' ? 'philanthropy_campaign' : 'campaign_landing'),
    audience: link.metadata?.audience || 'public',
    intent: link.metadata?.intent || 'view',
    source: link.metadata?.source || 'manual',
    requiresAuth: link.metadata?.requiresAuth === 'true' || link.metadata?.requiresAuth === true,
    conversionGoal: link.metadata?.conversionGoal || null,
    enabled: link.status === 'active',
    isCampaignLink: true,
    updatedAt: FieldValue.serverTimestamp()
  };
}

/** Compound document key for campaign_links collection. */
function linkDocId(campaignId, code) {
  return `${campaignId}_${code}`;
}

/** Short code used in short_links collection. */
function shortLinkCode(campaignSlug, code) {
  return `${campaignSlug}_${code}`;
}

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Create a campaign link.
 *
 * Writes to campaign_links and mirrors into short_links atomically using a batch.
 * Writes an audit log entry.
 *
 * @param {object} params
 * @param {object} params.campaign   — Full campaign doc (from loadCampaign)
 * @param {object} params.actor      — Authenticated user { uid, email }
 * @param {object} params.data       — Raw request body
 * @returns {Promise<object>}        — Created link document
 */
async function createCampaignLink({ campaign, actor, data }) {
  const campaignId = campaign.campaignId || campaign.id;
  const validated = validateLinkCreate(data);

  // Compute IDs
  const slCode = shortLinkCode(campaign.slug, validated.code);
  const docId = linkDocId(campaignId, validated.code);

  // Guard: prevent duplicates
  const existing = await db.collection('campaign_links').doc(docId).get();
  if (existing.exists) {
    const err = new Error(`Campaign link already exists: ${validated.code}`);
    err.code = 'ALREADY_EXISTS';
    throw err;
  }

  // Guard: prevent short_links collision
  const shortLinkExisting = await db.collection('short_links').doc(slCode).get();
  if (shortLinkExisting.exists) {
    const err = new Error(`Short link code already in use: ${slCode}`);
    err.code = 'ALREADY_EXISTS';
    throw err;
  }

  const now = FieldValue.serverTimestamp();
  const link = {
    tenantId: campaign.tenantId,
    campaignId,
    code: validated.code,
    shortLinkCode: slCode,
    status: 'active',
    destinations: validated.destinations,
    utm: validated.utm,
    metadata: validated.metadata,
    title: validated.title,
    usesCount: 0,
    createdBy: actor.uid,
    createdByEmail: actor.email || null,
    createdAt: now,
    updatedAt: now
  };

  const batch = db.batch();
  batch.set(db.collection('campaign_links').doc(docId), link);
  batch.set(db.collection('short_links').doc(slCode), buildShortLinkMirror(campaign, link));
  await batch.commit();

  await _writeAudit({ campaign, actor, action: 'campaign_link.created', after: { code: validated.code, shortLinkCode: slCode } });

  return { id: docId, ...link };
}

// ─── Read ────────────────────────────────────────────────────────────────────

/**
 * List all links for a campaign (excluding deleted placeholders).
 */
async function listCampaignLinks({ campaignId, tenantId, includeInactive = false, limit = 200 }) {
  const query = db.collection('campaign_links')
    .where('campaignId', '==', campaignId)
    .where('tenantId', '==', tenantId)
    .limit(limit);

  const snapshot = await query.get();
  const links = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return includeInactive ? links : links.filter(l => l.status !== 'deleted');
}

/**
 * Get a single campaign link by code. Throws NOT_FOUND if absent.
 */
async function getCampaignLink({ campaignId, code }) {
  const docId = linkDocId(campaignId, code);
  const doc = await db.collection('campaign_links').doc(docId).get();
  if (!doc.exists) {
    const err = new Error('Campaign link not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return { id: doc.id, ...doc.data() };
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Update destinations, UTM, metadata, or title for a campaign link.
 * Syncs the short_links mirror atomically.
 */
async function updateCampaignLink({ campaign, link, actor, data }) {
  const campaignId = campaign.campaignId || campaign.id;
  const validated = validateLinkUpdate(data);
  const docId = linkDocId(campaignId, link.code);

  const updates = {
    ...validated,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid
  };

  // Build the updated link shape for mirror
  const mergedLink = { ...link, ...validated };

  const batch = db.batch();
  batch.update(db.collection('campaign_links').doc(docId), updates);

  // Sync only the mirror fields that changed
  const mirrorUpdates = {};
  if (validated.destinations !== undefined) mirrorUpdates.destinations = validated.destinations;
  if (validated.utm !== undefined) mirrorUpdates.utm = validated.utm;
  if (validated.metadata !== undefined) {
    mirrorUpdates.metadata = {
      campaignId: campaignId,
      campaignType: campaign.type || '',
      campaignSlug: campaign.slug,
      ...validated.metadata
    };
  }
  if (Object.keys(mirrorUpdates).length > 0) {
    mirrorUpdates.updatedAt = FieldValue.serverTimestamp();
    batch.update(db.collection('short_links').doc(link.shortLinkCode), mirrorUpdates);
  }

  await batch.commit();
  await _writeAudit({ campaign, actor, action: 'campaign_link.updated', before: { code: link.code }, after: validated });

  const updated = await db.collection('campaign_links').doc(docId).get();
  return { id: updated.id, ...updated.data() };
}

// ─── Pause / Resume ───────────────────────────────────────────────────────────

/**
 * Pause a single campaign link. Sets status=paused and disables the short_links mirror.
 */
async function pauseCampaignLink({ campaign, link, actor }) {
  return _setLinkStatus({ campaign, link, actor, status: 'paused' });
}

/**
 * Resume a single campaign link. Sets status=active and re-enables the short_links mirror.
 */
async function resumeCampaignLink({ campaign, link, actor }) {
  return _setLinkStatus({ campaign, link, actor, status: 'active' });
}

async function _setLinkStatus({ campaign, link, actor, status }) {
  const campaignId = campaign.campaignId || campaign.id;
  const docId = linkDocId(campaignId, link.code);

  const batch = db.batch();
  batch.update(db.collection('campaign_links').doc(docId), {
    status,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid
  });
  batch.update(db.collection('short_links').doc(link.shortLinkCode), {
    enabled: status === 'active',
    updatedAt: FieldValue.serverTimestamp()
  });
  await batch.commit();

  await _writeAudit({ campaign, actor, action: `campaign_link.${status}`, after: { code: link.code, status } });

  const updated = await db.collection('campaign_links').doc(docId).get();
  return { id: updated.id, ...updated.data() };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete a campaign link. Removes the short_links mirror atomically.
 * Marks the campaign_links doc as deleted (soft delete) — does NOT hard-delete
 * to preserve audit trail. The mirror in short_links IS hard-deleted so the
 * public redirect stops working immediately.
 */
async function deleteCampaignLink({ campaign, link, actor }) {
  const campaignId = campaign.campaignId || campaign.id;
  const docId = linkDocId(campaignId, link.code);

  const batch = db.batch();
  // Soft-delete the campaign link record
  batch.update(db.collection('campaign_links').doc(docId), {
    status: 'deleted',
    deletedAt: FieldValue.serverTimestamp(),
    deletedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp()
  });
  // Hard-delete the short_links mirror so the redirect immediately returns 404
  batch.delete(db.collection('short_links').doc(link.shortLinkCode));
  await batch.commit();

  await _writeAudit({ campaign, actor, action: 'campaign_link.deleted', after: { code: link.code } });

  return { code: link.code, deleted: true };
}

// ─── Cascade helpers (called by campaignService) ──────────────────────────────

/**
 * Disable all short_links mirrors for a campaign.
 * Called when a campaign is paused or archived.
 * Does NOT change campaign_links status — only the mirror's enabled flag.
 * This lets campaign links retain their individual statuses for later resume.
 */
async function disableAllCampaignLinks({ campaignId, tenantId }) {
  const snapshot = await db.collection('campaign_links')
    .where('campaignId', '==', campaignId)
    .where('tenantId', '==', tenantId)
    .where('status', '==', 'active')
    .get();

  if (snapshot.empty) return { disabled: 0 };

  const batch = db.batch();
  for (const doc of snapshot.docs) {
    const link = doc.data();
    if (link.shortLinkCode) {
      batch.update(db.collection('short_links').doc(link.shortLinkCode), {
        enabled: false,
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  }
  await batch.commit();
  return { disabled: snapshot.size };
}

/**
 * Re-enable short_links mirrors for all active campaign links.
 * Called when a campaign is resumed (status → active).
 */
async function enableAllCampaignLinks({ campaignId, tenantId }) {
  const snapshot = await db.collection('campaign_links')
    .where('campaignId', '==', campaignId)
    .where('tenantId', '==', tenantId)
    .where('status', '==', 'active')
    .get();

  if (snapshot.empty) return { enabled: 0 };

  const batch = db.batch();
  for (const doc of snapshot.docs) {
    const link = doc.data();
    if (link.shortLinkCode) {
      batch.update(db.collection('short_links').doc(link.shortLinkCode), {
        enabled: true,
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  }
  await batch.commit();
  return { enabled: snapshot.size };
}

// ─── Audit ────────────────────────────────────────────────────────────────────

async function _writeAudit({ campaign, actor, action, before = null, after = null }) {
  await db.collection('campaign_audit_logs').add({
    tenantId: campaign.tenantId,
    campaignId: campaign.campaignId || campaign.id,
    actorUid: actor.uid,
    actorEmail: actor.email || null,
    action,
    before,
    after,
    timestamp: FieldValue.serverTimestamp()
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  createCampaignLink,
  listCampaignLinks,
  getCampaignLink,
  updateCampaignLink,
  pauseCampaignLink,
  resumeCampaignLink,
  deleteCampaignLink,
  disableAllCampaignLinks,
  enableAllCampaignLinks,
  // Exposed for tests
  shortLinkCode,
  linkDocId
};
