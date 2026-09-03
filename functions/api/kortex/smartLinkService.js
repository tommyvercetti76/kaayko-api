/**
 * Smart Link Service Layer
 * SIMPLIFIED: Only short codes - no structured paths!
 * 
 * Every link is just: kaayko.com/l/lkXXXX
 * Points to any destination: paddlingout, store, products, custom URLs
 * 
 * Simple, clean, effective.
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { generateShortCode, isValidShortCode } = require('./smartLinkValidation');
const { DEFAULT_TENANT_ID } = require('./tenantContext');
const { assertDestinationAllowed } = require('./domainPolicy');
const { PLAN_LIMITS } = require('../billing/planLimits');
const safety = require('./destinationSafety');
const { LINK_STATUS, effectiveStatus } = require('./safetyPages');

const db = admin.firestore();

/**
 * Run the destination safety assessment shared by every create/update path.
 * Throws DESTINATION_BLOCKED on a block verdict; returns { status, safety } otherwise.
 */
async function assessForWrite(destinations, { tenantId, tenantDocData, actorIsSuperAdmin, purpose, actor }) {
  const assessment = await safety.assessDestinations(destinations, {
    tenantId,
    tenant: tenantDocData,
    actorIsSuperAdmin: actorIsSuperAdmin === true,
    purpose
  });
  if (assessment.verdict === safety.VERDICT.BLOCK) {
    const err = new Error(`Destination refused: ${assessment.reasons.map(r => r.detail).join('; ')}`);
    err.code = 'DESTINATION_BLOCKED';
    err.reasons = assessment.reasons.map(r => ({ code: r.code, platform: r.platform, detail: r.detail }));
    throw err;
  }
  return {
    status: safety.statusForVerdict(assessment.verdict),
    safety: safety.buildSafetyRecord(assessment, { purpose, actor: actor || null })
  };
}

/** Learn the domains of a link that went live so later tenants are not held on them. */
function learnDomains(safetyRecord, tenantId) {
  for (const domain of safetyRecord?.domains || []) {
    safety.markDomainKnown(domain, { source: 'link', tenantId }).catch(() => {});
  }
}

const ALUMNI_METADATA_KEYS = new Set([
  'campaign',
  'sourceGroup',
  'sourceBatch',
  'schoolName',
  'schoolId',
  'campaignId',
  'channel',
  'chapterOrRegion',
  'audienceType',
  'organizerRole',
  'messageTemplateId',
  'sender',
  'maxUses',
  'votingDeadline'
]);

