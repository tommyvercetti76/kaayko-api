# 🏄‍♂️ Kaayko API

**Production backend for Kaayko — paddling weather, e-commerce, smart links, and creator platform.**

Built on Firebase Cloud Functions (2nd Gen), Node.js 22, Express, Firestore.

---

## 🏗️ Architecture Overview

**Single Cloud Function** — one `api` export (Express app) serves all HTTP routes. 512 MiB memory, 300s timeout.

**Two Auth Systems:**
- **Firebase Auth** — Admin portal, billing, order management (`requireAuth` + `admin_users` collection)
- **Kreator JWT Auth** — Separate system for creator accounts (password + Google OAuth)

**Scheduled Functions** — 6 Cloud Functions pre-compute forecasts on cron schedules.

```
kaayko-api/
├── functions/              # ☁️  Firebase Cloud Functions (128 JS files)
│   ├── index.js            #     Single entry point — mounts all routes
│   ├── api/                #     11 API modules (99 endpoints)
│   │   ├── admin/          #       Order mgmt + admin user CRUD
│   │   ├── ai/             #       GPT Actions for ChatGPT
│   │   ├── auth/           #       Firebase auth helpers
│   │   ├── billing/        #       Stripe subscriptions
│   │   ├── checkout/       #       Stripe payments + webhooks
│   │   ├── core/           #       Swagger UI + OpenAPI spec
│   │   ├── kortex/         #       Smart link CRUD, redirect, public API
│   │   ├── kreators/       #       Creator platform (apply → onboard → manage)
│   │   ├── products/       #       Store catalog + image proxy
│   │   └── weather/        #       Forecasts, paddle scores, nearby water
│   ├── middleware/         #     10 middleware files (auth, RBAC, rate limit, security)
│   ├── services/           #     10 service files (kreator lifecycle, email, admin)
│   ├── scheduled/          #     Forecast scheduler + location poller
│   ├── cache/              #     Firestore forecast cache
│   ├── __tests__/          #     265 unit tests (10 suites)
│   └── __tests__/integration/  118 integration tests (5 suites)
├── ml-service/             # 🧠  ML paddle rating service (Cloud Run, Python)
└── docs/                   # 📚  Technical documentation & OpenAPI specs
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 22
- Firebase CLI (`npm install -g firebase-tools`)
- Firebase project: `kaaykostore`

### Local Development

```bash
cd functions
npm install

# Start emulators (Functions + Firestore + Auth)
npm run emulators:full

# Seed test data (in a second terminal)
npm run seed

