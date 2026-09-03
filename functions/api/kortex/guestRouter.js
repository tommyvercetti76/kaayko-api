/**
 * Guest (no-account) routes — mounted at /kortex/guest.
 *
 *   POST   /links                  create a dynamic link + QR; new workspace when no session
 *   POST   /session                exchange an access code for a session token
 *   GET    /workspace              links + limits for the session's workspace
 *   GET    /links/:code            one link
 *   GET    /links/:code/analytics  7-day analytics + lifetime totals
 *   PATCH  /links/:code            destinations / title / enabled
 *   DELETE /links/:code
 *   POST   /email                  attach an email; rotates the code and mails the new one
 *   POST   /rotate                 new access code (returned once)
 *   POST   /recover                email a fresh code to a workspace's address (always 202)
 *   POST   /claim                  attach a signed-in (paid path) user to a guest workspace
 *
 * Everything a guest can touch is scoped to the workspace on the session
 * token; a link that belongs to anyone else answers 404.
 *
 * @module api/kortex/guestRouter
 */

'use strict';

const express = require('express');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const LinkService = require('./smartLinkService');
const guest = require('./guestAccess');
const { generateQR } = require('./qrService');
const { getLinkAnalytics } = require('./linkAnalytics');
const { recordAudit } = require('./auditLog');
const { rateLimiter } = require('../../middleware/securityMiddleware');
const { requireAuth } = require('../../middleware/authMiddleware');
const email = require('../../services/emailDelivery');
const { PLAN_LIMITS } = require('../billing/planLimits');

const router = express.Router();
const db = admin.firestore();

const ANALYTICS_WINDOW_DAYS = PLAN_LIMITS.starter.analytics_range_days;
const DESTINATION_MAX = 2048;
const QR_BASE = 'https://kaayko.com/qr';

function cleanUrl(value) {
  return typeof value === 'string' ? value.trim().slice(0, DESTINATION_MAX) : '';
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return 'My link'; }
}

function publicLink(link) {
  const code = link.code || link.id;
  return {
    code,
    shortUrl: link.shortUrl || `https://kaayko.com/l/${code}`,
    qrUrl: `${QR_BASE}/${code}.png`,
    title: link.title || '',
    destinations: link.destinations || {},
    status: link.status || 'active',
    enabled: link.enabled !== false,
    clickCount: link.clickCount || 0,
    lastClickedAt: link.lastClickedAt?.toDate ? link.lastClickedAt.toDate().toISOString() : (link.lastClickedAt || null),
    createdAt: link.createdAt?.toDate ? link.createdAt.toDate().toISOString() : (link.createdAt || null),
    disabledReason: link.disabledReason || null
  };
}

function guestError(res, error) {
  const map = {
    GUEST_NOT_CONFIGURED: 503,
    INVALID_ACCESS_CODE: 401,
    ACCESS_CODE_LOCKED: 429,
    WORKSPACE_DISABLED: 403,
    VALIDATION_ERROR: 400,
    NOT_FOUND: 404,
    DESTINATION_BLOCKED: 422,
    INVALID_URL: 422,
    INVALID_CODE: 422,
    ALREADY_EXISTS: 409,
    PLAN_LIMIT_EXCEEDED: 403,
    DOMAIN_NOT_ALLOWED: 403,
    DOMAIN_NOT_WHITELISTED: 403
  };
  const status = map[error.code] || 500;
  if (status === 500) console.error('[Guest] unexpected error:', error);
  return res.status(status).json({
    success: false,
    error: status === 500 ? 'Something went wrong. Please try again.' : error.message,
    code: error.code || 'GUEST_ERROR',
    reasons: error.reasons || undefined
  });
}

async function countLinks(tenantId) {
  const limit = guest.guestLinkLimit();
  const snapshot = await db.collection('short_links').where('tenantId', '==', tenantId).limit(limit + 1).get();
  return snapshot.size;
}

/** Load a link and confirm it belongs to the session's workspace; 404 otherwise. */
async function ownedLink(req, res) {
  const code = String(req.params.code || '').trim();
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(code)) {
    res.status(404).json({ success: false, error: 'Link not found', code: 'NOT_FOUND' });
    return null;
  }
  let link;
  try {
    link = await LinkService.getShortLink(code);
  } catch (_) {
    res.status(404).json({ success: false, error: 'Link not found', code: 'NOT_FOUND' });
    return null;
  }
  if (link.tenantId !== req.guest.tenantId) {
    res.status(404).json({ success: false, error: 'Link not found', code: 'NOT_FOUND' });
    return null;
  }
  return link;
}