const UTM_KEY_MAP = {
  source: 'utm_source',
  medium: 'utm_medium',
  campaign: 'utm_campaign',
  term: 'utm_term',
  content: 'utm_content',
  utm_source: 'utm_source',
  utm_medium: 'utm_medium',
  utm_campaign: 'utm_campaign',
  utm_term: 'utm_term',
  utm_content: 'utm_content'
};

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeObjects(base = {}, patch = {}) {
  const merged = { ...(isPlainObject(base) ? base : {}) };

  for (const [key, value] of Object.entries(isPlainObject(patch) ? patch : {})) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMergeObjects(merged[key], value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function normalizeUTM(utm) {
  if (!isPlainObject(utm)) return {};

  const normalized = {};
  for (const [key, rawValue] of Object.entries(utm)) {
    if (rawValue === undefined || rawValue === null) continue;

    const value = String(rawValue).trim();
    if (!value) continue;

    const canonicalKey = UTM_KEY_MAP[key];
    if (canonicalKey) {
      normalized[canonicalKey] = value.toLowerCase().slice(0, 100);
    }
  }

  return normalized;
}

function isAlumniDestination(url) {
  const raw = String(url || '').trim().toLowerCase();
  if (!raw) return false;

  let path = raw;
  try {
    const normalized = raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw)
      : new URL(raw.startsWith('/') ? raw : `/${raw}`, 'https://kaayko.com');
    path = String(normalized.pathname || '').toLowerCase();
  } catch (_) {
    path = raw;
  }

  return path === '/alumni' || path.startsWith('/alumni/');
}

function sanitizeMetadataForDestination(metadata, webDestination) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  // Allow full metadata on alumni links
  if (isAlumniDestination(webDestination)) {
    return { ...metadata };
  }

  // Strip alumni-only fields from non-alumni links
  const sanitized = { ...metadata };
  for (const key of ALUMNI_METADATA_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

/**
 * Create a short code link
 * ENRICHED: Full metadata support - destinations, UTM, expiry, creator, custom fields
 * MULTI-TENANT: Now supports tenantId, domain, and pathPrefix
 */
async function createShortLink(data) {
  const {
    iosDestination,
    androidDestination,
    webDestination,
    title = '',
    description = '',
    metadata = {},
    utm = {},
    expiresAt = null,
    createdBy = 'system',
    enabled = true,
    // NEW: Multi-tenant fields
    tenantId = DEFAULT_TENANT_ID,
    tenantName = 'Kaayko',
    domain = 'kaayko.com',
    pathPrefix = '/l',
    apiKeyId = null,
    destinationType = metadata.destinationType || 'external_url',
    campaignId = metadata.campaignId || null,
    requiresAuth = metadata.requiresAuth === true,
    audience = metadata.audience || 'public',
    source = metadata.source || 'manual',
    intent = metadata.intent || 'view',
    returnTo = metadata.returnTo || null,
    conversionGoal = metadata.conversionGoal || null,
    destinationCategory = null,
    destinationTemplate = null
  } = data;

  // If caller provided a custom short code (alias), validate and use it
  let providedCode = data.code || data.shortCode || null;
  const publicCode = data.publicCode || providedCode || null;
  if (providedCode) {
    if (!isValidShortCode(providedCode)) {
      const err = new Error('Invalid short code format');
      err.code = 'INVALID_CODE';
      throw err;
    }

    // Ensure uniqueness
    const exists = await db.collection('short_links').doc(providedCode).get();
    if (exists.exists) {
      const err = new Error('Short code already exists');
      err.code = 'ALREADY_EXISTS';
      err.existing = { code: providedCode };
      throw err;
    }
  }

  // Validate: title is required
  if (!title || !title.trim()) {
    const err = new Error('Link title is required');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  // Validate: must have at least one destination
  if (!iosDestination && !androidDestination && !webDestination) {
    throw new Error('At least one destination (iOS, Android, or Web) is required');
  }

  // Validate: all destination URLs must use http/https protocol
  const urlsToCheck = [
    { val: webDestination, label: 'Web' },
    { val: iosDestination, label: 'iOS' },
    { val: androidDestination, label: 'Android' },
  ];
  for (const { val, label } of urlsToCheck) {
    if (!val) continue;
    try {
      const parsed = new URL(val);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        const err = new Error(`${label} destination must use https:// or http:// protocol`);
        err.code = 'INVALID_URL';
        throw err;
      }
    } catch (e) {
      if (e.code === 'INVALID_URL') throw e;
      const err = new Error(`${label} destination is not a valid URL`);
      err.code = 'INVALID_URL';
      throw err;
    }
  }

  // Load tenant config once (reused for domain policy, quota, and slug below).
  let tenantDocData = null;
  if (tenantId !== DEFAULT_TENANT_ID) {
    const tdoc = await db.collection('tenants').doc(tenantId).get();
    tenantDocData = tdoc.exists ? tdoc.data() : null;
  }

  // Destination domain policy — shared by admin, public API, batch, and tenant-links.
  assertDestinationAllowed({
    webDestination,
    tenantId,
    allowedDomains: tenantDocData?.settings?.allowedDomains || null,
    bypass: data.bypassDomainCheck === true
  });

  // Plan quota — cap link count per tenant. The default Kaayko tenant is unlimited.
  if (tenantId !== DEFAULT_TENANT_ID) {
    const plan = tenantDocData?.plan || 'starter';
    const linkLimit = PLAN_LIMITS[plan]?.links ?? PLAN_LIMITS.starter.links;
    if (linkLimit !== Infinity) {
      // Bounded read: fetch at most `linkLimit` docs — enough to know we're at/over the cap.
      const existing = await db.collection('short_links')
        .where('tenantId', '==', tenantId)
        .limit(linkLimit)
        .get();
      if (existing.size >= linkLimit) {
        const err = new Error(`Plan limit reached: the ${plan} plan allows ${linkLimit} links. Upgrade to add more.`);
        err.code = 'PLAN_LIMIT_EXCEEDED';
        throw err;
      }
    }
  }

  // Destination safety — private hosts, blocklists, Safe Browsing, domain
  // reputation. Blocks throw; unknown domains for new tenants come back 'held'.
  const safetyOutcome = await assessForWrite(
    { web: webDestination, ios: iosDestination, android: androidDestination },
    { tenantId, tenantDocData, actorIsSuperAdmin: data.actorIsSuperAdmin, purpose: 'create', actor: createdBy }
  );

  // Determine short code: use provided or generate secure tenant-prefixed code
  let shortCode = providedCode;
  if (!shortCode) {
    const { generateSecureCode } = require('./tenantLinkResolver');
    const useSecureCode = tenantId !== DEFAULT_TENANT_ID;
    // Guest (no-account) links live on kaayko.com/l/ with an unguessable
    // `kx-` code so a workspace id never leaks into the public URL.
    const isGuestTenant = tenantDocData?.kind === 'guest';
    let attempts = 0;
    do {
      shortCode = isGuestTenant ? generateSecureCode('kx') : useSecureCode ? generateSecureCode(tenantId) : generateShortCode();
      const existingLink = await db.collection('short_links').doc(shortCode).get();
      if (!existingLink.exists) break;
      attempts++;
    } while (attempts < 5);

    if (attempts >= 5) {
      throw new Error('Failed to generate unique short code after 5 attempts');
    }
  }

  // Construct short URL — tenant links use the alumni.kaayko.com namespace,
  // except guest workspaces and tenants that opt into the kaayko.com/l/ form.
  let shortUrl, qrCodeUrl;
  const usesAlumniNamespace = tenantId !== DEFAULT_TENANT_ID
    && tenantDocData?.kind !== 'guest'
    && tenantDocData?.linkNamespace !== 'kaayko';
  if (usesAlumniNamespace) {
    // Tenant-namespaced: alumni.kaayko.com/<slug>/<code> (reuse tenant doc from above)
    const tenantSlug = tenantDocData ? (tenantDocData.slug || tenantId) : tenantId;
    shortUrl = `https://alumni.kaayko.com/${tenantSlug}/${publicCode || shortCode}`;
    qrCodeUrl = `https://alumni.kaayko.com/${tenantSlug}/qr/${shortCode}.png`;
  } else {
    // Default Kaayko links: kaayko.com/l/<code>. The QR image is served by
    // GET /qr/<code>.png (hosting rewrite → api) for any live link.
    const shortDomain = domain.startsWith('http') ? domain : `https://${domain}`;
    shortUrl = `${shortDomain}${pathPrefix}/${publicCode || shortCode}`;
    qrCodeUrl = `${shortDomain}/qr/${shortCode}.png`;
  }

  const sanitizedMetadata = sanitizeMetadataForDestination(metadata, webDestination);
  const normalizedUtm = normalizeUTM(utm);

  // Generate HMAC signature for tenant links (enables tamper detection)
  let linkSignature = null;
  if (tenantId !== DEFAULT_TENANT_ID) {
    const { signCode } = require('./linkSecurityService');
    linkSignature = signCode(shortCode, tenantId);
  }

  // Create ENRICHED short link document with ALL metadata + multi-tenant fields
  const linkDoc = {
    code: shortCode,
    shortUrl,
    qrCodeUrl,
    linkSignature,

    // Multi-tenant fields
    tenantId,
    tenantName,
    domain,
    pathPrefix,
    publicCode: publicCode || shortCode,
    apiKeyId, // Track which API key created this
    destinationType,
    campaignId,
    requiresAuth,
    audience,
    source,
    intent,
    returnTo,
    conversionGoal,
    destinationCategory,
    destinationTemplate,

    destinations: {
      ios: iosDestination || null,
      android: androidDestination || null,
      web: webDestination || null
    },
    title,
    description,
    metadata: sanitizedMetadata, // Custom key-value data
    utm: normalizedUtm, // UTM tracking params
    expiresAt: expiresAt ? admin.firestore.Timestamp.fromDate(new Date(expiresAt)) : null,
    clickCount: 0,
    installCount: 0,
    uniqueUsers: [],
    uniqueVisitCount: 0, // Alumni campaign: counts unique visits before redirecting
    lastClickedAt: null, // Track last click timestamp
    lastInstallAt: null, // Track last install timestamp
    enabled, // Active/inactive status
    status: safetyOutcome.status, // active | held | blocked (safety / review state)
    safety: safetyOutcome.safety,
    createdBy, // Audit trail: who created this
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  // Save to Firestore
  await db.collection('short_links').doc(shortCode).set(linkDoc);

  if (safetyOutcome.status === LINK_STATUS.ACTIVE) learnDomains(safetyOutcome.safety, tenantId);

  // Return FULL enriched link data
  return {
    code: shortCode,
    shortUrl,
    qrCodeUrl,
    tenantId,
    tenantName,
    domain,
    pathPrefix,
    publicCode: publicCode || shortCode,
    status: safetyOutcome.status,
    safety: safetyOutcome.safety,
    destinationType,
    campaignId,
    requiresAuth,
    audience,
    source,
    intent,
    returnTo,
    conversionGoal,
    destinationCategory,
    destinationTemplate,
    destinations: linkDoc.destinations,
    title,
    description,
    metadata: sanitizedMetadata,
    utm: normalizedUtm,
    expiresAt,
    clickCount: 0,
    installCount: 0,
    enabled,
    createdBy,
    apiKeyId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}



/**
 * List all short links with optional filtering
 * MULTI-TENANT: Now filters by tenantId
 */
async function listLinks(filters = {}) {
  const { enabled, limit = 200, tenantId } = filters;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));

  let query = db.collection('short_links');

  if (tenantId) {
    query = query.where('tenantId', '==', tenantId);
  }
  
  // Filter by enabled status if specified
  if (enabled !== undefined) {
    query = query.where('enabled', '==', enabled);
  }
  
  // Preferred: server-side ordering by creation date (requires composite index with tenantId)
  let snapshot;
  try {
    snapshot = await query.orderBy('createdAt', 'desc').limit(safeLimit).get();
  } catch (error) {
    const missingIndex = error?.code === 9 || String(error?.message || '').includes('FAILED_PRECONDITION');
    if (!missingIndex) {
      throw error;
    }

    // Fallback: query without orderBy so admin UI remains functional while index is being created.
    console.warn('[SmartLinks] Missing index for ordered listLinks query, using fallback path');
    snapshot = await query.limit(safeLimit).get();
  }

  const links = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }))
    .map(link => {
      // uniqueUsers can become very large and is not needed for list/table views.
      if (Array.isArray(link.uniqueUsers)) {
        delete link.uniqueUsers;
      }
      return link;
    })
    .sort((a, b) => {
    const aMs = a?.createdAt?._seconds ? a.createdAt._seconds * 1000 : Date.parse(a?.createdAt || 0) || 0;
    const bMs = b?.createdAt?._seconds ? b.createdAt._seconds * 1000 : Date.parse(b?.createdAt || 0) || 0;
    return bMs - aMs;
  });

  return {
    links,
    total: links.length
  };
}

