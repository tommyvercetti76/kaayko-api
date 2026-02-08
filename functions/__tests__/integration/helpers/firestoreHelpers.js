/**
 * Firestore Emulator Helpers
 *
 * Utilities for seeding, clearing, and verifying Firestore data in integration tests.
 * All operations use the REAL firebase-admin SDK against the emulator.
 */

const admin = require('firebase-admin');

// Initialize once — idempotent
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'kaaykostore' });
}

const db = admin.firestore();

// ─── Collections used across the codebase ──────────────────────────
const ALL_COLLECTIONS = [
  'payment_intents', 'orders', 'mail',
  'short_links', 'link_analytics', 'click_events', 'install_events', 'custom_events',
  'webhook_subscriptions', 'webhook_deliveries',
  'admin_users', 'admin_audit_logs',
  'kreator_applications', 'kreators', 'kaaykoproducts',
  'tenants', 'pending_tenant_registrations',
  'api_keys', 'api_key_rate_limits', 'rate_limits',
  'forecast_cache', 'unified_weather_cache', 'current_conditions_cache',
  'paddlingSpots', 'paddlingOutSpots',
  'ctx_tokens', 'security_logs', 'systemHealth', 'api_usage'
];

/**
 * Check if Firestore emulator is reachable
 */
async function isEmulatorRunning() {
  try {
    // Simple read — if emulator is up, this resolves quickly
    await db.collection('__health__').doc('ping').get();
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Clear ALL documents from specified collections (or all known collections)
 * @param {string[]} [collections] — defaults to ALL_COLLECTIONS
 */
async function clearCollections(collections = ALL_COLLECTIONS) {
  for (const name of collections) {
    const snap = await db.collection(name).limit(500).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}

/**
 * Seed a single document
 * @param {string} collection
 * @param {string} docId
 * @param {Object} data
 */
async function seedDoc(collection, docId, data) {
  await db.collection(collection).doc(docId).set(data);
}

/**
 * Seed multiple documents in a collection
 * @param {string} collection
 * @param {Object<string, Object>} docsMap — { docId: data, ... }
 */
async function seedCollection(collection, docsMap) {
  const batch = db.batch();
  for (const [id, data] of Object.entries(docsMap)) {
    batch.set(db.collection(collection).doc(id), data);
  }
  await batch.commit();
}

/**
 * Read a document back from Firestore
 * @param {string} collection
 * @param {string} docId
 * @returns {Object|null}
 */
async function getDoc(collection, docId) {
  const snap = await db.collection(collection).doc(docId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Read all documents from a collection
 * @param {string} collection
 * @returns {Object[]}
 */
async function getAllDocs(collection) {
  const snap = await db.collection(collection).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Count documents in a collection
 * @param {string} collection
 * @returns {number}
 */
async function countDocs(collection) {
  const snap = await db.collection(collection).get();
  return snap.size;
}

module.exports = {
  admin,
  db,
  ALL_COLLECTIONS,
  isEmulatorRunning,
  clearCollections,
  seedDoc,
  seedCollection,
  getDoc,
  getAllDocs,
  countDocs
};
