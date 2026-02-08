/**
 * Attribution & Resolution Service
 * 
 * Handles install attribution and deferred deep linking resolution.
 * Called by mobile apps after installation to retrieve context and attribute installs.
 * 
 * Features:
 * - Click-to-install attribution via clickId
 * - Deferred deep link context resolution
 * - Install event tracking
 * - Conversion metrics calculation
 * 
 * @module api/kortex/attributionService
 */

const admin = require('firebase-admin');
const { trackInstall } = require('./clickTracking');

const db = admin.firestore();

/**
 * Resolve context and attribute install
 * Primary endpoint called by mobile apps on first open after install
 * 
 * @param {Object} params
 * @param {string} params.clickId - Click ID from deep link URL
 * @param {string} params.deviceId - Stable device identifier
 * @param {string} params.platform - ios|android
 * @param {string} params.appVersion - App version string
 * @param {string} params.userId - Optional user ID (if logged in)
 * @param {Object} params.metadata - Additional app metadata
 * @returns {Promise<Object>} Resolution result with context
 */
async function resolveContext(params) {
  const {
    clickId,
    deviceId,
    platform,
    appVersion,
    userId = null,
    metadata = {}
  } = params;

  console.log('[Attribution] Resolving context:', { clickId, deviceId, platform });

  // If no clickId, check for legacy cookie-based resolution
  if (!clickId) {
    return resolveLegacyContext(params);
  }

  try {
    // Track install and get attribution
    const attribution = await trackInstall({
      clickId,
      deviceId,
      platform,
      appVersion,
      metadata: {
        ...metadata,
        userId
      }
    });

    if (!attribution.success) {
      return {
        success: false,
        source: 'attribution_failed',
        error: attribution.error,
        timestamp: new Date().toISOString()
      };
    }

    // Get full link context
    const context = attribution.context || {};

    // If attributed, fetch full link details
    if (attribution.attributed && context.linkCode) {
      const linkDoc = await db.collection('short_links').doc(context.linkCode).get();
      
      if (linkDoc.exists) {
        const linkData = linkDoc.data();
        
        return {
          success: true,
          source: 'click_attribution',
          attributed: true,
          isNewInstall: attribution.isNewInstall,
          context: {
            // Link info
            linkCode: context.linkCode,
            shortUrl: linkData.shortUrl,
            title: linkData.title,
            description: linkData.description,
            
            // Destinations (for routing)
            destinations: linkData.destinations,
            
            // Attribution data
            tenantId: context.tenantId,
            utm: context.utm || {},
            metadata: context.metadata || {},
            
            // Campaign info
            campaign: linkData.utm?.utm_campaign,
            source: linkData.utm?.utm_source,
            medium: linkData.utm?.utm_medium
          },
          timestamp: new Date().toISOString()
        };
      }
    }

    // Click found but no link details
    return {
      success: true,
      source: 'click_attribution',
      attributed: attribution.attributed,
      isNewInstall: attribution.isNewInstall,
      context: context || {},
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('[Attribution] Resolution error:', error);
    return {
      success: false,
      source: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Legacy context resolution (cookie-based, backward compatibility)
 * Falls back to ctx_tokens collection lookup
 * 
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function resolveLegacyContext(params) {
  const { ctxId, locationData } = params;

  // Try cookie-based location data first
  if (locationData) {
    try {
      const location = typeof locationData === 'string' 
        ? JSON.parse(locationData) 
        : locationData;
      
      return {
        success: true,
        source: 'cache',
        attributed: false,
        context: location,
        timestamp: new Date().toISOString()
      };
    } catch (parseError) {
      console.error('[Attribution] Failed to parse location data:', parseError);
    }
  }

  // Try database lookup via ctx_tokens
  if (ctxId) {
    try {
      const ctxDoc = await db.collection('ctx_tokens').doc(ctxId).get();
      
      if (ctxDoc.exists) {
        return {
          success: true,
          source: 'database',
          attributed: false,
          context: ctxDoc.data().params || {},
          timestamp: new Date().toISOString()
        };
      }
    } catch (dbError) {
      console.error('[Attribution] Database lookup error:', dbError);
    }
  }

  // No context found
  return {
    success: false,
    source: 'not_found',
    attributed: false,
    error: 'No context available',
    message: 'App opened without attribution context. This is normal for organic installs.',
    timestamp: new Date().toISOString()
  };
}

/**
 * Get attribution stats for a link
 * Returns click-to-install conversion metrics
 * 
 * @param {string} linkCode 
 * @returns {Promise<Object>}
 */
async function getAttributionStats(linkCode) {
  const linkDoc = await db.collection('short_links').doc(linkCode).get();
  
  if (!linkDoc.exists) {
    throw new Error('Link not found');
  }

  const linkData = linkDoc.data();
  
  // Get install events
  const installsSnapshot = await db.collection('install_events')
    .where('linkCode', '==', linkCode)
    .get();

  const installs = installsSnapshot.docs.map(doc => doc.data());

  // Calculate metrics
  const clickCount = linkData.clickCount || 0;
  const installCount = linkData.installCount || 0;
  const conversionRate = clickCount > 0 ? (installCount / clickCount) * 100 : 0;

  // Platform breakdown
  const platformBreakdown = installs.reduce((acc, install) => {
    acc[install.platform] = (acc[install.platform] || 0) + 1;
    return acc;
  }, {});

  // Average time to conversion
  const avgTimeToConversion = installs.length > 0
    ? installs.reduce((sum, i) => sum + (i.timeToConversion || 0), 0) / installs.length
    : 0;

  return {
    linkCode,
    clickCount,
    installCount,
    conversionRate: conversionRate.toFixed(2),
    platformBreakdown,
    avgTimeToConversion: Math.floor(avgTimeToConversion),
    recentInstalls: installs.slice(0, 10) // Last 10 installs
  };
}

module.exports = {
  resolveContext,
  resolveLegacyContext,
  getAttributionStats
};
