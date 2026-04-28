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

const db = admin.firestore();

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
    conversionGoal = metadata.conversionGoal || null
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

  // Validate: must have at least one destination
  if (!iosDestination && !androidDestination && !webDestination) {
    throw new Error('At least one destination (iOS, Android, or Web) is required');
  }

  // Determine short code: use provided one or generate
  let shortCode = providedCode;
  if (!shortCode) {
    let attempts = 0;
    do {
      shortCode = generateShortCode();
      const existingLink = await db.collection('short_links').doc(shortCode).get();
      if (!existingLink.exists) break;
      attempts++;
    } while (attempts < 5);
    
    if (attempts >= 5) {
      throw new Error('Failed to generate unique short code after 5 attempts');
    }
  }

  // Construct short URL with tenant's domain
  const shortDomain = domain.startsWith('http') ? domain : `https://${domain}`;
  const shortUrl = `${shortDomain}${pathPrefix}/${publicCode || shortCode}`;
  const qrCodeUrl = `${shortDomain}/qr/${shortCode}.png`;

  const sanitizedMetadata = sanitizeMetadataForDestination(metadata, webDestination);
  const normalizedUtm = normalizeUTM(utm);

  // Create ENRICHED short link document with ALL metadata + multi-tenant fields
  const linkDoc = {
    code: shortCode,
    shortUrl,
    qrCodeUrl,
    
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
    createdBy, // Audit trail: who created this
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  // Save to Firestore
  await db.collection('short_links').doc(shortCode).set(linkDoc);

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
    destinationType,
    campaignId,
    requiresAuth,
    audience,
    source,
    intent,
    returnTo,
    conversionGoal,
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
    conversionGoal
  } = updates;

  const linkRef = db.collection('short_links').doc(code);
  const linkDoc = await linkRef.get();

  if (!linkDoc.exists) {
    const error = new Error('Short code not found');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const updateData = {
    updatedAt: FieldValue.serverTimestamp()
  };

  const currentData = linkDoc.data() || {};
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
  getLinkStats,       // Get global statistics
  getLinkStatsForTenant
};
