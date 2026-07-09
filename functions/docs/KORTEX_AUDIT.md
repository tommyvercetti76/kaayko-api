# Kortex — Product-Readiness Audit

> **Date:** 2026-07-09
> **Method:** Multi-agent review across five dimensions (docs accuracy, security/tenancy, product completeness, analytics/data, API ergonomics) plus a completeness-critic pass. Every high/critical finding was adversarially re-verified against the code (62 findings confirmed, 0 refuted). All references are `file:line` at the time of audit.
> **Verdict:** A genuinely well-architected **single-vertical prototype (~60% of a product)**, wrapped in documentation that describes a product roughly two tiers more complete than what actually runs. The core (tenant-scoped link CRUD, device-aware redirects, UTM handling, a ~1,800-line regression suite, a thoughtful auth/tenant model) is real and tested. Much of the "commercial" feature surface is dark-launched library code with no reachable HTTP route.

This document is the source of truth for what Kortex does today. Where it disagrees with `KORTEX_PRODUCT_BRIEF.md`, this document is correct (the brief predates much of the backend and oversells).

---

## Status legend

- ✅ **FIXED** — addressed by the `fix/kortex-tier1-hardening` change set (see [Fixes applied](#fixes-applied-in-this-change-set)).
- 🔴 **OPEN** — not yet addressed.

---

## Fixes applied in this change set

| # | Finding | Files |
|---|---------|-------|
| 0 | **Firestore rules exposed all tenants' links.** `short_links` was world-readable and `link_analytics` world-writable via the public Firebase config, bypassing every API-layer tenant check. Locked both to `if false` (all access is via the Admin SDK in Cloud Functions). | `firestore.rules` |
| 1 | **Public developer API was unreachable.** Mounted at `/api/public` but the prefix-strip middleware rewrites `/api/*`→`/*` first, so the documented path 404'd. Re-mounted at `/public`; verified `/api/public/smartlinks` now routes. | `functions/index.js` |
| 2a | **Stripe billing webhook could never verify signatures.** Global `express.json()` consumed the body before the router's `express.raw()`. Extracted the webhook to a standalone handler mounted before `express.json()`, mirroring the checkout webhook. | `functions/index.js`, `functions/api/billing/stripeWebhook.js`, `functions/api/billing/router.js` |
| 2b | **Billing always targeted the wrong tenant.** Routes read `req.user.tenantId` (never set by auth middleware), so every checkout/subscription/usage call fell back to `'kaayko'`. Switched to the canonical `getTenantFromRequest(req)`. | `functions/api/billing/router.js` |
| 3 | **Click-to-install attribution was dead code.** The only `/resolve` that runs attribution lived in the never-mounted `publicRouter.js`. Ported the `clickId`/`deviceId` attribution branch into the live `deeplinkRoutes.js` `/resolve` (additive — legacy cookie/ctx restoration untouched). | `functions/api/kortex/deeplinkRoutes.js` |

> **Deploy note:** fix #0 requires `firebase deploy --only firestore:rules`. Fixes #1–#3 require `firebase deploy --only functions`. Confirm no external system reads `short_links`/`link_analytics` via the client SDK before shipping #0 (audit found none — all hits were backlog-doc strings).

## Fixes applied — batch 2 (product-readiness hardening)

Verified by a new required test gate: `npm run test:kortex:hardening` (27 tests, all green). CI runs it on every push (`.github/workflows/kortex-ci.yml`).

| Area | Finding closed | Change |
|------|----------------|--------|
| Security | Public V2 event endpoint let anyone attribute events to any tenant | `recordEvent` now derives `tenantId` from the stored link, ignoring caller-supplied tenantId; both public event routes are rate-limited (`v2LinkIntents.js`, `smartLinks.js`) |
| Security | Domain allowlist bypassable via public API / tenant-links | Enforcement moved into `smartLinkService.create/updateShortLink` via a shared `domainPolicy.js`, so admin, public API, batch, and tenant-link paths share one rule (default tenant → Kaayko whitelist; real tenants → their `allowedDomains` or default-open) |
| Security | Webhook SSRF + no management surface | New `ssrfGuard.js` (https-only; blocks loopback/link-local/private/metadata) wired into `createWebhookSubscription`/`update`; new `/kortex/webhooks` CRUD routes (tenant-scoped) |
| Security | HMAC link secret fell back to a repo-committed default | `linkSecurityService.js` is now fail-closed (no default secret; signing/verification disabled without the env var) + timingSafeEqual length guard |
| Security | Raw IPs stored per click (GDPR/DPDP) | `clickTracking.js` stores a salted hash of the client IP, never the raw address |
| Security | Raw `error.message`/Firestore errors leaked to clients | Sanitized the router's 500 responses (`smartLinks.js`) |
| Product | Plan limits unenforced | `createShortLink` enforces `PLAN_LIMITS[plan].links` per tenant (shared `billing/planLimits.js`); default tenant unlimited |
| Product | No API-key provisioning surface | New `/kortex/api-keys` CRUD (create/list/revoke, tenant-scoped, scope-validated, plaintext returned once) |
| Product | Webhook events `link.updated`/`link.deleted` never fired | PUT/DELETE handlers now emit them |
| Analytics | Weekly digest read the wrong (legacy) collection → ~0 clicks | Digest now reads `click_events` |
| Ops | No CI, no rollback story, no observability | Added `kortex-ci.yml`, a structured `logger.js` wired into the redirect failure path, and a deploy/rollback/monitoring runbook in `SKILL.md` |

**Still open (next):** analytics rollups + full main-path dedup/crawler-exclusion consolidation; `X-Forwarded-For`/`trust proxy` hardening (deferred — needs coordinated changes across all abuse-code call sites to avoid a half-fix); split the redirect handler into its own function + `minInstances`; tenant approval/offboarding + GDPR erasure; the 9 pre-existing legacy test failures (redirect/resolver/hardening suites) to make the full suite a required gate.

---

## CRITICAL / HIGH — open

### Security & multi-tenant isolation

- 🔴 **Unauthenticated event endpoints allow cross-tenant metric inflation and analytics poisoning.** `POST /kortex/events/:type` (`smartLinks.js:1061-1128`) increments `installCount` on any `linkId` with no auth/tenant check; `POST /kortex/events` (`smartLinks.js:251-267` → `v2LinkIntents.js:249-266`) writes `kortex_events` with a body-supplied `tenantId`. An attacker can fabricate clicks/conversions attributed to any tenant — the numbers the product bills and reports on. **Fix:** require a signed `clickId`/visit token, derive `tenantId` from the stored link, add per-IP/per-link rate limiting + dedup.
- 🔴 **Webhook subsystem has no SSRF protection and stores secrets in plaintext.** `createWebhookSubscription` (`webhookService.js:204-241`) validates only URL-parseability; `sendWebhook` then POSTs to it (`:81-86`). A tenant webhook can target `169.254.169.254` (GCP metadata) or internal hosts. Secrets stored cleartext (`:231`). `fetch` `timeout` option is silently ignored by undici. Exposure is latent today (no mount) but the code is exploitable the moment subscription CRUD ships. **Fix:** https-only, block RFC1918/loopback/link-local/metadata (re-check post-DNS), per-tenant allowlist, KMS-encrypt secrets, `AbortController` timeout.
- 🔴 **Link HMAC signatures use a hardcoded default secret and are never enforced.** `SIGNING_SECRET` falls back to a repo-committed literal when `KORTEX_LINK_SIGNING_SECRET` is unset (`linkSecurityService.js:21`); `verifySignature` treats a missing `?sig=` as pass (`:32`). The brief's "every link cryptographically signed" is false. **Fix:** fail closed if the env secret is absent; document that signing is opt-in.
- 🔴 **No destination-domain allowlist on the public API or V2 tenant-link creation.** The whitelist lives only in the admin router (`smartLinks.js:788-819, 976-987`); `publicApiRouter.js` create/batch and `v2LinkIntents.js:270-321` apply only an http/https check. Any API-key/tenant-admin client can mint kaayko-branded links to arbitrary domains. **Fix:** move policy into `smartLinkService.create/updateShortLink` so every entry point shares it.
- 🔴 **Firestore rules world-exposed all tenants' data** — see fix #0 above (now ✅). Listed here because it is the single highest-impact isolation gap and the API-layer reviewers could not see it.

### Product completeness

- 🔴 **Plan limits are decorative — zero quota enforcement.** `PLAN_LIMITS` is displayed but nothing enforces link counts, API calls, or campaigns; a free tenant gets the whole product. `api_usage` (read by `/billing/usage`) is never written. **Fix:** `countFromServer` check in `createShortLink`, write `api_usage` from `apiKeyMiddleware`, enforce `analytics_range_days` server-side.
- 🔴 **Destination whitelist locks the product to kaayko.com** and is bypassable via the API (see security item above). Disqualifying for ecosystem/tenant use. **Fix:** per-tenant `allowedDomains` (already modeled in `tenants.settings`) + default-open for the Kaayko tenant.
- 🔴 **No API-key or webhook provisioning surface.** `createApiKey`/`revokeApiKey`/`listApiKeys` (`apiKeyMiddleware.js:236-314`) and webhook subscription CRUD have zero call sites — programmatic access requires hand-writing a hashed Firestore doc. **Fix:** `/kortex/api-keys` and `/kortex/webhooks` CRUD (auth + admin + tenant-scoped) wrapping the existing helpers.
- 🔴 **A/B / weighted variants cannot be configured.** Redirect-side `selectDestinationVariant` handles arrays, but every write path runs `new URL(value)` on destinations and rejects arrays (`smartLinkService.js` create/update). The feature is unreachable with product-created data. **Fix:** extend validation to accept variant arrays, or strike from positioning.
- 🔴 **Tenant self-serve onboarding dead-ends.** Both registration endpoints write `pending_tenant_registrations` and stop; `createTenant()` has zero callers; approval/notification emails are TODOs; `tenantChurnedAt` (the 30-day grace) is read but never written. **Fix:** build the approval → `createTenant` → `admin_users` → email path; wire `tenantChurnedAt` into the (now-fixed) subscription-cancelled webhook.
- 🔴 **Webhook delivery is fire-and-forget in a dying function.** Retries are launched via a non-awaited promise after the HTTP response (Cloud Functions may kill background CPU); "12-retry exponential backoff" is actually capped at 5s (`webhookService.js:418`); `link.updated`/`link.deleted` never fire despite SKILL.md claiming PUT/DELETE trigger webhooks. **Fix:** move retries/DLQ to a scheduled function or Cloud Tasks; emit the missing events.
- 🔴 **QR URLs stored on every link 404.** `createShortLink` writes `qrCodeUrl = kaayko.com/qr/<code>.png` but no route/rewrite serves `/qr/*.png`; the real generator is only behind admin `POST /kortex/qr/generate`. `trackQRScan` (the `qrScans` counter) is dead. **Fix:** add the rewrite/route or stop storing the URL; wire scan tracking or drop the claim.
- 🔴 **"Powered by Kortex" interstitial fires for the whole default tenant.** `isStarterLink()` is true for `kaayko-default` and missing tenants, so every `kaayko.com/l/*` link renders a 200 HTML landing page + JS redirect instead of a 302 — breaks redirect semantics for curl/apps/in-app browsers and adds latency to every ecosystem click. **Fix:** gate the interstitial on real starter tenants only; never on the default tenant.

### Analytics & data

- 🔴 **No single source of truth for clicks — data fragmented across 7 collections written by 3 redirect paths.** Main `/l/` writes `click_events`; alumni dual-writes `click_events`+`smartLinkClicks`; V2 intent links write only `kortex_events`; `/events/:type` writes `link_analytics`; legacy writes `link_clicks`/`deeplink_analytics`; installs write `install_events`. Every dashboard number disagrees with every other. **Fix:** consolidate on `click_events` with a `resolvedVia` discriminator; route V2 through `trackClick`; migrate + drop legacy.
- 🔴 **Weekly digest reads only legacy `smartLinkClicks`**, which the main path never writes → most links report ~0 clicks; digest emails are queued to `pending_emails`, which nothing consumes. **Fix:** point the digest at `click_events`; wire `pending_emails` to a real sender.
- 🔴 **No dedup and no crawler exclusion on the primary redirect path** — refreshes and every WhatsApp/Slack/Twitter preview inflate counts. Both protections exist only on the alumni path. **Fix:** port crawler-exclusion + fingerprint-dedup into `handleRedirect`, or flag `isBot` per click and filter on read.
- 🔴 **Raw IPs + full user agents stored per click and returned by the public stats API** (`GET /api/public/smartlinks/:code/stats` returns up to 100 raw click docs including `ip`). GDPR/DPDP liability, worsened by exposure through a partner API. The `ip` field also means two different things depending on writer (raw vs SHA-256 hash). **Fix:** hash IPs at write everywhere; strip `ip`/`rawUserAgent` from responses.
- 🔴 **Analytics read paths scan unbounded or sample-as-total.** `getLinkAnalytics` reads ALL click/install docs per call (100k+ reads on a popular link); `GET /kortex/:code/clicks` computes breakdowns + the 7-day chart from ≤200 docs while reporting the lifetime counter as the total; tenant analytics counts from ≤500 arbitrarily-ordered `kortex_events`. No rollups, no sharded counters. **Fix:** scheduled daily rollups (`link_daily_stats`), hard limits + date ranges, shard `clickCount` for viral links.

### API ergonomics

- 🔴 **Three link-creation paths enforce three different security policies** — admin enforces the domain whitelist; API-key and tenant-link paths bypass it (see security). **Fix:** single policy in the service layer.

---

## MEDIUM — open (grouped)

**Docs (fix alongside the brief rewrite):**
- 🔴 README "Runtime Mounts" omits `/api/public` and the tenant link resolver (`functions/index.js` has 7 Kortex mounts, README shows 5).
- 🔴 Brief says campaign membership/audit is "mock data"; the mounted campaign routes do real Firestore upserts/deletes with permission checks + audit writes (`campaignRoutes.js:141-269`). Stale.
- 🔴 Brief presents the six-layer security stack as universal; most layers run only on the host-gated alumni path (`runSecurityChecks`/`tenantLinkResolver`), not the main redirect routes.
- 🔴 Brief's pricing ($29/$99), per-plan domain quotas, and "tier-gated" analytics ranges are not stored or enforced anywhere in the backend.
- 🔴 ~8 live endpoints appear in no doc (`/kortex/tenants/register`, `/kortex/digest/trigger`, `/kortex/qr/generate`, `/kortex/roots-sync`, `/kortex/:code/clicks`, the V2 surface, `/security/*`); SKILL.md's table omits the entire V2 surface.
- 🔴 Dead code documented as live: `smartLinkDefaults.js`, `smartLinkEnrichment.js` (content-space enrichment), QR scan tracking — none execute.
- 🔴 No API reference (zero request/response examples), no webhook consumer guide, no custom-domain setup, no changelog/versioning.
- 🔴 `CLAUDE.md` names `functions/api/index.js` as the entry point (doesn't exist — it's `functions/index.js`) and describes a custom-claims auth model Kortex doesn't use (it uses `admin_users` roles + `X-Admin-Key`).

**Security:**
- 🔴 Rate limiting, dedup, enumeration protection bypassable via `X-Forwarded-For` spoofing — `trust proxy` is never configured (`functions/index.js`); abuse code trusts the leftmost XFF.
- 🔴 In-memory maps for enumeration protection / velocity profiling / geo history are per-instance — ineffective on horizontally-scaled Cloud Functions.
- 🔴 Shared static `X-Admin-Key` reuses `KORTEX_SYNC_KEY` (also sent to an external Cloud Run service) as the production admin passphrase — one secret, full admin over every tenant.
- 🔴 `GET /kortex/:code` (`optionalAuth`) discloses `title`/`description`/`shortUrl` for any code to any caller — a cross-tenant metadata oracle.
- 🔴 Multiple handlers echo raw `error.message` (incl. Firestore index-creation URLs) to clients, violating `CLAUDE.md`'s sanitization rule (`smartLinks.js:186,222,246,321,346,409,531,552`, list `:930`).

**Analytics / data:**
- 🔴 `click_events` has a 30-day `expiresAt` intent but no scheduled cleanup and no Firestore TTL policy declared; five other event collections grow unbounded.
- 🔴 Missing composite indexes for `smartLinkClicks` (dedup + digest queries) — likely fail on a clean deploy.
- 🔴 Non-transactional read-then-write in `trackInstall` and alumni `isDuplicateClick` double-counts under concurrent app retries.

**Product / API:**
- 🔴 Primary `/l/:id` redirect capped at 30 req/min per IP (borrowed weather middleware) — throttles campus/corporate NAT traffic at exactly peak campaign moments.
- 🔴 Missing table-stakes vs Bitly/Dub.co: password protection, link edit history, tags/search, bulk import, custom-domain management.
- 🔴 "v2" is a feature label, not a versioning strategy; self-reported versions disagree (`health` says v4, public API says v5.0).
- 🔴 Response envelope/status-code drift between admin (200 on create) and public (201) routers for identical operations.
- 🔴 Public-API `tenantRateLimit` is a no-op (runs before `requireApiKey`, so `tenantId` is always undefined) — the advertised monthly quota never fires.
- 🔴 Integration story for other Kaayko modules today: only two workable paths — `X-Admin-Key` (full-admin shared secret) or in-process `require('smartLinkService')`. Document the in-process pattern as the sanctioned internal path until API keys ship.

---

## LOW — open

- 🔴 Brief's "Click Caps" and "Click Deduplication" are alumni-campaign-specific, not general link features.
- 🔴 Daily trend buckets use UTC (`timestamp.substring(0,10)`); for IST tenants every click 00:00–05:30 IST lands on the previous day — the 7-day charts are shifted.
- 🔴 Click tracking is `await`ed on the redirect hot path (2-3 sequential Firestore round trips before `res.redirect`) — ~100-300ms added latency per click.
- 🔴 Validation coverage patchy; code-format rules disagree across four modules.
- 🔴 State-changing migration behind `GET /kortex/admin/migrate`.
- 🔴 SKILL.md campaigns table omits the 7 campaign-link routes; KORTEX.md omits `kortex-hardening.test.js`.

---

## Operational readiness (completeness-critic pass)

These are below the HTTP/API layer and block ecosystem-wide adoption independent of features:

- 🔴 **No deploy/rollback story; blast radius is the whole platform.** Kortex redirects are one route inside the single `exports.api` function (512MiB, no `minInstances`) shared with weather/kutz/store/kreators — a bad deploy of any module kills every live link. Predeploy gates only camera tests (`test:smoke` = `camera-api.test.js`); the kortex suite never gates a deploy. No CI, no staging convention, no canary, no documented rollback. Cold starts add multi-second first-click latency. **Fix:** split the redirect handler into its own function (or `minInstances`), add CI running `test:kortex`, pin a staging project, document rollback in SKILL.md.
- 🔴 **No tenant offboarding or data-deletion path.** `DELETE /kortex/:code` removes one doc; all click/analytics/event records referencing it live forever, unqueryable by owner. Combined with raw-IP storage, GDPR/DPDP erasure is impossible without manual Firestore surgery. **Fix:** tenant-offboarding function (disable → cascade delete/anonymize), soft-delete + scheduled purge for links, documented retention policy.
- 🔴 **Zero production observability.** ~90 unstructured `console.log/error` lines; no metrics, no error alerting, no uptime check. `security_alerts` and the digest queue are written but never consumed — the operator learns redirects are down only from user complaints. **Fix:** structured logging, log-based alerts on redirect 5xx/404 spikes, external uptime check on `/kortex/health`.
- 🔴 **Tests run against a 215-line hand-rolled `firebase-admin` mock** — no emulator. Missing indexes, the world-readable rules, unenforced TTL, and dedup races are structurally invisible to the suite. **Fix:** add an emulator-backed integration suite (rules tests, one query per composite index, one redirect round-trip) and wire into CI/predeploy.
- 🔴 **Deep-link platform files half-missing.** No `assetlinks.json` anywhere → Android App Links can't verify. iOS AASA exists but its path list doesn't cover `/kortex/r/*` or the alumni resolver → canonical Kortex links can't open the iOS app. AASA hardcodes Kaayko's team/app IDs (no per-tenant mechanism), capping the multi-tenant Branch-competitor pitch at single-app use. **Fix:** ship `/.well-known/assetlinks.json`, add Kortex paths to AASA, or drop the attribution claims.
- 🔴 **Wildcard CORS** (`cors: true`) on all admin endpoints — combined with the shared `X-Admin-Key`, any web page that obtains the key can script authenticated admin calls. **Fix:** allow-list the dashboard origin on admin/campaign routes; leave redirects origin-agnostic.
- 🔴 **No Firestore cost model.** ~2-3 reads + 2-4 writes per redirect across 7 collections, plus full re-reads on every dashboard view (no rollups). At ~1M clicks/month that is several million billed writes with no budget alert. **Fix:** daily rollups, serve dashboards from them, write a one-page capacity note before pointing ecosystem traffic at it.

**Cleared by the critic (no action needed):** dependency/licensing posture is clean (MIT `qrcode`, current `firebase-admin` 13 / `functions` 7, Node 22 — no copyleft/abandonware); deploy scripts use `set -euo pipefail` with a predeploy gate; the rest of `firestore.rules` correctly follows deny-by-default (`short_links`/`link_analytics` were the outliers).

---

## Recommended sequencing

1. **Done in this change set:** rules lockdown, `/api/public` mount, billing webhook + tenant resolution, attribution `/resolve`.
2. **Next (makes it a product):** consolidate analytics on `click_events`; API-key + webhook provisioning routes; single service-layer domain policy; lock down public event endpoints; split the redirect function + add CI gating on `test:kortex`; emulator-backed rules tests.
3. **Scale & trust:** scheduled daily rollups; hash IPs at write; enforce plan quotas; tenant approval + offboarding/erasure; observability + uptime checks; per-tenant custom domains + platform association files.
