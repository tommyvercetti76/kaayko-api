/**
 * Public Kreator Handlers — application & onboarding logic
 * Extracted from publicRoutes.js for primer compliance.
 *
 * @module api/kreators/publicHandlers
 */

const kreatorApplicationService = require('../../services/kreatorApplicationService');
const kreatorService = require('../../services/kreatorService');

// ─── Apply ─────────────────────────────────────────────
async function apply(req, res) {
  try {
    const result = await kreatorApplicationService.submitApplication(req.body, req.clientInfo);
    console.log(`[KreatorAPI] Application submitted: ${result.id}`);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    console.error('[KreatorAPI] Application submission error:', error);
    if (error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ success: false, error: 'Validation Error', message: 'Please fix the following errors', details: error.details, code: error.code });
    }
    if (error.code === 'DUPLICATE_APPLICATION') {
      return res.status(409).json({ success: false, error: 'Duplicate Application', message: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to submit application. Please try again.', code: 'INTERNAL_ERROR' });
  }
}

// ─── Status Check ──────────────────────────────────────
async function statusCheck(req, res) {
  try {
    const { id } = req.params;
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Bad Request', message: 'Email query parameter is required', code: 'EMAIL_REQUIRED' });
    }
    const status = await kreatorApplicationService.getApplicationStatus(email, id);
    if (!status) {
      return res.status(404).json({ success: false, error: 'Not Found', message: 'Application not found or email does not match', code: 'NOT_FOUND' });
    }
    return res.json({ success: true, data: status });
  } catch (error) {
    console.error('[KreatorAPI] Status check error:', error);
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to check application status', code: 'INTERNAL_ERROR' });
  }
}

// ─── Magic Link Verify ─────────────────────────────────
async function magicLinkVerify(req, res) {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Bad Request', message: 'Token is required', code: 'TOKEN_REQUIRED' });
    }
    const result = await kreatorService.validateMagicLink(token);
    if (!result.valid) {
      const statusMap = { 'not_found': 404, 'already_used': 410, 'expired': 410, 'not_magic_link': 400 };
      const messageMap = { 'not_found': 'Invalid or unknown link', 'already_used': 'This link has already been used', 'expired': 'This link has expired', 'not_magic_link': 'Invalid link type' };
      return res.status(statusMap[result.reason] || 400).json({
        success: false, error: 'Invalid Link', message: messageMap[result.reason] || 'Link validation failed',
        code: `MAGIC_LINK_${result.reason.toUpperCase()}`, reason: result.reason
      });
    }
    return res.json({ success: true, data: { email: result.email, purpose: result.purpose, expiresAt: result.expiresAt } });
  } catch (error) {
    console.error('[KreatorAPI] Magic link verify error:', error);
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to verify link', code: 'INTERNAL_ERROR' });
  }
}

// ─── Onboarding Complete ───────────────────────────────
async function onboardingComplete(req, res) {
  try {
    const { token, password } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'Bad Request', message: 'Token is required', code: 'TOKEN_REQUIRED' });
    if (!password) return res.status(400).json({ success: false, error: 'Bad Request', message: 'Password is required', code: 'PASSWORD_REQUIRED' });

    const result = await kreatorService.consumeMagicLinkAndSetPassword(token, password, req.clientInfo);
    console.log(`[KreatorAPI] Onboarding complete: ${result.email}`);
    return res.json({ success: true, data: { kreatorId: result.kreatorId, email: result.email, status: result.status, message: 'Account setup complete! You can now log in.' } });
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
    if (mapped) return res.status(mapped.status).json({ success: false, error: error.code, message: mapped.message, details: error.details || null, code: error.code });
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to complete onboarding', code: 'INTERNAL_ERROR' });
  }
}

module.exports = { apply, statusCheck, magicLinkVerify, onboardingComplete };
