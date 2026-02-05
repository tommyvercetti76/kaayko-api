/**
 * Kreator Application Service
 * 
 * Manages the kreator application lifecycle:
 * - Submit applications (public)
 * - Admin review (approve/reject)
 * - Status tracking
 * - Application expiry
 * 
 * @module services/kreatorApplicationService
 */

const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const crypto = require('crypto');

const db = admin.firestore();

// Application statuses
const APPLICATION_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired'
};

// Application expiry (30 days)
const APPLICATION_EXPIRY_DAYS = 30;

/**
 * Generate a unique application ID
 * Format: app_XXXXXXXXXX (10 random chars)
 */
function generateApplicationId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'app_';
  for (let i = 0; i < 10; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// Valid product/service categories for Kaayko Store
const VALID_PRODUCT_CATEGORIES = [
  'apparel', 'souvenirs', 'coaching', 'consulting', 
  'digital', 'art', 'fitness', 'sports', 'courses', 'other'
];

// Valid business types
const VALID_BUSINESS_TYPES = [
  'sole_proprietor', 'llc', 'corporation', 
  'partnership', 'individual_maker', 'manufacturer'
];

/**
 * Validate seller application data
 * @param {Object} data - Application data
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateApplication(data) {
  const errors = [];

  // === PERSONAL INFO ===
  if (!data.firstName || typeof data.firstName !== 'string' || data.firstName.trim().length < 1) {
    errors.push('First name is required');
  }
  
  if (!data.lastName || typeof data.lastName !== 'string' || data.lastName.trim().length < 1) {
    errors.push('Last name is required');
  }

  if (!data.email || typeof data.email !== 'string') {
    errors.push('Email is required');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.push('Invalid email format');
  }

  if (!data.phone || typeof data.phone !== 'string') {
    errors.push('Phone number is required');
  } else if (!/^\+?[\d\s\-()]{7,20}$/.test(data.phone)) {
    errors.push('Invalid phone number format');
  }

  // === BUSINESS INFO ===
  if (!data.businessName || typeof data.businessName !== 'string' || data.businessName.trim().length < 2) {
    errors.push('Business/Brand name is required (minimum 2 characters)');
  }

  if (!data.businessType || !VALID_BUSINESS_TYPES.includes(data.businessType)) {
    errors.push('Valid business type is required');
  }

  if (data.website) {
    try {
      new URL(data.website);
    } catch {
      errors.push('Invalid website URL format');
    }
  }

  // === PRODUCT INFO ===
  if (!data.productCategories || !Array.isArray(data.productCategories) || data.productCategories.length === 0) {
    errors.push('At least one product category is required');
  } else {
    const invalidCategories = data.productCategories.filter(c => !VALID_PRODUCT_CATEGORIES.includes(c));
    if (invalidCategories.length > 0) {
      errors.push(`Invalid product categories: ${invalidCategories.join(', ')}`);
    }
  }

  if (!data.productDescription || typeof data.productDescription !== 'string') {
    errors.push('Product description is required');
  } else if (data.productDescription.length < 50) {
    errors.push('Product description must be at least 50 characters');
  } else if (data.productDescription.length > 2000) {
    errors.push('Product description must not exceed 2000 characters');
  }

  if (!data.productCount) {
    errors.push('Product count range is required');
  }

  if (!data.priceRange) {
    errors.push('Price range is required');
  }

  // === OPERATIONS INFO ===
  if (!data.location || typeof data.location !== 'string' || data.location.trim().length < 3) {
    errors.push('Business location is required');
  }

  if (!data.shippingCapability) {
    errors.push('Shipping capability is required');
  }

  if (!data.fulfillmentTime) {
    errors.push('Fulfillment time is required');
  }

  if (!data.inventoryManagement) {
    errors.push('Inventory management approach is required');
  }

  // === AGREEMENTS ===
  if (!data.agreedToTerms) {
    errors.push('You must agree to the Seller Terms & Conditions');
  }

  if (!data.confirmedAuthenticity) {
    errors.push('You must confirm product authenticity');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Submit a new kreator application
 * @param {Object} data - Application data
 * @param {Object} clientInfo - Client metadata (IP, user agent)
 * @returns {Object} Created application
 */
async function submitApplication(data, clientInfo = {}) {
  // Validate input
  const validation = validateApplication(data);
  if (!validation.valid) {
    const error = new Error('Validation failed');
    error.code = 'VALIDATION_ERROR';
    error.details = validation.errors;
    throw error;
  }

  // Check for existing pending/approved application with same email
  const existingQuery = await db.collection('kreator_applications')
    .where('email', '==', data.email.toLowerCase().trim())
    .where('status', 'in', [APPLICATION_STATUS.PENDING, APPLICATION_STATUS.APPROVED])
    .limit(1)
    .get();

  if (!existingQuery.empty) {
    const existing = existingQuery.docs[0].data();
    const error = new Error(
      existing.status === APPLICATION_STATUS.PENDING
        ? 'An application with this email is already pending review'
        : 'This email is already associated with an approved kreator'
    );
    error.code = 'DUPLICATE_APPLICATION';
    error.existingStatus = existing.status;
    throw error;
  }

  // Generate unique application ID
  const applicationId = generateApplicationId();

  // Calculate expiry date
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + APPLICATION_EXPIRY_DAYS);

  // Build seller application document
  const application = {
    id: applicationId,
    applicationType: 'seller', // Explicitly mark as seller application
    
    // === PERSONAL INFO ===
    firstName: data.firstName.trim(),
    lastName: data.lastName.trim(),
    displayName: `${data.firstName.trim()} ${data.lastName.trim()}`, // For backwards compatibility
    email: data.email.toLowerCase().trim(),
    phone: data.phone.trim(),
    
    // === BUSINESS INFO ===
    businessName: data.businessName.trim(),
    businessType: data.businessType,
    website: data.website?.trim() || null,
    
    // === PRODUCT INFO ===
    productCategories: data.productCategories,
    productCount: data.productCount,
    priceRange: data.priceRange,
    productDescription: data.productDescription.trim(),
    
    // === OPERATIONS INFO ===
    location: data.location.trim(),
    shippingCapability: data.shippingCapability,
    fulfillmentTime: data.fulfillmentTime,
    inventoryManagement: data.inventoryManagement,
    yearsInBusiness: data.yearsInBusiness || null,
    otherPlatforms: data.otherPlatforms?.trim() || null,
    
    // === ADDITIONAL INFO ===
    hearAboutUs: data.hearAboutUs || null,
    additionalInfo: data.additionalInfo?.trim() || null,
    
    // === AGREEMENTS ===
    agreedToTerms: data.agreedToTerms === true,
    confirmedAuthenticity: data.confirmedAuthenticity === true,
    agreementTimestamp: new Date().toISOString(),
    
    // === STATUS TRACKING ===
    status: APPLICATION_STATUS.PENDING,
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    rejectionReason: null,
    kreatorId: null,
    magicLinkCode: null,
    
    // Metadata
    source: data.source || 'website',
    referredBy: data.referredBy || null,
    
    // Consent & Compliance (derived from agreements)
    consent: {
      dataProcessing: true, // Implied by agreeing to terms
      sellerTerms: data.agreedToTerms === true,
      authenticityConfirmed: data.confirmedAuthenticity === true,
      marketingEmails: data.marketingEmails || false,
      consentTimestamp: new Date().toISOString(),
      consentIp: clientInfo.ip || null,
      consentVersion: '2.0', // Seller terms version
      region: detectRegion(clientInfo.ip)
    },
    locale: data.locale || 'en',
    
    // Client info
    ipAddress: clientInfo.ip || null,
    userAgent: clientInfo.userAgent || null,
    
    // Timestamps
    submittedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt)
  };

  // Save to Firestore
  await db.collection('kreator_applications').doc(applicationId).set(application);

  console.log(`[KreatorApp] ✅ Seller application submitted: ${applicationId} (${data.email}) - ${data.businessName}`);

  return {
    id: applicationId,
    applicationId: applicationId, // Alias for frontend compatibility
    email: application.email,
    businessName: application.businessName,
    displayName: application.displayName,
    status: APPLICATION_STATUS.PENDING,
    submittedAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    message: 'Your seller application has been submitted successfully. We will review it within 2-3 business days and contact you at ' + application.email
  };
}

