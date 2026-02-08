/**
 * Rate Limiting Service for Smart Links
 * 
 * Provides flexible rate limiting with multiple strategies:
 * - IP-based rate limiting for public endpoints
 * - User-based rate limiting for authenticated endpoints
 * - API key-based rate limiting for programmatic access
 * - Global rate limiting for DDoS protection
 * 
 * Uses time-bucketed counters in Firestore for distributed rate limiting.
 * 
 * @module api/kortex/rateLimitService
 */

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Check rate limit and increment counter
 * 
 * @param {Object} params
 * @param {string} params.key - Unique identifier (IP, userId, apiKeyId)
 * @param {string} params.type - Rate limit type (ip|user|apikey|global)
 * @param {number} params.maxRequests - Maximum requests allowed
 * @param {number} params.windowSeconds - Time window in seconds (default: 60)
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number}>}
 */
async function checkRateLimit(params) {
  const {
    key,
    type,
    maxRequests,
    windowSeconds = 60
  } = params;

  try {
    const now = Date.now();
    const currentBucket = Math.floor(now / (windowSeconds * 1000));
    
    const rateLimitRef = db.collection('rate_limits').doc(`${type}_${key}_${currentBucket}`);
    
    // Use transaction for atomic increment
    const result = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(rateLimitRef);
      
      if (!doc.exists) {
        // First request in this bucket
        transaction.set(rateLimitRef, {
          type,
          key,
          bucket: currentBucket,
          count: 1,
          expiresAt: admin.firestore.Timestamp.fromMillis(now + (windowSeconds * 2 * 1000)) // TTL
        });
        
        return {
          allowed: true,
          remaining: maxRequests - 1,
          resetAt: (currentBucket + 1) * windowSeconds * 1000
        };
      }

      const currentCount = doc.data().count || 0;
      
      if (currentCount >= maxRequests) {
        // Rate limit exceeded
        return {
          allowed: false,
          remaining: 0,
          resetAt: (currentBucket + 1) * windowSeconds * 1000
        };
      }

      // Increment counter
      transaction.update(rateLimitRef, {
        count: admin.firestore.FieldValue.increment(1)
      });
      
      return {
        allowed: true,
        remaining: maxRequests - currentCount - 1,
        resetAt: (currentBucket + 1) * windowSeconds * 1000
      };
    });

    return result;

  } catch (error) {
    console.error('[RateLimit] Check error:', error);
    // On error, allow the request (fail open)
    return {
      allowed: true,
      remaining: maxRequests,
      resetAt: Date.now() + (windowSeconds * 1000)
    };
  }
}

/**
 * Express middleware for IP-based rate limiting
 * 
 * @param {Object} options
 * @param {number} options.maxRequests - Max requests per window (default: 60)
 * @param {number} options.windowSeconds - Time window in seconds (default: 60)
 * @param {string} options.message - Custom error message
 * @returns {Function} Express middleware
 */
function ipRateLimit(options = {}) {
  const {
    maxRequests = 60,
    windowSeconds = 60,
    message = 'Too many requests. Please try again later.'
  } = options;

  return async (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    
    const result = await checkRateLimit({
      key: ip,
      type: 'ip',
      maxRequests,
      windowSeconds
    });

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetAt);

    if (!result.allowed) {
      console.log('[RateLimit] IP limit exceeded:', ip);
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message,
        code: 'RATE_LIMIT_EXCEEDED',
        resetAt: result.resetAt
      });
    }

    next();
  };
}

/**
 * Express middleware for user-based rate limiting
 * Requires authenticated user (req.user)
 * 
 * @param {Object} options
 * @param {number} options.maxRequests - Max requests per window (default: 120)
 * @param {number} options.windowSeconds - Time window in seconds (default: 60)
 * @returns {Function} Express middleware
 */
function userRateLimit(options = {}) {
  const {
    maxRequests = 120,
    windowSeconds = 60
  } = options;

  return async (req, res, next) => {
    if (!req.user || !req.user.uid) {
      // No user, skip rate limit
      return next();
    }

    const result = await checkRateLimit({
      key: req.user.uid,
      type: 'user',
      maxRequests,
      windowSeconds
    });

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetAt);

    if (!result.allowed) {
      console.log('[RateLimit] User limit exceeded:', req.user.email);
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'You have exceeded your request quota. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        resetAt: result.resetAt
      });
    }

    next();
  };
}

/**
 * Express middleware for tenant-based rate limiting
 * Requires tenant context (req.tenantContext or req.apiClient)
 * 
 * @param {Object} options
 * @param {number} options.maxRequests - Max requests per window (default: 1000)
 * @param {number} options.windowSeconds - Time window in seconds (default: 60)
 * @returns {Function} Express middleware
 */
function tenantRateLimit(options = {}) {
  const {
    maxRequests = 1000,
    windowSeconds = 60
  } = options;

  return async (req, res, next) => {
    const tenantId = req.tenantContext?.tenantId || req.apiClient?.tenantId;

    if (!tenantId) {
      // No tenant, skip rate limit
      return next();
    }

    const result = await checkRateLimit({
      key: tenantId,
      type: 'tenant',
      maxRequests,
      windowSeconds
    });

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetAt);

    if (!result.allowed) {
      console.log('[RateLimit] Tenant limit exceeded:', tenantId);
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Tenant request quota exceeded. Please upgrade your plan or contact support.',
        code: 'TENANT_RATE_LIMIT_EXCEEDED',
        resetAt: result.resetAt
      });
    }

    next();
  };
}

module.exports = {
  checkRateLimit,
  ipRateLimit,
  userRateLimit,
  tenantRateLimit
};
