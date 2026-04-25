---
description: Use when planning, implementing, reviewing, or testing KORTEX campaign-platform work in kaayko-api, especially smart links, campaigns, tenant isolation, campaign ownership, public redirects, Universal Links, analytics, billing, auth, or API-key access. Phases 1-3.5 complete (77 tests passing). Phase 4+ ready.
---

# KORTEX Campaign Platform Skill

## Mission

Use this skill to evolve KORTEX safely from smart links into a secure, multi-tenant campaign platform.

**Current Status: Phases 1-3 COMPLETE. Phase 3.5 hardening finished. Phase 4 (domain verification) ready to start.**

The work must enhance existing behavior and never degrade:

- Existing `/l/:code` redirects. ✅ PRESERVED
- Existing `/smartlinks` management flows. ✅ PRESERVED
- Existing tenant registration. ✅ PRESERVED
- Existing alumni campaign behavior. ✅ ENHANCED
- Existing billing and auth routes. ✅ PRESERVED
- Existing Firebase Functions v2 runtime. ✅ PRESERVED

## Mental Model

KORTEX currently has three layers:

```text
Tenant identity
  -> Smart link management
    -> Public redirects and analytics
```

The target architecture adds a campaign layer:

```text
Tenant identity
  -> Campaign ownership and lifecycle
    -> Campaign-scoped links
      -> Public redirects, analytics, attribution, and reporting
```

Do not treat campaign type as mere metadata once campaign management begins. Campaigns need their own records, owners, roles, status, analytics, and audit history.

## Existing Runtime Map

Mounted runtime is defined in `functions/index.js`.

Current KORTEX surfaces:

- `/smartlinks` from `functions/api/smartLinks/smartLinks.js`
- `/l/:id` and `/resolve` from `functions/api/deepLinks/deeplinkRoutes.js`
- `/auth` from `functions/api/auth/authRoutes.js`
- `/billing` from `functions/api/billing/router.js`

Important files:

```text
functions/api/smartLinks/smartLinks.js
functions/api/smartLinks/smartLinkService.js
functions/api/smartLinks/redirectHandler.js
functions/api/smartLinks/tenantContext.js
functions/api/smartLinks/clickTracking.js
functions/api/smartLinks/attributionService.js
functions/api/smartLinks/webhookService.js
functions/middleware/authMiddleware.js
functions/middleware/apiKeyMiddleware.js
functions/middleware/securityMiddleware.js
functions/__tests__/kortex-api.test.js
functions/api/campaigns/campaignRoutes.js
functions/api/campaigns/campaignService.js
functions/api/campaigns/campaignPermissions.js
functions/api/campaigns/campaignValidation.js
functions/__tests__/kortex-campaigns.test.js
```

`functions/api/smartLinks/publicApiRouter.js` is not mounted. Do not rely on `/api/public/*` until it is explicitly mounted and tested.

## Current Architecture

### Existing Data

```text
short_links/{code}
tenants/{tenantId}
admin_users/{uid}
link_analytics/{id}
click_events/{clickId}
install_events/{id}
pending_tenant_registrations/{id}
api_keys/{keyId}
webhook_subscriptions/{subscriptionId}
```

### Existing Link Shape

```json
{
  "code": "lk1ngp",
  "shortUrl": "https://kaayko.com/l/lk1ngp",
  "tenantId": "kaayko-default",
  "tenantName": "Kaayko",
  "domain": "kaayko.com",
  "pathPrefix": "/l",
  "destinations": {
    "ios": null,
    "android": null,
    "web": "https://kaayko.com/store"
  },
  "title": "Example",
  "metadata": {},
  "utm": {},
  "enabled": true
}
```

## Target Architecture

Add campaign resources beside, not instead of, `short_links`.

```text
campaigns/{campaignId}
campaign_memberships/{campaignId_uid}
campaign_links/{campaignId_code}
campaign_events/{eventId}
campaign_audit_logs/{eventId}
domain_verifications/{domain}
```