/**
 * Get a short code link by code
 */
async function getShortLink(code) {
  const linkDoc = await db.collection('short_links').doc(code).get();

  if (!linkDoc.exists) {
    const error = new Error('Short code not found');
    error.code = 'NOT_FOUND';
    throw error;
  }

  return {
    id: linkDoc.id,
    ...linkDoc.data()
  };
}

/**
 * Update a short link
 */
async function updateShortLink(code, updates) {
  const {
    metadata,
    metadataPatch,
    sourceRules,
    utm,
    destinations,
    enabled,
    title,
    description,
    expiresAt,
    destinationType,
    campaignId,
    requiresAuth,
    audience,
    source,
    intent,
    returnTo,
    conversionGoal,
    destinationCategory,
    destinationTemplate
  } = updates;

  const linkRef = db.collection('short_links').doc(code);
  const linkDoc = await linkRef.get();

  if (!linkDoc.exists) {
    const error = new Error('Short code not found');
    error.code = 'NOT_FOUND';
    throw error;
  }

  // Validate destination URLs on update (if destinations are being changed)
  if (destinations) {
    const urlsToCheck = [
      { val: destinations.web, label: 'Web' },
      { val: destinations.ios, label: 'iOS' },
      { val: destinations.android, label: 'Android' },
    ];
    for (const { val, label } of urlsToCheck) {
      if (!val) continue;
      try {
        const parsed = new URL(val);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          const err = new Error(`${label} destination must use https:// or http:// protocol`);
          err.code = 'INVALID_URL';
          throw err;
        }
      } catch (e) {
        if (e.code === 'INVALID_URL') throw e;
        const err = new Error(`${label} destination is not a valid URL`);
        err.code = 'INVALID_URL';
        throw err;
      }
    }
  }

  const updateData = {
    updatedAt: FieldValue.serverTimestamp()
  };

  const currentData = linkDoc.data() || {};

  // Destination domain policy + safety on update — mirrors createShortLink.
  if (destinations) {
    const linkTenantId = currentData.tenantId || DEFAULT_TENANT_ID;
    let tenantDocData = null;
    if (linkTenantId !== DEFAULT_TENANT_ID) {
      const tdoc = await db.collection('tenants').doc(linkTenantId).get();
      tenantDocData = tdoc.exists ? tdoc.data() : null;
    }
    if (destinations.web) {
      assertDestinationAllowed({
        webDestination: destinations.web,
        tenantId: linkTenantId,
        allowedDomains: tenantDocData?.settings?.allowedDomains || null,
        bypass: updates.bypassDomainCheck === true
      });
    }

    const safetyOutcome = await assessForWrite(destinations, {
      tenantId: linkTenantId,
      tenantDocData,
      actorIsSuperAdmin: updates.actorIsSuperAdmin,
      purpose: 'update',
      actor: updates.updatedBy || null
    });
    updateData.safety = safetyOutcome.safety;
    // An operator block survives edits; safety-derived states follow the new destination.
    if (currentData.blockedBy === 'operator' && effectiveStatus(currentData) === LINK_STATUS.BLOCKED) {
      updateData.status = LINK_STATUS.BLOCKED;
    } else {
      updateData.status = safetyOutcome.status;
      if (safetyOutcome.status === LINK_STATUS.ACTIVE) learnDomains(safetyOutcome.safety, linkTenantId);
    }
  }
  if (updates.updatedBy) updateData.updatedBy = updates.updatedBy;

  if (metadata !== undefined) {
    const currentDestinations = currentData.destinations || {};
    const nextWebDestination = destinations?.web !== undefined
      ? destinations.web
      : currentDestinations.web;
    const nextMetadata = sourceRules !== undefined && isPlainObject(metadata)
      ? deepMergeObjects(metadata, { sourceRules })
      : metadata;
    updateData.metadata = sanitizeMetadataForDestination(nextMetadata, nextWebDestination);
  } else if (metadataPatch !== undefined || sourceRules !== undefined) {
    const currentDestinations = currentData.destinations || {};
    const nextWebDestination = destinations?.web !== undefined
      ? destinations.web
      : currentDestinations.web;
    const mergedPatch = deepMergeObjects(
      isPlainObject(metadataPatch) ? metadataPatch : {},
      sourceRules !== undefined ? { sourceRules } : {}
    );
    updateData.metadata = sanitizeMetadataForDestination(
      deepMergeObjects(currentData.metadata || {}, mergedPatch),
      nextWebDestination
    );
  }
  if (utm !== undefined) updateData.utm = normalizeUTM(utm);
  if (destinations !== undefined) updateData.destinations = destinations;
  if (enabled !== undefined) updateData.enabled = enabled;
  if (title !== undefined) updateData.title = title;
  if (description !== undefined) updateData.description = description;
  if (destinationType !== undefined) updateData.destinationType = destinationType;
  if (campaignId !== undefined) updateData.campaignId = campaignId || null;
  if (requiresAuth !== undefined) updateData.requiresAuth = requiresAuth === true;
  if (audience !== undefined) updateData.audience = audience;
  if (source !== undefined) updateData.source = source;
  if (intent !== undefined) updateData.intent = intent;
  if (returnTo !== undefined) updateData.returnTo = returnTo || null;
  if (conversionGoal !== undefined) updateData.conversionGoal = conversionGoal || null;
  if (destinationCategory !== undefined) updateData.destinationCategory = destinationCategory || null;
  if (destinationTemplate !== undefined) updateData.destinationTemplate = destinationTemplate || null;
  if (expiresAt !== undefined) {
    updateData.expiresAt = expiresAt ? admin.firestore.Timestamp.fromDate(new Date(expiresAt)) : null;
  }

  await linkRef.update(updateData);

  const updated = await linkRef.get();
  return {
    id: updated.id,
    ...updated.data()
  };
}

