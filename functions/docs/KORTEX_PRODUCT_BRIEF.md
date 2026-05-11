# Kortex — Product Brief for Brand & Value Prop Development

> **Purpose:** Source-of-truth feature inventory for the Product Owner to create landing page copy, brand material, value propositions, and marketing collateral.
>
> **Compiled from:** Full codebase audit — 16 backend files, 7 frontend modules, landing page, and all service layers.
>
> **Date:** May 7, 2026

---

## What Is Kortex?

Kortex is a **multi-tenant smart link infrastructure platform** that goes beyond URL shortening. It combines intelligent device routing, campaign attribution, security hardening, and real-time analytics into a single system. Built for institutions, creators, and teams who need links that **think, adapt, and report**.

---

## Core Feature Set (Grouped by Category)

### A. Smart Link Engine

| # | Feature | What It Does | Differentiator? |
|---|---------|-------------|-----------------|
| 1 | **Custom Short Codes** | Auto-generated (`lk` + 4 chars) or user-defined vanity codes | — |
| 2 | **Multi-Platform Destinations** | Set separate destinations for iOS, Android, and Web per link | Most shorteners route everyone to the same URL |
| 3 | **Device-Aware Routing** | Detects platform from User-Agent and routes to the correct destination automatically | Core differentiator — no manual "if iPhone then X" needed |
| 4 | **A/B Testing (Weighted Variants)** | Split traffic across multiple destinations by weight (e.g., 70/30) | Built-in — competitors require external experimentation tools |
| 5 | **UTM Management** | Store and auto-append 5 UTM fields per link; merge with runtime query params | UTM aliasing (`src` → `utm_source`) for cleaner URLs |
| 6 | **Link Expiry** | Auto-disable links after a set date | — |
| 7 | **Enable/Disable Toggle** | Instantly kill or revive a link without deleting it | — |
| 8 | **Click Caps** | Max-uses limit; link auto-disables after N clicks | Useful for exclusivity/scarcity campaigns |
| 9 | **Source-Level Access Rules** | Per-source time windows (`startsAt`/`endsAt`) — e.g., "QR code only works during the event" | Uncommon in the category |
| 10 | **App Store Default** | Toggle to route mobile users to app store when no platform-specific destination is set | — |
| 11 | **HMAC-Signed URLs** | Every link gets a cryptographic signature; optional `?sig=` param for verified access | Enterprise security feature — prevents link tampering |
| 12 | **Social Crawler Detection** | Detects 10+ social platform crawlers (Facebook, Twitter, WhatsApp, Discord, LinkedIn, Slack, Telegram) and serves OG metadata instead of redirecting | Link previews render correctly without inflating click counts |

### B. Intent-Based Routing (V2 Architecture)

| # | Feature | What It Does |
|---|---------|-------------|
| 1 | **11 Destination Types** | `tenant_admin_login`, `tenant_alumni_login`, `tenant_registration`, `tenant_public_page`, `tenant_dashboard`, `campaign_landing`, `campaign_member_view`, `philanthropy_campaign`, `donation_checkout`, `campaign_report`, `external_url` |
| 2 | **5 Audience Types** | admin, alumni, donor, public, invited |
| 3 | **6 Intent Types** | login, register, view, donate, report, share |
| 4 | **6 Source Types** | qr, email, sms, social, manual, print |
| 5 | **Semantic Routing** | A single link adapts behavior based on who clicks it, from which channel, and for what purpose |

> **Value prop:** "Links that understand context. One link does the work of six."

### C. Click Tracking & Analytics

| # | Feature | What It Does |
|---|---------|-------------|
| 1 | **Full Click Context** | Every click records: platform, OS, browser, device type, IP, referrer, UTM params, timestamp, metadata |
| 2 | **Click Deduplication** | SHA-256 fingerprint (IP + UA + Accept-Language) prevents double-counting |
| 3 | **7-Day Trend Charts** | Visual bar chart of daily click volume per link |
| 4 | **Breakdown Dimensions** | Platform, Browser, Device, UTM Source, Referrer — with ranked distribution bars |
| 5 | **Link Health Badges** | Auto-computed: Hot (5+ clicks in 48h), Active, Dormant (no clicks in 14d) |
| 6 | **Portfolio Analytics** | Aggregate view: total clicks, active links, avg clicks/link, dormant count, campaign performance ranking, platform mix, performance buckets |
| 7 | **Time Range Filtering** | 7d, 30d, 90d, all — tier-gated |
| 8 | **CSV Export** | Download full analytics data as spreadsheet |
| 9 | **Weekly Performance Digests** | Automated email when top links drop >30% week-over-week (Pro+ only) |

