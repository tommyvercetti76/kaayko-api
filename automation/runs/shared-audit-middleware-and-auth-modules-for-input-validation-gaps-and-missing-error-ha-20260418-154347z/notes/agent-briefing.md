# Agent Briefing

- Track: `shared`
- Area: `shared`
- Goal: Audit middleware and auth modules for input validation gaps and missing error handling
- Guided products: Shared API Infrastructure, KORTEX Platform API, Commerce & Checkout API, Kamera Quest API, Kreator Program API, Kutz Nutrition API, Weather & Forecast API
- Primary focus products: Shared API Infrastructure
- Source docs: README.md, functions/middleware/README.md, functions/api/smartLinks/README.md, functions/api/products/README.md, functions/api/checkout/README.md, functions/api/cameras/README.md, functions/api/kreators/README.md, functions/api/kutz/README.md, functions/api/weather/README.md

## Portfolio Overview

Kaayko API is a Firebase Cloud Functions Express backend. Every route is mounted through functions/index.js. Safe agent work must preserve route contracts, auth middleware chains, Firestore access patterns, and existing error-handling shapes. Security and tenant isolation are the highest-priority concerns.

## Focused Doc Snapshots

- README.md: Kaayko API What this repo powers | Product | Purpose | Mounted base paths on `api` | Primary frontend consumers | Product guide | | Kreator | Creator applications, onboarding, profile, admin review | `/kreators` | `kaayko/src/kreator/*` | [`docs/products/KREATOR.md`](./docs/products/KREATOR.md) | Architecture Runtime: Firebase Functions v2, Node.js 22, Express app exported as `api`. Storage and state: Firebase Admin, Firestore, Cloud Storage, Firebase Auth. Payments: Stripe checkout/payment intent and webhook flows.
- functions/middleware/README.md: Document not found in the current workspace.

## Shared API Infrastructure

