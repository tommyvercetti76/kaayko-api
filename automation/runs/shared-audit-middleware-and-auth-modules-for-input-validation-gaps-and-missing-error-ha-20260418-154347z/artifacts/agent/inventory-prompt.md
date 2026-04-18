You are selecting files for a local coding agent run on a Node.js Firebase Cloud Functions API.
Run ID: shared-audit-middleware-and-auth-modules-for-input-validation-gaps-and-missing-error-ha-20260418-154347z
Track: shared
Area: shared
Goal: Audit middleware and auth modules for input validation gaps and missing error handling
Mode: audit

PORTFOLIO COACHING
Portfolio overview: Kaayko API is a Firebase Cloud Functions Express backend. Every route is mounted through functions/index.js. Safe agent work must preserve route contracts, auth middleware chains, Firestore access patterns, and existing error-handling shapes. Security and tenant isolation are the highest-priority concerns.
Guided products: Shared API Infrastructure, KORTEX Platform API, Commerce & Checkout API, Kamera Quest API, Kreator Program API, Kutz Nutrition API, Weather & Forecast API
Primary focus products: Shared API Infrastructure
Source docs: README.md, functions/middleware/README.md, functions/api/smartLinks/README.md, functions/api/products/README.md, functions/api/checkout/README.md, functions/api/cameras/README.md, functions/api/kreators/README.md, functions/api/kutz/README.md, functions/api/weather/README.md

Focused doc snapshots:
- README.md: Kaayko API What this repo powers | Product | Purpose | Mounted base paths on `api` | Primary frontend consumers | Product guide | | Kreator | Creator applications, onboarding, profile, admin review | `/kreators` | `kaayko/src/kreator/*` | [`docs/products/KREATOR.md`](./docs/products/KREATOR.md) | Architecture Runtime: Firebase Functions v2, Node.js 22, Express app exported as `api`. Storage and state: Firebase Admin, Firestore, Cloud Storage, Firebase Auth. Payments: Stripe checkout/payment intent and webhook flows.
- functions/middleware/README.md: Document not found in the current workspace.

Product: Shared API Infrastructure (Primary focus)
Purpose: Protect the middleware stack, auth guards, error handling, CORS, Firebase Admin initialization, and rate limiting that all routes depend on.
API paths:
  - functions/middleware/
  - functions/api/core/
  - functions/index.js
  - functions/api/auth/
  - functions/utils/
