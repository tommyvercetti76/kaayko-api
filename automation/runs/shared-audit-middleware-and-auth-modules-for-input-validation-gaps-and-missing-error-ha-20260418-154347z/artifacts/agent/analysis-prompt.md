You are a thorough API code auditor performing a deep analysis of Node.js Firebase Cloud Functions files.
Run ID: shared-audit-middleware-and-auth-modules-for-input-validation-gaps-and-missing-error-ha-20260418-154347z
Track: shared
Area: shared
Goal: Audit middleware and auth modules for input validation gaps and missing error handling

PORTFOLIO COACHING
Portfolio overview: Kaayko API is a Firebase Cloud Functions Express backend. Every route is mounted through functions/index.js. Safe agent work must preserve route contracts, auth middleware chains, Firestore access patterns, and existing error-handling shapes. Security and tenant isolation are the highest-priority concerns.
Guided products: Shared API Infrastructure, KORTEX Platform API, Commerce & Checkout API, Kamera Quest API, Kreator Program API, Kutz Nutrition API, Weather & Forecast API
Primary focus products: Shared API Infrastructure
Source docs: README.md, functions/middleware/README.md, functions/api/smartLinks/README.md, functions/api/products/README.md, functions/api/checkout/README.md, functions/api/cameras/README.md, functions/api/kreators/README.md, functions/api/kutz/README.md, functions/api/weather/README.md

Focused doc snapshots:
- README.md: Kaayko API What this repo powers | Product | Purpose | Mounted base paths on `api` | Primary frontend consumers | Product guide | | Kreator | Creator applications, onboarding, profile, admin review | `/kreators` | `kaayko/src/kreator/*` | [`docs/products/KREATOR.md`](./docs/products/KREATOR.md) | Architecture Runtime: Firebase Functions v2, Node.js 22, Express app exported as `api`. Storage and state: Firebase Admin, Firestore, Cloud Storage, Firebase Auth. Payments: Stripe checkout/payment intent and webhook flows.
- functions/middleware/README.md: Document not found in the current workspace.

Product: Shared API Infrastructure (Primary focus)
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

Product: KORTEX Platform API (Supporting context)
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

Product: Commerce & Checkout API (Supporting context)
Purpose: Protect the products catalog, voting, image serving, Stripe payment intent creation, and order-completion flow as a paired, transaction-critical surface.
API paths:
  - functions/api/products/
  - functions/api/checkout/
Backend routes:
  - GET /products
  - GET /products/:id
  - POST /products/:id/vote
  - GET /images/:productId/:fileName
  - POST /createPaymentIntent
  - POST /createPaymentIntent/updateEmail
Validation focus:
  - Validate product fetch, image serving, voting, and checkout as one paired flow.
  - Confirm Stripe payment intent creation returns the correct client secret shape.
  - Verify vote rate limiting middleware is still active and correctly scoped.
  - Ensure image serving enforces content-type and does not expose directory listings.
Risk focus:
  - Stripe webhook and intent handling are transaction-critical — no silent fallbacks.
  - Rate limiting on vote endpoints must not be removed or weakened during cleanup.
  - Image serving routes must validate productId before reading from storage.
  - Checkout email update must not allow overwriting a confirmed payment's email.

Product: Kamera Quest API (Supporting context)
Purpose: Keep camera catalog integrity, skill-level-aware preset generation, lens data, and predeploy validation stable as a contract-driven catalog service.
API paths:
  - functions/api/cameras/
  - functions/scripts/
Backend routes:
  - GET /presets/meta
  - GET /cameras/:brand
  - GET /cameras/:brand/:modelName/lenses
  - POST /presets/classic
  - POST /presets/smart
Validation focus:
  - Verify skill-level branching (apprentice/enthusiast/professional) still produces different outputs.
  - Confirm catalog provenance metadata (verification status, source) is not stripped.
  - Validate predeploy checks are not weakened to bypass failing catalog validation.
  - Check lens compatibility data structure is preserved when entries are updated.
Risk focus:
  - Preset generation is contract-driven — output shape changes break the frontend silently.
  - Predeploy validation scripts are the last safety net before catalog corruption reaches prod.
  - Camera catalog updates are persistent — no dry-run mode exists; bugs go live.
  - Smart preset logic depends on structured backend payloads — shape must remain stable.

Product: Kreator Program API (Supporting context)
Purpose: Maintain creator application intake, onboarding state transitions, Google OAuth flows, and admin review as a gated, stateful program.
API paths:
  - functions/api/kreators/
Backend routes:
  - POST /kreators/apply
  - GET /kreators/applications/:id/status
  - POST /kreators/onboarding/verify
  - POST /kreators/onboarding/complete
  - GET /kreators/auth/google/*
  - GET /kreators/me
  - GET /kreators/admin/*
  - GET /kreators/products
Validation focus:
  - Verify application state transitions are validated and cannot be skipped.
  - Confirm admin endpoints check the admin custom claim before any data mutation.
  - Validate onboarding completion is idempotent — re-processing must not double-apply.
  - Check that Google OAuth callback handles token exchange errors gracefully.
Risk focus:
  - Application state machine bugs allow creators to skip approval steps.
  - Admin review endpoints must not be reachable by non-admin custom claims.
  - OAuth token exchange stores credentials in Firestore — validate storage security.
  - /kreators/products is ahead of the deployed backend contract — flag if changed.

Product: Kutz Nutrition API (Supporting context)
Purpose: Maintain nutrition food parsing, meal suggestion ranking, Fitbit OAuth integration, and food search as a reliable, privacy-sensitive service.
API paths:
  - functions/api/kutz/
Backend routes:
  - GET /kutz/foods/search
  - POST /kutz/meals
  - GET /kutz/meals
  - GET /kutz/fitbit/auth
  - GET /kutz/fitbit/callback
  - POST /kutz/fitbit/refresh
Validation focus:
  - Verify Fitbit OAuth token refresh still works end-to-end after middleware changes.
  - Confirm food parsing returns safe defaults for null or incomplete macro data.
  - Validate meal suggestion ranking does not expose raw Firestore document IDs.
  - Check that Fitbit credentials stored in Firestore are not returned to the client.
Risk focus:
  - Fitbit OAuth tokens are sensitive credentials — never log or expose them in responses.
  - Food parsing edge cases (missing macro fields) must not crash the request handler.
  - Meal logs contain user health data — access must be scoped to the authenticated user.
  - Token refresh failures must fail safely without corrupting the stored credential.

Product: Weather & Forecast API (Supporting context)
Purpose: Maintain forecast scheduling, paddle score computation, nearby water search, and cache behavior as a reliable, latency-sensitive service.
API paths:
  - functions/api/weather/
  - functions/scheduled/
Backend routes:
  - GET /paddlingOut
  - GET /paddlingOut/:id
  - GET /paddleScore
  - GET /fastForecast
  - GET /forecast
  - GET /nearbyWater
Validation focus:
  - Verify cache warm and cold paths both return structurally identical responses.
  - Confirm paddle score output range does not shift after normalization changes.
  - Check that scheduled function cron expressions are not inadvertently modified.
  - Validate error fallbacks still emit confidence levels and fallback data shapes.
Risk focus:
  - Cache invalidation bugs silently serve stale data with incorrect confidence scores.
  - Score normalization changes are invisible to tests if ranges are not bounded.
  - Scheduled functions share state with request handlers — side effects are subtle.
  - Nearby water results depend on OSM data quality — errors should degrade gracefully.

Perform a comprehensive audit of ALL provided files. This is a READ-ONLY analysis — do NOT propose edits.
Your job is to enumerate, categorize, and assess — not to rewrite code.

For each file, analyze:
1. What endpoints/routes does it define? What middleware chain protects them?
2. Auth patterns: Firebase token verification, admin claim checks, tenant scoping.
3. Error handling: does it leak stack traces? Are error shapes consistent?
4. Firestore access: correct collection paths, proper scoping, no cross-tenant leaks.
5. Duplicated patterns: repeated validation logic, similar error handlers, copy-paste routes.
6. Security: rate limiting, input validation, CORS, header security.
7. Dependencies between files: what imports what, shared state, initialization order.

Return JSON only using this exact shape:
{
  "summary": "2-3 paragraph executive summary of audit findings",
  "endpoint_inventory": [
    {
      "method": "GET|POST|PUT|DELETE",
      "path": "/api/...",
      "file": "repo:path",
      "auth": "none|bearer|admin|kreator",
      "middleware": [
        "list"
      ],
      "description": "what it does"
    }
  ],
  "auth_audit": [
    {
      "file": "repo:path",
      "pattern": "description of auth pattern used",
      "gaps": [
        "any auth gaps found"
      ],
      "risk_level": "high|medium|low"
    }
  ],
  "duplicated_patterns": [
    {
      "pattern": "description of repeated pattern",
      "files": [
        "repo:path"
      ],
      "severity": "high|medium|low",
      "recommendation": "how to consolidate"
    }
  ],
  "findings": [
    {
      "severity": "low|medium|high",
      "title": "...",
      "detail": "Detailed explanation with specific function names or line patterns",
      "category": "security|auth|tenant|contract|error-handling|duplication|maintainability|architecture",
      "file_paths": [
        "repo:path"
      ]
    }
  ],
  "dependency_map": [
    {
      "file": "repo:path",
      "imports": [
        "repo:path"
      ],
      "exports": [
        "functionName"
      ],
      "used_by": [
        "repo:path"
      ]
    }
  ],
  "insights": [
    "..."
  ],
  "followups": [
    "..."
  ]
}

Rules:
- Do NOT include a `safe_edits` field. This is audit-only.
- Be SPECIFIC: name exact functions, middleware names, route paths. Vague findings are useless.
- Every finding must reference at least one file from the provided list.
- If a file is truncated, note what you can see and flag that the full file may contain more.
- For auth_audit: check EVERY route handler for proper auth middleware. Flag unprotected mutations.
- For endpoint_inventory: list EVERY endpoint with its HTTP method and auth requirement.
- For duplicated_patterns: compare across files, not just within one file.
- Produce at least 5 findings. Shallow audits are failures.

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

FILE: api:functions/middleware/kreatorAuthMiddleware.js
LINES: 313
CHARS: 8223
TRUNCATED: yes (showing 7058 of 8223 chars)
--- BEGIN CONTENT ---
/**
 * Kreator Authentication Middleware
 * 
 * Specialized middleware for kreator authentication and authorization.
 * Separate from admin auth to support different user types.
 * 
 * @module middleware/kreatorAuthMiddleware
 */

const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * Verify session token and check if user is a kreator
 * Attaches kreator profile to request
 * @middleware
 */
async function requireKreatorAuth(req, res, next) {
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

    const token = authHeader.split('Bearer ')[1];
    
    // Import kreatorService for token verification
    const kreatorService = require('../services/kreatorService');
    
    // Verify our session token
    const decoded = kreatorService.verifySessionToken(token);
    
    if (!decoded || !decoded.uid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        message: 'The authentication token is invalid or expired.',
        code: 'AUTH_TOKEN_INVALID'
      });
    }

    // Attach basic user info
    req.user = {
      uid: decoded.uid,
      role: decoded.role,
      authTime: decoded.iat
    };

    // Fetch kreator profile from Firestore
    const kreatorDoc = await db.collection('kreators').doc(decoded.uid).get();

    if (!kreatorDoc.exists) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'You are not registered as a kreator',
        code: 'NOT_A_KREATOR'
      });
    }

    const kreatorData = kreatorDoc.data();

    // Check if kreator is deleted
    if (kreatorData.deletedAt) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Your kreator account has been deleted',
        code: 'KREATOR_DELETED'
      });
    }

    // Attach kreator profile to request
    req.kreator = {
      uid: kreatorDoc.id,
      ...kreatorData,
      createdAt: kreatorData.createdAt?.toDate?.()?.toISOString(),
      updatedAt: kreatorData.updatedAt?.toDate?.()?.toISOString()
    };

    next();

  } catch (error) {
    console.error('[KreatorAuth] Token verification failed:', error.message);

    return res.status(401).json({
      success: false,
      error: 'Authentication failed',
      message: 'Unable to verify authentication token.',
      code: 'AUTH_FAILED'
    });
  }
}

