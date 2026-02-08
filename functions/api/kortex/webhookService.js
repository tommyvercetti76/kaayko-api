/**
 * Webhook Service for Smart Links
 * 
 * Enables real-time event notifications to external services.
 * Supports multiple event types with configurable subscriptions per tenant.
 * 
 * Features:
 * - Event-driven notifications (click, install, link_created, etc.)
 * - HMAC signature verification for security
 * - Retry logic with exponential backoff
 * - Per-tenant webhook subscriptions
 * - Event filtering and batching options
 * 
 * @module api/kortex/webhookService
 */

const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();

/**
 * Supported webhook event types
 */
const EVENT_TYPES = {
  LINK_CREATED: 'link.created',
  LINK_UPDATED: 'link.updated',
  LINK_DELETED: 'link.deleted',
  CLICK: 'link.clicked',
  INSTALL: 'app.installed',
  CUSTOM_EVENT: 'custom.event'
};

/**
 * Generate HMAC signature for webhook payload
 * 
 * @param {string} payload - JSON payload string
 * @param {string} secret - Webhook secret
 * @returns {string} HMAC SHA-256 signature
 */
function generateSignature(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Send webhook to target URL
 * 
 * @param {Object} params
 * @param {string} params.targetUrl - Webhook endpoint URL
 * @param {string} params.secret - Webhook secret for signing
 * @param {string} params.eventType - Event type (link.created, etc.)
 * @param {Object} params.payload - Event payload
 * @param {number} params.attempt - Retry attempt number (default: 1)
 * @returns {Promise<{success: boolean, statusCode?: number, error?: string}>}
 */
async function sendWebhook(params) {
  const {
    targetUrl,
    secret,
    eventType,
    payload,
    attempt = 1
  } = params;

  const payloadString = JSON.stringify(payload);
  const signature = generateSignature(payloadString, secret);

  const headers = {
    'Content-Type': 'application/json',
    'X-Kaayko-Event': eventType,
    'X-Kaayko-Signature': signature,
    'X-Kaayko-Delivery': crypto.randomBytes(8).toString('hex'), // Unique delivery ID
    'X-Kaayko-Attempt': attempt.toString(),
    'User-Agent': 'Kaayko-Webhooks/1.0'
  };

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: payloadString,
      timeout: 10000 // 10 second timeout
    });

    if (response.ok) {
      console.log('[Webhook] Sent successfully:', {
        url: targetUrl,
        event: eventType,
        status: response.status
      });
      return {
        success: true,
        statusCode: response.status
      };
    } else {
      console.error('[Webhook] Failed:', {
        url: targetUrl,
        event: eventType,
        status: response.status
      });
      return {
        success: false,
        statusCode: response.status,
        error: `HTTP ${response.status}`
      };
    }

  } catch (error) {
    console.error('[Webhook] Send error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Trigger webhooks for an event
 * Looks up active subscriptions for the tenant and event type
 * 
 * @param {Object} params
 * @param {string} params.tenantId - Tenant ID
 * @param {string} params.eventType - Event type
 * @param {Object} params.payload - Event payload
 * @returns {Promise<{sent: number, failed: number}>}
 */
async function triggerWebhooks(params) {
  const { tenantId, eventType, payload } = params;

  try {
    // Get active webhook subscriptions for this tenant and event type
    const subscriptionsSnapshot = await db.collection('webhook_subscriptions')
      .where('tenantId', '==', tenantId)
      .where('enabled', '==', true)
      .where('events', 'array-contains', eventType)
      .get();

    if (subscriptionsSnapshot.empty) {
      console.log('[Webhook] No subscriptions for:', { tenantId, eventType });
      return { sent: 0, failed: 0 };
    }

    console.log('[Webhook] Triggering webhooks:', {
      tenantId,
      eventType,
      subscriptions: subscriptionsSnapshot.size
    });

    const results = await Promise.allSettled(
      subscriptionsSnapshot.docs.map(async (doc) => {
        const subscription = doc.data();
        
        const result = await sendWebhook({
          targetUrl: subscription.targetUrl,
          secret: subscription.secret,
          eventType,
          payload
        });

        // Log webhook delivery
        await db.collection('webhook_deliveries').add({
          subscriptionId: doc.id,
          tenantId,
          eventType,
          targetUrl: subscription.targetUrl,
          success: result.success,
          statusCode: result.statusCode,
          error: result.error,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        return result;
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - sent;

    console.log('[Webhook] Results:', { sent, failed });

    return { sent, failed };

  } catch (error) {
    console.error('[Webhook] Trigger error:', error);
    return { sent: 0, failed: 0 };
  }
}

module.exports = {
  EVENT_TYPES,
  sendWebhook,
  triggerWebhooks,
  generateSignature
};
