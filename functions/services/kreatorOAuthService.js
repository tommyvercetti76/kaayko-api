/**
 * Kreator OAuth Service
 *
 * Google account linking: connect and disconnect.
 * All operations are transactional with audit logging.
 *
 * @module services/kreatorOAuthService
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const db = admin.firestore();

/**
 * Connect Google account to kreator
 * @param {string} kreatorUid
 * @param {string} googleUid - Google account UID from OAuth
 * @param {Object} googleProfile - { email, displayName, photoURL }
 * @param {Object} clientInfo - { ip, userAgent }
 * @returns {Object} Result with updated authProviders
 */
async function connectGoogleAccount(kreatorUid, googleUid, googleProfile, clientInfo = {}) {
  return db.runTransaction(async (transaction) => {
    const kreatorRef = db.collection('kreators').doc(kreatorUid);
    const kreatorDoc = await transaction.get(kreatorRef);

    if (!kreatorDoc.exists) {
      const error = new Error('Kreator not found');
      error.code = 'NOT_FOUND';
      throw error;
    }
    const kreatorData = kreatorDoc.data();

    if (kreatorData.authProviders?.includes('google')) {
      const error = new Error('Google account is already connected');
      error.code = 'ALREADY_CONNECTED';
      throw error;
    }

    transaction.update(kreatorRef, {
      authProviders: FieldValue.arrayUnion('google'),
      googleConnectedAt: FieldValue.serverTimestamp(),
      googleProfile: {
        uid: googleUid,
        email: googleProfile.email,
        displayName: googleProfile.displayName,
        photoUrl: googleProfile.photoURL
      },
      avatarUrl: kreatorData.avatarUrl || googleProfile.photoURL,
      updatedAt: FieldValue.serverTimestamp()
    });

    // Audit log
    const auditRef = db.collection('admin_audit_logs').doc();
    transaction.set(auditRef, {
      action: 'kreator.google.connected',
      resourceType: 'kreator',
      resourceId: kreatorUid,
      actorUid: kreatorUid,
      before: { authProviders: kreatorData.authProviders || [] },
      after: { authProviders: [...(kreatorData.authProviders || []), 'google'] },
      metadata: { googleEmail: googleProfile.email },
      ipAddress: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      timestamp: FieldValue.serverTimestamp()
    });

    console.log(`[Kreator] ✅ Google connected for: ${kreatorUid}`);

    return {
      success: true,
      kreatorId: kreatorUid,
      authProviders: [...(kreatorData.authProviders || []), 'google']
    };
  });
}

/**
 * Disconnect Google account from kreator (requires password set first)
 * @param {string} kreatorUid
 * @param {Object} clientInfo - { ip, userAgent }
 * @returns {Object} Result with updated authProviders
 */
async function disconnectGoogleAccount(kreatorUid, clientInfo = {}) {
  return db.runTransaction(async (transaction) => {
    const kreatorRef = db.collection('kreators').doc(kreatorUid);
    const kreatorDoc = await transaction.get(kreatorRef);

    if (!kreatorDoc.exists) {
      const error = new Error('Kreator not found');
      error.code = 'NOT_FOUND';
      throw error;
    }
    const kreatorData = kreatorDoc.data();

    if (!kreatorData.authProviders?.includes('google')) {
      const error = new Error('Google account is not connected');
      error.code = 'NOT_CONNECTED';
      throw error;
    }

    if (!kreatorData.authProviders?.includes('password')) {
      const error = new Error('You must set a password before disconnecting Google');
      error.code = 'PASSWORD_REQUIRED';
      throw error;
    }

    const newProviders = kreatorData.authProviders.filter(p => p !== 'google');

    transaction.update(kreatorRef, {
      authProviders: newProviders,
      googleConnectedAt: null,
      googleProfile: null,
      updatedAt: FieldValue.serverTimestamp()
    });

    // Audit log
    const auditRef = db.collection('admin_audit_logs').doc();
    transaction.set(auditRef, {
      action: 'kreator.google.disconnected',
      resourceType: 'kreator',
      resourceId: kreatorUid,
      actorUid: kreatorUid,
      before: { authProviders: kreatorData.authProviders },
      after: { authProviders: newProviders },
      metadata: {},
      ipAddress: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      timestamp: FieldValue.serverTimestamp()
    });

    console.log(`[Kreator] ✅ Google disconnected for: ${kreatorUid}`);

    return {
      success: true,
      kreatorId: kreatorUid,
      authProviders: newProviders
    };
  });
}

module.exports = {
  connectGoogleAccount,
  disconnectGoogleAccount
};
