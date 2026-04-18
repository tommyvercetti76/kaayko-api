You are a careful local coding agent reviewing Node.js Firebase Cloud Functions API files for duplication reduction and safe improvements.
Run ID: commerce-audit-checkout-and-payment-flows-for-security-issues-20260418-160446z
Track: commerce
Area: commerce
Goal: Audit checkout and payment flows for security issues

PORTFOLIO COACHING
Portfolio overview: Kaayko API is a Firebase Cloud Functions Express backend. Every route is mounted through functions/index.js. Safe agent work must preserve route contracts, auth middleware chains, Firestore access patterns, and existing error-handling shapes. Security and tenant isolation are the highest-priority concerns.
Guided products: Commerce & Checkout API, Shared API Infrastructure
Primary focus products: Commerce & Checkout API
Source docs: README.md, functions/api/products/README.md, functions/api/checkout/README.md, functions/middleware/README.md

Focused doc snapshots:
- README.md: Kaayko API What this repo powers | Product | Purpose | Mounted base paths on `api` | Primary frontend consumers | Product guide | | Kreator | Creator applications, onboarding, profile, admin review | `/kreators` | `kaayko/src/kreator/*` | [`docs/products/KREATOR.md`](./docs/products/KREATOR.md) | Architecture Runtime: Firebase Functions v2, Node.js 22, Express app exported as `api`. Storage and state: Firebase Admin, Firestore, Cloud Storage, Firebase Auth. Payments: Stripe checkout/payment intent and webhook flows.
- functions/api/products/README.md: 🛍️ Products & Images APIs *E-commerce product catalog and image serving** 📁 Files in this Module 1. **`products.js`** - Product catalog API 2. **`images.js`** - Image proxy service 🛍️ API #1: Products `GET /api/products` - List all products `GET /api/products/:productId` - Get single product
- functions/api/checkout/README.md: Kaayko Checkout System Complete email notification system for Stripe payments with customer confirmations and admin alerts. 🎯 Overview ✅ Email collection during Stripe checkout (mandatory) ✅ Order confirmation page with email display ✅ Webhook processing for payment events ✅ Dual email notifications (customer + admin) ✅ Order storage in Firestore

Product: Commerce & Checkout API (Primary focus)
Purpose: Protect the products catalog, voting, image serving, Stripe payment intent creation, and order-completion flow as a paired, transaction-critical surface.
API paths:
  - functions/api/products/
  - functions/api/checkout/
Backend routes:
  - GET /products
  - GET /products/:id
  - POST /products/:id/vote
  - GET /images/:productId/:fileName
  - POST /createPaymentIntent
  - POST /createPaymentIntent/updateEmail
Validation focus:
  - Validate product fetch, image serving, voting, and checkout as one paired flow.
  - Confirm Stripe payment intent creation returns the correct client secret shape.
  - Verify vote rate limiting middleware is still active and correctly scoped.
  - Ensure image serving enforces content-type and does not expose directory listings.
Risk focus:
  - Stripe webhook and intent handling are transaction-critical — no silent fallbacks.
  - Rate limiting on vote endpoints must not be removed or weakened during cleanup.
  - Image serving routes must validate productId before reading from storage.
  - Checkout email update must not allow overwriting a confirmed payment's email.

Product: Shared API Infrastructure (Supporting context)
Purpose: Protect the middleware stack, auth guards, error handling, CORS, Firebase Admin initialization, and rate limiting that all routes depend on.
API paths:
  - functions/middleware/
  - functions/api/core/
  - functions/index.js
  - functions/api/auth/
  - functions/utils/
Backend routes:
  - /health
  - /api/**
Validation focus:
  - Verify middleware execution order is preserved for every mounted router.
  - Ensure auth claim validation runs before any data mutation endpoint.
  - Confirm error handlers return consistent shapes without leaking stack traces.
  - Validate Firebase Admin SDK is initialized once and not duplicated per-request.
Risk focus:
  - Middleware order bugs are silent — a reorder can bypass security checks entirely.
  - Firebase Admin double-initialization causes memory and auth failures.
  - Error shape inconsistencies cause frontend parsing failures across multiple products.
  - CORS misconfiguration can silently allow unauthorized cross-origin requests.

Analyze the selected files. Propose only low-risk, behavior-preserving edits.
You should surface both safe cleanup suggestions and any real API risks you see around:
- Auth middleware chain integrity
- Tenant isolation (smart links, billing, kreator scoping)
- Firestore access patterns (correct collection paths, security rules alignment)
- Route contracts (request/response shapes that the frontend depends on)
- Error handling consistency (no raw stack traces leaked to clients)
- Rate limiting and CORS configuration

Return JSON only using this exact shape:
{"summary":"...","insights":["..."],"findings":[{"severity":"low|medium|high","title":"...","detail":"...","category":"duplication|maintainability|security|auth|billing|tenant|contract|error-handling","file_paths":["repo:path"]}],"followups":["..."],"safe_edits":[{"path":"repo:path","kind":"rewrite","summary":"...","confidence":0.0,"content":"full file contents"}]}

Rules:
- `safe_edits` may contain at most 2 entries.
- Only rewrite files from the provided file list.
- Keep changes localized and behavior-preserving.
- If you are not highly confident, return an empty `safe_edits` array.
- NEVER remove or weaken auth middleware, rate limiting, or tenant isolation checks.
- NEVER change Stripe webhook handler logic, payment intent creation, or billing routes.
- Preserve Express route contracts — do not change response shapes clients depend on.
- Preserve middleware execution order — reordering can silently bypass security.
- When you call out a risk, attach the most relevant `file_paths` from the provided file list.

FILE: api:functions/middleware/securityMiddleware.js
LINES: 232
CHARS: 6652
TRUNCATED: no
--- BEGIN CONTENT ---
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

--- END CONTENT ---

FILE: api:functions/api/checkout/createPaymentIntent.js
LINES: 189
CHARS: 6587
TRUNCATED: no
--- BEGIN CONTENT ---
/**
 * Create Payment Intent for Stripe Checkout
 * Handles product purchases with Stripe integration
 */

