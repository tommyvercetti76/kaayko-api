/**
 * Kreator Auth Helpers — Optional auth, rate limiting, client info
 * @module middleware/kreatorAuthHelpers
 */

const admin = require('firebase-admin');
const { authError } = require('./authErrors');

const db = admin.firestore();

/** Require kreator to have specific permission(s). Use after requireKreatorAuth. */
function requireKreatorPermission(requiredPermissions) {
  const perms = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
  return (req, res, next) => {
    if (!req.kreator) return authError(res, 401, 'Unauthorized', 'Kreator authentication required', 'AUTH_REQUIRED');
    const kreatorPerms = req.kreator.permissions || [];
    if (!perms.every(p => kreatorPerms.includes(p)))
      return authError(res, 403, 'Forbidden', `Missing permissions: ${perms.join(', ')}`, 'INSUFFICIENT_PERMISSIONS');
    next();
  };
}

/** Optional kreator auth — attaches kreator if valid, continues without if not. */
async function optionalKreatorAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { req.user = null; req.kreator = null; return next(); }
    const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
    req.user = { uid: decoded.uid, email: decoded.email, emailVerified: decoded.email_verified };
    const kreatorDoc = await db.collection('kreators').doc(decoded.uid).get();
    req.kreator = (kreatorDoc.exists && !kreatorDoc.data().deletedAt)
      ? { uid: kreatorDoc.id, ...kreatorDoc.data() } : null;
    next();
  } catch (_) { req.user = null; req.kreator = null; next(); }
}

/** In-memory rate limiter for kreator endpoints. */
function kreatorRateLimit(action, maxRequests = 10, windowMs = 60000) {
  const counts = new Map();
  return (req, res, next) => {
    const id = req.kreator?.uid || req.ip || 'unknown';
    const key = `${action}:${id}`;
    const now = Date.now();
    let rec = counts.get(key);
    if (!rec || now - rec.windowStart > windowMs) rec = { count: 0, windowStart: now };
    rec.count++;
    counts.set(key, rec);
    if (counts.size > 10000) { const cutoff = now - windowMs; for (const [k, v] of counts) { if (v.windowStart < cutoff) counts.delete(k); } }
    if (rec.count > maxRequests)
      return res.status(429).json({ success: false, error: 'Too Many Requests', retryAfter: Math.ceil((rec.windowStart + windowMs - now) / 1000) });
    next();
  };
}

/** Attach client IP / UA to request. */
function attachClientInfo(req, res, next) {
  req.clientInfo = {
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.connection?.remoteAddress || req.ip,
    userAgent: req.headers['user-agent'] || 'unknown',
    referer: req.headers.referer || null, origin: req.headers.origin || null
  };
  next();
}

module.exports = { requireKreatorPermission, optionalKreatorAuth, kreatorRateLimit, attachClientInfo };
