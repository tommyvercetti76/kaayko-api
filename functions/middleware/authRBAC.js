/**
 * Role-Based Access Control & Optional Auth Middleware
 * @module middleware/authRBAC
 */

const admin = require('firebase-admin');
const { authError } = require('./authErrors');

/** Require user to have specific role(s). Use after requireAuth. */
function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return (req, res, next) => {
    if (!req.user) return authError(res, 401, 'Unauthorized', 'Authentication required', 'AUTH_REQUIRED');
    if (!req.user.role) return authError(res, 403, 'Forbidden', 'User is not authorized.', 'NO_ROLE_ASSIGNED');
    if (!roles.includes(req.user.role))
      return authError(res, 403, 'Forbidden', `Access denied. Required: ${roles.join(', ')}. Yours: ${req.user.role}`, 'INSUFFICIENT_PERMISSIONS');
    next();
  };
}

/** Require user to have specific permission(s). Use after requireAuth. */
function requirePermission(requiredPermissions) {
  const perms = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
  return (req, res, next) => {
    if (!req.user) return authError(res, 401, 'Unauthorized', 'Authentication required', 'AUTH_REQUIRED');
    if (req.user.role === 'super-admin') return next();
    const userPerms = req.user.permissions || [];
    if (!perms.every(p => userPerms.includes(p)))
      return authError(res, 403, 'Forbidden', `Missing permissions: ${perms.join(', ')}`, 'INSUFFICIENT_PERMISSIONS');
    next();
  };
}

/** Optional auth — attaches user if valid token, continues without if not. */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { req.user = null; return next(); }
    const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
    req.user = { uid: decoded.uid, email: decoded.email, emailVerified: decoded.email_verified };
    const userDoc = await admin.firestore().collection('admin_users').doc(decoded.uid).get();
    if (userDoc.exists) { req.user.profile = userDoc.data(); req.user.role = userDoc.data().role || 'viewer'; }
    next();
  } catch (_) { req.user = null; next(); }
}

/** Allow X-Admin-Key OR Bearer token, then hand off to requireAdmin. */
function optionalAuthForAdmin(req, res, next) {
  if (req.headers['x-admin-key']) return next();
  const { requireAuth } = require('./authMiddleware');
  return requireAuth(req, res, next);
}

module.exports = { requireRole, requirePermission, optionalAuth, optionalAuthForAdmin };