/**
 * Require kreator to be in active status
 * Must be used after requireKreatorAuth
 * @middleware
 */
function requireActiveKreator(req, res, next) {
  if (!req.kreator) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Kreator authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  const { status } = req.kreator;

  if (status === 'pending_password') {
    return res.status(403).json({
      success: false,
      error: 'Account Setup Incomplete',
      message: 'Please complete your account setup by setting a password.',
      code: 'KREATOR_PENDING_PASSWORD'
    });
  }

  if (status === 'suspended') {
    return res.status(403).json({
      success: false,
      error: 'Account Suspended',
      message: 'Your kreator account has been suspended. Please contact support.',
      code: 'KREATOR_SUSPENDED'
    });
  }

  if (status === 'deactivated') {
    return res.status(403).json({
      success: false,
      error: 'Account Deactivated',
      message: 'Your kreator account has been deactivated.',
      code: 'KREATOR_DEACTIVATED'
    });
  }

  if (status !== 'active') {
    return res.status(403).json({
      success: false,
      error: 'Invalid Account Status',
      message: `Your account status (${status}) does not allow this action.`,
      code: 'INVALID_KREATOR_STATUS'
    });
  }

  next();
}

/**
 * Require kreator to have specific permission(s)
 * Must be used after requireKreatorAuth
 * @param {string|string[]} requiredPermissions
 * @middleware
 */
function requireKreatorPermission(requiredPermissions) {
  const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];

  return (req, res, next) => {
    if (!req.kreator) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Kreator authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const kreatorPermissions = req.kreator.permissions || [];

    // Check if kreator has all required permissions
    const hasAllPermissions = permissions.every(p => kreatorPermissions.includes(p));

    if (!hasAllPermissions) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: `Missing required permissions: ${permissions.join(', ')}`,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
}

/**
 * Optional kreator auth - attaches kreator if token is valid
 * @middleware
 */
async function optionalKreatorAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      req.kreator = null;
      return next();
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified
    };

    // Try to fetch kreator profile
    const kreatorDoc = await db.collection('kreators').doc(decodedToken.uid).get();

    if (kreatorDoc.exists && !kreatorDoc.data().deletedAt) {
      req.kreator = {
        uid: kreatorDoc.id,
        ...kreatorDoc.data()
      };
    } else {
      req.kreator = null;
    }

    next();

  } catch (error) {
    console.log('[KreatorAuth] Optional auth failed, continuing without kreator:', error.message);
    req.user = null;
    req.kreator = null;
    next();
  }
}

/**
 * Rate limiter for kreator endpoints
 * @param {string} action - Action identifier for rate limiting
 * @param {number} maxRequests - Max requests per window
 * @param {number} windowMs - Window size in milliseconds
 */
function kreatorRateLimit(action, maxRequests = 10, windowMs = 60000) {
  const requestCounts = new Map();

  return (req, res, next) => {
    const identifier = req.kreator?.uid || req.ip || 'unknown';
    const key = `${action}:${identifier}`;
    const now = Date.now();

    // Get or initialize count
    let record = requestCounts.get(key);
    if (!record || now - record.windowStart > windowMs) {
      record = { count: 0, windowStart: now };
    }

    record.count++;
    requestCounts.set(key, record);

    // Clean 
/* [truncated — 8223 chars total, showing first 7000] */

--- END CONTENT ---

FILE: api:functions/middleware/apiKeyMiddleware.js
LINES: 325
CHARS: 8488
TRUNCATED: yes (showing 7058 of 8488 chars)
--- BEGIN CONTENT ---
/**
 * API Key Authentication Middleware
 * 
 * Enables programmatic access to Smart Links API for external clients.
 * Alternative to Firebase Auth for backend-to-backend integrations.
 * 
 * Features:
 * - API key validation via Firestore lookup
 * - Scope-based authorization
 * - Rate limiting per API key
 * - Usage tracking and analytics
 * - Security: keys are hashed, never stored in plaintext
 * 
 * @module middleware/apiKeyMiddleware
 */

const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();

/**
 * Hash an API key for secure storage
 * Uses SHA-256 hashing (one-way)
 * 
 * @param {string} apiKey - Plain text API key
 * @returns {string} Hashed key
 */
function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Generate a new API key
 * Format: ak_<32 random hex chars>
 * 
 * @returns {string} New API key
 */
function generateApiKey() {
  const randomBytes = crypto.randomBytes(16).toString('hex');
  return `ak_${randomBytes}`;
}

/**
 * Validate API key and attach client info to request
 * 
 * @param {string[]} requiredScopes - Scopes required for this endpoint
 * @returns {Function} Express middleware
 * 
 * @example
 * router.post('/smartlinks', requireApiKey(['create:links']), handler);
 */
function requireApiKey(requiredScopes = []) {
  return async (req, res, next) => {
    try {
      // Extract API key from header
      const apiKey = req.headers['x-api-key'] || req.headers['x-kaayko-api-key'];
      
      if (!apiKey) {
        return res.status(401).json({
          success: false,
          error: 'API key required',
          message: 'Missing x-api-key header',
          code: 'API_KEY_MISSING'
        });
      }

      // Validate key format
      if (!apiKey.startsWith('ak_') || apiKey.length !== 35) {
        return res.status(401).json({
          success: false,
          error: 'Invalid API key format',
          code: 'API_KEY_INVALID_FORMAT'
        });
      }

      // Hash the key for lookup
      const keyHash = hashApiKey(apiKey);

      // Look up key in Firestore
      const keysSnapshot = await db.collection('api_keys')
        .where('secretHash', '==', keyHash)
        .limit(1)
        .get();

      if (keysSnapshot.empty) {
        return res.status(401).json({
          success: false,
          error: 'Invalid API key',
          message: 'API key not found or has been revoked',
          code: 'API_KEY_INVALID'
        });
      }

      const keyDoc = keysSnapshot.docs[0];
      const keyData = keyDoc.data();

      // Check if key is disabled
      if (keyData.disabled === true) {
        return res.status(403).json({
          success: false,
          error: 'API key disabled',
          message: 'This API key has been disabled',
          code: 'API_KEY_DISABLED'
        });
      }

      // Check scopes
      const keyScopes = keyData.scopes || [];
      const hasRequiredScopes = requiredScopes.every(scope => 
        keyScopes.includes(scope) || keyScopes.includes('*')
      );

      if (!hasRequiredScopes) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          message: `Required scopes: ${requiredScopes.join(', ')}`,
          code: 'INSUFFICIENT_API_KEY_SCOPES'
        });
      }

      // Check rate limit
      const rateLimitPassed = await checkApiKeyRateLimit(
        keyDoc.id, 
        keyData.rateLimitPerMinute || 60
      );

      if (!rateLimitPassed) {
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED'
        });
      }

      // Attach API client info to request
      req.apiClient = {
        keyId: keyDoc.id,
        tenantId: keyData.tenantId,
        tenantName: keyData.tenantName,
        scopes: keyScopes,
        name: keyData.name,
        rateLimitPerMinute: keyData.rateLimitPerMinute
      };

      // Update last used timestamp (async, non-blocking)
      keyDoc.ref.update({
        lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        usageCount: admin.firestore.FieldValue.increment(1)
      }).catch(err => console.error('[APIKey] Failed to update lastUsedAt:', err));

      console.log('[APIKey] Authenticated:', {
        keyId: keyDoc.id,
        tenant: keyData.tenantId,
        scopes: keyScopes
      });

      next();

    } catch (error) {
      console.error('[APIKey] Authentication error:', error);
      return res.status(500).json({
        success: false,
        error: 'Authentication failed',
        message: 'Unable to verify API key',
        code: 'API_KEY_AUTH_FAILED'
      });
    }
  };
}

/**
 * Check rate limit for API key
 * Uses time-bucketed counters in Firestore
 * 
 * @param {string} keyId - API key document ID
 * @param {number} maxRequestsPerMinute - Rate limit threshold
 * @returns {Promise<boolean>} True if within limit
 */
async function checkApiKeyRateLimit(keyId, maxRequestsPerMinute) {
  try {
    const now = Date.now();
    const currentMinuteBucket = Math.floor(now / 60000); // Round to minute

    const rateLimitRef = db.collection('api_key_rate_limits').doc(`${keyId}_${currentMinuteBucket}`);
    
    // Use transaction to ensure atomic increment
    const allowed = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(rateLimitRef);
      
      if (!doc.exists) {
        // First request in this minute bucket
        transaction.set(rateLimitRef, {
          keyId,
          bucket: currentMinuteBucket,
          count: 1,
          expiresAt: admin.firestore.Timestamp.fromMillis(now + 120000) // TTL: 2 minutes
        });
        return true;
      }

      const currentCount = doc.data().count || 0;
      
      if (currentCount >= maxRequestsPerMinute) {
        return false; // Rate limit exceeded
      }

      transaction.update(rateLimitRef, {
        count: admin.firestore.FieldValue.increment(1)
      });
      
      return true;
    });

    return allowed;

  } catch (error) {
    console.error('[APIKey] Rate limit check failed:', error);
    // On error, allow the request (fail open)
    return true;
  }
}

/**
 * Create a new API key
 * 
 * @param {Object} keyData
 * @param {string} keyData.tenantId - Tenant ID
 * @param {string} keyData.name - Human-readable name
 * @param {string[]} keyData.scopes - Allowed scopes
 * @param {number} keyData.rateLimitPerMinute - Requests per minute limit
 * @returns {Promise<{keyId: string, apiKey: string, secretHash: string}>}
 */
async function createApiKey(keyData) {
  const {
    tenantId,
    name,
    scopes = ['read:links'],
    rateLimitPerMinute = 60
  } = keyData;

  if (!tenantId || !name) {
    throw new Error('tenantId and name are required');
  }

  // Generate API key
  const apiKey = generateApiKey();
  const secretHash = h
/* [truncated — 8488 chars total, showing first 7000] */

--- END CONTENT ---

FILE: api:functions/middleware/rateLimit.js
LINES: 14
CHARS: 421
TRUNCATED: no
--- BEGIN CONTENT ---
// File: functions/middleware/rateLimit.js

const { createRateLimitMiddleware } = require('../api/weather/sharedWeatherUtils');

/**
 * Rate limit middleware factory
 * @param {number} maxRequests - maximum number of requests
 * @param {number} windowMs - time window in milliseconds
 */
function rateLimit(maxRequests, windowMs) {
  return createRateLimitMiddleware(maxRequests, windowMs);
}

module.exports = rateLimit;
--- END CONTENT ---

FILE: api:functions/middleware/securityMiddleware.js
LINES: 232
CHARS: 6652
TRUNCATED: no
--- BEGIN CONTENT ---
/**
 * Security Middleware - Bot Protection & Rate Limiting
 * Protects Kortex endpoints from malicious traffic
 */

const admin = require('firebase-admin');
const db = admin.firestore();

// Rate limit: requests per IP per time window
const RATE_LIMITS = {
  login: { max: 5, window: 15 * 60 * 1000 }, // 5 attempts per 15 minutes
  tenantRegistration: { max: 3, window: 60 * 60 * 1000 }, // 3 per hour
  tenants: { max: 20, window: 60 * 1000 }, // 20 per minute
  api: { max: 100, window: 60 * 1000 } // 100 per minute for general API
};

// Bot detection patterns
const BOT_USER_AGENTS = [
  /bot/i, /crawl/i, /spider/i, /scrape/i, /curl/i, /wget/i, /python/i,
  /scanner/i, /headless/i, /phantom/i, /selenium/i, /webdriver/i
];

// Suspicious activity patterns
const SUSPICIOUS_PATTERNS = {
  noUserAgent: true,
  tooManyRequests: true,
  suspiciousHeaders: ['X-Forwarded-For', 'X-Real-IP'],
  rapidFireRequests: 100 // ms between requests
};

/**
 * Check if request is from a bot
 */
function isBot(userAgent) {
  if (!userAgent) return true;
  return BOT_USER_AGENTS.some(pattern => pattern.test(userAgent));
}

/**
 * Get client IP address
 */
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.connection.remoteAddress ||
         req.socket.remoteAddress ||
         'unknown';
}

/**
 * Rate limiter middleware factory
 */
