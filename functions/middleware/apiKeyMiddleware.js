/**
 * API Key Authentication Middleware
 * @module middleware/apiKeyMiddleware
 */

const admin = require('firebase-admin');
const { hashApiKey } = require('./apiKeyService');
const { checkApiKeyRateLimit } = require('./apiKeyService');
const { authError } = require('./authErrors');

const db = admin.firestore();

/** Validate API key, check scopes & rate limit, attach client info. */
function requireApiKey(requiredScopes = []) {
  return async (req, res, next) => {
    try {
      const apiKey = req.headers['x-api-key'] || req.headers['x-kaayko-api-key'];
      if (!apiKey) return authError(res, 401, 'API key required', 'Missing x-api-key header', 'API_KEY_MISSING');
      if (!apiKey.startsWith('ak_') || apiKey.length !== 35)
        return authError(res, 401, 'Invalid API key format', '', 'API_KEY_INVALID_FORMAT');

      const snap = await db.collection('api_keys').where('secretHash', '==', hashApiKey(apiKey)).limit(1).get();
      if (snap.empty) return authError(res, 401, 'Invalid API key', 'Not found or revoked', 'API_KEY_INVALID');

      const keyDoc = snap.docs[0]; const kd = keyDoc.data();
      if (kd.disabled) return authError(res, 403, 'API key disabled', 'Key has been disabled', 'API_KEY_DISABLED');

      const scopes = kd.scopes || [];
      if (!requiredScopes.every(s => scopes.includes(s) || scopes.includes('*')))
        return authError(res, 403, 'Insufficient permissions', `Required: ${requiredScopes.join(', ')}`, 'INSUFFICIENT_API_KEY_SCOPES');

      if (!(await checkApiKeyRateLimit(keyDoc.id, kd.rateLimitPerMinute || 60)))
        return authError(res, 429, 'Rate limit exceeded', 'Too many requests', 'RATE_LIMIT_EXCEEDED');

      req.apiClient = { keyId: keyDoc.id, tenantId: kd.tenantId, tenantName: kd.tenantName, scopes, name: kd.name };
      keyDoc.ref.update({ lastUsedAt: admin.firestore.FieldValue.serverTimestamp(), usageCount: admin.firestore.FieldValue.increment(1) }).catch(() => {});
      next();
    } catch (error) {
      console.error('[APIKey] Auth error:', error);
      return authError(res, 500, 'Authentication failed', 'Unable to verify API key', 'API_KEY_AUTH_FAILED');
    }
  };
}

module.exports = { requireApiKey };
