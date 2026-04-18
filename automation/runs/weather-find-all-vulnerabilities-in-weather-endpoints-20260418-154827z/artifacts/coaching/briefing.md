# Agent Briefing

- Track: `weather`
- Area: `weather`
- Goal: Find all vulnerabilities in weather endpoints
- Guided products: Weather & Forecast API, Shared API Infrastructure
- Primary focus products: Weather & Forecast API
- Source docs: README.md, functions/api/weather/README.md, functions/middleware/README.md

## Portfolio Overview

Kaayko API is a Firebase Cloud Functions Express backend. Every route is mounted through functions/index.js. Safe agent work must preserve route contracts, auth middleware chains, Firestore access patterns, and existing error-handling shapes. Security and tenant isolation are the highest-priority concerns.

## Focused Doc Snapshots

- README.md: Kaayko API What this repo powers | Product | Purpose | Mounted base paths on `api` | Primary frontend consumers | Product guide | | Kreator | Creator applications, onboarding, profile, admin review | `/kreators` | `kaayko/src/kreator/*` | [`docs/products/KREATOR.md`](./docs/products/KREATOR.md) | Architecture Runtime: Firebase Functions v2, Node.js 22, Express app exported as `api`. Storage and state: Firebase Admin, Firestore, Cloud Storage, Firebase Auth. Payments: Stripe checkout/payment intent and webhook flows.
- functions/api/weather/README.md: 🌦️ Weather APIs *Complete weather and paddle condition intelligence powered by ML** 📁 Files in this Module *Main API Endpoints:** _Mount status — All weather routers are mounted in `functions/index.js` and are reachable at runtime. The module mounts are:_ `/paddlingOut` → `paddlingout.js` (listed and mounted) `/paddleScore` → `paddleScore.js` (ML-powered paddle score) `/fastForecast` → `fastForecast.js` (public, cached forecasts)

## Weather & Forecast API

- Priority: primary
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

## Shared API Infrastructure

- Priority: supporting
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

