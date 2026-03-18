/**
 * Kreator Service
 * 
 * Core service for managing kreators (creators) in the system.
 * Handles:
 * - Kreator CRUD operations
 * - Authentication (password, Google OAuth)
 * - Magic link generation and consumption
 * - Profile management
 * 
 * @module services/kreatorService
 */

const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const crypto = require('crypto');
const { sendMagicLinkEmail } = require('./emailNotificationService');

const db = admin.firestore();

// Validate required environment variables
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET && process.env.FUNCTIONS_EMULATOR !== 'true') {
  console.error('[SECURITY] SESSION_SECRET environment variable is required in production');
}
const getSessionSecret = () => {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    return process.env.SESSION_SECRET || 'dev-only-secret-not-for-production';
  }
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable must be configured');
  }
  return process.env.SESSION_SECRET;
};

// Kreator statuses
const KREATOR_STATUS = {
  PENDING_PASSWORD: 'pending_password',  // Approved, awaiting password setup
  ACTIVE: 'active',                       // Fully active
  SUSPENDED: 'suspended',                 // Temporarily suspended
  DEACTIVATED: 'deactivated'              // Permanently deactivated
};

// Token hashing config (using scrypt for security)
const TOKEN_HASH_CONFIG = {
  keyLength: 64,
  saltLength: 32,
  scryptParams: { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
};

// Magic link expiry hours
const MAGIC_LINK_EXPIRY_HOURS = {
  onboarding: 24,
  password_reset: 1,
  login: 1
};

// Password requirements
const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
  specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?'
};

/**
 * Hash a token using scrypt
 * @param {string} plainToken 
 * @returns {Object} { hash, salt }
 */
function hashToken(plainToken) {
  const salt = crypto.randomBytes(TOKEN_HASH_CONFIG.saltLength).toString('hex');
  const hash = crypto.scryptSync(
    plainToken,
    salt,
    TOKEN_HASH_CONFIG.keyLength,
    TOKEN_HASH_CONFIG.scryptParams
  ).toString('hex');
  
  return { hash, salt };
}

/**
 * Verify a token against stored hash
 * @param {string} plainToken 
 * @param {string} storedHash 
 * @param {string} storedSalt 
 * @returns {boolean}
 */
function verifyToken(plainToken, storedHash, storedSalt) {
  try {
    const computedHash = crypto.scryptSync(
      plainToken,
      storedSalt,
      TOKEN_HASH_CONFIG.keyLength,
      TOKEN_HASH_CONFIG.scryptParams
    ).toString('hex');

    return crypto.timingSafeEqual(
      Buffer.from(computedHash, 'hex'),
      Buffer.from(storedHash, 'hex')
    );
  } catch (error) {
    console.error('[Kreator] Token verification error:', error.message);
    return false;
  }
}

/**
 * Generate magic link token with hash
 * @param {string} purpose - 'onboarding' | 'password_reset' | 'login'
 * @returns {Object} { token: { code }, hash, salt, expiresAt }
 */
function generateMagicLinkToken(purpose = 'onboarding') {
  // Generate secure random code with ml_ prefix
  const randomPart = crypto.randomBytes(12).toString('base64url').substring(0, 16);
  const code = `ml_${randomPart}`;

  // Hash the token
  const { hash, salt } = hashToken(code);

  // Calculate expiry
  const expiresAt = new Date();
  const expiryHours = MAGIC_LINK_EXPIRY_HOURS[purpose] || 24;
  expiresAt.setHours(expiresAt.getHours() + expiryHours);

  return {
    token: { code },
    hash,
    salt,
    expiresAt
  };
}

