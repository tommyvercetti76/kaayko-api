/**
 * Test Utility Handlers — emulator-only test endpoints
 * Extracted from testRoutes.js for primer compliance.
 *
 * @module api/kreators/testHandlers
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();

const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

function guardEmulator(req, res) {
  if (!isEmulator) { res.status(404).json({ error: 'Not available in production' }); return false; }
  return true;
}

async function setup(req, res) {
  if (!guardEmulator(req, res)) return;
  try {
    const uid = 'test-admin-uid-123';
    const email = 'admin@kaayko.test';
    try { await admin.auth().getUser(uid); } catch (e) {
      if (e.code === 'auth/user-not-found') await admin.auth().createUser({ uid, email, password: 'testpassword123', displayName: 'Test Admin', emailVerified: true });
    }
    await db.collection('admin_users').doc(uid).set({
      uid, email, displayName: 'Test Admin', role: 'super-admin',
      permissions: ['*'], enabled: true,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    const customToken = await admin.auth().createCustomToken(uid, { role: 'super-admin' });
    return res.json({ success: true, message: 'Test admin user created', admin: { uid, email, role: 'super-admin' }, customToken });
  } catch (error) { console.error('[Test] Setup error:', error); return res.status(500).json({ success: false, error: error.message }); }
}

async function mockToken(req, res) {
  if (!guardEmulator(req, res)) return;
  try {
    const { role = 'admin', uid = 'test-admin-uid-123' } = req.query;
    const customToken = await admin.auth().createCustomToken(uid, { role });
    return res.json({ success: true, customToken, uid, role, note: 'Exchange this custom token for an ID token using Firebase Auth SDK' });
  } catch (error) { console.error('[Test] Mock token error:', error); return res.status(500).json({ success: false, error: error.message }); }
}

async function directApprove(req, res) {
  if (!guardEmulator(req, res)) return;
  try {
    const { applicationId, notes = 'Test approval' } = req.body;
    if (!applicationId) return res.status(400).json({ error: 'applicationId is required' });
    const svc = require('../../services/kreatorApplicationService');
    const result = await svc.approveApplication(applicationId, 'test-admin-uid-123', notes);
    return res.json({ success: true, data: result });
  } catch (error) { console.error('[Test] Direct approve error:', error); return res.status(500).json({ success: false, error: error.message, code: error.code }); }
}

async function directReject(req, res) {
  if (!guardEmulator(req, res)) return;
  try {
    const { applicationId, reason = 'Test rejection', notes = '' } = req.body;
    if (!applicationId) return res.status(400).json({ error: 'applicationId is required' });
    const svc = require('../../services/kreatorApplicationService');
    const result = await svc.rejectApplication(applicationId, 'test-admin-uid-123', reason, notes);
    return res.json({ success: true, data: result });
  } catch (error) { console.error('[Test] Direct reject error:', error); return res.status(500).json({ success: false, error: error.message, code: error.code }); }
}

async function listAll(req, res) {
  if (!guardEmulator(req, res)) return;
  try {
    const [appsSnap, kreatorsSnap, linksSnap] = await Promise.all([
      db.collection('kreator_applications').orderBy('submittedAt', 'desc').limit(20).get(),
      db.collection('kreators').orderBy('createdAt', 'desc').limit(20).get(),
      db.collection('short_links').where('type', '==', 'magic_link').limit(20).get()
    ]);
    return res.json({ success: true, data: {
      applications: appsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      kreators: kreatorsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      magicLinks: linksSnap.docs.map(d => ({ code: d.id, email: d.data().metadata?.targetEmail, purpose: d.data().metadata?.purpose, enabled: d.data().enabled }))
    }});
  } catch (error) { console.error('[Test] List all error:', error); return res.status(500).json({ success: false, error: error.message }); }
}

async function cleanup(req, res) {
  if (!guardEmulator(req, res)) return;
  try {
    const batch = db.batch();
    const [apps, kreators, links, audits] = await Promise.all([
      db.collection('kreator_applications').get(), db.collection('kreators').get(),
      db.collection('short_links').where('type', '==', 'magic_link').get(), db.collection('admin_audit_logs').get()
    ]);
    apps.docs.forEach(d => batch.delete(d.ref));
    kreators.docs.forEach(d => batch.delete(d.ref));
    links.docs.forEach(d => batch.delete(d.ref));
    audits.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    return res.json({ success: true, deleted: { applications: apps.size, kreators: kreators.size, magicLinks: links.size, auditLogs: audits.size } });
  } catch (error) { console.error('[Test] Cleanup error:', error); return res.status(500).json({ success: false, error: error.message }); }
}

module.exports = { setup, mockToken, directApprove, directReject, listAll, cleanup };
