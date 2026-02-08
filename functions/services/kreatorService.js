/**
 * Kreator Service
 *
 * CRUD operations, profile management, and stats for kreators.
 * Re-exports all kreator sub-modules so consumers use a single import.
 *
 * Sub-modules:
 *   kreatorCrypto          – token/password utilities
 *   kreatorOnboardingService – magic link lifecycle
 *   kreatorOAuthService     – Google OAuth connect/disconnect
 *
 * @module services/kreatorService
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

// Sub-modules (re-exported below)
const kreatorCrypto = require('./kreatorCrypto');
const kreatorOnboarding = require('./kreatorOnboardingService');
const kreatorOAuth = require('./kreatorOAuthService');

const { KREATOR_STATUS } = kreatorCrypto;
const db = admin.firestore();

// ── CRUD ─────────────────────────────────────────────────────────────

/**
 * Get kreator by UID
 * @param {string} uid
 * @returns {Object|null}
 */
async function getKreator(uid) {
  const doc = await db.collection('kreators').doc(uid).get();
  if (!doc.exists) return null;

  const data = doc.data();
  return {
    uid: doc.id,
    ...data,
    createdAt: data.createdAt?.toDate?.()?.toISOString(),
    updatedAt: data.updatedAt?.toDate?.()?.toISOString(),
    approvedAt: data.approvedAt?.toDate?.()?.toISOString(),
    passwordSetAt: data.passwordSetAt?.toDate?.()?.toISOString(),
    googleConnectedAt: data.googleConnectedAt?.toDate?.()?.toISOString(),
    lastLoginAt: data.lastLoginAt?.toDate?.()?.toISOString(),
    lastActivityAt: data.lastActivityAt?.toDate?.()?.toISOString()
  };
}

/**
 * Get kreator by email
 * @param {string} email 
 * @returns {Object|null}
 */
async function getKreatorByEmail(email) {
  const snapshot = await db.collection('kreators')
    .where('email', '==', email.toLowerCase().trim())
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const data = doc.data();
  return {
    uid: doc.id,
    ...data,
    createdAt: data.createdAt?.toDate?.()?.toISOString(),
    updatedAt: data.updatedAt?.toDate?.()?.toISOString()
  };
}

/**
 * List kreators with filters (admin)
 * @param {Object} filters
 * @returns {Object} { kreators, total, limit, offset, hasMore }
 */
async function listKreators(filters = {}) {
  const {
    status, plan,
    limit = 50, offset = 0,
    orderBy = 'createdAt', orderDir = 'desc'
  } = filters;

  let query = db.collection('kreators').where('deletedAt', '==', null);
  if (status) query = query.where('status', '==', status);
  if (plan) query = query.where('plan', '==', plan);
  query = query.orderBy(orderBy, orderDir);

  const countSnapshot = await db.collection('kreators')
    .where('deletedAt', '==', null).count().get();
  const total = countSnapshot.data().count;

  const snapshot = await query.limit(limit).offset(offset).get();
  const kreators = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      uid: doc.id, ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString(),
      updatedAt: data.updatedAt?.toDate?.()?.toISOString()
    };
  });

  return { kreators, total, limit, offset, hasMore: offset + kreators.length < total };
}

// ── Profile ──────────────────────────────────────────────────────────

const ALLOWED_PROFILE_FIELDS = [
  'displayName', 'brandName', 'bio', 'phone',
  'website', 'socialLinks', 'avatarUrl'
];

/**
 * Update kreator profile
 * @param {string} uid
 * @param {Object} updates
 * @returns {Object} Updated kreator
 */
async function updateKreatorProfile(uid, updates) {
  const kreator = await getKreator(uid);
  if (!kreator) {
    const error = new Error('Kreator not found');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const updateData = { updatedAt: FieldValue.serverTimestamp() };
  for (const field of ALLOWED_PROFILE_FIELDS) {
    if (updates[field] !== undefined) updateData[field] = updates[field];
  }

  await db.collection('kreators').doc(uid).update(updateData);
  return getKreator(uid);
}

// ── Activity / Stats ─────────────────────────────────────────────────

async function updateLastLogin(uid) {
  await db.collection('kreators').doc(uid).update({
    lastLoginAt: FieldValue.serverTimestamp(),
    lastActivityAt: FieldValue.serverTimestamp()
  });
}

async function getKreatorStats() {
  const [active, pending, suspended, total] = await Promise.all([
    db.collection('kreators').where('status', '==', KREATOR_STATUS.ACTIVE).count().get(),
    db.collection('kreators').where('status', '==', KREATOR_STATUS.PENDING_PASSWORD).count().get(),
    db.collection('kreators').where('status', '==', KREATOR_STATUS.SUSPENDED).count().get(),
    db.collection('kreators').where('deletedAt', '==', null).count().get()
  ]);

  return {
    active: active.data().count,
    pendingPassword: pending.data().count,
    suspended: suspended.data().count,
    total: total.data().count,
    calculatedAt: new Date().toISOString()
  };
}

// ── Re-exports ───────────────────────────────────────────────────────
// Consumers keep using: const kreatorService = require('./kreatorService')

module.exports = {
  // Constants (from kreatorCrypto)
  ...kreatorCrypto,

  // Onboarding (from kreatorOnboardingService)
  ...kreatorOnboarding,

  // OAuth (from kreatorOAuthService)
  ...kreatorOAuth,

  // CRUD (this file)
  getKreator,
  getKreatorByEmail,
  listKreators,
  updateKreatorProfile,

  // Activity (this file)
  updateLastLogin,
  getKreatorStats
};
