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
 * @module api/smartLinks/webhookService
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

        const result = await sendWithRetry({
          targetUrl: subscription.targetUrl,
          secret: subscription.secret,
          eventType,
          payload
        }, doc.id, tenantId);

        // Log webhook delivery
        await db.collection('webhook_deliveries').add({
          subscriptionId: doc.id,
          tenantId,
          eventType,
          targetUrl: subscription.targetUrl,
          success: result.success,
          statusCode: result.statusCode,
          error: result.error,
          sentToDLQ: result.sentToDLQ || false,
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

/**
 * Create a webhook subscription
 * 
 * @param {Object} subscriptionData
 * @param {string} subscriptionData.tenantId - Tenant ID
 * @param {string} subscriptionData.targetUrl - Webhook endpoint URL
 * @param {string} subscriptionData.secret - Webhook secret for HMAC signing
 * @param {string[]} subscriptionData.events - Event types to subscribe to
 * @param {string} subscriptionData.description - Human-readable description
 * @returns {Promise<{subscriptionId: string}>}
 */
async function createWebhookSubscription(subscriptionData) {
  const {
    tenantId,
    targetUrl,
    secret,
    events = [],
    description = ''
  } = subscriptionData;

  if (!tenantId || !targetUrl || !secret) {
    throw new Error('tenantId, targetUrl, and secret are required');
  }

  if (!events || events.length === 0) {
    throw new Error('At least one event type is required');
  }

  // Validate URL
  try {
    new URL(targetUrl);
  } catch {
    throw new Error('Invalid targetUrl');
  }

  const subscription = {
    tenantId,
    targetUrl,
    secret, // Store securely (consider hashing in production)
    events,
    description,
    enabled: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastTriggeredAt: null,
    deliveryCount: 0,
    failureCount: 0
  };

  const subscriptionRef = await db.collection('webhook_subscriptions').add(subscription);

  console.log('[Webhook] Subscription created:', {
    subscriptionId: subscriptionRef.id,
    tenant: tenantId,
    events
  });

  return {
    subscriptionId: subscriptionRef.id,
    ...subscription
  };
}

/**
 * Update webhook subscription
 * 
 * @param {string} subscriptionId 
 * @param {Object} updates 
 * @returns {Promise<Object>}
 */
async function updateWebhookSubscription(subscriptionId, updates) {
  const subscriptionRef = db.collection('webhook_subscriptions').doc(subscriptionId);
  const subscriptionDoc = await subscriptionRef.get();

  if (!subscriptionDoc.exists) {
    throw new Error('Subscription not found');
  }

  await subscriptionRef.update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const updated = await subscriptionRef.get();
  return {
    subscriptionId,
    ...updated.data()
  };
}

/**
 * Delete webhook subscription
 * 
 * @param {string} subscriptionId 
 * @returns {Promise<{success: boolean}>}
 */
async function deleteWebhookSubscription(subscriptionId) {
  await db.collection('webhook_subscriptions').doc(subscriptionId).delete();
  console.log('[Webhook] Subscription deleted:', subscriptionId);
  return { success: true };
}

/**
 * List webhook subscriptions for a tenant
 * 
 * @param {string} tenantId 
 * @returns {Promise<Array>}
 */
async function listWebhookSubscriptions(tenantId) {
  const snapshot = await db.collection('webhook_subscriptions')
    .where('tenantId', '==', tenantId)
    .get();

  return snapshot.docs.map(doc => ({
    subscriptionId: doc.id,
    ...doc.data(),
    secret: '***' // Mask secret in list view
  }));
}

/**
 * Get webhook delivery logs
 * 
 * @param {string} subscriptionId 
 * @param {number} limit 
 * @returns {Promise<Array>}
 */
async function getWebhookDeliveries(subscriptionId, limit = 50) {
  const snapshot = await db.collection('webhook_deliveries')
    .where('subscriptionId', '==', subscriptionId)
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map(doc => ({
    deliveryId: doc.id,
    ...doc.data()
  }));
}

/**
 * Retry failed webhook delivery
 * 
 * @param {string} deliveryId 
 * @returns {Promise<{success: boolean}>}
 */
async function retryWebhookDelivery(deliveryId) {
  const deliveryDoc = await db.collection('webhook_deliveries').doc(deliveryId).get();

  if (!deliveryDoc.exists) {
    throw new Error('Delivery not found');
  }

  const delivery = deliveryDoc.data();

  // Get subscription
  const subscriptionDoc = await db.collection('webhook_subscriptions')
    .doc(delivery.subscriptionId)
    .get();

  if (!subscriptionDoc.exists) {
    throw new Error('Subscription not found');
  }

  const subscription = subscriptionDoc.data();

  // Retry the webhook
  const result = await sendWebhook({
    targetUrl: subscription.targetUrl,
    secret: subscription.secret,
    eventType: delivery.eventType,
    payload: delivery.payload || {},
    attempt: (delivery.attempt || 1) + 1
  });

  // Log retry
  await db.collection('webhook_deliveries').add({
    ...delivery,
    retry: true,
    retryOf: deliveryId,
    attempt: (delivery.attempt || 1) + 1,
    success: result.success,
    statusCode: result.statusCode,
    error: result.error,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return result;
}

// ============================================================================
// DEAD LETTER QUEUE + AUTOMATIC RETRY
// ============================================================================

const MAX_AUTO_RETRIES = 12;
const DLQ_RETENTION_DAYS = 7;

function getRetryDelay(attempt) {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 512s, 1024s, 2048s
  return Math.min(Math.pow(2, attempt - 1) * 1000, 2048000);
}

/**
 * Send webhook with automatic retry and DLQ
 * Stores failed deliveries to dead_letter_webhooks after MAX_AUTO_RETRIES
 */
async function sendWithRetry(params, subscriptionId, tenantId) {
  const { targetUrl, secret, eventType, payload } = params;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_AUTO_RETRIES; attempt++) {
    const result = await sendWebhook({ targetUrl, secret, eventType, payload, attempt });

    if (result.success) {
      return { success: true, attempts: attempt };
    }

    lastError = result.error || `HTTP ${result.statusCode}`;

    // Don't retry 4xx errors (client error, won't resolve with retry)
    if (result.statusCode && result.statusCode >= 400 && result.statusCode < 500) {
      break;
    }

    if (attempt < MAX_AUTO_RETRIES) {
      const delay = getRetryDelay(attempt);
      await new Promise(resolve => setTimeout(resolve, Math.min(delay, 5000)));
    }
  }

  // All retries exhausted — write to dead letter queue
  await db.collection('dead_letter_webhooks').add({
    subscriptionId,
    tenantId,
    eventType,
    payload,
    targetUrl,
    lastError,
    attempts: MAX_AUTO_RETRIES,
    failedAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + DLQ_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  });

  // Increment failure count on subscription
  if (subscriptionId) {
    await db.collection('webhook_subscriptions').doc(subscriptionId).update({
      failureCount: admin.firestore.FieldValue.increment(1),
      lastFailedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  console.log(`[Webhook DLQ] Permanently failed: ${targetUrl} (${eventType}) — ${lastError}`);
  return { success: false, error: lastError, sentToDLQ: true };
}

/**
 * Get dead letter queue entries for a tenant
 */
async function getDeadLetterQueue(tenantId, limit = 50) {
  const snapshot = await db.collection('dead_letter_webhooks')
    .where('tenantId', '==', tenantId)
    .orderBy('failedAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
}

/**
 * Replay a dead letter entry (manual retry from DLQ)
 */
async function replayDeadLetter(deadLetterId) {
  const doc = await db.collection('dead_letter_webhooks').doc(deadLetterId).get();
  if (!doc.exists) throw new Error('Dead letter entry not found');

  const entry = doc.data();
  const subDoc = await db.collection('webhook_subscriptions').doc(entry.subscriptionId).get();
  if (!subDoc.exists) throw new Error('Subscription no longer exists');

  const subscription = subDoc.data();
  const result = await sendWebhook({
    targetUrl: entry.targetUrl,
    secret: subscription.secret,
    eventType: entry.eventType,
    payload: entry.payload,
    attempt: entry.attempts + 1
  });

  if (result.success) {
    await db.collection('dead_letter_webhooks').doc(deadLetterId).delete();
  }

  return result;
}

module.exports = {
  EVENT_TYPES,
  sendWebhook,
  sendWithRetry,
  triggerWebhooks,
  createWebhookSubscription,
  updateWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookSubscriptions,
  getWebhookDeliveries,
  retryWebhookDelivery,
  getDeadLetterQueue,
  replayDeadLetter,
  generateSignature
};
