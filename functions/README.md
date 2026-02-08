# Firebase Functions — Kaayko API

## 🚀 Quick Start

```bash
npm install                     # Install dependencies
npm run emulators:full          # Start Functions + Firestore + Auth emulators
npm run seed                    # Seed test data (second terminal)
npm test                        # Run 265 unit tests
npm run test:integration        # Run 118 integration tests (requires emulators)
```

The API is available at `http://127.0.0.1:5001/kaaykostore/us-central1/api`.  
Emulator UI at `http://127.0.0.1:4000`.

---

## 📁 Project Structure

```
functions/
├── index.js                    # Entry point — Express app, all route mounts
├── package.json                # Dependencies & scripts
├── jest.config.js              # Unit test config
├── jest.integration.config.js  # Integration test config (emulators)
│
├── api/                        # 11 API modules (99 endpoints)
│   ├── admin/                  #   adminUsers.js, adminUserHandlers.js,
│   │                           #   getOrder.js, updateOrderStatus.js
│   ├── ai/                     #   gptActions.js, gptActionHandlers.js
│   ├── auth/                   #   authRoutes.js
│   ├── billing/                #   router.js, billingHandlers.js, billingConfig.js
│   ├── checkout/               #   router.js, createPaymentIntent.js,
│   │                           #   stripeWebhook.js, stripeOrderHandler.js,
│   │                           #   updatePaymentIntentEmail.js
│   ├── core/                   #   docs.js (Swagger UI)
│   ├── email/templates/        #   HTML email templates
│   ├── kortex/                 #   21 files — link CRUD, redirect, public API,
│   │                           #   attribution, tenants, webhooks, rate limiting
│   ├── kreators/               #   12 files — application, auth, profile,
│   │                           #   products, admin review, test routes
│   ├── products/               #   products.js, images.js
│   └── weather/                #   23 files — forecasts, paddle score, nearby water,
│                               #   ML integration, penalties, warnings, caching
│
├── middleware/                 # 10 files
│   ├── authMiddleware.js       #   requireAuth, requireAdmin (Firebase tokens)
│   ├── authRBAC.js             #   requireRole, requirePermission, optionalAuth
│   ├── authErrors.js           #   Error response helpers
│   ├── apiKeyMiddleware.js     #   requireApiKey (scope-based, for Kortex public API)
│   ├── apiKeyService.js        #   API key validation & scope checking
│   ├── kreatorAuthMiddleware.js#   requireKreatorAuth, requireActiveKreator (JWT)
│   ├── kreatorAuthHelpers.js   #   attachClientInfo, optionalKreatorAuth, kreatorRateLimit
│   ├── rateLimit.js            #   Generic in-memory rate limiter
│   ├── securityMiddleware.js   #   botProtection, secureHeaders, rateLimiter
│   └── securityUtils.js        #   Honeypot trap endpoints
│
├── services/                   # 10 files
│   ├── adminUserService.js     #   Admin user CRUD (Firestore)
│   ├── kreatorService.js       #   Kreator CRUD & auth
│   ├── kreatorApplicationService.js  # Application submit & status
│   ├── applicationApprovalService.js # Approve/reject workflow
│   ├── applicationValidation.js      # Input validation
│   ├── kreatorOnboardingService.js   # Magic link → password setup
│   ├── kreatorCrypto.js        #   scrypt password hashing, JWT generation
│   ├── kreatorOAuthService.js  #   Google OAuth connect/disconnect
│   ├── emailNotificationService.js   # Order confirmation, admin alerts
│   └── emailTemplates.js       #   HTML template builder
│
├── scheduled/                  # Cron jobs
│   ├── forecastScheduler.js    #   6 scheduled Cloud Functions
│   └── locationPoller.js       #   LocationPoller class (not exported)
│
├── cache/
│   └── forecastCache.js        #   ForecastCache — Firestore forecast_cache
│
├── config/
│   └── weatherConfig.js        #   Weather API config & constants
│
├── scripts/
│   └── seed-emulator.js        #   Seed emulator with test data
│
├── __mocks__/
│   └── firebase-admin.js       #   Root-level mock for unit tests
│
└── __tests__/
    ├── setup.js                #   Unit test env setup
    ├── helpers/                #   factories.js, mockSetup.js, testApp.js
    ├── *.test.js               #   10 unit test suites (265 tests)
    └── integration/            #   5 integration suites (118 tests)
        ├── setup.js            #     Emulator env setup
        └── helpers/            #     firestoreHelpers.js, seedData.js, testApp.js
```