/**
 * Validate password against requirements
 * @param {string} password 
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validatePassword(password) {
  const errors = [];

  if (!password || typeof password !== 'string') {
    errors.push('Password is required');
    return { valid: false, errors };
  }

  if (password.length < PASSWORD_REQUIREMENTS.minLength) {
    errors.push(`Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`);
  }

  if (password.length > PASSWORD_REQUIREMENTS.maxLength) {
    errors.push(`Password must not exceed ${PASSWORD_REQUIREMENTS.maxLength} characters`);
  }

  if (PASSWORD_REQUIREMENTS.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (PASSWORD_REQUIREMENTS.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (PASSWORD_REQUIREMENTS.requireNumber && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (PASSWORD_REQUIREMENTS.requireSpecial) {
    const specialRegex = new RegExp(`[${PASSWORD_REQUIREMENTS.specialChars.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}]`);
    if (!specialRegex.test(password)) {
      errors.push('Password must contain at least one special character (!@#$%^&*...)');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create a session token for authenticated kreators
 * Uses a simple signed JWT format
 * @param {string} uid - Kreator UID
 * @returns {string} Session token (JWT-like)
 */
async function createSessionToken(uid) {
  const payload = {
    uid,
    role: 'kreator',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
  };
  
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', getSessionSecret())
    .update(`${header}.${body}`)
    .digest('base64url');
  
  return `${header}.${body}.${signature}`;
}

/**
 * Verify a session token
 * @param {string} token - The session token
 * @returns {Object|null} Decoded payload or null if invalid
 */
function verifySessionToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [header, body, signature] = parts;
    
    // Verify signature
    const expectedSig = crypto.createHmac('sha256', getSessionSecret())
      .update(`${header}.${body}`)
      .digest('base64url');
    
    if (signature !== expectedSig) {
      console.error('[Kreator] Invalid token signature');
      return null;
    }
    
    // Decode payload
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    
    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      console.error('[Kreator] Token expired');
      return null;
    }
    
    return payload;
  } catch (error) {
    console.error('[Kreator] Token verification error:', error.message);
    return null;
  }
}

/**
 * Get kreator by UID
 * @param {string} uid 
 * @returns {Object|null}
 */
async function getKreator(uid) {
  const doc = await db.collection('kreators').doc(uid).get();
  
  if (!doc.exists) {
    return null;
  }

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

  if (snapshot.empty) {
    return null;
  }

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
 * @returns {Object} { kreators: [], total: number }
 */
async function listKreators(filters = {}) {
  const {
    status,
    plan,
    limit = 50,
    offset = 0,
    orderBy = 'createdAt',
    orderDir = 'desc'
  } = filters;

  let query = db.collection('kreators').where('deletedAt', '==', null);

  if (status) {
    query = query.where('status', '==', status);
  }

  if (plan) {
    query = query.where('plan', '==', plan);
  }

  query = query.orderBy(orderBy, orderDir);

  // Get total count
  const countQuery = db.collection('kreators').where('deletedAt', '==', null);
  const countSnapshot = await countQuery.count().get();
  const total = countSnapshot.data().count;

  // Paginate
  const snapshot = await query.limit(limit).offset(offset).get();

  const kreators = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      uid: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString(),
      updatedAt: data.updatedAt?.toDate?.()?.toISOString()
    };
  });

  return {
    kreators,
    total,
    limit,
    offset,
    hasMore: offset + kreators.length < total
  };
}

/**
 * Validate a magic link (check if valid without consuming)
 * @param {string} code - Magic link code
 * @returns {Object} Validation result
 */
