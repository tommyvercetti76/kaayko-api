/**
 * Test Utilities for Kreator API
 * 
 * DEVELOPMENT/EMULATOR ONLY - These endpoints help test the API
 * without needing a real Firebase Auth flow.
 * 
 * Includes:
 * - Create test admin user
 * - Create test kreator
 * - Generate mock auth tokens
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const db = admin.firestore();

// Only enable in emulator
const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

/**
 * GET /kreators/test/setup
 * Create test admin user for testing admin endpoints
 */
router.get('/setup', async (req, res) => {
  if (!isEmulator) {
    return res.status(404).json({ error: 'Not available in production' });
  }

  try {
    const testAdminUid = 'test-admin-uid-123';
    const testAdminEmail = 'admin@kaayko.test';

    // Create admin user in Firebase Auth (if not exists)
    try {
      await admin.auth().getUser(testAdminUid);
      console.log('[Test] Admin user already exists');
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        await admin.auth().createUser({
          uid: testAdminUid,
          email: testAdminEmail,
          password: 'testpassword123',
          displayName: 'Test Admin',
          emailVerified: true
        });
        console.log('[Test] Created admin user in Auth');
      }
    }

    // Create admin profile in Firestore
    await db.collection('admin_users').doc(testAdminUid).set({
      uid: testAdminUid,
      email: testAdminEmail,
      displayName: 'Test Admin',
      role: 'super-admin',
      permissions: ['*'],
      enabled: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // Generate custom token
    const customToken = await admin.auth().createCustomToken(testAdminUid, {
      role: 'super-admin'
    });

    console.log('[Test] ✅ Test admin setup complete');

    return res.json({
      success: true,
      message: 'Test admin user created',
      admin: {
        uid: testAdminUid,
        email: testAdminEmail,
        role: 'super-admin'
      },
      customToken,
      instructions: [
        '1. Use the customToken to sign in via Firebase Auth SDK',
        '2. Or use /kreators/test/mock-token to get a mock bearer token',
        '3. Include as: Authorization: Bearer <token>'
      ]
    });

  } catch (error) {
    console.error('[Test] Setup error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /kreators/test/mock-token
 * Generate a mock bearer token for testing
 * This bypasses real Firebase Auth for emulator testing
 */
router.get('/mock-token', async (req, res) => {
  if (!isEmulator) {
    return res.status(404).json({ error: 'Not available in production' });
  }

  try {
    const { role = 'admin', uid = 'test-admin-uid-123' } = req.query;

    // Create custom token
    const customToken = await admin.auth().createCustomToken(uid, { role });

    // In emulator, we can exchange custom token for ID token
    // by using the Auth emulator's REST API
    const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    const projectId = process.env.GCLOUD_PROJECT || 'kaaykostore';

    // Note: In real testing, you'd exchange this custom token client-side
    // For API testing, we'll return the custom token and instructions

    return res.json({
      success: true,
      customToken,
      uid,
      role,
      note: 'Exchange this custom token for an ID token using Firebase Auth SDK',
      example: `
// Client-side:
import { getAuth, signInWithCustomToken } from 'firebase/auth';
const auth = getAuth();
const userCredential = await signInWithCustomToken(auth, '${customToken.substring(0, 50)}...');
const idToken = await userCredential.user.getIdToken();
// Use idToken as Bearer token
      `
    });

  } catch (error) {
    console.error('[Test] Mock token error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /kreators/test/direct-approve
 * Directly approve an application (bypasses auth for testing)
 */
router.post('/direct-approve', async (req, res) => {
  if (!isEmulator) {
    return res.status(404).json({ error: 'Not available in production' });
  }

  try {
    const { applicationId, notes = 'Test approval' } = req.body;

    if (!applicationId) {
      return res.status(400).json({ error: 'applicationId is required' });
    }

    const kreatorApplicationService = require('../../services/kreatorApplicationService');
    
    const result = await kreatorApplicationService.approveApplication(
      applicationId,
      'test-admin-uid-123',
      notes
    );

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[Test] Direct approve error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code
    });
  }
});

/**
 * POST /kreators/test/direct-reject
 * Directly reject an application (bypasses auth for testing)
 */
router.post('/direct-reject', async (req, res) => {
  if (!isEmulator) {
    return res.status(404).json({ error: 'Not available in production' });
  }

  try {
    const { applicationId, reason = 'Test rejection', notes = '' } = req.body;

    if (!applicationId) {
      return res.status(400).json({ error: 'applicationId is required' });
    }

    const kreatorApplicationService = require('../../services/kreatorApplicationService');
    
    const result = await kreatorApplicationService.rejectApplication(
      applicationId,
      'test-admin-uid-123',
      reason,
      notes
    );

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[Test] Direct reject error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code
    });
  }
});

/**
 * GET /kreators/test/list-all
 * List all applications and kreators (debug view)
 */
router.get('/list-all', async (req, res) => {
  if (!isEmulator) {
    return res.status(404).json({ error: 'Not available in production' });
  }

  try {
    const [appsSnap, kreatorsSnap, linksSnap] = await Promise.all([
      db.collection('kreator_applications').orderBy('submittedAt', 'desc').limit(20).get(),
      db.collection('kreators').orderBy('createdAt', 'desc').limit(20).get(),
      db.collection('short_links').where('type', '==', 'magic_link').limit(20).get()
    ]);

    const applications = appsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const kreators = kreatorsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const magicLinks = linksSnap.docs.map(d => ({ 
      code: d.id, 
      email: d.data().metadata?.targetEmail,
      purpose: d.data().metadata?.purpose,
      enabled: d.data().enabled,
      usedAt: d.data().metadata?.usedAt
    }));

    return res.json({
      success: true,
      data: {
        applications,
        kreators,
        magicLinks
      }
    });

  } catch (error) {
    console.error('[Test] List all error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /kreators/test/cleanup
 * Clean up all test data
 */
router.delete('/cleanup', async (req, res) => {
  if (!isEmulator) {
    return res.status(404).json({ error: 'Not available in production' });
  }

  try {
    const batch = db.batch();
    
    // Delete all test applications
    const apps = await db.collection('kreator_applications').get();
    apps.docs.forEach(doc => batch.delete(doc.ref));

    // Delete all test kreators
    const kreators = await db.collection('kreators').get();
    kreators.docs.forEach(doc => batch.delete(doc.ref));

    // Delete magic links
    const links = await db.collection('short_links').where('type', '==', 'magic_link').get();
    links.docs.forEach(doc => batch.delete(doc.ref));

    // Delete audit logs
    const audits = await db.collection('admin_audit_logs').get();
    audits.docs.forEach(doc => batch.delete(doc.ref));

    await batch.commit();

    console.log('[Test] ✅ Cleanup complete');

    return res.json({
      success: true,
      deleted: {
        applications: apps.size,
        kreators: kreators.size,
        magicLinks: links.size,
        auditLogs: audits.size
      }
    });

  } catch (error) {
    console.error('[Test] Cleanup error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
