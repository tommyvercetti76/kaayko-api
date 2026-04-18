You are a thorough API code auditor performing a deep analysis of Node.js Firebase Cloud Functions files.
Run ID: weather-audit-auth-and-access-control-gaps-20260418-160440z
Track: weather
Area: weather
Goal: Audit auth and access control gaps

PORTFOLIO COACHING
Portfolio overview: Kaayko API is a Firebase Cloud Functions Express backend. Every route is mounted through functions/index.js. Safe agent work must preserve route contracts, auth middleware chains, Firestore access patterns, and existing error-handling shapes. Security and tenant isolation are the highest-priority concerns.
Guided products: Weather & Forecast API, Shared API Infrastructure
Primary focus products: Weather & Forecast API
Source docs: README.md, functions/api/weather/README.md, functions/middleware/README.md

Focused doc snapshots:
- README.md: Kaayko API What this repo powers | Product | Purpose | Mounted base paths on `api` | Primary frontend consumers | Product guide | | Kreator | Creator applications, onboarding, profile, admin review | `/kreators` | `kaayko/src/kreator/*` | [`docs/products/KREATOR.md`](./docs/products/KREATOR.md) | Architecture Runtime: Firebase Functions v2, Node.js 22, Express app exported as `api`. Storage and state: Firebase Admin, Firestore, Cloud Storage, Firebase Auth. Payments: Stripe checkout/payment intent and webhook flows.
- functions/api/weather/README.md: 🌦️ Weather APIs *Complete weather and paddle condition intelligence powered by ML** 📁 Files in this Module *Main API Endpoints:** _Mount status — All weather routers are mounted in `functions/index.js` and are reachable at runtime. The module mounts are:_ `/paddlingOut` → `paddlingout.js` (listed and mounted) `/paddleScore` → `paddleScore.js` (ML-powered paddle score) `/fastForecast` → `fastForecast.js` (public, cached forecasts)

Product: Weather & Forecast API (Primary focus)
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

FILE: api:functions/api/weather/dataStandardization.js
LINES: 208
CHARS: 6478
TRUNCATED: no
--- BEGIN CONTENT ---
// File: functions/src/utils/dataStandardization.js
//
// 🔧 DATA STANDARDIZATION UTILITY
//
// Ensures consistent units and data formats across all APIs for ML model input
// and penalty calculations. This prevents rating mismatches between paddleScore
// and fastForecast APIs.

/**
 * Standard unit conversion constants
 */
const CONVERSIONS = {
  KPH_TO_MPH: 0.621371,
  MPH_TO_KPH: 1.60934,
  CELSIUS_TO_FAHRENHEIT: (c) => (c * 9/5) + 32,
  FAHRENHEIT_TO_CELSIUS: (f) => (f - 32) * 5/9,
  METERS_TO_FEET: 3.28084,
  FEET_TO_METERS: 0.3048
};

/**
 * Standard defaults for missing data
 */
const DEFAULTS = {
  TEMPERATURE_C: 20,
  WIND_SPEED_MPH: 0,
  UV_INDEX: 0,
  VISIBILITY_KM: 10,
  HUMIDITY_PERCENT: 50,
  CLOUD_COVER_PERCENT: 0,
  WAVE_HEIGHT_M: 0.1,
  WATER_TEMP_OFFSET_C: -8, // Estimate water temp as air temp minus 8°C
  MIN_WATER_TEMP_C: 2,
  GUST_MULTIPLIER: 1.3,
  WIND_WAVE_FACTOR_MPH: 0.02, // For estimating wave height from wind
  WIND_WAVE_THRESHOLD_MPH: 10,
  WIND_WAVE_FACTOR_KPH: 0.04, // For estimating wave height from wind in KPH
  WIND_WAVE_THRESHOLD_KPH: 15
};

/**
 * Calculate Beaufort scale from wind speed in MPH
 * @param {number} windSpeedMph - Wind speed in MPH
 * @returns {number} Beaufort scale (0-12)
 */
function calculateBeaufortFromMph(windSpeedMph) {
  if (windSpeedMph < 1) return 0;
  if (windSpeedMph < 4) return 1;
  if (windSpeedMph < 7) return 2;
  if (windSpeedMph < 11) return 3;
  if (windSpeedMph < 16) return 4;
  if (windSpeedMph < 22) return 5;
  if (windSpeedMph < 28) return 6;
  if (windSpeedMph < 34) return 7;
  if (windSpeedMph < 41) return 8;
  if (windSpeedMph < 48) return 9;
  if (windSpeedMph < 56) return 10;
  if (windSpeedMph < 64) return 11;
  return 12;
}

/**
 * Calculate Beaufort scale from wind speed in KPH
 * @param {number} windSpeedKph - Wind speed in KPH
 * @returns {number} Beaufort scale (0-12)
 */
function calculateBeaufortFromKph(windSpeedKph) {
  if (windSpeedKph < 2) return 0;
  if (windSpeedKph < 6) return 1;
  if (windSpeedKph < 12) return 2;
  if (windSpeedKph < 20) return 3;
  if (windSpeedKph < 29) return 4;
  if (windSpeedKph < 39) return 5;
  if (windSpeedKph < 50) return 6;
  if (windSpeedKph < 62) return 7;
  if (windSpeedKph < 75) return 8;
  if (windSpeedKph < 89) return 9;
  if (windSpeedKph < 103) return 10;
  if (windSpeedKph < 118) return 11;
  return 12;
}

/**
 * Standardize weather data for ML model input
 * All outputs are in standard units expected by ML model and penalty system
 * 
 * @param {object} rawData - Raw weather data from various sources
 * @param {object} marineData - Optional marine data
 * @returns {object} Standardized features for ML model
 */
function standardizeForMLModel(rawData, marineData = null) {
  const {
    // Temperature (accept both C and F)
    temperature,
    temperatureC, 
    tempC,
    temperatureF,
    tempF,
    
    // Wind (accept both MPH and KPH)
    windSpeed,
    windSpeedMph,
    windSpeedKph,
    windKPH,
    gustSpeed,
    gustSpeedMph,
    gustSpeedKph,
    
    // Other weather parameters
    windDirection,
    windDir,
    humidity,
    cloudCover,
    uvIndex,
    visibility,
    hasWarnings,
    
    // Location
    latitude,
    longitude
  } = rawData;

  // Standardize temperature to Celsius (ML model expects Celsius)
  let standardTemp = DEFAULTS.TEMPERATURE_C;
  if (temperature !== undefined) standardTemp = temperature;
  else if (temperatureC !== undefined) standardTemp = temperatureC;
  else if (tempC !== undefined) standardTemp = tempC;
  else if (temperatureF !== undefined) standardTemp = CONVERSIONS.FAHRENHEIT_TO_CELSIUS(temperatureF);
  else if (tempF !== undefined) standardTemp = CONVERSIONS.FAHRENHEIT_TO_CELSIUS(tempF);

  // Standardize wind speed to MPH (ML model expects MPH)
  let standardWindMph = DEFAULTS.WIND_SPEED_MPH;
  if (windSpeedMph !== undefined) standardWindMph = windSpeedMph;
  else if (windSpeed !== undefined) {
    // Assume windSpeed is in MPH if no unit specified
    standardWindMph = windSpeed;
  } else if (windSpeedKph !== undefined) {
    standardWindMph = windSpeedKph * CONVERSIONS.KPH_TO_MPH;
  } else if (windKPH !== undefined) {
    standardWindMph = windKPH * CONVERSIONS.KPH_TO_MPH;
  }

  // Standardize gust speed to MPH
  let standardGustMph = standardWindMph * DEFAULTS.GUST_MULTIPLIER;
  if (gustSpeedMph !== undefined) standardGustMph = gustSpeedMph;
  else if (gustSpeed !== undefined) {
    // Assume gustSpeed is in MPH if no unit specified
    standardGustMph = gustSpeed;
  } else if (gustSpeedKph !== undefined) {
    standardGustMph = gustSpeedKph * CONVERSIONS.KPH_TO_MPH;
  }

  // Marine data integration
  const marineHour = marineData?.forecast?.forecastday?.[0]?.hour?.[0];
  
  return {
    // Core weather parameters (standardized units)
    temperature: standardTemp, // °C
    windSpeed: standardWindMph, // MPH
    gustSpeed: standardGustMph, // MPH
    windDirection: windDirection || windDir || 0,
    
    // Derived parameters
    beaufortScale: calculateBeaufortFromMph(standardWindMph),
    
    // Environmental conditions
    humidity: humidity || DEFAULTS.HUMIDITY_PERCENT,
    cloudCover: cloudCover || DEFAULTS.CLOUD_COVER_PERCENT,
    uvIndex: uvIndex || DEFAULTS.UV_INDEX,
    visibility: visibility || DEFAULTS.VISIBILITY_KM,
    hasWarnings: hasWarnings || false,
    
    // Marine conditions (standardized)
    waveHeight: marineHour?.sig_ht_mt || 
                (standardWindMph > DEFAULTS.WIND_WAVE_THRESHOLD_MPH ? 
                 standardWindMph * DEFAULTS.WIND_WAVE_FACTOR_MPH : 
                 DEFAULTS.WAVE_HEIGHT_M),
    waterTemp: marineHour?.water_temp_c || 
               Math.max(DEFAULTS.MIN_WATER_TEMP_C, standardTemp + DEFAULTS.WATER_TEMP_OFFSET_C),
    
    // Location
    latitude: latitude || 0,
    longitude: longitude || 0
  };
}

