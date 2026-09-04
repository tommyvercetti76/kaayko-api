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
 *   GET    /capabilities           what the server can do right now (email delivery, limits)
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
const { scanUrl } = require('./utmTools');
const { linkEventsCsv, workspaceCsv, sendCsv } = require('./csvExport');
const { expiryDate } = require('./linkRules');
const demo = require('./demoWorkspace');
const { windowDaysFor, timeZoneFrom } = require('./analyticsPolicy');
const { buildWorkspaceAnalytics } = require('./workspaceAnalytics');
const crypto = require('crypto');
const { getLinkAnalytics } = require('./linkAnalytics');
const { recordAudit } = require('./auditLog');
const { rateLimiter } = require('../../middleware/securityMiddleware');
const { requireAuth } = require('../../middleware/authMiddleware');
const email = require('../../services/emailDelivery');
const { PLAN_LIMITS } = require('../billing/planLimits');
const { MAX_WINDOWS } = require('./linkSchedule');

const router = express.Router();
const db = admin.firestore();

const ANALYTICS_WINDOW_DAYS = PLAN_LIMITS.starter.analytics_range_days;
const DESTINATION_MAX = 2048;
const QR_BASE = 'https://kaayko.com/qr';

function cleanUrl(value) {
  return typeof value === 'string' ? value.trim().slice(0, DESTINATION_MAX) : '';
}

const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
function cleanUtm(value) {
  if (value === null) return {};
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  for (const key of UTM_FIELDS) {
    const v = value[key] ?? value[key.replace('utm_', '')];
    if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, 100);
  }
  return out;
}

function parseExpiry(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) { const e = new Error('The end date is not a valid date'); e.code = 'VALIDATION_ERROR'; throw e; }
  return date.toISOString();
}

/** Writes are refused on a read-only (sample) session. */
function requireWritable(req, res, next) {
  if (req.guest && req.guest.readOnly) {
    return res.status(403).json({ success: false, error: 'This is the sample workspace and it is read-only. Make your own link to get a code.', code: 'READ_ONLY_DEMO' });
  }
  next();
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
    disabledReason: link.disabledReason || null,
    schedule: link.schedule || null,
    limits: link.limits || null,
    utm: link.utm || {},
    placement: link.placement || null,
    economics: link.economics || null,
    campaignWindow: link.campaignWindow || null,
    shared: !!link.shareToken,
    shareUrl: link.shareToken ? `https://kaayko.com/kortex/r/${link.shareToken}` : null,
    expiresAt: expiryDate(link) ? expiryDate(link).toISOString() : null
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
  if (body.website) return res.status(400).json({ success: false, error: 'Something in the form did not look right. Reload the page and try again.', code: 'VALIDATION_ERROR' });

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
    if (workspace && workspace.readOnly) workspace = null; // never add to the sample workspace
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
      metadata: { createdVia: 'guest' },
      schedule: body.schedule !== undefined ? body.schedule : undefined,
      limits: body.limits !== undefined ? body.limits : undefined,
      expiresAt: parseExpiry(body.expiresAt),
      utm: cleanUtm(body.utm),
      placement: body.placement !== undefined ? body.placement : undefined,
      economics: body.economics !== undefined ? body.economics : undefined,
      campaignWindow: body.campaignWindow !== undefined ? body.campaignWindow : undefined
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
      generateQR(scanUrl(link.shortUrl), { size: 512 }),
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

// ─── Capabilities ─────────────────────────────────────────────────────────────
// Public and cheap. The page asks this before showing anything that depends on
// optional infrastructure (email delivery), so nothing is promised that the
// server cannot deliver right now. Numbers come from the same config the
// limits use, so the copy on the page can never drift from the behaviour.
router.get('/capabilities', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  return res.json({
    success: true,
    email: email.isConfigured(),
    lifetimeDays: guest.guestLifetimeDays(),
    linkLimit: guest.guestLinkLimit(),
    analyticsDays: ANALYTICS_WINDOW_DAYS,
    sessionHours: Math.round(guest.SESSION_TTL_MS / 3600e3),
    maxWindows: MAX_WINDOWS
  });
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
      workspace: { ...guest.workspaceSummary(req.guest.tenant, { linkCount: links.length }), demo: req.guest.tenant.demo === true, readOnly: !!req.guest.readOnly },
      readOnly: !!req.guest.readOnly,
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
    const analytics = await getLinkAnalytics(link.code || req.params.code, link, { windowDays: windowDaysFor(req.guest.tenant), timeZone: timeZoneFrom(req.query.tz) });
    return res.json({
      success: true,
      link: publicLink(link),
      analytics,
      lifetime: {
        clicks: link.clickCount || 0,
        lastClickedAt: publicLink(link).lastClickedAt
      },
      window: { days: windowDaysFor(req.guest.tenant), timeZone: timeZoneFrom(req.query.tz), upgradeFor: 'Longer history, exports and team access are on paid plans.' }
    });
  } catch (error) {
    return guestError(res, error);
  }
});

