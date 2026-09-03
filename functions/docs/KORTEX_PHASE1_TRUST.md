# Kortex Phase 1 — Trust & Security runbook

Branch: `kortex/phase1-trust` (kaayko-api + kaayko). Built 2026-09-03 from the
Phase 0 gap audit. This file is the deploy checklist and the operator reference
for what changed.

## What ships

| Area | Change | Files |
|---|---|---|
| Destination safety | One assessment for every create/edit path; verdict → link `status` (`active` / `held` / `blocked`); every resolver honours it | `api/kortex/destinationSafety.js`, `safetyPages.js`, `smartLinkService.js`, `redirectHandler.js`, `tenantLinkResolver.js`, `v2LinkIntents.js`, `campaigns/campaignLinkService.js` |
| Threat feeds + re-scan | URLhaus + OpenPhish → Storage snapshot every 6h; daily re-scan of live links | `api/kortex/safetyJobs.js`, `index.js` (`kortexThreatFeedSync`, `kortexLinkRescan`) |
| Review + appeals | `GET /kortex/review`, `POST /kortex/review/:code/{approve,block,hold}`, public `POST /kortex/appeals`, `GET /kortex/appeals`, `POST /kortex/appeals/:id/resolve` | `smartLinks.js` |
| Self-serve signup | `POST /kortex/tenants/provision` (Bearer token of a fresh Firebase user) creates tenant + `admin_users` profile + `role:'admin'` claim; landing page creates the user and sends the verification mail | `api/kortex/provisioning.js`, `kaayko/src/kortex.html` |
| Email verification gate | `requireVerifiedEmail` on link/tenant-link writes for accounts with `admin_users.requireEmailVerification=true` (self-serve only) | `middleware/authMiddleware.js` |
| Input allowlist | Clients can only set listed fields; `bypassDomainCheck`, `tenantId`, `status`, `safety`, … are dropped | `api/kortex/validation/linkInput.js` |
| Isolation | `GET /kortex/:code` needs auth, other tenants get 404; public events need a matching `clickId`; v2 events derive tenant from the link; billing never falls back to `kaayko-default`; `/admin/migrate` super-admin only; public API 404 (not 403) across tenants | `smartLinks.js`, `v2LinkIntents.js`, `billing/router.js`, `publicApiRouter.js` |
| Rate limits | Redirect limiter keys on the real client IP; `tenantProvision` and `appeal` limiters fail closed (503) | `api/weather/sharedWeatherUtils.js`, `middleware/securityMiddleware.js` |
| Audit log | `kortex_audit_logs` on link create/update/delete/approve/block, tenant provisioning, appeals; `GET /kortex/:code/audit` | `api/kortex/auditLog.js` |
| Crawlers / house tenant | Kaayko-owned links get a plain 302; search + social crawlers pass the bot gate and are not counted as clicks | `redirectHandler.js` |

## Environment variables (bind on the `api` function)

| Var | Required | Notes |
|---|---|---|
| `GOOGLE_SAFE_BROWSING_API_KEY` | recommended | Safe Browsing Lookup API v4. Without it the lookup is skipped (`checks.safeBrowsing = 'skipped'`). Create in Google Cloud → APIs & Services → enable "Safe Browsing API" → API key restricted to that API. |
| `KORTEX_SAFETY_FAIL_CLOSED` | optional | `true` → a Safe Browsing outage holds the link for review instead of allowing. |
| `KORTEX_SAFETY_HOLD_HOURS` | optional | Default 24. Tenants younger than this have links to never-seen domains held. `0` disables age-based holds. |
| `KORTEX_SAFETY_FEED_PATH` | optional | Storage object for the feed snapshot. Default `kortex-safety/blocked-hosts.txt` in the default bucket. |
| `KORTEX_IP_SALT` | **already expected, currently unset in prod** | Visitor IP hashes use a public default salt without it. Set it. |
| `KORTEX_LINK_SIGNING_SECRET` | **already expected, currently unset in prod** | Tenant link signatures are `null` without it. Set it. |

The audit found the deployed function binds no secrets at all. Either set these as
plain env vars (`firebase functions:config` is deprecated; use `.env` in
`functions/` for non-secrets) or declare them with `defineSecret` and add
`secrets: [...]` to the `onRequest` options in `index.js` once the values exist
in Secret Manager. Deploying with `secrets:` naming a secret that does not exist
fails the deploy, which is why this branch does not add that line.

## Deploy checklist

1. `cd kaayko-api && firebase deploy --only firestore:indexes` — four new composite
   indexes (`short_links` enabled+createdAt and status+tenantId,
   `kortex_audit_logs` code+atMs and tenantId+atMs). Code has unordered
   fallbacks, so a missing index degrades rather than breaks.
2. Bind the env vars above, then `firebase deploy --only functions:api,functions:kortexThreatFeedSync,functions:kortexLinkRescan`.
3. Trigger the first feed sync as a super-admin so the snapshot exists before
   the scheduler's first run:
   `POST /api/kortex/security/feeds/sync` (Bearer super-admin token).
4. Deploy hosting from `kaayko/` (`deployment/deploy-hosting-safe.sh`): landing
   page signup, admin banner, `/kortex/appeal` page.
5. Firestore TTL (separate from this branch, still open): set a TTL policy on
   `click_events.expiresAt` in the console so retention is real.

## Behaviour notes for operators

- **Held links** answer HTTP 200 with a neutral "being reviewed" page and
  `X-Robots-Tag: noindex`; no click is recorded. Approve from
  `POST /kortex/review/:code/approve` (super-admin). Approving also marks the
  destination's registrable domain as known platform-wide.
- **Blocked links** answer 410. `blockedBy: 'operator'` blocks survive edits;
  safety-derived blocks are re-evaluated when the destination changes.
- **Who gets held**: only tenants younger than `KORTEX_SAFETY_HOLD_HOURS` (or
  with `settings.reviewUnknownDomains = true`) and only for domains never seen
  on the platform. A tenant's own email domain (stored as
  `tenants.trustedDomains` at signup) and ~90 seeded platforms never hold.
  Legacy tenants without `createdAtMs` are treated as established.
- **Re-scan** walks links newest-first with a cursor in
  `kortex_safety_meta/rescan`; 400 links per nightly run, one Safe Browsing
  call per page. It only ever blocks, never holds.
- **Manual blocklist**: add `kortex_blocked_hosts/{host}` documents
  (`{ host, active: true }`); sub-domains of a listed host are covered. The
  runtime cache refreshes within 5 minutes.
- **Appeals** land in `kortex_appeals` (`status: 'open'`); no email is sent yet
  (there is still no mail provider in production).
- **Events**: `POST /kortex/events/:type` now requires the `clickId` Kortex
  appends to mobile destinations. `POST /kortex/events` requires `linkCode`.
  The tenant portal's `track()` calls without a link code are now rejected
  (they were unattributable anyway).

## Tests

`cd functions && npx jest __tests__/kortex-*.test.js __tests__/client-ip.test.js --forceExit`

11 suites, 192 tests. New: `kortex-safety`, `kortex-provisioning`,
`kortex-isolation`, `kortex-safety-jobs`, `kortex-redirect-trust`.
Redirect tests must send a browser `User-Agent` and `Accept-Language`; the bot
gate scores a missing UA as +70 and answers 404.

## Still open after this branch (from the gap audit)

Roles per tenant + invites, custom domains, click caps / expiry fallback,
QR served per link, static QR page, retention clamp + TTL, CSV export,
UTM decode, guest links, pixel attribution, Stripe price IDs / pricing
reconciliation, transactional email.