/**
 * Standardize data for penalty calculations
 * Ensures consistent penalty application across all APIs
 * 
 * @param {object} rawData - Raw weather data
 * @param {object} marineData - Optional marine data
 * @returns {object} Standardized features for penalty system
 */
function standardizeForPenalties(rawData, marineData = null) {
  // Penalty system expects specific units - use same standardization as ML model
  return standardizeForMLModel(rawData, marineData);
}

module.exports = {
  CONVERSIONS,
  DEFAULTS,
  calculateBeaufortFromMph,
  calculateBeaufortFromKph,
  standardizeForMLModel,
  standardizeForPenalties
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

FILE: api:functions/api/weather/mlService.js
LINES: 169
CHARS: 5257
TRUNCATED: no
--- BEGIN CONTENT ---
// File: functions/api/weather/mlService.js
//
// ML Service — calls Cloud Run GradientBoosting model for paddle score predictions.
// Uses native Node https (no axios dependency).
// Falls back to rule-based rating if Cloud Run is unavailable.

const https = require('https');

// URL must be set in Firebase Functions environment: ML_SERVICE_URL
// Never falls back to a hardcoded URL — fail loudly so misconfiguration is caught early.
function getMLServiceURL() {
  const url = process.env.ML_SERVICE_URL;
  if (!url) {
    throw new Error('ML_SERVICE_URL environment variable is not set');
  }
  return url;
}

/**
 * POST JSON to a URL using native https. Returns parsed response body.
 * Enforces a strict timeout and validates the response status.
 */
function httpsPost(url, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`ML service HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('ML service returned non-JSON response'));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`ML service request timed out after ${timeoutMs}ms`));
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Get ML prediction from Cloud Run service.
 * Always returns { success, rating, mlModelUsed, predictionSource, modelType, confidence }.
 * On any failure, returns rule-based fallback with success: true so callers don't need
 * to handle two code paths.
 */
async function getPrediction(features) {
  console.log(`ML request — temp: ${features.temperature}°C, wind: ${features.windSpeed}mph`);

  try {
    const mlUrl = getMLServiceURL();
    const result = await httpsPost(`${mlUrl}/predict`, features, 10000);

    console.log(`ML prediction — rating: ${result.rating}, source: ${result.predictionSource}`);

    return {
      success: true,
      rating: result.rating,
      mlModelUsed: result.mlModelUsed,
      predictionSource: result.predictionSource || 'ml-model',
      modelType: result.modelType || 'GradientBoostingRegressor',
      confidence: result.confidence || 0.99,
      featuresUsed: result.featuresUsed
    };

  } catch (error) {
    console.error('Cloud Run ML prediction failed:', error.message);
    console.log('Falling back to rule-based rating');

    const fallbackRating = calculateFallbackRating(features);
    return {
      success: true,
      rating: fallbackRating,
      mlModelUsed: false,
      predictionSource: 'fallback-rules',
      modelType: 'rule-based',
      confidence: 0.7
    };
  }
}

/**
 * Rule-based fallback when ML service is unavailable.
 * Operates on standardized MPH wind and Celsius temperature.
 */
function calculateFallbackRating(features) {
  let rating = 3.0;

  // Wind (major impact — features.windSpeed is in MPH)
  if (features.windSpeed < 5)       rating += 0.8;
  else if (features.windSpeed < 10) rating += 0.4;
  else if (features.windSpeed > 20) rating -= 1.2;
  else if (features.windSpeed > 15) rating -= 0.6;

  // Temperature (features.temperature is in Celsius)
  const tempC = features.temperature;
  if (tempC >= 18 && tempC <= 30)      rating += 0.3; // ~65-86°F
  else if (tempC < 10 || tempC > 35)   rating -= 0.4; // Too cold or too hot

  // Conditions
  if (features.hasWarnings)  rating -= 0.8;
  if (features.uvIndex > 8)  rating -= 0.2;
  if (features.visibility < 5) rating -= 0.3;

  return Math.round(Math.max(1.0, Math.min(5.0, rating)) * 2) / 2;
}

/**
 * Extract a minimal feature set from raw weather data.
 * Used by legacy callers — prefer standardizeForMLModel() for new code.
 */
function extractMLFeatures(weatherData) {
  return {
    temperature: weatherData.temperature || 20,
    windSpeed: weatherData.windSpeed || 5,
    hasWarnings: weatherData.hasWarnings || false,
    beaufortScale: Math.min(Math.floor((weatherData.windSpeed || 5) / 3.0), 12),
    uvIndex: weatherData.uvIndex || 5,
    visibility: weatherData.visibility || 10,
    humidity: weatherData.humidity || 50,
    cloudCover: weatherData.cloudCover || 50,
    latitude: weatherData.latitude || 30.0,
    longitude: weatherData.longitude || -97.0
  };
}

function interpretRating(rating) {
  if (rating >= 4.0) return 'Excellent';
  if (rating >= 3.0) return 'Good';
  if (rating >= 2.0) return 'Fair';
  return 'Poor';
}

function applyPersonalizedAdjustments(prediction, userPrefs = {}) {
  return prediction;
}

module.exports = {
  extractMLFeatures,
  getPrediction,
  interpretRating,
  applyPersonalizedAdjustments
};

--- END CONTENT ---

FILE: api:functions/api/weather/modelCalibration.js
LINES: 286
CHARS: 9750
TRUNCATED: yes (showing 7058 of 9750 chars)
--- BEGIN CONTENT ---
// File: functions/src/utils/modelCalibration.js
//
// 🎯 MODEL CALIBRATION UTILITY
//
// Applies real-world adjustments to ML model predictions based on:
// 1. Current weather conditions analysis
// 2. Forecast trend analysis  
// 3. Location-specific factors
// 4. Seasonal adjustments

/**
 * Calibrate ML model prediction with real-world adjustments
 * @param {number} baseRating - Original ML model rating (1-5)
 * @param {object} currentConditions - Current weather data
 * @param {object} forecastData - Weather forecast data
 * @param {object} locationData - Location information (lat, lng)
 * @returns {object} Calibrated prediction with adjustments
 */
function calibrateModelPrediction(baseRating, currentConditions, forecastData, locationData) {
  console.log('🎯 Starting model calibration for base rating:', baseRating);

  // If conditions are already severe, positive adjustments are misleading.
  // Suppress all positive calibration when: heavy rain OR high wind OR poor visibility.
  const precipMm     = currentConditions.precipMm || currentConditions.precipMM || 0;
  const rainChancePct = currentConditions.precipChancePercent || currentConditions.precipChance || 0;
  const windSpeedMph = currentConditions.windSpeed || 0;
  const visKm        = currentConditions.visibility ?? 10;
  const suppressPositive = precipMm >= 2 || rainChancePct >= 60 || windSpeedMph >= 20 || visKm < 5;

  let adjustedRating = baseRating;
  const adjustments = [];
  
  // Helper: apply adjustment, but skip positive ones when conditions are severe
  const applyAdj = (adj) => {
    if (!adj || adj.adjustment === 0) return;
    if (suppressPositive && adj.adjustment > 0) return; // never boost in rain/storm
    adjustedRating += adj.adjustment;
    adjustments.push(adj);
  };

  applyAdj(calibrateWaterTemperature(currentConditions, locationData));  // 1. Water temp
  applyAdj(analyzeForecastTrends(forecastData, currentConditions));       // 2. Forecast trend
  applyAdj(applySeasonalCalibration(currentConditions, locationData));    // 3. Seasonal
  applyAdj(applyLocationCalibration(currentConditions, locationData));    // 4. Location
  applyAdj(analyzeWindPatterns(currentConditions, forecastData));         // 5. Wind pattern
  
  // Ensure rating stays within bounds
  adjustedRating = Math.max(1.0, Math.min(5.0, adjustedRating));
  
  // Round to nearest 0.5 for consistent UI increments (1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0)
  adjustedRating = Math.round(adjustedRating * 2) / 2;
  
  const totalAdjustment = adjustedRating - baseRating;
  
  console.log('📈 Model calibration complete:', {
    baseRating,
    adjustedRating,
    totalAdjustment: totalAdjustment.toFixed(2),
    adjustmentsApplied: adjustments.length
  });
  
  return {
    originalRating: baseRating,
    calibratedRating: adjustedRating,
    totalAdjustment: totalAdjustment,
    adjustments: adjustments,
    calibrationApplied: true
  };
}

/**
 * Calibrate water temperature estimation
 */
function calibrateWaterTemperature(conditions, location) {
  const airTemp = conditions.temperature || 15;
  const latitude = Math.abs(location.latitude || 40);
  
  // Default water temp estimation is often too conservative (-8°C)
  // Apply more realistic water temp based on season and location
  
  const month = new Date().getMonth() + 1; // 1-12
  const isSummer = month >= 5 && month <= 9;
  const isWinter = month >= 11 || month <= 2;
  
  let waterTempOffset = -8; // Default conservative estimate
  let adjustment = 0;
  let reason = '';
  
  // Less conservative water temp estimates
  if (isSummer && airTemp > 15) {
    waterTempOffset = -4; // Summer water retains more heat
    adjustment = +0.3;
    reason = 'Summer water temperature adjustment (+0.3)';
  } else if (airTemp > 20) {
    waterTempOffset = -5; // Warm air = warmer water
    adjustment = +0.2;
    reason = 'Warm air temperature adjustment (+0.2)';
  } else if (latitude < 35 && airTemp > 10) {
    // Warmer climates have less air-water temp difference
    adjustment = +0.2;
    reason = 'Warm climate adjustment (+0.2)';
  }
  
  return {
    type: 'water_temperature',
    adjustment: adjustment,
    reason: reason,
    estimatedWaterTemp: airTemp + waterTempOffset
  };
}

/**
 * Analyze forecast trends for stability
 */
function analyzeForecastTrends(forecastData, currentConditions) {
  if (!forecastData?.forecast?.forecastday || forecastData.forecast.forecastday.length === 0) {
    return { adjustment: 0, reason: 'No forecast data available' };
  }
  
  const today = forecastData.forecast.forecastday[0];
  const hourlyData = today.hourly || [];
  
  if (hourlyData.length < 6) {
    return { adjustment: 0, reason: 'Insufficient forecast data' };
  }
  
  // Analyze next 6 hours for stability
  const next6Hours = hourlyData.slice(0, 6);
  const currentHour = new Date().getHours();
  const relevantHours = next6Hours.filter(hour => {
    const hourTime = parseInt(hour.time.split(' ')[1].split(':')[0]);
    return hourTime >= currentHour;
  });
  
  if (relevantHours.length < 3) {
    return { adjustment: 0, reason: 'Not enough relevant forecast hours' };
  }
  
  // Check for improving conditions
  const windSpeeds = relevantHours.map(h => h.windKPH || 0);
  const temps = relevantHours.map(h => h.tempC || 15);
  
  const windSpeeds0 = windSpeeds[0] || 0;
  const windSpeedsLast = windSpeeds[windSpeeds.length - 1] || 0;
  const windImproving = windSpeeds.every((speed, i) => i === 0 || speed <= windSpeeds[i-1] + 2);
  const windDeteriorating = windSpeedsLast > windSpeeds0 + 5; // increasing by >5kph over next hours
  const tempImproving = temps.some((temp, i) => i > 0 && temp > temps[i-1]);
  const stableConditions = windSpeeds.every(speed => speed < 15);

  let adjustment = 0;
  let reason = '';

  if (windDeteriorating) {
    adjustment = -0.2;
    reason = 'Wind increasing in forecast (-0.2)';
  } else if (windImproving && stableConditions) {
    adjustment = +0.2;
    reason = 'Improving wind conditions in forecast (+0.2)';
  } else if (tempImproving && stableConditions) {
    adjustment = +0.1;
    reason = 'Warming trend with stable conditions (+0.1)';
  } else if (stableConditions) {
    adjustment = +0.1;
    reason = 'Stable forecast conditions (+0.1)';
  }

  return {
    type: 'forecast_trend',
    adjustment: adjustment,
    reason: reason
  };
}

/**
 * Apply seasonal calibration adjustments
 */
function applySeasonalCalibration(conditions, location) {
  const month = new Date().getMonth() + 1; // 1-12
  const latitude = Math.abs(location.latitude || 40);
  const airTemp = conditions.temperature || 15;
  
  let adjustment = 0;
  let reason = '';
  
  // Spring/Fall in temperate zones often better than model predicts
  const isSpringFall = (month >= 3 && month <= 5) || (month >= 9 && month <= 11);
  const isTemperateZone = latitude >= 30 && latitude <= 60;
  
  if (isSpringFall && isTemperateZone && airTemp >= 10 && airTemp <= 25) {
    adjustment = +0.2;
    rea
/* [truncated — 9750 chars total, showing first 7000] */

--- END CONTENT ---

FILE: api:functions/api/weather/nearbyWater.js
LINES: 145
CHARS: 5204
TRUNCATED: no
--- BEGIN CONTENT ---
// functions/api/weather/nearbyWater.js
//
// GET /nearbyWater?lat=&lng=&radius=30
//
// Data sources (no Overpass):
//   • HydroLAKES  — 3,021 named lakes worldwide, bundled JSON, <1ms lookup
//   • USGS NHD    — US-only REST API, comprehensive regional lake/reservoir data, ~2s
//
// Caching: Firestore `water_body_index` collection, 7-day TTL.
// Repeat queries for the same 0.5° grid cell: ~50ms (Firestore read).

const express  = require('express');
const { logger } = require('firebase-functions');
const { getFirestore } = require('firebase-admin/firestore');
const { findNearby, distMiles } = require('../../data/lakeIndex');

const router = express.Router();

// ── Firestore geo-grid cache ───────────────────────────────────────────────
const COLLECTION   = 'water_body_index';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let _db;
function db() {
  if (!_db) _db = getFirestore();
  return _db;
}

// 0.5° grid ≈ 55km cells
function gridKey(lat, lng) {
  const gLat = Math.round(lat * 2) / 2;
  const gLng = Math.round(lng * 2) / 2;
  // Replace minus signs so Firestore accepts it as doc ID
  return `${gLat}_${gLng}`.replace(/-/g, 'N');
}

async function cacheGet(key) {
  try {
    const doc = await db().collection(COLLECTION).doc(key).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (!data.expiresAt || data.expiresAt.toDate() <= new Date()) return null;
    return data.waterBodies || null;
  } catch (e) {
    logger.warn(`Cache read failed ${key}:`, e.message);
    return null;
  }
}

async function cacheSet(key, waterBodies) {
  try {
    await db().collection(COLLECTION).doc(key).set({
      waterBodies,
      expiresAt:  new Date(Date.now() + CACHE_TTL_MS),
      updatedAt:  new Date(),
      count:      waterBodies.length
    });
    logger.info(`💾 Cached ${waterBodies.length} bodies for ${key}`);
  } catch (e) {
    logger.warn(`Cache write failed ${key}:`, e.message);
  }
}

// ── Main endpoint ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const lat    = parseFloat(req.query.lat || req.query.latitude);
    const lng    = parseFloat(req.query.lng || req.query.longitude);
    const radius = Math.min(parseInt(req.query.radius || 30), 60); // cap 60km
    const radiusMiles = radius * 0.621;

    if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ success: false, error: 'Invalid coordinates' });
    }

    const key          = gridKey(lat, lng);
    const forceRefresh = req.query.refresh === '1';

    // ── 1. Firestore cache ─────────────────────────────────────────────────
    if (!forceRefresh) {
      const cached = await cacheGet(key);
      if (cached) {
        logger.info(`✅ Cache HIT ${key} (${cached.length} bodies)`);

        // Re-compute distances from actual search point, re-sort, slice
        const results = cached
          .map(b => ({ ...b, distanceMiles: Math.round(distMiles(lat, lng, b.lat, b.lng) * 10) / 10 }))
          .filter(b => b.distanceMiles <= radiusMiles)
          .sort((a, b) => b.relevancy - a.relevancy || a.distanceMiles - b.distanceMiles)
          .slice(0, 20);

        return res.json({
          success: true,
          waterBodies: results,
          cached: true,
          source: 'firestore',
          location: { lat, lng, radiusKm: radius },
          timestamp: new Date().toISOString()
        });
      }
    }

    // ── 2. Live lookup: HydroLAKES + USGS NHD + OSM fallback ─────────────
    const query = (req.query.q || '').toString().trim().slice(0, 200); // original search text
    logger.info(`🔎 Live lookup for ${lat.toFixed(3)},${lng.toFixed(3)} radius ${radiusMiles.toFixed(1)}mi q="${query}"`);

    // Use a slightly wider radius for the cache so adjacent grid lookups still hit
    const fetchMiles = Math.max(radiusMiles, 35);
    const bodies     = await findNearby(lat, lng, fetchMiles, query);

    // ── 3. Persist to Firestore ────────────────────────────────────────────
    if (bodies.length > 0) {
      cacheSet(key, bodies); // fire-and-forget
    }

    // ── 4. Return filtered results ─────────────────────────────────────────
    const results = bodies
      .map(b => ({ ...b, distanceMiles: Math.round(distMiles(lat, lng, b.lat, b.lng) * 10) / 10 }))
      .filter(b => b.distanceMiles <= radiusMiles)
      .sort((a, b) => b.relevancy - a.relevancy || a.distanceMiles - b.distanceMiles)
      .slice(0, 20);

    if (results.length > 0) {
      logger.info(`✅ Returning ${results.length} bodies. Top: ${results[0].name} (${results[0].distanceMiles}mi, ${results[0].source})`);
    } else {
      logger.warn(`⚠️ No water bodies found near ${lat.toFixed(3)},${lng.toFixed(3)}`);
    }

    res.json({
      success: true,
      waterBodies: results,
      cached: false,
      source: 'live',
      location: { lat, lng, radiusKm: radius },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('nearbyWater error:', error);
    res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
  }
});

module.exports = router;

--- END CONTENT ---

FILE: api:functions/api/weather/paddleScore.js
LINES: 262
CHARS: 9385
TRUNCATED: yes (showing 7058 of 9385 chars)
--- BEGIN CONTENT ---
// functions/api/weather/paddleScore.js
//
// GET  /paddleScore          — live ML-powered paddle score for any location
// POST /paddleScore/feedback — record user's actual experience vs prediction
// GET  /paddleScore/metrics  — admin: model accuracy stats (requires x-admin-key)

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { createInputMiddleware } = require('./inputStandardization');
const { computePaddleScoreForSpot } = require('./paddleScoreCompute');
const PaddleScoreCache = require('../../cache/paddleScoreCache');
const { requireAdmin } = require('../../middleware/authMiddleware');

const db = getFirestore();

// ─── GET /paddleScore ──────────────────────────────────────────────────────

/**
 * GET /paddleScore?lat=&lng=  or  ?spotId=  or  ?location=
 *
 * Check paddle_score_cache first (populated by warmPaddleScoreCache every 15 min).
 * On cache miss, compute fresh — weather + marine fetched in parallel inside
 * computePaddleScoreForSpot. Writes result back to cache as a side effect.
 */
router.get('/', createInputMiddleware('paddleScore'), async (req, res) => {
  const startTime = Date.now();

  try {
    const { latitude, longitude, spotId } = req.standardizedInputs;

    let loc;
    let locationName;

    if (spotId) {
      const doc = await db.collection('paddlingSpots').doc(spotId).get();
      if (!doc.exists) {
        return res.status(404).json({
          success: false,
          error: 'Paddling spot not found',
          spotId,
          available_via: '/paddlingOut'
        });
      }
      const data = doc.data();
      if (!data.location?.latitude || !data.location?.longitude) {
        return res.status(500).json({ success: false, error: 'Spot has no coordinates' });
      }
      loc = { id: spotId, lat: data.location.latitude, lng: data.location.longitude, name: data.lakeName || spotId };
      locationName = loc.name;
    } else {
      loc = { id: null, lat: latitude, lng: longitude, name: `${latitude},${longitude}` };
      locationName = loc.name;
    }

    console.log(`paddleScore request: ${locationName}`);

    // Check paddle_score_cache for known spots (spotId-keyed)
    if (spotId) {
      const cache = new PaddleScoreCache();
      const cached = await cache.get(spotId);
      if (cached) {
        console.log(`paddleScore: cache hit for ${spotId}`);
        return res.json({
          success: true,
          location: { name: locationName, coordinates: { latitude: loc.lat, longitude: loc.lng } },
          paddleScore: cached,
          warnings: cached.warnings,
          conditions: cached.conditions,
          metadata: {
            source: cached.predictionSource,
            cached: true,
            cachedAt: cached.computedAt,
            response_time_ms: Date.now() - startTime
          }
        });
      }
    }

    // Load dynamic calibration offset for this spot (if any)
    const calibrationOffsets = new Map();
    if (spotId) {
      try {
        const calDoc = await db.collection('paddle_spot_calibrations').doc(spotId).get();
        if (calDoc.exists && typeof calDoc.data().biasOffset === 'number') {
          calibrationOffsets.set(spotId, calDoc.data().biasOffset);
        }
      } catch { /* non-fatal */ }
    }

    // Compute fresh score (weather + marine in parallel inside compute module)
    const score = await computePaddleScoreForSpot(loc, { calibrationOffsets });

    if (!score) {
      return res.status(500).json({
        success: false,
        error: 'Failed to compute paddle score — weather data unavailable',
        location: locationName
      });
    }

    // Write to cache as a side effect for future paddlingOut reads
    if (spotId) {
      const cache = new PaddleScoreCache();
      cache.set(spotId, score).catch(err =>
        console.warn(`paddleScore: failed to write cache for ${spotId}: ${err.message}`)
      );
    }

    return res.json({
      success: true,
      location: { name: locationName, coordinates: { latitude: loc.lat, longitude: loc.lng } },
      paddleScore: {
        rating: score.rating,
        interpretation: score.interpretation,
        confidence: score.confidence,
        mlModelUsed: score.mlModelUsed,
        predictionSource: score.predictionSource,
        originalMLRating: score.originalMLRating,
        calibrationApplied: score.calibrationApplied,
        adjustments: score.adjustments,
        penaltiesApplied: score.penaltiesApplied,
        dynamicOffset: score.dynamicOffset,
        isGoldStandard: true
      },
      warnings: score.warnings,
      conditions: score.conditions,
      metadata: {
        source: score.predictionSource,
        cached: false,
        computedAt: score.computedAt,
        response_time_ms: Date.now() - startTime
      }
    });

  } catch (error) {
    console.error('paddleScore GET / error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Server error',
      response_time_ms: Date.now() - startTime
    });
  }
});

// ─── POST /paddleScore/feedback ────────────────────────────────────────────

/**
 * POST /paddleScore/feedback
 * Body: { spotId, actualScore, predictedScore?, conditions?, userId? }
 *
 * Records a user's real experience rating so the daily aggregator can
 * compute per-spot bias and improve calibration over time.
 * No auth required — supports anonymous feedback.
 */
router.post('/feedback', async (req, res) => {
  try {
    const { spotId, actualScore, predictedScore, conditions, userId } = req.body;

    // Validate required fields
    if (!spotId || typeof spotId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(spotId)) {
      return res.status(400).json({ success: false, error: 'Invalid or missing spotId' });
    }
    if (typeof actualScore !== 'number' || actualScore < 1 || actualScore > 5) {
      return res.status(400).json({ success: false, error: 'actualScore must be a number between 1 and 5' });
    }
    if (predictedScore !== undefined && (typeof predictedScore !== 'number' || predictedScore < 1 || predictedScore > 5)) {
      return res.status(400).json({ success: false, error: 'predictedScore must be a number between 1 and 5' });
    }

    // Sanitize optional conditions object — only allow known numeric keys
    let safeConditions = {};
    if (conditions && typeof conditions === 'object' && !Array.isArray(conditions)) {
      const ALLOWED_CONDITION_KEYS = ['temperature', 'windSpeed', 'waterTemp', 'wasMarineDataAvailable'];
      for (const key of ALLOWED_CONDITION_KEYS) {
        if (key in conditions) {
          safeConditions[key] = key === 'wasMarineDataAvailable'
            ? Boolean(conditions[key])
            : Number(conditions[key]);
        }
      }
    }

    await db.collection('paddle_predictions_feedback').add({
      spotId,
      userId: typeof userId === 'string' ? userId : nul
/* [truncated — 9385 chars total, showing first 7000] */

--- END CONTENT ---

FILE: api:functions/api/weather/paddleScoreCompute.js
LINES: 173
CHARS: 7406
TRUNCATED: yes (showing 7058 of 7406 chars)
--- BEGIN CONTENT ---
// functions/api/weather/paddleScoreCompute.js
//
// Canonical paddle score computation pipeline.
// No Express router, no Firestore reads/writes — pure computation.
// Imported by paddleScoreWarmer.js (batch) and paddleScore.js (live requests).

const UnifiedWeatherService = require('./unifiedWeatherService');
const { getPrediction } = require('./mlService');
const { standardizeForMLModel } = require('./dataStandardization');
const { calibrateModelPrediction } = require('./modelCalibration');
const { applyEnhancedPenalties } = require('./paddlePenalties');
const { getSmartWarnings } = require('./smartWarnings');

/**
 * Compute a paddle score for a single location.
 *
 * @param {object} loc - { id: string, lat: number, lng: number, name: string }
 * @param {object} options
 * @param {Map<string,number>} [options.calibrationOffsets] - Per-spot bias offsets from feedback loop
 * @returns {Promise<object|null>} Score payload or null if weather unavailable
 */
async function computePaddleScoreForSpot(loc, options = {}) {
    const { calibrationOffsets = new Map() } = options;

    if (!loc.lat || !loc.lng) {
        console.warn(`computePaddleScoreForSpot: missing coordinates for ${loc.id}`);
        return null;
    }

    const locationQuery = `${loc.lat},${loc.lng}`;
    const weatherService = new UnifiedWeatherService();

    // Fetch weather and marine data in parallel — saves 200-400ms vs sequential
    const [weatherResult, marineResult] = await Promise.allSettled([
        weatherService.getWeatherData(locationQuery, { includeForecast: false, useCache: true }),
        weatherService.getMarineData(locationQuery)
    ]);

    const weatherData = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
    const marineData  = marineResult.status === 'fulfilled'  ? marineResult.value  : null;

    if (!weatherData?.current) {
        console.warn(`computePaddleScoreForSpot: no weather data for ${loc.id} (${locationQuery})`);
        return null;
    }

    const current = weatherData.current;
    const marineHour = marineData?.forecast?.forecastday?.[0]?.hour?.[0];

    // Standardize into ML input — pass ALL available real values
    const mlFeatures = standardizeForMLModel({
        temperature:   current.temperature?.celsius,
        windSpeed:     current.wind?.speedMPH  || current.windSpeed,
        gustSpeed:     current.wind?.gustMPH   || (current.wind?.speedMPH || 0) * 1.3,
        windDirection: current.wind?.direction || current.windDirection,
        humidity:      current.atmospheric?.humidity   || current.humidity,
        cloudCover:    current.atmospheric?.cloudCover || current.cloudCover,
        uvIndex:       current.solar?.uvIndex  || current.uvIndex,
        // Real visibility — never default to 10 when we have actual data
        visibility:    current.atmospheric?.visibility ?? current.visibility ?? 10,
        hasWarnings:   current.hasWarnings,
        // Precipitation — critical for accuracy in rain events
        precipMm:      current.precipitation?.amountMM ?? 0,
        precipChancePercent: current.precipitation?.chancePct ?? 0,
        latitude:  loc.lat,
        longitude: loc.lng
    }, marineData);

    // ML prediction (with built-in fallback to rule-based if Cloud Run is down)
    let prediction;
    try {
        prediction = await getPrediction(mlFeatures);
    } catch (err) {
        console.warn(`computePaddleScoreForSpot: ML prediction failed for ${loc.id}: ${err.message}`);
        return null;
    }

    if (!prediction?.success) {
        return null;
    }

    // Apply model calibration (trend, seasonal, location, wind pattern adjustments)
    const calibratedPrediction = calibrateModelPrediction(
        prediction.rating,
        {
            temperature: mlFeatures.temperature,
            windSpeed:   mlFeatures.windSpeed,
            gustSpeed:   mlFeatures.gustSpeed,
            humidity:    mlFeatures.humidity,
            cloudCover:  mlFeatures.cloudCover,
            uvIndex:     mlFeatures.uvIndex,
            visibility:  mlFeatures.visibility
        },
        weatherData.forecast,
        { latitude: loc.lat, longitude: loc.lng }
    );

    // Apply enhanced penalties (wind, temp, wave, precip, visibility, marine)
    // applyEnhancedPenalties expects { rating: number } as first arg
    const penaltyResult = applyEnhancedPenalties(
        { rating: calibratedPrediction.calibratedRating },
        mlFeatures,
        marineData
    );

    // Apply per-spot dynamic calibration offset from feedback loop (defaults to 0)
    const dynamicOffset = calibrationOffsets.get(loc.id) || 0;
    let finalRating = penaltyResult.rating + dynamicOffset;
    finalRating = Math.max(1.0, Math.min(5.0, finalRating));
    finalRating = Math.round(finalRating * 2) / 2;

    // Generate smart warnings
    const smartWarnings = getSmartWarnings(
        {
            temperature: mlFeatures.temperature,
            windSpeed:   mlFeatures.windSpeed,
            gustSpeed:   mlFeatures.gustSpeed,
            humidity:    mlFeatures.humidity,
            cloudCover:  mlFeatures.cloudCover,
            uvIndex:     mlFeatures.uvIndex,
            visibility:  mlFeatures.visibility,
            waterTemp:   marineHour?.water_temp_c || (mlFeatures.temperature - 8)
        },
        weatherData,
        { latitude: loc.lat, longitude: loc.lng }
    );

    return {
        rating: finalRating,
        interpretation: getInterpretation(finalRating),
        confidence: prediction.confidence || 'high',
        mlModelUsed: prediction.mlModelUsed,
        predictionSource: prediction.predictionSource,
        originalMLRating: calibratedPrediction.originalRating,
        calibrationApplied: calibratedPrediction.adjustments.length > 0,
        adjustments: calibratedPrediction.adjustments,
        penaltiesApplied: penaltyResult.penaltiesApplied || [],
        dynamicOffset,
        conditions: {
            temperature:   mlFeatures.temperature,                               // °C
            windSpeed:     current.wind?.speedKPH || (mlFeatures.windSpeed * 1.60934), // KPH for display
            windDirection: current.wind?.direction || mlFeatures.windDirection,
            gustSpeed:     current.wind?.gustKPH || (mlFeatures.gustSpeed * 1.60934),  // KPH
            humidity:      mlFeatures.humidity,
            cloudCover:    mlFeatures.cloudCover,
            uvIndex:       mlFeatures.uvIndex,
            visibility:    mlFeatures.visibility,                                // km
            waterTemp:     marineHour?.water_temp_c || Math.max(2, mlFeatures.temperature - 8), // °C
            precipMm:      mlFeatures.precipMm || 0,
            hasWarnings:   smartWarnings.length > 0
        },
        warnings: {
            hasWarnings: smartWarnings.length > 0,
            count: smartWarnings.length,
            messages: smartWarnings,
            warningType: smartWarnings.length > 0 ? 'weather' : null
        },
    
/* [truncated — 7406 chars total, showing first 7000] */

--- END CONTENT ---

FILE: api:functions/api/weather/paddlingout.js
LINES: 158
CHARS: 5070
TRUNCATED: no
--- BEGIN CONTENT ---
// functions/api/weather/paddlingout.js
//
// GET /paddlingOut       — all curated paddling spots with pre-warmed paddle scores
// GET /paddlingOut/:id   — single spot
//
// Paddle scores are NEVER computed inline here. They are pre-computed every 15 minutes
// by the warmPaddleScoreCache scheduled function and stored in paddle_score_cache.
// This endpoint reads that collection in a single Firestore read — lightning quick.

const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const PaddleScoreCache = require('../../cache/paddleScoreCache');

const db     = admin.firestore();
const bucket = admin.storage().bucket();

/**
 * Fetch image URLs for a spot from Firebase Storage.
 * Returns an empty array on any error — images are non-critical.
 */
async function fetchSpotImages(spotId) {
  const prefix = 'images/paddling_out/';
  try {
    const [files] = await bucket.getFiles({ prefix });
    const matching = files.filter(file => {
      const fileName = file.name.split('/').pop() || '';
      return fileName.toLowerCase().startsWith(spotId.toLowerCase());
    });
    return matching.map(file => {
      const encodedPath = encodeURIComponent(file.name);
      return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media`;
    });
  } catch (err) {
    console.error(`fetchSpotImages failed for ${spotId}:`, err.message);
    return [];
  }
}

