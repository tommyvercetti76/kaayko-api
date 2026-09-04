/**
 * One cached read of the tenant per redirect: is the workspace switched off,
 * and which plan is it on. A disabled tenant stops every one of its links on
 * the next request (the kill switch an abuse review needs), and the cached
 * plan replaces the extra read the interstitial decision used to make.
 *
 * Cache is per instance and short (60 s) so a kill lands within a minute
 * everywhere and within one request on the instance that served the reviewer.
 *
 * @module api/kortex/tenantGate
 */

'use strict';

const admin = require('firebase-admin');

const DEFAULT_TENANT_ID = 'kaayko-default';
const TTL_MS = 60 * 1000;
const cache = new Map();

async function readTenant(tenantId) {
  const db = admin.firestore();
  const snap = await db.collection('tenants').doc(tenantId).get();
  if (!snap.exists) return { exists: false, enabled: true, plan: 'starter', kind: null };
  const data = snap.data() || {};
  return { exists: true, enabled: data.enabled !== false, plan: data.plan || 'starter', kind: data.kind || null };
}

/**
 * @returns {Promise<{exists:boolean, enabled:boolean, plan:string, kind:string|null}>}
 */
async function getTenantGate(tenantId, { now = Date.now() } = {}) {
  const id = tenantId || DEFAULT_TENANT_ID;
  if (id === DEFAULT_TENANT_ID) return { exists: true, enabled: true, plan: 'house', kind: 'house' };
  const hit = cache.get(id);
  if (hit && hit.expires > now) return hit.value;
  try {
    const value = await readTenant(id);
    cache.set(id, { value, expires: now + TTL_MS });
    return value;
  } catch (error) {
    // Fail open on a read error: a Firestore hiccup must not take every link
    // of a healthy tenant offline. A kill still lands once reads recover.
    console.error('[TenantGate] read failed:', error.message);
    return hit ? hit.value : { exists: true, enabled: true, plan: 'starter', kind: null };
  }
}

function forgetTenant(tenantId) { cache.delete(tenantId); }
function resetCache() { cache.clear(); }

module.exports = { getTenantGate, forgetTenant, resetCache, DEFAULT_TENANT_ID, TTL_MS };
