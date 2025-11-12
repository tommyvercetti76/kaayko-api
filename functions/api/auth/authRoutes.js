/**
 * Authentication Routes
 * Handles login, logout, and session management
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { requireAuth } = require('../../middleware/authMiddleware');

/**
 * POST /auth/logout
 * Revoke user's refresh tokens and invalidate session
 * Frontend should clear localStorage and redirect to login
 */
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    
    // Revoke all refresh tokens for this user
    // This invalidates all existing sessions
    await admin.auth().revokeRefreshTokens(uid);
    
    // Get the user's latest token issue time
    const userRecord = await admin.auth().getUser(uid);
    const revokeTime = new Date(userRecord.tokensValidAfterTime).getTime() / 1000;
    
    console.log(`✅ User ${req.user.email} logged out successfully. Tokens revoked at ${new Date(revokeTime * 1000).toISOString()}`);
    
    res.json({
      success: true,
      message: 'Logout successful. All sessions have been terminated.',
      revokedAt: new Date(revokeTime * 1000).toISOString()
    });
    
  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed',
      details: error.message
    });
  }
});

/**
 * GET /auth/me
 * Get current authenticated user info
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        uid: req.user.uid,
        email: req.user.email,
        role: req.user.role,
        displayName: req.user.displayName || null,
        emailVerified: req.user.email_verified || false
      }
    });
  } catch (error) {
    console.error('❌ Error fetching user info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user information'
    });
  }
});

/**
 * POST /auth/verify
 * Verify a Firebase ID token (for debugging)
 */
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token is required'
      });
    }
    
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    res.json({
      success: true,
      decoded: {
        uid: decodedToken.uid,
        email: decodedToken.email,
        role: decodedToken.role || null,
        exp: new Date(decodedToken.exp * 1000).toISOString(),
        iat: new Date(decodedToken.iat * 1000).toISOString()
      }
    });
    
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
      details: error.message
    });
  }
});

module.exports = router;
