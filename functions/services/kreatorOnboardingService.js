// Kreator Onboarding Service – magic link validation, consumption, resend

const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const {
  KREATOR_STATUS,
  validatePassword,
  generateMagicLinkToken
} = require('./kreatorCrypto');

const db = admin.firestore();

/** Validate a magic link (check if valid without consuming) */
async function validateMagicLink(code) {
  try {
    const linkDoc = await db.collection('short_links').doc(code).get();
    if (!linkDoc.exists) {
      return { valid: false, reason: 'not_found' };
    }

    const link = linkDoc.data();

    if (link.type !== 'magic_link') {
      return { valid: false, reason: 'not_magic_link' };
    }
    if (!link.enabled || link.metadata?.usedAt) {
      return { valid: false, reason: 'already_used' };
    }

    const expiresAt = link.expiresAt?.toDate ? link.expiresAt.toDate() : new Date(link.expiresAt);
    if (expiresAt < new Date()) {
      return { valid: false, reason: 'expired', expiredAt: expiresAt.toISOString() };
    }

    return {
      valid: true,
      email: link.metadata.targetEmail,
      purpose: link.metadata.purpose,
      kreatorId: link.metadata.targetKreatorId,
      applicationId: link.metadata.applicationId,
      expiresAt: expiresAt.toISOString()
    };
  } catch (error) {
    console.error('[Kreator] Magic link validation error:', error);
    return { valid: false, reason: 'error', message: error.message };
  }
}

/** Consume magic link and set password (TRANSACTIONAL) */
async function consumeMagicLinkAndSetPassword(code, password, clientInfo = {}) {
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    const error = new Error('Password does not meet requirements');
    error.code = 'INVALID_PASSWORD';
    error.details = passwordValidation.errors;
    throw error;
  }

  return db.runTransaction(async (transaction) => {
    // 1. Read magic link
    const linkRef = db.collection('short_links').doc(code);
    const linkDoc = await transaction.get(linkRef);

    if (!linkDoc.exists) {
      const error = new Error('Magic link not found');
      error.code = 'NOT_FOUND';
      throw error;
    }
    const linkData = linkDoc.data();

    // 2. Validate type
    if (linkData.type !== 'magic_link') {
      const error = new Error('Invalid link type');
      error.code = 'INVALID_LINK_TYPE';
      throw error;
    }

    // 3. Race condition prevention
    if (!linkData.enabled || linkData.metadata?.usedAt) {
      const error = new Error('Magic link has already been used');
      error.code = 'ALREADY_CONSUMED';
      throw error;
    }

    // 4. Expiry check
    const expiresAt = linkData.expiresAt?.toDate ? linkData.expiresAt.toDate() : new Date(linkData.expiresAt);
    if (expiresAt < new Date()) {
      const error = new Error('Magic link has expired');
      error.code = 'EXPIRED';
      throw error;
    }

    // 5. Read kreator
    const kreatorRef = db.collection('kreators').doc(linkData.metadata.targetKreatorId);
    const kreatorDoc = await transaction.get(kreatorRef);
    if (!kreatorDoc.exists) {
      const error = new Error('Kreator not found');
      error.code = 'KREATOR_NOT_FOUND';
      throw error;
    }
    const kreatorData = kreatorDoc.data();

    // 6. Validate kreator status
    if (kreatorData.status !== KREATOR_STATUS.PENDING_PASSWORD) {
      if (kreatorData.status === KREATOR_STATUS.ACTIVE) {
        const error = new Error('Account is already set up');
        error.code = 'ALREADY_SETUP';
        throw error;
      }
      const error = new Error('Account is not in valid state for setup');
      error.code = 'INVALID_KREATOR_STATUS';
      throw error;
    }

    // 7. Set Firebase Auth password
    await admin.auth().updateUser(linkData.metadata.targetKreatorId, {
      password: password,
      emailVerified: true
    });

    // 8. Update kreator
    transaction.update(kreatorRef, {
      status: KREATOR_STATUS.ACTIVE,
      authProviders: FieldValue.arrayUnion('password'),
      passwordSetAt: FieldValue.serverTimestamp(),
      verificationStatus: 'verified',
      updatedAt: FieldValue.serverTimestamp()
    });

    // 9. Mark link consumed
    transaction.update(linkRef, {
      enabled: false,
      'metadata.usedAt': new Date().toISOString(),
      'metadata.usedFromIp': clientInfo.ip || null,
      'metadata.usedUserAgent': clientInfo.userAgent || null,
      updatedAt: FieldValue.serverTimestamp()
    });

    // 10. Audit log
    const auditRef = db.collection('admin_audit_logs').doc();
    transaction.set(auditRef, {
      action: 'kreator.password.set',
      resourceType: 'kreator',
      resourceId: linkData.metadata.targetKreatorId,
      actorUid: linkData.metadata.targetKreatorId,
      before: { status: KREATOR_STATUS.PENDING_PASSWORD },
      after: { status: KREATOR_STATUS.ACTIVE, authProviders: ['password'] },
      metadata: { magicLinkCode: code, email: linkData.metadata.targetEmail },
      ipAddress: clientInfo.ip || null,
      userAgent: clientInfo.userAgent || null,
      timestamp: FieldValue.serverTimestamp()
    });

    console.log(`[Kreator] ✅ Password set for: ${linkData.metadata.targetEmail}`);

    return {
      success: true,
      kreatorId: linkData.metadata.targetKreatorId,
      email: linkData.metadata.targetEmail,
      status: KREATOR_STATUS.ACTIVE
    };
  });
}