function rateLimiter(limitType = 'api') {
  return async (req, res, next) => {
    try {
      const ip = getClientIp(req);
      const limit = RATE_LIMITS[limitType] || RATE_LIMITS.api;
      const now = Date.now();
      const key = `rate_limit_${limitType}_${ip}`;
      
      // Get current rate limit data
      const rateLimitDoc = await db.collection('rate_limits').doc(key).get();
      
      if (rateLimitDoc.exists) {
        const data = rateLimitDoc.data();
        const windowStart = data.windowStart.toMillis();
        
        // Check if we're still in the same window
        if (now - windowStart < limit.window) {
          if (data.count >= limit.max) {
            // Rate limit exceeded
            const resetTime = new Date(windowStart + limit.window);
            console.log(`[Security] Rate limit exceeded for ${ip} on ${limitType}`);
            
            return res.status(429).json({
              success: false,
              error: 'Too many requests',
              message: `Rate limit exceeded. Try again after ${resetTime.toLocaleTimeString()}`,
              retryAfter: Math.ceil((resetTime - now) / 1000)
            });
          }
          
          // Increment counter
          await db.collection('rate_limits').doc(key).update({
            count: admin.firestore.FieldValue.increment(1),
            lastRequest: admin.firestore.FieldValue.serverTimestamp()
          });
        } else {
          // Start new window
          await db.collection('rate_limits').doc(key).set({
            count: 1,
            windowStart: admin.firestore.FieldValue.serverTimestamp(),
            lastRequest: admin.firestore.FieldValue.serverTimestamp(),
            ip,
            limitType
          });
        }
      } else {
        // First request - create new rate limit entry
        await db.collection('rate_limits').doc(key).set({
          count: 1,
          windowStart: admin.firestore.FieldValue.serverTimestamp(),
          lastRequest: admin.firestore.FieldValue.serverTimestamp(),
          ip,
          limitType
        });
      }
      
      next();
      
    } catch (error) {
      console.error('[Security] Rate limiter error:', error);
      // Don't block on errors
      next();
    }
  };
}

/**
 * Bot protection middleware
 */
function botProtection(req, res, next) {
  const userAgent = req.get('user-agent') || '';
  const ip = getClientIp(req);
  
  // Check if bot
  if (isBot(userAgent)) {
    console.log(`[Security] Bot detected: ${ip} - ${userAgent}`);
    
    // Allow search engine bots (Google, Bing, etc.) for SEO
    if (userAgent.match(/googlebot|bingbot|duckduckbot|baiduspider/i)) {
      console.log('[Security] Search engine bot allowed');
      return next();
    }
    
    return res.status(403).json({
      success: false,
      error: 'Access denied',
      message: 'Automated requests are not allowed'
    });
  }
  
  // Check for missing user agent
  if (!userAgent || userAgent.length < 10) {
    console.log(`[Security] Suspicious request - no/short user agent: ${ip}`);
    return res.status(403).json({
      success: false,
      error: 'Access denied',
      message: 'Invalid request headers'
    });
  }
  
  next();
}

/**
 * CORS security middleware (stricter than default)
 */
function secureHeaders(req, res, next) {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // Strict CORS for admin endpoints
  if (req.path.includes('/admin') || req.path.includes('/tenants')) {
    const allowedOrigins = [
      'https://kaayko.com',
      'https://kaaykostore.web.app',
      'https://kaaykostore.firebaseapp.com'
    ];
    
    const origin = req.get('origin');
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }
  
  next();
}

/**
 * Log suspicious activity
 */
async function logSuspiciousActivity(req, type, details = {}) {
  try {
    await db.collection('security_logs').add({
      type,
      ip: getClientIp(req),
      userAgent: req.get('user-agent'),
      path: req.path,
      method: req.method,
      details,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('[Security] Failed to log suspicious activity:', error);
  }
}

/**
 * Honeypot trap for bots
 */
function honeypot(req, res) {
  const ip = getClientIp(req);
  console.log(`[Security] Honeypot triggered by ${ip}`);
  
  logSuspiciousActivity(req, 'honeypot', {
    message: 'Bot fell into honeypot trap'
  });
  
  // Return fake success to waste bot's time
  res.status(200).json({
    success: true,
    message: 'Request processed successfully',
    data: Array(100).fill({ id: Math.random(), value: 'fake_data' })
  });
}

module.exports = {
  rateLimiter,
  botProtection,
  secureHeaders,
  isBot,
  getClientIp,
  logSuspiciousActivity,
  honeypot
};

--- END CONTENT ---

FILE: api:functions/index.js
LINES: 122
CHARS: 4986
TRUNCATED: no
--- BEGIN CONTENT ---
// functions/src/index.js - Firebase Functions v2
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");

// Initialize Firebase Admin
admin.initializeApp();

// Create Express app for JSON API
const apiApp = express();
apiApp.use(cors());

// Strip /api/ prefix when requests come through Firebase Hosting rewrite
// (Firebase Hosting forwards the full path, e.g. /api/kutz/parseFoods)
apiApp.use((req, _res, next) => {
  if (req.url.startsWith('/api/')) req.url = req.url.slice(4);
  next();
});

// ⚠️ CRITICAL: Stripe webhook needs raw body for signature verification
// Must be defined BEFORE express.json() middleware
apiApp.use("/createPaymentIntent/webhook", express.raw({ type: 'application/json' }), require("./api/checkout/stripeWebhook"));

// Now apply JSON parsing for all other routes
apiApp.use(express.json());

// Load essential API routes
apiApp.use("/images", require("./api/products/images"));
apiApp.get("/helloWorld", (_r, res) => res.send("OK"));
apiApp.use("/products", require("./api/products/products"));
apiApp.use("/paddlingOut", require("./api/weather/paddlingout"));

// 📚 API DOCUMENTATION
apiApp.use("/docs", require("./api/core/docs"));

// 🌍 LOCATION SERVICES
apiApp.use("/nearbyWater", require("./api/weather/nearbyWater")); // Find nearby lakes/rivers for custom locations

// 🌟 STREAMLINED WEATHER APIs - Enabled
apiApp.use("/paddleScore", require("./api/weather/paddleScore"));     // ML-POWERED: Paddle condition rating with ML model
apiApp.use("/fastForecast", require("./api/weather/fastForecast"));   // PUBLIC: Fast cached forecasts for frontend
apiApp.use("/forecast", require("./api/weather/forecast").router);    // PREMIUM: On-demand forecasts (requires $$ token)

// 🔗 SMART LINKS - NEW!
apiApp.use("/smartlinks", require("./api/smartLinks/smartLinks"));    // Smart link CRUD & analytics

// 🎨 KREATOR (CREATOR) MANAGEMENT - NEW!
apiApp.use("/kreators", require("./api/kreators/kreatorRoutes"));     // Kreator onboarding, auth, profile

// 🤖 AI / GPT Actions (exposed for ChatGPT / internal GPT Actions clients)
apiApp.use("/gptActions", require("./api/ai/gptActions"));

// 🔐 Auth routes (login / logout / session helpers)
apiApp.use("/auth", require("./api/auth/authRoutes"));

// 💳 CHECKOUT & PAYMENTS
apiApp.use("/createPaymentIntent", require("./api/checkout/router")); // Stripe payment intent creation

// � BILLING & SUBSCRIPTIONS
apiApp.use("/billing", require("./api/billing/router")); // Subscription management for Kortex

// �👔 ADMIN ORDER MANAGEMENT - PROTECTED WITH AUTH
const { requireAuth, requireAdmin } = require("./middleware/authMiddleware");
apiApp.post("/admin/updateOrderStatus", requireAuth, requireAdmin, require("./api/admin/updateOrderStatus"));
const { getOrder, listOrders } = require("./api/admin/getOrder");
apiApp.get("/admin/getOrder", requireAuth, requireAdmin, getOrder);
apiApp.get("/admin/listOrders", requireAuth, requireAdmin, listOrders);

// 🥗 KALEKUTZ - Voice-first nutrition tracker
apiApp.use("/kutz", require("./api/kutz/kutzRouter"));

// 📷 KAMERA QUEST - Camera/lens data & photography presets
apiApp.use("/cameras", require("./api/cameras/camerasRoutes"));
apiApp.use("/lenses", require("./api/cameras/lensesRoutes"));
apiApp.use("/presets/smart", require("./api/cameras/smartRoutes"));
apiApp.use("/presets", require("./api/cameras/presetsRoutes"));

// Legacy deeplink routes
apiApp.use("/", require("./api/deepLinks/deeplinkRoutes"));

// Export main API function
exports.api = onRequest({
  cors: true,
  invoker: "public",
  timeoutSeconds: 300,
  memory: "512MiB"
}, apiApp);

// ===========================
// 🕒 SCHEDULED FUNCTIONS - TEMPORARILY DISABLED
// ===========================
// Scheduled forecast generator (enabled)
const {
  earlyMorningForecast,
  morningForecastUpdate,
  afternoonForecastUpdate,
  eveningForecastUpdate,
  emergencyForecastRefresh,
  forecastSchedulerHealth
} = require('./scheduled/forecastScheduler');

// Export scheduled forecast functions as Cloud Function scheduled triggers
exports.earlyMorningForecast = earlyMorningForecast;
exports.morningForecastUpdate = morningForecastUpdate;
exports.afternoonForecastUpdate = afternoonForecastUpdate;
exports.eveningForecastUpdate = eveningForecastUpdate;
exports.emergencyForecastRefresh = emergencyForecastRefresh;
exports.forecastSchedulerHealth = forecastSchedulerHealth;

// Paddle score cache warmer — runs every 15 min, pre-warms scores for all curated spots
// Deploy: firebase deploy --only functions:warmPaddleScoreCache
const {
  warmPaddleScoreCache,
  aggregatePaddleFeedback
} = require('./scheduled/paddleScoreWarmer');

exports.warmPaddleScoreCache    = warmPaddleScoreCache;
exports.aggregatePaddleFeedback = aggregatePaddleFeedback;

console.log("✅ Kaayko API v2 - PUBLIC: fastForecast + paddlingOut | PREMIUM: forecast ($$) | SMARTLINKS: admin portal");

--- END CONTENT ---

FILE: api:functions/api/auth/authRoutes.js
LINES: 109
CHARS: 2782
TRUNCATED: no
--- BEGIN CONTENT ---
/**
 * Authentication Routes
 * Handles login, logout, and session management
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { requireAuth } = require('../../middleware/authMiddleware');

/**
 * POST /auth/logout
 * Revoke user's refresh tokens and invalidate session
 * Frontend should clear localStorage and redirect to login
 */
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    
    // Revoke all refresh tokens for this user
    // This invalidates all existing sessions
    await admin.auth().revokeRefreshTokens(uid);
    
    // Get the user's latest token issue time
    const userRecord = await admin.auth().getUser(uid);
    const revokeTime = new Date(userRecord.tokensValidAfterTime).getTime() / 1000;
    
    console.log(`✅ User ${req.user.email} logged out successfully. Tokens revoked at ${new Date(revokeTime * 1000).toISOString()}`);
    
    res.json({
      success: true,
      message: 'Logout successful. All sessions have been terminated.',
      revokedAt: new Date(revokeTime * 1000).toISOString()
    });
    
  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed',
      details: error.message
    });
  }
});

/**
 * GET /auth/me
 * Get current authenticated user info
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        uid: req.user.uid,
        email: req.user.email,
        role: req.user.role,
        displayName: req.user.displayName || null,
        emailVerified: req.user.email_verified || false
      }
    });
  } catch (error) {
    console.error('❌ Error fetching user info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user information'
    });
  }
});

/**
 * POST /auth/verify
 * Verify a Firebase ID token (for debugging)
 */
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token is required'
      });
    }
    
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    res.json({
      success: true,
      decoded: {
        uid: decodedToken.uid,
        email: decodedToken.email,
        role: decodedToken.role || null,
        exp: new Date(decodedToken.exp * 1000).toISOString(),
        iat: new Date(decodedToken.iat * 1000).toISOString()
      }
    });
    
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
      details: error.message
    });
  }
});

module.exports = router;

--- END CONTENT ---

