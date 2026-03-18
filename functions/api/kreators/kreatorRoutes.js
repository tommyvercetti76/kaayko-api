/**
 * Kreator API Routes
 * 
 * Main router for all kreator-related endpoints.
 * Combines application, auth, and profile routes.
 * 
 * Route structure:
 * - POST   /kreators/apply              - Submit application (public)
 * - GET    /kreators/applications/:id   - Get application status (public with email)
 * - POST   /kreators/onboarding/verify  - Verify magic link
 * - POST   /kreators/onboarding/complete - Set password, activate
 * - GET    /kreators/me                 - Get current kreator profile
 * - PUT    /kreators/me                 - Update kreator profile
 * - POST   /kreators/auth/google/connect    - Connect Google account
 * - POST   /kreators/auth/google/disconnect - Disconnect Google account
 * - GET    /kreators/health             - Health check
 * - GET    /kreators/debug              - Debug info (dev only)
 * 
 * Admin routes (require admin auth):
 * - GET    /kreators/admin/applications      - List applications
 * - GET    /kreators/admin/applications/:id  - Get application details
 * - PUT    /kreators/admin/applications/:id/approve  - Approve application
 * - PUT    /kreators/admin/applications/:id/reject   - Reject application
 * - GET    /kreators/admin/list              - List all kreators
 * - GET    /kreators/admin/:uid              - Get kreator details
 * - POST   /kreators/admin/:uid/resend-link  - Resend magic link
 * - GET    /kreators/admin/stats             - Get statistics
 * 
 * @module api/kreators
 */

const express = require('express');
const router = express.Router();

// Import services
const kreatorApplicationService = require('../../services/kreatorApplicationService');
const kreatorService = require('../../services/kreatorService');

// Import middleware
const { requireAuth, requireAdmin, optionalAuthForAdmin } = require('../../middleware/authMiddleware');
const { 
  requireKreatorAuth, 
  requireActiveKreator, 
  optionalKreatorAuth,
  kreatorRateLimit,
  attachClientInfo 
} = require('../../middleware/kreatorAuthMiddleware');

// Apply client info middleware to all routes
router.use(attachClientInfo);

// Mount test routes (emulator only)
if (process.env.FUNCTIONS_EMULATOR === 'true') {
  const testRoutes = require('./testRoutes');
  router.use('/test', testRoutes);
  console.log('[Kreator] 🧪 Test routes enabled (emulator mode)');
}

// Mount product routes
const kreatorProductRoutes = require('./kreatorProductRoutes');
router.use('/products', kreatorProductRoutes);
console.log('[Kreator] 📦 Product routes mounted at /kreators/products');

// ============================================================================
// HEALTH CHECK & DEBUG
// ============================================================================

/**
 * GET /kreators/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'Kreator API v1',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: {
      public: [
        'POST /kreators/apply',
        'GET /kreators/applications/:id/status',
        'POST /kreators/onboarding/verify',
        'POST /kreators/onboarding/complete'
      ],
      authenticated: [
        'GET /kreators/me',
        'PUT /kreators/me',
        'POST /kreators/auth/google/connect',
        'POST /kreators/auth/google/disconnect'
      ],
      admin: [
        'GET /kreators/admin/applications',
        'PUT /kreators/admin/applications/:id/approve',
        'PUT /kreators/admin/applications/:id/reject',
        'GET /kreators/admin/list',
        'GET /kreators/admin/stats'
      ]
    }
  });
});

/**
 * GET /kreators/debug
 * Debug endpoint (development only)
 */
router.get('/debug', optionalKreatorAuth, (req, res) => {
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
  
  if (!isEmulator) {
    return res.status(404).json({ 
      success: false, 
      error: 'Not found',
      message: 'Debug endpoint only available in development'
    });
  }

  res.json({
    success: true,
    environment: 'emulator',
    timestamp: new Date().toISOString(),
    user: req.user || null,
    kreator: req.kreator ? {
      uid: req.kreator.uid,
      email: req.kreator.email,
      status: req.kreator.status,
      permissions: req.kreator.permissions
    } : null,
    clientInfo: req.clientInfo,
    headers: {
      authorization: req.headers.authorization ? '***present***' : 'missing',
      contentType: req.headers['content-type']
    }
  });
});

