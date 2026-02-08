/**
 * Kreator Profile Routes
 * 
 * Authenticated kreator endpoints for profile management.
 * 
 * Routes:
 * - GET    /me  - Get current kreator profile
 * - PUT    /me  - Update kreator profile
 * - DELETE /me  - Soft-delete kreator account
 * 
 * @module api/kreators/profileRoutes
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const kreatorService = require('../../services/kreatorService');
const { requireKreatorAuth, requireActiveKreator } = require('../../middleware/kreatorAuthMiddleware');

// ============================================================================
// PROFILE CRUD
// ============================================================================

/**
 * GET /kreators/me
 * Get current kreator's profile
 */
router.get('/me', requireKreatorAuth, async (req, res) => {
  try {
    // Update last activity (fire-and-forget)
    kreatorService.updateLastLogin(req.kreator.uid)
      .catch(err => console.error('[KreatorAPI] Last activity update failed:', err));

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
    const db = admin.firestore();

    // Soft delete — mark as deleted but keep data for compliance
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

module.exports = router;
