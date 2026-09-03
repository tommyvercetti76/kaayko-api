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
const crypto = require('crypto');

/**
 * Constant-time string compare for secrets (admin key / passphrase).
 * A plain `===` short-circuits on the first differing byte, leaking the secret
 * one character at a time via response timing. timingSafeEqual removes that
 * side channel; the length pre-check only leaks length (standard, acceptable).
 */
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

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
  
  if (adminKey && ADMIN_PASSPHRASE && timingSafeEqualStr(adminKey, ADMIN_PASSPHRASE)) {
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
        message: `Missing required permissions: ${permissions.join(', ')}`,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
}

/**
 * Require a verified email address before a write.
 *
 * Only accounts provisioned through self-serve signup carry
 * `admin_users.requireEmailVerification = true`; hand-provisioned tenants,
 * super-admins and the X-Admin-Key path are unaffected, so nothing that works
 * today stops working. The check reads `email_verified` from the ID token, so a
 * user who just verified needs a refreshed token (the SPA banner does this).
 * @middleware - Must be used after requireAuth
 */
function requireVerifiedEmail(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Unauthorized', code: 'AUTH_REQUIRED' });
  }
  if (req.user.authMethod === 'admin-key' || req.user.role === 'super-admin') return next();
  if (req.user.profile?.requireEmailVerification !== true) return next();
  if (req.user.emailVerified === true) return next();
  return res.status(403).json({
    success: false,
    error: 'Email not verified',
    message: 'Verify your email address to create or change links. Check your inbox for the verification link.',
    code: 'EMAIL_NOT_VERIFIED'
  });
}

/**
 * Require the global super-admin role.
 * @middleware - Must be used after requireAuth
 */
function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Unauthorized', code: 'AUTH_REQUIRED' });
  }
  if (req.user.role !== 'super-admin') {
    return res.status(403).json({ success: false, error: 'Forbidden', message: 'Super-admin only', code: 'SUPER_ADMIN_ONLY' });
  }
  next();
}

/**
 * Optional auth - attaches user if token is valid, but doesn't require it
 * @middleware
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token provided - continue without user
      req.user = null;
      return next();
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified
    };

    // Try to fetch user profile
    const userDoc = await admin.firestore()
      .collection('admin_users')
      .doc(decodedToken.uid)
      .get();

    if (userDoc.exists) {
      req.user.profile = userDoc.data();
      req.user.role = userDoc.data().role || 'viewer';
    }

    next();

  } catch (error) {
    // Token invalid - continue without user
    console.log('[Auth] Optional auth failed, continuing without user:', error.message);
    req.user = null;
    next();
  }
}

/**
 * Flexible auth middleware - allows X-Admin-Key OR Bearer token
 * Use this before requireAdmin for routes that should accept admin key
 * @middleware
 */
function optionalAuthForAdmin(req, res, next) {
  // If X-Admin-Key is provided, skip Firebase auth check
  const adminKey = req.headers['x-admin-key'];
  if (adminKey) {
    // Let requireAdmin handle the validation
    return next();
  }
  
  // Otherwise, require Firebase auth
  return requireAuth(req, res, next);
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireRole,
  requirePermission,
  requireVerifiedEmail,
  requireSuperAdmin,
  optionalAuth,
  optionalAuthForAdmin
};
