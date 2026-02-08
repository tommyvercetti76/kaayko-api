/**
 * Kreator Application Service
 *
 * Submit, query, and stats for kreator applications.
 * Re-exports validation + approval sub-modules so consumers use a single import.
 *
 * @module services/kreatorApplicationService
 */

const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

// Sub-modules (re-exported below)
const validation = require('./applicationValidation');
const approval = require('./applicationApprovalService');

const {
  APPLICATION_STATUS,
  APPLICATION_EXPIRY_DAYS,
  validateApplication,
  generateApplicationId
} = validation;

const db = admin.firestore();

// ── Submit ───────────────────────────────────────────────────────────

/** Submit a new kreator application */
async function submitApplication(data, clientInfo = {}) {
  const result = validateApplication(data);
  if (!result.valid) {
    const error = new Error('Validation failed');
    error.code = 'VALIDATION_ERROR';
    error.details = result.errors;
    throw error;
  }

  // Check for existing pending/approved application
  const existing = await db.collection('kreator_applications')
    .where('email', '==', data.email.toLowerCase().trim())
    .where('status', 'in', [APPLICATION_STATUS.PENDING, APPLICATION_STATUS.APPROVED])
    .limit(1)
    .get();

  if (!existing.empty) {
    const ex = existing.docs[0].data();
    const error = new Error(
      ex.status === APPLICATION_STATUS.PENDING
        ? 'An application with this email is already pending review'
        : 'This email is already associated with an approved kreator'
    );
    error.code = 'DUPLICATE_APPLICATION';
    error.existingStatus = ex.status;
    throw error;
  }

  const applicationId = generateApplicationId();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + APPLICATION_EXPIRY_DAYS);

  const application = {
    id: applicationId,
    applicationType: 'seller',
    firstName: data.firstName.trim(),
    lastName: data.lastName.trim(),
    displayName: `${data.firstName.trim()} ${data.lastName.trim()}`,
    email: data.email.toLowerCase().trim(),
    phone: data.phone.trim(),
    businessName: data.businessName.trim(),
    brandName: data.businessName.trim(),
    businessType: data.businessType,
    website: data.website || null,
    productCategories: data.productCategories,
    productDescription: data.productDescription.trim(),
    productCount: data.productCount,
    priceRange: data.priceRange,
    location: data.location.trim(),
    shippingCapability: data.shippingCapability,
    fulfillmentTime: data.fulfillmentTime,
    inventoryManagement: data.inventoryManagement,
    socialMedia: data.socialMedia || null,
    referralSource: data.referralSource || null,
    additionalInfo: data.additionalInfo || null,
    consent: {
      termsAccepted: true,
      authenticityConfirmed: true,
      dataProcessingConsent: true,
      consentTimestamp: new Date().toISOString()
    },
    locale: data.locale || 'en-US',
    status: APPLICATION_STATUS.PENDING,
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    rejectionReason: null,
    kreatorId: null,
    magicLinkCode: null,
    submittedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt),
    submittedFromIp: clientInfo.ip || null,
    submittedUserAgent: clientInfo.userAgent || null
  };

  await db.collection('kreator_applications').doc(applicationId).set(application);
  console.log(`[KreatorApp] ✅ Application submitted: ${applicationId} (${data.email})`);

  return {
    success: true,
    applicationId,
    email: data.email.toLowerCase().trim(),
    status: APPLICATION_STATUS.PENDING,
    expiresAt: expiresAt.toISOString()
  };
}

// ── Query ────────────────────────────────────────────────────────────

async function getApplication(applicationId) {
  const doc = await db.collection('kreator_applications').doc(applicationId).get();
  if (!doc.exists) return null;
  const d = doc.data();
  return {
    id: doc.id, ...d,
    submittedAt: d.submittedAt?.toDate?.()?.toISOString(),
    updatedAt: d.updatedAt?.toDate?.()?.toISOString(),
    expiresAt: d.expiresAt?.toDate?.()?.toISOString(),
    reviewedAt: d.reviewedAt?.toDate?.()?.toISOString()
  };
}

async function getApplicationStatus(email, applicationId) {
  const doc = await db.collection('kreator_applications').doc(applicationId).get();
  if (!doc.exists) return null;
  const d = doc.data();
  if (d.email !== email.toLowerCase().trim()) return null;
  return {
    id: doc.id, status: d.status,
    submittedAt: d.submittedAt?.toDate?.()?.toISOString(),
    reviewedAt: d.reviewedAt?.toDate?.()?.toISOString() || null,
    rejectionReason: d.status === APPLICATION_STATUS.REJECTED ? d.rejectionReason : null
  };
}

async function listApplications(filters = {}) {
  const { status, email, limit = 50, offset = 0, orderBy = 'submittedAt', orderDir = 'desc' } = filters;
  let query = db.collection('kreator_applications');
  let countQuery = db.collection('kreator_applications');
  if (status) { query = query.where('status', '==', status); countQuery = countQuery.where('status', '==', status); }
  if (email) { const e = email.toLowerCase().trim(); query = query.where('email', '==', e); countQuery = countQuery.where('email', '==', e); }
  query = query.orderBy(orderBy, orderDir);

  const total = (await countQuery.count().get()).data().count;
  if (offset > 0) {
    const off = await query.limit(offset).get();
    const last = off.docs[off.docs.length - 1];
    if (last) query = query.startAfter(last);
  }
  const snapshot = await query.limit(limit).get();
  const applications = snapshot.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id, ...d, createdAt: d.submittedAt,
      submittedAt: d.submittedAt?.toDate?.()?.toISOString(),
      updatedAt: d.updatedAt?.toDate?.()?.toISOString(),
      expiresAt: d.expiresAt?.toDate?.()?.toISOString(),
      reviewedAt: d.reviewedAt?.toDate?.()?.toISOString()
    };
  });
  return { applications, total, limit, offset, hasMore: offset + applications.length < total };
}

// ── Stats ────────────────────────────────────────────────────────────

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

// ── Re-exports ───────────────────────────────────────────────────────

module.exports = {
  ...validation,
  ...approval,
  submitApplication,
  getApplication,
  getApplicationStatus,
  listApplications,
  getApplicationStats
};