async function validateMagicLink(code) {
  try {
    const linkDoc = await db.collection('short_links').doc(code).get();

    if (!linkDoc.exists) {
      return { valid: false, reason: 'not_found' };
    }

    const link = linkDoc.data();

    // Must be a magic link
    if (link.type !== 'magic_link') {
      return { valid: false, reason: 'not_magic_link' };
    }

    // Must be enabled and not used
    if (!link.enabled || link.metadata?.usedAt) {
      return { valid: false, reason: 'already_used' };
    }

    // Must not be expired
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

/**
 * Consume magic link and set password (TRANSACTIONAL)
 * @param {string} code - Magic link code
 * @param {string} password - New password
 * @param {Object} clientInfo - IP, user agent
 * @returns {Object} Result
 */
async function consumeMagicLinkAndSetPassword(code, password, clientInfo = {}) {
  // Validate password first
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    const error = new Error('Password does not meet requirements');
    error.code = 'INVALID_PASSWORD';
    error.details = passwordValidation.errors;
    throw error;
  }

  return db.runTransaction(async (transaction) => {
    // 1. Read magic link (within transaction)
    const linkRef = db.collection('short_links').doc(code);
    const linkDoc = await transaction.get(linkRef);

    if (!linkDoc.exists) {
      const error = new Error('Magic link not found');
      error.code = 'NOT_FOUND';
      throw error;
    }

    const linkData = linkDoc.data();

    // 2. Validate magic link type
    if (linkData.type !== 'magic_link') {
      const error = new Error('Invalid link type');
      error.code = 'INVALID_LINK_TYPE';
      throw error;
    }

    // 3. Check if already used (race condition prevention)
    if (!linkData.enabled || linkData.metadata?.usedAt) {
      const error = new Error('Magic link has already been used');
      error.code = 'ALREADY_CONSUMED';
      throw error;
    }

    // 4. Check expiry
    const expiresAt = linkData.expiresAt?.toDate ? linkData.expiresAt.toDate() : new Date(linkData.expiresAt);
    if (expiresAt < new Date()) {
      const error = new Error('Magic link has expired');
      error.code = 'EXPIRED';
      throw error;
    }

    // 5. Read kreator document
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
      // If already active, this might be a duplicate attempt
      if (kreatorData.status === KREATOR_STATUS.ACTIVE) {
        const error = new Error('Account is already set up');
        error.code = 'ALREADY_SETUP';
        throw error;
      }
      const error = new Error('Account is not in valid state for setup');
      error.code = 'INVALID_KREATOR_STATUS';
      throw error;
    }

    // 7. Update Firebase Auth password
    await admin.auth().updateUser(linkData.metadata.targetKreatorId, {
      password: password,
      emailVerified: true // Mark as verified since they came via email link
    });

    // 8. Update kreator document (within transaction)
    transaction.update(kreatorRef, {
      status: KREATOR_STATUS.ACTIVE,
      authProviders: FieldValue.arrayUnion('password'),
      passwordSetAt: FieldValue.serverTimestamp(),
      verificationStatus: 'verified',
      updatedAt: FieldValue.serverTimestamp()
    });

    // 9. Mark magic link as consumed (within transaction)
    transaction.update(linkRef, {
      enabled: false,
      'metadata.usedAt': new Date().toISOString(),
      'metadata.usedFromIp': clientInfo.ip || null,
      'metadata.usedUserAgent': clientInfo.userAgent || null,
      updatedAt: FieldValue.serverTimestamp()
    });

    // 10. Create audit log
    const auditRef = db.collection('admin_audit_logs').doc();
    transaction.set(auditRef, {
      action: 'kreator.password.set',
      resourceType: 'kreator',
      resourceId: linkData.metadata.targetKreatorId,
      actorUid: linkData.metadata.targetKreatorId,
      before: { status: KREATOR_STATUS.PENDING_PASSWORD },
      after: { status: KREATOR_STATUS.ACTIVE, authProviders: ['password'] },
      metadata: {
        magicLinkCode: code,
        email: linkData.metadata.targetEmail
      },
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

  // Allowed update fields
  const allowedFields = [
    'displayName',
    'brandName',
    'bio',
    'phone',
    'website',
    'socialLinks',
    'avatarUrl'
  ];

  const updateData = {
    updatedAt: FieldValue.serverTimestamp()
  };

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      updateData[field] = updates[field];
    }
  }

  await db.collection('kreators').doc(uid).update(updateData);

  return getKreator(uid);
}

/**
 * Connect Google account to kreator
 * @param {string} kreatorUid 
 * @param {string} googleUid - Google account UID from OAuth
 * @param {Object} googleProfile - Google profile info
 * @param {Object} clientInfo
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

    // Check if Google already connected
    if (kreatorData.authProviders?.includes('google')) {
      const error = new Error('Google account is already connected');
      error.code = 'ALREADY_CONNECTED';
      throw error;
    }

    // Link Google account in Firebase Auth
    // Note: This is typically done client-side with linkWithCredential
    // Here we just update our kreator record

    transaction.update(kreatorRef, {
      authProviders: FieldValue.arrayUnion('google'),
      googleConnectedAt: FieldValue.serverTimestamp(),
      googleProfile: {
        uid: googleUid,
        email: googleProfile.email,
        displayName: googleProfile.displayName,
        photoUrl: googleProfile.photoURL
      },
      // If no avatar, use Google's
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
      metadata: {
        googleEmail: googleProfile.email
      },
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
 * Disconnect Google account from kreator
 * Requires password to be set first!
 * @param {string} kreatorUid 
 * @param {Object} clientInfo 
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

    // Check if Google is connected
    if (!kreatorData.authProviders?.includes('google')) {
      const error = new Error('Google account is not connected');
      error.code = 'NOT_CONNECTED';
      throw error;
    }

    // Must have password set to disconnect Google
    if (!kreatorData.authProviders?.includes('password')) {
      const error = new Error('You must set a password before disconnecting Google');
      error.code = 'PASSWORD_REQUIRED';
      throw error;
    }

    // Remove Google from providers
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

/**
 * Update last login timestamp
 * @param {string} uid 
 */
async function updateLastLogin(uid) {
  await db.collection('kreators').doc(uid).update({
    lastLoginAt: FieldValue.serverTimestamp(),
    lastActivityAt: FieldValue.serverTimestamp()
  });
}

/**
 * Get kreator stats
 */
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

/**
 * Resend magic link for kreator
 * @param {string} applicationId or kreatorId
 * @param {string} adminUid 
 */
async function resendMagicLink(kreatorId, adminUid) {
  const result = await db.runTransaction(async (transaction) => {
    const kreatorRef = db.collection('kreators').doc(kreatorId);
    const kreatorDoc = await transaction.get(kreatorRef);

    if (!kreatorDoc.exists) {
      const error = new Error('Kreator not found');
      error.code = 'NOT_FOUND';
      throw error;
    }

    const kreatorData = kreatorDoc.data();

    // Only resend for pending_password status
    if (kreatorData.status !== KREATOR_STATUS.PENDING_PASSWORD) {
      const error = new Error(`Cannot resend magic link for kreator in '${kreatorData.status}' status`);
      error.code = 'INVALID_STATUS';
      throw error;
    }

    // Disable any existing magic links for this kreator
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

    // Update application with new magic link code
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
      firstName: kreatorData.firstName,
      magicLinkCode: token.code,
      magicLinkUrl: `https://kaayko.com/l/${token.code}`,
      expiresAt: expiresAt.toISOString()
    };
  });

  // Send resend email (non-blocking on failure)
  sendMagicLinkEmail({
    email: result.email,
    firstName: result.firstName,
    magicLinkUrl: result.magicLinkUrl,
    expiresAt: result.expiresAt,
    isResend: true
  }).catch(err => {
    console.error(`[Kreator] ⚠️ Failed to send resend email to ${result.email}:`, err.message);
  });

  return result;
}

module.exports = {
  // Constants
  KREATOR_STATUS,
  PASSWORD_REQUIREMENTS,
  MAGIC_LINK_EXPIRY_HOURS,

  // Token utilities
  hashToken,
  verifyToken,
  generateMagicLinkToken,
  validatePassword,
  createSessionToken,
  verifySessionToken,

  // CRUD
  getKreator,
  getKreatorByEmail,
  listKreators,
  updateKreatorProfile,

  // Magic links
  validateMagicLink,
  consumeMagicLinkAndSetPassword,
  resendMagicLink,

  // OAuth
  connectGoogleAccount,
  disconnectGoogleAccount,

  // Activity
  updateLastLogin,

  // Stats
  getKreatorStats
};