/**
 * GET /paddlingOut
 *
 * Returns all curated paddling spots. Each spot includes pre-warmed paddle scores
 * from paddle_score_cache (written by the 15-min scheduled warmer). If the cache
 * has never been populated (e.g. first deploy), paddleScore will be null — the
 * warmer will fill it within 15 minutes.
 *
 * Total reads: 1 Firestore collection (paddlingSpots) + 1 Firestore collection
 * (paddle_score_cache) + N parallel Storage reads for images.
 * Typical response: 150–300ms.
 */
router.get('/', async (req, res) => {
  const startTime = Date.now();
  console.log('paddlingOut GET /');

  try {
    const [snapshot, allScores] = await Promise.all([
      db.collection('paddlingSpots').get(),
      new PaddleScoreCache().getAll()
    ]);

    if (snapshot.empty) {
      return res.json([]);
    }

    const spots = await Promise.all(
      snapshot.docs.map(async docSnap => {
        const data = docSnap.data();
        const spot = {
          id:           docSnap.id,
          lakeName:     data.lakeName     || '',
          title:        data.title        || '',
          subtitle:     data.subtitle     || '',
          text:         data.text         || '',
          youtubeURL:   data.youtubeURL   || '',
          location:     data.location     || {},
          parkingAvl:   data.parkingAvl   || 'N',
          restroomsAvl: data.restroomsAvl || 'N'
        };

        // Images and paddle score fetched concurrently
        const [imgSrc, paddleScore] = await Promise.all([
          fetchSpotImages(docSnap.id),
          Promise.resolve(allScores.get(docSnap.id) || null)
        ]);

        spot.imgSrc     = imgSrc;
        spot.paddleScore = paddleScore;

        return spot;
      })
    );

    const scored = spots.filter(s => s.paddleScore !== null).length;
    console.log(`paddlingOut: ${scored}/${spots.length} spots have cached scores — ${Date.now() - startTime}ms`);

    res.set('Cache-Control', 'public, max-age=60');
    return res.json(spots);

  } catch (err) {
    console.error('paddlingOut GET / error:', err.message);
    return res.status(500).json({
      error: 'Server error',
      details: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /paddlingOut/:id
 *
 * Returns a single paddling spot with its cached paddle score.
 */
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid spot ID' });
  }

  try {
    const [docSnap, allScores] = await Promise.all([
      db.collection('paddlingSpots').doc(id).get(),
      new PaddleScoreCache().getAll()
    ]);

    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Not found' });
    }

    const data = docSnap.data();
    const spot = {
      id:           docSnap.id,
      lakeName:     data.lakeName     || '',
      title:        data.title        || '',
      subtitle:     data.subtitle     || '',
      text:         data.text         || '',
      youtubeURL:   data.youtubeURL   || '',
      location:     data.location     || {},
      parkingAvl:   data.parkingAvl   || 'N',
      restroomsAvl: data.restroomsAvl || 'N'
    };

    const [imgSrc] = await Promise.all([fetchSpotImages(id)]);
    spot.imgSrc      = imgSrc;
    spot.paddleScore = allScores.get(id) || null;

    res.set('Cache-Control', 'public, max-age=60');
    return res.json(spot);

  } catch (err) {
    console.error(`paddlingOut GET /${id} error:`, err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

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

FILE: api:functions/api/weather/smartWarnings.js
LINES: 317
CHARS: 11907
TRUNCATED: yes (showing 7059 of 11907 chars)
--- BEGIN CONTENT ---
// File: functions/src/utils/smartWarnings.js
//
// 🚨 SMART WARNING SYSTEM
//
// Generates weather-appropriate safety warnings based on actual conditions
// No more fake "heat warnings" when it's cloudy and cool!

/**
 * Estimate water temperature based on air temperature and location factors
 * Much more accurate than simple air_temp - 8 formula
 * @param {number} airTemp - Air temperature in Celsius
 * @param {object} locationData - Location information (lat, lng, etc.)
 * @returns {number} Estimated water temperature in Celsius
 */
function estimateWaterTemperature(airTemp, locationData = {}) {
  const currentMonth = new Date().getMonth(); // 0-11
  const latitude = Math.abs(locationData.latitude || 40);
  
  // Base seasonal adjustment (water lags air temperature by ~6-8 weeks)
  // October (month 9) should be warm water from summer heat storage
  const seasonalOffset = Math.sin((currentMonth - 1) * Math.PI / 6) * 4; // Peaks in Sept, low in Mar
  
  // Latitude effect (warmer climates have smaller air-water temp differences)
  const latitudeEffect = Math.max(0, (50 - latitude) / 10); // More difference in northern latitudes
  
  // Body of water size effect (assume medium lake for default)
  const thermalMass = 1.2; // Lakes have more thermal mass than rivers
  
  // Calculate base water temperature
  let waterTemp;
  
  if (airTemp >= 25) {
    // Hot weather: water is cooler than air
    waterTemp = airTemp - (8 + latitudeEffect) + seasonalOffset;
  } else if (airTemp >= 15) {
    // Moderate weather: smaller difference
    waterTemp = airTemp - (5 + latitudeEffect * 0.7) + seasonalOffset;
  } else if (airTemp >= 5) {
    // Cool weather: water often warmer than air due to thermal mass
    waterTemp = airTemp - (2 + latitudeEffect * 0.5) + seasonalOffset + thermalMass;
  } else {
    // Cold weather: water has thermal lag, usually warmer than air
    waterTemp = airTemp + (2 + thermalMass) + seasonalOffset * 0.5;
  }
  
  // Realistic bounds (water rarely goes below 0°C or above 35°C in most paddling locations)
  waterTemp = Math.max(1, Math.min(35, waterTemp));
  
  console.log(`💧 Water temp estimation: Air ${airTemp}°C → Water ${waterTemp.toFixed(1)}°C (month: ${currentMonth}, lat: ${latitude})`);
  
  return waterTemp;
}

/**
 * Generate smart safety warnings based on actual weather conditions
 * @param {object} currentConditions - Current weather data
 * @param {object} forecastData - Forecast data for trend analysis
 * @param {object} locationData - Location information
 * @returns {Array<string>} Array of relevant safety warnings
 */
function generateSmartWarnings(currentConditions, forecastData, locationData) {
  const warnings = [];
  const temp = currentConditions.temperature || 20;
  const windSpeed = currentConditions.windSpeed || 0;
  const gustSpeed = currentConditions.gustSpeed || windSpeed * 1.3;
  const humidity = currentConditions.humidity || 50;
  const cloudCover = currentConditions.cloudCover || 0;
  const uvIndex = currentConditions.uvIndex || 0;
  const visibility = currentConditions.visibility || 10;
  // PRIORITY: Use real marine water temperature data first, then estimate
  let waterTemp = null;
  
  if (currentConditions.waterTemp && currentConditions.waterTemp > 0) {
    waterTemp = currentConditions.waterTemp;
    console.log(`🌊 Using provided waterTemp: ${waterTemp}°C`);
  } else if (currentConditions.water_temp && currentConditions.water_temp > 0) {
    waterTemp = currentConditions.water_temp;
    console.log(`🌊 Using marine water_temp: ${waterTemp}°C`);
  } else {
    waterTemp = estimateWaterTemperature(temp, locationData);
    console.log(`🧮 Using estimated water temp: ${waterTemp}°C for air temp ${temp}°C`);
  }
  
  console.log('🚨 Generating smart warnings for conditions:', {
    temp, windSpeed, cloudCover, uvIndex, waterTemp
  });

  // 1. TEMPERATURE-BASED WARNINGS (context-aware)
  if (temp >= 35) {
    warnings.push("Extreme heat - risk of heat exhaustion");
  } else if (temp >= 30 && cloudCover < 30 && uvIndex > 8) {
    warnings.push("High heat with intense sun exposure - stay hydrated");
  } else if (temp >= 28 && humidity > 80) {
    warnings.push("Hot and humid conditions - take frequent breaks");
  }
  
  if (temp <= -5) {
    warnings.push("Extreme cold - hypothermia risk");
  } else if (temp <= 0) {
    warnings.push("Freezing conditions - ice formation possible");
  } else if (temp <= 5) {
    warnings.push("Very cold air - dress warmly and limit exposure");
  }

  // 2. WATER TEMPERATURE WARNINGS (using real marine data when available)
  console.log(`🌡️ Water temp check: ${waterTemp}°C`);
  
  if (waterTemp <= 4) {
    warnings.push("Extremely cold water - hypothermia risk within minutes");
  } else if (waterTemp <= 10) {
    warnings.push("Very cold water - cold water shock and rapid heat loss risk");
  } else if (waterTemp <= 15) {
    warnings.push("Cold water - hypothermia possible with prolonged exposure");
  } else if (waterTemp <= 18) {
    warnings.push("Cool water - wear appropriate thermal protection");
  }
  // Water above 18°C (64°F) is generally safe for recreational paddling
  // Marine data often shows warmer temperatures than our old estimation

  // 3. WIND CONDITIONS (with context)
  if (windSpeed >= 25) {
    warnings.push("High winds - small craft advisory conditions");
  } else if (windSpeed >= 20) {
    warnings.push("Strong winds - challenging for inexperienced paddlers");
  } else if (gustSpeed >= 25 && gustSpeed > windSpeed * 1.5) {
    warnings.push("Gusty conditions - sudden wind changes expected");
  }

  // 4. VISIBILITY WARNINGS
  if (visibility <= 1) {
    warnings.push("Very poor visibility - navigation hazardous");
  } else if (visibility <= 3) {
    warnings.push("Reduced visibility - stay close to shore");
  }

  // 5. UV/SUN EXPOSURE (intelligent based on cloud cover)
  if (uvIndex >= 8 && cloudCover <= 20) {
    warnings.push("Very high UV - sunburn risk within 15 minutes");
  } else if (uvIndex >= 6 && cloudCover <= 40) {
    warnings.push("High UV exposure - use sun protection");
  }

  // 6. FORECAST-BASED WARNINGS (deteriorating conditions)
  const forecastWarnings = analyzeForecastTrends(forecastData, currentConditions);
  warnings.push(...forecastWarnings);

  // 7. WEATHER PATTERN WARNINGS
  const weatherPatternWarnings = analyzeWeatherPatterns(currentConditions);
  warnings.push(...weatherPatternWarnings);

  // 8. SEASONAL/LOCATION WARNINGS
  const contextualWarnings = generateContextualWarnings(currentConditions, locationData);
  warnings.push(...contextualWarnings);

  console.log(`✅ Generated ${warnings.length} smart warnings:`, warnings);
  return warnings;
}

/**
 * Analyze forecast trends for deteriorating conditions
 */
function analyzeForecastTrends(forecastData, currentConditions) {
  const warnings = [];
  
  if (!forecastData?.forecast?.forecastday || forecastData.forecast.forecastday.length === 0) {
    return warnings;
  }

  const today = foreca
/* [truncated — 11907 chars total, showing first 7000] */

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

FILE: api:functions/api/weather/paddlePenalties.js
LINES: 402
CHARS: 16038
TRUNCATED: yes (showing 7059 of 16038 chars)
--- BEGIN CONTENT ---
// File: functions/src/utils/paddlePenalties.js
//
// 🚨 SHARED PADDLE PENALTY LOGIC  —  “Fair Penalties” Edition
//
// Purpose
// -------
// Provide a consistent, fair penalty system for paddling suitability that:
//  - Preserves prior behavior/shape (backward compatible).
//  - Enforces 0.5 rating increments and [1.0..5.0] bounds.
//  - Adds precipitation and richer marine/visibility logic.
//  - Uses gusts, warnings, and wave steepness for real-world “chop” fairness.
//
// Inputs (typical)
// ----------------
// prediction: { rating: number, ... }
// features: {
//   temperature (°C), uvIndex, windSpeed (mph), beaufortScale,
//   visibility (km or mi), humidity, cloudCover, hasWarnings,
//   waveHeight (m), waterTemp (°C),
//   precipProbability (0..1) or precipChancePercent (0..100),
//   precipMm (mm), precipIn (in), gustSpeed (mph) [optional],
//   windDegree (0..360) [optional],
//   ...other keys
// }
// marineData (optional): {
//   waveHeight, swellHeight, swellPeriod, swellDirection (deg),
//   waterTemp, tides:{...}, rawMarineHour:{ precip_mm, gust_mph, wind_degree, ... }
// }
//
// Output
// ------
// Returns a new prediction object with:
//  - rating (rounded to .0/.5), originalRating, totalPenalty
//  - penaltiesApplied (string list for UI), roundedTo05Increments: true
//  - marineDataUsed: boolean
//  - penaltyDetails: [{code, amount, message, context}]
//
// Notes
// -----
// - We DO NOT penalize for data we don't have. Missing marine/precip fields → no penalty.
// - Thresholds are documented below. Tune safely in small increments (e.g., ±0.5).
//

/** -----------------------------
 * Tunable thresholds & helpers
 * ------------------------------
 * Keep these central for easy calibration without touching core logic.
 */
const THRESHOLDS = {
  // Temperature (air, °C) - RESTORED TO WORKING VERSION
  tempVeryHot: 35.0,         // Extreme heat → -1.0
  tempHot: 29.5,             // High heat → -0.5
  tempColdMajor: 0.0,        // Cold air → -1.0 (freezing point) 
  tempColdMinor: 5.0,        // Cool air → -0.5 (5°C = 41°F)

  // UV
  uvDanger: 10,              // → -1.0
  uvHigh: 8,                 // → -0.5
  uvModerate: 6,             // → -0.5

  // Wind (mph) / Beaufort (fallback) - RESTORED TO WORKING VERSION
  windDangerMph: 25,         // or B>=6 → -2.0
  windStrongMph: 20,         // or B>=5 → -1.5 (was 18, adjusted)
  windModerateMph: 15,       // or B>=4 → -1.0 (was 12, adjusted)
  windLightBeaufort: 4,      // → -0.5 (B4 instead of B3)

  // Gusts (mph above sustained)
  gustDeltaMajor: 10,        // gust - wind ≥ 10 → -1.0
  gustDeltaMinor: 6,         // gust - wind ≥ 6  → -0.5

  // Waves (m)
  waveLarge: 1.5,            // → -1.0
  waveModerate: 0.8,         // → -0.5

  // Swell steepness (m / s): higher = steeper/shorter-period waves → choppier
  // rule of thumb: >0.20 is quite steep for small craft; >0.12 noticeable
  swellSteepMajor: 0.20,     // → -1.0
  swellSteepMinor: 0.12,     // → -0.5

  // Wind vs swell direction (deg). ~180° is opposing; ~0° is aligned.
  windAgainstSwellDelta: 45, // within 45° of direct opposition → penalty
  windCrossSwellDelta: 70,   // cross ~90° ±20° can be sloppy → minor penalty

  // Water temp (°C) - RESTORED TO WORKING VERSION
  waterColdMajor: 5.0,       // → -1.0 (5°C = 41°F, truly cold water)
  waterColdMinor: 10.0,      // → -0.5 (10°C = 50°F, cool but manageable)

  // Visibility (km)
  visPoor: 5.0,              // → -1.0
  visMarginal: 10.0,         // → -0.5

  // Precipitation
  // Probabilities accept either 0..1 (prob) or 0..100 (%). Amounts from mm or in.
  popMajorPct: 80,           // PoP ≥ 80% → -1.0
  popMinorPct: 60,           // PoP ≥ 60% → -0.5
  rainHeavyMm: 6.0,          // ≥ 6 mm (≈ 0.24") in the hour → -1.0
  rainModerateMm: 2.0,       // ≥ 2 mm (≈ 0.08") in the hour → -0.5

  // Warnings / thunderstorms
  warningMajor: true,        // hasWarnings true → -1.0
  thunderstormCodes: new Set([1087, 1273, 1276, 1279, 1282]), // WeatherAPI thunderstorm-ish codes

  // Rounding & clamps
  minRating: 1.0,
  maxRating: 5.0
};

/** Utility: clamp number into [min, max] */
function clamp(x, min, max) { return Math.max(min, Math.min(max, x)); }

/** Utility: round to nearest 0.5 */
function roundToHalf(x) { return Math.round(x * 2) / 2; }

/** Utility: safe number (undefined/null → undefined) */
function n(x) { return (x === null || x === undefined) ? undefined : Number(x); }

/** Utility: Beaufort from mph (approx) if none provided */
function beaufortFromMph(mph) {
  if (mph == null) return undefined;
  const s = Number(mph);
  if (s < 1) return 0;
  if (s < 4) return 1;
  if (s < 8) return 2;
  if (s < 13) return 3;
  if (s < 19) return 4;
  if (s < 25) return 5;
  if (s < 32) return 6;
  if (s < 39) return 7;
  if (s < 47) return 8;
  if (s < 55) return 9;
  if (s < 64) return 10;
  if (s < 73) return 11;
  return 12;
}

/** Utility: smallest angle difference (degrees) between 2 bearings */
function angleDelta(a, b) {
  if (a == null || b == null) return undefined;
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d; // 0..180
}

/** Extract a field from features or marine raw hour if available */
function pickValue({ features, marine }) {
  const raw = marine?.rawMarineHour || {};
  return {
    // wind/gusts
    windMph: n(features.windSpeed ?? raw.wind_mph),
    gustMph: n(features.gustSpeed ?? raw.gust_mph),
    windDeg: n(features.windDegree ?? raw.wind_degree),

    // temps
    airTempC: n(features.temperature ?? raw.temp_c),
    uvIndex: n(features.uvIndex ?? raw.uv),

    // visibility (assume km if <= 25; if miles provided separately, caller can map to features.visibilityMiles)
    visibilityKm: (() => {
      const visKm = n(features.visibility ?? raw.vis_km);
      const visMiles = n(features.visibilityMiles ?? raw.vis_miles);
      if (visKm != null) return visKm;
      if (visMiles != null) return visMiles * 1.60934;
      return undefined;
    })(),

    // precip prob (0..1 or 0..100)
    popPct: (() => {
      const p0 = n(features.precipChancePercent);
      const p1 = n(features.precipProbability);
      if (p0 != null) return clamp(p0, 0, 100);
      if (p1 != null) return clamp(p1 * 100, 0, 100);
      return undefined;
    })(),

    // precip amount (mm)
    precipMm: (() => {
      const mm = n(features.precipMm ?? raw.precip_mm);
      const inches = n(features.precipIn ?? raw.precip_in);
      if (mm != null) return Math.max(0, mm);
      if (inches != null) return Math.max(0, inches * 25.4);
      return undefined;
    })(),

    // marine
    waveHeightM: n(features.waveHeight ?? marine?.waveHeight ?? raw.sig_ht_mt),
    swellHeightM: n(marine?.swellHeight ?? raw.swell_ht_mt),
    swellPeriodS: n(marine?.swellPeriod ?? raw.swell_period_secs),
    swellDirDeg: n(marine?.swellDirection ?? raw.swell_dir),
    waterTempC: n(features.waterTemp ?? marine?.waterTemp ?? raw.water_temp_c),

    // meta
    weatherCode: n(raw.condition?.code),
    hasWarnin
/* [truncated — 16038 chars total, showing first 7000] */

--- END CONTENT ---
