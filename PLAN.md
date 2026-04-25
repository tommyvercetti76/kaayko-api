# KORTEX Campaign Platform Plan

## Purpose

Turn KORTEX from a tenant-aware smart-link backend into a secure, multi-tenant campaign platform without degrading existing `/smartlinks`, `/l/:id`, `/resolve`, auth, billing, alumni, or redirect behavior.

This plan is intentionally incremental. Each phase must preserve current short-link flows while adding first-class campaign ownership, campaign namespaces such as `kaayko.com/a/...`, and safe tenant administration.

## Current State

KORTEX currently provides:

- Smart-link CRUD mounted at `/smartlinks`.
- Public redirects through `/l/:id` and `/smartlinks/r/:code`.
- Firebase Auth based admin identity through `admin_users/{uid}`.
- Tenant fields on `short_links` and tenant context helpers.
- Link metadata, UTM tracking, source rules, expiry, pause via `enabled`, click analytics, and special alumni campaign handling.
- Billing routes under `/billing`.
- Public tenant registration under `/smartlinks/tenant-registration`.

Important constraints:

- `functions/index.js` is the source of truth for mounted runtime behavior.
- `publicApiRouter.js` exists but is intentionally unmounted.
- Existing public redirects must continue to work.
- Existing `short_links/{code}` documents must remain readable by redirect handlers.
- KORTEX must stay compatible with the companion frontend until the frontend is migrated.

## Target State

KORTEX should support:

- Tenant-owned campaign spaces, for example:
  - `kaayko.com/a/...` for alumni campaigns.
  - `kaayko.com/b/...` for brand, beta, or buyer campaigns.
  - `kaayko.com/c/...` for custom campaign groups.
- First-class campaigns with lifecycle controls: draft, active, paused, archived, expired.
- Campaign ownership and roles independent from broad tenant admin rights.
- Campaign-scoped link management.
- Tenant-safe analytics and attribution.
- Domain-aware routing so custom domains and path prefixes belong to verified tenants.
- Zero breakage for existing `/l/:code` smart links.

## Proposed Architecture

### Firestore Collections

Keep `short_links/{code}` as the compatibility and redirect collection.

Add:

```text
tenants/{tenantId}
campaigns/{campaignId}
campaign_memberships/{campaignId_uid}
campaign_links/{campaignId_code}
campaign_events/{eventId}
campaign_audit_logs/{eventId}
domain_verifications/{domain}
```

Implemented foundation:

- `campaigns/{campaignId}` is now managed by `functions/api/campaigns/campaignService.js`.
- `campaign_memberships/{campaignId_uid}` is now managed by `campaignService.upsertMember`.
- `campaign_audit_logs/{eventId}` is now written for campaign create/update/lifecycle/member mutations.
- `campaign_links`, `campaign_events`, and `domain_verifications` remain planned.

### `campaigns/{campaignId}`

```json
{
  "tenantId": "tenant-a",
  "campaignId": "alumni-2026",
  "slug": "a",
  "type": "alumni",
  "name": "Alumni Interest 2026",
  "status": "active",
  "domain": "kaayko.com",
  "pathPrefix": "/a",
  "defaultDestinations": {
    "web": "https://kaayko.com/alumni",
    "ios": "kaayko://alumni",
    "android": "kaayko://alumni"
  },
  "settings": {
    "maxUsesPerLink": 50,
    "allowPublicStats": false,
    "expiresAt": null
  },
  "createdBy": "uid",
  "createdAt": "server timestamp",
  "updatedAt": "server timestamp"
}
```

### `campaign_memberships/{campaignId_uid}`

```json
{
  "tenantId": "tenant-a",
  "campaignId": "alumni-2026",
  "uid": "firebase-uid",
  "role": "owner",
  "permissions": [
    "campaign:read",
    "campaign:update",
    "campaign:pause",
    "links:create",
    "links:update",
    "analytics:read"
  ],
  "createdAt": "server timestamp"
}
```

### `campaign_links/{campaignId_code}`

