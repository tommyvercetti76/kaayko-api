# Kortex — Product Brief (Reality-Aligned)

> **Purpose:** Source-of-truth feature inventory for the Product Owner — landing-page copy, value props, and marketing collateral. Every claim here is verified against the code so marketing does not promise what the backend can't do.
>
> **Rewritten:** 2026-07-09, from a full multi-agent code audit (see [`KORTEX_AUDIT.md`](./KORTEX_AUDIT.md)). Supersedes the May 7, 2026 brief, which oversold ~8 features against the code.
>
> **Status legend:**
> - ✅ **Shipped** — implemented, mounted, reachable, and (mostly) tested.
> - 🟡 **Partial** — works only on a specific path (usually the alumni/campaign vertical) or is missing its management surface. Do **not** market as universal.
> - 🔧 **Roadmap** — designed or stubbed in code but not reachable/enforced. Do **not** market yet.

---

## What Is Kortex?

Kortex is Kaayko's **multi-tenant smart-link platform**: device-aware redirects, campaign attribution, a tenant model, and click analytics behind short codes. Today it is a **strong smart-link engine for the Kaayko ecosystem and the alumni/campaign vertical**, with a credible path to a commercial Bitly/Branch-class product. The honest one-liner for marketing is: *"Links that route by device and report by campaign — built multi-tenant from the start."* Claims beyond that need the status tags below.

---

## Core Feature Set

### A. Smart Link Engine

| Feature | Status | Reality |
|---------|--------|---------|
| Custom short codes (`lk`+4, or vanity) | ✅ Shipped | `smartLinkValidation.js`; uniqueness retry. |
| Multi-platform destinations (iOS/Android/Web) | ✅ Shipped | Per-link `destinations{}`, real device routing. |
| Device-aware routing | ✅ Shipped | User-Agent detection in `redirectHandler.js`. Core differentiator. |
| UTM management (5 fields, aliasing, runtime merge) | ✅ Shipped | Normalized at create + redirect; `src`→`utm_source` aliasing. |
| Link expiry (auto-disable by date) | ✅ Shipped | Returns 410 when expired. |
| Enable/disable toggle | ✅ Shipped | |
| Social-crawler OG previews (no click inflation) | 🟡 Partial | **Alumni path only.** The main `/l/` path counts crawler hits. Don't market as universal. |
| Click caps (max-uses) | 🟡 Partial | Enforced only for `metadata.campaign === 'alumni'` links and the alumni resolver. A regular link's `maxUses` is not enforced. |
| Source-level access windows (`startsAt`/`endsAt`) | 🟡 Partial | Alumni/campaign metadata path. |
| App-store default routing | ✅ Shipped | |
| HMAC-signed URLs | 🔧 Roadmap | Signatures generate, but verification is optional (missing `?sig=` passes) and the secret falls back to a repo-committed default. Not enforced. Do not claim "every link signed." |
| A/B testing (weighted variants) | 🔧 Roadmap | Redirect-side selection exists, but every write path rejects variant arrays — cannot be configured. |

### B. Intent-Based Routing (V2)

| Feature | Status | Reality |
|---------|--------|---------|
| 11 destination types, 5 audiences, 6 intents, 6 sources | ✅ Shipped | `v2LinkIntents.js`, mounted and tested. |
| Semantic routing (one link adapts by who/where/why) | ✅ Shipped | Real differentiator for the alumni/campaign vertical. |

> **Value prop (safe):** "One link, many audiences — admin, alumni, and donor each land where they should."

### C. Click Tracking & Analytics

