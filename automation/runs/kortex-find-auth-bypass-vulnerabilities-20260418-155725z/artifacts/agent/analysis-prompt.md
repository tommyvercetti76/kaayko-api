You are a careful local coding agent reviewing Node.js Firebase Cloud Functions API files for duplication reduction and safe improvements.
Run ID: kortex-find-auth-bypass-vulnerabilities-20260418-155725z
Track: kortex
Area: kortex
Goal: Find auth bypass vulnerabilities

PORTFOLIO COACHING
Portfolio overview: Kaayko API is a Firebase Cloud Functions Express backend. Every route is mounted through functions/index.js. Safe agent work must preserve route contracts, auth middleware chains, Firestore access patterns, and existing error-handling shapes. Security and tenant isolation are the highest-priority concerns.
Guided products: KORTEX Platform API, Shared API Infrastructure
Primary focus products: KORTEX Platform API
Source docs: README.md, functions/api/smartLinks/README.md, functions/middleware/README.md

Focused doc snapshots:
- README.md: Kaayko API What this repo powers | Product | Purpose | Mounted base paths on `api` | Primary frontend consumers | Product guide | | Kreator | Creator applications, onboarding, profile, admin review | `/kreators` | `kaayko/src/kreator/*` | [`docs/products/KREATOR.md`](./docs/products/KREATOR.md) | Architecture Runtime: Firebase Functions v2, Node.js 22, Express app exported as `api`. Storage and state: Firebase Admin, Firestore, Cloud Storage, Firebase Auth. Payments: Stripe checkout/payment intent and webhook flows.
- functions/api/smartLinks/README.md: 🔗 Smart Links API v4 — Short codes & Link Management This module implements the Smart Links service used by Kaayko to create short shareable links (short codes + optional semantic paths), handle redirects and track analytics. `smartLinks.js` — primary Express router for `/api/smartlinks` `smartLinkService.js` — core CRUD + stats business logic (writes to Firestore) `redirectHandler.js` — redirect logic, platform detection, click tracking `publicRouter.js` — lightweight public router for `/l/:id` and `/resolve` (deferred linking) helpers: `smartLinkValidation.js`, `smartLinkDefaults.js`, `smartLinkEnrichment.js` For each endpoint we show: Endpoint, Method, Description, Auth, Request (path / query / body), Response (shape + example), Errors, Side effects.

Product: KORTEX Platform API (Primary focus)
Purpose: Protect smart-link CRUD, tenant auth claims, redirect handling, analytics recording, billing visibility, and QR flows as a security-critical multi-tenant surface.
API paths:
  - functions/api/smartLinks/
  - functions/api/billing/
  - functions/api/auth/