FILE: api:functions/api/cameras/audit/capabilitySchema.js
LINES: 127
CHARS: 2217
TRUNCATED: no
--- BEGIN CONTENT ---
const BODY_CAPABILITY_SCHEMA = {
  identity: [
    'modelName',
    'brand',
    'productLine',
    'releaseDate',
    'lensMount',
    'status',
  ],
  sensor: [
    'sensorType',
    'sensorFormat',
    'effectiveMegapixels',
    'nativeIsoMin',
    'nativeIsoMax',
    'expandedIsoMin',
    'expandedIsoMax',
    'dynamicRange',
  ],
  shutterAndBurst: [
    'shutterSpeed',
    'mechanicalShutterMax',
    'electronicShutterMax',
    'continuousFpsMechanical',
    'continuousFpsElectronic',
    'preCapture',
  ],
  autofocus: [
    'autofocus',
    'afPointsPhase',
    'afPointsContrast',
    'subjectDetection',
    'eyeAfHumans',
    'eyeAfAnimals',
    'vehicleDetection',
  ],
  stabilization: [
    'IBIS',
    'ibisStops',
    'coordinatedIS',
    'movieIS',
  ],
  flash: [
    'maxFlashSync',
    'electronicFlashSync',
    'hssSupport',
    'pcSyncPort',
  ],
  storagePowerBuild: [
    'cardSlots',
    'batteryModel',
    'weatherSealed',
    'weatherResistanceLevel',
    'weightGrams',
  ],
  displayConnectivity: [
    'evfResolutionDots',
    'rearScreenType',
    'wifi',
    'bluetooth',
    'usbPort',
  ],
  video: [
    'maxVideoMode',
    'openGate',
    'logProfiles',
    'rawVideo',
    'recordLimitMinutes',
  ],
  provenance: [
    'sourceUrls',
    'verifiedAt',
    'verifiedBy',
    'verificationScope',
    'validationTier',
  ],
};

const LENS_CAPABILITY_SCHEMA = {
  identity: [
    'lensName',
    'brand',
    'mountType',
    'releaseDate',
    'status',
  ],
  optical: [
    'minFocalLength',
    'maxFocalLength',
    'maxAperture',
    'maxApertureAtTele',
    'minFocusDistanceMeters',
    'maxMagnification',
    'filterThread',
  ],
  autofocusAndStabilization: [
    'focusMotor',
    'hasOIS',
    'oisStops',
    'focusBreathingCompSupport',
  ],
  build: [
    'weatherSealed',
    'weightGrams',
    'lengthMm',
    'diameterMm',
  ],
  compatibility: [
    'compatibleCameras',
    'fullFrameCoverage',
    'apscCoverage',
    'teleconverterCompatibility',
  ],
  provenance: [
    'sourceUrls',
    'verifiedAt',
    'verifiedBy',
    'verificationScope',
    'validationTier',
  ],
};

module.exports = {
  BODY_CAPABILITY_SCHEMA,
  LENS_CAPABILITY_SCHEMA,
};

--- END CONTENT ---

