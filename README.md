# Kaayko API

Production backend for the Kaayko product portfolio. The `main` branch in this repository currently serves commerce, paddling intelligence, smart links, creator workflows, and Kamera Quest photography guidance from a single Firebase Functions v2 deployment.

## What this repo powers

| Product | Purpose | Mounted base paths on `api` | Primary frontend consumers | Product guide |
| --- | --- | --- | --- | --- |
| Store / Commerce | Product catalog, image delivery, checkout, order ops | `/products`, `/images`, `/createPaymentIntent`, `/admin/*` | `kaayko/src/index.html`, `store.html`, `cart.html`, `order-success.html` | [`docs/products/STORE.md`](./docs/products/STORE.md) |
| Paddling Out | Weather, scoring, nearby water discovery, forecast caching | `/paddlingOut`, `/nearbyWater`, `/paddleScore`, `/fastForecast`, `/forecast`, `/gptActions` | `kaayko/src/paddlingout.html` and weather JS modules | [`docs/products/PADDLING_OUT.md`](./docs/products/PADDLING_OUT.md) |
| KORTEX | Smart links, tenant aliases, redirects, campaigns, tenant onboarding, billing, auth | `/kortex`, `/smartlinks`, `/campaigns`, `/:campaignSlug/:code`, `/l/:id`, `/resolve`, `/billing`, `/auth` | `kaayko/src/kortex.html`, `create-kortex-link.html`, `src/admin/*`, `src/tenant.html` | [`docs/products/KORTEX.md`](./docs/products/KORTEX.md), [`../kaayko/docs/products/KORTEX_TENANT_ARCHITECTURE_PLAN.md`](../kaayko/docs/products/KORTEX_TENANT_ARCHITECTURE_PLAN.md), [`../kaayko/docs/products/KORTEX_DELIVERY_PLAN_AND_DOD.md`](../kaayko/docs/products/KORTEX_DELIVERY_PLAN_AND_DOD.md) |
| Kreator | Creator applications, onboarding, profile, admin review | `/kreators` | `kaayko/src/kreator/*` | [`docs/products/KREATOR.md`](./docs/products/KREATOR.md) |
| Kamera Quest | Camera catalog, lenses, presets, session optimization | `/cameras`, `/lenses`, `/presets`, `/presets/smart` | `kaayko/src/karma/kameras/*` | [`docs/products/KAMERA_QUEST.md`](./docs/products/KAMERA_QUEST.md) |
| Shared Platform | Auth middleware, API docs, admin controls, deployment rails | `/docs`, `/auth`, `/admin/*`, scheduled functions | Shared site shell and product ops flows | [`docs/products/PLATFORM_SHARED.md`](./docs/products/PLATFORM_SHARED.md) |

## Architecture

- Runtime: Firebase Functions v2, Node.js 22, Express app exported as `api`.
- Storage and state: Firebase Admin, Firestore, Cloud Storage, Firebase Auth.
- Payments: Stripe checkout/payment intent and webhook flows.
- Weather intelligence: cached forecasts plus an auxiliary Cloud Run ML service under [`ml-service`](./ml-service).
- Camera intelligence: catalog maintenance, audit, validation packet, and session-advice engine in [`functions/api/cameras`](./functions/api/cameras).
- Scheduled jobs: forecast warming and health jobs exported from [`functions/scheduled/forecastScheduler.js`](./functions/scheduled/forecastScheduler.js).

The live API function is mounted in [`functions/index.js`](./functions/index.js). Treat that file as the source of truth for what is actually shipped from `main`. KORTEX is canonical under `/kortex`; `/smartlinks` remains mounted as compatibility for older clients.

## Repository layout

```text
kaayko-api/
├── functions/
│   ├── api/                  # Product route modules
│   ├── middleware/           # Auth, security, kreator guards
│   ├── scheduled/            # Scheduled forecast jobs
│   ├── services/             # Shared domain services
│   ├── scripts/              # Camera catalog, audit, predeploy checks
│   └── __tests__/            # Current checked-in automated suite
├── docs/                     # Repo and product documentation
├── ml-service/               # Weather ML service for Cloud Run
├── firebase.json             # Functions runtime + predeploy hooks
└── README.md
```

## Local development

Prerequisites:

- Node.js 22
- Firebase CLI
- Python 3.9 for optional weather tooling dependencies
- Access to the `kaaykostore` Firebase project or emulator equivalents

From [`functions`](./functions):

```bash
npm install
firebase emulators:start --config ../firebase.json --only functions,firestore,storage
```

Useful commands:

```bash
npm run test:smoke
npm run predeploy:check
npm run deploy:api
npm run deploy:scheduled
npm run deploy
```

## Quality gates

Primary enforced gate:

- [`npm run predeploy:check`](./functions/package.json) regenerates camera catalog artifacts, review packet, audit report, validation checks, predeploy assertions, and smoke tests before deployment.

Current reality on `main`:

- The only checked-in automated test target wired in `functions/package.json` is the camera API smoke suite in [`functions/__tests__/camera-api.test.js`](./functions/__tests__/camera-api.test.js).
- Commerce, weather, KORTEX, and Kreator do not yet have first-class regression suites in this repository.
- Existing module README files under [`functions/api`](./functions/api) are helpful, but they do not replace product-level docs or route verification against [`functions/index.js`](./functions/index.js).

## Deployment

This repo is configured for the Firebase project `kaaykostore`.

- API only: `npm run deploy:api`
- Scheduled functions only: `npm run deploy:scheduled`
- API plus scheduled functions: `npm run deploy`

The deploy surface is defined in [`functions/package.json`](./functions/package.json) and runtime settings live in [`firebase.json`](./firebase.json).

## Security model

- `cors()` is enabled at the API app level in [`functions/index.js`](./functions/index.js).
- Admin order routes use `requireAuth` and `requireAdmin` from [`functions/middleware/authMiddleware.js`](./functions/middleware/authMiddleware.js).
- KORTEX routes mix public analytics/redirect endpoints with authenticated admin CRUD and tenant access.
- Kreator routes use dedicated middleware from [`functions/middleware/kreatorAuthMiddleware.js`](./functions/middleware/kreatorAuthMiddleware.js).
- Stripe webhook handling requires raw-body processing and is mounted before JSON middleware.

## Known gaps to keep visible

- [`functions/api/kreators/kreatorProductRoutes.js`](./functions/api/kreators/kreatorProductRoutes.js) exists, but it is not mounted from [`functions/index.js`](./functions/index.js) on `main`.
- [`functions/api/smartLinks/publicApiRouter.js`](./functions/api/smartLinks/publicApiRouter.js) and [`functions/api/smartLinks/publicRouter.js`](./functions/api/smartLinks/publicRouter.js) exist, but they are not mounted from `main`.
- Some frontend experiences in the companion `kaayko` repo still reference capabilities that depend on those unmounted routes. Call that out during integration work instead of assuming parity.

## Documentation map

- Product index: [`docs/products/README.md`](./docs/products/README.md)
- Store backend: [`docs/products/STORE.md`](./docs/products/STORE.md)
- Paddling Out backend: [`docs/products/PADDLING_OUT.md`](./docs/products/PADDLING_OUT.md)
- KORTEX backend: [`docs/products/KORTEX.md`](./docs/products/KORTEX.md)
- Kreator backend: [`docs/products/KREATOR.md`](./docs/products/KREATOR.md)
- Kamera Quest backend: [`docs/products/KAMERA_QUEST.md`](./docs/products/KAMERA_QUEST.md)
- Shared platform: [`docs/products/PLATFORM_SHARED.md`](./docs/products/PLATFORM_SHARED.md)