Campaigns own links. `short_links` remains the fast redirect compatibility layer.

### Campaign Namespace Examples

```text
kaayko.com/a/whatsapp-group-1
kaayko.com/a/email-batch-2
kaayko.com/b/seller-launch
kaayko.com/c/campus-ambassadors
```

`a`, `b`, and `c` may represent campaign slugs, campaign types, or configured tenant route spaces. They must resolve through tenant/domain ownership, not through global string matching alone.

## Roadmap

### Phase 0: Secure Current Smart Links ✅ COMPLETE

Goal: make current KORTEX tenant-safe before adding campaign power.

Required:

- Tenant-scope smart-link create, list, stats, update, and delete.
- Redact public link reads.
- Keep public redirects unauthenticated.
- Reject unsupported public event types.
- Fix Universal Link bugs.
- Add KORTEX regression tests.

### Phase 1: Add Campaign Core ✅ COMPLETE

Goal: create and manage campaigns without changing redirect behavior.

Status: All components added and tested.

- [x] Campaign service added.
- [x] Campaign validation added.
- [x] Campaign permission helper added.
- [x] Campaign routes mounted at `/campaigns`.
- [x] Campaign membership upsert/list/remove added.
- [x] Campaign audit logging added (all mutations logged).
- [x] Campaign tenant/role tests added (25+ tests).

Routes (all implemented):

```text
POST /campaigns
GET /campaigns
GET /campaigns/:campaignId
PUT /campaigns/:campaignId
POST /campaigns/:campaignId/pause
POST /campaigns/:campaignId/resume
POST /campaigns/:campaignId/archive
```

### Phase 2: Campaign Links ✅ COMPLETE

Goal: let campaign owners create and manage links inside campaigns.

Status: All components added and tested.

- [x] Campaign link service added.
- [x] Link mirroring into `short_links` added.
- [x] Pause/resume for campaign links added.
- [x] Cascade disable/enable on campaign status changes added.
- [x] Audit logging for all link mutations added.
- [x] Campaign link tests added (31+ tests).

Routes (all implemented):

```text
POST /campaigns/:campaignId/links
GET /campaigns/:campaignId/links
GET /campaigns/:campaignId/links/:code
PUT /campaigns/:campaignId/links/:code
POST /campaigns/:campaignId/links/:code/pause
POST /campaigns/:campaignId/links/:code/resume
DELETE /campaigns/:campaignId/links/:code
```

### Phase 3: Campaign Redirect Resolver ✅ COMPLETE

Goal: support namespaced public campaign URLs.

Status: Fully implemented and tested.

- [x] Namespaced campaign resolver at `GET /:campaignSlug/:code` added.
- [x] Host/domain to tenant resolution added.
- [x] Slug to campaign resolution added.
- [x] Code to campaign link resolution added.
- [x] Campaign and link status enforcement added.
- [x] Analytics tracking with immutable tenant/campaign IDs added.
- [x] Reserved-slug bypass for `/l/:id` preserves legacy redirects.
- [x] Campaign resolver tests added (7+ tests).

### Phase 3.5: Hardening & Stability ✅ COMPLETE

Goal: validate all 5 critical improvements are production-ready.

Status: All hardening validations passed (77/77 tests passing).

- [x] **Campaign expiry enforcement**: Resolver returns HTTP 410 if `campaign.settings.expiresAt < now`.
- [x] **Link max-uses enforcement**: Resolver returns HTTP 410 if `link.usesCount >= campaign.settings.maxUsesPerLink`.
- [x] **Concurrent mutation safety**: Pause operations cascade to all link mirrors with atomic state consistency.
- [x] **Audit log completeness**: All mutations write signed entries to `campaign_audit_logs`.
- [x] **Cascade cleanup on archive/resume**: Archiving campaign disables all link mirrors; resuming re-enables them atomically.
- [x] Hardening test suite added with 14+ tests validating all 5 improvements.

### Phase 4: Domain Verification 🟡 READY TO START

