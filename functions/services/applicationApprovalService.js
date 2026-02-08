// Application Approval Service – admin approve/reject workflows (transactional)

const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { APPLICATION_STATUS } = require('./applicationValidation');

const db = admin.firestore();

/** Approve application: creates kreator, magic link (TRANSACTIONAL) */
async function approveApplication(applicationId, adminUid, notes = '') {
  const kreatorService = require('./kreatorService');

  return db.runTransaction(async (transaction) => {
    // 1. Read application
    const appRef = db.collection('kreator_applications').doc(applicationId);
    const appDoc = await transaction.get(appRef);
    if (!appDoc.exists) {
      const error = new Error('Application not found');
      error.code = 'NOT_FOUND';
      throw error;
    }
    const appData = appDoc.data();

    // 2. Validate state
    if (appData.status !== APPLICATION_STATUS.PENDING) {
      const error = new Error(`Application is already ${appData.status}`);
      error.code = 'INVALID_STATUS';
      error.currentStatus = appData.status;
      throw error;
    }

    // 3. Check expiry
    const expiresAt = appData.expiresAt?.toDate ? appData.expiresAt.toDate() : new Date(appData.expiresAt);
    if (expiresAt < new Date()) {
      const error = new Error('Application has expired');
      error.code = 'EXPIRED';
      throw error;
    }

    // 4. Create Firebase Auth user
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: appData.email,
        displayName: appData.displayName,
        emailVerified: false
      });
    } catch (authError) {
      if (authError.code === 'auth/email-already-exists') {
        userRecord = await admin.auth().getUserByEmail(appData.email);
      } else {
        throw authError;
      }
    }

    // 5. Create kreator document
    const kreatorRef = db.collection('kreators').doc(userRecord.uid);
    transaction.set(kreatorRef, {
      uid: userRecord.uid,
      email: appData.email,
      firstName: appData.firstName,
      lastName: appData.lastName,
      displayName: appData.displayName,
      brandName: appData.businessName || appData.brandName,
      businessName: appData.businessName,
      businessType: appData.businessType,
      phone: appData.phone,
      website: appData.website,
      productCategories: appData.productCategories,
      location: appData.location,
      avatarUrl: null,
      bio: appData.productDescription || null,
      authProviders: [],
      passwordSetAt: null,
      googleConnectedAt: null,
      status: 'pending_password',
      verificationStatus: 'pending',
      permissions: [
        'products:create', 'products:read', 'products:update',
        'orders:read', 'analytics:read'
      ],
      plan: 'kreator-free',
      planLimits: { productsAllowed: 50, monthlyOrders: 100 },
      stats: { totalProducts: 0, totalOrders: 0, totalRevenue: 0, lastProductCreatedAt: null },
      applicationId,
      approvedBy: adminUid,
      approvedAt: FieldValue.serverTimestamp(),
      consent: appData.consent,
      locale: appData.locale,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastLoginAt: null,
      lastActivityAt: null,
      deletedAt: null,
      deletedBy: null
    });

    // 6. Generate magic link
    const { token, hash, salt, expiresAt: linkExpiresAt } = kreatorService.generateMagicLinkToken();

    // 7. Create magic link document
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
        targetEmail: appData.email,
        targetKreatorId: userRecord.uid,
        applicationId,
        singleUse: true,
        usedAt: null,
        usedFromIp: null,
        usedUserAgent: null,
        createdByAdmin: adminUid
      },
      title: 'Kreator Onboarding Link',
      description: `One-time login link for ${appData.email}`,
      expiresAt: Timestamp.fromDate(linkExpiresAt),
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

    // 8. Update application status
    transaction.update(appRef, {
      status: APPLICATION_STATUS.APPROVED,
      reviewedBy: adminUid,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewNotes: notes,
      kreatorId: userRecord.uid,
      magicLinkCode: token.code,
      updatedAt: FieldValue.serverTimestamp()
    });

    // 9. Audit log
    const auditRef = db.collection('admin_audit_logs').doc();
    transaction.set(auditRef, {
      action: 'kreator.application.approved',
      resourceType: 'kreator_application',
      resourceId: applicationId,
      actorUid: adminUid,
      before: { status: APPLICATION_STATUS.PENDING },
      after: { status: APPLICATION_STATUS.APPROVED, kreatorId: userRecord.uid, magicLinkCode: token.code },
      metadata: { notes, kreatorEmail: appData.email },
      ipAddress: null,
      userAgent: null,
      timestamp: FieldValue.serverTimestamp()
    });

    console.log(`[KreatorApp] ✅ Application approved: ${applicationId} → Kreator: ${userRecord.uid}`);

    return {
      success: true,
      applicationId,
      kreatorId: userRecord.uid,
      kreatorEmail: appData.email,
      magicLinkCode: token.code,
      magicLinkUrl: `https://kaayko.com/l/${token.code}`,
      expiresAt: linkExpiresAt.toISOString()
    };
  });
}

/** Reject application with reason (TRANSACTIONAL) */
async function rejectApplication(applicationId, adminUid, reason, notes = '') {
  if (!reason || reason.trim().length < 10) {
    const error = new Error('Rejection reason is required (minimum 10 characters)');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  return db.runTransaction(async (transaction) => {
    const appRef = db.collection('kreator_applications').doc(applicationId);
    const appDoc = await transaction.get(appRef);
    if (!appDoc.exists) {
      const error = new Error('Application not found');
      error.code = 'NOT_FOUND';
      throw error;
    }
    const appData = appDoc.data();

    if (appData.status !== APPLICATION_STATUS.PENDING) {
      const error = new Error(`Application is already ${appData.status}`);
      error.code = 'INVALID_STATUS';
      throw error;
    }

    transaction.update(appRef, {
      status: APPLICATION_STATUS.REJECTED,
      reviewedBy: adminUid,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewNotes: notes,
      rejectionReason: reason.trim(),
      updatedAt: FieldValue.serverTimestamp()
    });

    const auditRef = db.collection('admin_audit_logs').doc();
    transaction.set(auditRef, {
      action: 'kreator.application.rejected',
      resourceType: 'kreator_application',
      resourceId: applicationId,
      actorUid: adminUid,
      before: { status: APPLICATION_STATUS.PENDING },
      after: { status: APPLICATION_STATUS.REJECTED },
      metadata: { reason, notes, applicantEmail: appData.email },
      timestamp: FieldValue.serverTimestamp()
    });

    console.log(`[KreatorApp] ❌ Application rejected: ${applicationId} (${appData.email})`);

    return {
      success: true,
      applicationId,
      email: appData.email,
      status: APPLICATION_STATUS.REJECTED
    };
  });
}

module.exports = {
  approveApplication,
  rejectApplication
};
