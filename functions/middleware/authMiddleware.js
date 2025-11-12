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
 * @middleware - Must be used after requireAuth
 */
function requireAdmin(req, res, next) {
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

module.exports = {
  requireAuth,
  requireAdmin,
  requireRole,
  requirePermission,
  optionalAuth
};