// ─── Create ───────────────────────────────────────────────────────────────────

router.post('/links', rateLimiter('guestCreate'), async (req, res) => {
  const body = req.body || {};
  // Honeypot: real forms never fill this field.
  if (body.website) return res.status(400).json({ success: false, error: 'Invalid request', code: 'VALIDATION_ERROR' });

  const web = cleanUrl(body.destination || body.webDestination || body.url);
  const ios = cleanUrl(body.iosDestination);
  const android = cleanUrl(body.androidDestination);
  if (!web && !ios && !android) {
    return res.status(400).json({ success: false, error: 'A destination URL is required', code: 'VALIDATION_ERROR' });
  }
  const title = String(body.title || '').trim().slice(0, 120) || hostnameOf(web || ios || android);
  const contactEmail = typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase().slice(0, 200) : null;
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return res.status(400).json({ success: false, error: 'That email address does not look right', code: 'VALIDATION_ERROR' });
  }

  let workspace = null;
  let created = null;
  try {
    workspace = await guest.resolveGuestSession(req);
    if (!workspace) {
      created = await guest.createGuestWorkspace({ email: contactEmail, req });
      workspace = { tenantId: created.tenantId, tenant: { id: created.tenantId, ...created.tenant } };
    }

    const link = await LinkService.createShortLink({
      webDestination: web || null,
      iosDestination: ios || null,
      androidDestination: android || null,
      title,
      createdBy: 'guest',
      tenantId: workspace.tenantId,
      tenantName: 'Free workspace',
      domain: 'kaayko.com',
      pathPrefix: '/l',
      source: 'qr',
      metadata: { createdVia: 'guest' }
    });

    recordAudit({
      req,
      actor: { type: 'guest', workspace: workspace.tenantId },
      action: 'link.created',
      code: link.code,
      tenantId: workspace.tenantId,
      after: link,
      extra: { path: 'guest', newWorkspace: !!created }
    });

    const [qrPng, linkCount] = await Promise.all([
      generateQR(link.shortUrl, { size: 512 }),
      countLinks(workspace.tenantId)
    ]);

    const response = {
      success: true,
      link: publicLink(link),
      qr: { png: qrPng },
      session: guest.issueSession(workspace.tenant),
      workspace: guest.workspaceSummary(workspace.tenant, { linkCount }),
      isNewWorkspace: !!created
    };

    if (created) {
      response.accessCode = created.accessCode;
      if (contactEmail) {
        const delivery = await email.sendGuestAccessCode({
          to: contactEmail,
          accessCode: created.accessCode,
          link,
          lifetimeDays: guest.guestLifetimeDays(),
          analyticsDays: ANALYTICS_WINDOW_DAYS
        });
        response.emailDelivery = delivery.status;
      }
    }

    return res.status(201).json(response);
  } catch (error) {
    // Never leave an empty workspace behind when the first link was refused.
    if (created) {
      db.collection('tenants').doc(created.tenantId).delete().catch(() => {});
    }
    return guestError(res, error);
  }
});

// ─── Session ──────────────────────────────────────────────────────────────────

router.post('/session', rateLimiter('guestSession'), async (req, res) => {
  try {
    const { accessCode } = req.body || {};
    if (!accessCode || typeof accessCode !== 'string' || accessCode.length > 64) {
      return res.status(400).json({ success: false, error: 'Enter your access code', code: 'VALIDATION_ERROR' });
    }
    const { tenantId, tenant, revivedLinks } = await guest.verifyAccessCode(accessCode);
    const linkCount = await countLinks(tenantId);
    recordAudit({ req, actor: { type: 'guest', workspace: tenantId }, action: 'guest.session', tenantId, extra: { revivedLinks } });
    return res.json({
      success: true,
      session: guest.issueSession({ id: tenantId, ...tenant }),
      workspace: guest.workspaceSummary({ id: tenantId, ...tenant }, { linkCount }),
      revivedLinks
    });
  } catch (error) {
    return guestError(res, error);
  }
});

router.get('/workspace', guest.requireGuestSession, async (req, res) => {
  try {
    const { links } = await LinkService.listLinks({ tenantId: req.guest.tenantId, limit: 100 });
    return res.json({
      success: true,
      workspace: guest.workspaceSummary(req.guest.tenant, { linkCount: links.length }),
      links: links.map(publicLink)
    });
  } catch (error) {
    return guestError(res, error);
  }
});

