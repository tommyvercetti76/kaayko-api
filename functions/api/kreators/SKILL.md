---
description: Use when working on Kreator — creator applications, onboarding, magic links, session tokens, Google OAuth, profile management, product CRUD for kreators, or admin review workflows. Trigger for any file under functions/api/kreators/, functions/services/kreatorService.js, functions/services/kreatorApplicationService.js, or functions/middleware/kreatorAuthMiddleware.js.
---

# Kreator API — Developer Runbook

## Purpose

Kreator manages the full creator/seller lifecycle on Kaayko: application submission, admin review, magic-link-based account activation, password + Google OAuth authentication, profile management, and product listing. It is a self-contained auth system using custom HMAC session tokens (not Firebase Auth for creators).

---

## Key Files

| File | Responsibility |
|------|---------------|
| `functions/api/kreators/kreatorRoutes.js` | Main router — all `/kreators/*` endpoints |
| `functions/api/kreators/kreatorProductRoutes.js` | Product CRUD at `/kreators/products/*` — mounted internally by kreatorRoutes.js |
| `functions/api/kreators/testRoutes.js` | Dev/emulator helpers — only loaded when `FUNCTIONS_EMULATOR=true` |
| `functions/services/kreatorService.js` | Token hashing (scrypt), session tokens (HMAC-SHA256), magic links, CRUD |
| `functions/services/kreatorApplicationService.js` | Application workflow — validation, approval, rejection, audit logs |
| `functions/services/emailNotificationService.js` | Email notifications triggered on application status changes |
| `functions/middleware/kreatorAuthMiddleware.js` | `requireKreatorAuth`, `requireActiveKreator`, `kreatorRateLimit`, `attachClientInfo` |
| `functions/middleware/authMiddleware.js` | Admin RBAC — used for admin review endpoints |

---

## Endpoints

### Public (No Auth)

| Method | Path | Rate limit | Side-effects |
|--------|------|-----------|-------------|
| GET | `/kreators/health` | — | — |
| GET | `/kreators/debug` | — | Dev info only |
| POST | `/kreators/apply` | 5/hr per IP | Creates `kreator_applications` doc |
| GET | `/kreators/applications/:id/status` | 10/min per IP | Requires `?email=` query param |
| POST | `/kreators/onboarding/verify` | 20/min per IP | Checks magic link validity |
| POST | `/kreators/onboarding/complete` | 5/min per IP | Consumes magic link, activates account, sets password |
| POST | `/kreators/auth/google/signin` | — | Signs in or activates via Google |

### Kreator Session Auth (requireKreatorAuth + requireActiveKreator)

| Method | Path | Side-effects |
|--------|------|-------------|
| GET | `/kreators/me` | Updates `lastLoginAt` |
| PUT | `/kreators/me` | Updates profile fields |
| DELETE | `/kreators/me` | Soft-deletes account (anonymizes PII) |
| POST | `/kreators/auth/google/connect` | Links Google UID to account |
| POST | `/kreators/auth/google/disconnect` | Unlinks Google (requires password set) |

### Product Management (`/kreators/products/*`) — requireKreatorAuth + requireActiveKreator

| Method | Path | Notes |
|--------|------|-------|
| GET | `/kreators/products` | Owner's products only |
| POST | `/kreators/products` | Multipart/form-data, up to 5 images (5MB each) |
| GET | `/kreators/products/:id` | Ownership enforced |
| PUT | `/kreators/products/:id` | Replaces images (max 5 total) |
| DELETE | `/kreators/products/:id` | Soft delete — sets `isAvailable: false` |

> **Note:** Product routes are mounted internally inside `kreatorRoutes.js` at line 61 (`router.use('/products', kreatorProductRoutes)`). They ARE accessible at `/kreators/products/*` even though they are not mounted directly from `functions/index.js`.

### Admin (requireAuth + requireAdmin)

| Method | Path | Side-effects |
|--------|------|-------------|
| GET | `/kreators/admin/applications` | Filterable: status, email, limit, offset |
| GET | `/kreators/admin/applications/:id` | Full application detail |
| PUT | `/kreators/admin/applications/:id/approve` | Creates Firebase user, kreator doc, magic link, audit log |
| PUT | `/kreators/admin/applications/:id/reject` | Requires `reason` (min 10 chars) |
| GET | `/kreators/admin/list` | All kreators with pagination |
| GET | `/kreators/admin/:uid` | Full kreator detail |
| POST | `/kreators/admin/:uid/resend-link` | Disables old magic links, creates new |
| GET | `/kreators/admin/stats` | Counts by status |

