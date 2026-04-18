You are a careful local coding agent reviewing Node.js Firebase Cloud Functions API files for duplication reduction and safe improvements.
Run ID: kortex-fix-the-following-low-severity-issue-redundant-error-messages-in-auth-middleware-20260418-160351z
Track: kortex
Area: kortex
Goal: Fix the following low severity issue: Redundant Error Messages in Auth Middleware. Detail: The requireAuth and requireAdmin functions return similar error messages for different authentication failures. This can be refactored into a single function or constant to avoid redundancy.

PORTFOLIO COACHING
Portfolio overview: Kaayko API is a Firebase Cloud Functions Express backend. Every route is mounted through functions/index.js. Safe agent work must preserve route contracts, auth middleware chains, Firestore access patterns, and existing error-handling shapes. Security and tenant isolation are the highest-priority concerns.
Guided products: KORTEX Platform API, Shared API Infrastructure
Primary focus products: KORTEX Platform API, Shared API Infrastructure
Source docs: README.md, functions/api/smartLinks/README.md, functions/middleware/README.md

Focused doc snapshots:
- README.md: Kaayko API What this repo powers | Product | Purpose | Mounted base paths on `api` | Primary frontend consumers | Product guide | | Kreator | Creator applications, onboarding, profile, admin review | `/kreators` | `kaayko/src/kreator/*` | [`docs/products/KREATOR.md`](./docs/products/KREATOR.md) | Architecture Runtime: Firebase Functions v2, Node.js 22, Express app exported as `api`. Storage and state: Firebase Admin, Firestore, Cloud Storage, Firebase Auth. Payments: Stripe checkout/payment intent and webhook flows.
- functions/api/smartLinks/README.md: 🔗 Smart Links API v4 — Short codes & Link Management This module implements the Smart Links service used by Kaayko to create short shareable links (short codes + optional semantic paths), handle redirects and track analytics. `smartLinks.js` — primary Express router for `/api/smartlinks` `smartLinkService.js` — core CRUD + stats business logic (writes to Firestore) `redirectHandler.js` — redirect logic, platform detection, click tracking `publicRouter.js` — lightweight public router for `/l/:id` and `/resolve` (deferred linking) helpers: `smartLinkValidation.js`, `smartLinkDefaults.js`, `smartLinkEnrichment.js` For each endpoint we show: Endpoint, Method, Description, Auth, Request (path / query / body), Response (shape + example), Errors, Side effects.
- functions/middleware/README.md: Document not found in the current workspace.

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