Goal: make custom domains safe.

Requirements:

- [x] Architecture and data model planned.
- [ ] `domain_verifications/{domain}` schema added.
- [ ] DNS TXT verification flow implemented.
- [ ] HTTP token verification flow implemented.
- [ ] Domain ownership records and caching strategy added.
- [ ] Campaign routing restricted to verified domains only.
- [ ] Domain verification tests added.

Routes (to implement):

```text
POST /domains/:domain/verify-dns
POST /domains/:domain/verify-http
GET /domains/:domain/status
DELETE /domains/:domain
```

### Phase 5: Campaign Analytics 🔵 PLANNED

Goal: let owners manage performance.

Requirements:

- Campaign analytics endpoints.
- Link analytics endpoints.
- Aggregates by platform, UTM, source, destination, conversion.

### Phase 6: API-Key Access 🔵 PLANNED

Goal: allow backend-to-backend campaign operations safely.

Requirements:

- API keys remain tenant-bound.
- API key scopes map to campaign permissions.
- Batch operations are idempotent.
- Rate limits are per key, tenant, and campaign.

## Security Rules for Work

Always enforce tenant and campaign ownership server-side.

Never trust:

- `tenantId` in request body.
- `domain` in request body.
- `pathPrefix` in request body.
- `createdBy` in request body.
- `campaignId` without loading the campaign and checking its `tenantId`.

Public endpoints may:

- Redirect.
- Return branded error pages.
- Accept constrained events.
- Return public-safe link fields.

Public endpoints must not expose:

- Full destinations unless redirecting.
- Private metadata.
- Tenant billing data.
- Campaign member lists.
- Owner emails.
- API keys or hashes.
- Cross-tenant aggregate stats.

## Permission Model

Use the narrowest permission that satisfies the route.

```text
super-admin       all tenants and campaigns
tenant-admin      all campaigns in assigned tenant
campaign-owner    full control for one campaign
campaign-editor   create/update campaign links
campaign-viewer   read campaign and analytics
link-operator     pause/resume links
```

Permission checks should load the tenant/campaign resource first, then authorize against the resource's `tenantId`.

## File and Code Constraints

Follow existing repo style:

- CommonJS modules.
- Express routers.
- Firebase Admin SDK.
- Jest and Supertest.
- No TypeScript conversion in this repo without a separate migration plan.

Keep files reviewable:

- Routers should stay thin.
- Services own business rules.
- Validators own request shape checks.
- Tests should be split by behavior when they become hard to scan.

Suggested limits:

- Router file: under 350 lines when practical.
- Service file: under 450 lines when practical.
- Validator file: under 250 lines.
- Test file: split around 500 lines.

If a change makes a file too large, add a focused module instead of stretching the file.

## Implementation Pattern

For each new capability:

1. Add validation first.
2. Add service function with explicit tenant/campaign parameters.
3. Add route with `requireAuth` and permission checks.
4. Add audit log for mutation.
5. Add tests for success and denial.
6. Confirm existing KORTEX tests still pass.

Recommended service signature:

```js
async function updateCampaign({ tenantId, campaignId, actor, updates }) {}
```

Avoid signatures that accept an untrusted `req.body` directly in service internals.

## Phase 1-3 Guarantees (Locked)

The following behaviors are now guaranteed and must be preserved:

**Campaign Lifecycle:**
- Campaign status transitions: `draft` → `active` → `paused` → `archived` (one direction)
- Pause cascades `enabled=false` to all active link mirrors atomically
- Resume re-enables all active link mirrors atomically
- Archive disables all link mirrors and preserves campaign_links records

**Campaign Membership & Permissions:**
- Owner: full control (create, pause, resume, archive, manage members, manage links)
- Editor: can create and manage links, cannot modify campaign or members
- Viewer: read-only access to campaign and analytics
- Operator: can only pause/resume links (not create or update)