Backend routes:
  - GET /smartlinks
  - POST /smartlinks
  - PUT /smartlinks/:id
  - DELETE /smartlinks/:id
  - GET /l/:id
  - GET /resolve
  - GET /billing/*
  - GET /auth/*
Validation focus:
  - Verify tenant isolation — every data read/write must scope to the authenticated tenant.
  - Confirm public redirect paths cannot access admin data or mutation endpoints.
  - Validate auth claim checks (admin boolean) run before any tenant-mutation route.
  - Ensure analytics recording is append-only and cannot be manipulated by the client.
Risk focus:
  - KORTEX has the highest tenant isolation risk — a missing scope check leaks all tenant data.
  - Public redirect (/l/:id) is unauthenticated — it must never resolve admin routes.
  - Billing endpoints must be read-only from the tenant perspective.
  - Auth token claims must be verified server-side — never trust client-sent admin flags.

Product: Shared API Infrastructure (Supporting context)
Purpose: Protect the middleware stack, auth guards, error handling, CORS, Firebase Admin initialization, and rate limiting that all routes depend on.
API paths:
  - functions/middleware/
  - functions/api/core/
  - functions/index.js
  - functions/api/auth/
  - functions/utils/
Backend routes:
  - /health
  - /api/**
Validation focus:
  - Verify middleware execution order is preserved for every mounted router.
  - Ensure auth claim validation runs before any data mutation endpoint.
  - Confirm error handlers return consistent shapes without leaking stack traces.
  - Validate Firebase Admin SDK is initialized once and not duplicated per-request.
Risk focus:
  - Middleware order bugs are silent — a reorder can bypass security checks entirely.
  - Firebase Admin double-initialization causes memory and auth failures.
  - Error shape inconsistencies cause frontend parsing failures across multiple products.
  - CORS misconfiguration can silently allow unauthorized cross-origin requests.

Analyze the selected files. Propose only low-risk, behavior-preserving edits.
You should surface both safe cleanup suggestions and any real API risks you see around:
- Auth middleware chain integrity
- Tenant isolation (smart links, billing, kreator scoping)
- Firestore access patterns (correct collection paths, security rules alignment)
- Route contracts (request/response shapes that the frontend depends on)
- Error handling consistency (no raw stack traces leaked to clients)
- Rate limiting and CORS configuration

Return JSON only using this exact shape:
{"summary":"...","insights":["..."],"findings":[{"severity":"low|medium|high","title":"...","detail":"...","category":"duplication|maintainability|security|auth|billing|tenant|contract|error-handling","file_paths":["repo:path"]}],"followups":["..."],"safe_edits":[{"path":"repo:path","kind":"rewrite","summary":"...","confidence":0.0,"content":"full file contents"}]}

Rules:
- `safe_edits` may contain at most 2 entries.
- Only rewrite files from the provided file list.
- Keep changes localized and behavior-preserving.
- If you are not highly confident, return an empty `safe_edits` array.
- NEVER remove or weaken auth middleware, rate limiting, or tenant isolation checks.
- NEVER change Stripe webhook handler logic, payment intent creation, or billing routes.
- Preserve Express route contracts — do not change response shapes clients depend on.
- Preserve middleware execution order — reordering can silently bypass security.
- When you call out a risk, attach the most relevant `file_paths` from the provided file list.

FILE: api:functions/middleware/authMiddleware.js
LINES: 316
CHARS: 8842
TRUNCATED: yes (showing 7058 of 8842 chars)
--- BEGIN CONTENT ---
/**
 * Enterprise-Grade Authentication Middleware
 * 
 * Features:
 * - Firebase ID token verification
 * - Role-based access control (RBAC)
 * - Admin user validation via Firestore
 * - Secure error handling
 * 
 * Usage:
 *   const { requireAuth, requireAdmin, requireRole } = require('./middleware/authMiddleware');
 *   
 *   router.get('/admin/data', requireAdmin, handler);
 *   router.post('/create', requireRole(['admin', 'editor']), handler);
 */

const admin = require('firebase-admin');

/**
 * Verify Firebase ID token and attach user to request
 * @middleware
 */
async function requireAuth(req, res, next) {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'No authentication token provided',
        code: 'AUTH_TOKEN_MISSING'
      });
    }

    const idToken = authHeader.split('Bearer ')[1];

    // Verify the ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Attach user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      authTime: decodedToken.auth_time,
      iat: decodedToken.iat,
      exp: decodedToken.exp
    };

    // Fetch user profile from Firestore
    const userDoc = await admin.firestore()
      .collection('admin_users')
      .doc(decodedToken.uid)
      .get();

    if (userDoc.exists) {
      req.user.profile = userDoc.data();
      req.user.role = userDoc.data().role || 'viewer';
      req.user.permissions = userDoc.data().permissions || [];
    } else {
      // User authenticated but not in admin_users collection
      req.user.role = null;
      req.user.profile = null;
    }

    next();

  } catch (error) {
    console.error('[Auth] Token verification failed:', error.message);
    
    // Specific error handling
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        message: 'Your session has expired. Please log in again.',
        code: 'AUTH_TOKEN_EXPIRED'
      });
    }

    if (error.code === 'auth/argument-error') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        message: 'The authentication token is invalid.',
        code: 'AUTH_TOKEN_INVALID'
      });
    }

    return res.status(401).json({
      success: false,
      error: 'Authentication failed',
      message: 'Unable to verify authentication token.',
      code: 'AUTH_FAILED'
    });
  }
}

