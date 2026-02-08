/**
 * Security Middleware — Bot protection, rate limiting, secure headers
 * @module middleware/securityMiddleware
 */

const admin = require('firebase-admin');
const { RATE_LIMITS, isBot, getClientIp } = require('./securityUtils');

const db = admin.firestore();

/** Firestore-backed rate limiter. */
function rateLimiter(limitType = 'api') {
  return async (req, res, next) => {
    try {
      const ip = getClientIp(req);
      const limit = RATE_LIMITS[limitType] || RATE_LIMITS.api;
      const now = Date.now();
      const key = `rate_limit_${limitType}_${ip}`;
      const doc = await db.collection('rate_limits').doc(key).get();
      const fresh = { count: 1, windowStart: admin.firestore.FieldValue.serverTimestamp(), lastRequest: admin.firestore.FieldValue.serverTimestamp(), ip, limitType };
      if (doc.exists) {
        const d = doc.data(); const ws = d.windowStart.toMillis();
        if (now - ws < limit.window) {
          if (d.count >= limit.max) return res.status(429).json({ success: false, error: 'Too many requests', retryAfter: Math.ceil((ws + limit.window - now) / 1000) });
          await db.collection('rate_limits').doc(key).update({ count: admin.firestore.FieldValue.increment(1), lastRequest: admin.firestore.FieldValue.serverTimestamp() });
        } else { await db.collection('rate_limits').doc(key).set(fresh); }
      } else { await db.collection('rate_limits').doc(key).set(fresh); }
      next();
    } catch (err) { console.error('[Security] Rate limiter error:', err); next(); }
  };
}

/** Block non-search-engine bots and missing user agents. */
function botProtection(req, res, next) {
  const ua = req.get('user-agent') || '';
  if (isBot(ua)) {
    if (ua.match(/googlebot|bingbot|duckduckbot|baiduspider/i)) return next();
    return res.status(403).json({ success: false, error: 'Access denied', message: 'Automated requests not allowed' });
  }
  if (!ua || ua.length < 10) return res.status(403).json({ success: false, error: 'Access denied', message: 'Invalid request headers' });
  next();
}

/** Set security response headers. */
function secureHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (req.path.includes('/admin') || req.path.includes('/tenants')) {
    const allowed = ['https://kaayko.com', 'https://kaaykostore.web.app', 'https://kaaykostore.firebaseapp.com'];
    const origin = req.get('origin');
    if (allowed.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); }
  }
  next();
}

module.exports = { rateLimiter, botProtection, secureHeaders };