const admin = require('firebase-admin');

// Lazy-load Stripe to avoid timeout during function initialization
let stripe = null;
function getStripe() {
  if (!stripe) {
    // IMPORTANT: Firebase secrets may include trailing newlines, so we must trim
    const apiKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    stripe = require('stripe')(apiKey, {
      timeout: 60000,
      maxNetworkRetries: 2,
      telemetry: false
    });
  }
  return stripe;
}

/**
 * Create a Stripe Payment Intent for a product purchase
 * @route POST /api/createPaymentIntent
 * @body {productId, productTitle, size, price}
 * @returns {clientSecret, paymentIntentId}
 */
async function createPaymentIntent(req, res) {
  try {
    const { items, dataRetentionConsent, customerEmail, customerPhone, productId, productTitle, size, gender, price } = req.body;

    let validatedItems = [];
    let totalAmount = 0;

    // NEW FORMAT: items array
    if (items && Array.isArray(items) && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const priceString = String(item.price).replace(/[$,]/g, '').trim();
        const priceInCents = Math.round(parseFloat(priceString) * 100);
        
        if (isNaN(priceInCents) || priceInCents <= 0) {
          return res.status(400).json({
            success: false,
            error: `Item ${i + 1} has invalid price: "${item.price}"`
          });
        }
        
        totalAmount += priceInCents;
        validatedItems.push({
          productId: item.productId,
          productTitle: item.productTitle || 'Unknown Product',
          size: item.size,
          gender: item.gender || 'Unisex',
          price: item.price,
          priceInCents: priceInCents
        });
      }
    }
    // OLD FORMAT: comma-separated strings (BACKWARDS COMPATIBILITY)
    else if (productId && size && price) {
      const productIds = String(productId).split(',').map(s => s.trim());
      const productTitles = String(productTitle || 'Product').split(',').map(s => s.trim());
      const sizes = String(size).split(',').map(s => s.trim());
      const genders = String(gender || 'Unisex').split(',').map(s => s.trim());
      
      // Parse total price
      const priceString = String(price).replace(/[$,]/g, '').trim();
      totalAmount = Math.round(parseFloat(priceString) * 100);
      
      if (isNaN(totalAmount) || totalAmount <= 0) {
        return res.status(400).json({
          success: false,
          error: `Invalid price: "${price}"`
        });
      }
      
      // Create items from comma-separated data
      validatedItems = productIds.map((id, idx) => ({
        productId: id,
        productTitle: productTitles[idx] || 'Unknown Product',
        size: sizes[idx] || 'Unknown',
        gender: genders[idx] || 'Unisex',
        price: price,
        priceInCents: Math.round(totalAmount / productIds.length) // Split price evenly
      }));
    } else {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: either items array OR productId, size, price'
      });
    }
    
    console.log(`💰 Creating payment for ${validatedItems.length} items, total: $${(totalAmount/100).toFixed(2)}`);

    // Create payment intent with Stripe (lazy-loaded)
    const stripeClient = getStripe();
    const paymentIntent = await stripeClient.paymentIntents.create({
      amount: totalAmount,
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true,
      },
      // Don't set receipt_email - it will be collected via Payment Element
      metadata: {
        // Store items as JSON string (Stripe metadata has size limits)
        items: JSON.stringify(validatedItems),
        itemCount: String(validatedItems.length),
        timestamp: new Date().toISOString(),
        notifyEmail: 'rohan@kaayko.com', // Admin notification email
        dataRetentionConsent: String(dataRetentionConsent === true) // User's privacy consent
      }
    });

    // Log the transaction attempt
    const itemsSummary = validatedItems.map(i => `${i.productTitle} (${i.gender} ${i.size})`).join(', ');
    console.log(`💳 Payment intent created: ${paymentIntent.id} for ${itemsSummary}`);

    // Store payment intent in Firestore with PROPER structure
    const db = admin.firestore();
    await db.collection('payment_intents').doc(paymentIntent.id).set({
      // Payment summary
      paymentIntentId: paymentIntent.id,
      totalAmount: totalAmount,
      totalAmountFormatted: `$${(totalAmount / 100).toFixed(2)}`,
      currency: 'usd',
      itemCount: validatedItems.length,
      
      // Order lifecycle tracking
      status: 'created', // created → pending → succeeded → fulfilled → cancelled
      paymentStatus: 'pending', // pending → succeeded → failed → refunded
      fulfillmentStatus: 'awaiting_payment', // awaiting_payment → processing → fulfilled → cancelled
      
      // Timestamps
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      paidAt: null,
      fulfilledAt: null,
      cancelledAt: null,
      
      // Items array - each item is a complete object
      items: validatedItems.map(item => ({
        productId: item.productId,
        productTitle: item.productTitle,
        size: item.size,
        gender: item.gender,
        price: item.price,
        priceInCents: item.priceInCents
      })),
      
      // Customer contact info
      customerEmail: customerEmail || null,
      customerPhone: customerPhone || null,
      
      // Privacy
      dataRetentionConsent: dataRetentionConsent || false,
      
      // Tracking history (audit trail)
      statusHistory: [{
        status: 'created',
        timestamp: new Date().toISOString(),
        note: 'Payment intent created'
      }]
    });
    
    console.log(`✅ Stored payment intent ${paymentIntent.id} with ${validatedItems.length} items in Firestore`);

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });

  } catch (error) {
    console.error('❌ Payment intent error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create payment intent',
      details: error.message
    });
  }
}

