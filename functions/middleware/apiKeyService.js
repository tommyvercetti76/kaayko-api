/**
 * API Key Management Service
 *
 * CRUD operations, key generation/hashing, and rate-limit checks for API keys.
 * The middleware (requireApiKey) lives in apiKeyMiddleware.js.
 *
 * @module middleware/apiKeyService
 */

const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();

/** SHA-256 hash (one-way) of an API key. */
function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/** Generate a new API key  →  ak_<32 hex chars>. */
function generateApiKey() {
  return `ak_${crypto.randomBytes(16).toString('hex')}`;
}

/** Time-bucketed rate-limit check via Firestore transaction. */
async function checkApiKeyRateLimit(keyId, maxPerMinute) {
  try {
    const bucket = Math.floor(Date.now() / 60000);
    const ref = db.collection('api_key_rate_limits').doc(`${keyId}_${bucket}`);
    return db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) {
        tx.set(ref, { keyId, bucket, count: 1, expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 120000) });
        return true;
      }
      if ((doc.data().count || 0) >= maxPerMinute) return false;
      tx.update(ref, { count: admin.firestore.FieldValue.increment(1) });
      return true;
    });
  } catch (err) {
    console.error('[APIKey] Rate limit check failed:', err);
    return true; // fail open
  }
}

/** Create a new API key document in Firestore. Returns the plain key (only time visible). */
async function createApiKey({ tenantId, name, scopes = ['read:links'], rateLimitPerMinute = 60 }) {
  if (!tenantId || !name) throw new Error('tenantId and name are required');
  const apiKey = generateApiKey();
  const secretHash = hashApiKey(apiKey);
  const keyDoc = {
    tenantId, name, secretHash, scopes, rateLimitPerMinute,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastUsedAt: null, usageCount: 0, disabled: false
  };
  const ref = await db.collection('api_keys').add(keyDoc);
  console.log('[APIKey] Created:', { keyId: ref.id, tenant: tenantId, name, scopes });
  return { keyId: ref.id, apiKey, secretHash, ...keyDoc };
}

/** Disable an API key. */
async function revokeApiKey(keyId) {
  await db.collection('api_keys').doc(keyId).update({
    disabled: true, revokedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log('[APIKey] Revoked:', keyId);
}

/** List all API keys for a tenant (hashes redacted). */
async function listApiKeys(tenantId) {
  const snap = await db.collection('api_keys').where('tenantId', '==', tenantId).get();
  return snap.docs.map(d => ({ keyId: d.id, ...d.data(), secretHash: undefined }));
}

module.exports = { hashApiKey, generateApiKey, checkApiKeyRateLimit, createApiKey, revokeApiKey, listApiKeys };
