/**
 * Recommendation checkpoints: an owner accepts, edits or dismisses a finding;
 * the server records a baseline so the next window can say improved, unchanged
 * or regressed. Mounted by guestRouter (guest door) and smartLinks (admin door).
 *
 *   POST /kortex/guest/links/:code/actions   session + writable, workspace-scoped
 *   POST /kortex/:code/actions               requireAuth + requireAdmin, tenant-scoped
 *
 * Body `{ type, applied, dismissed? }` → `{ success, checkpoint }`. A finding
 * that carries no action is dismissed by `{ key, applied: false, dismissed }`
 * instead, so it can leave the attention list too. The link keeps `checkpoint`
 * (the newest) and `checkpointHistory` (the previous ten).
 *
 * @module api/kortex/actionRoutes
 */

'use strict';

const { ACTION_TYPES, FINDING_KEYS } = require('./linkInsights');
const { windowDaysFor, timeZoneFrom } = require('./analyticsPolicy');
const { getTenantGate } = require('./tenantGate');

const DISMISS_REASONS = Object.freeze(['not_relevant', 'known_event', 'bad_data', 'remind_later']);
const HISTORY_CAP = 10;
const CODE_PATTERN = /^[a-zA-Z0-9_-]{3,80}$/;

function validationError(message) { const e = new Error(message); e.code = 'VALIDATION_ERROR'; return e; }

/**
 * `{ type, applied, dismissed }` from a request body, or `{ type: null, key,
 * applied: false, dismissed }` when an actionless finding is dismissed by key.
 * Anything an owner applied must name a real action type. Anything off the
 * lists is a VALIDATION_ERROR.
 */
function parseActionBody(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (typeof b.applied !== 'boolean') throw validationError('applied must be true or false');
  const dismissed = b.dismissed === undefined || b.dismissed === null ? null : b.dismissed;
  if (dismissed !== null && !DISMISS_REASONS.includes(dismissed)) throw validationError('Unknown dismiss reason');
  if (b.applied && dismissed) throw validationError('An action is either applied or dismissed, not both');
  if (b.applied || b.type !== undefined || b.key === undefined) {
    if (!ACTION_TYPES.includes(b.type)) throw validationError('Unknown action type');
    return { type: b.type, applied: b.applied, dismissed };
  }
  if (!FINDING_KEYS.has(b.key)) throw validationError('Unknown finding key');
  return { type: null, key: b.key, applied: b.applied, dismissed };
}

/** The outcome counts a later window is compared against, from the analytics response. */
function baselineOf(analytics, windowDays) {
  const t = analytics.totals || {};
  return { observed: t.observed || 0, useful: t.useful || 0, lost: t.lost || 0, rescued: t.rescued || 0, usefulRate: t.usefulRate ?? null, windowDays };
}

/**
 * Compute the baseline from the current analytics, store the new checkpoint
 * on the link and push the previous one onto the capped history.
 */
async function recordCheckpoint({ db, FieldValue, getLinkAnalytics, link, code, action, windowDays, timeZone }) {
  const analytics = await getLinkAnalytics(code, link, { windowDays, timeZone });
  const checkpoint = { ...action, atMs: Date.now(), baseline: baselineOf(analytics, windowDays) };
  const checkpointHistory = [link.checkpoint, ...(Array.isArray(link.checkpointHistory) ? link.checkpointHistory : [])].filter(Boolean).slice(0, HISTORY_CAP);
  await db.collection('short_links').doc(code).update({ checkpoint, checkpointHistory, updatedAt: FieldValue.serverTimestamp() });
  return checkpoint;
}

function auditExtra(action) { return { type: action.type, key: action.key || null, applied: action.applied, dismissed: action.dismissed }; }

/**
 * @param {import('express').Router} router  the guest router (mounted at /kortex/guest)
 * @param {object} deps  { requireGuestSession, requireWritable, ownedLink, guestError, recordAudit, getLinkAnalytics, db, FieldValue }
 */
function mountGuestActions(router, { requireGuestSession, requireWritable, ownedLink, guestError, recordAudit, getLinkAnalytics, db, FieldValue }) {
  router.post('/links/:code/actions', requireGuestSession, requireWritable, async (req, res) => {
    const link = await ownedLink(req, res);
    if (!link) return;
    try {
      const action = parseActionBody(req.body);
      const code = link.code || req.params.code;
      const checkpoint = await recordCheckpoint({ db, FieldValue, getLinkAnalytics, link, code, action, windowDays: windowDaysFor(req.guest.tenant), timeZone: timeZoneFrom(req.query.tz) });
      recordAudit({ req, actor: { type: 'guest', workspace: req.guest.tenantId }, action: 'link.action', code, tenantId: req.guest.tenantId, extra: auditExtra(action) });
      return res.json({ success: true, checkpoint });
    } catch (error) {
      return guestError(res, error);
    }
  });
}

/**
 * @param {import('express').Router} router  the admin router (mounted at /kortex)
 * @param {object} deps  { requireAuth, requireAdmin, getTenantFromRequest, assertTenantAccess, recordAudit, getLinkAnalytics, db, FieldValue, DEFAULT_TENANT_ID }
 */
function mountAdminActions(router, { requireAuth, requireAdmin, getTenantFromRequest, assertTenantAccess, recordAudit, getLinkAnalytics, db, FieldValue, DEFAULT_TENANT_ID }) {
  router.post('/:code/actions', requireAuth, requireAdmin, async (req, res) => {
    const code = String(req.params.code || '').trim();
    if (!CODE_PATTERN.test(code)) return res.status(404).json({ success: false, error: 'Link not found' });
    try {
      const action = parseActionBody(req.body);
      const doc = await db.collection('short_links').doc(code).get();
      if (!doc.exists) return res.status(404).json({ success: false, error: 'Link not found' });
      const link = { code, ...doc.data() };
      const tenantId = link.tenantId || DEFAULT_TENANT_ID;
      const tenantContext = await getTenantFromRequest(req);
      if (!tenantContext.isSuperAdmin) {
        try { assertTenantAccess(req.user, tenantId); } catch (_) { return res.status(403).json({ success: false, error: 'Access denied', code: 'TENANT_ACCESS_DENIED' }); }
      }
      const gate = await getTenantGate(tenantId);
      const windowDays = windowDaysFor({ plan: gate.plan, kind: gate.kind }, { superAdmin: tenantContext.isSuperAdmin });
      const checkpoint = await recordCheckpoint({ db, FieldValue, getLinkAnalytics, link, code, action, windowDays, timeZone: timeZoneFrom(req.query.tz) });
      recordAudit({ req, action: 'link.action', code, tenantId, extra: auditExtra(action) });
      return res.json({ success: true, checkpoint });
    } catch (error) {
      if (error.code === 'VALIDATION_ERROR') return res.status(400).json({ success: false, error: error.message, code: error.code });
      console.error('[Kortex] action checkpoint failed:', error);
      return res.status(500).json({ success: false, error: 'Could not record the action' });
    }
  });
}

module.exports = { mountGuestActions, mountAdminActions };