---

## Auth & Middleware Stack

```
All kreator routes:
  attachClientInfo → [route-specific middleware]

Public endpoints:
  attachClientInfo → kreatorRateLimit(action, max, windowMs) → handler

Kreator protected:
  attachClientInfo → requireKreatorAuth → requireActiveKreator → handler

Admin endpoints:
  attachClientInfo → requireAuth (Firebase) → requireAdmin → handler
```

### Session Token (Kreator Auth)

- Format: custom JWT using HMAC-SHA256
- Secret: `getSessionSecret()` from environment (`JWT_SECRET` or `SESSION_SECRET`)
- Payload: `{ uid, role, iat, exp }`
- Expiry: 7 days
- Header: `Authorization: Bearer <sessionToken>` — same header as Firebase tokens but verified differently by `kreatorAuthMiddleware.js`

### Magic Links

- Code format: `ml_` + 16 base64url chars
- Stored in `short_links` collection (type: `magic_link`)
- Token hashed with **scrypt** (N=16384, r=8, p=1) before storage
- Single-use: marked `enabled: false` after consumption
- Expiry: onboarding=24h, password_reset=1h, login=1h

### Rate Limiting (In-Memory)

Kreator rate limits are **in-memory per instance** (resets on cold start). This is intentional for low-cost environments but means limits are per-instance, not global.

| Action | Max | Window |
|--------|-----|--------|
| apply | 5 | 1 hr |
| status check | 10 | 1 min |
| onboarding/verify | 20 | 1 min |
| onboarding/complete | 5 | 1 min |

---

## Data Model (Firestore)

### `kreators/{uid}`
```
uid, email (lowercase), firstName, lastName, displayName
businessName, brandName, bio, phone, website, location
productCategories[], avatarUrl
status: 'pending_password' | 'active' | 'suspended' | 'deactivated' | 'deleted'
authProviders: ['password', 'google']
passwordSetAt, googleUid, googleProfile, googleConnectedAt
applicationId, approvedBy, approvedAt
plan: 'kreator-free'
planLimits: { productsAllowed: 50, monthlyOrders: 100 }
stats: { totalProducts, totalOrders, totalRevenue, lastProductCreatedAt }
permissions[], consent, locale
createdAt, updatedAt, lastLoginAt, lastActivityAt
deletedAt, deletedBy (soft delete)
```

### `kreator_applications/{id}`
```
id (app_XXXXXXXXXX), applicationType: 'seller'
firstName, lastName, email, phone
businessName, businessType, website
productCategories[], productDescription, productCount, priceRange
location, shippingCapability, fulfillmentTime, inventoryManagement
agreedToTerms, confirmedAuthenticity
status: 'pending' | 'approved' | 'rejected' | 'expired'
reviewedBy, reviewedAt, reviewNotes, rejectionReason
kreatorId, magicLinkCode
consent: { dataProcessing, sellerTerms, ... }
submittedAt, updatedAt, expiresAt (30 days from submission)
ipAddress, userAgent, source
```

### `kaaykoproducts/{id}`
```
id, title, description
price (symbol: $|$$|$$$|$$$$), actualPrice (number)
productID (uid_8chars_uuid_8chars)
votes, tags[], availableColors[], availableSizes[]
maxQuantity, stockQuantity
imgSrc[] (public Firebase Storage URLs)
isAvailable, category
kreatorId, storeName, storeSlug, sellerEmail
createdAt, updatedAt, deletedAt, deletedBy
```

### `short_links/{ml_code}` — magic links
```
code, type: 'magic_link'
tokenHash, tokenSalt
metadata.purpose, metadata.targetEmail, metadata.targetKreatorId
metadata.singleUse, metadata.usedAt
expiresAt, enabled
```

### `admin_audit_logs/{logId}`
```
action (e.g. 'kreator.application.approved')
resourceType, resourceId, actorUid
before, after (state snapshots)
metadata, ipAddress, userAgent, timestamp
```

---

## Validation Rules

### Application
- `email`: required, valid format
- `businessType`: one of `[sole_proprietor, llc, corporation, partnership, individual_maker, manufacturer]`
- `productCategories`: at least 1, valid values: `[apparel, souvenirs, coaching, consulting, digital, art, fitness, sports, courses, other]`
- `productDescription`: 50–2000 chars
- `agreedToTerms` + `confirmedAuthenticity`: must be `true`