/**
 * Change a link's review/safety status (approve, block, release).
 * Used by the review routes and never by client-supplied fields.
 */
async function setLinkStatus(code, status, { reason = null, actor = null, blockedBy = null } = {}) {
  if (![LINK_STATUS.ACTIVE, LINK_STATUS.HELD, LINK_STATUS.BLOCKED].includes(status)) {
    const error = new Error('Invalid link status');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const linkRef = db.collection('short_links').doc(code);
  const linkDoc = await linkRef.get();
  if (!linkDoc.exists) {
    const error = new Error('Short code not found');
    error.code = 'NOT_FOUND';
    throw error;
  }
  const current = linkDoc.data() || {};
  const update = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
    reviewedAt: FieldValue.serverTimestamp(),
    reviewedBy: actor || null,
    reviewReason: reason || null,
    blockedBy: status === LINK_STATUS.BLOCKED ? (blockedBy || 'operator') : null
  };
  if (status === LINK_STATUS.ACTIVE && current.safety) {
    update.safety = { ...current.safety, verdict: 'allow', reviewed: true };
    learnDomains(current.safety, current.tenantId || DEFAULT_TENANT_ID);
  }
  await linkRef.update(update);

  // Keep the campaign_links record in step for campaign mirrors.
  if (current.isCampaignLink && current.campaignId && current.publicCode) {
    db.collection('campaign_links').doc(`${current.campaignId}_${current.publicCode}`)
      .update({ reviewStatus: status, updatedAt: FieldValue.serverTimestamp() })
      .catch(() => {});
  }

  const updated = await linkRef.get();
  return { before: current, link: { id: updated.id, ...updated.data() } };
}

