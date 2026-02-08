/**
 * Click Tracking & Attribution Service
 * Core click-to-install attribution funnel for Kortex links.
 *
 * @module api/kortex/clickTracking
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const db = admin.firestore();
const { FieldValue } = require('firebase-admin/firestore');
const { parseUserAgent, calculateTimeToConversion } = require('./clickAnalytics');

// Lazy import webhook service (circular dependency guard)
let webhookService = null;
function getWebhookService() {
  if (!webhookService) webhookService = require('./webhookService');
  return webhookService;
}

/** Fire-and-forget webhook trigger */
function fireWebhook(tenantId, eventType, payload) {
  try {
    const wh = getWebhookService();
    wh.triggerWebhooks({ tenantId, eventType: wh.EVENT_TYPES[eventType], payload })
      .catch(err => console.error('[ClickTracking] Webhook trigger failed:', err));
  } catch (_) { /* ignore */ }
}

/**
 * Generate unique click ID (c_<16 hex chars>)
 * @returns {string}
 */
function generateClickId() {
  return `c_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Track a click event with full context
 * @param {Object} params - linkCode, tenantId, platform, userAgent, ip, referrer, utm, metadata
 * @returns {Promise<{clickId: string, timestamp: Date}>}
 */
async function trackClick(params) {
  const { linkCode, tenantId, platform, userAgent, ip, referrer, utm = {}, metadata = {} } = params;
  const clickId = generateClickId();
  const timestamp = new Date();
  const deviceInfo = parseUserAgent(userAgent);

  const clickEvent = {
    clickId, linkCode, tenantId,
    timestamp: FieldValue.serverTimestamp(),
    timestampMs: timestamp.getTime(),
    platform, deviceInfo, userAgent, ip,
    referrer: referrer || null, utm,
    redirectedTo: null, installAttributed: false, installTimestamp: null,
    metadata,
    expiresAt: admin.firestore.Timestamp.fromMillis(timestamp.getTime() + (30 * 24 * 60 * 60 * 1000))
  };

  await db.collection('click_events').doc(clickId).set(clickEvent);
  console.log('[ClickTracking] Tracked click:', { clickId, linkCode, platform, tenant: tenantId });

  fireWebhook(tenantId, 'CLICK', {
    event: 'link.clicked', clickId, linkCode, platform,
    timestamp: new Date().toISOString(), deviceInfo, utm
  });

  return { clickId, timestamp };
}

/**
 * Update click event with redirect destination
 * @param {string} clickId
 * @param {string} destination
 */
async function updateClickRedirect(clickId, destination) {
  try {
    await db.collection('click_events').doc(clickId).update({
      redirectedTo: destination, redirectTimestamp: FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('[ClickTracking] Failed to update redirect:', error);
  }
}

/**
 * Track install event and attribute to originating click
 * @param {Object} params - clickId, deviceId, platform, appVersion, metadata
 * @returns {Promise<{success: boolean, attributed: boolean, context?: Object}>}
 */
async function trackInstall(params) {
  const { clickId, deviceId, platform, appVersion, metadata = {} } = params;
  if (!clickId) return { success: false, attributed: false, error: 'clickId required' };

  try {
    const clickDoc = await db.collection('click_events').doc(clickId).get();
    if (!clickDoc.exists) {
      console.warn('[ClickTracking] Install without valid click:', clickId);
      return { success: true, attributed: false, error: 'Click not found' };
    }

    const clickData = clickDoc.data();

    // Idempotent - already attributed
    if (clickData.installAttributed) {
      return { success: true, attributed: true, isNewInstall: false, context: clickData };
    }

    // Mark click as attributed
    await clickDoc.ref.update({
      installAttributed: true, installTimestamp: FieldValue.serverTimestamp(),
      installDeviceId: deviceId, installPlatform: platform,
      installAppVersion: appVersion, installMetadata: metadata
    });

    // Bump install counter on link
    await db.collection('short_links').doc(clickData.linkCode).update({
      installCount: FieldValue.increment(1), lastInstallAt: FieldValue.serverTimestamp()
    });

    // Analytics event
    await db.collection('install_events').add({
      clickId, linkCode: clickData.linkCode, tenantId: clickData.tenantId,
      deviceId, platform, appVersion,
      timestamp: FieldValue.serverTimestamp(), clickTimestamp: clickData.timestamp,
      timeToConversion: calculateTimeToConversion(clickData.timestampMs),
      utm: clickData.utm, metadata
    });

    console.log('[ClickTracking] Install attributed:', { clickId, linkCode: clickData.linkCode, platform });

    fireWebhook(clickData.tenantId, 'INSTALL', {
      event: 'app.installed', clickId, linkCode: clickData.linkCode,
      deviceId, platform, appVersion,
      timestamp: new Date().toISOString(), utm: clickData.utm
    });

    return {
      success: true, attributed: true, isNewInstall: true,
      context: {
        linkCode: clickData.linkCode, tenantId: clickData.tenantId,
        utm: clickData.utm, metadata: clickData.metadata
      }
    };
  } catch (error) {
    console.error('[ClickTracking] Install tracking error:', error);
    return { success: false, attributed: false, error: error.message };
  }
}

module.exports = { generateClickId, trackClick, updateClickRedirect, trackInstall };