### Password
- Min 8 chars, max 128
- Must contain uppercase, lowercase, number, special char (`!@#$%^&*()_+-=[]{}|;:,.<>?`)

### Products
- `title`, `description`, `price`, `category`: required
- `price` (actualPrice): >= $0.99
- Images: max 5 files, max 5MB each, `image/*` MIME type only

---

## Error Shape

```json
// Error
{ "success": false, "error": "Short title", "message": "Human message", "code": "ERROR_CODE" }

// Success
{ "success": true, ...payload }
```

**Common error codes:**
`VALIDATION_ERROR`, `DUPLICATE_APPLICATION`, `AUTH_TOKEN_MISSING`, `AUTH_TOKEN_INVALID`,
`AUTH_TOKEN_EXPIRED`, `MAGIC_LINK_NOT_FOUND`, `MAGIC_LINK_ALREADY_USED`, `MAGIC_LINK_EXPIRED`,
`NOT_FOUND`, `ALREADY_SETUP`, `KREATOR_NOT_FOUND`, `INVALID_PASSWORD`,
`PASSWORD_REQUIRED`, `NOT_CONNECTED`, `ALREADY_CONNECTED`

---

## Known Issues & Gaps

- **Product routes docs confusion** — `docs/products/KREATOR.md` says product routes "are not mounted from `functions/index.js`" which is technically true but misleading. They ARE live at `/kreators/products/*` via the internal mount in `kreatorRoutes.js`. The docs have been corrected.
- ~~**No automated test suite**~~ — **FIXED.** `functions/__tests__/kreator-api.test.js` added with 21 tests covering health, apply validation, magic link verify/complete, session auth, product auth, admin routes.
- **In-memory rate limiting** — resets on cold start. Acceptable for current scale but not suitable for high-traffic abuse prevention.
- ~~**Email notifications TODOs**~~ — **FIXED.** `sendMagicLinkEmail()` added to `emailNotificationService.js` and wired into `approveApplication()` and `resendMagicLink()`. Activation link is now emailed automatically on approval and resend.
- ~~**Route ordering bug — `/admin/stats` shadowed by `/admin/:uid`**~~ — **FIXED.** `GET /kreators/admin/stats` was registered after `GET /kreators/admin/:uid`, causing requests to `/admin/stats` to be caught by the param route (treating "stats" as a uid). Fixed by moving the stats route before the param route in `kreatorRoutes.js`.

---

## Improvement Checklist

- [x] scrypt token hashing for magic links
- [x] Kreator-specific auth middleware (isolated from Firebase admin auth)
- [x] Soft delete (anonymizes PII, doesn't hard-delete records)
- [x] Transactional approval (creates user + kreator doc + magic link atomically)
- [x] Add `functions/__tests__/kreator-api.test.js` (21 tests — see Testing section)
- [x] Wire regression suite into `functions/package.json` (npm run test:kreator)
- [ ] Replace in-memory rate limiting with Firestore-backed for consistency with Kortex
- [x] Send activation email on approval and resend — `sendMagicLinkEmail()` wired into `kreatorApplicationService` + `kreatorService`

---

## Testing

**Run existing smoke tests:**
```bash
cd functions && npm run test:smoke
```

**New tests to add** (`functions/__tests__/kreator-api.test.js`):
1. `GET /kreators/health` → 200
2. `POST /kreators/apply` with missing required fields → 400 `VALIDATION_ERROR`
3. `POST /kreators/apply` with duplicate email → 409 `DUPLICATE_APPLICATION`
4. `POST /kreators/onboarding/verify` with invalid token → 404 `MAGIC_LINK_NOT_FOUND`
5. `POST /kreators/onboarding/complete` with weak password → 400 `INVALID_PASSWORD`
6. `GET /kreators/me` without auth → 401 `AUTH_TOKEN_MISSING`
7. `GET /kreators/me` with valid session token → 200 with kreator profile
8. `PUT /kreators/admin/applications/:id/approve` without admin → 403
9. `GET /kreators/products` without auth → 401
10. `POST /kreators/products` with inactive status → 403

**Emulator dev routes** (only when `FUNCTIONS_EMULATOR=true`):
```
GET  /kreators/test/setup          — Create test admin
GET  /kreators/test/mock-token     — Get test token
POST /kreators/test/direct-approve — Approve without auth
DELETE /kreators/test/cleanup      — Clear test data
```
