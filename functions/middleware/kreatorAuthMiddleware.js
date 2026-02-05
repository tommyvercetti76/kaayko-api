/**
 * Kreator Authentication Middleware
 * 
 * Specialized middleware for kreator authentication and authorization.
 * Separate from admin auth to support different user types.
 * 
 * @module middleware/kreatorAuthMiddleware
 */

const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * Verify session token and check if user is a kreator
 * Attaches kreator profile to request
 * @middleware
 */
async function requireKreatorAuth(req, res, next) {
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

    const token = authHeader.split('Bearer ')[1];
    
    // Import kreatorService for token verification
    const kreatorService = require('../services/kreatorService');
    
    // Verify our session token
    const decoded = kreatorService.verifySessionToken(token);
    
    if (!decoded || !decoded.uid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        message: 'The authentication token is invalid or expired.',
        code: 'AUTH_TOKEN_INVALID'
      });
    }

    // Attach basic user info
    req.user = {
      uid: decoded.uid,
      role: decoded.role,
      authTime: decoded.iat
    };

    // Fetch kreator profile from Firestore
    const kreatorDoc = await db.collection('kreators').doc(decoded.uid).get();

    if (!kreatorDoc.exists) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'You are not registered as a kreator',
        code: 'NOT_A_KREATOR'
      });
    }

    const kreatorData = kreatorDoc.data();

    // Check if kreator is deleted
    if (kreatorData.deletedAt) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Your kreator account has been deleted',
        code: 'KREATOR_DELETED'
      });
    }

    // Attach kreator profile to request
    req.kreator = {
      uid: kreatorDoc.id,
      ...kreatorData,
      createdAt: kreatorData.createdAt?.toDate?.()?.toISOString(),
      updatedAt: kreatorData.updatedAt?.toDate?.()?.toISOString()
    };

    next();

  } catch (error) {
    console.error('[KreatorAuth] Token verification failed:', error.message);

    return res.status(401).json({
      success: false,
      error: 'Authentication failed',
      message: 'Unable to verify authentication token.',
      code: 'AUTH_FAILED'
    });
  }
}

/**
 * Require kreator to be in active status
 * Must be used after requireKreatorAuth
 * @middleware
 */
function requireActiveKreator(req, res, next) {
  if (!req.kreator) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Kreator authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  const { status } = req.kreator;

  if (status === 'pending_password') {
    return res.status(403).json({
      success: false,
      error: 'Account Setup Incomplete',
      message: 'Please complete your account setup by setting a password.',
      code: 'KREATOR_PENDING_PASSWORD'
    });
  }

  if (status === 'suspended') {
    return res.status(403).json({
      success: false,
      error: 'Account Suspended',
      message: 'Your kreator account has been suspended. Please contact support.',
      code: 'KREATOR_SUSPENDED'
    });
  }

  if (status === 'deactivated') {
    return res.status(403).json({
      success: false,
      error: 'Account Deactivated',
      message: 'Your kreator account has been deactivated.',
      code: 'KREATOR_DEACTIVATED'
    });
  }

  if (status !== 'active') {
    return res.status(403).json({
      success: false,
      error: 'Invalid Account Status',
      message: `Your account status (${status}) does not allow this action.`,
      code: 'INVALID_KREATOR_STATUS'
    });
  }

  next();
}

/**
 * Require kreator to have specific permission(s)
 * Must be used after requireKreatorAuth
 * @param {string|string[]} requiredPermissions
 * @middleware
 */
function requireKreatorPermission(requiredPermissions) {
  const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];

  return (req, res, next) => {
    if (!req.kreator) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Kreator authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const kreatorPermissions = req.kreator.permissions || [];

    // Check if kreator has all required permissions
    const hasAllPermissions = permissions.every(p => kreatorPermissions.includes(p));

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
 * Optional kreator auth - attaches kreator if token is valid
 * @middleware
 */
async function optionalKreatorAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      req.kreator = null;
      return next();
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified
    };

    // Try to fetch kreator profile
    const kreatorDoc = await db.collection('kreators').doc(decodedToken.uid).get();

    if (kreatorDoc.exists && !kreatorDoc.data().deletedAt) {
      req.kreator = {
        uid: kreatorDoc.id,
        ...kreatorDoc.data()
      };
    } else {
      req.kreator = null;
    }

    next();

  } catch (error) {
    console.log('[KreatorAuth] Optional auth failed, continuing without kreator:', error.message);
    req.user = null;
    req.kreator = null;
    next();
  }
}

/**
 * Rate limiter for kreator endpoints
 * @param {string} action - Action identifier for rate limiting
 * @param {number} maxRequests - Max requests per window
 * @param {number} windowMs - Window size in milliseconds
 */
function kreatorRateLimit(action, maxRequests = 10, windowMs = 60000) {
  const requestCounts = new Map();

  return (req, res, next) => {
    const identifier = req.kreator?.uid || req.ip || 'unknown';
    const key = `${action}:${identifier}`;
    const now = Date.now();

    // Get or initialize count
    let record = requestCounts.get(key);
    if (!record || now - record.windowStart > windowMs) {
      record = { count: 0, windowStart: now };
    }

    record.count++;
    requestCounts.set(key, record);

    // Clean up old entries periodically
    if (requestCounts.size > 10000) {
      const cutoff = now - windowMs;
      for (const [k, v] of requestCounts.entries()) {
        if (v.windowStart < cutoff) {
          requestCounts.delete(k);
        }
      }
    }

    if (record.count > maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Too Many Requests',
        message: `Rate limit exceeded for ${action}. Please try again later.`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((record.windowStart + windowMs - now) / 1000)
      });
    }

    next();
  };
}

/**
 * Attach client info (IP, user agent) to request
 * @middleware
 */
function attachClientInfo(req, res, next) {
  req.clientInfo = {
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() 
      || req.headers['x-real-ip'] 
      || req.connection?.remoteAddress 
      || req.ip,
    userAgent: req.headers['user-agent'] || 'unknown',
    referer: req.headers.referer || null,
    origin: req.headers.origin || null
  };
  next();
}

module.exports = {
  requireKreatorAuth,
  requireActiveKreator,
  requireKreatorPermission,
  optionalKreatorAuth,
  kreatorRateLimit,
  attachClientInfo
};
