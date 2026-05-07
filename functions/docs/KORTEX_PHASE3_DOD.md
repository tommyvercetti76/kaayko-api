# Kortex Phase 3 — Definition of Done

## Objective
Make existing link data actionable through analytics drill-down, health signals, and retroactive enrichment.

## Completed Deliverables

### 1. Click Event Persistence (Critical Fix)
- **What**: `handleRedirect` now records every click to `click_events` collection
- **Root cause**: `trackAnalytics: false` flag was explicitly disabling all click persistence
- **Change**: Set `trackAnalytics: true` in `smartLinks.js` redirect route
- **Dual-write**: Both `tenantLinkResolver.js` and `redirectHandler.js` write to unified `click_events` with full device/platform/utm data

### 2. Retroactive Enrichment Migration
- **Script**: `scripts/enrich-existing-links.js`
- **Coverage**: All 18 existing links enriched with: `intent`, `destinationType`, `audience`, `source`, `conversionGoal`, `tenantId`
- **Safety**: Merge writes only, never overwrites existing enrichment values
- **Inference logic**: URL patterns, titles, metadata.campaign, UTM params

### 3. Per-Link Accordion Drill-Down
- **Endpoint**: `GET /api/smartlinks/:code/clicks` — returns click breakdown by platform, browser, device, source, referrer, plus daily histogram
- **Frontend**: Click any link row in All Links view to expand inline analytics panel
- **Shows**: Total clicks, health status, top platform, top source, 7-day sparkline, breakdown bars, recent click feed
- **Cached**: Client caches analytics per-session to avoid redundant API calls

### 4. Dashboard KPI Cards
- **Cards**: Total Clicks, Active Links, Top Performer, Expiring Soon
- **Placement**: Top of dashboard view, above campaign shortcuts
- **Data source**: `/kortex?limit=300` — computed client-side

### 5. Link Health Badges
- **Hot**: 3+ clicks in last 24 hours
- **Dormant**: Zero clicks ever OR no clicks in 14+ days
- **Expiring**: Expires within 7 days
- **Expired**: Past expiry date
- Rendered inline in link row metadata badges

### 6. Tenant Context Badges
- Non-default tenants show their tenant name/ID as a blue badge in link rows
- Super-admins can see which tenant owns each link at a glance

## API Changes
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/smartlinks/:code/clicks` | GET | Admin | Per-link click analytics with breakdown |

## Collections Modified
| Collection | Change |
|-----------|--------|
| `short_links` | Enrichment fields backfilled (intent, destinationType, audience, source, conversionGoal, tenantId) |
| `click_events` | Now actively populated by both redirect paths |

## Definition of Done Checklist
- [x] All 18 existing links have enrichment fields populated
- [x] Click events persist on every redirect (standard + tenant resolver)
- [x] Per-link analytics accessible via accordion in admin UI
- [x] Dashboard shows at-a-glance KPIs
- [x] Health badges surface link lifecycle state without manual inspection
- [x] Tenant context visible in link rows for multi-tenant awareness
- [x] All JS files pass syntax validation
- [x] No breaking changes to existing API contracts
