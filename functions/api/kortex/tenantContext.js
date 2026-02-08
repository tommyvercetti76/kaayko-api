/**
 * Multi-Tenant Context Management
 * 
 * Handles tenant identification, access control, and scoping for the Smart Links platform.
 * Enables Kaayko to serve multiple external clients/domains with isolated data.
 * 
 * Features:
 * - Tenant identification from user profile or headers
 * - Access control and permission validation
 * - Tenant-scoped Firestore queries
 * - Super-admin cross-tenant access
 * 
 * @module api/kortex/tenantContext
 */

const admin = require('firebase-admin');
const db = admin.firestore();

// Default tenant for existing Kaayko links (backward compatibility)
const DEFAULT_TENANT_ID = 'kaayko-default';

/**
 * Get tenant context from authenticated request
 * Determines which tenant the request is operating on behalf of.
 * 
 * Priority order:
 * 1. x-kaayko-tenant-id header (for multi-tenant admin portals)
 * 2. User's tenantId from admin_users profile
 * 3. API key's tenantId (for programmatic access)
 * 4. Default tenant (kaayko-default)
 * 
 * @param {Object} req - Express request object
 * @param {Object} req.user - Authenticated user (from requireAuth middleware)
 * @param {Object} req.apiClient - API key client (from requireApiKey middleware)
 * @returns {Promise<{tenantId: string, tenantName: string|null, isSuperAdmin: boolean}>}
 */
async function getTenantFromRequest(req) {
  // Priority 1: Explicit tenant header (for super-admins switching tenants)
  const headerTenantId = req.headers['x-kaayko-tenant-id'];
  if (headerTenantId) {
    // Validate that user has permission to access this tenant
    if (req.user && req.user.role === 'super-admin') {
      return {
        tenantId: headerTenantId,
        tenantName: await getTenantName(headerTenantId),
        isSuperAdmin: true
      };
    } else {
      throw new Error('Only super-admins can specify tenant via header');
    }
  }

  // Priority 2: User's tenant from admin_users profile
  if (req.user && req.user.profile) {
    const profile = req.user.profile;
    const userTenantId = profile.tenantId || profile.tenantIds?.[0];
    
    if (userTenantId) {
      return {
        tenantId: userTenantId,
        tenantName: profile.tenantName || await getTenantName(userTenantId),
        isSuperAdmin: req.user.role === 'super-admin'
      };
    }
  }

  // Priority 3: API key's tenant
  if (req.apiClient && req.apiClient.tenantId) {
    return {
      tenantId: req.apiClient.tenantId,
      tenantName: await getTenantName(req.apiClient.tenantId),
      isSuperAdmin: false
    };
  }

  // Priority 4: Default tenant (backward compatibility)
  return {
    tenantId: DEFAULT_TENANT_ID,
    tenantName: 'Kaayko',
    isSuperAdmin: false
  };
}

/**
 * Get tenant name from tenantId (cached lookup)
 * @param {string} tenantId 
 * @returns {Promise<string|null>}
 */
async function getTenantName(tenantId) {
  if (tenantId === DEFAULT_TENANT_ID) return 'Kaayko';
  
  try {
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    return tenantDoc.exists ? tenantDoc.data().name : null;
  } catch (error) {
    console.error('[TenantContext] Failed to fetch tenant name:', error);
    return null;
  }
}

/**
 * Assert that user has access to specified tenant
 * Throws error if access denied
 * 
 * @param {Object} user - User object from req.user
 * @param {string} tenantId - Tenant ID to check access for
 * @throws {Error} If user lacks access to tenant
 */
function assertTenantAccess(user, tenantId) {
  if (!user) {
    throw new Error('User authentication required');
  }

  // Super-admins have access to all tenants
  if (user.role === 'super-admin') {
    return;
  }

  // Check if user belongs to this tenant
  const userProfile = user.profile;
  if (!userProfile) {
    throw new Error('User profile not found');
  }

  const userTenantId = userProfile.tenantId;
  const userTenantIds = userProfile.tenantIds || (userTenantId ? [userTenantId] : []);

  if (!userTenantIds.includes(tenantId)) {
    throw new Error(`Access denied to tenant: ${tenantId}`);
  }
}

