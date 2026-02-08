# 🔗 Kortex API (Smart Links)

Enterprise smart link platform — CRUD, click tracking, attribution, redirect, public API, tenant management.

## Files (21)

| File | Purpose |
|------|---------|
| **Routers** | |
| `kortex.js` | Main CRUD router — mounted at `/smartlinks` |
| `publicApiRouter.js` | External API router — mounted at `/public` (API key auth) |
| `publicRouter.js` | Redirect router — mounted at `/` for `/l/:code` and `/resolve` |
| `tenantRoutes.js` | Tenant sub-router — mounted inside `/smartlinks` |
| **Handlers** | |
| `kortexHandlers.js` | CRUD + stats handlers (create, list, get, update, delete) |
| `publicApiHandlers.js` | Public API handlers (API-key-authed CRUD) |
| `publicRouteHandlers.js` | Redirect + resolve handlers |
| `tenantHandlers.js` | Tenant registration + management |
| **Services** | |
| `kortexService.js` | Core link CRUD business logic |
| `attributionService.js` | Click → install attribution |
| `clickTracking.js` | Click event recording |
| `clickAnalytics.js` | Analytics aggregation |
| `attributionEvents.js` | Attribution event processing |
| `rateLimitService.js` | Per-tenant rate limiting |
| `rateLimitUtils.js` | Rate limit helpers |
| `webhookService.js` | Outbound webhook delivery |
| `webhookSubscriptions.js` | Webhook subscription management |
| **Utilities** | |
| `kortexDefaults.js` | Default link values |
| `kortexEnrichment.js` | Auto-enrich links (favicon, title, OG metadata) |
| `kortexValidation.js` | Input validation |
| `redirectHandler.js` | Redirect logic (platform detection, A/B routing) |
| `redirectErrorPages.js` | Branded error pages |
| `tenantContext.js` | Tenant resolution middleware |

---

## Endpoints (27 total)

### Main CRUD — `/smartlinks` (Firebase Auth)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/smartlinks/health` | Health check | Public |
| GET | `/smartlinks/stats` | Link statistics | `requireAuth` + `optionalAuthForAdmin` |
| POST | `/smartlinks` | Create short link | `requireAuth` + `optionalAuthForAdmin` |
| GET | `/smartlinks` | List all links (with pagination) | `requireAuth` + `optionalAuthForAdmin` |
| GET | `/smartlinks/:code` | Get link by code | Public |
| PUT | `/smartlinks/:code` | Update link | `requireAuth` + `optionalAuthForAdmin` |
| DELETE | `/smartlinks/:code` | Delete link | `requireAuth` + `optionalAuthForAdmin` |
| POST | `/smartlinks/:code/events` | Record click/install events | Public |

**Security middleware on all `/smartlinks` routes:** `botProtection`, `secureHeaders`  
**Honeypot traps:** `/smartlinks/admin/api-key` (GET), `/smartlinks/admin/bulk-import` (POST), `/smartlinks/.env` (GET)

### Tenant Management — sub-routes under `/smartlinks`

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/smartlinks/tenant-registration` | Register new tenant | Rate limited |
| GET | `/smartlinks/tenants` | List tenants | `requireAuth` |
| GET | `/smartlinks/tenants/:tenantId` | Get tenant details | `requireAuth` + `requireRole('super-admin')` |

### Public API — `/public` (API Key Auth)

All routes require `x-api-key` header with appropriate scope. Rate limited: 1000 req/60s.

| Method | Path | Description | Scope |
|--------|------|-------------|-------|
| POST | `/public/smartlinks` | Create link | `create:links` |
| GET | `/public/smartlinks` | List links | `read:links` |
| GET | `/public/smartlinks/:code` | Get link | `read:links` |
| PUT | `/public/smartlinks/:code` | Update link | `update:links` |
| DELETE | `/public/smartlinks/:code` | Delete link | `delete:links` |
| GET | `/public/smartlinks/:code/stats` | Link stats | `read:analytics` |
| GET | `/public/smartlinks/:code/attribution` | Attribution data | `read:analytics` |
| POST | `/public/smartlinks/batch` | Batch create (up to 100) | `create:links` |
| GET | `/public/health` | Health check | None |

### Redirects — root-level

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/l/:code` | Redirect short link | Public (IP rate limited 100/60s) |
| GET | `/resolve` | Resolve link context after app install | Public (IP rate limited) |

---

## Link Document Schema

```javascript
// Firestore: short_links/{code}
{
  code: "lk1ngp",
  shortUrl: "https://kaayko.com/l/lk1ngp",
  qrCodeUrl: "https://kaayko.com/qr/lk1ngp.png",
  tenantId: "kaayko-default",
  tenantName: "Kaayko",
  domain: "kaayko.com",
  pathPrefix: "/l",
  destinations: {
    ios: "https://apps.apple.com/app/kaayko/id123",
    android: "https://play.google.com/store/apps/details?id=com.kaayko",
    web: "https://kaayko.com/store"
  },
  title: "Summer Sale",
  description: "Summer collection promo",
  metadata: { campaign: "summer2025" },
  utm: { utm_source: "instagram", utm_medium: "social", utm_campaign: "summer2025" },
  expiresAt: Timestamp,
  clickCount: 147,
  installCount: 23,
  enabled: true,
  createdBy: "admin@kaayko.com",
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

---

## Redirect Flow

```
GET /l/lk1ngp
  │
  ├── Rate limit check (100/60s per IP)
  ├── Lookup short_links/{code}
  ├── Check: enabled? expired?
  ├── Record click event (async)
  ├── Platform detection (iOS / Android / Web)
  ├── UTM parameter injection
  └── 302 redirect to appropriate destination
```

---

## Firestore Collections

| Collection | Purpose |
|------------|---------|
| `short_links` | Link documents (CRUD) |
| `tenants` | Tenant configuration (domain, plan, limits) |
| `api_keys` | API keys for public API access (scoped) |
| `click_events` | Click tracking data |
| `attribution_events` | Click → install attribution |
| `webhook_subscriptions` | Outbound webhook configs |

---

**Test suites:**
- `__tests__/kortex.test.js` (21 tests) — main CRUD
- `__tests__/kortex-public-api.test.js` (19 tests) — public API
- `__tests__/kortex-redirect.test.js` (9 tests) — redirect + resolve
- `__tests__/integration/kortex-links.integration.test.js` (24 tests)
