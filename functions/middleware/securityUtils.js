/**
 * Security Utilities — Bot detection, IP extraction, logging
 * @module middleware/securityUtils
 */

const admin = require('firebase-admin');
const db = admin.firestore();

const RATE_LIMITS = {
  login: { max: 5, window: 15 * 60 * 1000 },
  tenantRegistration: { max: 3, window: 60 * 60 * 1000 },
  tenants: { max: 20, window: 60 * 1000 },
  api: { max: 100, window: 60 * 1000 }
};

const BOT_USER_AGENTS = [
  /bot/i, /crawl/i, /spider/i, /scrape/i, /curl/i, /wget/i, /python/i,
  /scanner/i, /headless/i, /phantom/i, /selenium/i, /webdriver/i
];

function isBot(ua) { return !ua || BOT_USER_AGENTS.some(p => p.test(ua)); }

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
}

async function logSuspiciousActivity(req, type, details = {}) {
  try {
    await db.collection('security_logs').add({
      type, ip: getClientIp(req), userAgent: req.get('user-agent'),
      path: req.path, method: req.method, details,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) { console.error('[Security] Failed to log:', err); }
}

/** Honeypot trap — returns fake success to waste bot time. */
function honeypot(req, res) {
  logSuspiciousActivity(req, 'honeypot', { message: 'Bot fell into honeypot trap' });
  res.status(200).json({ success: true, data: Array(100).fill({ id: Math.random(), value: 'fake_data' }) });
}

module.exports = { RATE_LIMITS, BOT_USER_AGENTS, isBot, getClientIp, logSuspiciousActivity, honeypot };
