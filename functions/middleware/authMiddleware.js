/**
 * Core Authentication Middleware — Firebase Auth + Admin passphrase
 * @module middleware/authMiddleware
 */

const admin = require('firebase-admin');
const { authError } = require('./authErrors');

/** Verify Firebase ID token and attach user + profile to request. */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer '))
      return authError(res, 401, 'Unauthorized', 'No authentication token provided', 'AUTH_TOKEN_MISSING');
    const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
    req.user = { uid: decoded.uid, email: decoded.email, emailVerified: decoded.email_verified, authTime: decoded.auth_time, iat: decoded.iat, exp: decoded.exp };
    const userDoc = await admin.firestore().collection('admin_users').doc(decoded.uid).get();
    if (userDoc.exists) { req.user.profile = userDoc.data(); req.user.role = userDoc.data().role || 'viewer'; req.user.permissions = userDoc.data().permissions || []; }
    else { req.user.role = null; req.user.profile = null; }
    next();
  } catch (error) {
    console.error('[Auth] Token verification failed:', error.message);
    if (error.code === 'auth/id-token-expired') return authError(res, 401, 'Token expired', 'Session expired. Please log in again.', 'AUTH_TOKEN_EXPIRED');
    if (error.code === 'auth/argument-error') return authError(res, 401, 'Invalid token', 'Authentication token is invalid.', 'AUTH_TOKEN_INVALID');
    return authError(res, 401, 'Authentication failed', 'Unable to verify token.', 'AUTH_FAILED');
  }
}

/** Require admin via X-Admin-Key header OR Firebase Auth role. */
function requireAdmin(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
  const PASSPHRASE = isEmulator ? (process.env.ADMIN_PASSPHRASE || 'dev-admin-local-only') : process.env.ADMIN_PASSPHRASE;
  if (!PASSPHRASE && !isEmulator) return authError(res, 503, 'Service Unavailable', 'Admin auth not configured', 'ADMIN_NOT_CONFIGURED');
  if (adminKey && PASSPHRASE && adminKey === PASSPHRASE) {
    req.user = req.user || { uid: 'admin-key-user', email: 'admin@kaayko.com', role: 'admin' };
    req.user.role = 'admin'; req.user.authMethod = 'admin-key'; return next();
  }
  if (!req.user) return authError(res, 401, 'Unauthorized', 'Provide Bearer token or X-Admin-Key.', 'AUTH_REQUIRED');
  if (!req.user.role) return authError(res, 403, 'Forbidden', 'Not authorized as admin.', 'NOT_ADMIN_USER');
  if (!['super-admin', 'admin'].includes(req.user.role))
    return authError(res, 403, 'Forbidden', `Required: admin. Yours: ${req.user.role}`, 'INSUFFICIENT_PERMISSIONS');
  next();
}

module.exports = { requireAuth, requireAdmin };