/**
 * Create tenant-scoped Firestore query
 * Automatically filters collection by tenantId
 * 
 * @param {string} collectionName - Firestore collection name
 * @param {string} tenantId - Tenant ID to filter by
 * @returns {FirebaseFirestore.Query} Scoped query
 */
function createTenantScopedQuery(collectionName, tenantId) {
  return db.collection(collectionName).where('tenantId', '==', tenantId);
}

/**
 * Middleware to attach tenant context to request
 * Usage: router.use(attachTenantContext)
 * 
 * @middleware
 */
async function attachTenantContext(req, res, next) {
  try {
    req.tenantContext = await getTenantFromRequest(req);
    console.log('[TenantContext] Request tenant:', req.tenantContext.tenantId);
    next();
  } catch (error) {
    console.error('[TenantContext] Failed to determine tenant:', error);
    return res.status(403).json({
      success: false,
      error: 'Tenant access denied',
      message: error.message,
      code: 'TENANT_ACCESS_DENIED'
    });
  }
}

/**
 * Migrate existing short_links to default tenant (one-time operation)
 * Run this to add tenantId to existing links
 * 
 * @returns {Promise<{updated: number, errors: number}>}
 */
async function migrateExistingLinksToDefaultTenant() {
  console.log('[TenantContext] Starting migration of existing links to default tenant...');
  
  const linksSnapshot = await db.collection('short_links')
    .where('tenantId', '==', null)
    .get();

  const batch = db.batch();
  let updateCount = 0;
  let errorCount = 0;

  for (const doc of linksSnapshot.docs) {
    try {
      batch.update(doc.ref, {
        tenantId: DEFAULT_TENANT_ID,
        tenantName: 'Kaayko',
        domain: 'kaayko.com',
        pathPrefix: '/l',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      updateCount++;
    } catch (error) {
      console.error(`[TenantContext] Migration error for ${doc.id}:`, error);
      errorCount++;
    }
  }

  if (updateCount > 0) {
    await batch.commit();
    console.log(`[TenantContext] Migration complete: ${updateCount} links updated, ${errorCount} errors`);
  }

  return { updated: updateCount, errors: errorCount };
}

/**
 * Create a new tenant
 * 
 * @param {Object} tenantData 
 * @param {string} tenantData.id - Unique tenant identifier (e.g., 'client-x')
 * @param {string} tenantData.name - Display name (e.g., 'Client X')
 * @param {string} tenantData.domain - Primary domain (e.g., 'go.clientx.com')
 * @param {string} tenantData.pathPrefix - Path prefix for short links (default: '/l')
 * @param {Object} tenantData.settings - Tenant-specific settings
 * @returns {Promise<Object>} Created tenant document
 */
async function createTenant(tenantData) {
  const {
    id,
    name,
    domain = 'kaayko.com',
    pathPrefix = '/l',
    settings = {}
  } = tenantData;

  if (!id || !name) {
    throw new Error('Tenant id and name are required');
  }

  // Check if tenant already exists
  const existingTenant = await db.collection('tenants').doc(id).get();
  if (existingTenant.exists) {
    throw new Error(`Tenant ${id} already exists`);
  }

  const tenantDoc = {
    id,
    name,
    domain,
    pathPrefix,
    settings,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    enabled: true
  };

  await db.collection('tenants').doc(id).set(tenantDoc);
  console.log(`[TenantContext] Created tenant: ${id} (${name})`);

  return tenantDoc;
}

module.exports = {
  getTenantFromRequest,
  getTenantName,
  assertTenantAccess,
  createTenantScopedQuery,
  attachTenantContext,
  migrateExistingLinksToDefaultTenant,
  createTenant,
  DEFAULT_TENANT_ID
};
