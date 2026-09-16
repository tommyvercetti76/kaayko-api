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
  // Paid plans read the plan table, capped by what still exists.
  const { PLAN_LIMITS } = require('../billing/planLimits');
  const days = PLAN_LIMITS[plan] ? PLAN_LIMITS[plan].analytics_range_days : RETENTION_DAYS;
  return Math.min(RETENTION_DAYS, Number.isFinite(days) ? days : RETENTION_DAYS);
}

/** Daily totals reach this far back for a plan (0 for free). */
function historyDaysFor(tenant) {
  if (!tenant || tenant.kind === 'guest' || tenant.demo === true) return 0;
  const plan = String(tenant.plan || 'starter').toLowerCase();
  const { PLAN_LIMITS } = require('../billing/planLimits');
  return PLAN_LIMITS[plan] ? (PLAN_LIMITS[plan].history_days || 0) : 0;
}

/** A safe IANA zone from a request, or UTC. */
function timeZoneFrom(value) {
  const tz = String(value || '').trim();
  if (!tz || tz.length > 64) return 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (_) { return 'UTC'; }
}

module.exports = { RETENTION_DAYS, FREE_DAYS, windowDaysFor, historyDaysFor, timeZoneFrom };