// ============================================================================
// PUBLIC ROUTES - Application Submission
// ============================================================================

/**
 * POST /kreators/apply
 * Submit a new kreator application (public, rate limited)
 */
router.post('/apply', kreatorRateLimit('apply', 5, 3600000), async (req, res) => {
  try {
    const result = await kreatorApplicationService.submitApplication(
      req.body,
      req.clientInfo
    );

    console.log(`[KreatorAPI] Application submitted: ${result.id}`);

    return res.status(201).json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[KreatorAPI] Application submission error:', error);

    if (error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Please fix the following errors',
        details: error.details,
        code: error.code
      });
    }

    if (error.code === 'DUPLICATE_APPLICATION') {
      return res.status(409).json({
        success: false,
        error: 'Duplicate Application',
        message: error.message,
        code: error.code
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to submit application. Please try again.',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * GET /kreators/applications/:id/status
 * Check application status (public, requires email verification)
 */
router.get('/applications/:id/status', kreatorRateLimit('status', 10, 60000), async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Email query parameter is required',
        code: 'EMAIL_REQUIRED'
      });
    }

    const status = await kreatorApplicationService.getApplicationStatus(email, id);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Application not found or email does not match',
        code: 'NOT_FOUND'
      });
    }

    return res.json({
      success: true,
      data: status
    });

  } catch (error) {
    console.error('[KreatorAPI] Status check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to check application status',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ============================================================================
// PUBLIC ROUTES - Onboarding (Magic Link)
// ============================================================================

/**
 * POST /kreators/onboarding/verify
 * Verify magic link token (public)
 */
router.post('/onboarding/verify', kreatorRateLimit('verify', 20, 60000), async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Token is required',
        code: 'TOKEN_REQUIRED'
      });
    }

    const result = await kreatorService.validateMagicLink(token);

    if (!result.valid) {
      const statusMap = {
        'not_found': 404,
        'already_used': 410,
        'expired': 410,
        'not_magic_link': 400
      };

      const messageMap = {
        'not_found': 'Invalid or unknown link',
        'already_used': 'This link has already been used',
        'expired': 'This link has expired',
        'not_magic_link': 'Invalid link type'
      };

      return res.status(statusMap[result.reason] || 400).json({
        success: false,
        error: 'Invalid Link',
        message: messageMap[result.reason] || 'Link validation failed',
        code: `MAGIC_LINK_${result.reason.toUpperCase()}`,
        reason: result.reason
      });
    }

    return res.json({
      success: true,
      data: {
        email: result.email,
        purpose: result.purpose,
        expiresAt: result.expiresAt
      }
    });

  } catch (error) {
    console.error('[KreatorAPI] Magic link verify error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to verify link',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /kreators/onboarding/complete
 * Complete onboarding - set password and activate account
 */
router.post('/onboarding/complete', kreatorRateLimit('complete', 5, 60000), async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Token is required',
        code: 'TOKEN_REQUIRED'
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Password is required',
        code: 'PASSWORD_REQUIRED'
      });
    }

    const result = await kreatorService.consumeMagicLinkAndSetPassword(
      token,
      password,
      req.clientInfo
    );

    console.log(`[KreatorAPI] Onboarding complete: ${result.email}`);

    return res.json({
      success: true,
      data: {
        kreatorId: result.kreatorId,
        email: result.email,
        status: result.status,
        message: 'Account setup complete! You can now log in.'
      }
    });

  } catch (error) {
    console.error('[KreatorAPI] Onboarding complete error:', error);

    const errorMap = {
      'NOT_FOUND': { status: 404, message: 'Invalid or unknown link' },
      'ALREADY_CONSUMED': { status: 410, message: 'This link has already been used' },
      'EXPIRED': { status: 410, message: 'This link has expired' },
      'INVALID_PASSWORD': { status: 400, message: 'Password does not meet requirements' },
      'ALREADY_SETUP': { status: 409, message: 'Account is already set up' },
      'KREATOR_NOT_FOUND': { status: 404, message: 'Associated kreator account not found' }
    };

    const mapped = errorMap[error.code];
    if (mapped) {
      return res.status(mapped.status).json({
        success: false,
        error: error.code,
        message: mapped.message,
        details: error.details || null,
        code: error.code
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to complete onboarding',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ============================================================================
// AUTHENTICATED ROUTES - Kreator Profile
// ============================================================================

/**
 * GET /kreators/me
 * Get current kreator's profile
 */
router.get('/me', requireKreatorAuth, async (req, res) => {
  try {
    // Update last activity
    await kreatorService.updateLastLogin(req.kreator.uid);

    // Return sanitized profile (remove sensitive fields)
    const profile = { ...req.kreator };
    delete profile.tokenHash;
    delete profile.tokenSalt;

    return res.json({
      success: true,
      data: profile
    });

  } catch (error) {
    console.error('[KreatorAPI] Get profile error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to fetch profile',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * PUT /kreators/me
 * Update current kreator's profile
 */
router.put('/me', requireKreatorAuth, requireActiveKreator, async (req, res) => {
  try {
    const updates = req.body;

    // Prevent updating protected fields
    const protectedFields = ['uid', 'email', 'status', 'authProviders', 'permissions', 'plan', 'applicationId'];
    for (const field of protectedFields) {
      delete updates[field];
    }

    const updated = await kreatorService.updateKreatorProfile(req.kreator.uid, updates);

    console.log(`[KreatorAPI] Profile updated: ${req.kreator.uid}`);

    return res.json({
      success: true,
      data: updated
    });

  } catch (error) {
    console.error('[KreatorAPI] Update profile error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to update profile',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * DELETE /kreators/me
 * Delete current kreator's account (soft delete)
 */
router.delete('/me', requireKreatorAuth, async (req, res) => {
  try {
    const db = require('firebase-admin').firestore();
    const { FieldValue } = require('firebase-admin/firestore');
    
    // Soft delete - mark as deleted but keep data for compliance
    await db.collection('kreators').doc(req.kreator.uid).update({
      status: 'deleted',
      deletedAt: FieldValue.serverTimestamp(),
      deletedBy: 'self',
      email: `deleted_${Date.now()}_${req.kreator.email}`, // Anonymize email
      firstName: null,
      lastName: null,
      phone: null
    });

    console.log(`[KreatorAPI] Account deleted by user: ${req.kreator.uid}`);

    return res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('[KreatorAPI] Delete account error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to delete account',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ============================================================================
// AUTHENTICATED ROUTES - Google OAuth
// ============================================================================

/**
 * POST /kreators/auth/google/signin
 * Sign in with Google - for approved kreators who linked Google
 */
router.post('/auth/google/signin', async (req, res) => {
  try {
    const { idToken, email } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Google ID token is required',
        code: 'TOKEN_REQUIRED'
      });
    }

    // Verify the Google ID token with Firebase Admin
    let decodedToken;
    try {
      decodedToken = await require('firebase-admin').auth().verifyIdToken(idToken);
    } catch (verifyError) {
      console.error('[KreatorAPI] Invalid Google token:', verifyError);
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid Google token',
        code: 'INVALID_TOKEN'
      });
    }

    const googleEmail = decodedToken.email;
    const googleUid = decodedToken.uid;

    // Find kreator by email
    const kreator = await kreatorService.getKreatorByEmail(googleEmail);

    if (!kreator) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'No seller account found with this email. Please apply first or check your application status.',
        code: 'KREATOR_NOT_FOUND',
        action: 'apply' // Frontend hint
      });
    }

    // Check kreator status - if pending_password, activate with Google
    if (kreator.status === 'pending_password') {
      // Activate the account via Google sign-in (alternative to magic link)
      await kreatorService.updateKreatorProfile(kreator.uid, {
        status: 'active',
        googleUid: googleUid,
        googleConnectedAt: new Date().toISOString(),
        authProviders: ['google'],
        activatedAt: new Date().toISOString(),
        activatedVia: 'google_signin'
      });
      kreator.status = 'active';
      console.log(`[KreatorAPI] ✅ Account activated via Google sign-in: ${googleEmail}`);
    }

    if (kreator.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'Account Inactive',
        message: `Your account is ${kreator.status}. Please contact support.`,
        code: 'INACTIVE_ACCOUNT'
      });
    }

    // Link Google if not already linked
    if (!kreator.googleUid) {
      await kreatorService.updateKreatorProfile(kreator.uid, {
        googleUid: googleUid,
        googleConnectedAt: new Date().toISOString()
      });
    }

    // Create session token
    const sessionToken = await kreatorService.createSessionToken(kreator.uid);

    // Update last login
    await kreatorService.updateLastLogin(kreator.uid, {
      method: 'google',
      ip: req.clientInfo?.ip
    });

    console.log(`[KreatorAPI] ✅ Google sign-in successful: ${googleEmail}`);

    return res.json({
      success: true,
      data: {
        token: sessionToken,
        kreator: {
          uid: kreator.uid,
          email: kreator.email,
          firstName: kreator.firstName,
          lastName: kreator.lastName,
          displayName: kreator.displayName,
          businessName: kreator.businessName,
          businessType: kreator.businessType,
          phone: kreator.phone,
          location: kreator.location,
          bio: kreator.bio,
          status: kreator.status,
          avatarUrl: kreator.avatarUrl,
          productCategories: kreator.productCategories
        }
      }
    });

  } catch (error) {
    console.error('[KreatorAPI] Google sign-in error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to sign in with Google',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /kreators/auth/google/connect
 * Connect Google account to kreator profile
 */
router.post('/auth/google/connect', requireKreatorAuth, async (req, res) => {
  try {
    const { googleUid, googleProfile } = req.body;

    if (!googleUid || !googleProfile) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Google UID and profile are required',
        code: 'MISSING_GOOGLE_INFO'
      });
    }

    const result = await kreatorService.connectGoogleAccount(
      req.kreator.uid,
      googleUid,
      googleProfile,
      req.clientInfo
    );

    console.log(`[KreatorAPI] Google connected: ${req.kreator.uid}`);

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[KreatorAPI] Google connect error:', error);

    if (error.code === 'ALREADY_CONNECTED') {
      return res.status(409).json({
        success: false,
        error: 'Already Connected',
        message: error.message,
        code: error.code
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to connect Google account',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /kreators/auth/google/disconnect
 * Disconnect Google account from kreator profile
 */
router.post('/auth/google/disconnect', requireKreatorAuth, requireActiveKreator, async (req, res) => {
  try {
    const result = await kreatorService.disconnectGoogleAccount(
      req.kreator.uid,
      req.clientInfo
    );

    console.log(`[KreatorAPI] Google disconnected: ${req.kreator.uid}`);

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[KreatorAPI] Google disconnect error:', error);

    if (error.code === 'NOT_CONNECTED') {
      return res.status(400).json({
        success: false,
        error: 'Not Connected',
        message: error.message,
        code: error.code
      });
    }

    if (error.code === 'PASSWORD_REQUIRED') {
      return res.status(400).json({
        success: false,
        error: 'Password Required',
        message: error.message,
        code: error.code
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to disconnect Google account',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ============================================================================
// ADMIN ROUTES - Application Management
// ============================================================================

/**
 * GET /kreators/admin/applications
 * List all kreator applications (admin only)
 */
router.get('/admin/applications', optionalAuthForAdmin, requireAdmin, async (req, res) => {
  try {
    const { status, email, limit, offset, orderBy, orderDir } = req.query;

    const result = await kreatorApplicationService.listApplications({
      status,
      email,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
      orderBy: orderBy || 'submittedAt',
      orderDir: orderDir || 'desc'
    });

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[KreatorAPI] List applications error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to list applications',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * GET /kreators/admin/applications/:id
 * Get application details (admin only)
 */
router.get('/admin/applications/:id', optionalAuthForAdmin, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const application = await kreatorApplicationService.getApplication(id);

    if (!application) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Application not found',
        code: 'NOT_FOUND'
      });
    }

    return res.json({
      success: true,
      data: application
    });

  } catch (error) {
    console.error('[KreatorAPI] Get application error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to get application',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * PUT /kreators/admin/applications/:id/approve
 * Approve application (admin only)
 */
router.put('/admin/applications/:id/approve', optionalAuthForAdmin, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const result = await kreatorApplicationService.approveApplication(
      id,
      req.user.uid,
      notes || ''
    );

    console.log(`[KreatorAPI] Application approved by ${req.user.email}: ${id}`);

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[KreatorAPI] Approve application error:', error);

    const errorMap = {
      'NOT_FOUND': { status: 404, message: 'Application not found' },
      'INVALID_STATUS': { status: 400, message: error.message },
      'EXPIRED': { status: 410, message: 'Application has expired' }
    };

    const mapped = errorMap[error.code];
    if (mapped) {
      return res.status(mapped.status).json({
        success: false,
        error: error.code,
        message: mapped.message,
        code: error.code
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to approve application',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * PUT /kreators/admin/applications/:id/reject
 * Reject application (admin only)
 */
router.put('/admin/applications/:id/reject', optionalAuthForAdmin, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, notes } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Rejection reason is required',
        code: 'REASON_REQUIRED'
      });
    }

    const result = await kreatorApplicationService.rejectApplication(
      id,
      req.user.uid,
      reason,
      notes || ''
    );

    console.log(`[KreatorAPI] Application rejected by ${req.user.email}: ${id}`);

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[KreatorAPI] Reject application error:', error);

    const errorMap = {
      'NOT_FOUND': { status: 404, message: 'Application not found' },
      'INVALID_STATUS': { status: 400, message: error.message },
      'VALIDATION_ERROR': { status: 400, message: error.message }
    };

    const mapped = errorMap[error.code];
    if (mapped) {
      return res.status(mapped.status).json({
        success: false,
        error: error.code,
        message: mapped.message,
        code: error.code
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to reject application',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ============================================================================
// ADMIN ROUTES - Kreator Management
// ============================================================================

/**
 * GET /kreators/admin/list
 * List all kreators (admin only)
 */
router.get('/admin/list', optionalAuthForAdmin, requireAdmin, async (req, res) => {
  try {
    const { status, plan, limit, offset, orderBy, orderDir } = req.query;

    const result = await kreatorService.listKreators({
      status,
      plan,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
      orderBy: orderBy || 'createdAt',
      orderDir: orderDir || 'desc'
    });

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[KreatorAPI] List kreators error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to list kreators',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * GET /kreators/admin/stats
 * Get kreator and application statistics (admin only)
 * NOTE: Must be registered BEFORE /admin/:uid to avoid the param route catching "stats" as a uid.
 */
router.get('/admin/stats', optionalAuthForAdmin, requireAdmin, async (req, res) => {
  try {
    const [appStats, kreatorStats] = await Promise.all([
      kreatorApplicationService.getApplicationStats(),
      kreatorService.getKreatorStats()
    ]);

    return res.json({
      success: true,
      data: {
        applications: appStats,
        kreators: kreatorStats
      }
    });

  } catch (error) {
    console.error('[KreatorAPI] Get stats error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to get statistics',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * GET /kreators/admin/:uid
 * Get kreator details (admin only)
 */
router.get('/admin/:uid', optionalAuthForAdmin, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;

    const kreator = await kreatorService.getKreator(uid);

    if (!kreator) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Kreator not found',
        code: 'NOT_FOUND'
      });
    }

    return res.json({
      success: true,
      data: kreator
    });

  } catch (error) {
    console.error('[KreatorAPI] Get kreator error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to get kreator',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /kreators/admin/:uid/resend-link
 * Resend magic link (admin only)
 */
router.post('/admin/:uid/resend-link', optionalAuthForAdmin, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;

    const result = await kreatorService.resendMagicLink(uid, req.user.uid);

    console.log(`[KreatorAPI] Magic link resent by ${req.user.email}: ${uid}`);

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[KreatorAPI] Resend link error:', error);

    const errorMap = {
      'NOT_FOUND': { status: 404, message: 'Kreator not found' },
      'INVALID_STATUS': { status: 400, message: error.message }
    };

    const mapped = errorMap[error.code];
    if (mapped) {
      return res.status(mapped.status).json({
        success: false,
        error: error.code,
        message: mapped.message,
        code: error.code
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to resend magic link',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;