FILE: api:functions/api/cameras/audit/officialBodies.js
LINES: 127
CHARS: 7673
TRUNCATED: yes (showing 7058 of 7673 chars)
--- BEGIN CONTENT ---
module.exports = {
  auditedAt: '2026-03-07',
  scope: 'Current Canon and Sony interchangeable-lens bodies relevant to the Kaayko camera API audit.',
  brands: {
    canon: {
      notes: [
        'Canon U.S.A. shop pages currently expose contradictory "In Stock" and "Discontinued" labels, so the baseline uses Canon-owned lineup and launch pages instead of storefront availability badges.',
        'The Canon baseline is limited to EOS R bodies and the hybrid EOS R5 C because the existing Kaayko dataset is centered on still and hybrid mirrorless cameras.',
      ],
      sources: {
        eosRSystem: {
          label: 'Canon EOS R System lineup page',
          url: 'https://www.usa.canon.com/digital-cameras/eos-r-system',
          verifiedAt: '2026-03-07',
        },
        eosR1AndR5MarkII: {
          label: 'Canon EOS R1 and EOS R5 Mark II launch',
          url: 'https://www.usa.canon.com/newsroom/2024/20240717-camera',
          verifiedAt: '2026-03-07',
        },
        eosR50V: {
          label: 'Canon EOS R50 V launch',
          url: 'https://www.usa.canon.com/newsroom/2025/20250326-camera',
          verifiedAt: '2026-03-07',
        },
        eosR6MarkIII: {
          label: 'Canon EOS R6 Mark III product page',
          url: 'https://www.usa.canon.com/shop/p/eos-r6-mark-iii',
          verifiedAt: '2026-03-07',
        },
      },
      bodies: [
        { displayName: 'EOS R1', lineupStatus: 'current-lineup', sourceIds: ['eosRSystem', 'eosR1AndR5MarkII'] },
        { displayName: 'EOS R3', lineupStatus: 'current-lineup', sourceIds: ['eosRSystem'] },
        { displayName: 'EOS R5 Mark II', lineupStatus: 'current-lineup', sourceIds: ['eosRSystem', 'eosR1AndR5MarkII'] },
        { displayName: 'EOS R5', lineupStatus: 'current-lineup', sourceIds: ['eosRSystem'] },
        { displayName: 'EOS R6 Mark III', lineupStatus: 'current-product-page', sourceIds: ['eosR6MarkIII'] },
        { displayName: 'EOS R6 Mark II', lineupStatus: 'current-lineup', sourceIds: ['eosRSystem'] },
        { displayName: 'EOS R6', lineupStatus: 'current-lineup', sourceIds: ['eosRSystem'] },
        { displayName: 'EOS R7', lineupStatus: 'current-lineup', sourceIds: ['eosRSystem'] },
        { displayName: 'EOS R8', lineupStatus: 'current-lineup', sourceIds: ['eosRSystem'] },
        { displayName: 'EOS RP', lineupStatus: 'current-lineup', sourceIds: ['eosRSystem'] },
        { displayName: 'EOS R10', lineupStatus: 'current-lineup', sourceIds: ['eosRSystem'] },
        { displayName: 'EOS R50', lineupStatus: 'current-lineup', sourceIds: ['eosRSystem'] },
        { displayName: 'EOS R50 V', lineupStatus: 'current-lineup', sourceIds: ['eosRSystem', 'eosR50V'] },
        { displayName: 'EOS R100', lineupStatus: 'current-lineup', sourceIds: ['eosRSystem'] },
        { displayName: 'EOS R5 C', lineupStatus: 'current-lineup', sourceIds: ['eosRSystem'] },
      ],
    },
    sony: {
      notes: [
        'Sony category pages are much more reliable than Canon for current lineup coverage, but some active bodies only appear on direct product pages or vlog pages instead of the main stills category pages.',
        'The Sony baseline includes still, hybrid, and interchangeable-lens vlog bodies because the current Kaayko dataset already mixes Alpha and ZV cameras.',
      ],
      sources: {
        allBodies: {
          label: 'Sony all interchangeable-lens cameras',
          url: 'https://electronics.sony.com/imaging/interchangeable-lens-cameras/c/all-interchangeable-lens-cameras',
          verifiedAt: '2026-03-07',
        },
        fullFrameCategory: {
          label: 'Sony full-frame category',
          url: 'https://electronics.sony.com/imaging/interchangeable-lens-cameras/c/full-frame',
          verifiedAt: '2026-03-07',
        },
        apscCategory: {
          label: 'Sony APS-C category',
          url: 'https://electronics.sony.com/imaging/interchangeable-lens-cameras/c/aps-c',
          verifiedAt: '2026-03-07',
        },
        vlogCategory: {
          label: 'Sony vlog camera category',
          url: 'https://electronics.sony.com/imaging/compact-cameras/c/vlog-cameras',
          verifiedAt: '2026-03-07',
        },
        a9II: {
          label: 'Sony Alpha 9 II product page',
          url: 'https://electronics.sony.com/imaging/interchangeable-lens-cameras/full-frame/p/ilce9m2-b?sku=ilce9m2-b',
          verifiedAt: '2026-03-07',
        },
        a7SIII: {
          label: 'Sony Alpha 7S III product page',
          url: 'https://electronics.sony.com/imaging/interchangeable-lens-cameras/all-interchangeable-lens-cameras/p/ilce7sm3-b',
          verifiedAt: '2026-03-07',
        },
        a7C: {
          label: 'Sony Alpha 7C product page',
          url: 'https://electronics.sony.com/imaging/interchangeable-lens-cameras/all-interchangeable-lens-cameras/p/ilce7c-s',
          verifiedAt: '2026-03-07',
        },
        a6600: {
          label: 'Sony Alpha 6600 product page',
          url: 'https://electronics.sony.com/imaging/interchangeable-lens-cameras/aps-c/p/ilce6600-b',
          verifiedAt: '2026-03-07',
        },
        zve1: {
          label: 'Sony ZV-E1 product page',
          url: 'https://electronics.sony.com/imaging/interchangeable-lens-cameras/all-interchangeable-lens-cameras/p/ilczve1-b',
          verifiedAt: '2026-03-07',
        },
      },
      bodies: [
        { displayName: 'Alpha 1 II', lineupStatus: 'current-lineup', sourceIds: ['allBodies', 'fullFrameCategory'] },
        { displayName: 'Alpha 1', lineupStatus: 'current-lineup', sourceIds: ['allBodies', 'fullFrameCategory'] },
        { displayName: 'Alpha 9 III', lineupStatus: 'current-lineup', sourceIds: ['allBodies', 'fullFrameCategory'] },
        { displayName: 'Alpha 9 II', lineupStatus: 'current-product-page', sourceIds: ['a9II'] },
        { displayName: 'Alpha 7 V', lineupStatus: 'current-lineup', sourceIds: ['allBodies', 'fullFrameCategory'] },
        { displayName: 'Alpha 7R V', lineupStatus: 'current-lineup', sourceIds: ['allBodies', 'fullFrameCategory'] },
        { displayName: 'Alpha 7 IV', lineupStatus: 'current-lineup', sourceIds: ['allBodies', 'fullFrameCategory'] },
        { displayName: 'Alpha 7 III', lineupStatus: 'current-lineup', sourceIds: ['allBodies', 'fullFrameCategory'] },
        { displayName: 'Alpha 7C II', lineupStatus: 'current-lineup', sourceIds: ['allBodies', 'fullFrameCategory'] },
        { displayName: 'Alpha 7CR', lineupStatus: 'current-lineup', sourceIds: ['allBodies', 'fullFrameCategory'] },
        { displayName: 'Alpha 7C', lineupStatus: 'current-product-page', sourceIds: ['a7C'] },
        { displayName: 'Alpha 7R IV', lineupStatus: 'current-lineup', sourceIds: ['allBodies', 'fullFrameCategory'] },
        { displayName: 'Alpha 7S III', lineupStatus: 'current-product-page', sourceIds: ['a7SIII'] },
        { displayName: 'Alpha ZV-E1', lineupStatus: 'current-product-page', sourceIds: ['vlogCategory', 'zve1'] },
        { displ
/* [truncated — 7673 chars total, showing first 7000] */

--- END CONTENT ---

FILE: api:functions/api/smartLinks/smartLinkValidation.js
LINES: 84
CHARS: 2108
TRUNCATED: no
--- BEGIN CONTENT ---
/**
 * Smart Link Validation Utilities
 * Centralized validation logic for smart links
 */

/**
 * Generate a unique 6-character short code with 'lk' prefix (Branch-style)
 * @returns {string} Random alphanumeric code (e.g., "lk1ngp", "lk9xrf")
 */
function generateShortCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = 'lk';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Validate link ID format
 * @param {string} id - Link identifier
 * @returns {boolean} True if valid
 */
function isValidLinkId(id) {
  if (!id || typeof id !== 'string') return false;
  return /^[a-zA-Z0-9_-]{3,50}$/.test(id);
}

/**
 * Validate short code format
 * @param {string} code - Short code
 * @returns {boolean} True if valid
 */
function isValidShortCode(code) {
  if (!code || typeof code !== 'string') return false;
  // Allow alphanumeric, hyphens, and underscores (3-50 chars)
  return /^[a-zA-Z0-9_-]{3,50}$/.test(code);
}

/**
 * Validate content space
 * @param {string} space - Content space name
 * @returns {boolean} True if valid
 */
function isValidSpace(space) {
  const validSpaces = ['lake', 'product', 'category', 'store', 'reads', 'spot', 'qr', 'promo', 'custom'];
  return validSpaces.includes(space);
}

/**
 * Get list of all valid spaces
 * @returns {string[]} Array of valid space names
 */
function getValidSpaces() {
  return ['lake', 'product', 'category', 'store', 'reads', 'spot', 'qr', 'promo', 'custom'];
}

/**
 * Normalize UTM parameters
 * @param {Object} query - Query parameters
 * @returns {Object} Normalized UTM parameters
 */
function normalizeUTMs(query) {
  const UTM_WHITELIST = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  const normalized = {};
  
  for (const key of UTM_WHITELIST) {
    if (query[key]) {
      normalized[key] = String(query[key]).toLowerCase().slice(0, 100);
    }
  }
  
  return normalized;
}

module.exports = {
  generateShortCode,
  isValidLinkId,
  isValidShortCode,
  isValidSpace,
  getValidSpaces,
  normalizeUTMs
};

--- END CONTENT ---

FILE: api:functions/api/weather/inputStandardization.js
LINES: 286
CHARS: 8119
TRUNCATED: yes (showing 7058 of 8119 chars)
--- BEGIN CONTENT ---
// File: functions/src/utils/inputStandardization.js
//
// 🔧 INPUT STANDARDIZATION UTILITY  
//
// Standardizes API input parameters across all endpoints to ensure consistent
// developer experience and prevent confusion from different parameter names

/**
 * Standard parameter names and their accepted aliases
 */
const PARAMETER_ALIASES = {
  // Location coordinates - support multiple formats
  latitude: ['lat', 'latitude'],
  longitude: ['lng', 'lon', 'longitude'], 
  
  // Combined location formats
  location: ['location', 'coords', 'coordinates'],
  
  // Known spots/places
  spotId: ['spotId', 'spot', 'id'],
  
  // Search parameters
  radius: ['radius', 'distance', 'range'],
  limit: ['limit', 'count', 'max', 'maxResults']
};

/**
 * Default values for common parameters
 */
const DEFAULTS = {
  radius: 80, // km
  limit: 50,
  latitude: null,
  longitude: null
};

/**
 * Coordinate validation ranges
 */
const COORDINATE_LIMITS = {
  latitude: { min: -90, max: 90 },
  longitude: { min: -180, max: 180 }
};

/**
 * Parse location string in various formats:
 * - "lat,lng" 
 * - "lat, lng"
 * - "latitude,longitude"
 * @param {string} locationStr - Location string
 * @returns {object|null} {latitude, longitude} or null if invalid
 */
function parseLocationString(locationStr) {
  if (!locationStr || typeof locationStr !== 'string') {
    return null;
  }

  // Clean and split the location string
  const cleaned = locationStr.replace(/[^a-zA-Z0-9,.-]/g, '');
  const parts = cleaned.split(',').map(part => parseFloat(part.trim()));
  
  if (parts.length !== 2 || parts.some(isNaN)) {
    return null;
  }

  const [latitude, longitude] = parts;
  return { latitude, longitude };
}

/**
 * Validate coordinate values
 * @param {number} latitude 
 * @param {number} longitude 
 * @returns {object} {valid, errors}
 */
function validateCoordinates(latitude, longitude) {
  const errors = [];
  
  if (typeof latitude !== 'number' || isNaN(latitude)) {
    errors.push('Latitude must be a valid number');
  } else if (latitude < COORDINATE_LIMITS.latitude.min || latitude > COORDINATE_LIMITS.latitude.max) {
    errors.push(`Latitude must be between ${COORDINATE_LIMITS.latitude.min} and ${COORDINATE_LIMITS.latitude.max}`);
  }
  
  if (typeof longitude !== 'number' || isNaN(longitude)) {
    errors.push('Longitude must be a valid number');
  } else if (longitude < COORDINATE_LIMITS.longitude.min || longitude > COORDINATE_LIMITS.longitude.max) {
    errors.push(`Longitude must be between ${COORDINATE_LIMITS.longitude.min} and ${COORDINATE_LIMITS.longitude.max}`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Standardize API input parameters
 * Accepts multiple parameter formats and returns standardized object
 * 
 * @param {object} queryParams - Raw query parameters from req.query
 * @returns {object} Standardized parameters with validation
 */
function standardizeInputs(queryParams) {
  const result = {
    // Core location parameters
    latitude: null,
    longitude: null,
    spotId: null,
    
    // Search parameters  
    radius: DEFAULTS.radius,
    limit: DEFAULTS.limit,
    
    // Validation results
    valid: true,
    errors: [],
    warnings: []
  };

  // Extract latitude from various aliases
  for (const alias of PARAMETER_ALIASES.latitude) {
    if (queryParams[alias] !== undefined) {
      const value = parseFloat(queryParams[alias]);
      if (!isNaN(value)) {
        result.latitude = value;
        break;
      }
    }
  }

  // Extract longitude from various aliases
  for (const alias of PARAMETER_ALIASES.longitude) {
    if (queryParams[alias] !== undefined) {
      const value = parseFloat(queryParams[alias]);
      if (!isNaN(value)) {
        result.longitude = value;
        break;
      }
    }
  }

  // Extract combined location parameter
  for (const alias of PARAMETER_ALIASES.location) {
    if (queryParams[alias] !== undefined && result.latitude === null && result.longitude === null) {
      const parsed = parseLocationString(queryParams[alias]);
      if (parsed) {
        result.latitude = parsed.latitude;
        result.longitude = parsed.longitude;
        break;
      } else {
        result.errors.push(`Invalid location format: ${queryParams[alias]}. Expected: "lat,lng"`);
      }
    }
  }

  // Extract spotId from various aliases
  for (const alias of PARAMETER_ALIASES.spotId) {
    if (queryParams[alias] !== undefined) {
      result.spotId = queryParams[alias].toString();
      break;
    }
  }

  // Extract radius
  for (const alias of PARAMETER_ALIASES.radius) {
    if (queryParams[alias] !== undefined) {
      const value = parseFloat(queryParams[alias]);
      if (!isNaN(value) && value > 0) {
        result.radius = value;
        break;
      }
    }
  }

  // Extract limit
  for (const alias of PARAMETER_ALIASES.limit) {
    if (queryParams[alias] !== undefined) {
      const value = parseInt(queryParams[alias]);
      if (!isNaN(value) && value > 0) {
        result.limit = Math.min(value, 200); // Cap at 200
        break;
      }
    }
  }

  // Validate coordinates if provided
  if (result.latitude !== null && result.longitude !== null) {
    const validation = validateCoordinates(result.latitude, result.longitude);
    if (!validation.valid) {
      result.errors.push(...validation.errors);
      result.valid = false;
    }
  }

  // Check if we have valid location data
  const hasCoordinates = result.latitude !== null && result.longitude !== null;
  const hasSpotId = result.spotId !== null;
  
  if (!hasCoordinates && !hasSpotId) {
    result.errors.push('Location required: provide coordinates (lat,lng) or spotId');
    result.valid = false;
  }

  // Add warnings for deprecated parameters
  const deprecatedParams = ['coords', 'coordinates', 'spot', 'id'];
  for (const param of deprecatedParams) {
    if (queryParams[param] !== undefined) {
      result.warnings.push(`Parameter '${param}' is deprecated. Use standard names: lat, lng, spotId`);
    }
  }

  return result;
}

/**
 * Create standardized error response for invalid inputs
 * @param {object} inputResult - Result from standardizeInputs()
 * @param {string} endpoint - API endpoint name
 * @returns {object} Error response object
 */
function createInputErrorResponse(inputResult, endpoint) {
  return {
    success: false,
    error: 'Invalid input parameters',
    details: inputResult.errors,
    warnings: inputResult.warnings,
    usage: {
      endpoint: `/${endpoint}`,
      parameters: {
        location_methods: [
          'lat=42.3601&lng=-71.0589 (separate coordinates)',
          'location=42.3601,-71.0589 (combined coordinates)',  
          'spotId=merrimack (known spot ID)'
        ],
        optional: {
          radius: 'Search radius in km (default: 80)',
          limit: 'Maximum results (default: 50, max: 200)'
        }
      },
      examples: {
        coordinates: `/${endpoint}?lat=42.3601&lng=-71.0589`,
        location_string
/* [truncated — 8119 chars total, showing first 7000] */

--- END CONTENT ---

FILE: api:functions/api/weather/sharedWeatherUtils.js
LINES: 221
CHARS: 6598
TRUNCATED: no
--- BEGIN CONTENT ---
//  functions/src/utils/sharedWeatherUtils.js
//
//  Shared utilities for weather and paddling APIs
//  Maximizes code reuse and ensures consistency across APIs
//

const { WEATHER_CONFIG } = require('../../config/weatherConfig');

/**
 * Shared rate limiting middleware
 */
function createRateLimitMiddleware(maxRequests = 30, windowMs = 60000) {
  const rateLimitMap = new Map();

  return function rateLimitMiddleware(req, res, next) {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    
    if (!rateLimitMap.has(clientIP)) {
      rateLimitMap.set(clientIP, { count: 0, resetTime: now + windowMs });
    }
    
    const clientData = rateLimitMap.get(clientIP);
    
    if (now > clientData.resetTime) {
      clientData.count = 0;
      clientData.resetTime = now + windowMs;
    }
    
    if (clientData.count >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        details: 'Too many requests. Please slow down.',
        retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
      });
    }
    
    clientData.count++;
    next();
  };
}

/**
 * Shared security headers middleware
 */
function securityHeadersMiddleware(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  next();
}

/**
 * Fetch all paddling locations directly from Firestore.
 * Never makes an HTTP call back to the paddlingOut API — that creates a circular
 * dependency and becomes a single point of failure for all scheduled jobs.
 * Firestore is always the authoritative source for spot coordinates.
 */
async function fetchPaddlingLocations(db) {
  const snapshot = await Promise.race([
    db.collection('paddlingSpots').get(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firestore timeout after 8s')), 8000)
    )
  ]);

  return snapshot.docs
    .map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.title || data.lakeName || doc.id,
        coordinates: {
          latitude: data.location?.latitude,
          longitude: data.location?.longitude
        },
        amenities: {
          parking: data.parkingAvl === true || data.parkingAvl === 'Y',
          restrooms: data.restroomsAvl === true || data.restroomsAvl === 'Y'
        }
      };
    })
    .filter(spot =>
      spot.coordinates.latitude &&
      spot.coordinates.longitude &&
      Math.abs(spot.coordinates.latitude) <= 90 &&
      Math.abs(spot.coordinates.longitude) <= 180
    );
}

/**
 * Validates WeatherAPI response structure and adds safe defaults
 */
function validateAndSanitizeWeatherData(weatherData) {
  if (!weatherData || !weatherData.current || !weatherData.location) {
    throw new Error('Invalid weather data structure received from WeatherAPI');
  }

  const current = weatherData.current;
  const location = weatherData.location;

  return {
    current: {
      temp_c: current.temp_c || 15,
      temp_f: current.temp_f || 59,
      feelslike_c: current.feelslike_c || current.temp_c || 15,
      feelslike_f: current.feelslike_f || current.temp_f || 59,
      wind_mph: current.wind_mph || 0,
      wind_kph: current.wind_kph || 0,
      wind_dir: current.wind_dir || 'N',
      wind_degree: current.wind_degree || 0,
      gust_mph: current.gust_mph || current.wind_mph || 0,
      gust_kph: current.gust_kph || current.wind_kph || 0,
      pressure_mb: current.pressure_mb || 1013,
      pressure_in: current.pressure_in || 29.92,
      humidity: current.humidity || 50,
      vis_km: current.vis_km || 10,
      vis_miles: current.vis_miles || 6,
      cloud: current.cloud || 0,
      uv: current.uv || 0,
      is_day: current.is_day !== undefined ? current.is_day : 1,
      precip_mm: current.precip_mm || 0,
      precip_in: current.precip_in || 0,
      windchill_c: current.windchill_c || current.temp_c || 15,
      windchill_f: current.windchill_f || current.temp_f || 59,
      heatindex_c: current.heatindex_c || current.temp_c || 15,
      heatindex_f: current.heatindex_f || current.temp_f || 59,
      dewpoint_c: current.dewpoint_c || (current.temp_c - 5) || 10,
      dewpoint_f: current.dewpoint_f || (current.temp_f - 9) || 50,
      condition: current.condition || { text: 'Unknown', code: 0, icon: '' },
      air_quality: current.air_quality || null
    },
    location: {
      name: location.name || 'Unknown',
      region: location.region || '',
      country: location.country || 'Unknown',
      lat: location.lat || 0,
      lon: location.lon || 0,
      tz_id: location.tz_id || 'UTC',
      localtime: location.localtime || new Date().toISOString()
    }
  };
}

/**
 * Enhanced error handling for API calls
 */
function createAPIErrorHandler(serviceName) {
  return function handleAPIError(error, req, res, next) {
    console.error(`${serviceName} API Error:`, error);
    
    const statusCode = error.statusCode || 500;
    const errorResponse = {
      success: false,
      error: `${serviceName} service error`,
      timestamp: new Date().toISOString()
    };

    // Add development details
    if (process.env.NODE_ENV === 'development') {
      errorResponse.details = error.message;
      errorResponse.stack = error.stack;
    }

    // Rate limit specific error
    if (statusCode === 429) {
      errorResponse.retryAfter = error.retryAfter || 60;
    }

    res.status(statusCode).json(errorResponse);
  };
}

/**
 * Coordinate validation utility
 */
function validateCoordinates(lat, lng) {
  const errors = [];
  
  if (!lat || !lng) {
    errors.push('Both latitude and longitude are required');
    return { isValid: false, errors };
  }
  
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  
  if (isNaN(latitude) || isNaN(longitude)) {
    errors.push('Coordinates must be valid numbers');
    return { isValid: false, errors };
  }
  
  if (latitude < -90 || latitude > 90) {
    errors.push('Latitude must be between -90 and 90 degrees');
  }
  
  if (longitude < -180 || longitude > 180) {
    errors.push('Longitude must be between -180 and 180 degrees');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    coordinates: { latitude, longitude }
  };
}

module.exports = {
  WEATHER_CONFIG,
  createRateLimitMiddleware,
  securityHeadersMiddleware,
  fetchPaddlingLocations,
  validateAndSanitizeWeatherData,
  createAPIErrorHandler,
  validateCoordinates
};

--- END CONTENT ---

FILE: api:functions/api/checkout/createPaymentIntent.js
LINES: 189
CHARS: 6587
TRUNCATED: no
--- BEGIN CONTENT ---
/**
 * Create Payment Intent for Stripe Checkout
 * Handles product purchases with Stripe integration
 */

const admin = require('firebase-admin');

// Lazy-load Stripe to avoid timeout during function initialization
let stripe = null;
function getStripe() {
  if (!stripe) {
    // IMPORTANT: Firebase secrets may include trailing newlines, so we must trim
    const apiKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    stripe = require('stripe')(apiKey, {
      timeout: 60000,
      maxNetworkRetries: 2,
      telemetry: false
    });
  }
  return stripe;
}

/**
 * Create a Stripe Payment Intent for a product purchase
 * @route POST /api/createPaymentIntent
 * @body {productId, productTitle, size, price}
 * @returns {clientSecret, paymentIntentId}
 */
async function createPaymentIntent(req, res) {
  try {
    const { items, dataRetentionConsent, customerEmail, customerPhone, productId, productTitle, size, gender, price } = req.body;

    let validatedItems = [];
    let totalAmount = 0;

    // NEW FORMAT: items array
    if (items && Array.isArray(items) && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const priceString = String(item.price).replace(/[$,]/g, '').trim();
        const priceInCents = Math.round(parseFloat(priceString) * 100);
        
        if (isNaN(priceInCents) || priceInCents <= 0) {
          return res.status(400).json({
            success: false,
            error: `Item ${i + 1} has invalid price: "${item.price}"`
          });
        }
        
        totalAmount += priceInCents;
        validatedItems.push({
          productId: item.productId,
          productTitle: item.productTitle || 'Unknown Product',
          size: item.size,
          gender: item.gender || 'Unisex',
          price: item.price,
          priceInCents: priceInCents
        });
      }
    }
    // OLD FORMAT: comma-separated strings (BACKWARDS COMPATIBILITY)
    else if (productId && size && price) {
      const productIds = String(productId).split(',').map(s => s.trim());
      const productTitles = String(productTitle || 'Product').split(',').map(s => s.trim());
      const sizes = String(size).split(',').map(s => s.trim());
      const genders = String(gender || 'Unisex').split(',').map(s => s.trim());
      
      // Parse total price
      const priceString = String(price).replace(/[$,]/g, '').trim();
      totalAmount = Math.round(parseFloat(priceString) * 100);
      
      if (isNaN(totalAmount) || totalAmount <= 0) {
        return res.status(400).json({
          success: false,
          error: `Invalid price: "${price}"`
        });
      }
      
      // Create items from comma-separated data
      validatedItems = productIds.map((id, idx) => ({
        productId: id,
        productTitle: productTitles[idx] || 'Unknown Product',
        size: sizes[idx] || 'Unknown',
        gender: genders[idx] || 'Unisex',
        price: price,
        priceInCents: Math.round(totalAmount / productIds.length) // Split price evenly
      }));
    } else {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: either items array OR productId, size, price'
      });
    }
    
    console.log(`💰 Creating payment for ${validatedItems.length} items, total: $${(totalAmount/100).toFixed(2)}`);

    // Create payment intent with Stripe (lazy-loaded)
    const stripeClient = getStripe();
    const paymentIntent = await stripeClient.paymentIntents.create({
      amount: totalAmount,
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true,
      },
      // Don't set receipt_email - it will be collected via Payment Element
      metadata: {
        // Store items as JSON string (Stripe metadata has size limits)
        items: JSON.stringify(validatedItems),
        itemCount: String(validatedItems.length),
        timestamp: new Date().toISOString(),
        notifyEmail: 'rohan@kaayko.com', // Admin notification email
        dataRetentionConsent: String(dataRetentionConsent === true) // User's privacy consent
      }
    });

    // Log the transaction attempt
    const itemsSummary = validatedItems.map(i => `${i.productTitle} (${i.gender} ${i.size})`).join(', ');
    console.log(`💳 Payment intent created: ${paymentIntent.id} for ${itemsSummary}`);

    // Store payment intent in Firestore with PROPER structure
    const db = admin.firestore();
    await db.collection('payment_intents').doc(paymentIntent.id).set({
      // Payment summary
      paymentIntentId: paymentIntent.id,
      totalAmount: totalAmount,
      totalAmountFormatted: `$${(totalAmount / 100).toFixed(2)}`,
      currency: 'usd',
      itemCount: validatedItems.length,
      
      // Order lifecycle tracking
      status: 'created', // created → pending → succeeded → fulfilled → cancelled
      paymentStatus: 'pending', // pending → succeeded → failed → refunded
      fulfillmentStatus: 'awaiting_payment', // awaiting_payment → processing → fulfilled → cancelled
      
      // Timestamps
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      paidAt: null,
      fulfilledAt: null,
      cancelledAt: null,
      
      // Items array - each item is a complete object
      items: validatedItems.map(item => ({
        productId: item.productId,
        productTitle: item.productTitle,
        size: item.size,
        gender: item.gender,
        price: item.price,
        priceInCents: item.priceInCents
      })),
      
      // Customer contact info
      customerEmail: customerEmail || null,
      customerPhone: customerPhone || null,
      
      // Privacy
      dataRetentionConsent: dataRetentionConsent || false,
      
      // Tracking history (audit trail)
      statusHistory: [{
        status: 'created',
        timestamp: new Date().toISOString(),
        note: 'Payment intent created'
      }]
    });
    
    console.log(`✅ Stored payment intent ${paymentIntent.id} with ${validatedItems.length} items in Firestore`);

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });

  } catch (error) {
    console.error('❌ Payment intent error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create payment intent',
      details: error.message
    });
  }
}