# API is live at:
# http://127.0.0.1:5001/kaaykostore/us-central1/api
```

### Run Tests

```bash
npm test                    # 265 unit tests
npm run test:integration    # 118 integration tests (requires emulators)
npm run test:all            # Both
```

### Deploy

```bash
firebase deploy --only functions    # Deploy all functions
firebase deploy --only firestore    # Deploy Firestore rules
```

---

## 📋 API Modules (99 Endpoints)

| Module | Mount Path(s) | Endpoints | Auth | Docs |
|--------|--------------|-----------|------|------|
| **Weather** | `/paddleScore`, `/fastForecast`, `/forecast`, `/paddlingOut`, `/nearbyWater` | 8 | Public (rate limited) | [weather/](functions/api/weather/README.md) |
| **Products** | `/products`, `/images` | 4 | Public | [products/](functions/api/products/README.md) |
| **Checkout** | `/createPaymentIntent`, `/stripe-webhook` | 3 | Public + Stripe sig | [checkout/](functions/api/checkout/README.md) |
| **Billing** | `/billing/*` | 6 | Firebase Auth | [billing/](functions/api/billing/README.md) |
| **Auth** | `/auth/*` | 3 | Firebase Auth | [auth/](functions/api/auth/README.md) |
| **Admin** | `/admin/*` | 10 | Firebase Auth + RBAC | [admin/](functions/api/admin/README.md) |
| **Kortex** | `/smartlinks/*`, `/public/*`, `/l/:code` | 27 | Mixed | [kortex/](functions/api/kortex/README.md) |
| **Kreators** | `/kreators/*` | 27 | Mixed (public / JWT / admin) | [kreators/](functions/api/kreators/README.md) |
| **AI** | `/gptActions/*` | 5 | Public | [ai/](functions/api/ai/README.md) |
| **Core** | `/docs/*` | 3 | Public | [core/](functions/api/core/README.md) |

Plus `/helloWorld` health check, honeypot traps, and 6 scheduled Cloud Functions.

---

## ⏰ Scheduled Functions

| Export | Schedule (America/Los_Angeles) | Purpose |
|--------|-------------------------------|---------|
| `earlyMorningForecast` | 05:00 daily | Full batch forecast |
| `morningForecastUpdate` | 09:00 daily | Refresh |
| `afternoonForecastUpdate` | 13:00 daily | Refresh |
| `eveningForecastUpdate` | 17:00 daily | Refresh |
| `emergencyForecastRefresh` | Every 4 hours | Backup (skips if recent) |
| `forecastSchedulerHealth` | Sundays at midnight | Weekly health check |

---

## 🧪 Test Suite — 383 Tests

| Type | Tests | Suites | Command |
|------|-------|--------|---------|
| **Unit** | 265 | 10 | `npm test` |
| **Integration** | 118 | 5 | `npm run test:integration` |
| **Total** | **383** | **15** | `npm run test:all` |

**Unit suites:** weather (28), admin (36), auth (12), kreators (52), core (24), middleware (39), kortex (21), billing-checkout (25), kortex-public-api (19), kortex-redirect (9).

**Integration suites** (against Firebase emulators): data-contracts (28), checkout-orders (17), admin-users (26), kortex-links (24), kreator-lifecycle (23).

---

## 🔒 Security

- **Firebase Auth** — ID token verification for admin/billing routes
- **RBAC** — `requireRole('super-admin')`, `requirePermission('links:write')`
- **API Key Auth** — Scope-based (`create:links`, `read:links`, etc.) for Kortex public API
- **Rate Limiting** — Per-IP and per-action limits on all public endpoints
- **Bot Protection** — Honeypot endpoints + bot detection on redirect routes
- **Secure Headers** — Applied globally on Kortex routes
- **Kreator Auth** — Separate JWT system + scrypt password hashing + Google OAuth

---

## 🔧 Environment Variables

Required in production:

| Variable | Purpose |
|----------|---------|
| `WEATHER_API_KEY` | WeatherAPI.com |
| `ML_SERVICE_URL` | Cloud Run ML service |
| `STRIPE_SECRET_KEY` | Stripe payments |
| `STRIPE_WEBHOOK_SECRET` | Stripe checkout webhook |
| `STRIPE_BILLING_WEBHOOK_SECRET` | Stripe billing webhook |
| `JWT_SECRET` | Kreator JWT signing |
| `ADMIN_PASSPHRASE` | X-Admin-Key fallback auth |

---

## 📚 Documentation

| Document | Location |
|----------|----------|
| API module READMEs | [`functions/api/*/README.md`](functions/api/README.md) |
| Admin system docs | [`functions/docs/admin/`](functions/docs/admin/README.md) |
| OpenAPI spec (YAML) | [`docs/OPENAPI_KORTEX_V4.yaml`](docs/OPENAPI_KORTEX_V4.yaml) |
| Postman collection | [`docs/Kaayko_Kortex_API_v4.postman_collection.json`](docs/Kaayko_Kortex_API_v4.postman_collection.json) |
| ML implementation | [`docs/GOLD_STANDARD_IMPLEMENTATION.md`](docs/GOLD_STANDARD_IMPLEMENTATION.md) |
| Scheduled functions | [`docs/HOW_SCHEDULED_FUNCTIONS_WORK.md`](docs/HOW_SCHEDULED_FUNCTIONS_WORK.md) |
| Deployment guide | [`docs/deployment/DEPLOYMENT_GUIDE.md`](docs/deployment/DEPLOYMENT_GUIDE.md) |

---

**Last Updated:** February 2026  
**Node.js:** 22 · **Firebase Functions:** v2 (Gen 2) · **Tests:** 383 passing