/**
 * Detect region from IP address (simplified)
 * In production, use a proper IP geolocation service
 */
function detectRegion(ip) {
  // Default to 'GLOBAL' - would integrate with CloudFlare or similar
  return 'GLOBAL';
}

/**
 * Get application by ID
 * @param {string} applicationId 
 * @returns {Object|null}
 */
async function getApplication(applicationId) {
  const doc = await db.collection('kreator_applications').doc(applicationId).get();
  
  if (!doc.exists) {
    return null;
  }

  const data = doc.data();
  
  // Check if expired (and update status if needed)
  if (data.status === APPLICATION_STATUS.PENDING && data.expiresAt) {
    const expiresAt = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
    if (expiresAt < new Date()) {
      // Update status to expired
      await db.collection('kreator_applications').doc(applicationId).update({
        status: APPLICATION_STATUS.EXPIRED,
        updatedAt: FieldValue.serverTimestamp()
      });
      data.status = APPLICATION_STATUS.EXPIRED;
    }
  }

  return {
    id: doc.id,
    ...data,
    submittedAt: data.submittedAt?.toDate?.()?.toISOString() || data.submittedAt,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
    expiresAt: data.expiresAt?.toDate?.()?.toISOString() || data.expiresAt,
    reviewedAt: data.reviewedAt?.toDate?.()?.toISOString() || data.reviewedAt
  };
}

