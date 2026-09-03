/**
 * Audit log for Kortex link and tenant changes.
 *
 * One document per action in `kortex_audit_logs`:
 *   { action, code, tenantId, actor:{type,uid,email,role,keyId,name}, ip, userAgent,
 *     changes:{field:{from,to}}, before, after, reason, at, atMs }
 *
 * Writes are best-effort and never throw into the request path; a failed audit
 * write is logged so it shows up in Cloud Logging rather than breaking a save.
 *
 * @module api/kortex/auditLog
 */

'use strict';

const admin = require('firebase-admin');
const { getClientIp } = require('./clientIp');

const db = admin.firestore();
const COLLECTION = 'kortex_audit_logs';

// Only these fields are diffed and stored; analytics counters and timestamps
// would make every entry noisy without telling a reviewer anything.
const TRACKED_FIELDS = [
  'title', 'description', 'destinations', 'enabled', 'status', 'expiresAt', 'utm',
  'metadata', 'destinationType', 'requiresAuth', 'audience', 'source', 'intent',
  'returnTo', 'conversionGoal', 'campaignId', 'tags', 'safety', 'plan', 'name', 'trustedDomains'
];

function plain(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const p = plain(v);
      if (p !== undefined) out[k] = p;
    }
    return out;
  }
  return value;
}

function computeChanges(before, after) {
  if (!before && !after) return {};
  const changes = {};
  for (const field of TRACKED_FIELDS) {
    const from = plain(before?.[field]);
    const to = plain(after?.[field]);
    if (from === undefined && to === undefined) continue;
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes[field] = { from: from === undefined ? null : from, to: to === undefined ? null : to };
  }
  return changes;
}

function describeActor(req, explicit) {
  if (explicit) return { type: 'system', ...explicit };
  if (req?.apiClient) {
    return {
      type: 'api-key',
      keyId: req.apiClient.keyId || null,
      name: req.apiClient.name || null,
      tenantId: req.apiClient.tenantId || null
    };
  }
  if (req?.user) {
    return {
      type: req.user.authMethod === 'admin-key' ? 'admin-key' : 'user',
      uid: req.user.uid || null,
      email: req.user.email || null,
      role: req.user.role || null
    };
  }
  return { type: 'anonymous' };
}

/**
 * Record one audit entry. Never throws.
 * @param {Object} entry
 * @param {import('express').Request} [entry.req]
 * @param {Object} [entry.actor] - explicit actor for system jobs, e.g. { name: 'rescan' }
 * @param {string} entry.action - dotted verb, e.g. 'link.created'
 * @param {string} [entry.code]
 * @param {string} [entry.tenantId]
 * @param {Object} [entry.before]
 * @param {Object} [entry.after]
 * @param {string} [entry.reason]
 * @param {Object} [entry.extra]
 */
async function recordAudit(entry = {}) {
  try {
    const { req = null, actor = null, action, code = null, tenantId = null, before = null, after = null, reason = null, extra = null } = entry;
    if (!action) return null;
    const doc = {
      action,
      code,
      tenantId: tenantId || after?.tenantId || before?.tenantId || null,
      actor: describeActor(req, actor),
      ip: req ? (getClientIp(req) || null) : null,
      userAgent: req?.get ? String(req.get('user-agent') || '').slice(0, 300) : null,
      changes: computeChanges(before, after),
      reason: reason || null,
      extra: extra ? plain(extra) : null,
      at: admin.firestore.FieldValue.serverTimestamp(),
      atMs: Date.now()
    };
    const ref = await db.collection(COLLECTION).add(doc);
    return { id: ref.id, ...doc };
  } catch (error) {
    console.error('[Audit] write failed:', error.message);
    return null;
  }
}

async function listAudit({ code = null, tenantId = null, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  let query = db.collection(COLLECTION);
  if (code) query = query.where('code', '==', code);
  if (tenantId) query = query.where('tenantId', '==', tenantId);
  let snapshot;
  try {
    snapshot = await query.orderBy('atMs', 'desc').limit(safeLimit).get();
  } catch (error) {
    // Missing composite index in a fresh project: fall back to an unordered read.
    snapshot = await query.limit(safeLimit).get();
  }
  return snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
}

module.exports = { recordAudit, listAudit, computeChanges, TRACKED_FIELDS, COLLECTION };