Backend routes:
  - /health
  - /api/**
Validation focus:
  - Verify middleware execution order is preserved for every mounted router.
  - Ensure auth claim validation runs before any data mutation endpoint.
  - Confirm error handlers return consistent shapes without leaking stack traces.
  - Validate Firebase Admin SDK is initialized once and not duplicated per-request.
Risk focus:
  - Middleware order bugs are silent — a reorder can bypass security checks entirely.
  - Firebase Admin double-initialization causes memory and auth failures.
  - Error shape inconsistencies cause frontend parsing failures across multiple products.
  - CORS misconfiguration can silently allow unauthorized cross-origin requests.

Product: KORTEX Platform API (Supporting context)
Purpose: Protect smart-link CRUD, tenant auth claims, redirect handling, analytics recording, billing visibility, and QR flows as a security-critical multi-tenant surface.
API paths:
  - functions/api/smartLinks/
  - functions/api/billing/
  - functions/api/auth/
Backend routes:
  - GET /smartlinks
  - POST /smartlinks
  - PUT /smartlinks/:id
  - DELETE /smartlinks/:id
  - GET /l/:id
  - GET /resolve
  - GET /billing/*
  - GET /auth/*
Validation focus:
  - Verify tenant isolation — every data read/write must scope to the authenticated tenant.
  - Confirm public redirect paths cannot access admin data or mutation endpoints.
  - Validate auth claim checks (admin boolean) run before any tenant-mutation route.
  - Ensure analytics recording is append-only and cannot be manipulated by the client.
Risk focus:
  - KORTEX has the highest tenant isolation risk — a missing scope check leaks all tenant data.
  - Public redirect (/l/:id) is unauthenticated — it must never resolve admin routes.
  - Billing endpoints must be read-only from the tenant perspective.
  - Auth token claims must be verified server-side — never trust client-sent admin flags.

Product: Commerce & Checkout API (Supporting context)
Purpose: Protect the products catalog, voting, image serving, Stripe payment intent creation, and order-completion flow as a paired, transaction-critical surface.
API paths:
  - functions/api/products/
  - functions/api/checkout/
Backend routes:
  - GET /products
  - GET /products/:id
  - POST /products/:id/vote
  - GET /images/:productId/:fileName
  - POST /createPaymentIntent
  - POST /createPaymentIntent/updateEmail
Validation focus:
  - Validate product fetch, image serving, voting, and checkout as one paired flow.
  - Confirm Stripe payment intent creation returns the correct client secret shape.
  - Verify vote rate limiting middleware is still active and correctly scoped.
  - Ensure image serving enforces content-type and does not expose directory listings.
Risk focus:
  - Stripe webhook and intent handling are transaction-critical — no silent fallbacks.
  - Rate limiting on vote endpoints must not be removed or weakened during cleanup.
  - Image serving routes must validate productId before reading from storage.
  - Checkout email update must not allow overwriting a confirmed payment's email.

Product: Kamera Quest API (Supporting context)
Purpose: Keep camera catalog integrity, skill-level-aware preset generation, lens data, and predeploy validation stable as a contract-driven catalog service.
API paths:
  - functions/api/cameras/
  - functions/scripts/
Backend routes:
  - GET /presets/meta
  - GET /cameras/:brand
  - GET /cameras/:brand/:modelName/lenses
  - POST /presets/classic
  - POST /presets/smart
Validation focus:
  - Verify skill-level branching (apprentice/enthusiast/professional) still produces different outputs.
  - Confirm catalog provenance metadata (verification status, source) is not stripped.
  - Validate predeploy checks are not weakened to bypass failing catalog validation.
  - Check lens compatibility data structure is preserved when entries are updated.
Risk focus:
  - Preset generation is contract-driven — output shape changes break the frontend silently.
  - Predeploy validation scripts are the last safety net before catalog corruption reaches prod.
  - Camera catalog updates are persistent — no dry-run mode exists; bugs go live.
  - Smart preset logic depends on structured backend payloads — shape must remain stable.

Product: Kreator Program API (Supporting context)
Purpose: Maintain creator application intake, onboarding state transitions, Google OAuth flows, and admin review as a gated, stateful program.
API paths:
  - functions/api/kreators/
Backend routes:
  - POST /kreators/apply
  - GET /kreators/applications/:id/status
  - POST /kreators/onboarding/verify
  - POST /kreators/onboarding/complete
  - GET /kreators/auth/google/*
  - GET /kreators/me
  - GET /kreators/admin/*
  - GET /kreators/products
Validation focus:
  - Verify application state transitions are validated and cannot be skipped.
  - Confirm admin endpoints check the admin custom claim before any data mutation.
  - Validate onboarding completion is idempotent — re-processing must not double-apply.
  - Check that Google OAuth callback handles token exchange errors gracefully.
Risk focus:
  - Application state machine bugs allow creators to skip approval steps.
  - Admin review endpoints must not be reachable by non-admin custom claims.
  - OAuth token exchange stores credentials in Firestore — validate storage security.
  - /kreators/products is ahead of the deployed backend contract — flag if changed.

Product: Kutz Nutrition API (Supporting context)
Purpose: Maintain nutrition food parsing, meal suggestion ranking, Fitbit OAuth integration, and food search as a reliable, privacy-sensitive service.
API paths:
  - functions/api/kutz/
Backend routes:
  - GET /kutz/foods/search
  - POST /kutz/meals
  - GET /kutz/meals
  - GET /kutz/fitbit/auth
  - GET /kutz/fitbit/callback
  - POST /kutz/fitbit/refresh
Validation focus:
  - Verify Fitbit OAuth token refresh still works end-to-end after middleware changes.
  - Confirm food parsing returns safe defaults for null or incomplete macro data.
  - Validate meal suggestion ranking does not expose raw Firestore document IDs.
  - Check that Fitbit credentials stored in Firestore are not returned to the client.
Risk focus:
  - Fitbit OAuth tokens are sensitive credentials — never log or expose them in responses.
  - Food parsing edge cases (missing macro fields) must not crash the request handler.
  - Meal logs contain user health data — access must be scoped to the authenticated user.
  - Token refresh failures must fail safely without corrupting the stored credential.

Product: Weather & Forecast API (Supporting context)
Purpose: Maintain forecast scheduling, paddle score computation, nearby water search, and cache behavior as a reliable, latency-sensitive service.
API paths:
  - functions/api/weather/
  - functions/scheduled/
Backend routes:
  - GET /paddlingOut
  - GET /paddlingOut/:id
  - GET /paddleScore
  - GET /fastForecast
  - GET /forecast
  - GET /nearbyWater
Validation focus:
  - Verify cache warm and cold paths both return structurally identical responses.
  - Confirm paddle score output range does not shift after normalization changes.
  - Check that scheduled function cron expressions are not inadvertently modified.
  - Validate error fallbacks still emit confidence levels and fallback data shapes.
Risk focus:
  - Cache invalidation bugs silently serve stale data with incorrect confidence scores.
  - Score normalization changes are invisible to tests if ranges are not bounded.
  - Scheduled functions share state with request handlers — side effects are subtle.
  - Nearby water results depend on OSM data quality — errors should degrade gracefully.

Choose the files most relevant to thoroughly auditing this goal. Cover routes, middleware, services, and config that relate to the goal.
Return JSON only with this shape:
{"selected_files":["repo:path"],"reasoning":["short reason"]}

Rules:
- Select between 10 and 18 files.
- INCLUDE middleware files — they are essential for auth and security audits.
- INCLUDE service files — they contain shared business logic and tenant isolation.
- INCLUDE route files — they define endpoint contracts and request handling.
- Include the entry point (index.js) for route mounting context.
- Include scheduled functions if the goal mentions cron, forecast, or cache warming.
- Prefer broad coverage over narrow depth since this is an audit.
- Use exact `repo:path` strings from the inventory.

Inventory:
- api:functions/middleware/authMiddleware.js | 316 lines | 8842 bytes | score 34
- api:functions/middleware/kreatorAuthMiddleware.js | 313 lines | 8223 bytes | score 34
- api:functions/middleware/apiKeyMiddleware.js | 325 lines | 8488 bytes | score 29
- api:functions/middleware/rateLimit.js | 14 lines | 421 bytes | score 29
- api:functions/middleware/securityMiddleware.js | 232 lines | 6652 bytes | score 29
- api:functions/api/weather/inputStandardization.js | 286 lines | 8125 bytes | score 26
- api:functions/api/weather/sharedWeatherUtils.js | 221 lines | 6600 bytes | score 22
- api:functions/api/auth/authRoutes.js | 109 lines | 2788 bytes | score 21
- api:functions/api/cameras/audit/capabilitySchema.js | 127 lines | 2217 bytes | score 21
- api:functions/api/cameras/audit/officialBodies.js | 127 lines | 7673 bytes | score 21
- api:functions/api/smartLinks/smartLinkValidation.js | 84 lines | 2108 bytes | score 21
- api:functions/api/weather/dataStandardization.js | 208 lines | 6482 bytes | score 21
- api:functions/index.js | 122 lines | 5022 bytes | score 20
- api:functions/api/smartLinks/redirectHandler.js | 401 lines | 12403 bytes | score 17
- api:functions/api/weather/fastForecast.js | 365 lines | 14628 bytes | score 17
- api:functions/api/weather/forecast.js | 396 lines | 13421 bytes | score 17
- api:functions/api/admin/adminUsers.js | 263 lines | 6486 bytes | score 16
- api:functions/api/admin/getOrder.js | 140 lines | 3347 bytes | score 16
- api:functions/api/admin/updateOrderStatus.js | 159 lines | 4677 bytes | score 16
- api:functions/api/ai/gptActions.js | 268 lines | 7362 bytes | score 16
- api:functions/api/cameras/camerasRoutes.js | 62 lines | 2532 bytes | score 16
- api:functions/api/cameras/data_presets/index.js | 24 lines | 981 bytes | score 16
- api:functions/api/cameras/engine/evCalc.js | 56 lines | 1765 bytes | score 16
- api:functions/api/cameras/engine/presetEngine.js | 123 lines | 5245 bytes | score 16
- api:functions/api/cameras/lensesRoutes.js | 44 lines | 1622 bytes | score 16
- api:functions/api/cameras/presetsRoutes.js | 84 lines | 2629 bytes | score 16
- api:functions/api/cameras/smartRoutes.js | 139 lines | 4901 bytes | score 16
- api:functions/api/cameras/validate.js | 107 lines | 3915 bytes | score 16
- api:functions/api/checkout/createPaymentIntent.js | 189 lines | 6615 bytes | score 16
- api:functions/api/checkout/router.js | 23 lines | 733 bytes | score 16
- api:functions/api/checkout/stripeWebhook.js | 331 lines | 10400 bytes | score 16
- api:functions/api/checkout/updatePaymentIntentEmail.js | 79 lines | 2030 bytes | score 16
- api:functions/api/core/docs.js | 144 lines | 4136 bytes | score 16
- api:functions/api/kreators/testRoutes.js | 321 lines | 8744 bytes | score 16
- api:functions/api/kutz/aiClient.js | 131 lines | 5014 bytes | score 16
- api:functions/api/kutz/fitbit.js | 307 lines | 10126 bytes | score 16
- api:functions/api/kutz/kutzRouter.js | 57 lines | 2028 bytes | score 16
- api:functions/api/kutz/parsePhoto.js | 192 lines | 8118 bytes | score 16
- api:functions/api/kutz/searchFoods.js | 148 lines | 5778 bytes | score 16
- api:functions/api/kutz/suggest.js | 278 lines | 11384 bytes | score 16
- api:functions/api/kutz/weeklyReport.js | 101 lines | 4052 bytes | score 16
- api:functions/api/products/images.js | 96 lines | 2695 bytes | score 16
- api:functions/api/products/products.js | 171 lines | 6190 bytes | score 16
- api:functions/api/smartLinks/attributionService.js | 303 lines | 8142 bytes | score 16
- api:functions/api/smartLinks/publicApiRouter.js | 396 lines | 10208 bytes | score 16
- api:functions/api/smartLinks/publicRouter.js | 214 lines | 7274 bytes | score 16
- api:functions/api/smartLinks/rateLimitService.js | 314 lines | 8778 bytes | score 16
- api:functions/api/smartLinks/smartLinkDefaults.js | 108 lines | 3519 bytes | score 16
- api:functions/api/smartLinks/smartLinkEnrichment.js | 163 lines | 4500 bytes | score 16
- api:functions/api/smartLinks/smartLinkService.js | 284 lines | 7563 bytes | score 16
- api:functions/api/smartLinks/tenantContext.js | 265 lines | 7720 bytes | score 16
- api:functions/api/smartLinks/webhookService.js | 393 lines | 10144 bytes | score 16
- api:functions/api/weather/mlService.js | 169 lines | 5271 bytes | score 16
- api:functions/api/weather/modelCalibration.js | 286 lines | 9763 bytes | score 16
- api:functions/api/weather/nearbyWater.js | 145 lines | 5756 bytes | score 16
- api:functions/api/weather/paddleScore.js | 262 lines | 9705 bytes | score 16
- api:functions/api/weather/paddleScoreCompute.js | 173 lines | 7418 bytes | score 16
- api:functions/api/weather/paddlingout.js | 158 lines | 5084 bytes | score 16
- api:functions/api/weather/smartWarnings.js | 317 lines | 11940 bytes | score 16
- api:functions/utils/shared/cache.js | 120 lines | 3030 bytes | score 16
- api:functions/scheduled/forecastScheduler.js | 258 lines | 7403 bytes | score 15
- api:functions/cache/forecastCache.js | 286 lines | 8985 bytes | score 13
- api:functions/scripts/camera-validation-packet.js | 241 lines | 7702 bytes | score 13
- api:functions/api/billing/router.js | 433 lines | 12669 bytes | score 12
- api:functions/api/deepLinks/deeplinkRoutes.js | 522 lines | 17597 bytes | score 12
- api:functions/api/kreators/kreatorProductRoutes.js | 428 lines | 12296 bytes | score 12
- api:functions/api/kreators/kreatorRoutes.js | 1040 lines | 28658 bytes | score 12
- api:functions/api/kutz/parseFoods.js | 242 lines | 12321 bytes | score 12
- api:functions/api/smartLinks/clickTracking.js | 457 lines | 12307 bytes | score 12
- api:functions/api/smartLinks/smartLinks.js | 498 lines | 15657 bytes | score 12
- api:functions/api/weather/paddlePenalties.js | 402 lines | 16194 bytes | score 12
- api:functions/services/adminUserService.js | 271 lines | 6080 bytes | score 12
- api:functions/api/cameras/data_presets/landscape.json | 559 lines | 20476 bytes | score 11
- api:functions/api/cameras/data_presets/automotive.json | 163 lines | 6945 bytes | score 10
- api:functions/api/cameras/data_presets/concert.json | 163 lines | 7147 bytes | score 10
- api:functions/api/cameras/data_presets/drone.json | 165 lines | 6992 bytes | score 10
- api:functions/api/cameras/data_presets/fashion.json | 163 lines | 7144 bytes | score 10
- api:functions/api/cameras/data_presets/food.json | 164 lines | 6848 bytes | score 10
- api:functions/api/cameras/data_presets/newborn.json | 164 lines | 7127 bytes | score 10
- api:functions/api/cameras/data_presets/product.json | 163 lines | 6947 bytes | score 10