// ─── Links ────────────────────────────────────────────────────────────────────

router.get('/links/:code', guest.requireGuestSession, async (req, res) => {
  const link = await ownedLink(req, res);
  if (!link) return;
  return res.json({ success: true, link: publicLink(link) });
});

router.get('/links/:code/analytics', guest.requireGuestSession, async (req, res) => {
  const link = await ownedLink(req, res);
  if (!link) return;
  try {
    const analytics = await getLinkAnalytics(link.code || req.params.code, link, { windowDays: ANALYTICS_WINDOW_DAYS });
    return res.json({
      success: true,
      link: publicLink(link),
      analytics,
      lifetime: {
        clicks: link.clickCount || 0,
        lastClickedAt: publicLink(link).lastClickedAt
      },
      window: { days: ANALYTICS_WINDOW_DAYS, upgradeFor: 'Longer history, exports and team access are on paid plans.' }
    });
  } catch (error) {
    return guestError(res, error);
  }
});

router.patch('/links/:code', guest.requireGuestSession, async (req, res) => {
  const link = await ownedLink(req, res);
  if (!link) return;
  try {
    const body = req.body || {};
    const updates = {};
    if (body.title !== undefined) updates.title = String(body.title || '').trim().slice(0, 120);
    if (body.enabled !== undefined) updates.enabled = body.enabled === true || body.enabled === 'true';
    const web = body.destination !== undefined || body.webDestination !== undefined ? cleanUrl(body.destination ?? body.webDestination) : undefined;
    const ios = body.iosDestination !== undefined ? cleanUrl(body.iosDestination) : undefined;
    const android = body.androidDestination !== undefined ? cleanUrl(body.androidDestination) : undefined;
    if (web !== undefined || ios !== undefined || android !== undefined) {
      updates.destinations = {
        web: web !== undefined ? (web || null) : (link.destinations?.web || null),
        ios: ios !== undefined ? (ios || null) : (link.destinations?.ios || null),
        android: android !== undefined ? (android || null) : (link.destinations?.android || null)
      };
      if (!updates.destinations.web && !updates.destinations.ios && !updates.destinations.android) {
        return res.status(400).json({ success: false, error: 'A destination URL is required', code: 'VALIDATION_ERROR' });
      }
    }
    if (updates.enabled === true && link.disabledReason === 'guest_expired') updates.disabledReason = null;
    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, error: 'Nothing to update', code: 'VALIDATION_ERROR' });
    }
    const updated = await LinkService.updateShortLink(link.code || req.params.code, { ...updates, updatedBy: 'guest' });
    recordAudit({ req, actor: { type: 'guest', workspace: req.guest.tenantId }, action: 'link.updated', code: updated.code || req.params.code, tenantId: req.guest.tenantId, before: link, after: updated });
    return res.json({ success: true, link: publicLink(updated) });
  } catch (error) {
    return guestError(res, error);
  }
});

router.delete('/links/:code', guest.requireGuestSession, async (req, res) => {
  const link = await ownedLink(req, res);
  if (!link) return;
  try {
    await LinkService.deleteShortLink(link.code || req.params.code);
    recordAudit({ req, actor: { type: 'guest', workspace: req.guest.tenantId }, action: 'link.deleted', code: link.code || req.params.code, tenantId: req.guest.tenantId, before: link });
    return res.json({ success: true, code: link.code || req.params.code });
  } catch (error) {
    return guestError(res, error);
  }
});

// ─── Access code management ───────────────────────────────────────────────────

router.post('/email', guest.requireGuestSession, rateLimiter('guestRecover'), async (req, res) => {
  try {
    const address = await guest.attachEmail(req.guest.tenantId, req.body?.email);
    // We never store the code, so attaching an email issues a fresh one and mails it.
    const { accessCode } = await guest.rotateAccessCode(req.guest.tenantId);
    const delivery = await email.sendGuestCodeRotated({ to: address, accessCode, lifetimeDays: guest.guestLifetimeDays() });
    recordAudit({ req, actor: { type: 'guest', workspace: req.guest.tenantId }, action: 'guest.email_attached', tenantId: req.guest.tenantId, extra: { delivery: delivery.status } });
    const refreshed = await db.collection('tenants').doc(req.guest.tenantId).get();
    return res.json({
      success: true,
      accessCode,
      emailDelivery: delivery.status,
      session: guest.issueSession({ id: req.guest.tenantId, ...refreshed.data() }),
      workspace: guest.workspaceSummary({ id: req.guest.tenantId, ...refreshed.data() }, { linkCount: await countLinks(req.guest.tenantId) })
    });
  } catch (error) {
    return guestError(res, error);
  }
});