### D. Mobile Attribution

| # | Feature | What It Does |
|---|---------|-------------|
| 1 | **Click-to-Install Attribution** | Track when a click leads to an app install |
| 2 | **Deferred Deep Linking** | Mobile app resolves the original click context on first open after install |
| 3 | **Install Idempotency** | Prevents double-counting installs |
| 4 | **Custom Funnel Events** | Track downstream actions: signup, purchase, engagement |
| 5 | **Conversion Metrics** | Click count → install count → conversion rate → avg time to conversion |

> **Value prop:** "Compete with Branch and AppsFlyer — attribution built into your links."

### E. Campaign System

| # | Feature | What It Does |
|---|---------|-------------|
| 1 | **Campaign CRUD** | Create, edit, pause, resume, archive campaigns with lifecycle management |
| 2 | **Auto-Categorization** | Links auto-grouped into campaign groups (alumni, roots, admin, marketing, general) based on metadata and URL patterns |
| 3 | **Campaign Metrics** | Per-campaign: link count, click total, live count, status |
| 4 | **Bulk Operations** | Enable/disable all links in a campaign at once |
| 5 | **Alumni Campaign Fields** | Dedicated metadata: sourceGroup, sourceBatch, schoolName, channel, audienceType, organizerRole, sender, maxUses |
| 6 | **ROOTS Integration** | Dual-write bridge syncs links to ROOTS Knowledge Engine API |

### F. QR Code System

| # | Feature | What It Does |
|---|---------|-------------|
| 1 | **Auto-Generated QR** | Every link can generate a QR code instantly |
| 2 | **Branded QR Codes** | Custom foreground/background colors + logo overlay (Pro+) |
| 3 | **High Error Correction** | QR codes with logo use Level H correction — tolerates 30% obstruction |
| 4 | **QR Gallery** | Visual grid of all QR codes with download/copy actions |
| 5 | **QR Scan Tracking** | Separate `qrScans` counter per link |

### G. Multi-Tenant Architecture

| # | Feature | What It Does |
|---|---------|-------------|
| 1 | **Full Tenant Isolation** | All data queries scoped to active tenant |
| 2 | **4-Tier Tenant Resolution** | Header override → user profile → API key → default fallback |
| 3 | **Cryptographic Code Namespacing** | Tenant-prefixed codes with unambiguous character sets |
| 4 | **Multi-Tenant Membership** | Users can belong to multiple organizations |
| 5 | **Custom Domains** | Per-tenant vanity domains (Pro: 1, Business: 5, Enterprise: unlimited) |
| 6 | **Self-Registration** | Public endpoint for new tenant signup |
| 7 | **Churn Grace Period** | 30-day deactivation delay — links keep working during grace period |

> **Value prop:** "Built for B2B from day one — not a single-tenant product with multi-tenant bolted on."

### H. Six-Layer Security Stack

| Layer | Name | What It Does |
|-------|------|-------------|
| 1 | **HMAC-Signed URLs** | Cryptographic link verification with timing-safe comparison |
| 2 | **Click Velocity Profiling** | Detects traffic spikes (3x ramp over 5 one-minute buckets) |
| 3 | **Honeypot Canary Links** | Trap codes (`trap-` prefix) that alert on access |
| 4 | **Bot/Automation Detection** | Scoring system: headless Chrome (90pts), automation tools (95pts), empty UA (70pts); blocked at 70+ |
| 5 | **Geographic Anomaly Detection** | Flags >15 countries or >80% single-country dominance |
| 6 | **Referrer Farm Blocking** | Blocks known traffic farms (fiverr, freelancer, microworkers, etc.) |

Plus:
- **Enumeration Protection** — constant-time 404s with random delays
- **Abuse Spike Detection** — alert at 100 clicks in 5 minutes
- **Rate Limiting** — 4 strategies (IP, user, tenant, API key) with distributed counters
- **Honeypot Trap Routes** — fake admin endpoints that catch attackers

> **Value prop:** "Enterprise-grade link security. Six layers between your links and bad actors."

### I. Webhook System

