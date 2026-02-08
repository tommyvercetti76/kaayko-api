/**
 * Kreator Auth Handlers — Google OAuth logic
 * Extracted from kreatorAuthRoutes.js for primer compliance.
 *
 * @module api/kreators/kreatorAuthHandlers
 */

const admin = require('firebase-admin');
const kreatorService = require('../../services/kreatorService');

// ─── Google Sign-In (Public) ───────────────────────────
async function googleSignIn(req, res) {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ success: false, error: 'Bad Request', message: 'Google ID token is required', code: 'TOKEN_REQUIRED' });
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (verifyError) {
      console.error('[KreatorAPI] Invalid Google token:', verifyError);
      return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Invalid Google token', code: 'INVALID_TOKEN' });
    }

    const googleEmail = decodedToken.email;
    const googleUid = decodedToken.uid;
    const kreator = await kreatorService.getKreatorByEmail(googleEmail);

    if (!kreator) {
      return res.status(404).json({ success: false, error: 'Not Found', message: 'No seller account found with this email. Please apply first or check your application status.', code: 'KREATOR_NOT_FOUND', action: 'apply' });
    }

    // Activate via Google sign-in if pending
    if (kreator.status === 'pending_password') {
      await kreatorService.updateKreatorProfile(kreator.uid, {
        status: 'active', googleUid, googleConnectedAt: new Date().toISOString(),
        authProviders: ['google'], activatedAt: new Date().toISOString(), activatedVia: 'google_signin'
      });
      kreator.status = 'active';
      console.log(`[KreatorAPI] ✅ Account activated via Google sign-in: ${googleEmail}`);
    }

    if (kreator.status !== 'active') {
      return res.status(403).json({ success: false, error: 'Account Inactive', message: `Your account is ${kreator.status}. Please contact support.`, code: 'INACTIVE_ACCOUNT' });
    }

    if (!kreator.googleUid) {
      await kreatorService.updateKreatorProfile(kreator.uid, { googleUid, googleConnectedAt: new Date().toISOString() });
    }

    const sessionToken = await kreatorService.createSessionToken(kreator.uid);
    kreatorService.updateLastLogin(kreator.uid, { method: 'google', ip: req.clientInfo?.ip }).catch(err => console.error('[KreatorAPI] Last login update failed:', err));

    console.log(`[KreatorAPI] ✅ Google sign-in successful: ${googleEmail}`);
    return res.json({ success: true, data: {
      token: sessionToken,
      kreator: { uid: kreator.uid, email: kreator.email, firstName: kreator.firstName, lastName: kreator.lastName,
        displayName: kreator.displayName, businessName: kreator.businessName, businessType: kreator.businessType,
        phone: kreator.phone, location: kreator.location, bio: kreator.bio, status: kreator.status,
        avatarUrl: kreator.avatarUrl, productCategories: kreator.productCategories }
    }});
  } catch (error) {
    console.error('[KreatorAPI] Google sign-in error:', error);
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to sign in with Google', code: 'INTERNAL_ERROR' });
  }
}

// ─── Google Connect (Kreator auth required) ────────────
async function googleConnect(req, res) {
  try {
    const { googleUid, googleProfile } = req.body;
    if (!googleUid || !googleProfile) {
      return res.status(400).json({ success: false, error: 'Bad Request', message: 'Google UID and profile are required', code: 'MISSING_GOOGLE_INFO' });
    }
    const result = await kreatorService.connectGoogleAccount(req.kreator.uid, googleUid, googleProfile, req.clientInfo);
    console.log(`[KreatorAPI] Google connected: ${req.kreator.uid}`);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[KreatorAPI] Google connect error:', error);
    if (error.code === 'ALREADY_CONNECTED') {
      return res.status(409).json({ success: false, error: 'Already Connected', message: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to connect Google account', code: 'INTERNAL_ERROR' });
  }
}

// ─── Google Disconnect (Kreator auth required) ─────────
async function googleDisconnect(req, res) {
  try {
    const result = await kreatorService.disconnectGoogleAccount(req.kreator.uid, req.clientInfo);
    console.log(`[KreatorAPI] Google disconnected: ${req.kreator.uid}`);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[KreatorAPI] Google disconnect error:', error);
    if (error.code === 'NOT_CONNECTED') {
      return res.status(400).json({ success: false, error: 'Not Connected', message: error.message, code: error.code });
    }
    if (error.code === 'PASSWORD_REQUIRED') {
      return res.status(400).json({ success: false, error: 'Password Required', message: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to disconnect Google account', code: 'INTERNAL_ERROR' });
  }
}

module.exports = { googleSignIn, googleConnect, googleDisconnect };