**Campaign Links:**
- Creating a campaign link automatically creates a mirror in `short_links` (isCampaignLink=true)
- Updating campaign link destinations updates the mirror
- Pausing a campaign link pauses its mirror (enabled=false)
- Deleting a campaign link deletes the mirror
- usesCount is tracked on both campaign_links and short_links

**Public Resolver (Phase 3):**
- `GET /:campaignSlug/:code` returns 404 for unknown domain
- `GET /:campaignSlug/:code` returns 404 for unknown campaign slug
- `GET /:campaignSlug/:code` returns 410 for paused campaigns
- `GET /:campaignSlug/:code` returns 410 for paused links
- `GET /:campaignSlug/:code` returns 410 if campaign has expired (expiresAt < now)
- `GET /:campaignSlug/:code` returns 410 if link has reached max-uses (usesCount >= maxUsesPerLink)
- Host-aware isolation prevents same slug on another tenant from resolving

**Audit Logging:**
- Campaign create/update/pause/resume/archive all write to campaign_audit_logs
- Campaign membership changes all write to campaign_audit_logs
- Campaign link create/update/pause/resume/delete all write to campaign_audit_logs
- All audit entries are signed with tenantId, campaignId, action, and timestamp

**Do not break these guarantees. If Phase 4 work requires changes, discuss and document them explicitly.**

## Starting Phase 4: Domain Verification

When adding domain verification:

1. **Preserve Phase 1-3**: Do not touch existing campaign service, link service, or public resolver logic.
2. **Add new domain service**: Create `functions/api/domains/domainService.js` for domain verification.
3. **Minimal resolver change**: Only add an additional check in `campaignPublicResolver.js` to verify domain ownership before redirect (2-3 lines).
4. **Test domain isolation**: Add `kortex-domain-verification.test.js` testing DNS/HTTP verification flows and multi-tenant conflicts.
5. **Update indexes**: If adding domain queries with campaign/tenant filters, update `firestore.indexes.json`.
6. **Run full suite**: Ensure all 77 existing KORTEX tests still pass after Phase 4 changes.

## Testing Requirements

Run focused tests:

```bash
cd functions
npm run test:kortex -- --runInBand --forceExit
```

Run smoke tests:

```bash
cd functions
npm test -- --runInBand
```

Run all tests when changing shared mocks, auth, middleware, Firestore helpers, or route mounting:

```bash
cd functions
npm run test:all -- --runInBand
```

Required KORTEX coverage:

- Public redirect success.
- Public redirect disabled/expired/paused.
- Public metadata redaction.
- Auth missing.
- Auth non-admin.
- Tenant admin same-tenant success.
- Tenant admin cross-tenant denial.
- Campaign owner success.
- Campaign viewer mutation denial.
- Super-admin override success.
- Domain mismatch denial.
- Unknown campaign 404.
- Paused campaign 410.
- Event type validation.
- Unknown event link rejection.

## Definition of Done

Work is done when:

- Existing links still redirect.
- New routes are documented and mounted intentionally.
- Tenant ownership is tested.
- Campaign ownership is tested.
- Public data is redacted.
- Mutations create audit logs.
- New Firestore compound queries have indexes.
- Tests pass or unrelated failures are explicitly documented.
- The implementation adds cohesive modules rather than growing tech debt.

## Anti-Patterns

Do not:

- Add campaign logic only as `metadata.campaign`.
- Let client input choose tenant ownership.
- Mount public API-key routes before scopes are tested.
- Add global list endpoints without tenant scoping.
- Add a new redirect path that can shadow existing static/API paths.
- Hide unrelated test failures.
- Mix alumni-only rules into generic campaign services without a clear extension point.
- Use ad hoc string parsing where URL or structured helpers are available.

## Product Compass

KORTEX should make campaigns delegable.

A tenant should be able to give a school, seller, organizer, club, or internal team ownership over a campaign without granting full tenant admin access. Campaign owners should be able to launch, pause, update, inspect, and retire their campaigns safely.

The product wins when it lets many tenants run many campaigns with confidence.