```json
{
  "tenantId": "tenant-a",
  "campaignId": "alumni-2026",
  "code": "whatsapp-group-1",
  "shortLinkCode": "a_whatsapp-group-1",
  "status": "active",
  "destinations": {
    "web": "https://kaayko.com/alumni?src=whatsapp-group-1",
    "ios": null,
    "android": null
  },
  "utm": {
    "utm_source": "whatsapp",
    "utm_medium": "group",
    "utm_campaign": "alumni-2026"
  },
  "metadata": {},
  "createdBy": "uid",
  "createdAt": "server timestamp",
  "updatedAt": "server timestamp"
}
```

`short_links/{shortLinkCode}` should mirror the redirect-critical fields for compatibility:

```json
{
  "tenantId": "tenant-a",
  "campaignId": "alumni-2026",
  "campaignPath": "/a",
  "code": "a_whatsapp-group-1",
  "publicCode": "whatsapp-group-1",
  "domain": "kaayko.com",
  "pathPrefix": "/a",
  "destinations": {},
  "metadata": { "campaignId": "alumni-2026", "campaignType": "alumni" },
  "enabled": true
}
```

## Routing Model

Existing behavior remains:

```text
/l/:code -> short_links/{code}
/smartlinks/r/:code -> short_links/{code}
```

New campaign behavior:

```text
/:campaignSlug/:code -> campaign resolver
```

Resolver steps:

1. Resolve host/domain to an enabled tenant.
2. Resolve `campaignSlug` to an active campaign for that tenant/domain.
3. Resolve `code` to a campaign link.
4. Check campaign status and link status.
5. Enforce expiry, source rules, max-use rules, and platform rules.
6. Track click with `tenantId`, `campaignId`, `campaignType`, `linkCode`, UTM, referrer, user agent, and destination.
7. Redirect to the platform-specific destination.

## API Surface

Add campaign management under protected routes:

```text
POST   /campaigns
GET    /campaigns
GET    /campaigns/:campaignId
PUT    /campaigns/:campaignId
POST   /campaigns/:campaignId/pause
POST   /campaigns/:campaignId/resume
POST   /campaigns/:campaignId/archive

GET    /campaigns/:campaignId/members
POST   /campaigns/:campaignId/members
PUT    /campaigns/:campaignId/members/:uid
DELETE /campaigns/:campaignId/members/:uid

POST   /campaigns/:campaignId/links
GET    /campaigns/:campaignId/links
GET    /campaigns/:campaignId/links/:code
PUT    /campaigns/:campaignId/links/:code
POST   /campaigns/:campaignId/links/:code/pause
POST   /campaigns/:campaignId/links/:code/resume
DELETE /campaigns/:campaignId/links/:code

GET    /campaigns/:campaignId/analytics
GET    /campaigns/:campaignId/links/:code/analytics
```

Do not mount external API-key campaign routes until the internal authenticated campaign routes have tenant-isolation tests.

## Security Model

Every protected campaign route must pass these checks:

1. `requireAuth`.
2. User has a profile in `admin_users`.
3. User belongs to the tenant or is `super-admin`.
4. User has campaign permission through tenant role or `campaign_memberships`.
5. Requested resource belongs to the same `tenantId`.
6. Mutations write audit logs.

Role model:

```text
super-admin       all tenants, all campaigns
tenant-admin      all campaigns in assigned tenant
campaign-owner    one campaign, full lifecycle and member management
campaign-editor   one campaign, link and metadata updates
campaign-viewer   one campaign, read and analytics only
link-operator     one campaign, pause/resume links only
```

Public routes must never expose private destinations, metadata, member lists, tenant billing state, owner emails, or internal IDs beyond what is needed to redirect.

## Migration Plan

### Phase 0: Stabilize Current KORTEX

- Keep `/l/:code` and `/smartlinks/r/:code` unchanged for public users.
- Enforce tenant scoping on all management routes.
- Redact public smart-link reads.
- Protect aggregate stats.
- Constrain public event types.
- Add focused KORTEX regression tests.

Definition of done:

- `npm run test:kortex -- --runInBand --forceExit` passes.
- Existing `/l/:code` links still redirect.
- Existing default tenant links remain manageable by default tenant admins.

### Phase 1: Campaign Data Model

- Add `campaignService.js`.
- Add `campaignMembershipService.js`.
- Add `campaignLinkService.js`.
- Add validators for campaign slug, campaign type, campaign status, and route-safe link codes.
- Create campaign records without changing redirect behavior.

