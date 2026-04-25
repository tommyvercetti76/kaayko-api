---
description: Use when working on Kortex — smart links, short codes, redirect handling, tenant management, link analytics, billing, or any file under functions/api/smartLinks/, functions/api/auth/, or functions/api/billing/. Also trigger for authMiddleware, securityMiddleware, or apiKeyMiddleware changes that affect Kortex.
---

# Kortex API — Developer Runbook

## Purpose

Kortex is Kaayko's smart-linking and redirect platform. It generates short codes (e.g. `lk1ngp`), routes clicks to platform-specific destinations (iOS/Android/Web), tracks click analytics, supports multi-tenant isolation, and manages subscription billing via Stripe.

---

## Key Files

| File | Responsibility |
|------|---------------|
| `functions/api/smartLinks/smartLinks.js` | Main router — all `/smartlinks/*` endpoints |
| `functions/api/smartLinks/smartLinkService.js` | CRUD business logic (create, list, get, update, delete) |
| `functions/api/smartLinks/redirectHandler.js` | Redirect logic — platform detection, A/B routing, click tracking |
| `functions/api/smartLinks/tenantContext.js` | Multi-tenant scoping — resolves tenant from headers/user/API key |
| `functions/api/smartLinks/clickTracking.js` | Click event creation, device info parsing, attribution |
| `functions/api/smartLinks/webhookService.js` | Outbound webhook notifications with HMAC signing + retry |
| `functions/api/smartLinks/smartLinkValidation.js` | Code generation, format validation, UTM normalization |
| `functions/api/smartLinks/smartLinkDefaults.js` | Default destinations per content space (lake, store, reads…) |
| `functions/api/smartLinks/smartLinkEnrichment.js` | Metadata validation and default field population |
| `functions/api/smartLinks/publicApiRouter.js` | **NOT MOUNTED** — external API key access (future; see Known Issues) |
| `functions/api/smartLinks/rateLimitService.js` | Tenant-level rate limiting (for publicApiRouter when mounted) |
| `functions/api/smartLinks/attributionService.js` | Install attribution — click-to-install mapping |
| `functions/api/campaigns/campaignRoutes.js` | Campaign management router mounted at `/campaigns` |
| `functions/api/campaigns/campaignService.js` | Campaign CRUD, membership writes, audit logs |
| `functions/api/campaigns/campaignPermissions.js` | Campaign role and permission checks |
| `functions/api/campaigns/campaignValidation.js` | Campaign request validation and normalization |
| `functions/api/auth/authRoutes.js` | `/auth/*` — logout, /me, token verify |
| `functions/api/billing/router.js` | `/billing/*` — Stripe subscription management |
| `functions/middleware/authMiddleware.js` | Shared RBAC — Firebase token + X-Admin-Key |
| `functions/middleware/securityMiddleware.js` | Rate limiting (Firestore-backed), bot protection, secure headers |
| `functions/middleware/apiKeyMiddleware.js` | API key validation (used by publicApiRouter) |

---

## Endpoints

### Smart Links (`/smartlinks`)

| Method | Path | Auth | Side-effects |
|--------|------|------|-------------|
| GET | `/smartlinks/health` | Public | — |
| GET | `/smartlinks/admin/migrate` | requireAuth + requireAdmin | One-time migration — adds tenant fields to existing links |
| POST | `/smartlinks/tenant-registration` | Public (rate-limited: 3/hr) | Creates `pending_tenant_registrations` doc |
| GET | `/smartlinks/tenants` | requireAuth | — |
| GET | `/smartlinks/stats` | requireAuth + requireAdmin | Tenant-scoped aggregate stats |
| GET | `/smartlinks/r/:code` | Public | Tracks click, performs redirect |
| POST | `/smartlinks` | requireAuth + requireAdmin | Creates `short_links` doc, triggers email + webhook |
| GET | `/smartlinks` | requireAuth + requireAdmin | — |
| GET | `/smartlinks/:code` | Public | — |
| PUT | `/smartlinks/:code` | requireAuth + requireAdmin | Updates `short_links` doc, triggers webhook |
| DELETE | `/smartlinks/:code` | requireAuth + requireAdmin | Deletes `short_links` doc, triggers webhook |
| POST | `/smartlinks/events/:type` | Public | Creates `link_analytics` doc |