/**
 * Links waiting for review or blocked, optionally scoped to a tenant.
 */
async function listLinksByStatus(statuses, { tenantId = null, limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const out = [];
  for (const status of statuses) {
    let query = db.collection('short_links').where('status', '==', status);
    if (tenantId) query = query.where('tenantId', '==', tenantId);
    const snapshot = await query.limit(safeLimit).get();
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      delete data.uniqueUsers;
      out.push({ id: doc.id, ...data });
    });
  }
  return out.sort((a, b) => (b.safety?.checkedAtMs || 0) - (a.safety?.checkedAtMs || 0));
}

/**
 * Delete a short link
 */
async function deleteShortLink(code) {
  const linkRef = db.collection('short_links').doc(code);
  const linkDoc = await linkRef.get();

  if (!linkDoc.exists) {
    const error = new Error('Short code not found');
    error.code = 'NOT_FOUND';
    throw error;
  }

  await linkRef.delete();
  return { success: true, code };
}

/**
 * Get link statistics
 */
async function getLinkStats() {
  const countSnapshot = await db.collection('short_links').count().get();
  const totalCount = countSnapshot.data().count;

  // Get total clicks and enabled count
  const linksSnapshot = await db.collection('short_links').select('clickCount', 'enabled').get();

  const totalClicks = linksSnapshot.docs.reduce((sum, doc) => sum + (doc.data().clickCount || 0), 0);
  const enabledCount = linksSnapshot.docs.filter(doc => doc.data().enabled !== false).length;

  return {
    totalLinks: totalCount,
    totalClicks,
    enabledLinks: enabledCount,
    disabledLinks: totalCount - enabledCount
  };
}

/**
 * Get link statistics scoped to a tenant when provided.
 */
async function getLinkStatsForTenant(tenantId) {
  let query = db.collection('short_links');
  if (tenantId) {
    query = query.where('tenantId', '==', tenantId);
  }

  const snapshot = await query.select('clickCount', 'enabled').get();
  const totalCount = snapshot.docs.length;
  const totalClicks = snapshot.docs.reduce((sum, doc) => sum + (doc.data().clickCount || 0), 0);
  const enabledCount = snapshot.docs.filter(doc => doc.data().enabled !== false).length;

  return {
    totalLinks: totalCount,
    totalClicks,
    enabledLinks: enabledCount,
    disabledLinks: totalCount - enabledCount
  };
}

module.exports = {
  createShortLink,    // Create new short link
  listLinks,          // List all links
  getShortLink,       // Get single link
  updateShortLink,    // Update link
  deleteShortLink,    // Delete link
  setLinkStatus,      // Review: approve / block / release
  listLinksByStatus,  // Review queue
  getLinkStats,       // Get global statistics
  getLinkStatsForTenant
};