/**
 * GET /kortex/guest/workspace/analytics — every link in the workspace inside
 * the free window, plus one merged, compact event list for the overview
 * charts. At most 25 links, so at most 25 queries.
 */
router.get('/workspace/analytics', guest.requireGuestSession, async (req, res) => {
  try {
    const data = await buildWorkspaceAnalytics(req.guest.tenantId, { windowDays: windowDaysFor(req.guest.tenant), timeZone: timeZoneFrom(req.query.tz) });
    return res.json({ success: true, ...data });
  } catch (error) {
    return guestError(res, error);
  }
});

/**
 * GET /kortex/guest/demo — a read-only session for the sample workspace.
 */
/**
 * GET /kortex/guest/demo/samples — three sample reports (light, medium, heavy) for the page footer. Public, cached.
 */
router.get('/demo/samples', rateLimiter('publicQr'), async (req, res) => {
  try {
    const value = await demo.sampleSummaries({ full: req.query.full === '1' });
    if (!value) return res.status(404).json({ success: false, error: 'The sample workspace is not ready yet.', code: 'DEMO_NOT_READY' });
    res.set('Cache-Control', 'public, max-age=300');
    return res.json({ success: true, ...value });
  } catch (error) {
    return guestError(res, error);
  }
});

router.get('/demo', rateLimiter('guestSession'), async (req, res) => {
  try {
    const issued = await demo.issueDemoSession();
    if (!issued) return res.status(404).json({ success: false, error: 'The sample workspace is not ready yet.', code: 'DEMO_NOT_READY' });
    return res.json({ success: true, ...issued, readOnly: true });
  } catch (error) {
    return guestError(res, error);
  }
});

/**
 * Sponsor proof: a share token makes one link's report readable at
 * kaayko.com/kortex/r/<token> without a session. Revocable; never a client-set field.
 */
router.post('/links/:code/share', guest.requireGuestSession, requireWritable, async (req, res) => {
  const link = await ownedLink(req, res);
  if (!link) return;
  try {
    const token = crypto.randomBytes(18).toString('base64url');
    await db.collection('short_links').doc(link.code).update({ shareToken: token, sharedAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() });
    recordAudit({ req, actor: { type: 'guest', workspace: req.guest.tenantId }, action: 'link.shared', code: link.code, tenantId: req.guest.tenantId });
    return res.json({ success: true, shareUrl: `https://kaayko.com/kortex/r/${token}` });
  } catch (error) {
    return guestError(res, error);
  }
});

