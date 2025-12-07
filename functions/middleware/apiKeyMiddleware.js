/**
 * API Key Authentication Middleware
 * 
 * Enables programmatic access to Smart Links API for external clients.
 * Alternative to Firebase Auth for backend-to-backend integrations.
 * 
 * Features:
 * - API key validation via Firestore lookup
 * - Scope-based authorization
 * - Rate limiting per API key
 * - Usage tracking and analytics
 * - Security: keys are hashed, never stored in plaintext
 * 
 * @module middleware/apiKeyMiddleware
 */

const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();

/**
 * Hash an API key for secure storage
 * Uses SHA-256 hashing (one-way)
 * 
 * @param {string} apiKey - Plain text API key
 * @returns {string} Hashed key
 */
function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Generate a new API key
 * Format: ak_<32 random hex chars>
 * 
 * @returns {string} New API key
 */
function generateApiKey() {
  const randomBytes = crypto.randomBytes(16).toString('hex');
  return `ak_${randomBytes}`;
}

/**
 * Validate API key and attach client info to request
 * 
 * @param {string[]} requiredScopes - Scopes required for this endpoint
 * @returns {Function} Express middleware
 * 
 * @example
 * router.post('/smartlinks', requireApiKey(['create:links']), handler);
 */
function requireApiKey(requiredScopes = []) {
  return async (req, res, next) => {
    try {
      // Extract API key from header
      const apiKey = req.headers['x-api-key'] || req.headers['x-kaayko-api-key'];
      
      if (!apiKey) {
        return res.status(401).json({
          success: false,
          error: 'API key required',
          message: 'Missing x-api-key header',
          code: 'API_KEY_MISSING'
        });
      }

      // Validate key format
      if (!apiKey.startsWith('ak_') || apiKey.length !== 35) {
        return res.status(401).json({
          success: false,
          error: 'Invalid API key format',
          code: 'API_KEY_INVALID_FORMAT'
        });
      }

      // Hash the key for lookup
      const keyHash = hashApiKey(apiKey);

      // Look up key in Firestore
      const keysSnapshot = await db.collection('api_keys')
        .where('secretHash', '==', keyHash)
        .limit(1)
        .get();

      if (keysSnapshot.empty) {
        return res.status(401).json({
          success: false,
          error: 'Invalid API key',
          message: 'API key not found or has been revoked',
          code: 'API_KEY_INVALID'
        });
      }

      const keyDoc = keysSnapshot.docs[0];
      const keyData = keyDoc.data();

      // Check if key is disabled
      if (keyData.disabled === true) {
        return res.status(403).json({
          success: false,
          error: 'API key disabled',
          message: 'This API key has been disabled',
          code: 'API_KEY_DISABLED'
        });
      }

      // Check scopes
      const keyScopes = keyData.scopes || [];
      const hasRequiredScopes = requiredScopes.every(scope => 
        keyScopes.includes(scope) || keyScopes.includes('*')
      );

      if (!hasRequiredScopes) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          message: `Required scopes: ${requiredScopes.join(', ')}`,
          code: 'INSUFFICIENT_API_KEY_SCOPES'
        });
      }

      // Check rate limit
      const rateLimitPassed = await checkApiKeyRateLimit(
        keyDoc.id, 
        keyData.rateLimitPerMinute || 60
      );

      if (!rateLimitPassed) {
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED'
        });
      }

      // Attach API client info to request
      req.apiClient = {
        keyId: keyDoc.id,
        tenantId: keyData.tenantId,
        tenantName: keyData.tenantName,
        scopes: keyScopes,
        name: keyData.name,
        rateLimitPerMinute: keyData.rateLimitPerMinute
      };

      // Update last used timestamp (async, non-blocking)
      keyDoc.ref.update({
        lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        usageCount: admin.firestore.FieldValue.increment(1)
      }).catch(err => console.error('[APIKey] Failed to update lastUsedAt:', err));

      console.log('[APIKey] Authenticated:', {
        keyId: keyDoc.id,
        tenant: keyData.tenantId,
        scopes: keyScopes
      });

      next();

    } catch (error) {
      console.error('[APIKey] Authentication error:', error);
      return res.status(500).json({
        success: false,
        error: 'Authentication failed',
        message: 'Unable to verify API key',
        code: 'API_KEY_AUTH_FAILED'
      });
    }
  };
}