module.exports = createPaymentIntent;

--- END CONTENT ---

FILE: api:functions/api/checkout/stripeWebhook.js
LINES: 331
CHARS: 10342
TRUNCATED: yes (showing 7059 of 10342 chars)
--- BEGIN CONTENT ---
/**
 * Stripe Webhook Handler
 * Processes payment events and sends email notifications
 */

const admin = require('firebase-admin');

// Lazy-load Stripe
let stripe = null;
function getStripe() {
  if (!stripe) {
    require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    stripe = require('stripe')(apiKey);
  }
  return stripe;
}

/**
 * Handle Stripe webhooks
 * @route POST /api/stripeWebhook
 */
async function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    console.error('❌ STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;

  try {
    const stripeClient = getStripe();
    // When using express.raw(), body is a Buffer in req.body
    const rawBody = req.body;
    event = stripeClient.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error(`⚠️  Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log(`💳 Payment succeeded: ${paymentIntent.id}`);
      await handlePaymentSuccess(paymentIntent);
      break;
      
    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log(`❌ Payment failed: ${failedPayment.id}`);
      await handlePaymentFailure(failedPayment);
      break;
      
    default:
      console.log(`ℹ️  Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
}

/**
 * Handle successful payment - send emails and update database
 */
async function handlePaymentSuccess(paymentIntent) {
  try {
    const db = admin.firestore();
    
    // Update payment intent status in Firestore with comprehensive tracking
    const now = new Date().toISOString();
    await db.collection('payment_intents').doc(paymentIntent.id).update({
      status: 'succeeded',
      paymentStatus: 'succeeded',
      fulfillmentStatus: 'processing',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      paidAt: now,
      amount: paymentIntent.amount,
      statusHistory: admin.firestore.FieldValue.arrayUnion({
        status: 'succeeded',
        timestamp: now,
        note: 'Payment successful'
      })
    });
    
    // Parse items from metadata (stored as JSON string)
    let cartItems = [];
    try {
      cartItems = JSON.parse(paymentIntent.metadata.items || '[]');
    } catch (e) {
      console.error('Failed to parse items from metadata:', e);
      // Fallback to legacy single-item format
      cartItems = [{
        productId: paymentIntent.metadata.productId,
        productTitle: paymentIntent.metadata.productTitle,
        size: paymentIntent.metadata.size,
        gender: paymentIntent.metadata.gender,
        price: paymentIntent.metadata.price
      }];
    }
    
    // Common data for all order items
    const commonData = {
      parentOrderId: paymentIntent.id, // Link all items to same payment
      totalAmount: paymentIntent.amount,
      currency: paymentIntent.currency,
      
      // Order lifecycle tracking
      orderStatus: 'pending', // pending → processing → shipped → delivered → returned
      fulfillmentStatus: 'processing', // processing → ready_to_ship → shipped → delivered
      paymentStatus: 'paid', // paid → refunded → partially_refunded
      
      // Timestamps
      createdAt: paymentIntent.metadata.timestamp,
      updatedAt: now,
      paidAt: now,
      processedAt: null,
      shippedAt: null,
      deliveredAt: null,
      returnedAt: null,
      
      // Shipping tracking
      trackingNumber: null,
      carrier: null,
      trackingUrl: null,
      estimatedDelivery: null,
      
      // Contact info (stored if user provided consent)
      customerEmail: paymentIntent.receipt_email || null,
      customerPhone: paymentIntent.shipping?.phone || null,
      
      // Shipping info (always stored - needed for fulfillment)
      shippingAddress: paymentIntent.shipping ? {
        name: paymentIntent.shipping.name,
        line1: paymentIntent.shipping.address.line1,
        line2: paymentIntent.shipping.address.line2 || null,
        city: paymentIntent.shipping.address.city,
        state: paymentIntent.shipping.address.state,
        postal_code: paymentIntent.shipping.address.postal_code,
        country: paymentIntent.shipping.address.country
      } : null,
      
      // Privacy flag
      dataRetentionConsent: paymentIntent.metadata.dataRetentionConsent === 'true' || false,
      
      // Analytics (non-PII)
      paymentMethod: paymentIntent.payment_method_types?.[0] || 'unknown',
      
      // Status history (audit trail)
      statusHistory: [
        {
          status: 'pending',
          timestamp: paymentIntent.metadata.timestamp,
          note: 'Order created'
        },
        {
          status: 'paid',
          timestamp: now,
          note: 'Payment successful'
        },
        {
          status: 'processing',
          timestamp: now,
          note: 'Order processing started'
        }
      ],
      
      // Admin notes
      internalNotes: [],
      customerNotes: null
    };
    
    // Create SEPARATE order document for EACH item
    const batch = db.batch();
    cartItems.forEach((item, index) => {
      const orderRef = db.collection('orders').doc(`${paymentIntent.id}_item${index + 1}`);
      batch.set(orderRef, {
        ...commonData,
        orderId: `${paymentIntent.id}_item${index + 1}`,
        itemIndex: index + 1,
        totalItems: cartItems.length,
        
        // Individual item details
        productId: item.productId,
        productTitle: item.productTitle,
        size: item.size,
        gender: item.gender,
        price: item.price
      });
    });
    
    await batch.commit();
    console.log(`✅ Created ${cartItems.length} separate order documents for payment ${paymentIntent.id}`);
    
    // Send email notifications
    await sendOrderConfirmationEmails(paymentIntent);
    
    console.log(`✅ Order processed successfully: ${paymentIntent.id}`);
    
  } catch (error) {
    console.error(`❌ Error handling payment success:`, error);
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailure(paymentIntent) {
  try {
    const db = admin.firestore();
    
    const now = new Date().toISOString();
    await db.collection('payment_intents').doc(paymentIntent.id).update({
      status: 'failed',
      paymentStatus: 'failed',
      fulfillmentStatus: 'cancelled',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      failedAt: now,
      cancelledAt: now,
      st
/* [truncated — 10342 chars total, showing first 7000] */

--- END CONTENT ---

FILE: api:functions/api/smartLinks/redirectHandler.js
LINES: 401
CHARS: 12394
TRUNCATED: yes (showing 7059 of 12394 chars)
--- BEGIN CONTENT ---
/**
 * Smart Link Redirect Handler - SHORT CODES ONLY
 * 
 * SIMPLIFIED: Only handles short codes (lkXXXX)
 * Single route: kaayko.com/l/lkXXXX
 * 
 * Features:
 * - Short code links (e.g., lk1ngp, lk9xrf)
 * - Platform-specific destinations (iOS/Android/Web)
 * - Click analytics tracking
 * - Expiration checking
 * - Enable/disable functionality
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { trackClick, updateClickRedirect } = require('./clickTracking');

const db = admin.firestore();

/**
 * Detect user's platform from User-Agent string
 * @param {string} userAgent - Request User-Agent header
 * @returns {'ios'|'android'|'web'} Platform identifier
 */
function detectPlatform(userAgent = '') {
  const ua = userAgent.toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
  if (ua.includes('android')) return 'android';
  return 'web';
}

/**
 * Generate branded error page with Kaayko dark theme styling
 * @param {number} code - HTTP status code
 * @param {string} title - Error title
 * @param {string} message - User-friendly error message
 * @param {boolean} showAppButton - Whether to show "Go to Kaayko" button
 * @returns {string} HTML error page
 */
function errorPage(code, title, message, showAppButton = true) {
  const appButton = showAppButton 
    ? `<a href="https://kaayko.com" class="btn">Go to Kaayko</a>`
    : '';
  
  // Icon based on error type
  const icon = code === 404 ? '🔍' : code === 410 ? '⏰' : '⚠️';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title} | Kaayko</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="icon" type="image/png" sizes="32x32" href="https://kaayko.com/favicon-32x32.png">
      <link href="https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Josefin Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0a0a0a;
          color: #fff;
          padding: 20px;
        }
        .container {
          max-width: 420px;
          width: 100%;
          text-align: center;
        }
        .logo {
          width: 60px;
          height: 60px;
          margin: 0 auto 24px;
          background: linear-gradient(135deg, #D4A84B 0%, #C4983B 100%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          font-weight: 700;
          color: #0a0a0a;
          box-shadow: 0 4px 20px rgba(212, 168, 75, 0.3);
        }
        .card {
          background: #141414;
          border: 1px solid #2a2a2a;
          border-radius: 16px;
          padding: 40px 32px;
        }
        .icon {
          font-size: 48px;
          margin-bottom: 16px;
        }
        h1 {
          font-size: 24px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 8px;
        }
        p {
          font-size: 15px;
          color: #888;
          line-height: 1.5;
          margin-bottom: 24px;
        }
        .btn {
          display: inline-block;
          background: linear-gradient(135deg, #D4A84B 0%, #C4983B 100%);
          color: #0a0a0a;
          font-family: inherit;
          font-size: 14px;
          font-weight: 600;
          padding: 12px 28px;
          border-radius: 8px;
          text-decoration: none;
          transition: all 0.2s ease;
          box-shadow: 0 2px 12px rgba(212, 168, 75, 0.25);
        }
        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(212, 168, 75, 0.4);
        }
        .footer {
          margin-top: 32px;
          font-size: 13px;
          color: #555;
        }
        .footer a {
          color: #D4A84B;
          text-decoration: none;
        }
        .footer a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">K</div>
        <div class="card">
          <div class="icon">${icon}</div>
          <h1>${title}</h1>
          <p>${message}</p>
          ${appButton}
        </div>
        <div class="footer">
          <a href="https://kaayko.com">kaayko.com</a> · Know Before You Go
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Main redirect handler for short code links
 * 
 * SIMPLIFIED: Only looks up short_links collection
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object  
 * @param {string} code - Short code (e.g., lk1ngp)
 * @param {Object} options - Optional configuration
 * @param {boolean} options.trackAnalytics - Enable detailed analytics tracking
 * @returns {Promise<void>} Redirects or sends error page
 */
async function handleRedirect(req, res, code, options = {}) {
  try {
    const userAgent = req.get('user-agent') || '';
    const platform = detectPlatform(userAgent);
    
    // Look up short code in short_links collection
    const linkDoc = await db.collection('short_links').doc(code).get();

    // Case 1: Link not found in database
    if (!linkDoc.exists) {
      return res.status(404).send(errorPage(
        404,
        'Link Not Found',
        `The link "${code}" doesn't exist or has been removed.`
      ));
    }

    const linkData = linkDoc.data();

    // Case 2: Link disabled by creator
    if (linkData.enabled === false) {
      return res.status(410).send(errorPage(
        410,
        'Link Disabled',
        'This link has been disabled by its creator.'
      ));
    }

    // Case 3: Link expired
    if (linkData.expiresAt) {
      const expirationDate = linkData.expiresAt.toDate ? linkData.expiresAt.toDate() : new Date(linkData.expiresAt);
      if (expirationDate < new Date()) {
        return res.status(410).send(errorPage(
          410,
          'Link Expired',
          'This link has expired and is no longer available.'
        ));
      }
    }

    // Determine destination URL based on user's platform
    const destinations = linkData.destinations || {};
    let destination = destinations.web || 'https://kaayko.com';
    
    // Handle A/B routing if destinations are arrays
    if (platform === 'ios' && destinations.ios) {
      destination = selectDestinationVariant(destinations.ios);
    } else if (platform === 'android' && destinations.android) {
      destination = selectDestinationVariant(destinations.android);
    } else if (destinations.web) {
      destination = selectDestinationVariant(destinations.web);
    }

    // Track click with full context (generates clickId for attribution)
    let clickId = null;
    if (opti
/* [truncated — 12394 chars total, showing first 7000] */

--- END CONTENT ---

FILE: api:functions/api/weather/fastForecast.js
LINES: 365
CHARS: 14608
TRUNCATED: yes (showing 7059 of 14608 chars)
--- BEGIN CONTENT ---
// File: functions/src/api/fastForecast.js
//
// ⚡ FAST FORECAST API - Cached 3-Day Weather Forecasts
//
// Ultra-fast cached weather forecasts with ML paddle predictions
// Serves pre-computed or rapidly generated forecasts for frontend

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { logger } = require('firebase-functions');
const ForecastCache = require('../../cache/forecastCache');
const UnifiedWeatherService = require('./unifiedWeatherService');
const mlService = require('./mlService');
const { standardizeForMLModel, standardizeForPenalties, calculateBeaufortFromKph } = require('./dataStandardization');
const { applyEnhancedPenalties } = require('./paddlePenalties');
const { createInputMiddleware } = require('./inputStandardization');
const { calibrateModelPrediction } = require('./modelCalibration');
const { getSmartWarnings } = require('./smartWarnings');

const db = admin.firestore();

/**
 * Transform weather data to match production fastForecast format
 */
async function transformToFastForecastFormat(weatherData, locationQuery) {
    const { current, location, forecast } = weatherData;
    
    if (!forecast || !Array.isArray(forecast)) {
        throw new Error('No forecast data available');
    }
    
    // Get marine data for consistent penalty application
    let marineData = null;
    try {
        const weatherService = new UnifiedWeatherService();
        marineData = await weatherService.getMarineData(locationQuery);
        console.log('🌊 Marine data for fastForecast:', marineData ? 'Available' : 'Not available');
    } catch (error) {
        console.log('ℹ️ Marine data not available for fastForecast');
    }
    
    // Group forecast by days (24 hours each)
    const forecastByDays = [];
    
    for (const dayData of forecast.slice(0, 3)) { // Max 3 days
        const forecastDay = {
            date: dayData.date,
            hourly: {}
        };
        
        if (!dayData.hourly || !Array.isArray(dayData.hourly)) {
            continue;
        }
        
        for (const hourData of dayData.hourly) {
            // Parse the hour from the time string (format: "2025-08-18 14:00")
            const timeParts = hourData.time.split(' ');
            if (timeParts.length !== 2) continue;
            
            const hourStr = timeParts[1].split(':')[0];
            const hour = parseInt(hourStr, 10);
            
            if (isNaN(hour) || hour < 0 || hour > 23) continue;
            
            const KPH_TO_MPH = 0.621371;
            const lat = weatherData.location?.coordinates?.latitude || location.coordinates?.latitude;
            const lng = weatherData.location?.coordinates?.longitude || location.coordinates?.longitude;

            // Real gust from API (WeatherAPI hourly has gust_kph)
            const realGustKph = hourData.gust_kph || hourData.gustKph || (hourData.windKPH * 1.3);
            const realVisKm   = hourData.vis_km   || hourData.visibility || 10;
            const realPrecipMm = hourData.precip_mm ?? hourData.precipMM ?? 0;
            const realRainChancePct = hourData.chance_of_rain ?? hourData.chanceOfRain ?? 0;

            // Extract water temp from marine data for this hour
            let waterTemp = null;
            if (marineData?.forecast?.forecastday) {
                const marineDay = marineData.forecast.forecastday.find(d => d.date === dayData.date);
                const marineHour = marineDay?.hour?.find(h => h.time === hourData.time);
                if (marineHour?.water_temp_c) waterTemp = marineHour.water_temp_c;
            }
            if (waterTemp === null) waterTemp = Math.max(2, hourData.tempC - 8);

            // ML input — real values, no hardcoded defaults
            const rawInput = {
                temperature:          hourData.tempC,
                windSpeedKph:         hourData.windKPH,
                windDirection:        hourData.windDir,
                humidity:             hourData.humidity,
                cloudCover:           hourData.cloudCover,
                uvIndex:              hourData.uvIndex,
                visibility:           realVisKm,
                precipMm:             realPrecipMm,
                precipChancePercent:  realRainChancePct,
                gustSpeedKph:         realGustKph,
                hasWarnings:          false,
                latitude:  lat,
                longitude: lng
            };

            const mlInputData = standardizeForMLModel(rawInput, marineData);

            // ML prediction
            const prediction = await mlService.getPrediction(mlInputData);

            // Calibration (trend, seasonal, location adjustments)
            const calibratedPrediction = calibrateModelPrediction(
                prediction.rating,
                {
                    temperature: hourData.tempC,
                    windSpeed:   hourData.windKPH * KPH_TO_MPH,
                    gustSpeed:   realGustKph      * KPH_TO_MPH,
                    humidity:    hourData.humidity,
                    cloudCover:  hourData.cloudCover,
                    uvIndex:     hourData.uvIndex,
                    visibility:  realVisKm
                },
                weatherData.forecast,
                { latitude: lat, longitude: lng }
            );

            // Penalties — THIS is what was missing. Rain, wind, visibility all apply here.
            const penaltyFeatures = {
                ...mlInputData,
                precipMm:            realPrecipMm,
                precipChancePercent: realRainChancePct,
                visibilityKm:        realVisKm,
                waterTemp:           waterTemp
            };
            const penaltyResult = applyEnhancedPenalties(
                { rating: calibratedPrediction.calibratedRating },
                penaltyFeatures,
                marineData
            );
            const finalRating = penaltyResult.rating;

            // Smart warnings with real data
            const smartWarnings = getSmartWarnings(
                {
                    temperature: hourData.tempC,
                    windSpeed:   hourData.windKPH * KPH_TO_MPH,
                    gustSpeed:   realGustKph      * KPH_TO_MPH,
                    humidity:    hourData.humidity,
                    cloudCover:  hourData.cloudCover,
                    uvIndex:     hourData.uvIndex,
                    visibility:  realVisKm,
                    waterTemp:   waterTemp
                },
                weatherData,
                { latitude: lat, longitude: lng }
            );

            forecastDay.hourly[hour] = {
                temperature:   hourData.tempC,
                windSpeed:     hourData.windKPH,
                windDirection: hourData.windDir,
                gustSpeed:     realGustKph,
                humidity:      hourData.humidity,
                cloudCover:    hourData.cloudCover,
                uvIndex:   
/* [truncated — 14608 chars total, showing first 7000] */

--- END CONTENT ---

FILE: api:functions/api/weather/forecast.js
LINES: 396
CHARS: 13379
TRUNCATED: yes (showing 7059 of 13379 chars)
--- BEGIN CONTENT ---
// File: functions/src/api/forecast.js
//
// 🔒 INTERNAL FORECAST API - Used by scheduled jobs and premium users
//
// This generates comprehensive weather forecasts with ML predictions
// Results are cached for fastForecast API to serve to frontend

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const rateLimit = require('../../middleware/rateLimit');
const UnifiedWeatherService = require('./unifiedWeatherService');
const mlService = require('./mlService');
const { createInputMiddleware } = require('./inputStandardization');

const db = admin.firestore();

// Limited rate for internal/premium use only
router.use(rateLimit(10, 60_000));

/**
 * 🎯 GENERATE COMPREHENSIVE FORECAST
 * Core function used by scheduled jobs
 */
async function generateComprehensiveForecast(location) {
  console.log(`Generating forecast for ${location} (scheduled)`);
  
  try {
    const weatherService = new UnifiedWeatherService();
    const weatherData = await weatherService.getWeatherData(location, { includeForecast: true });

    if (!weatherData || !weatherData.current || !weatherData.location) {
      throw new Error('Invalid weather data - missing current conditions or location');
    }

    const { current, forecast } = weatherData;

    // Create comprehensive forecast with paddle predictions
    const result = {
      success: true,
      data: {
        location,
        current: {
          ...current,
          paddle_summary: await generatePaddleSummary(current, weatherData.location),
          safety_level: calculateSafetyLevel(current)
        },
        forecast: await Promise.all(forecast.map(async (hour) => ({
          ...hour,
          paddle_summary: await generatePaddleSummary(hour, weatherData.location),
          safety_level: calculateSafetyLevel(hour)
        }))),
        metadata: {
          generated: new Date().toISOString(),
          cached_until: new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString(), // 2 hours
          source: 'scheduled-forecast'
        }
      }
    };

    // Cache the forecast (3-day hourly) for fastForecast API
    const cacheKey = `forecast_${location.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    await db.collection('forecast_cache').doc(cacheKey).set({
      ...result.data,
      cached_at: new Date(),
      expires_at: new Date(Date.now() + (4 * 60 * 60 * 1000)) // 4 hours
    });

    // Cache current conditions separately for paddleScore API (20 min TTL)
    const currentCacheKey = `current_${location.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    await db.collection('current_conditions_cache').doc(currentCacheKey).set({
      ...result.data.current,
      location: weatherData.location,
      cached_at: new Date(),
      expires_at: new Date(Date.now() + (20 * 60 * 1000)) // 20 minutes
    });

    console.log(`Cached forecast and current conditions: ${cacheKey}`);
    return result;

  } catch (error) {
    console.error(`❌ Forecast failed for ${location}:`, error);
    return {
      success: false,
      location,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * 📦 BATCH GENERATE FORECASTS
 * Used by scheduled functions to process multiple locations
 */
async function batchGenerateForecasts(locations, batchSize = 3) {
  const startTime = Date.now();
  console.log(`Starting batch forecast for ${locations.length} locations`);

  try {
    const results = [];
    let successful = 0;
    let failed = 0;

    // Process in batches to avoid overwhelming APIs
    for (let i = 0; i < locations.length; i += batchSize) {
      const batch = locations.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      
      console.log(`Processing batch ${batchNum}: ${batch.map(l => l.name || l.id).join(', ')}`);
      
      // Process batch in parallel
      const batchPromises = batch.map(async (loc) => {
        const locationQuery = loc.query || loc.id;
        const result = await generateComprehensiveForecast(locationQuery);
        
        if (result.success) {
          successful++;
          console.log(`Forecast generated for ${loc.name || loc.id} in ${Date.now() - startTime}ms`);
        } else {
          failed++;
        }
        
        return {
          locationName: loc.name || loc.id,
          success: result.success,
          error: result.error || null
        };
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Add small delay between batches
      if (i + batchSize < locations.length) {
        console.log('⏳ Waiting 2 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    const summary = {
      success: true,
      processed: results.length,
      successful,
      failed,
      duration_ms: Date.now() - startTime,
      locations_processed: results.map(r => ({
        name: r.locationName,
        success: r.success,
        error: r.error || null
      }))
    };
    
    console.log(`Batch complete: ${successful}/${results.length} successful in ${Date.now() - startTime}ms`);
    
    return summary;
    
  } catch (error) {
    console.error('❌ Batch generation failed:', error);
    return {
      success: false,
      error: error.message,
      duration_ms: Date.now() - startTime
    };
  }
}

/**
 * 📍 GET PADDLING LOCATIONS
 */
async function getPaddlingLocations() {
  try {
    const snapshot = await db.collection('paddlingSpots').get();
    const locations = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      
      // Extract location query from paddling spot data
      let locationQuery = null;
      
      // Try coordinates first (most accurate for WeatherAPI)
      if (data.location?.coordinates?.lat && data.location?.coordinates?.lng) {
        locationQuery = `${data.location.coordinates.lat},${data.location.coordinates.lng}`;
      } else if (data.location?.latitude && data.location?.longitude) {
        // Handle the actual data structure we found
        locationQuery = `${data.location.latitude},${data.location.longitude}`;
      } else if (data.location?.name) {
        locationQuery = data.location.name;
      } else if (data.lakeName) {
        locationQuery = data.lakeName;
      }
      
      if (locationQuery) {
        locations.push({
          id: doc.id,
          name: data.lakeName || data.title || doc.id,
          query: locationQuery,
          latitude: data.location?.latitude || data.location?.coordinates?.lat,
          longitude: data.location?.longitude || data.location?.coordinates?.lng
        });
      }
    });
    
    console.log(`Found ${locations.length} paddling locations`);
    return locations;
    
  } catch (error) {
    console.error('❌ Failed to get paddling locations:', error);
    return [];
  }
}

/**
 * 🏄‍♂️ GENERATE PADDLE SUMMARY using ML Service

/* [truncated — 13379 chars total, showing first 7000] */

--- END CONTENT ---

FILE: api:functions/api/admin/adminUsers.js
LINES: 263
CHARS: 6486
TRUNCATED: no
--- BEGIN CONTENT ---
/**
 * Admin User Management API
 * 
 * Endpoints for managing admin users, roles, and permissions
 * All endpoints require authentication
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin, requireRole } = require('../../middleware/authMiddleware');
const adminUserService = require('../../services/adminUserService');

// ============================================================================
// CURRENT USER INFO
// ============================================================================

/**
 * Get current user's profile and permissions
 * GET /api/admin/me
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await adminUserService.getAdminUser(req.user.uid);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found in admin system',
        message: 'Your account is authenticated but not registered as an admin user. Contact system administrator.'
      });
    }

    // Record login
    await adminUserService.recordLogin(req.user.uid);

    res.json({
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        permissions: user.permissions,
        lastLoginAt: user.lastLoginAt,
        enabled: user.enabled
      }
    });

  } catch (error) {
    console.error('[Admin] Error fetching user profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile'
    });
  }
});

// ============================================================================
// USER MANAGEMENT (Super-admin only)
// ============================================================================

/**
 * List all admin users
 * GET /api/admin/users
 */
router.get('/users', requireAuth, requireRole('super-admin'), async (req, res) => {
  try {
    const { role, enabled } = req.query;

    const filters = {};
    if (role) filters.role = role;
    if (enabled !== undefined) filters.enabled = enabled === 'true';

    const users = await adminUserService.listAdminUsers(filters);

    res.json({
      success: true,
      users,
      total: users.length
    });

  } catch (error) {
    console.error('[Admin] Error listing users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

/**
 * Get specific admin user
 * GET /api/admin/users/:uid
 */
router.get('/users/:uid', requireAuth, requireRole('super-admin'), async (req, res) => {
  try {
    const { uid } = req.params;
    const user = await adminUserService.getAdminUser(uid);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });

  } catch (error) {
    console.error('[Admin] Error fetching user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user'
    });
  }
});

/**
 * Create admin user
 * POST /api/admin/users
 */
router.post('/users', requireAuth, requireRole('super-admin'), async (req, res) => {
  try {
    const { email, password, displayName, role, permissions, metadata } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Create Firebase Auth user first
    const admin = require('firebase-admin');
    const userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: false,
      displayName: displayName || email.split('@')[0]
    });

    // Create admin user record in Firestore
    const user = await adminUserService.createAdminUser(userRecord.uid, {
      email,
      displayName,
      role: role || 'viewer',
      permissions,
      metadata: {
        ...metadata,
        createdBy: req.user.uid,
        createdByEmail: req.user.email
      }
    });

    res.status(201).json({
      success: true,
      user,
      message: `Admin user created: ${email}`
    });

  } catch (error) {
    console.error('[Admin] Error creating user:', error);

    if (error.code === 'auth/email-already-exists') {
      return res.status(409).json({
        success: false,
        error: 'Email already exists'
      });
    }

    res.status(400).json({
      success: false,
      error: error.message || 'Failed to create user'
    });
  }
});

/**
 * Update admin user
 * PUT /api/admin/users/:uid
 */
router.put('/users/:uid', requireAuth, requireRole('super-admin'), async (req, res) => {
  try {
    const { uid } = req.params;
    const updates = req.body;

    // Prevent users from modifying their own role (security)
    if (uid === req.user.uid && updates.role) {
      return res.status(403).json({
        success: false,
        error: 'Cannot modify your own role'
      });
    }

    const user = await adminUserService.updateAdminUser(uid, updates);

    res.json({
      success: true,
      user,
      message: 'User updated successfully'
    });

  } catch (error) {
    console.error('[Admin] Error updating user:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to update user'
    });
  }
});

/**
 * Delete admin user (soft delete)
 * DELETE /api/admin/users/:uid
 */
router.delete('/users/:uid', requireAuth, requireRole('super-admin'), async (req, res) => {
  try {
    const { uid } = req.params;

    // Prevent users from deleting themselves
    if (uid === req.user.uid) {
      return res.status(403).json({
        success: false,
        error: 'Cannot delete your own account'
      });
    }

    await adminUserService.deleteAdminUser(uid);

    res.json({
      success: true,
      message: 'User disabled successfully'
    });

  } catch (error) {
    console.error('[Admin] Error deleting user:', error);
    res.status(400).json({
      success: false,
      error: 'Failed to delete user'
    });
  }
});

// ============================================================================
// ROLE & PERMISSION INFO
// ============================================================================

/**
 * Get available roles and their permissions
 * GET /api/admin/roles
 */
router.get('/roles', requireAuth, (req, res) => {
  res.json({
    success: true,
    roles: adminUserService.ROLE_PERMISSIONS
  });
});

module.exports = router;

--- END CONTENT ---