router.delete('/links/:code/share', guest.requireGuestSession, requireWritable, async (req, res) => {
  const link = await ownedLink(req, res);
  if (!link) return;
  try {
    await db.collection('short_links').doc(link.code).update({ shareToken: FieldValue.delete(), sharedAtMs: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    recordAudit({ req, actor: { type: 'guest', workspace: req.guest.tenantId }, action: 'link.unshared', code: link.code, tenantId: req.guest.tenantId });
    return res.json({ success: true });
  } catch (error) {
    return guestError(res, error);
  }
});

router.get('/links/:code/analytics.csv', guest.requireGuestSession, rateLimiter('exportCsv'), async (req, res) => {
  const link = await ownedLink(req, res);
  if (!link) return;
  try {
    const code = link.code || req.params.code;
    const { csv, rows } = await linkEventsCsv(code, { windowDays: windowDaysFor(req.guest.tenant) });
    recordAudit({ req, actor: { type: 'guest', workspace: req.guest.tenantId }, action: 'analytics.exported', code, tenantId: req.guest.tenantId, extra: { rows, windowDays: ANALYTICS_WINDOW_DAYS, format: 'csv' } });
    return sendCsv(res, `kortex-${code}-scans.csv`, csv);
  } catch (error) {
    return guestError(res, error);
  }
});

router.get('/workspace/export.csv', guest.requireGuestSession, rateLimiter('exportCsv'), async (req, res) => {
  try {
    const { links } = await LinkService.listLinks({ tenantId: req.guest.tenantId, limit: 100 });
    const { csv, rows } = workspaceCsv(links);
    recordAudit({ req, actor: { type: 'guest', workspace: req.guest.tenantId }, action: 'workspace.exported', tenantId: req.guest.tenantId, extra: { rows } });
    return sendCsv(res, 'kortex-links.csv', csv);
  } catch (error) {
    return guestError(res, error);
  }
});

router.patch('/links/:code', guest.requireGuestSession, requireWritable, async (req, res) => {
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
    if (body.schedule !== undefined) updates.schedule = body.schedule; // object sets, null clears
    if (body.limits !== undefined) updates.limits = body.limits; // object sets, null clears
    if (body.utm !== undefined) updates.utm = cleanUtm(body.utm) || {};
    if (body.placement !== undefined) updates.placement = body.placement;
    if (body.economics !== undefined) updates.economics = body.economics;
    if (body.campaignWindow !== undefined) updates.campaignWindow = body.campaignWindow;
    if (body.expiresAt !== undefined) updates.expiresAt = parseExpiry(body.expiresAt);
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

router.delete('/links/:code', guest.requireGuestSession, requireWritable, async (req, res) => {
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

router.post('/email', guest.requireGuestSession, requireWritable, rateLimiter('guestRecover'), async (req, res) => {
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

router.post('/rotate', guest.requireGuestSession, requireWritable, async (req, res) => {
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
    // Without a sender, rotating would only lock the owner out. Answer the same and do nothing.
    const workspaces = email.isConfigured() ? await guest.findGuestWorkspacesByEmail(address) : [];
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
  if (req.user && req.user.role === 'super-admin') return res.status(403).json({ success: false, error: 'A super-admin account cannot claim a workspace', code: 'SUPER_ADMIN_CANNOT_CLAIM' });
  try {
    if (req.user.profile?.tenantId) {
      return res.status(409).json({
        success: false,
        error: 'This account already has a workspace. Moving links between workspaces is coming later.',
        code: 'ALREADY_HAS_TENANT'
      });
    }
    // Proof of possession: the access code, or a live guest session (which
    // could only have been minted from the code).
    let owned;
    if (req.body?.accessCode) {
      owned = await guest.verifyAccessCode(req.body.accessCode);
    } else {
      const viaSession = await guest.resolveGuestSession(req);
      if (!viaSession) {
        return res.status(400).json({ success: false, error: 'Enter the access code of the workspace to claim', code: 'VALIDATION_ERROR' });
      }
      owned = { tenantId: viaSession.tenantId, tenant: viaSession.tenant };
    }
    const { tenantId, tenant } = owned;
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