| # | Feature | What It Does |
|---|---------|-------------|
| 1 | **6 Event Types** | `link.created`, `link.updated`, `link.deleted`, `link.clicked`, `app.installed`, `custom.event` |
| 2 | **HMAC-SHA256 Signed Payloads** | Every delivery cryptographically signed |
| 3 | **12-Retry Exponential Backoff** | Reliable delivery with increasing delays |
| 4 | **Dead Letter Queue** | Failed webhooks stored for 7 days with manual replay |
| 5 | **Delivery Logging** | Full audit trail of every webhook attempt |

> **Value prop:** "Infrastructure-grade webhooks. Your systems stay in sync — guaranteed."

### J. Billing & Plans

| Plan | Price | Links | Analytics | QR | Domains | API Calls |
|------|-------|-------|-----------|-----|---------|-----------|
| **Starter** | Free | 25 | Basic | Standard | 0 | — |
| **Pro** | $29/mo | 500 | Advanced | Branded | 1 | 5K/mo |
| **Business** | $99/mo | 2,500 | Team | White-label | 5 | 25K/mo |
| **Enterprise** | Custom | Unlimited | Full | Full | Unlimited | Unlimited |

### K. Product-Led Growth

| # | Feature | What It Does |
|---|---------|-------------|
| 1 | **"Powered by Kortex" Interstitial** | Free-tier links show branded page before redirecting — drives organic awareness |
| 2 | **Content-Space Auto-Enrichment** | Links auto-populate metadata from content collections (lake, product, category, store) |

---

## Unique Selling Points (for Marketing Copy)

### 1. "Links That Think"
Device-aware routing + intent-based routing means one link does the work of many. No "if iPhone go here" spreadsheets needed.

### 2. "Six Layers of Security"
Enterprise-grade protection stack that most competitors don't come close to. HMAC signatures, velocity profiling, honeypot canaries, bot scoring, geo-anomaly detection, referrer farm blocking.

### 3. "Attribution, Not Just Analytics"
Full click-to-install-to-conversion attribution pipeline. Compete with dedicated attribution platforms — it's built into the link.

### 4. "Multi-Tenant by Design"
Cryptographic namespacing, 4-tier tenant resolution, custom domains, self-registration. Built for institutions and agencies serving multiple clients.

### 5. "A/B Test Without Another Tool"
Weighted destination variants let you split traffic without Optimizely or LaunchDarkly.

### 6. "Webhooks That Don't Drop"
HMAC-signed, 12-retry, dead-letter queue with manual replay. Slack/JIRA-level webhook reliability.

### 7. "One Link, Multiple Audiences"
Intent-based routing: admin sees the dashboard, alumni sees the registration page, donor sees the campaign — same link.

### 8. "QR Codes That Report Back"
Every scan is tracked separately from link clicks. Branded QR with logo overlay and high error correction.

---

## Known Gaps (Roadmap Candidates)

| Gap | Impact | Priority Suggestion |
|-----|--------|-------------------|
| Public REST API not mounted | Blocks developer adoption / integrations | High |
| Campaign member management is mock data | No real team collaboration on campaigns | Medium |
| Campaign audit log is mock data | No accountability trail | Medium |
| No custom domain configuration UI | Users can't self-serve domain setup | Medium |
| No bulk import UI (CSV/spreadsheet) | Friction for migrating from competitors | Medium |
| No link preview/testing tool | Can't QA routing before publishing | Low |
| No real-time analytics (WebSocket/SSE) | No live dashboard during events | Low |
| No user-defined tags/labels | Only auto-categorization, no ad-hoc grouping | Low |
| No link scheduling/rotation | Can't time-shift destinations | Low |
| No conversion goal tracking UI | Backend supports it, no frontend for it | Low |

---

## Competitive Positioning

| Competitor | What They Do | Where Kortex Wins |
|-----------|-------------|-------------------|
| **Bitly** | Basic link shortening + analytics | Device routing, A/B testing, six-layer security, multi-tenant, attribution |
| **Branch** | Mobile attribution + deep linking | Full link management + analytics + campaigns in one platform |
| **Rebrandly** | Branded links + custom domains | Intent routing, campaign system, security stack, webhook reliability |
| **Short.io** | API-first link shortening | Security stack, multi-tenant architecture, alumni/education verticalization |

---

*This document should be treated as the single source of truth for what Kortex can do today. The Product Owner should use this to draft value propositions, feature grids, and messaging hierarchy for the landing page redesign.*
