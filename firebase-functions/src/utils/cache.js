// File: functions/src/utils/cache.js

const admin = require('firebase-admin');

// Initialize Firestore if not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// In-memory cache as first layer (fastest)
const memoryCache = new Map();

/**
 * Store a value with TTL in both memory and Firestore
 * @param {string} key
 * @param {*} value
 * @param {number} ttlSeconds
 */
async function set(key, value, ttlSeconds) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const cacheData = { value, expiresAt, createdAt: Date.now() };
  
  // Store in memory cache (fastest access)
  memoryCache.set(key, cacheData);
  
  // Store in Firestore (persistent across cold starts)
  try {
    await db.collection('cache').doc(key).set({
      data: value,
      expiresAt: new Date(expiresAt),
      createdAt: new Date()
    });
  } catch (error) {
    console.warn('Failed to store in persistent cache:', error);
    // Continue with memory cache only
  }
}

/**
 * Retrieve a value if not expired (check memory first, then Firestore)
 * @param {string} key
 * @returns {*} value or null
 */
async function get(key) {
  const now = Date.now();
  
  // Check memory cache first (fastest)
  const memoryEntry = memoryCache.get(key);
  if (memoryEntry) {
    if (now <= memoryEntry.expiresAt) {
      return memoryEntry.value;
    } else {
      memoryCache.delete(key);
    }
  }
  
  // Check Firestore cache (persistent)
  try {
    const doc = await db.collection('cache').doc(key).get();
    if (doc.exists) {
      const data = doc.data();
      const expiresAt = data.expiresAt.toMillis();
      
      if (now <= expiresAt) {
        // Cache hit - restore to memory and return
        const cacheData = { value: data.data, expiresAt, createdAt: data.createdAt.toMillis() };
        memoryCache.set(key, cacheData);
        return data.data;
      } else {
        // Expired - clean up
        await doc.ref.delete();
      }
    }
  } catch (error) {
    console.warn('Failed to read from persistent cache:', error);
  }
  
  return null;
}

/**
 * Synchronous get for memory cache only (for backward compatibility)
 * @param {string} key
 * @returns {*} value or null
 */
function getSync(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Clean up expired entries (run periodically)
 */
async function cleanup() {
  try {
    const now = new Date();
    const snapshot = await db.collection('cache')
      .where('expiresAt', '<', now)
      .limit(100)
      .get();
    
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    
    if (!snapshot.empty) {
      await batch.commit();
      console.log(`Cleaned up ${snapshot.size} expired cache entries`);
    }
  } catch (error) {
    console.warn('Cache cleanup failed:', error);
  }
}

module.exports = { get, set, getSync, cleanup };