/**
 * Click Tracking & Attribution Service
 * 
 * Enterprise-grade click tracking with install attribution for Smart Links.
 * Tracks the full funnel: click → redirect → install → first open → attribution.
 * 
 * Features:
 * - Unique clickId generation for each click
 * - Click event persistence with full context
 * - Click-to-install attribution
 * - Deferred deep linking support
 * - Platform detection and routing
 * - UTM parameter preservation
 * 
 * @module api/smartLinks/clickTracking
 */

const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();
const { FieldValue } = require('firebase-admin/firestore');

// Import webhook service (lazy to avoid circular dependency)
let webhookService = null;
function getWebhookService() {
  if (!webhookService) {
    webhookService = require('./webhookService');
  }
  return webhookService;
}

/**
 * Generate unique click ID
 * Format: c_<16 random hex chars>
 * 
 * @returns {string} Unique click ID
 */
function generateClickId() {
  const randomBytes = crypto.randomBytes(8).toString('hex');
  return `c_${randomBytes}`;
}

/**
 * Track a click event with full context
 * Returns clickId for attribution chain
 * 
 * @param {Object} params
 * @param {string} params.linkCode - Short link code
 * @param {string} params.tenantId - Tenant ID
 * @param {string} params.platform - Detected platform (ios|android|web)
 * @param {string} params.userAgent - Full user agent string
 * @param {string} params.ip - Client IP address
 * @param {string} params.referrer - HTTP referrer
 * @param {Object} params.utm - UTM parameters
 * @param {Object} params.metadata - Additional metadata
 * @returns {Promise<{clickId: string, timestamp: Date}>}
 */
async function trackClick(params) {
  const {
    linkCode,
    tenantId,
    platform,
    userAgent,
    ip,
    referrer,
    utm = {},
    metadata = {}
  } = params;

  const clickId = generateClickId();
  const timestamp = new Date();

  // Parse user agent for detailed info
  const deviceInfo = parseUserAgent(userAgent);

  // Create click event document
  const clickEvent = {
    clickId,
    linkCode,
    tenantId,
    timestamp: FieldValue.serverTimestamp(),
    timestampMs: timestamp.getTime(),
    
    // Platform & device
    platform,
    deviceInfo,
    userAgent,
    
    // Network & location
    ip,
    // Note: Geolocation can be added via IP lookup service
    
    // Attribution
    referrer: referrer || null,
    utm,
    
    // Status tracking
    redirectedTo: null, // Set when redirect happens
    installAttributed: false, // Set when install is attributed
    installTimestamp: null,
    
    // Additional data
    metadata,
    
    // TTL: expire after 30 days (for cleanup)
    expiresAt: admin.firestore.Timestamp.fromMillis(timestamp.getTime() + (30 * 24 * 60 * 60 * 1000))
  };

  // Save to Firestore
  await db.collection('click_events').doc(clickId).set(clickEvent);

  console.log('[ClickTracking] Tracked click:', {
    clickId,
    linkCode,
    platform,
    tenant: tenantId
  });

  // Trigger webhooks (async, non-blocking)
  try {
    const webhooks = getWebhookService();
    webhooks.triggerWebhooks({
      tenantId,
      eventType: webhooks.EVENT_TYPES.CLICK,
      payload: {
        event: 'link.clicked',
        clickId,
        linkCode,
        platform,
        timestamp: new Date().toISOString(),
        deviceInfo,
        utm
      }
    }).catch(err => console.error('[ClickTracking] Webhook trigger failed:', err));
  } catch (webhookError) {
    // Ignore webhook errors (don't block click tracking)
  }

  return { clickId, timestamp };
}

/**
 * Update click event with redirect destination
 * Called after redirect decision is made
 * 
 * @param {string} clickId 
 * @param {string} destination 
 * @returns {Promise<void>}
 */
