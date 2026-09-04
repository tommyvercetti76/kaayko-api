/**
 * Security Middleware - Bot Protection & Rate Limiting
 * Protects Kortex endpoints from malicious traffic
 */

const admin = require('firebase-admin');
const db = admin.firestore();
const { getClientIp: resolveClientIp } = require('../api/kortex/clientIp');

// Rate limit: requests per IP per time window
const RATE_LIMITS = {
  login: { max: 5, window: 15 * 60 * 1000 }, // 5 attempts per 15 minutes
  tenantRegistration: { max: 3, window: 60 * 60 * 1000 }, // 3 per hour
  tenants: { max: 20, window: 60 * 1000 }, // 20 per minute
  api: { max: 100, window: 60 * 1000 }, // 100 per minute for general API
  // Public write surfaces added in the trust pass. `failClosed` returns 503 when
  // the limiter store is unreachable instead of letting the request through —
  // an account-creation or appeal endpoint must never become unlimited because
  // Firestore hiccupped.
  tenantProvision: { max: 5, window: 60 * 60 * 1000, failClosed: true }, // 5 signups per hour per IP
  appeal: { max: 5, window: 60 * 60 * 1000, failClosed: true }, // 5 appeals per hour per IP
  linkCreate: { max: 120, window: 60 * 60 * 1000 }, // IP backstop for authenticated link creation
  // Guest (no-account) tier. Creation is generous enough for a real person
  // making a handful of QR codes and tight enough to make bulk abuse slow.
  guestCreate: { max: 12, window: 60 * 60 * 1000, failClosed: true }, // 12 links per hour per IP
  guestSession: { max: 15, window: 15 * 60 * 1000, failClosed: true }, // 15 code attempts per 15 min per IP
  guestRecover: { max: 5, window: 60 * 60 * 1000, failClosed: true }, // 5 recovery mails per hour per IP
  guestClaim: { max: 10, window: 60 * 60 * 1000, failClosed: true },
  publicQr: { max: 120, window: 60 * 1000 }, // QR image renders per minute per IP
  sharedReport: { max: 120, window: 60 * 60 * 1000 }, // public report reads per hour per IP
  resolve: { max: 60, window: 60 * 1000 }, // SDK / API link resolution per IP
  report: { max: 5, window: 60 * 60 * 1000, failClosed: true }, // abuse reports per hour per IP
  support: { max: 5, window: 60 * 60 * 1000, failClosed: true }, // support requests per hour per IP
  exportCsv: { max: 30, window: 60 * 60 * 1000 } // CSV exports per hour per IP
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
  // Hardened resolver: walks X-Forwarded-For right-to-left and returns the first
  // publicly-routable address, so a caller cannot get a fresh rate-limit bucket
  // by prepending a fake `X-Forwarded-For` (the old leftmost read was
  // caller-controlled). Legitimate single-proxy traffic resolves to the same
  // real client IP as before — only header spoofing is closed. Falls back to
  // 'unknown' to preserve the string key contract used below.
  return resolveClientIp(req) || 'unknown';
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
      
      // Read, check and count inside one transaction, so a burst of parallel
      // requests cannot all pass the check before any increment lands.
      const ref = db.collection('rate_limits').doc(key);
      const outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : null;
        const windowStart = data
          ? (typeof data.windowStart?.toMillis === 'function' ? data.windowStart.toMillis() : new Date(data.windowStart || 0).getTime())
          : 0;
        if (data && now - windowStart < limit.window) {
          if ((data.count || 0) >= limit.max) return { limited: true, windowStart };
          // Explicit next count: inside the transaction this is atomic, and it needs no server-side arithmetic.
          tx.update(ref, { count: (data.count || 0) + 1, lastRequest: admin.firestore.FieldValue.serverTimestamp() });
          return { limited: false };
        }
        tx.set(ref, {
          count: 1,
          windowStart: admin.firestore.FieldValue.serverTimestamp(),
          lastRequest: admin.firestore.FieldValue.serverTimestamp(),
          ip,
          limitType
        });
        return { limited: false };
      });
      if (outcome.limited) {
        const resetTime = new Date(outcome.windowStart + limit.window);
        console.log(`[Security] Rate limit exceeded for ${ip} on ${limitType}`);
        return res.status(429).json({
          success: false,
          error: 'Too many requests',
          message: `Rate limit exceeded. Try again after ${resetTime.toLocaleTimeString()}`,
          retryAfter: Math.ceil((resetTime - now) / 1000)
        });
      }
      
      next();
      
    } catch (error) {
      console.error('[Security] Rate limiter error:', error);
      const limit = RATE_LIMITS[limitType] || RATE_LIMITS.api;
      if (limit.failClosed) {
        return res.status(503).json({
          success: false,
          error: 'Service temporarily unavailable',
          message: 'Please try again in a moment.',
          code: 'RATE_LIMIT_UNAVAILABLE'
        });
      }
      // Legacy limit types keep their fail-open behaviour.
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
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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
