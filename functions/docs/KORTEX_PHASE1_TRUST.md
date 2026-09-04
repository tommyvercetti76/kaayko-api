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

## Free tier without accounts (guest workspaces)

Added after the first review: a free user never creates a Firebase user.

- **Create**: `POST /kortex/guest/links` (no auth) → link + QR + a one-time
  **access code** `KX-XXXXXX-XXXX-XXXX-XXXX-XXXX` + a 12-hour session token.
  Sending `session` on later calls adds links to the same workspace (25 max).
  Optional `email` mails the code (queued to `pending_emails` until
  `SENDGRID_API_KEY` is set).
- **Re-access**: `POST /kortex/guest/session` with the code → session token.
  Then `GET /kortex/guest/workspace`, `GET/PATCH/DELETE /kortex/guest/links/:code`,
  `GET /kortex/guest/links/:code/analytics` (last 7 days + lifetime totals).
- **Lost code**: `POST /kortex/guest/recover` (email) always answers 202; a
  matching workspace gets a NEW code by mail (the old one dies). Attaching an
  email later (`POST /kortex/guest/email`) also rotates the code.
- **Lifetime**: `KORTEX_GUEST_LIFETIME_DAYS` (365) from the last check-in;
  every successful code entry renews. `kortexGuestHousekeeping` (daily) disables
  links of dormant workspaces (`disabledReason: guest_expired`); the next code
  entry re-enables them. Nothing is deleted.
- **Upgrade**: a signed-in user (Google / Apple / email account) calls
  `POST /kortex/guest/claim` with the code; the workspace becomes their tenant
  and the code stops working.
- **Security**: 80-bit secret, peppered SHA-256 at rest (never the code),
  constant-time compare, generic error + jitter, lockout after 8 failures per
  workspace, fail-closed per-IP limits (12 creates/h, 15 code tries/15 min,
  5 recoveries/h), honeypot field, destination safety on every create/edit,
  session tokens HMAC-bound to the code version. Guest links use `kx-` codes
  on kaayko.com/l/; the workspace id never appears in a public URL.
- **Secrets**: `KORTEX_ACCESS_PEPPER` and `KORTEX_GUEST_SESSION_SECRET` are
  preferred; without them both derive from `KORTEX_LINK_SIGNING_SECRET`, then
  `ADMIN_PASSPHRASE` (set in prod). Rotating the underlying secret invalidates
  every access code, so treat it like a password-hash pepper.
- **Public QR**: `GET /qr/<code>.png|svg` (hosting rewrite `/qr/**` → api) for
  any live link; this is the `qrCodeUrl` stored on links.
- Firestore indexes added: `tenants (kind, guest.expiresAtMs)`,
  `short_links (tenantId, disabledReason)`, `short_links (tenantId, enabled)`.

## Time-of-day routing (night / day destinations)

Any link can carry `schedule: { timezone, windows: [{ label, start, end, url }] }`
(IANA zone; `HH:MM` 24-hour; up to 8 windows; a window may wrap midnight).

- Evaluation (`api/kortex/linkSchedule.js`): the SERVER clock is converted to
  the link's zone with ICU (`Intl.DateTimeFormat`), so daylight-saving is
  correct forever without a data file. The first matching window's URL is
  used for every platform; no match → normal destinations. Nothing from the
  request (headers, query, cookies) is consulted, so it cannot be spoofed.
- Applied in `redirectHandler.js` (kaayko.com/l/), `tenantLinkResolver.js`
  (alumni host) and the API resolver for plain external links. The matched
  window label is stored on the click event (`metadata.scheduleWindow`).
- Window URLs run through the destination safety engine on create and edit,
  exactly like destinations. Only the owner (guest session or tenant admin)
  can set or clear a schedule (`schedule: null`); public-API updates accept it
  through the field allowlist.
- Landing page: "Options → Send people somewhere else at night" (night URL,
  start/end times, zone auto-filled from the browser); editable in the
  workspace detail. Tests: `__tests__/kortex-schedule.test.js`.

## Capabilities endpoint (what the page may promise)

`GET /api/kortex/guest/capabilities` is public and cheap. It reports
`email` (true only when `SENDGRID_API_KEY` is set), `lifetimeDays`,
`linkLimit`, `analyticsDays`, `sessionHours` and `maxWindows`, all read from
the same config the limits use. The landing page asks it on load and hides
every email-dependent control (email at creation, "email me the code",
"lost your code?" recovery) until email delivery is real, so a first-time
user is never offered something that would silently do nothing. Adding the
SendGrid key reveals those controls without a page change.

## Pass 2 (4 Sep 2026): caps, tags, exports, reports, support