### Auth (`/auth`)

| Method | Path | Auth |
|--------|------|------|
| POST | `/auth/logout` | requireAuth |
| GET | `/auth/me` | requireAuth |
| POST | `/auth/verify` | Public |

### Campaigns (`/campaigns`)

| Method | Path | Auth | Side-effects |
|--------|------|------|-------------|
| GET | `/campaigns/health` | Public | — |
| POST | `/campaigns` | requireAuth + tenant admin | Creates `campaigns`, owner membership, audit log |
| GET | `/campaigns` | requireAuth + tenant admin | Tenant-scoped list |
| GET | `/campaigns/:campaignId` | requireAuth + campaign read permission | — |
| PUT | `/campaigns/:campaignId` | requireAuth + campaign update permission | Updates campaign, audit log |
| POST | `/campaigns/:campaignId/pause` | requireAuth + pause permission | Sets status `paused`, audit log |
| POST | `/campaigns/:campaignId/resume` | requireAuth + pause permission | Sets status `active`, audit log |
| POST | `/campaigns/:campaignId/archive` | requireAuth + archive permission | Sets status `archived`, audit log |
| GET | `/campaigns/:campaignId/members` | requireAuth + member management permission | — |
| POST | `/campaigns/:campaignId/members` | requireAuth + member management permission | Upserts membership, audit log |
| DELETE | `/campaigns/:campaignId/members/:uid` | requireAuth + member management permission | Deletes membership, audit log |

### Billing (`/billing`)

| Method | Path | Auth |
|--------|------|------|
| GET | `/billing/config` | Public |
| GET | `/billing/subscription` | requireAuth |
| POST | `/billing/create-checkout` | requireAuth + Stripe configured |
| POST | `/billing/downgrade` | requireAuth |
| POST | `/billing/webhook` | Public (Stripe signature verified) |
| GET | `/billing/usage` | requireAuth |

---

## Auth & Middleware Stack

```
All smartlinks routes:
  secureHeaders → botProtection → [route-specific auth]

Protected CRUD:
  secureHeaders → botProtection → requireAuth → requireAdmin → handler

Public redirect:
  secureHeaders → botProtection → handler (no auth)

Tenant registration:
  secureHeaders → botProtection → rateLimiter('tenantRegistration') → handler
```

**Auth methods supported:**
- `Authorization: Bearer <Firebase ID token>` — standard user auth
- `X-Admin-Key: <ADMIN_PASSPHRASE>` — internal tooling shortcut
- `X-Kaayko-Tenant-Id: <tenantId>` — super-admin tenant override, or assigned-tenant switch for admins with `tenantIds[]`

**Rate limits (Firestore-backed — survives cold starts):**
| Limit type | Max | Window |
|-----------|-----|--------|
| `login` | 5 | 15 min |
| `tenantRegistration` | 3 | 1 hr |
| `tenants` | 20 | 1 min |
| `api` (default) | 100 | 1 min |

---

## Data Model (Firestore)

### `short_links/{code}`
```
code, shortUrl, qrCodeUrl, tenantId, tenantName, domain, pathPrefix
destinations: { ios, android, web }
title, description, metadata, utm
expiresAt, clickCount, installCount, uniqueUsers[]
enabled, createdBy, createdAt, updatedAt
```

### `link_analytics/{analyticsId}`
```
clickId (c_<16hex>), linkCode, tenantId, timestamp, timestampMs
platform (ios|android|web), deviceInfo, userAgent, ip
referrer, utm, redirectedTo
installAttributed, installTimestamp
```

### `tenants/{tenantId}`
```
id, name, domain, pathPrefix, plan, subscriptionStatus
stripeCustomerId, stripeSubscriptionId, currentPeriodEnd
settings, enabled, createdAt, updatedAt
```

### `admin_users/{userId}`
```
uid, email, role (super-admin|admin|viewer)
tenantId, tenantIds[], tenantName, permissions[]
```

### `pending_tenant_registrations/{id}`
```
organization: { name, domain }
contact: { email, phone }
status (pending|reviewed|approved|rejected)
submittedAt, reviewedAt, reviewedBy
```

