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
    apiKeyId = null
  } = data;

  // If caller provided a custom short code (alias), validate and use it
  let providedCode = data.code || data.shortCode || null;
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
  const shortUrl = `${shortDomain}${pathPrefix}/${shortCode}`;
  const qrCodeUrl = `${shortDomain}/qr/${shortCode}.png`;

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
    apiKeyId, // Track which API key created this
    
    destinations: {
      ios: iosDestination || null,
      android: androidDestination || null,
      web: webDestination || null
    },
    title,
    description,
    metadata, // Custom key-value data
    utm, // UTM tracking params
    expiresAt: expiresAt ? admin.firestore.Timestamp.fromDate(new Date(expiresAt)) : null,
    clickCount: 0,
    installCount: 0,
    uniqueUsers: [],
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
    destinations: linkDoc.destinations,
    title,
    description,
    metadata,
    utm,
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
  const { enabled, limit = 100, tenantId } = filters;

  let query = db.collection('short_links');
  
  // Filter by enabled status if specified
  if (enabled !== undefined) {
    query = query.where('enabled', '==', enabled);
  }
  
  // Order by creation date (newest first)
  query = query.orderBy('createdAt', 'desc');
  
  const snapshot = await query.limit(limit).get();

  const links = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

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
  const { metadata, utm, destinations, enabled, title, description, expiresAt } = updates;

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

  if (metadata !== undefined) updateData.metadata = metadata;
  if (utm !== undefined) updateData.utm = utm;
  if (destinations !== undefined) updateData.destinations = destinations;
  if (enabled !== undefined) updateData.enabled = enabled;
  if (title !== undefined) updateData.title = title;
  if (description !== undefined) updateData.description = description;
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

module.exports = {
  createShortLink,    // Create new short link
  listLinks,          // List all links
  getShortLink,       // Get single link
  updateShortLink,    // Update link
  deleteShortLink,    // Delete link
  getLinkStats        // Get statistics
};
