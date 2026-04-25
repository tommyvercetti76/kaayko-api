# Kaayko API Agent Guide

## Prime Directive

Enhance the existing backend without degrading current behavior.

When working in this repo, preserve:

- Existing public routes.
- Existing Firebase Functions v2 deployment shape.
- Existing Firestore collections and documents.
- Existing companion frontend expectations.
- Existing KORTEX redirects and smart links.
- Existing product boundaries between Store, Paddling Out, KORTEX, Kreator, Kamera Quest, and shared platform code.

If a requested change risks breaking deployed behavior, add compatibility code or a migration path instead of replacing the old path outright.

## Repository Reality

This repo is JavaScript, Firebase Functions v2, Express, Firebase Admin, and Jest.

Runtime source of truth:

```text
functions/index.js
```

Main products:

```text
Store / Commerce      /products /images /createPaymentIntent /admin/*
Paddling Out          /paddlingOut /nearbyWater /paddleScore /fastForecast /forecast
KORTEX                /smartlinks /auth /billing /l/:id /resolve
Kreator               /kreators
Kamera Quest          /cameras /lenses /presets /presets/smart
```

Do not assume a router is live just because a file exists. Check `functions/index.js`.

## KORTEX Direction

KORTEX is moving toward a secure, multi-tenant campaign platform.

**Status: Phases 1-3 complete. Phase 3.5 hardening finished (all 77 tests passing). Ready for Phase 4.**

Implemented foundation:

- ✅ `campaigns/{campaignId}` with full CRUD, lifecycle, and audit logging.
- ✅ `campaign_memberships/{campaignId_uid}` with role-based access control.
- ✅ `campaign_links/{campaignId_code}` with mirror sync to `short_links/{code}`.
- ✅ Campaign namespaced public resolver at `/:campaignSlug/:code` with host-aware routing.
- ✅ Hardening: Expiry enforcement, max-uses enforcement, concurrent mutation safety, cascade cleanup.
- ✅ `short_links/{code}` remains the redirect compatibility layer.
- ✅ `tenants/{tenantId}` stores tenant identity and domain settings.
- ✅ `admin_users/{uid}` stores tenant role and permissions.
- ✅ `/l/:code` and `/smartlinks/r/:code` remain public redirects (preserved).

Next phase:

- Add `domain_verifications/{domain}` for DNS/HTTP verification workflow (Phase 4).
- Restrict campaign routing to verified domains only.
- After Phase 4: Add campaign analytics (Phase 5) and external API/rate limiting (Phase 6).

Before Phase 4 work, read:

```text
PLAN.md (Phase 4 section)
SKILL.md
functions/api/smartLinks/SKILL.md
docs/products/KORTEX.md
```

## Security Rules

Always fail closed for management routes.

Never trust client-provided:

- `tenantId`
- `tenantName`
- `domain`
- `pathPrefix`
- `createdBy`
- `campaignId` ownership
- role or permission claims in request bodies

Load the resource from Firestore and authorize against the stored `tenantId`.

Public routes may redirect or accept constrained analytics events, but they must not expose private destinations, metadata, owner data, billing state, or cross-tenant stats.

Mutation routes must:

- Require auth.
- Check tenant access.
- Check role or campaign permission.
- Validate request body.
- Write audit logs when the mutation affects campaign or tenant state.
- Return the standard `{ success: false, error, code }` error shape where possible.

## Working With Existing Code

Follow existing patterns:

- CommonJS: `require`, `module.exports`.
- Express routers.
- Firebase Admin SDK.
- Jest and Supertest.
- `rg` for search.
- `apply_patch` for hand edits.

Do not introduce:

- A new framework.
- A TypeScript migration.
- A new database layer.
- A new auth model.
- Large rewrites of unrelated products.

## File Size and Module Boundaries

Keep files reviewable.

Guidelines:

- Router files should stay thin and mostly wire middleware to services.
- Services should hold business logic.
- Validators should hold input shape and normalization.
- Tests should split by behavior once they become hard to scan.

Suggested size limits:

- Router: under 350 lines when practical.
- Service: under 450 lines when practical.
- Validator: under 250 lines.
- Test file: split around 500 lines.

If a file is already large, improve it by extracting focused helpers rather than adding another broad block.

## Parallel Work Strategy

Agents may work in parallel, but only with explicit ownership boundaries.

Good parallel splits:

- Agent A: campaign service and validators.
- Agent B: campaign routes and permission middleware.
- Agent C: tests for tenant/campaign isolation.
- Agent D: docs and API examples.

Bad parallel splits:

