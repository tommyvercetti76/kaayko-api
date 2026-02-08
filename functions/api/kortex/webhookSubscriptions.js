/**
 * Webhook Subscription Management
 * Split from webhookService.js — CRUD for subscriptions, delivery logs, retries.
 *
 * @module api/kortex/webhookSubscriptions
 */

const admin = require('firebase-admin');
const db = admin.firestore();
const { sendWebhook } = require('./webhookService');

/**
 * Create a webhook subscription
 * @param {Object} data
 * @returns {Promise<{subscriptionId: string}>}
 */
async function createWebhookSubscription(data) {
  const { tenantId, targetUrl, secret, events = [], description = '' } = data;
  if (!tenantId || !targetUrl || !secret) throw new Error('tenantId, targetUrl, and secret are required');
  if (!events || events.length === 0) throw new Error('At least one event type is required');
  try { new URL(targetUrl); } catch { throw new Error('Invalid targetUrl'); }

  const subscription = {
    tenantId, targetUrl, secret, events, description, enabled: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastTriggeredAt: null, deliveryCount: 0, failureCount: 0
  };
  const ref = await db.collection('webhook_subscriptions').add(subscription);
  console.log('[Webhook] Subscription created:', { subscriptionId: ref.id, tenant: tenantId, events });
  return { subscriptionId: ref.id, ...subscription };
}

/**
 * Update webhook subscription
 * @param {string} subscriptionId
 * @param {Object} updates
 * @returns {Promise<Object>}
 */
async function updateWebhookSubscription(subscriptionId, updates) {
  const ref = db.collection('webhook_subscriptions').doc(subscriptionId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Subscription not found');
  await ref.update({ ...updates, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  const updated = await ref.get();
  return { subscriptionId, ...updated.data() };
}

/**
 * Delete webhook subscription
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
 * @param {string} tenantId
 * @returns {Promise<Array>}
 */
async function listWebhookSubscriptions(tenantId) {
  const snap = await db.collection('webhook_subscriptions').where('tenantId', '==', tenantId).get();
  return snap.docs.map(d => ({ subscriptionId: d.id, ...d.data(), secret: '***' }));
}

/**
 * Get webhook delivery logs
 * @param {string} subscriptionId
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getWebhookDeliveries(subscriptionId, limit = 50) {
  const snap = await db.collection('webhook_deliveries')
    .where('subscriptionId', '==', subscriptionId)
    .orderBy('timestamp', 'desc').limit(limit).get();
  return snap.docs.map(d => ({ deliveryId: d.id, ...d.data() }));
}

/**
 * Retry failed webhook delivery
 * @param {string} deliveryId
 * @returns {Promise<{success: boolean}>}
 */
async function retryWebhookDelivery(deliveryId) {
  const deliveryDoc = await db.collection('webhook_deliveries').doc(deliveryId).get();
  if (!deliveryDoc.exists) throw new Error('Delivery not found');
  const delivery = deliveryDoc.data();

  const subDoc = await db.collection('webhook_subscriptions').doc(delivery.subscriptionId).get();
  if (!subDoc.exists) throw new Error('Subscription not found');
  const sub = subDoc.data();

  const result = await sendWebhook({
    targetUrl: sub.targetUrl, secret: sub.secret, eventType: delivery.eventType,
    payload: delivery.payload || {}, attempt: (delivery.attempt || 1) + 1
  });

  await db.collection('webhook_deliveries').add({
    ...delivery, retry: true, retryOf: deliveryId, attempt: (delivery.attempt || 1) + 1,
    success: result.success, statusCode: result.statusCode, error: result.error,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return result;
}

module.exports = {
  createWebhookSubscription, updateWebhookSubscription, deleteWebhookSubscription,
  listWebhookSubscriptions, getWebhookDeliveries, retryWebhookDelivery
};
