/**
 * Kreator Admin Handlers — application + kreator management logic
 * Extracted from adminRoutes.js for primer compliance.
 *
 * @module api/kreators/adminHandlers
 */

const kreatorApplicationService = require('../../services/kreatorApplicationService');
const kreatorService = require('../../services/kreatorService');

// ── Application handlers ─────────────────────────────────────────────

async function listApplications(req, res) {
  try {
    const { status, email, limit, offset, orderBy, orderDir } = req.query;
    const result = await kreatorApplicationService.listApplications({
      status, email, limit: parseInt(limit) || 50, offset: parseInt(offset) || 0,
      orderBy: orderBy || 'submittedAt', orderDir: orderDir || 'desc'
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[KreatorAPI] List applications error:', error);
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to list applications', code: 'INTERNAL_ERROR' });
  }
}

async function getApplication(req, res) {
  try {
    const application = await kreatorApplicationService.getApplication(req.params.id);
    if (!application) return res.status(404).json({ success: false, error: 'Not Found', message: 'Application not found', code: 'NOT_FOUND' });
    return res.json({ success: true, data: application });
  } catch (error) {
    console.error('[KreatorAPI] Get application error:', error);
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to get application', code: 'INTERNAL_ERROR' });
  }
}

function mapError(error, fallbackMsg) {
  const errorMap = {
    'NOT_FOUND': { status: 404, message: 'Application not found' },
    'INVALID_STATUS': { status: 400, message: error.message },
    'EXPIRED': { status: 410, message: 'Application has expired' },
    'VALIDATION_ERROR': { status: 400, message: error.message },
    'REASON_REQUIRED': { status: 400, message: 'Rejection reason is required' }
  };
  const mapped = errorMap[error.code];
  if (mapped) return { status: mapped.status, body: { success: false, error: error.code, message: mapped.message, code: error.code } };
  return { status: 500, body: { success: false, error: 'Server Error', message: fallbackMsg, code: 'INTERNAL_ERROR' } };
}

async function approveApplication(req, res) {
  try {
    const result = await kreatorApplicationService.approveApplication(req.params.id, req.user.uid, req.body.notes || '');
    console.log(`[KreatorAPI] Application approved by ${req.user.email}: ${req.params.id}`);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[KreatorAPI] Approve application error:', error);
    const { status, body } = mapError(error, 'Failed to approve application');
    return res.status(status).json(body);
  }
}

async function rejectApplication(req, res) {
  try {
    if (!req.body.reason) return res.status(400).json({ success: false, error: 'Bad Request', message: 'Rejection reason is required', code: 'REASON_REQUIRED' });
    const result = await kreatorApplicationService.rejectApplication(req.params.id, req.user.uid, req.body.reason, req.body.notes || '');
    console.log(`[KreatorAPI] Application rejected by ${req.user.email}: ${req.params.id}`);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[KreatorAPI] Reject application error:', error);
    const { status, body } = mapError(error, 'Failed to reject application');
    return res.status(status).json(body);
  }
}

// ── Kreator management handlers ──────────────────────────────────────

async function listKreators(req, res) {
  try {
    const { status, plan, limit, offset, orderBy, orderDir } = req.query;
    const result = await kreatorService.listKreators({
      status, plan, limit: parseInt(limit) || 50, offset: parseInt(offset) || 0,
      orderBy: orderBy || 'createdAt', orderDir: orderDir || 'desc'
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[KreatorAPI] List kreators error:', error);
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to list kreators', code: 'INTERNAL_ERROR' });
  }
}

async function getStats(req, res) {
  try {
    const [appStats, kreatorStats] = await Promise.all([
      kreatorApplicationService.getApplicationStats(),
      kreatorService.getKreatorStats()
    ]);
    return res.json({ success: true, data: { applications: appStats, kreators: kreatorStats } });
  } catch (error) {
    console.error('[KreatorAPI] Get stats error:', error);
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to get statistics', code: 'INTERNAL_ERROR' });
  }
}

async function getKreator(req, res) {
  try {
    const kreator = await kreatorService.getKreator(req.params.uid);
    if (!kreator) return res.status(404).json({ success: false, error: 'Not Found', message: 'Kreator not found', code: 'NOT_FOUND' });
    return res.json({ success: true, data: kreator });
  } catch (error) {
    console.error('[KreatorAPI] Get kreator error:', error);
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to get kreator', code: 'INTERNAL_ERROR' });
  }
}

async function resendLink(req, res) {
  try {
    const result = await kreatorService.resendMagicLink(req.params.uid, req.user.uid);
    console.log(`[KreatorAPI] Magic link resent by ${req.user.email}: ${req.params.uid}`);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[KreatorAPI] Resend link error:', error);
    const { status, body } = mapError(error, 'Failed to resend magic link');
    return res.status(status).json(body);
  }
}

module.exports = {
  listApplications, getApplication, approveApplication, rejectApplication,
  listKreators, getStats, getKreator, resendLink
};