- Priority: primary
- Purpose: Protect the middleware stack, auth guards, error handling, CORS, Firebase Admin initialization, and rate limiting that all routes depend on.
- Source docs:
- README.md
- functions/middleware/README.md
- API paths:
- functions/middleware/
- functions/api/core/
- functions/index.js
- functions/api/auth/
- functions/utils/
- Backend routes:
- /health
- /api/**
- Validation focus:
- Verify middleware execution order is preserved for every mounted router.
- Ensure auth claim validation runs before any data mutation endpoint.
- Confirm error handlers return consistent shapes without leaking stack traces.
- Validate Firebase Admin SDK is initialized once and not duplicated per-request.
- Risk focus:
- Middleware order bugs are silent — a reorder can bypass security checks entirely.
- Firebase Admin double-initialization causes memory and auth failures.
- Error shape inconsistencies cause frontend parsing failures across multiple products.
- CORS misconfiguration can silently allow unauthorized cross-origin requests.

## KORTEX Platform API

- Priority: supporting
- Purpose: Protect smart-link CRUD, tenant auth claims, redirect handling, analytics recording, billing visibility, and QR flows as a security-critical multi-tenant surface.
- Source docs:
- README.md
- functions/api/smartLinks/README.md
- API paths:
- functions/api/smartLinks/
- functions/api/billing/
- functions/api/auth/
- Backend routes:
- GET /smartlinks
- POST /smartlinks
- PUT /smartlinks/:id
- DELETE /smartlinks/:id
- GET /l/:id
- GET /resolve
- GET /billing/*
- GET /auth/*
- Validation focus:
- Verify tenant isolation — every data read/write must scope to the authenticated tenant.
- Confirm public redirect paths cannot access admin data or mutation endpoints.
- Validate auth claim checks (admin boolean) run before any tenant-mutation route.
- Ensure analytics recording is append-only and cannot be manipulated by the client.
- Risk focus:
- KORTEX has the highest tenant isolation risk — a missing scope check leaks all tenant data.
- Public redirect (/l/:id) is unauthenticated — it must never resolve admin routes.
- Billing endpoints must be read-only from the tenant perspective.
- Auth token claims must be verified server-side — never trust client-sent admin flags.

## Commerce & Checkout API

- Priority: supporting
- Purpose: Protect the products catalog, voting, image serving, Stripe payment intent creation, and order-completion flow as a paired, transaction-critical surface.
- Source docs:
- README.md
- functions/api/products/README.md
- functions/api/checkout/README.md
- API paths:
- functions/api/products/
- functions/api/checkout/
- Backend routes:
- GET /products
- GET /products/:id
- POST /products/:id/vote
- GET /images/:productId/:fileName
- POST /createPaymentIntent
- POST /createPaymentIntent/updateEmail
- Validation focus:
- Validate product fetch, image serving, voting, and checkout as one paired flow.
- Confirm Stripe payment intent creation returns the correct client secret shape.
- Verify vote rate limiting middleware is still active and correctly scoped.
- Ensure image serving enforces content-type and does not expose directory listings.
- Risk focus:
- Stripe webhook and intent handling are transaction-critical — no silent fallbacks.
- Rate limiting on vote endpoints must not be removed or weakened during cleanup.
- Image serving routes must validate productId before reading from storage.
- Checkout email update must not allow overwriting a confirmed payment's email.

## Kamera Quest API

- Priority: supporting
- Purpose: Keep camera catalog integrity, skill-level-aware preset generation, lens data, and predeploy validation stable as a contract-driven catalog service.
- Source docs:
- README.md
- functions/api/cameras/README.md
- API paths:
- functions/api/cameras/
- functions/scripts/
- Backend routes:
- GET /presets/meta
- GET /cameras/:brand
- GET /cameras/:brand/:modelName/lenses
- POST /presets/classic
- POST /presets/smart
- Validation focus:
- Verify skill-level branching (apprentice/enthusiast/professional) still produces different outputs.
- Confirm catalog provenance metadata (verification status, source) is not stripped.
- Validate predeploy checks are not weakened to bypass failing catalog validation.
- Check lens compatibility data structure is preserved when entries are updated.
- Risk focus:
- Preset generation is contract-driven — output shape changes break the frontend silently.
- Predeploy validation scripts are the last safety net before catalog corruption reaches prod.
- Camera catalog updates are persistent — no dry-run mode exists; bugs go live.
- Smart preset logic depends on structured backend payloads — shape must remain stable.

## Kreator Program API

- Priority: supporting
- Purpose: Maintain creator application intake, onboarding state transitions, Google OAuth flows, and admin review as a gated, stateful program.
- Source docs:
- README.md
- functions/api/kreators/README.md
- API paths:
- functions/api/kreators/
- Backend routes:
- POST /kreators/apply
- GET /kreators/applications/:id/status
- POST /kreators/onboarding/verify
- POST /kreators/onboarding/complete
- GET /kreators/auth/google/*
- GET /kreators/me
- GET /kreators/admin/*
- GET /kreators/products
- Validation focus:
- Verify application state transitions are validated and cannot be skipped.
- Confirm admin endpoints check the admin custom claim before any data mutation.
- Validate onboarding completion is idempotent — re-processing must not double-apply.
- Check that Google OAuth callback handles token exchange errors gracefully.
- Risk focus:
- Application state machine bugs allow creators to skip approval steps.
- Admin review endpoints must not be reachable by non-admin custom claims.
- OAuth token exchange stores credentials in Firestore — validate storage security.
- /kreators/products is ahead of the deployed backend contract — flag if changed.

## Kutz Nutrition API

- Priority: supporting
- Purpose: Maintain nutrition food parsing, meal suggestion ranking, Fitbit OAuth integration, and food search as a reliable, privacy-sensitive service.
- Source docs:
- README.md
- functions/api/kutz/README.md
- API paths:
- functions/api/kutz/
- Backend routes:
- GET /kutz/foods/search
- POST /kutz/meals
- GET /kutz/meals
- GET /kutz/fitbit/auth
- GET /kutz/fitbit/callback
- POST /kutz/fitbit/refresh
- Validation focus:
- Verify Fitbit OAuth token refresh still works end-to-end after middleware changes.
- Confirm food parsing returns safe defaults for null or incomplete macro data.
- Validate meal suggestion ranking does not expose raw Firestore document IDs.
- Check that Fitbit credentials stored in Firestore are not returned to the client.
- Risk focus:
- Fitbit OAuth tokens are sensitive credentials — never log or expose them in responses.
- Food parsing edge cases (missing macro fields) must not crash the request handler.
- Meal logs contain user health data — access must be scoped to the authenticated user.
- Token refresh failures must fail safely without corrupting the stored credential.

## Weather & Forecast API

- Priority: supporting
- Purpose: Maintain forecast scheduling, paddle score computation, nearby water search, and cache behavior as a reliable, latency-sensitive service.
- Source docs:
- README.md
- functions/api/weather/README.md
- API paths:
- functions/api/weather/
- functions/scheduled/
- Backend routes:
- GET /paddlingOut
- GET /paddlingOut/:id
- GET /paddleScore
- GET /fastForecast
- GET /forecast
- GET /nearbyWater
- Validation focus:
- Verify cache warm and cold paths both return structurally identical responses.
- Confirm paddle score output range does not shift after normalization changes.
- Check that scheduled function cron expressions are not inadvertently modified.
- Validate error fallbacks still emit confidence levels and fallback data shapes.
- Risk focus:
- Cache invalidation bugs silently serve stale data with incorrect confidence scores.
- Score normalization changes are invisible to tests if ranges are not bounded.
- Scheduled functions share state with request handlers — side effects are subtle.
- Nearby water results depend on OSM data quality — errors should degrade gracefully.