/**
 * Get application status by email (public endpoint)
 * Returns limited info for privacy
 * @param {string} email 
 * @param {string} applicationId 
 */
async function getApplicationStatus(email, applicationId) {
  const doc = await db.collection('kreator_applications').doc(applicationId).get();
  
  if (!doc.exists) {
    return null;
  }

  const data = doc.data();
  
  // Verify email matches (security check)
  if (data.email !== email.toLowerCase().trim()) {
    return null;
  }

  return {
    id: doc.id,
    status: data.status,
    submittedAt: data.submittedAt?.toDate?.()?.toISOString(),
    reviewedAt: data.reviewedAt?.toDate?.()?.toISOString() || null,
    rejectionReason: data.status === APPLICATION_STATUS.REJECTED ? data.rejectionReason : null
  };
}

/**
 * List applications with filters (admin)
 * @param {Object} filters
 * @returns {Object} { applications: [], total: number }
 */
async function listApplications(filters = {}) {
  const {
    status,
    email,
    limit = 50,
    offset = 0,
    orderBy = 'submittedAt',
    orderDir = 'desc'
  } = filters;

  let query = db.collection('kreator_applications');
  let countQuery = db.collection('kreator_applications');

  // Apply filters
  if (status) {
    query = query.where('status', '==', status);
    countQuery = countQuery.where('status', '==', status);
  }

  if (email) {
    query = query.where('email', '==', email.toLowerCase().trim());
    countQuery = countQuery.where('email', '==', email.toLowerCase().trim());
  }

  // Order and paginate
  query = query.orderBy(orderBy, orderDir);

  // Get total count (for pagination)
  const countSnapshot = await countQuery.count().get();
  const total = countSnapshot.data().count;

  // Get paginated results
  if (offset > 0) {
    const offsetSnapshot = await query.limit(offset).get();
    const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }
  }

  const snapshot = await query.limit(limit).get();

  const applications = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: data.submittedAt, // Alias for frontend compatibility
      submittedAt: data.submittedAt?.toDate?.()?.toISOString(),
      updatedAt: data.updatedAt?.toDate?.()?.toISOString(),
      expiresAt: data.expiresAt?.toDate?.()?.toISOString(),
      reviewedAt: data.reviewedAt?.toDate?.()?.toISOString()
    };
  });

  return {
    applications,
    total,
    limit,
    offset,
    hasMore: offset + applications.length < total
  };
}

/**
 * Approve application (creates kreator, magic link - TRANSACTIONAL)
 * @param {string} applicationId 
 * @param {string} adminUid - Admin who approved
 * @param {string} notes - Internal notes
 * @returns {Object} Result with kreatorId and magicLinkCode
 */