Definition of done:

- Campaign CRUD works for tenant admins.
- Cross-tenant reads and writes are rejected.
- Campaign membership permissions are tested.
- No existing `short_links` behavior changes.

Implementation status:

- [x] Added `functions/api/campaigns/campaignService.js`.
- [x] Added `functions/api/campaigns/campaignPermissions.js`.
- [x] Added `functions/api/campaigns/campaignValidation.js`.
- [x] Added `functions/api/campaigns/campaignRoutes.js`.
- [x] Mounted protected campaign management at `/campaigns`.
- [x] Added `functions/__tests__/kortex-campaigns.test.js`.
- [x] Added `functions/api/campaigns/campaignLinkService.js` (Phase 2).

### Phase 2: Campaign Link Management ✅ COMPLETE

- Add campaign-scoped link creation.
- Mirror campaign links into `short_links`.
- Add pause/resume at campaign and link levels.
- Add audit logs for lifecycle mutations.

Implementation status:

- [x] Added link CRUD routes under `/campaigns/:campaignId/links`.
- [x] Added link lifecycle routes: pause, resume, delete.
- [x] Added link validation for create/update/code patterns.
- [x] Added short-link mirror writes in `short_links/{shortLinkCode}` for redirect compatibility.
- [x] Added campaign-level status cascade to disable/enable active mirrored links on pause/resume/archive.
- [x] Added audit logs for link create/update/pause/resume/delete.
- [x] Added campaign-link test coverage in `functions/__tests__/kortex-campaigns.test.js`.
- [x] Updated Firestore batch mock behavior to execute set/update/delete operations during tests.

Definition of done:

- Pausing a campaign stops all campaign links.
- Pausing one link does not pause sibling links.
- Link ownership and tenant ownership are tested.
- Legacy `/l/:code` still works.

### Phase 3: Campaign Namespaced Redirects ✅ COMPLETE

- Mount namespaced campaign resolver after static/API routes and before legacy deep-link fallback.
- Start with `kaayko.com/:campaignSlug/:code`.
- Resolve domain and campaign slug before code lookup.
- Add host-aware tests.

Definition of done:

- `kaayko.com/a/example` resolves only to campaign `a` for `kaayko.com`.
- Unknown campaigns return branded 404.
- Paused campaigns return 410.
- Cross-tenant domain/campaign collisions are impossible.

Implementation status:

- [x] Added public campaign namespace resolver: `functions/api/campaigns/campaignPublicResolver.js`.
- [x] Mounted resolver in `functions/index.js` before legacy deep-link fallback.
- [x] Added reserved-slug bypass to preserve existing route surfaces such as `/l/:id`.
- [x] Added host-aware resolver tests in `functions/__tests__/kortex-campaign-resolver.test.js`.
- [x] Updated `test:kortex` script to include API, campaign, and resolver suites.

### Phase 3.5: Hardening & Stability ✅ COMPLETE

Added robustness validation and enforcement to Phase 1-3 implementation:

- **Concurrent mutation safety**: Verified pause operations cascade to all link mirrors with consistent state.
- **Campaign expiry enforcement**: Phase 3 resolver checks `campaign.settings.expiresAt` and returns HTTP 410 if campaign is expired.
- **Link max-uses enforcement**: Phase 3 resolver checks `link.usesCount >= campaign.settings.maxUsesPerLink` and returns HTTP 410 if limit exceeded.
- **Audit logging completeness**: All mutations (create, update, pause, resume, archive) write signed entries to `campaign_audit_logs`.
- **Cascade cleanup on archive/resume**: Archiving campaign disables all link mirrors; resuming re-enables them atomically.

Test coverage: 77/77 tests passing across all KORTEX suites (API, campaigns, campaign-resolver, hardening).

Implementation status:

- [x] Added expiry date check in `campaignPublicResolver.js` (lines 163-169).
- [x] Added max-uses enforcement in `campaignPublicResolver.js` (lines 170-176).
- [x] Ensured `usesCount: 0` initialization in `campaignLinkService.createCampaignLink()`.
- [x] Verified all mutations write audit logs via `_writeAudit()`.
- [x] Added `disableAllCampaignLinks()` and `enableAllCampaignLinks()` in `campaignLinkService.js`.
- [x] Implemented cascade disable/enable calls in `setCampaignStatus()`.
- [x] Added comprehensive hardening test suite: `functions/__tests__/kortex-hardening.test.js` with 20+ test cases.