/**
 * Require user to be an admin (super-admin or admin role)
 * Supports two authentication methods:
 * 1. Firebase Auth (Bearer token) with admin role
 * 2. X-Admin-Key header with valid admin passphrase
 * @middleware - Must be used after requireAuth (or standalone with X-Admin-Key)
 */
function requireAdmin(req, res, next) {
  // Check for X-Admin-Key header (simpler admin access for internal tools)
  const adminKey = req.headers['x-admin-key'];
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
  const ADMIN_PASSPHRASE = isEmulator
    ? (process.env.ADMIN_PASSPHRASE || 'dev-admin-local-only')
    : (process.env.ADMIN_PASSPHRASE || process.env.KORTEX_SYNC_KEY);
  
  if (!ADMIN_PASSPHRASE && !isEmulator) {
    console.error('[SECURITY] ADMIN_PASSPHRASE not configured - admin access disabled');
    return res.status(503).json({
      success: false,
      error: 'Service Unavailable',
      message: 'Admin authentication not configured',
      code: 'ADMIN_NOT_CONFIGURED'
    });
  }
  
  if (adminKey && ADMIN_PASSPHRASE && adminKey === ADMIN_PASSPHRASE) {
    // Admin key is valid - grant access
    req.user = req.user || { uid: 'admin-key-user', email: 'admin@kaayko.com', role: 'admin' };
    req.user.role = 'admin';
    req.user.authMethod = 'admin-key';
    return next();
  }

  // Fall back to Firebase Auth check
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required. Provide Bearer token or X-Admin-Key header.',
      code: 'AUTH_REQUIRED'
    });
  }

  if (!req.user.role) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'User is not authorized as an admin. Contact system administrator.',
      code: 'NOT_ADMIN_USER'
    });
  }

  const adminRoles = ['super-admin', 'admin'];
  if (!adminRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: `Access denied. Required role: admin. Your role: ${req.user.role}`,
      code: 'INSUFFICIENT_PERMISSIONS'
    });
  }

  next();
}

/**
 * Require user to have specific role(s)
 * @param {string|string[]} allowedRoles - Single role or array of allowed roles
 * @middleware - Must be used after requireAuth
 */
function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!req.user.role) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'User is not authorized. Contact system administrator.',
        code: 'NO_ROLE_ASSIGNED'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: `Access denied. Required roles: ${roles.join(', ')}. Your role: ${req.user.role}`,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
}

/**
 * Require user to have specific permission(s)
 * @param {string|string[]} requiredPermissions - Single permission or array
 * @middleware - Must be used after requireAuth
 */
