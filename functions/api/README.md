# 📡 Kaayko API — Endpoint Reference

**99 endpoints across 11 modules**, all served from a single Express app exported as one Cloud Function.

**Base URL (prod):** `https://us-central1-kaaykostore.cloudfunctions.net/api`  
**Base URL (local):** `http://127.0.0.1:5001/kaaykostore/us-central1/api`

---

## Module Index

| # | Module | Mount Path | Endpoints | Files | Auth |
|---|--------|-----------|-----------|-------|------|
| 1 | [Weather](#-weather) | `/paddleScore`, `/fastForecast`, `/forecast`, `/paddlingOut`, `/nearbyWater` | 8 | 23 | Public |
| 2 | [Products](#-products) | `/products`, `/images` | 4 | 2 | Public |
| 3 | [Checkout](#-checkout) | `/createPaymentIntent`, `/stripe-webhook` | 3 | 5 | Public + Stripe |
| 4 | [Billing](#-billing) | `/billing/*` | 6 | 3 | Firebase Auth |
| 5 | [Auth](#-auth) | `/auth/*` | 3 | 1 | Firebase Auth |
| 6 | [Admin](#-admin) | `/admin/*` | 10 | 4 | Firebase Auth + RBAC |
| 7 | [Kortex](#-kortex-smart-links) | `/smartlinks/*`, `/public/*`, `/l/:code` | 27 | 21 | Mixed |
| 8 | [Kreators](#-kreators) | `/kreators/*` | 27 | 12 | Mixed |
| 9 | [AI](#-ai--gpt-actions) | `/gptActions/*` | 5 | 2 | Public |
| 10 | [Core](#-core--docs) | `/docs/*` | 3 | 1 | Public |
| 11 | [Health](#-health) | `/helloWorld` | 1 | — | Public |

---

## 🌤️ Weather

**Files:** 23 in `api/weather/` — routers, services, helpers, ML integration, penalties, warnings.

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/paddleScore` | ML-powered paddle rating (1-5) + weather | Public |
| GET | `/fastForecast` | Cached forecast (fast, ~192ms) | Public |
| GET | `/forecast` | Premium real-time forecast + ML | Rate limited (10/min) |
| POST | `/forecast/batch` | Batch process all locations | Rate limited |
| GET | `/forecast/cacheStats` | Cache performance stats | Public |
| GET | `/paddlingOut` | List all paddling spots | Public |
| GET | `/paddlingOut/:id` | Spot details + images | Public |
| GET | `/nearbyWater` | Find nearby lakes/rivers (Overpass API) | Public |

**Middleware:** `inputStandardization` (normalizes lat/lng/spotId) applied to paddleScore, forecast, fastForecast.

📖 [Full weather docs →](weather/README.md)

---

## 🛍️ Products

**Files:** `products.js`, `images.js`

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/products` | List all products | Public |
| GET | `/products/:productId` | Single product details | Public |
| POST | `/products/:productId/vote` | Vote on a product | Public |
| GET | `/images/:path` | Image proxy from Cloud Storage | Public |

📖 [Full products docs →](products/README.md)

---

## 💳 Checkout

**Files:** `router.js`, `createPaymentIntent.js`, `stripeWebhook.js`, `stripeOrderHandler.js`, `updatePaymentIntentEmail.js`

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/createPaymentIntent` | Create Stripe payment intent | Public |
| POST | `/createPaymentIntent/update-email` | Attach email to payment | Public |
| POST | `/stripe-webhook` | Stripe webhook handler | Stripe signature |

📖 [Full checkout docs →](checkout/README.md)

---

## 💰 Billing

**Files:** `router.js`, `billingHandlers.js`, `billingConfig.js`

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/billing/plans` | List available plans | Public |
| GET | `/billing/subscription` | Get current subscription | `requireAuth` |
| POST | `/billing/create-checkout` | Create Stripe billing checkout | `requireAuth` + tenant |
| POST | `/billing/downgrade` | Downgrade subscription | `requireAuth` |
| GET | `/billing/invoices` | List invoices | `requireAuth` |
| POST | `/billing/webhook` | Stripe billing webhook | Stripe signature |

📖 [Full billing docs →](billing/README.md)

---

## 🔐 Auth

**File:** `authRoutes.js`

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/auth/logout` | Revoke refresh tokens | `requireAuth` |
| GET | `/auth/me` | Get current user profile | `requireAuth` |
| POST | `/auth/verify` | Debug — verify a Firebase ID token | None (token in body) |

📖 [Full auth docs →](auth/README.md)

---

## 👔 Admin

**Files:** `adminUsers.js`, `adminUserHandlers.js`, `getOrder.js`, `updateOrderStatus.js`

### Order Management (direct mounts in index.js)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/admin/updateOrderStatus` | Update order status/tracking | `requireAuth` + `requireAdmin` |
| GET | `/admin/getOrder` | Get order by ID or parentOrderId | `requireAuth` + `requireAdmin` |
| GET | `/admin/listOrders` | List orders with filters + pagination | `requireAuth` + `requireAdmin` |

### User Management (admin router)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/admin-users/me` | Current admin profile | `requireAuth` |
| GET | `/admin-users/users` | List all admin users | `requireAuth` + super-admin |
| GET | `/admin-users/users/:uid` | Get admin user | `requireAuth` + super-admin |
| POST | `/admin-users/users` | Create admin user | `requireAuth` + super-admin |
| PUT | `/admin-users/users/:uid` | Update admin user | `requireAuth` + super-admin |
| DELETE | `/admin-users/users/:uid` | Soft-delete admin user | `requireAuth` + super-admin |
| GET | `/admin-users/roles` | List available roles | `requireAuth` |

📖 [Full admin docs →](admin/README.md)

---

## 🔗 Kortex (Smart Links)

**Files:** 21 in `api/kortex/` — CRUD, redirect, public API, attribution, tenants, webhooks, rate limiting.

### Main CRUD (`/smartlinks` — requires Firebase Auth)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/smartlinks/health` | Health check | Public |
| GET | `/smartlinks/stats` | Link statistics | `requireAuth` + `optionalAuthForAdmin` |
| POST | `/smartlinks` | Create short link | `requireAuth` + `optionalAuthForAdmin` |
| GET | `/smartlinks` | List all links | `requireAuth` + `optionalAuthForAdmin` |
| GET | `/smartlinks/:code` | Get link by code | Public |
| PUT | `/smartlinks/:code` | Update link | `requireAuth` + `optionalAuthForAdmin` |
| DELETE | `/smartlinks/:code` | Delete link | `requireAuth` + `optionalAuthForAdmin` |
| POST | `/smartlinks/:code/events` | Record link events | Public |

### Tenant Management (sub-routes under `/smartlinks`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/smartlinks/tenant-registration` | Register new tenant | Rate limited |
| GET | `/smartlinks/tenants` | List tenants | `requireAuth` |
| GET | `/smartlinks/tenants/:tenantId` | Get tenant | `requireAuth` + super-admin |

### Public API (`/public` — API key auth)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/public/smartlinks` | Create link | API key (`create:links`) |
| GET | `/public/smartlinks` | List links | API key (`read:links`) |
| GET | `/public/smartlinks/:code` | Get link | API key (`read:links`) |
| PUT | `/public/smartlinks/:code` | Update link | API key (`update:links`) |
| DELETE | `/public/smartlinks/:code` | Delete link | API key (`delete:links`) |
| GET | `/public/smartlinks/:code/stats` | Link stats | API key (`read:analytics`) |
| GET | `/public/smartlinks/:code/attribution` | Attribution data | API key (`read:analytics`) |
| POST | `/public/smartlinks/batch` | Batch create | API key (`create:links`) |
| GET | `/public/health` | Health check | None |

### Redirects (root-level)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/l/:code` | Redirect short link | Public (IP rate limited) |
| GET | `/resolve` | Resolve link context | Public (IP rate limited) |

📖 [Full Kortex docs →](kortex/README.md)

---

## 🎨 Kreators

**Files:** 12 in `api/kreators/` — routes split by concern (public, auth, profile, products, admin, test).

### Public (no auth, rate-limited)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/kreators/health` | Health check | None |
| POST | `/kreators/apply` | Submit application | Rate limited (5/hr) |
| GET | `/kreators/applications/:id/status` | Check app status | Rate limited (10/min) |
| POST | `/kreators/onboarding/verify` | Verify magic link | Rate limited (20/min) |
| POST | `/kreators/onboarding/complete` | Set password | Rate limited (5/min) |

### Auth (Google OAuth)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/kreators/auth/google/signin` | Google sign-in | None |
| POST | `/kreators/auth/google/connect` | Link Google account | `requireKreatorAuth` |
| POST | `/kreators/auth/google/disconnect` | Unlink Google | `requireKreatorAuth` + `requireActiveKreator` |

### Profile

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/kreators/me` | Get profile | `requireKreatorAuth` |
| PUT | `/kreators/me` | Update profile | `requireKreatorAuth` + `requireActiveKreator` |
| DELETE | `/kreators/me` | Delete account | `requireKreatorAuth` + `requireActiveKreator` |

### Products

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/kreators/products` | List products | `requireKreatorAuth` |
| POST | `/kreators/products` | Create product (+ images) | `requireKreatorAuth` + `requireActiveKreator` |
| GET | `/kreators/products/:productId` | Get product | `requireKreatorAuth` |
| PUT | `/kreators/products/:productId` | Update product | `requireKreatorAuth` + `requireActiveKreator` |
| DELETE | `/kreators/products/:productId` | Delete product | `requireKreatorAuth` + `requireActiveKreator` |

### Admin (Kreator management)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/kreators/admin/applications` | List applications | `requireAuth` + `requireAdmin` |
| GET | `/kreators/admin/applications/:id` | Get application | Same |
| PUT | `/kreators/admin/applications/:id/approve` | Approve | Same |
| PUT | `/kreators/admin/applications/:id/reject` | Reject | Same |
| GET | `/kreators/admin/list` | List kreators | Same |
| GET | `/kreators/admin/:uid` | Get kreator | Same |
| GET | `/kreators/admin/stats` | Get statistics | Same |
| POST | `/kreators/admin/:uid/resend-link` | Resend magic link | Same |

### Test (emulator only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/kreators/test/list-applications` | List all apps |
| GET | `/kreators/test/list-kreators` | List all kreators |
| POST | `/kreators/test/direct-approve` | Approve without magic link |
| POST | `/kreators/test/create-test-kreator` | Create test kreator |
| GET | `/kreators/test/application/:id` | Get application detail |
| POST | `/kreators/test/login` | Login with email/password |

📖 [Full kreator docs →](kreators/README.md)

---

## 🤖 AI / GPT Actions

**Files:** `gptActions.js`, `gptActionHandlers.js`

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/gptActions/paddleScore` | Paddle score for ChatGPT | Public |
| GET | `/gptActions/forecast` | 3-day forecast for ChatGPT | Public |
| GET | `/gptActions/locations` | All paddling locations | Public |
| GET | `/gptActions/nearbyWater` | Nearby water bodies | Public |
| POST | `/gptActions/findNearby` | Find spots by coordinates | Public |

📖 [Full AI docs →](ai/README.md)

---

## 📚 Core / Docs

**File:** `docs.js`

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/docs` | Swagger UI documentation | Public |
| GET | `/docs/spec.yaml` | OpenAPI spec (YAML) | Public |
| GET | `/docs/spec.json` | OpenAPI spec (JSON) | Public |

📖 [Full core docs →](core/README.md)

---

## 🩺 Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/helloWorld` | Simple health check (inline in index.js) |

---

## 🔒 Global Middleware Stack

Applied to all requests in `index.js` (in order):

1. **CORS** — all origins
2. **Raw body** — only on `/stripe-webhook` (Stripe signature verification)
3. **JSON parser** — `express.json()` for everything else

Per-route middleware is documented in each module's README.

---

## 🏗️ Architecture

```
Client Request
  │
  ▼
┌─────────────────────┐
│  Cloud Function: api │  (Express app, single export)
│  512MiB, 300s timeout│
└──────────┬──────────┘
           │
  ┌────────┼─────────────────────────────────────┐
  │        │                                      │
  ▼        ▼                                      ▼
CORS → Raw Body (stripe-webhook only) → JSON parser
           │
           ▼
  ┌─── Route Matching ───────────────────────────────┐
  │  /paddleScore, /fastForecast, /forecast,         │
  │  /paddlingOut, /nearbyWater, /products, /images,  │
  │  /createPaymentIntent, /billing/*, /auth/*,       │
  │  /admin/*, /admin-users/*, /smartlinks/*,         │
  │  /public/*, /l/:code, /kreators/*, /gptActions/*, │
  │  /docs/*, /helloWorld                             │
  └──────────────────────────────────────────────────┘
           │
           ▼
  Per-route middleware → Handler → Firestore / Stripe / ML Service
```

---

**Last Updated:** February 2026  
**Total Endpoints:** 99 · **Modules:** 11 · **Files:** 128 JS