/**
 * Check rate limit for API key
 * Uses time-bucketed counters in Firestore
 * 
 * @param {string} keyId - API key document ID
 * @param {number} maxRequestsPerMinute - Rate limit threshold
 * @returns {Promise<boolean>} True if within limit
 */
async function checkApiKeyRateLimit(keyId, maxRequestsPerMinute) {
  try {
    const now = Date.now();
    const currentMinuteBucket = Math.floor(now / 60000); // Round to minute

    const rateLimitRef = db.collection('api_key_rate_limits').doc(`${keyId}_${currentMinuteBucket}`);
    
    // Use transaction to ensure atomic increment
    const allowed = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(rateLimitRef);
      
      if (!doc.exists) {
        // First request in this minute bucket
        transaction.set(rateLimitRef, {
          keyId,
          bucket: currentMinuteBucket,
          count: 1,
          expiresAt: admin.firestore.Timestamp.fromMillis(now + 120000) // TTL: 2 minutes
        });
        return true;
      }

      const currentCount = doc.data().count || 0;
      
      if (currentCount >= maxRequestsPerMinute) {
        return false; // Rate limit exceeded
      }

      transaction.update(rateLimitRef, {
        count: admin.firestore.FieldValue.increment(1)
      });
      
      return true;
    });

    return allowed;

  } catch (error) {
    console.error('[APIKey] Rate limit check failed:', error);
    // On error, allow the request (fail open)
    return true;
  }
}

/**
 * Create a new API key
 * 
 * @param {Object} keyData
 * @param {string} keyData.tenantId - Tenant ID
 * @param {string} keyData.name - Human-readable name
 * @param {string[]} keyData.scopes - Allowed scopes
 * @param {number} keyData.rateLimitPerMinute - Requests per minute limit
 * @returns {Promise<{keyId: string, apiKey: string, secretHash: string}>}
 */
async function createApiKey(keyData) {
  const {
    tenantId,
    name,
    scopes = ['read:links'],
    rateLimitPerMinute = 60
  } = keyData;

  if (!tenantId || !name) {
    throw new Error('tenantId and name are required');
  }

  // Generate API key
  const apiKey = generateApiKey();
  const secretHash = hashApiKey(apiKey);

  // Create key document
  const keyDoc = {
    tenantId,
    name,
    secretHash,
    scopes,
    rateLimitPerMinute,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastUsedAt: null,
    usageCount: 0,
    disabled: false
  };

  const keyRef = await db.collection('api_keys').add(keyDoc);

  console.log('[APIKey] Created:', {
    keyId: keyRef.id,
    tenant: tenantId,
    name,
    scopes
  });

  // Return the plain key (only time it's visible)
  return {
    keyId: keyRef.id,
    apiKey, // IMPORTANT: Store this securely, cannot be recovered
    secretHash,
    ...keyDoc
  };
}

/**
 * Revoke (disable) an API key
 * 
 * @param {string} keyId - API key document ID
 * @returns {Promise<void>}
 */
async function revokeApiKey(keyId) {
  await db.collection('api_keys').doc(keyId).update({
    disabled: true,
    revokedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  console.log('[APIKey] Revoked:', keyId);
}

/**
 * List API keys for a tenant
 * 
 * @param {string} tenantId 
 * @returns {Promise<Array>}
 */
async function listApiKeys(tenantId) {
  const snapshot = await db.collection('api_keys')
    .where('tenantId', '==', tenantId)
    .get();

  return snapshot.docs.map(doc => ({
    keyId: doc.id,
    ...doc.data(),
    secretHash: undefined // Don't expose hash
  }));
}

module.exports = {
  requireApiKey,
  createApiKey,
  revokeApiKey,
  listApiKeys,
  generateApiKey,
  hashApiKey,
  checkApiKeyRateLimit
};
