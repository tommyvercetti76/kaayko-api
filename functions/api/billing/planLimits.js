/**
 * Kortex plan limits — the single source of truth for per-plan quotas.
 *
 * Shared by the billing router (display) and smartLinkService (enforcement) so
 * the pricing page and the backend can never drift apart.
 */

const PLAN_LIMITS = {
  starter: { links: 25, api_calls: 0, campaigns: 3, analytics_range_days: 7 },
  pro: { links: 500, api_calls: 5000, campaigns: 25, analytics_range_days: 90 },
  business: { links: 2500, api_calls: 25000, campaigns: Infinity, analytics_range_days: Infinity },
  enterprise: { links: Infinity, api_calls: Infinity, campaigns: Infinity, analytics_range_days: Infinity }
};

module.exports = { PLAN_LIMITS };
