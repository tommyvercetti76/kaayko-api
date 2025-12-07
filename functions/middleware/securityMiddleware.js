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