module.exports = createPaymentIntent;

--- END CONTENT ---

FILE: api:functions/api/checkout/updatePaymentIntentEmail.js
LINES: 79
CHARS: 2026
TRUNCATED: no
--- BEGIN CONTENT ---
/**
 * Update Payment Intent with Customer Email
 * Updates an existing payment intent's receipt_email field
 */

const admin = require('firebase-admin');

// Lazy-load Stripe
let stripe = null;
function getStripe() {
  if (!stripe) {
    require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    stripe = require('stripe')(apiKey);
  }
  return stripe;
}

/**
 * Update payment intent with customer email
 * @route POST /api/updatePaymentIntentEmail
 * @body {paymentIntentId, email}
 */
async function updatePaymentIntentEmail(req, res) {
  try {
    const { paymentIntentId, email } = req.body;

    if (!paymentIntentId || !email) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: paymentIntentId, email'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    const stripeClient = getStripe();
    
    // Update payment intent with receipt email
    const updatedPaymentIntent = await stripeClient.paymentIntents.update(
      paymentIntentId,
      {
        receipt_email: email
      }
    );

    console.log(`📧 Updated payment intent ${paymentIntentId} with email: ${email}`);

    // Email stored only in Stripe - simplifies data management
    // Stripe handles receipts, webhook handles notifications

    res.json({
      success: true,
      paymentIntentId: updatedPaymentIntent.id,
      email: email
    });

  } catch (error) {
    console.error('❌ Error updating payment intent email:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update payment intent email',
      details: error.message
    });
  }
}

module.exports = updatePaymentIntentEmail;

--- END CONTENT ---

FILE: api:functions/middleware/authMiddleware.js
LINES: 316
CHARS: 8842
TRUNCATED: yes (showing 7058 of 8842 chars)
--- BEGIN CONTENT ---
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
 * Supports two authentication methods:
 * 1. Firebase Auth (Bearer token) with admin role
 * 2. X-Admin-Key header with valid admin passphrase
 * @middleware - Must be used after requireAuth (or standalone with X-Admin-Key)
 */
function requireAdmin(req, res, next) {
  // Check for X-Admin-Key header (simpler admin access for internal tools)
  const adminKey = req.headers['x-admin-key'];
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
  const ADMIN_PASSPHRASE = isEmulator
    ? (process.env.ADMIN_PASSPHRASE || 'dev-admin-local-only')
    : (process.env.ADMIN_PASSPHRASE || process.env.KORTEX_SYNC_KEY);
  
  if (!ADMIN_PASSPHRASE && !isEmulator) {
    console.error('[SECURITY] ADMIN_PASSPHRASE not configured - admin access disabled');
    return res.status(503).json({
      success: false,
      error: 'Service Unavailable',
      message: 'Admin authentication not configured',
      code: 'ADMIN_NOT_CONFIGURED'
    });
  }
  
  if (adminKey && ADMIN_PASSPHRASE && adminKey === ADMIN_PASSPHRASE) {
    // Admin key is valid - grant access
    req.user = req.user || { uid: 'admin-key-user', email: 'admin@kaayko.com', role: 'admin' };
    req.user.role = 'admin';
    req.user.authMethod = 'admin-key';
    return next();
  }

  // Fall back to Firebase Auth check
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required. Provide Bearer token or X-Admin-Key header.',
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
        message: `Missing required permiss
/* [truncated — 8842 chars total, showing first 7000] */

--- END CONTENT ---