### Phase 4: Domain Verification

- Add `domain_verifications`.
- Require DNS TXT or HTTP token before a custom domain is enabled.
- Only verified domains can be assigned to campaign routing.

Definition of done:

- Unverified domains cannot be used in generated short URLs.
- Verified domains are tenant-owned.
- Domain transfer requires explicit disable/reenable workflow.

### Phase 5: Analytics and Attribution

- Add campaign-level analytics endpoints.
- Aggregate by tenant, campaign, link, source, medium, platform, destination, and conversion.
- Store event rows with immutable tenant/campaign fields.

Definition of done:

- Analytics are tenant-scoped.
- Campaign owners can read only their campaign analytics.
- Tenant admins can read all tenant campaign analytics.

### Phase 6: External API and Scale

- Mount API-key routes only after scopes map cleanly to campaign permissions.
- Add per-tenant and per-campaign rate limits.
- Add idempotency keys for create/update mutations.
- Add background aggregation if raw analytics become too large.

Definition of done:

- API keys are tenant-bound.
- Scopes are least-privilege.
- Batch creates are idempotent.
- High-volume redirects do not block on slow analytics writes.

## Implementation Constraints

- Keep files small enough to review. Prefer service modules over adding hundreds of lines to `smartLinks.js`.
- Suggested file targets:
  - Routers: under 350 lines when practical.
  - Services: under 450 lines when practical.
  - Validators: under 250 lines.
  - Tests: split by behavior once a file exceeds 500 lines.
- Use CommonJS because the existing functions code uses `require` and `module.exports`.
- Use Firestore Admin SDK patterns already present in the repo.
- Avoid changing mounted paths unless the phase explicitly requires it.
- Avoid schema rewrites that force immediate data migration.
- Add new fields in a backward-compatible way.
- Keep redirect handlers tolerant of old documents.
- Never make public redirects require auth.
- Never let a tenant-controlled request body override tenant ownership, domain ownership, or creator identity.

## Testing Strategy

Required focused tests for every campaign phase:

- Auth required for protected routes.
- Non-admin users cannot access admin campaign routes.
- Tenant admins cannot access other tenants.
- Campaign owners can manage only assigned campaigns.
- Campaign viewers cannot mutate.
- Public redirects work without auth.
- Paused and expired campaigns stop redirects.
- Paused and expired links stop redirects.
- Public metadata reads are redacted.
- Event tracking rejects unknown event types and unknown links.
- Domain/campaign collisions resolve to the correct tenant or fail closed.

Run commands:

```bash
cd functions
npm run test:kortex -- --runInBand --forceExit
npm test -- --runInBand
```

When touching shared mocks or global middleware, also run:

```bash
cd functions
npm run test:all -- --runInBand
```

Known current caveat: non-KORTEX suites may contain unrelated failures. Record them rather than hiding them.

## Definition of Done

A phase is done only when:

- Existing KORTEX functionality still works.
- The new behavior has tests for success, forbidden, not found, and paused/disabled states.
- Tenant and campaign ownership are enforced server-side.
- Public endpoints expose only public-safe data.
- Firestore indexes are updated if new compound queries require them.
- Docs mention any new route, collection, permission, and migration step.
- The implementation is split into cohesive modules and does not grow a monolithic router.
- No unmounted route is documented as available.
- The final response includes exact tests run and any remaining unrelated failures.

## Product Direction

The product should become a secure campaign operating system:

- Campaign owners manage audiences, links, lifecycle, and analytics without needing full tenant admin access.
- Tenants can safely delegate campaigns to schools, clubs, sellers, organizers, or internal teams.
- Links become operational assets, not just redirects.
- Domains and route namespaces become first-class, verified tenant resources.
- Analytics become reliable enough for billing, attribution, and customer reporting.

The north star: KORTEX should make it easy to launch many campaigns quickly while making it hard to leak data, hijack domains, spoof tenants, or break existing links.