| Feature | Status | Reality |
|---------|--------|---------|
| Rich per-click context (platform/OS/browser/device/referrer/UTM) | ✅ Shipped | `click_events` schema is richer than baseline Bitly. |
| Click deduplication (SHA-256 fingerprint) | 🟡 Partial | **Alumni path only.** Main path double-counts refreshes. |
| Per-link breakdowns + 7-day trend | 🟡 Partial | Computed from ≤200 recent clicks and shown against a lifetime counter — a **sample presented as a total** past 200 clicks. UTC day buckets skew IST charts. |
| Portfolio / tenant analytics | 🟡 Partial | Reads ≤500 arbitrarily-ordered events; scans all links per request (won't scale). |
| Time-range filtering (7/30/90/all) | 🔧 Roadmap | 30-day event retention intent + frontend-only gating; 90d/all cannot be satisfied. |
| CSV export | 🟡 Partial | Client-side serialization of the ≤200-doc sample; no backend export endpoint. |
| Weekly performance digest | 🔧 Roadmap | Scheduled job runs but reads the wrong (legacy) collection → ~0 clicks for main-path links, and its emails queue to a collection nothing sends. |
| Geo analytics | 🔧 Roadmap | Not captured on clicks (country is used only for in-memory security checks). |

> **Honest analytics claim:** "Recent-click analytics with device and UTM breakdowns." Avoid "full historical analytics," "geo," and "guaranteed dedup" until the pipeline is consolidated.

### D. Mobile Attribution

| Feature | Status | Reality |
|---------|--------|---------|
| Click-to-install attribution | 🟡 Partial | **Newly wired** (attribution branch now reachable via `/resolve`), but end-to-end depends on the mobile platform-association files below. Needs an integration test before marketing. |
| Deferred deep linking | 🟡 Partial | Same — code path now live; OS-level linking blocked until AASA/assetlinks cover Kortex paths. |
| Install idempotency | 🟡 Partial | Non-transactional; concurrent app retries can double-count. |
| Conversion / funnel events | 🔧 Roadmap | `trackCustomEvent` has no reachable call site. |

> Do **not** yet market "compete with Branch and AppsFlyer." Prerequisite: ship `assetlinks.json`, extend the iOS AASA to `/kortex/r/*`, and add an attribution integration test.

### E. Campaign System

| Feature | Status | Reality |
|---------|--------|---------|
| Campaign CRUD + lifecycle (pause/resume/archive) | ✅ Shipped | `campaignRoutes.js`, permission-checked, audit-logged. |
| Membership management | ✅ Shipped | Real Firestore upserts/deletes (the old brief wrongly called this "mock"). |
| Audit log | ✅ Shipped | Real writes (also wrongly called "mock" before). |
| Campaign metrics, auto-categorization, bulk enable/disable | ✅ Shipped | |
| Alumni campaign fields | ✅ Shipped | |
| ROOTS integration (dual-write bridge) | ✅ Shipped | Proxy holds `KORTEX_SYNC_KEY`. |

### F. QR Codes

| Feature | Status | Reality |
|---------|--------|---------|
| QR generation (PNG/SVG, error-correction H) | ✅ Shipped | Real, via MIT `qrcode` lib, behind admin `POST /kortex/qr/generate`. |
| Branded QR (colors + logo, Pro-gated) | ✅ Shipped | |
| Auto QR URL on every link | 🔧 Roadmap | Stored `qrCodeUrl` (`kaayko.com/qr/<code>.png`) 404s — no route/rewrite serves it. |
| QR scan tracking (`qrScans` counter) | 🔧 Roadmap | `trackQRScan` is dead code. |

### G. Multi-Tenant Architecture

| Feature | Status | Reality |
|---------|--------|---------|
| Tenant isolation (authenticated API) | ✅ Shipped | Tenant identity derived server-side from the verified token; cross-tenant 403s on the API. **Firestore rules now lock client-SDK access** (was a world-readable gap — fixed). |
| 4-tier tenant resolution | ✅ Shipped | Header → profile → API key → default. |
| Tenant-prefixed code namespacing | ✅ Shipped | |
| Multi-tenant membership | ✅ Shipped | |
| Custom domains (per-tenant) | 🔧 Roadmap | `domain`/`alumniDomain` fields drive resolution, but no quota, no config endpoint, no DNS setup path. |
| Self-registration | 🟡 Partial | Registration form writes a pending doc; **no approval/provisioning path** turns it into a tenant. |
| Churn grace period | 🔧 Roadmap | `tenantChurnedAt` is read by the redirect handler but never written. |

### H. Security Stack

| Layer | Status | Reality |
|-------|--------|---------|
| Bot/automation scoring | ✅ Shipped | Applies to main redirect routes. |
| Honeypot canary links + trap routes | ✅ Shipped | |
| HMAC-signed URLs | 🔧 Roadmap | Not enforced; default secret (see A). |
| Click-velocity profiling | 🟡 Partial | Alumni path; in-memory (per-instance) — ineffective at scale. |
| Geo-anomaly detection | 🟡 Partial | Alumni path; in-memory. |
| Referrer-farm blocking | 🟡 Partial | Alumni path. |
| Enumeration protection (constant-time 404s) | 🟡 Partial | Alumni path; in-memory. |
| Rate limiting | 🟡 Partial | Firestore-backed on public mutations + per-API-key; the **tenant-level** limit is a no-op, and all limits are `X-Forwarded-For`-spoofable (`trust proxy` unset). |

> **Honest security claim:** "Bot scoring, honeypot canaries, and rate-limited public endpoints." The full "six-layer" stack is real but **runs on the alumni/campaign path**, not universally.

### I. Webhooks

| Feature | Status | Reality |
|---------|--------|---------|
| HMAC-SHA256 signed payloads | ✅ Shipped | Delivery engine signs correctly. |
| Event delivery | 🟡 Partial | Only `link.created` and `link.clicked` fire; `link.updated`/`link.deleted`/`app.installed`/`custom.event` do not. |
| Subscription management (create/list/update/delete) | 🔧 Roadmap | Functions exist; **no HTTP route** — tenants can't register a webhook. |
| Retries / dead-letter queue / replay | 🔧 Roadmap | Fire-and-forget after response (Cloud Functions may kill it); retry delay capped at 5s; no management surface. No SSRF protection yet. |

> Do **not** market "infrastructure-grade webhooks" until subscription CRUD, durable retries (Cloud Tasks/scheduler), and SSRF protection ship.

### J. Billing & Plans

| Feature | Status | Reality |
|---------|--------|---------|
| Stripe checkout + subscription lifecycle | ✅ Shipped | **Webhook signature verification and tenant resolution now fixed** (were broken). |
| Plan definitions (Starter/Pro/Business/Enterprise) | ✅ Shipped | Defined and displayed. |
| Quota enforcement (links / API calls / campaigns) | 🔧 Roadmap | **Not enforced** — a free tenant currently gets the whole product. Pricing/limits are display-only until enforced. |
| Branded-QR / digest gating | ✅ Shipped | The few real plan checks that exist. |

> Publish prices only alongside a commitment to ship enforcement — today the pricing page is aspirational.

### K. Public Developer API

| Feature | Status | Reality |
|---------|--------|---------|
| API-key-authenticated REST (create/list/get/update/delete/batch/stats) | 🟡 Partial | **Now reachable** at `/api/public/*` (mount was broken). Keys are hashed + scoped. |
| API-key provisioning (issue/rotate/revoke) | 🔧 Roadmap | No endpoint — keys require manual Firestore surgery. Blocks self-serve developer adoption. |

---

## Safe Marketing Claims (use these today)

1. **"Links that route by device."** Real, shipped, differentiated.
2. **"One link, many audiences."** V2 intent routing — real for alumni/campaigns.
3. **"Multi-tenant from the start."** Real isolation on the authenticated API; rules hardened.
4. **"Campaign links with attribution and audit."** Campaign system is genuinely complete.
5. **"Branded QR codes."** Real generator.

## Claims to Avoid Until the Roadmap Lands

- "Compete with Branch/AppsFlyer" (attribution needs platform files + tests)
- "Six layers of security" as universal (it's alumni-path)
- "Infrastructure-grade webhooks" (no management surface, no durable retries)
- "A/B test without another tool" (not configurable)
- Any specific pricing/quota as enforced (it isn't)
- "Full analytics / geo / historical" (30-day, sampled, no geo)

---

## Roadmap to a Full Product (from the audit)

**Now shipped (this change set):** Firestore rules lockdown · public API reachable · billing webhook + tenant resolution · attribution `/resolve` wired.

**Next — makes it a product:** consolidate analytics on `click_events` · API-key + webhook provisioning routes · single service-layer domain policy · lock down public event endpoints · split the redirect function + CI gating on `test:kortex` · emulator-backed rules tests.

**Then — scale & trust:** daily rollups · hash IPs at write · enforce plan quotas · tenant approval + offboarding/erasure · observability + uptime checks · per-tenant custom domains + `assetlinks.json`/AASA coverage.

---

## Competitive Positioning (honest)

| Competitor | Where Kortex genuinely competes today |
|-----------|----------------------------------------|
| **Bitly** | Device routing + multi-tenant + campaign attribution (Bitly lacks device routing). |
| **Branch** | Not yet — attribution is newly wired and needs platform files + tests first. |
| **Rebrandly** | Intent routing + campaign system; **behind** on custom-domain self-serve. |
| **Short.io** | **Behind** — no API-key provisioning yet; catch up before an API-first pitch. |

*Treat this document as the single source of truth. When it conflicts with older collateral, this wins.*
