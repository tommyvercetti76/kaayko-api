/**
 * Click Analytics & Utilities
 * Split from clickTracking.js — analytics queries, UA parsing, cleanup.
 *
 * @module api/kortex/clickAnalytics
 */

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Parse user agent string for device info
 * @param {string} userAgent
 * @returns {Object} Parsed device info
 */
function parseUserAgent(userAgent = '') {
  const ua = userAgent.toLowerCase();
  let platform = 'web', os = 'Unknown', browser = 'Unknown', deviceType = 'desktop';

  if (ua.includes('iphone') || ua.includes('ipad')) {
    platform = 'ios'; os = 'iOS'; deviceType = ua.includes('ipad') ? 'tablet' : 'mobile';
  } else if (ua.includes('android')) {
    platform = 'android'; os = 'Android'; deviceType = ua.includes('mobile') ? 'mobile' : 'tablet';
  } else if (ua.includes('windows')) { os = 'Windows'; }
  else if (ua.includes('mac')) { os = 'macOS'; }
  else if (ua.includes('linux')) { os = 'Linux'; }

  if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
  else if (ua.includes('chrome')) browser = 'Chrome';
  else if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('edge')) browser = 'Edge';

  return { platform, os, browser, deviceType, rawUserAgent: userAgent };
}

/** Time from click to conversion in seconds */
function calculateTimeToConversion(clickTimestampMs) {
  return Math.floor((Date.now() - clickTimestampMs) / 1000);
}

/**
 * Get analytics for a link (clicks, installs, conversion rate)
 * @param {string} linkCode
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function getLinkAnalytics(linkCode, options = {}) {
  const { startDate, endDate } = options;

  let clickQuery = db.collection('click_events').where('linkCode', '==', linkCode);
  let installQuery = db.collection('install_events').where('linkCode', '==', linkCode);

  if (startDate) {
    const ts = admin.firestore.Timestamp.fromDate(startDate);
    clickQuery = clickQuery.where('timestamp', '>=', ts);
    installQuery = installQuery.where('timestamp', '>=', ts);
  }
  if (endDate) {
    const ts = admin.firestore.Timestamp.fromDate(endDate);
    clickQuery = clickQuery.where('timestamp', '<=', ts);
    installQuery = installQuery.where('timestamp', '<=', ts);
  }

  const [clickSnap, installSnap] = await Promise.all([clickQuery.get(), installQuery.get()]);
  const clicks = clickSnap.docs.map(d => d.data());
  const installs = installSnap.docs.map(d => d.data());

  const totalClicks = clicks.length;
  const totalInstalls = installs.length;
  const conversionRate = totalClicks > 0 ? (totalInstalls / totalClicks) * 100 : 0;

  const platformBreakdown = clicks.reduce((acc, c) => { acc[c.platform] = (acc[c.platform] || 0) + 1; return acc; }, {});
  const utmSources = {};
  clicks.forEach(c => { const s = c.utm?.utm_source || 'direct'; utmSources[s] = (utmSources[s] || 0) + 1; });

  return { totalClicks, totalInstalls, conversionRate: conversionRate.toFixed(2), platformBreakdown, utmSources,
    clicks: clicks.slice(0, 100), installs: installs.slice(0, 100) };
}

/**
 * Cleanup expired click events (scheduled job)
 * @returns {Promise<{deleted: number}>}
 */
async function cleanupExpiredClicks() {
  const expiryDate = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
  const expiryTs = admin.firestore.Timestamp.fromDate(expiryDate);
  const snap = await db.collection('click_events').where('timestamp', '<', expiryTs).limit(500).get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  if (snap.size > 0) { await batch.commit(); console.log(`[ClickTracking] Cleaned up ${snap.size} expired clicks`); }
  return { deleted: snap.size };
}

module.exports = { parseUserAgent, calculateTimeToConversion, getLinkAnalytics, cleanupExpiredClicks };