function requirePermission(requiredPermissions) {
  const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
  
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const userPermissions = req.user.permissions || [];
    
    // Super-admins have all permissions
    if (req.user.role === 'super-admin') {
      return next();
    }

    // Check if user has all required permissions
    const hasAllPermissions = permissions.every(p => userPermissions.includes(p));
    
    if (!hasAllPermissions) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: `Missing required permiss
/* [truncated — 8842 chars total, showing first 7000] */

--- END CONTENT ---

FILE: api:functions/api/smartLinks/publicRouter.js
LINES: 214
CHARS: 7256
TRUNCATED: yes (showing 7058 of 7256 chars)
--- BEGIN CONTENT ---
/**
 * @fileoverview Public Smart Link Router - Entry Point for /l/:id
 * @description Handles Smart Links (lkXXXX) only. Clean, minimal router that delegates to redirectHandler.
 * 
 * @module api/smartLinks/publicRouter
 * 
 * @routes
 * - GET /l/:id   → Smart link redirect (lkXXXX format from short_links collection)
 * - GET /resolve → Context restoration for iOS deferred deep linking
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// Import unified redirect system
const {
  handleRedirect
} = require('./redirectHandler');

// Import attribution service
const {
  resolveContext
} = require('./attributionService');

// Import rate limiting
const { ipRateLimit } = require('./rateLimitService');

const db = admin.firestore();

// Security configuration - Apply IP-based rate limiting
// More lenient for public redirects (high traffic expected)
router.use(ipRateLimit({ 
  maxRequests: 100, // 100 requests per minute per IP
  windowSeconds: 60,
  message: 'Too many link clicks from this IP. Please wait a moment.'
}));



// ============================================================================
// PUBLIC ROUTES
// ============================================================================

/**
 * Smart Link redirect handler (entry point for kaayko.com/l/:id).
 * Handles ONLY Smart Links (lkXXXX format) from short_links collection.
 * 
 * @async
 * @route GET /l/:id
 * 
 * @param {Express.Request} req - Express request object
 * @param {string} req.params.id - Short code (e.g. 'lk1ngp')
 * @param {Object} req.query - UTM parameters and other query strings
 * @param {Express.Response} res - Express response object
 * 
 * @returns {Promise<void>} Redirects user or sends error page
 * 
 * @example
 * // Smart link redirect
 * GET /l/lk1ngp?utm_source=ios&utm_campaign=share
 * // → Checks short_links collection → Redirects with platform detection + analytics
 * 
 * @example
 * // 404 error
 * GET /l/invalid999
 * // → Link not found → Branded error page
 */
router.get("/l/:id", async (req, res) => {
  // Delegate directly to handler - no pre-flight check needed
  // handleRedirect() already handles 404/410/500 internally
  return handleRedirect(req, res, req.params.id, { trackAnalytics: true });
});

/**
 * ENHANCED: Context resolution + install attribution endpoint.
 * Called by mobile apps on first open after installation.
 * 
 * Features:
 * - Click-to-install attribution via clickId
 * - Deferred deep link context resolution
 * - Backward compatible with legacy cookie/ctx_tokens resolution
 * - Tracks install events and conversion metrics
 * 
 * @async
 * @route GET /resolve
 * 
 * @param {Express.Request} req - Express request object
 * @param {string} req.query.clickId - Click ID from deep link (NEW - for attribution)
 * @param {string} req.query.deviceId - Stable device identifier (NEW)
 * @param {string} req.query.platform - ios|android (NEW)
 * @param {string} req.query.appVersion - App version string (NEW)
 * @param {string} req.query.userId - Optional user ID if logged in
 * @param {string} req.query.id - Legacy context ID (backward compatibility)
 * @param {Object} req.cookies - Cookie object with preserved context (legacy)
 * @param {Express.Response} res - Express response object
 * 
 * @returns {Promise<void>} JSON response with attribution result
 * @returns {boolean} success - Operation status
 * @returns {string} source - Data source ('click_attribution', 'cache', 'database', 'not_found')
 * @returns {boolean} attributed - Whether install was attributed to a click
 * @returns {boolean} isNewInstall - First time attribution vs. repeat call
 * @returns {Object} context - Link context (destinations, utm, metadata, campaign info)
 * @returns {string} timestamp - ISO timestamp
 * 
 * @example
 * // NEW: Attribution-based resolution (primary use case)
 * GET /resolve?clickId=c_abc123&deviceId=uuid-456&platform=ios&appVersion=1.0.0
 * // → Attributes install, returns:
 * // { success: true, source: 'click_attribution', attributed: true, 
 * //   isNewInstall: true, context: { linkCode, utm, destinations, ... } }
 * 
 * @example
 * // Legacy: Cookie-based resolution (backward compatible)
 * GET /resolve
 * Cookie: kaayko_location={"id":"antero","name":"Antero Reservoir",...}
 * // → { success: true, source: 'cache', attributed: false, context: {...} }
 * 
 * @example
 * // Organic install (no attribution)
 * GET /resolve?platform=ios&appVersion=1.0.0
 * // → { success: false, source: 'not_found', attributed: false, 
 * //     message: 'App opened without attribution context...' }
 */
router.get("/resolve", async (req, res) => {
  try {
    // NEW: Attribution-based resolution via clickId
    const clickId = req.query.clickId;
    const deviceId = req.query.deviceId;
    const platform = req.query.platform;
    const appVersion = req.query.appVersion;
    const userId = req.query.userId;

    // If clickId provided, use new attribution flow
    if (clickId || deviceId) {
      const result = await resolveContext({
        clickId,
        deviceId,
        platform,
        appVersion,
        userId,
        metadata: {
          userAgent: req.get('user-agent'),
          ip: req.ip || req.connection.remoteAddress
        }
      });
      
      return res.json(result);
    }

    // LEGACY: Cookie/database-based resolution (backward compatibility)
    const ctxId = req.query.id || 
                  (req.cookies && req.cookies.kaayko_ctxid) || 
                  (req.cookies && req.cookies.kaayko_lake_id);
    const cachedLocation = req.cookies && req.cookies.kaayko_location;
    
    // Try cookie cache first (fastest)
    if (cachedLocation) {
      try {
        const locationData = JSON.parse(cachedLocation);
        return res.json({
          success: true,
          source: 'cache',
          attributed: false,
          context: locationData,
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        console.error('[PublicLink] Cache parse error:', e);
      }
    }
    
    // Fallback to database
    if (ctxId) {
      try {
        const ctxDoc = await db.collection('ctx_tokens').doc(ctxId).get();
        if (ctxDoc.exists) {
          const ctxData = ctxDoc.data();
          return res.json({
            success: true,
            source: 'database',
            attributed: false,
            context: ctxData.params,
            timestamp: new Date().toISOString()
          });
        }
      } catch (dbError) {
        console.error('[PublicLink] Database error:', dbError);
      }
    }
    
    // Context not found (organic install)
    return res.status(404).json({
      success: false,
      source: 'not_found',
      attributed: false,
      error: 'Context not found',
      message: 'App opened without attribution context. This is normal for organic installs.',
      ctxId: ctxId || 'none',
      timestamp: new Date().toISOString()
    });
    
/* [truncated — 7256 chars total, showing first 7000] */

--- END CONTENT ---

FILE: api:functions/api/smartLinks/tenantContext.js
LINES: 265
CHARS: 7720
TRUNCATED: yes (showing 7058 of 7720 chars)
--- BEGIN CONTENT ---
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
 * @module api/smartLinks/tenantContext
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
  const existingTenant =
/* [truncated — 7720 chars total, showing first 7000] */

--- END CONTENT ---

FILE: api:functions/api/billing/router.js
LINES: 433
CHARS: 12657
TRUNCATED: yes (showing 7059 of 12657 chars)
--- BEGIN CONTENT ---
/**
 * Billing API Router
 * Handles subscription management and payment operations for Kortex Smart Links
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const db = admin.firestore();
const { requireAuth } = require('../../middleware/authMiddleware');

// Stripe configuration - only initialize if key is available
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// Price IDs - Configure these in Stripe Dashboard
const PRICE_IDS = {
  pro: process.env.STRIPE_PRICE_PRO || 'price_pro_monthly',
  business: process.env.STRIPE_PRICE_BUSINESS || 'price_business_monthly'
};

// Plan limits
const PLAN_LIMITS = {
  starter: { links: 25, api_calls: 0 },
  pro: { links: 500, api_calls: 5000 },
  business: { links: 2500, api_calls: 25000 },
  enterprise: { links: Infinity, api_calls: Infinity }
};

/**
 * Helper to check if Stripe is configured
 */
function requireStripe(req, res, next) {
  if (!stripe) {
    return res.status(503).json({
      success: false,
      error: 'Payment system not configured',
      message: 'Please contact support to enable payments'
    });
  }
  next();
}

/**
 * GET /billing/config
 * Get Stripe publishable key
 */
router.get('/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    configured: !!stripe
  });
});

/**
 * GET /billing/subscription
 * Get current subscription for authenticated user/tenant
 */
router.get('/subscription', requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenantId || 'kaayko';
    
    // Get tenant subscription from Firestore
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    
    if (!tenantDoc.exists) {
      return res.json({
        success: true,
        subscription: {
          plan: 'starter',
          status: 'active',
          linksUsed: 0,
          clicksUsed: 0
        }
      });
    }
    
    const tenantData = tenantDoc.data();
    
    // Get usage stats
    const linksSnapshot = await db.collection('short_links')
      .where('tenantId', '==', tenantId)
      .get();
    
    const linksUsed = linksSnapshot.size;
    const clicksUsed = linksSnapshot.docs.reduce((sum, doc) => {
      return sum + (doc.data().clickCount || 0);
    }, 0);
    
    res.json({
      success: true,
      subscription: {
        plan: tenantData.plan || 'starter',
        status: tenantData.subscriptionStatus || 'active',
        stripeCustomerId: tenantData.stripeCustomerId,
        stripeSubscriptionId: tenantData.stripeSubscriptionId,
        currentPeriodEnd: tenantData.currentPeriodEnd,
        linksUsed,
        clicksUsed,
        limits: PLAN_LIMITS[tenantData.plan || 'starter']
      }
    });
    
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /billing/create-checkout
 * Create Stripe Checkout session for subscription upgrade
 */
router.post('/create-checkout', requireAuth, requireStripe, async (req, res) => {
  try {
    const { planId } = req.body;
    const tenantId = req.user.tenantId || 'kaayko';
    const userEmail = req.user.email;
    
    if (!planId || !PRICE_IDS[planId]) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid plan selected' 
      });
    }
    
    // Get or create Stripe customer
    let customerId;
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    
    if (tenantDoc.exists && tenantDoc.data().stripeCustomerId) {
      customerId = tenantDoc.data().stripeCustomerId;
    } else {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: {
          tenantId,
          userId: req.user.uid
        }
      });
      customerId = customer.id;
      
      // Save customer ID to tenant
      await db.collection('tenants').doc(tenantId).set({
        stripeCustomerId: customerId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    
    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price: PRICE_IDS[planId],
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL || 'https://kaayko.com'}/admin/smartlinks.html?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://kaayko.com'}/admin/smartlinks.html?billing=cancelled`,
      metadata: {
        tenantId,
        userId: req.user.uid,
        planId
      }
    });
    
    res.json({
      success: true,
      sessionId: session.id,
      url: session.url
    });
    
  } catch (error) {
    console.error('Create checkout error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /billing/downgrade
 * Schedule downgrade to a lower plan
 */
router.post('/downgrade', requireAuth, async (req, res) => {
  try {
    const { planId } = req.body;
    const tenantId = req.user.tenantId || 'kaayko';
    
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    
    if (!tenantDoc.exists || !tenantDoc.data().stripeSubscriptionId) {
      // No active subscription, just update plan
      await db.collection('tenants').doc(tenantId).set({
        plan: planId,
        scheduledDowngrade: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      return res.json({
        success: true,
        message: 'Plan updated immediately'
      });
    }
    
    // Need Stripe for subscription management
    if (!stripe) {
      return res.status(503).json({
        success: false,
        error: 'Payment system not configured'
      });
    }
    
    // Schedule downgrade at end of billing period
    const subscriptionId = tenantDoc.data().stripeSubscriptionId;
    
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
      metadata: {
        scheduledPlan: planId
      }
    });
    
    await db.collection('tenants').doc(tenantId).update({
      scheduledDowngrade: planId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.json({
      success: true,
      message: 'Downgrade scheduled for end of billing period'
    });
    
  } catch (error) {
    console.error('Downgrade error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /billing/webhook
 * Handle Stripe webhook events for subscription lifecycle
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }
  
  const sig 
/* [truncated — 12657 chars total, showing first 7000] */

--- END CONTENT ---
