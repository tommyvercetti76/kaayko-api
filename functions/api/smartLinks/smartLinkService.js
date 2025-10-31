/**
 * Smart Link Service Layer
 * All business logic for CRUD operations
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { enrichMetadata } = require('./smartLinkEnrichment');
const { getDefaultDestinations } = require('./smartLinkDefaults');
const { 
  generateShortCode, 
  isValidLinkId, 
  isValidShortCode, 
  isValidSpace 
} = require('./smartLinkValidation');

const db = admin.firestore();

/**
 * Create a structured smart link
 */
async function createStructuredLink(data) {
  const {
    space,
    linkId,
    iosDestination,
    androidDestination,
    webDestination,
    metadata = {},
    utm = {},
    autoEnrich = false,
    bypassSecretCheck = false,
    createdBy = 'system'
  } = data;

  // Validation
  if (!space || !isValidSpace(space)) {
    throw new Error(`Invalid space: ${space}`);
  }

  if (!linkId || !isValidLinkId(linkId)) {
    throw new Error('Invalid link ID format');
  }

  // Check if link already exists  
  const linkKey = `${space}_${linkId}`;
  const existingLink = await db.collection('smart_links').doc(linkKey).get();

  if (existingLink.exists) {
    const error = new Error('Link already exists');
    error.code = 'ALREADY_EXISTS';
    error.existing = {
      space,
      linkId,
      shortUrl: `https://kaayko.com/l/${space}/${linkId}`
    };
    throw error;
  }

  // Auto-enrich metadata if requested
  let finalMetadata = metadata;
  if (autoEnrich) {
    const enriched = await enrichMetadata(space, linkId);
    if (enriched) {
      finalMetadata = { ...metadata, ...enriched };
    }
  }

  // Generate destinations with smart defaults
  const destinations = getDefaultDestinations(space, linkId, {
    iosDestination,
    androidDestination,
    webDestination
  });

  // Create link document
  const linkDoc = {
    space,
    linkId,
    shortUrl: `https://kaayko.com/l/${space}/${linkId}`,
    qrCodeUrl: `https://kaayko.com/qr/${space}/${linkId}.png`,
    destinations,
    metadata: finalMetadata,
    utm,
    bypassSecretCheck,
    clickCount: 0,
    installCount: 0,
    uniqueUsers: [],
    enabled: true,
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  // Save to Firestore
  await db.collection('smart_links').doc(linkKey).set(linkDoc);

  return {
    space,
    linkId,
    shortUrl: `https://kaayko.com/l/${space}/${linkId}`,
    qrCodeUrl: `https://kaayko.com/qr/${space}/${linkId}.png`,
    iosUrl: `https://kaayko.com/${space}/${linkId}?platform=ios`,
    androidUrl: `https://kaayko.com/${space}/${linkId}?platform=android`,
    webUrl: `https://kaayko.com/${space}/${linkId}`,
    metadata: finalMetadata,
    clickCount: 0,
    createdAt: new Date().toISOString()
  };
}

/**
 * Create a short code link (Branch-style)
 */
async function createShortCodeLink(data) {
  const {
    code,
    space = 'custom',
    linkId = null,
    iosDestination,
    androidDestination,
    webDestination,
    metadata = {},
    utm = {},
    bypassSecretCheck = false,
    createdBy = 'system'
  } = data;

  // Generate or validate short code
  let shortCode;
  if (code) {
    if (!isValidShortCode(code)) {
      throw new Error('Invalid short code format');
    }
    
    // Check if code already exists
    const existingLink = await db.collection('short_links').doc(code).get();
    if (existingLink.exists) {
      const error = new Error('Short code already exists');
      error.code = 'ALREADY_EXISTS';
      error.existing = {
        code,
        shortUrl: `https://kaayko.com/l/${code}`
      };
      throw error;
    }
    
    shortCode = code;
  } else {
    // Generate random code
    let attempts = 0;
    do {
      shortCode = generateShortCode();
      const existingLink = await db.collection('short_links').doc(shortCode).get();
      if (!existingLink.exists) break;
      attempts++;
    } while (attempts < 5);
    
    if (attempts >= 5) {
      throw new Error('Failed to generate unique short code');
    }
  }

  // Validate space if provided
  if (space && !isValidSpace(space)) {
    throw new Error(`Invalid space: ${space}`);
  }

  // Generate destinations
  const destinations = linkId 
    ? getDefaultDestinations(space, linkId, {
        iosDestination,
        androidDestination,
        webDestination
      })
    : {
        ios: iosDestination || `kaayko://custom/${shortCode}`,
        android: androidDestination || `kaayko://custom/${shortCode}`,
        web: webDestination || `https://kaayko.com/?ref=${shortCode}`
      };

  // Create short link document
  const linkDoc = {
    code: shortCode,
    space: space || 'custom',
    linkId: linkId || null,
    shortUrl: `https://kaayko.com/l/${shortCode}`,
    qrCodeUrl: `https://kaayko.com/qr/${shortCode}.png`,
    destinations,
    metadata,
    utm,
    bypassSecretCheck,
    clickCount: 0,
    installCount: 0,
    uniqueUsers: [],
    enabled: true,
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  // Save to Firestore
  await db.collection('short_links').doc(shortCode).set(linkDoc);

  return {
    code: shortCode,
    space: space || 'custom',
    linkId,
    shortUrl: `https://kaayko.com/l/${shortCode}`,
    qrCodeUrl: `https://kaayko.com/qr/${shortCode}.png`,
    iosUrl: `https://kaayko.com/l/${shortCode}?platform=ios`,
    androidUrl: `https://kaayko.com/l/${shortCode}?platform=android`,
    webUrl: `https://kaayko.com/l/${shortCode}`,
    metadata,
    clickCount: 0,
    createdAt: new Date().toISOString()
  };
}

/**
 * List all links with optional filtering
 */
async function listLinks(filters = {}) {
  const { space, enabled, limit = 100 } = filters;

  // Get structured links
  let structuredQuery = db.collection('smart_links');
  if (space) {
    structuredQuery = structuredQuery.where('space', '==', space);
  }
  if (enabled !== undefined) {
    structuredQuery = structuredQuery.where('enabled', '==', enabled);
  }
  const structuredSnapshot = await structuredQuery.limit(limit).get();

  // Get short code links
  let shortQuery = db.collection('short_links');
  if (space) {
    shortQuery = shortQuery.where('space', '==', space);
  }
  if (enabled !== undefined) {
    shortQuery = shortQuery.where('enabled', '==', enabled);
  }
  const shortSnapshot = await shortQuery.limit(limit).get();

  // Combine results
  const structuredLinks = structuredSnapshot.docs.map(doc => ({
    id: doc.id,
    type: 'structured',
    ...doc.data()
  }));

  const shortLinks = shortSnapshot.docs.map(doc => ({
    id: doc.id,
    type: 'short',
    ...doc.data()
  }));

  return {
    structured: structuredLinks,
    short: shortLinks,
    total: structuredLinks.length + shortLinks.length
  };
}

/**
 * Get a single link by space/linkId
 */
async function getStructuredLink(space, linkId) {
  const linkKey = `${space}_${linkId}`;
  const linkDoc = await db.collection('smart_links').doc(linkKey).get();

  if (!linkDoc.exists) {
    const error = new Error('Link not found');
    error.code = 'NOT_FOUND';
    throw error;
  }

  return {
    id: linkDoc.id,
    type: 'structured',
    ...linkDoc.data()
  };
}

/**
 * Get a short code link
 */
async function getShortCodeLink(code) {
  const linkDoc = await db.collection('short_links').doc(code).get();

  if (!linkDoc.exists) {
    const error = new Error('Short code not found');
    error.code = 'NOT_FOUND';
    throw error;
  }

  return {
    id: linkDoc.id,
    type: 'short',
    ...linkDoc.data()
  };
}

/**
 * Update a short code link
 */
async function updateShortCodeLink(code, updates) {
  const { metadata, utm, destinations, enabled } = updates;

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

  await linkRef.update(updateData);

  const updated = await linkRef.get();
  return {
    id: updated.id,
    type: 'short',
    ...updated.data()
  };
}

/**
 * Update a structured link
 */
async function updateStructuredLink(space, linkId, updates) {
  const { metadata, utm, destinations, enabled } = updates;

  const linkKey = `${space}_${linkId}`;
  const linkRef = db.collection('smart_links').doc(linkKey);
  const linkDoc = await linkRef.get();

  if (!linkDoc.exists) {
    const error = new Error('Link not found');
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

  await linkRef.update(updateData);

  const updated = await linkRef.get();
  return {
    id: updated.id,
    type: 'structured',
    ...updated.data()
  };
}

/**
 * Delete a short code link
 */
async function deleteShortCodeLink(code) {
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
 * Delete a structured link
 */
async function deleteStructuredLink(space, linkId) {
  const linkKey = `${space}_${linkId}`;
  const linkRef = db.collection('smart_links').doc(linkKey);
  const linkDoc = await linkRef.get();

  if (!linkDoc.exists) {
    const error = new Error('Link not found');
    error.code = 'NOT_FOUND';
    throw error;
  }

  await linkRef.delete();
  return { success: true, space, linkId };
}

/**
 * Get link statistics
 */
async function getLinkStats() {
  const [structuredSnapshot, shortSnapshot] = await Promise.all([
    db.collection('smart_links').count().get(),
    db.collection('short_links').count().get()
  ]);

  const structuredCount = structuredSnapshot.data().count;
  const shortCount = shortSnapshot.data().count;

  // Get total clicks (sum of clickCount field)
  const [structuredLinks, shortLinks] = await Promise.all([
    db.collection('smart_links').select('clickCount', 'enabled').get(),
    db.collection('short_links').select('clickCount', 'enabled').get()
  ]);

  const totalClicks = [...structuredLinks.docs, ...shortLinks.docs]
    .reduce((sum, doc) => sum + (doc.data().clickCount || 0), 0);

  const enabledCount = [...structuredLinks.docs, ...shortLinks.docs]
    .filter(doc => doc.data().enabled !== false).length;

  return {
    totalLinks: structuredCount + shortCount,
    structuredLinks: structuredCount,
    shortLinks: shortCount,
    totalClicks,
    enabledLinks: enabledCount,
    disabledLinks: (structuredCount + shortCount) - enabledCount
  };
}

module.exports = {
  createStructuredLink,
  createShortCodeLink,
  listLinks,
  getStructuredLink,
  getShortCodeLink,
  updateShortCodeLink,
  updateStructuredLink,
  deleteShortCodeLink,
  deleteStructuredLink,
  getLinkStats
};