### `rate_limits/{key}` / `security_logs/{logId}`
Internal rate limiting and security audit collections.

---

## Error Shape

All Kortex routes use this standard shape:

```json
// Error
{ "success": false, "error": "Short title", "message": "Human message", "code": "ERROR_CODE" }

// Success
{ "success": true, ...payload }
```

**Common error codes:**
`AUTH_TOKEN_MISSING`, `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_INVALID`, `AUTH_FAILED`,
`NOT_ADMIN_USER`, `INSUFFICIENT_PERMISSIONS`, `ALREADY_EXISTS`, `NOT_FOUND`,
`TENANT_ACCESS_DENIED`, `ADMIN_NOT_CONFIGURED`

**HTTP status codes:** 200, 201, 400, 401, 403, 404, 409, 410, 429, 500, 503

---

## Short Code Format

- Generated: `lk` + 4 random alphanumeric chars (e.g. `lk1ngp`)
- Validation regex: `/^[a-zA-Z0-9_-]{3,50}$/`
- Uniqueness: checked in Firestore with up to 5 retry attempts
- UTM whitelist: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` — normalized to lowercase, max 100 chars each

---

## Tenant Resolution Order

1. `X-Kaayko-Tenant-Id` header (super-admins, or admins assigned to that tenant)
2. User's `tenantId` in `admin_users` profile
3. API key's `tenantId`
4. Default: `kaayko-default`

---

## Plan Limits (Billing)

| Plan | Links | API calls/mo |
|------|-------|-------------|
| starter | 25 | 0 |
| pro | 500 | 5,000 |
| business | 2,500 | 25,000 |
| enterprise | ∞ | ∞ |

---

## Known Issues & Gaps

- **`publicApiRouter.js` is NOT mounted** — the file exists at `functions/api/smartLinks/publicApiRouter.js` and defines API-key-authenticated endpoints for external clients (`POST /api/public/smartlinks`, batch create, stats, attribution). It is intentionally not yet mounted in `functions/index.js`. Do not call `/api/public/*` paths — they will 404. Mount when external API access is ready to ship.
- **KORTEX regression suite exists** — run `npm run test:kortex -- --runInBand --forceExit` from `functions`. Keep adding coverage for campaign ownership, tenant scoping, CRUD, redirect behavior, billing config, and public redaction.
- **Some frontend docs still reference `/public/smartlinks`** — should be updated when publicApiRouter is mounted.

---

## Improvement Checklist

- [x] secureHeaders + botProtection applied to all smartlinks routes
- [x] Firestore-backed rate limiting on public mutation endpoints
- [x] Tenant isolation with `X-Kaayko-Tenant-Id` override
- [ ] Mount `publicApiRouter.js` when external API access is needed
- [x] Add `functions/__tests__/kortex-api.test.js` (tenant isolation, public redaction, event validation, redirect behavior — see Testing section)
- [x] Wire KORTEX regression suite into `functions/package.json` (npm run test:kortex)

---

## Testing

**Run existing smoke tests:**
```bash
cd functions && npm run test:smoke
```

**Core tests to keep passing** (`functions/__tests__/kortex-api.test.js`):
1. `GET /smartlinks/health` → 200
2. `GET /smartlinks/stats` without auth → 401 with `AUTH_TOKEN_MISSING`
3. `POST /smartlinks` without auth → 401 with `AUTH_TOKEN_MISSING`
4. `GET /smartlinks/:code` public read → redacted link shape
5. `GET /smartlinks/r/:code` (redirect) → 302 to correct destination
6. Platform detection in redirect: iOS User-Agent → ios destination
7. Expired link redirect → 410 HTML error page
8. `DELETE /smartlinks/:code` without admin → 403
9. Tenant admin list/create/update/delete cannot cross tenant boundary
10. Public event endpoint rejects unsupported event types

**Emulator setup:**
```bash
firebase emulators:start --only functions,firestore,auth
# Test against: http://localhost:5001/kaaykostore/us-central1/api
```

**Environment variables needed:**
```
ADMIN_PASSPHRASE=<passphrase>
KORTEX_SYNC_KEY=<same or different>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```
