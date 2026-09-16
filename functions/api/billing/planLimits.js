/**
 * Kortex plan limits — the single source of truth for per-plan quotas.
 *
 * Shared by the billing router (display) and smartLinkService (enforcement) so
 * the pricing page and the backend can never drift apart.
 */

// analytics_range_days: how far back scan DETAIL (every event) reaches. Raw
// events live 30 days (analyticsPolicy.RETENTION_DAYS, enforced by a Firestore
// TTL), so no plan can promise more detail than that. history_days: how far
// back DAILY TOTALS reach, read from the counts-only rollups that outlive the
// events. The pricing page, the Terms and the API all read this table.
const PLAN_LIMITS = {
  starter: { links: 25, api_calls: 0, campaigns: 3, analytics_range_days: 7, history_days: 0 },
  pro: { links: 500, api_calls: 5000, campaigns: 25, analytics_range_days: 30, history_days: 365 },
  business: { links: 2500, api_calls: 25000, campaigns: Infinity, analytics_range_days: 30, history_days: 365 },
  enterprise: { links: Infinity, api_calls: Infinity, campaigns: Infinity, analytics_range_days: 30, history_days: 365 }
};

module.exports = { PLAN_LIMITS };