/** Resend magic link for kreator (admin action) */
async function resendMagicLink(kreatorId, adminUid) {
  return db.runTransaction(async (transaction) => {
    const kreatorRef = db.collection('kreators').doc(kreatorId);
    const kreatorDoc = await transaction.get(kreatorRef);

    if (!kreatorDoc.exists) {
      const error = new Error('Kreator not found');
      error.code = 'NOT_FOUND';
      throw error;
    }
    const kreatorData = kreatorDoc.data();

    if (kreatorData.status !== KREATOR_STATUS.PENDING_PASSWORD) {
      const error = new Error(`Cannot resend magic link for kreator in '${kreatorData.status}' status`);
      error.code = 'INVALID_STATUS';
      throw error;
    }

    // Disable existing magic links
    const existingLinks = await db.collection('short_links')
      .where('metadata.targetKreatorId', '==', kreatorId)
      .where('type', '==', 'magic_link')
      .where('enabled', '==', true)
      .get();

    existingLinks.docs.forEach(doc => {
      transaction.update(doc.ref, {
        enabled: false,
        'metadata.supersededAt': new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp()
      });
    });

    // Generate new magic link
    const { token, hash, salt, expiresAt } = generateMagicLinkToken('onboarding');

    const linkRef = db.collection('short_links').doc(token.code);
    transaction.set(linkRef, {
      code: token.code,
      shortUrl: `https://kaayko.com/l/${token.code}`,
      qrCodeUrl: `https://kaayko.com/qr/${token.code}.png`,
      type: 'magic_link',
      tokenHash: hash,
      tokenSalt: salt,
      destinations: {
        web: `https://kaayko.com/kreator/onboarding?token=${token.code}`,
        ios: null,
        android: null
      },
      metadata: {
        purpose: 'kreator_onboarding',
        targetEmail: kreatorData.email,
        targetKreatorId: kreatorId,
        applicationId: kreatorData.applicationId,
        singleUse: true,
        usedAt: null,
        usedFromIp: null,
        usedUserAgent: null,
        createdByAdmin: adminUid,
        isResend: true,
        resendCount: (existingLinks.size || 0) + 1
      },
      title: 'Kreator Onboarding Link (Resent)',
      description: `One-time login link for ${kreatorData.email}`,
      expiresAt: Timestamp.fromDate(expiresAt),
      enabled: true,
      clickCount: 0,
      tenantId: 'kaayko',
      tenantName: 'Kaayko',
      domain: 'kaayko.com',
      pathPrefix: '/l',
      createdBy: 'system',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    // Update application
    if (kreatorData.applicationId) {
      const appRef = db.collection('kreator_applications').doc(kreatorData.applicationId);
      transaction.update(appRef, {
        magicLinkCode: token.code,
        updatedAt: FieldValue.serverTimestamp()
      });
    }

    // Audit log
    const auditRef = db.collection('admin_audit_logs').doc();
    transaction.set(auditRef, {
      action: 'kreator.magic_link.resent',
      resourceType: 'kreator',
      resourceId: kreatorId,
      actorUid: adminUid,
      metadata: {
        newMagicLinkCode: token.code,
        previousLinksDisabled: existingLinks.size,
        kreatorEmail: kreatorData.email
      },
      timestamp: FieldValue.serverTimestamp()
    });

    console.log(`[Kreator] ✅ Magic link resent for: ${kreatorData.email}`);

    return {
      success: true,
      kreatorId,
      email: kreatorData.email,
      magicLinkCode: token.code,
      magicLinkUrl: `https://kaayko.com/l/${token.code}`,
      expiresAt: expiresAt.toISOString()
    };
  });
}

module.exports = {
  validateMagicLink,
  consumeMagicLinkAndSetPassword,
  resendMagicLink
};