- **Caps / expiry / fallback** — `api/kortex/linkRules.js` (pure). A link may carry
  `limits: { maxClicks, fallbackUrl }`; `expiresAt` stays top-level. Past either,
  all three resolvers redirect to the fallback (no click counted) or serve a 410.
  The fallback URL goes through the safety engine like any destination.
  `GET /kortex/links/:code/resolve` now has the `resolve` limiter and answers
  `LINK_CAPPED` (410) or the fallback with `overLimit`.
- **Campaign tags** — `api/kortex/utmTools.js`. Tags already on the destination
  stay; the link's tags fill gaps; a QR scan with no medium anywhere becomes
  `utm_medium=qr`. Every QR Kortex renders encodes `?s=qr`, so scans and taps are
  told apart (`click_events.metadata.source`, `breakdowns.source`).
- **CSV** — `api/kortex/csvExport.js`. `GET /kortex/:code/clicks.csv` (admin,
  tenant-scoped, plan window) and, for free workspaces,
  `GET /kortex/guest/links/:code/analytics.csv` + `GET /kortex/guest/workspace/export.csv`.
  Formula-leading cells are neutralised. Every export is audited.
- **Abuse reports + kill switch** — `api/kortex/abuseReports.js`. `POST /kortex/report`
  is public, always 202, `report` limiter (fail-closed). Two distinct reporters
  flagging a *guest* link for phishing/malware/scam inside 24 h hold it
  (`abuse_auto_hold` alert). Super-admins: `GET /kortex/reports`,
  `POST /kortex/reports/:id/resolve`, `POST /kortex/tenants/:id/kill|restore`.
  `api/kortex/tenantGate.js` caches one tenant read per redirect (60 s) so a
  killed workspace answers 410 everywhere within a minute.
- **Support** — `api/kortex/supportRequests.js`. `POST /kortex/support` (public,
  guest session or signed in) stores a request with a plan-aware target
  (free 3 business days, pro 1 business day, business 4 h) and emails
  `KORTEX_SUPPORT_EMAIL` when a provider is configured. Super-admins:
  `GET /kortex/support`, `POST /kortex/support/:id/resolve`.
- Public pages: `/kortex/report`, `/kortex/support` (hosting rewrites).
- Tests: `__tests__/kortex-pass2.test.js` (23). Test double gained `Timestamp.fromDate`.

## Sample workspace (4 Sep 2026)

`api/kortex/demoWorkspace.js`. Tenant `g_demo00` (kind guest, `demo: true`, an
unusable code hash: no access code exists for it). Eight links made on the
ordinary link service, each pointing at a Kaayko product and each showing one
delivered variation (plain, night/day, device routing, cap + fallback, end
date, campaign tags, QR table tent, safety review). Scans are synthetic, with
per-link hour/day/device/country/source profiles; visitor hashes are 16 hex
so the analytics module counts people.

- Seed or refresh: `POST /kortex/demo/seed` with `X-Kortex-Sync-Key`
  (= `KORTEX_SYNC_KEY`) or a super-admin token. Idempotent: existing demo
  events are removed and regenerated. `kortexDemoRefresh` does this every
  Monday 03:20 IST so the 7-day window is always full.
- Open it: `GET /kortex/guest/demo` issues a two-hour read-only session
  (`ro: 1`). Every write route answers 403 `READ_ONLY_DEMO`; creating a link
  with a demo session opens a fresh workspace instead. Housekeeping never
  expires the demo tenant.
- `GET /kortex/guest/workspace/analytics` returns per-link 7-day rows plus a
  merged compact event list for the overview charts; per-link analytics now
  carry compact `points` ([ms, platform, device, country, source, window,
  referrerHost]).

## Independent review fixes (4 Sep 2026)

Backend (21 findings) and frontend (18 findings), all addressed; see commits
`c8c3cab` (kaayko-api) and `f853d3b` (kaayko). Operational notes:

- `KORTEX_IP_SALT` is now set in `.env`; without it the salt derives from the
  pepper chain, and outside the emulator it is never a public constant.
- Pepper rotation: set `KORTEX_ACCESS_PEPPER` to the new value and put the old
  one in `KORTEX_ACCESS_PEPPER_PREVIOUS` (comma-separated list). Codes verified
  under an old pepper are re-hashed on use.
- The mail log (`pending_emails`) stores no bodies. Credential-bearing
  templates are not queued without a provider; recovery does nothing without
  a sender. Housekeeping deletes any old queued bodies.
- Abuse auto-hold: three distinct reporters within 24 h, 7-day cooldown after
  a review. Holds survive owner edits; only a reviewer releases them.
- Still a decision for the owner: retention enforcement. Events carry a
  30-day `expiresAt`; nothing deletes them until a TTL policy is enabled:
  `gcloud firestore fields ttls update expiresAt --collection-group=click_events --enable-ttl --project kaaykostore`
- Still unset in production: `GOOGLE_SAFE_BROWSING_API_KEY`, `SENDGRID_API_KEY`,
  Stripe keys.
