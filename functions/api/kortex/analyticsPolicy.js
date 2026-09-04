/**
 * One window policy for every analytics surface: guest dashboard, admin app,
 * exports, samples and public reports all ask this module how far back a
 * tenant may look. Retention caps everything at 30 days.
 *
 * @module api/kortex/analyticsPolicy
 */

'use strict';

const RETENTION_DAYS = 30;
const FREE_DAYS = 7;

/**
 * @param {object} tenant  tenant doc (kind, plan) or null
 * @param {{ superAdmin?: boolean }} [ctx]
 */
function windowDaysFor(tenant, ctx = {}) {
  if (ctx.superAdmin) return RETENTION_DAYS;
  if (!tenant) return FREE_DAYS;
  if (tenant.kind === 'guest' || tenant.demo === true) return FREE_DAYS;
  const plan = String(tenant.plan || 'starter').toLowerCase();
  if (plan === 'starter' || plan === 'free') return FREE_DAYS;
  return RETENTION_DAYS; // pro, business, enterprise, house
}

/** A safe IANA zone from a request, or UTC. */
function timeZoneFrom(value) {
  const tz = String(value || '').trim();
  if (!tz || tz.length > 64) return 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (_) { return 'UTC'; }
}

module.exports = { RETENTION_DAYS, FREE_DAYS, windowDaysFor, timeZoneFrom };