async function approveApplication(applicationId, adminUid, notes = '') {
  // Import services needed for approval
  const kreatorService = require('./kreatorService');
  
  return db.runTransaction(async (transaction) => {
    // 1. Read application (within transaction)
    const appRef = db.collection('kreator_applications').doc(applicationId);
    const appDoc = await transaction.get(appRef);

    if (!appDoc.exists) {
      const error = new Error('Application not found');
      error.code = 'NOT_FOUND';
      throw error;
    }

    const appData = appDoc.data();

    // 2. Validate state (prevent race condition - double approval)
    if (appData.status !== APPLICATION_STATUS.PENDING) {
      const error = new Error(`Application is already ${appData.status}`);
      error.code = 'INVALID_STATUS';
      error.currentStatus = appData.status;
      throw error;
    }

    // 3. Check if expired
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
        // User already exists - get their UID
        userRecord = await admin.auth().getUserByEmail(appData.email);
      } else {
        throw authError;
      }
    }

    // 5. Create kreator document (within transaction)
    const kreatorRef = db.collection('kreators').doc(userRecord.uid);
    const kreatorDoc = {
      uid: userRecord.uid,
      email: appData.email,
      firstName: appData.firstName,
      lastName: appData.lastName,
      displayName: appData.displayName,
      brandName: appData.businessName || appData.brandName, // Seller applications use businessName
      businessName: appData.businessName,
      businessType: appData.businessType,
      phone: appData.phone,
      website: appData.website,
      productCategories: appData.productCategories,
      location: appData.location,
      avatarUrl: null,
      bio: appData.productDescription || null,

      // Authentication
      authProviders: [], // Will add 'password' when they set password
      passwordSetAt: null,
      googleConnectedAt: null,

      // Status
      status: 'pending_password', // Waiting for password setup
      verificationStatus: 'pending',

      // Permissions
      permissions: [
        'products:create',
        'products:read',
        'products:update',
        'orders:read',
        'analytics:read'
      ],

      // Plan
      plan: 'kreator-free',
      planLimits: {
        productsAllowed: 50,
        monthlyOrders: 100
      },

      // Stats
      stats: {
        totalProducts: 0,
        totalOrders: 0,
        totalRevenue: 0,
        lastProductCreatedAt: null
      },

      // Origin
      applicationId,
      approvedBy: adminUid,
      approvedAt: FieldValue.serverTimestamp(),

      // Consent (inherited from application)
      consent: appData.consent,
      locale: appData.locale,

      // Timestamps
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastLoginAt: null,
      lastActivityAt: null,

      // Soft delete
      deletedAt: null,
      deletedBy: null
    };

    transaction.set(kreatorRef, kreatorDoc);

    // 6. Generate magic link token and hash
    const { token, hash, salt, expiresAt: linkExpiresAt } = kreatorService.generateMagicLinkToken();

    // 7. Create magic link in short_links collection (within transaction)
    const linkRef = db.collection('short_links').doc(token.code);
    const magicLinkDoc = {
      code: token.code,
      shortUrl: `https://kaayko.com/l/${token.code}`,
      qrCodeUrl: `https://kaayko.com/qr/${token.code}.png`,

      // Magic link metadata
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

      // Standard fields
      title: 'Kreator Onboarding Link',
      description: `One-time login link for ${appData.email}`,
      expiresAt: Timestamp.fromDate(linkExpiresAt),
      enabled: true,
      clickCount: 0,

      // Tenant
      tenantId: 'kaayko',
      tenantName: 'Kaayko',
      domain: 'kaayko.com',
      pathPrefix: '/l',

      // Audit
      createdBy: 'system',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    transaction.set(linkRef, magicLinkDoc);

    // 8. Update application status (within transaction)
    transaction.update(appRef, {
      status: APPLICATION_STATUS.APPROVED,
      reviewedBy: adminUid,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewNotes: notes,
      kreatorId: userRecord.uid,
      magicLinkCode: token.code,
      updatedAt: FieldValue.serverTimestamp()
    });

    // 9. Create audit log (within transaction)
    const auditRef = db.collection('admin_audit_logs').doc();
    transaction.set(auditRef, {
      action: 'kreator.application.approved',
      resourceType: 'kreator_application',
      resourceId: applicationId,
      actorUid: adminUid,
      before: { status: APPLICATION_STATUS.PENDING },
      after: { 
        status: APPLICATION_STATUS.APPROVED, 
        kreatorId: userRecord.uid,
        magicLinkCode: token.code
      },
      metadata: {
        notes,
        kreatorEmail: appData.email
      },
      ipAddress: null, // Set in route handler
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

/**
 * Reject application
 * @param {string} applicationId 
 * @param {string} adminUid 
 * @param {string} reason - Shown to applicant
 * @param {string} notes - Internal notes (not shown)
 */
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

    // Update application
    transaction.update(appRef, {
      status: APPLICATION_STATUS.REJECTED,
      reviewedBy: adminUid,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewNotes: notes,
      rejectionReason: reason.trim(),
      updatedAt: FieldValue.serverTimestamp()
    });

    // Create audit log
    const auditRef = db.collection('admin_audit_logs').doc();
    transaction.set(auditRef, {
      action: 'kreator.application.rejected',
      resourceType: 'kreator_application',
      resourceId: applicationId,
      actorUid: adminUid,
      before: { status: APPLICATION_STATUS.PENDING },
      after: { status: APPLICATION_STATUS.REJECTED },
      metadata: {
        reason,
        notes,
        applicantEmail: appData.email
      },
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

/**
 * Get application statistics
 */
async function getApplicationStats() {
  const [pending, approved, rejected, total] = await Promise.all([
    db.collection('kreator_applications').where('status', '==', APPLICATION_STATUS.PENDING).count().get(),
    db.collection('kreator_applications').where('status', '==', APPLICATION_STATUS.APPROVED).count().get(),
    db.collection('kreator_applications').where('status', '==', APPLICATION_STATUS.REJECTED).count().get(),
    db.collection('kreator_applications').count().get()
  ]);

  return {
    pending: pending.data().count,
    approved: approved.data().count,
    rejected: rejected.data().count,
    total: total.data().count,
    calculatedAt: new Date().toISOString()
  };
}

module.exports = {
  // Constants
  APPLICATION_STATUS,
  APPLICATION_EXPIRY_DAYS,
  
  // Validation
  validateApplication,
  
  // CRUD
  submitApplication,
  getApplication,
  getApplicationStatus,
  listApplications,
  
  // Admin actions
  approveApplication,
  rejectApplication,
  
  // Stats
  getApplicationStats
};
