/**
 * Attribution Custom Events
 * Split from attributionService.js — custom funnel event tracking.
 *
 * @module api/kortex/attributionEvents
 */

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Track a custom event (for additional funnel tracking)
 * E.g., 'signup', 'purchase', 'engagement'
 *
 * @param {Object} params
 * @param {string} params.eventType - Type of event
 * @param {string} params.clickId - Original click ID
 * @param {string} params.deviceId - Device identifier
 * @param {Object} params.eventData - Event-specific data
 * @returns {Promise<{success: boolean}>}
 */
async function trackCustomEvent(params) {
  const { eventType, clickId, deviceId, eventData = {} } = params;

  try {
    let linkCode = null, tenantId = null;

    if (clickId) {
      const clickDoc = await db.collection('click_events').doc(clickId).get();
      if (clickDoc.exists) {
        const data = clickDoc.data();
        linkCode = data.linkCode;
        tenantId = data.tenantId;
      }
    }

    await db.collection('custom_events').add({
      eventType, clickId: clickId || null, linkCode, tenantId, deviceId, eventData,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('[Attribution] Custom event tracked:', { eventType, clickId, linkCode });
    return { success: true };
  } catch (error) {
    console.error('[Attribution] Custom event tracking error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { trackCustomEvent };