- Multiple agents editing `functions/api/smartLinks/smartLinks.js`.
- Multiple agents editing the same test file.
- One agent changing auth while another changes campaign permissions without coordination.
- One agent mounting routes while another renames the router.

When delegating or parallelizing:

1. Declare file ownership before work begins.
2. Avoid overlapping write sets.
3. Prefer additive modules over editing central routers.
4. Integrate through one small mount point.
5. Re-run the focused tests after integration.
6. Do not revert another agent's changes unless explicitly instructed.

Recommended disjoint write sets:

```text
Campaign data model:
  functions/api/campaigns/campaignService.js      (implemented foundation)
  functions/api/campaigns/campaignValidation.js   (implemented foundation)

Campaign permissions:
  functions/api/campaigns/campaignPermissions.js  (implemented foundation)
  functions/api/campaigns/campaignMembershipService.js

Campaign routes:
  functions/api/campaigns/campaignRoutes.js       (implemented foundation)
  functions/index.js                              (/campaigns mounted)

Campaign tests:
  functions/__tests__/kortex-campaigns.test.js    (implemented foundation)

Docs:
  PLAN.md
  SKILL.md
  docs/products/KORTEX.md
```

## Conflict Avoidance

Before editing:

```bash
git status --short
```

If files are already modified:

- Treat them as user or teammate work.
- Read them before touching.
- Do not revert them.
- Keep your edits narrow.
- Mention overlapping files in the final summary.

Avoid broad formatting sweeps unless the task is formatting.

## Testing Commands

From `functions`:

```bash
# KORTEX complete test suite (all phases 1-3.5, 77 tests)
npm run test:kortex -- --runInBand --forceExit

# Individual KORTEX suites
npm run test:kortex -- --testNamePattern="api" --runInBand
npm run test:kortex -- --testNamePattern="campaigns" --runInBand
npm run test:kortex -- --testNamePattern="resolver" --runInBand
npm run test:kortex -- --testNamePattern="hardening" --runInBand

# All tests in repo
npm test -- --runInBand
```

Run all tests when touching shared middleware, mocks, auth, Firestore helper behavior, or route mounting:

```bash
npm run test:all -- --runInBand
```

When starting Phase 4 (domain verification), add new tests to the `npm run test:kortex` script in `package.json`.

If a command fails because Supertest cannot bind a local port in the sandbox, rerun with the appropriate elevated permission.

If unrelated tests fail, record them clearly and do not hide them.

## Firestore Indexes

If adding compound queries, update:

```text
firestore.indexes.json
```

Queries likely to need indexes:

- `campaigns` by `tenantId` plus `status` plus `createdAt`.
- `campaign_links` by `tenantId` plus `campaignId` plus `status`.
- `campaign_events` by `tenantId` plus `campaignId` plus `timestamp`.
- `short_links` by `tenantId` plus `createdAt`.

## Deployment

This project deploys to Firebase project:

```text
kaaykostore
```

Use package scripts from `functions/package.json` or existing deployment scripts. Do not deploy by hand without predeploy checks unless explicitly asked.

Common commands:

```bash
cd functions
npm run predeploy:check
npm run deploy:api
```

## Definition of Done

A backend change is done when:

- The mounted route behavior is clear.
- Existing behavior is preserved (Phases 1-3 behavior locked; new work in Phase 4+).
- New behavior has tests.
- Security checks are server-side (no client-side trust).
- Public responses are redacted where needed (no cross-tenant leaks).
- Firestore indexes are updated if needed.
- **All Phase 1-3 tests remain passing** (77 tests for KORTEX core).
- New Phase tests pass.
- Any unrelated failures are documented.
- Final notes include files changed and tests run.

**Phase 1-3 Contract (Locked):**

Do not change existing behavior in:
- `campaignService.js` — Campaign CRUD and lifecycle control
- `campaignPermissions.js` — Role-based access and membership checks
- `campaignLinkService.js` — Link CRUD with mirror sync and cascade operations
- `campaignPublicResolver.js` — Public namespace resolver with expiry/max-uses enforcement
- Campaign audit logging — Required for all mutations

Do not break:
- Cascade disable/enable on campaign pause/resume/archive
- Campaign membership role semantics (owner, editor, viewer, operator)
- `/campaigns` route surface; extend only if adding Phase 4+
- Expiry date and max-uses enforcement in public resolver

## Product Standard

KORTEX should become a secure campaign operating system, not just a short-link generator.

The platform should let tenants safely delegate campaigns to owners, editors, viewers, and operators while keeping tenant data isolated and public redirects fast.

Build toward that future in small, compatible steps.