---

## 📜 NPM Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `test` | `jest --verbose --forceExit` | Run 265 unit tests |
| `test:watch` | `jest --watch --forceExit` | Watch mode |
| `test:ci` | `jest --ci --coverage` | CI with coverage |
| `test:integration` | `jest --config jest.integration.config.js` | 118 integration tests |
| `test:integration:verbose` | Same + `--verbose` | Verbose integration output |
| `test:all` | `npm test && npm run test:integration` | All 383 tests |
| `emulators` | `firebase emulators:start --only firestore,auth` | Minimal emulators |
| `emulators:full` | `firebase emulators:start --only functions,firestore,auth` | Full emulators |
| `seed` | `node scripts/seed-emulator.js` | Seed emulator data |
| `serve` | `firebase emulators:start --only functions,firestore,storage` | Legacy serve |
| `deploy` | `firebase deploy --only functions` | Deploy all |

---

## 🧪 Test Infrastructure

### Unit Tests (`npm test`)
- **265 tests** across **10 suites**
- Mocks: `__mocks__/firebase-admin.js` (Firestore, Auth, Storage, FieldValue, Timestamp)
- Helpers: `factories.js` (mock data), `testApp.js` (supertest builders)
- Config: `jest.config.js` — 15s timeout, `testPathIgnorePatterns: ['integration/']`

### Integration Tests (`npm run test:integration`)
- **118 tests** across **5 suites**
- Runs against **real Firebase emulators** (Firestore 8081, Auth 9099)
- Seeds production-shaped data for 29 Firestore collections
- Config: `jest.integration.config.js` — 30s timeout, no auto-mock clearing

### Seed Script (`npm run seed`)
- Seeds emulator with realistic data: 3 products, 3 paddling spots, 2 short links, admin user, kreator, application, orders, forecast cache
- Creates Firebase Auth users with test credentials

---

## 🔧 Development

### Code Style
- Node.js 22, ES6+ JavaScript
- Firebase Functions v2 (`firebase-functions/v2`)
- Express.js routing
- JSDoc comments
- **Max 300 lines per file** — all files compliant

### Adding a New Endpoint

1. Create handler in `api/<module>/<handler>.js`
2. Create or update router in `api/<module>/<router>.js`
3. Mount router in `index.js`
4. Add auth middleware as needed
5. Write unit tests in `__tests__/<module>.test.js`
6. Update module `README.md`
7. Run `npm test` to verify

### Environment Variables

```bash
# Required for full functionality
WEATHER_API_KEY=xxx          # WeatherAPI.com
ML_SERVICE_URL=xxx           # Cloud Run ML endpoint
STRIPE_SECRET_KEY=xxx        # Stripe payments
STRIPE_WEBHOOK_SECRET=xxx    # Stripe checkout webhook
STRIPE_BILLING_WEBHOOK_SECRET=xxx  # Stripe billing webhook
JWT_SECRET=xxx               # Kreator JWT signing
ADMIN_PASSPHRASE=xxx         # X-Admin-Key auth

# Set automatically by emulators
FIRESTORE_EMULATOR_HOST=127.0.0.1:8081
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
```

---

## 📚 Documentation

- **API endpoints:** [`api/README.md`](api/README.md) — master reference for all 99 endpoints
- **Per-module docs:** `api/*/README.md` — detailed endpoint docs per module
- **Admin system:** [`docs/admin/README.md`](docs/admin/README.md) — auth, RBAC, deployment
- **Technical guides:** [`../docs/`](../docs/README.md) — ML, architecture, OpenAPI specs

---

**Last Updated:** February 2026  
**Runtime:** Node.js 22 · Firebase Functions v2 · 128 JS files · 383 tests passing