async function updateClickRedirect(clickId, destination) {
  try {
    await db.collection('click_events').doc(clickId).update({
      redirectedTo: destination,
      redirectTimestamp: FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('[ClickTracking] Failed to update redirect:', error);
  }
}

/**
 * Track an install event and attribute to click
 * Called from /resolve endpoint after app install
 * 
 * @param {Object} params
 * @param {string} params.clickId - Click ID from deep link
 * @param {string} params.deviceId - Stable device identifier
 * @param {string} params.platform - ios|android
 * @param {string} params.appVersion - App version string
 * @param {Object} params.metadata - Additional install metadata
 * @returns {Promise<{success: boolean, attributed: boolean, context: Object}>}
 */
async function trackInstall(params) {
  const {
    clickId,
    deviceId,
    platform,
    appVersion,
    metadata = {}
  } = params;

  if (!clickId) {
    return {
      success: false,
      attributed: false,
      error: 'clickId required'
    };
  }

  try {
    // Look up click event
    const clickDoc = await db.collection('click_events').doc(clickId).get();
    
    if (!clickDoc.exists) {
      console.warn('[ClickTracking] Install without valid click:', clickId);
      return {
        success: true,
        attributed: false,
        error: 'Click not found'
      };
    }

    const clickData = clickDoc.data();

    // Check if already attributed (idempotency)
    if (clickData.installAttributed) {
      console.log('[ClickTracking] Install already attributed:', clickId);
      return {
        success: true,
        attributed: true,
        isNewInstall: false,
        context: clickData
      };
    }

    // Update click event with install info
    await clickDoc.ref.update({
      installAttributed: true,
      installTimestamp: FieldValue.serverTimestamp(),
      installDeviceId: deviceId,
      installPlatform: platform,
      installAppVersion: appVersion,
      installMetadata: metadata
    });

    // Increment install count on the link
    await db.collection('short_links').doc(clickData.linkCode).update({
      installCount: FieldValue.increment(1),
      lastInstallAt: FieldValue.serverTimestamp()
    });

    // Create install event for analytics
    await db.collection('install_events').add({
      clickId,
      linkCode: clickData.linkCode,
      tenantId: clickData.tenantId,
      deviceId,
      platform,
      appVersion,
      timestamp: FieldValue.serverTimestamp(),
      clickTimestamp: clickData.timestamp,
      timeToConversion: calculateTimeToConversion(clickData.timestampMs),
      utm: clickData.utm,
      metadata
    });

    console.log('[ClickTracking] Install attributed:', {
      clickId,
      linkCode: clickData.linkCode,
      platform
    });

    // Trigger webhooks (async, non-blocking)
    try {
      const webhooks = getWebhookService();
      webhooks.triggerWebhooks({
        tenantId: clickData.tenantId,
        eventType: webhooks.EVENT_TYPES.INSTALL,
        payload: {
          event: 'app.installed',
          clickId,
          linkCode: clickData.linkCode,
          deviceId,
          platform,
          appVersion,
          timestamp: new Date().toISOString(),
          utm: clickData.utm
        }
      }).catch(err => console.error('[ClickTracking] Webhook trigger failed:', err));
    } catch (webhookError) {
      // Ignore webhook errors
    }

    return {
      success: true,
      attributed: true,
      isNewInstall: true,
      context: {
        linkCode: clickData.linkCode,
        tenantId: clickData.tenantId,
        utm: clickData.utm,
        metadata: clickData.metadata
      }
    };

  } catch (error) {
    console.error('[ClickTracking] Install tracking error:', error);
    return {
      success: false,
      attributed: false,
      error: error.message
    };
  }
}

/**
 * Calculate time from click to conversion (in seconds)
 * @param {number} clickTimestampMs 
 * @returns {number} Seconds elapsed
 */
function calculateTimeToConversion(clickTimestampMs) {
  return Math.floor((Date.now() - clickTimestampMs) / 1000);
}

/**
 * Parse user agent string for device info
 * Basic parser - can be enhanced with ua-parser-js library
 * 
 * @param {string} userAgent 
 * @returns {Object} Parsed device info
 */
function parseUserAgent(userAgent = '') {
  const ua = userAgent.toLowerCase();
  
  // Platform detection
  let platform = 'web';
  let os = 'Unknown';
  let browser = 'Unknown';
  let deviceType = 'desktop';

  if (ua.includes('iphone') || ua.includes('ipad')) {
    platform = 'ios';
    os = 'iOS';
    deviceType = ua.includes('ipad') ? 'tablet' : 'mobile';
  } else if (ua.includes('android')) {
    platform = 'android';
    os = 'Android';
    deviceType = ua.includes('mobile') ? 'mobile' : 'tablet';
  } else if (ua.includes('windows')) {
    os = 'Windows';
  } else if (ua.includes('mac')) {
    os = 'macOS';
  } else if (ua.includes('linux')) {
    os = 'Linux';
  }

  // Browser detection
  if (ua.includes('safari') && !ua.includes('chrome')) {
    browser = 'Safari';
  } else if (ua.includes('chrome')) {
    browser = 'Chrome';
  } else if (ua.includes('firefox')) {
    browser = 'Firefox';
  } else if (ua.includes('edge')) {
    browser = 'Edge';
  }

  return {
    platform,
    os,
    browser,
    deviceType,
    rawUserAgent: userAgent
  };
}

/**
 * Get analytics for a link (clicks, installs, conversion rate)
 * 
 * @param {string} linkCode 
 * @param {Object} options
 * @param {Date} options.startDate - Filter by start date
 * @param {Date} options.endDate - Filter by end date
 * @returns {Promise<Object>} Analytics data
 */
async function getLinkAnalytics(linkCode, options = {}) {
  const { startDate, endDate } = options;

  let clickQuery = db.collection('click_events').where('linkCode', '==', linkCode);
  let installQuery = db.collection('install_events').where('linkCode', '==', linkCode);

  if (startDate) {
    const startTimestamp = admin.firestore.Timestamp.fromDate(startDate);
    clickQuery = clickQuery.where('timestamp', '>=', startTimestamp);
    installQuery = installQuery.where('timestamp', '>=', startTimestamp);
  }

  if (endDate) {
    const endTimestamp = admin.firestore.Timestamp.fromDate(endDate);
    clickQuery = clickQuery.where('timestamp', '<=', endTimestamp);
    installQuery = installQuery.where('timestamp', '<=', endTimestamp);
  }

  const [clickSnapshot, installSnapshot] = await Promise.all([
    clickQuery.get(),
    installQuery.get()
  ]);

  const clicks = clickSnapshot.docs.map(doc => doc.data());
  const installs = installSnapshot.docs.map(doc => doc.data());

  // Calculate metrics
  const totalClicks = clicks.length;
  const totalInstalls = installs.length;
  const conversionRate = totalClicks > 0 ? (totalInstalls / totalClicks) * 100 : 0;

  // Platform breakdown
  const platformBreakdown = clicks.reduce((acc, click) => {
    acc[click.platform] = (acc[click.platform] || 0) + 1;
    return acc;
  }, {});

  // UTM breakdown
  const utmSources = {};
  clicks.forEach(click => {
    const source = click.utm?.utm_source || 'direct';
    utmSources[source] = (utmSources[source] || 0) + 1;
  });

  return {
    totalClicks,
    totalInstalls,
    conversionRate: conversionRate.toFixed(2),
    platformBreakdown,
    utmSources,
    clicks: clicks.slice(0, 100), // Recent 100
    installs: installs.slice(0, 100)
  };
}

/**
 * Cleanup expired click events (for scheduled job)
 * Deletes click_events older than 30 days
 * 
 * @returns {Promise<{deleted: number}>}
 */
async function cleanupExpiredClicks() {
  const expiryDate = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
  const expiryTimestamp = admin.firestore.Timestamp.fromDate(expiryDate);

  const expiredSnapshot = await db.collection('click_events')
    .where('timestamp', '<', expiryTimestamp)
    .limit(500) // Batch delete
    .get();

  const batch = db.batch();
  expiredSnapshot.docs.forEach(doc => batch.delete(doc.ref));
  
  if (expiredSnapshot.size > 0) {
    await batch.commit();
    console.log(`[ClickTracking] Cleaned up ${expiredSnapshot.size} expired clicks`);
  }

  return { deleted: expiredSnapshot.size };
}

module.exports = {
  generateClickId,
  trackClick,
  updateClickRedirect,
  trackInstall,
  getLinkAnalytics,
  parseUserAgent,
  cleanupExpiredClicks
};
