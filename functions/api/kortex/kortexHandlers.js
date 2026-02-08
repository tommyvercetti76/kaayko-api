/**
 * Kortex CRUD + Event Handlers
 * Extracted from kortex.js for primer compliance (router ≤150 lines).
 *
 * @module api/kortex/kortexHandlers
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();

const LinkService = require('./kortexService');
const { sendLinkCreatedNotification } = require('../../services/emailNotificationService');
const { triggerWebhooks, EVENT_TYPES } = require('./webhookService');

// ── Stats ────────────────────────────────────────────────────────────

async function getStats(req, res) {
  try {
    const stats = await LinkService.getLinkStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('[Kortex] Error fetching stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
}

// ── Create ───────────────────────────────────────────────────────────

async function createLink(req, res) {
  try {
    const linkData = {
      ...req.body,
      createdBy: req.user.email || req.user.uid,
      tenantId: 'kaayko-default',
      tenantName: 'Kaayko',
      domain: req.body.domain || 'kaayko.com',
      pathPrefix: req.body.pathPrefix || '/l'
    };

    const link = await LinkService.createShortLink(linkData);

    // Async email notification (non-blocking)
    sendLinkCreatedNotification(link, req.user)
      .then(r => r.success
        ? console.log('✅ Email notification sent:', r.messageId)
        : console.error('⚠️ Email notification failed:', r.error))
      .catch(err => console.error('⚠️ Email notification error:', err));

    // Async webhook trigger (non-blocking)
    triggerWebhooks({
      tenantId: 'kaayko-default',
      eventType: EVENT_TYPES.LINK_CREATED,
      payload: {
        event: 'link.created',
        link: { code: link.code, shortUrl: link.shortUrl, title: link.title, destinations: link.destinations, createdBy: link.createdBy, createdAt: link.createdAt },
        timestamp: new Date().toISOString()
      }
    }).catch(err => console.error('⚠️ Webhook trigger error:', err));

    res.json({ success: true, link, message: `Short link created: ${link.shortUrl}` });
  } catch (error) {
    console.error('[Kortex] Error creating short link:', error);
    if (error.code === 'ALREADY_EXISTS') {
      return res.status(409).json({ success: false, error: error.message, existing: error.existing });
    }
    res.status(400).json({ success: false, error: error.message || 'Failed to create link' });
  }
}

// ── List ─────────────────────────────────────────────────────────────

async function listLinks(req, res) {
  try {
    const { enabled, limit } = req.query;
    const filters = {};
    if (enabled !== undefined) filters.enabled = enabled === 'true';
    if (limit) filters.limit = parseInt(limit, 10);

    const result = await LinkService.listLinks(filters);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Kortex] Error listing links:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch links', message: error.message });
  }
}

// ── Get ──────────────────────────────────────────────────────────────

async function getLink(req, res) {
  try {
    const link = await LinkService.getShortLink(req.params.code);
    res.json({ success: true, link });
  } catch (error) {
    console.error('[Kortex] Error fetching link:', error);
    if (error.code === 'NOT_FOUND') return res.status(404).json({ success: false, error: 'Short code not found' });
    res.status(500).json({ success: false, error: 'Failed to fetch link' });
  }
}

// ── Update ───────────────────────────────────────────────────────────

async function updateLink(req, res) {
  try {
    const link = await LinkService.updateShortLink(req.params.code, req.body);
    res.json({ success: true, link });
  } catch (error) {
    console.error('[Kortex] Error updating link:', error);
    if (error.code === 'NOT_FOUND') return res.status(404).json({ success: false, error: 'Link not found' });
    res.status(500).json({ success: false, error: 'Failed to update link' });
  }
}

// ── Delete ───────────────────────────────────────────────────────────

async function deleteLink(req, res) {
  try {
    const result = await LinkService.deleteShortLink(req.params.code);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Kortex] Error deleting link:', error);
    if (error.code === 'NOT_FOUND') return res.status(404).json({ success: false, error: 'Link not found' });
    res.status(500).json({ success: false, error: 'Failed to delete link' });
  }
}

// ── Track Event ──────────────────────────────────────────────────────

async function trackEvent(req, res) {
  try {
    const { type } = req.params;
    const { linkId, userId, platform, metadata = {} } = req.body;

    if (!linkId) return res.status(400).json({ success: false, error: 'linkId is required' });

    await db.collection('link_analytics').add({
      type, linkId, userId: userId || null, platform: platform || 'unknown',
      metadata, timestamp: FieldValue.serverTimestamp()
    });

    if (type === 'install') {
      const linkRef = db.collection('short_links').doc(linkId);
      const linkDoc = await linkRef.get();
      if (linkDoc.exists) await linkRef.update({ installCount: FieldValue.increment(1) });
    }

    res.json({ success: true, message: `${type} event tracked` });
  } catch (error) {
    console.error('[Kortex] Error tracking event:', error);
    res.status(500).json({ success: false, error: 'Failed to track event' });
  }
}

module.exports = { getStats, createLink, listLinks, getLink, updateLink, deleteLink, trackEvent };