router.post('/rotate', guest.requireGuestSession, async (req, res) => {
  try {
    const { accessCode } = await guest.rotateAccessCode(req.guest.tenantId);
    recordAudit({ req, actor: { type: 'guest', workspace: req.guest.tenantId }, action: 'guest.code_rotated', tenantId: req.guest.tenantId });
    const refreshed = await db.collection('tenants').doc(req.guest.tenantId).get();
    return res.json({ success: true, accessCode, session: guest.issueSession({ id: req.guest.tenantId, ...refreshed.data() }) });
  } catch (error) {
    return guestError(res, error);
  }
});

router.post('/recover', rateLimiter('guestRecover'), async (req, res) => {
  const address = String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return res.status(400).json({ success: false, error: 'A valid email address is required', code: 'VALIDATION_ERROR' });
  }
  try {
    const workspaces = await guest.findGuestWorkspacesByEmail(address);
    for (const ws of workspaces.slice(0, 3)) {
      const { accessCode } = await guest.rotateAccessCode(ws.id);
      await email.sendGuestCodeRotated({ to: address, accessCode, lifetimeDays: guest.guestLifetimeDays() });
      recordAudit({ req, actor: { type: 'guest', workspace: ws.id }, action: 'guest.code_recovered', tenantId: ws.id });
    }
  } catch (error) {
    console.error('[Guest] recover failed:', error.message);
  }
  // Same answer whether or not the address is known.
  return res.status(202).json({
    success: true,
    message: 'If that address is attached to a workspace, a new access code is on its way.',
    emailConfigured: email.isConfigured()
  });
});

// ─── Claim (paid path) ────────────────────────────────────────────────────────

/**
 * A signed-in user (Google / Apple / email account) attaches a guest workspace
 * to their account. The workspace becomes an ordinary tenant; the access code
 * stops working because the account now owns it.
 */
router.post('/claim', rateLimiter('guestClaim'), requireAuth, async (req, res) => {
  try {
    if (req.user.profile?.tenantId) {
      return res.status(409).json({
        success: false,
        error: 'This account already has a workspace. Moving links between workspaces is coming later.',
        code: 'ALREADY_HAS_TENANT'
      });
    }
    const { tenantId, tenant } = await guest.verifyAccessCode(req.body?.accessCode);
    const name = String(req.body?.name || '').trim().slice(0, 80) || tenant.name || 'My workspace';
    const nowMs = Date.now();

    const batch = db.batch();
    batch.update(db.collection('tenants').doc(tenantId), {
      kind: 'account',
      name,
      provisionedVia: 'guest-claim',
      claimedByUid: req.user.uid,
      claimedAtMs: nowMs,
      contact: { email: req.user.email || tenant.guest?.email || null },
      'guest.claimed': true,
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.set(db.collection('admin_users').doc(req.user.uid), {
      uid: req.user.uid,
      email: req.user.email || null,
      displayName: req.user.email ? req.user.email.split('@')[0] : req.user.uid,
      role: 'admin',
      tenantId,
      tenantIds: [tenantId],
      tenantName: name,
      permissions: [],
      provisionedVia: 'guest-claim',
      requireEmailVerification: req.user.emailVerified !== true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    await batch.commit();

    try {
      const authUser = await admin.auth().getUser(req.user.uid);
      await admin.auth().setCustomUserClaims(req.user.uid, { ...(authUser?.customClaims || {}), role: 'admin', tenantId });
    } catch (error) {
      console.error('[Guest] claim: setCustomUserClaims failed:', error.message);
    }

    recordAudit({ req, action: 'tenant.claimed', tenantId, after: { name, kind: 'account' }, extra: { uid: req.user.uid } });
    return res.json({ success: true, tenant: { id: tenantId, name, plan: tenant.plan || 'starter' }, user: { uid: req.user.uid, role: 'admin' } });
  } catch (error) {
    return guestError(res, error);
  }
});

module.exports = router;
