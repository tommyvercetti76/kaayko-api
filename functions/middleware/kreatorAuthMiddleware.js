/**
 * Kreator Authentication Middleware — Token verify + status checks
 * @module middleware/kreatorAuthMiddleware
 */

const admin = require('firebase-admin');
const { authError } = require('./authErrors');

const db = admin.firestore();

/** Verify kreator session token and attach kreator profile. */
async function requireKreatorAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer '))
      return authError(res, 401, 'Unauthorized', 'No authentication token provided', 'AUTH_TOKEN_MISSING');
    const kreatorService = require('../services/kreatorService');
    const decoded = kreatorService.verifySessionToken(authHeader.split('Bearer ')[1]);
    if (!decoded?.uid) return authError(res, 401, 'Invalid token', 'Token is invalid or expired.', 'AUTH_TOKEN_INVALID');
    req.user = { uid: decoded.uid, role: decoded.role, authTime: decoded.iat };
    const kreatorDoc = await db.collection('kreators').doc(decoded.uid).get();
    if (!kreatorDoc.exists) return authError(res, 403, 'Forbidden', 'Not registered as a kreator', 'NOT_A_KREATOR');
    const data = kreatorDoc.data();
    if (data.deletedAt) return authError(res, 403, 'Forbidden', 'Kreator account has been deleted', 'KREATOR_DELETED');
    req.kreator = { uid: kreatorDoc.id, ...data, createdAt: data.createdAt?.toDate?.()?.toISOString(), updatedAt: data.updatedAt?.toDate?.()?.toISOString() };
    next();
  } catch (error) {
    console.error('[KreatorAuth] Verification failed:', error.message);
    return authError(res, 401, 'Authentication failed', 'Unable to verify token.', 'AUTH_FAILED');
  }
}

/** Require kreator to be in active status. Use after requireKreatorAuth. */
function requireActiveKreator(req, res, next) {
  if (!req.kreator) return authError(res, 401, 'Unauthorized', 'Kreator authentication required', 'AUTH_REQUIRED');
  const { status } = req.kreator;
  if (status === 'pending_password') return authError(res, 403, 'Setup Incomplete', 'Please set a password.', 'KREATOR_PENDING_PASSWORD');
  if (status === 'suspended') return authError(res, 403, 'Suspended', 'Account suspended. Contact support.', 'KREATOR_SUSPENDED');
  if (status === 'deactivated') return authError(res, 403, 'Deactivated', 'Account deactivated.', 'KREATOR_DEACTIVATED');
  if (status !== 'active') return authError(res, 403, 'Invalid Status', `Status "${status}" not allowed.`, 'INVALID_KREATOR_STATUS');
  next();
}

module.exports = { requireKreatorAuth, requireActiveKreator };
