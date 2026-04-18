You are selecting files for a local coding agent run on a Node.js Firebase Cloud Functions API.
Run ID: weather-find-all-vulnerabilities-in-weather-endpoints-20260418-154827z
Track: weather
Area: weather
Goal: Find all vulnerabilities in weather endpoints
Mode: edit

PORTFOLIO COACHING
Portfolio overview: Kaayko API is a Firebase Cloud Functions Express backend. Every route is mounted through functions/index.js. Safe agent work must preserve route contracts, auth middleware chains, Firestore access patterns, and existing error-handling shapes. Security and tenant isolation are the highest-priority concerns.
Guided products: Weather & Forecast API, Shared API Infrastructure
Primary focus products: Weather & Forecast API
Source docs: README.md, functions/api/weather/README.md, functions/middleware/README.md

Focused doc snapshots:
- README.md: Kaayko API What this repo powers | Product | Purpose | Mounted base paths on `api` | Primary frontend consumers | Product guide | | Kreator | Creator applications, onboarding, profile, admin review | `/kreators` | `kaayko/src/kreator/*` | [`docs/products/KREATOR.md`](./docs/products/KREATOR.md) | Architecture Runtime: Firebase Functions v2, Node.js 22, Express app exported as `api`. Storage and state: Firebase Admin, Firestore, Cloud Storage, Firebase Auth. Payments: Stripe checkout/payment intent and webhook flows.
- functions/api/weather/README.md: 🌦️ Weather APIs *Complete weather and paddle condition intelligence powered by ML** 📁 Files in this Module *Main API Endpoints:** _Mount status — All weather routers are mounted in `functions/index.js` and are reachable at runtime. The module mounts are:_ `/paddlingOut` → `paddlingout.js` (listed and mounted) `/paddleScore` → `paddleScore.js` (ML-powered paddle score) `/fastForecast` → `fastForecast.js` (public, cached forecasts)

Product: Weather & Forecast API (Primary focus)
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

Product: Shared API Infrastructure (Supporting context)
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

Choose the files most relevant to achieving this goal. Use the coaching context above to prioritize files on critical API paths.
Return JSON only with this shape:
{"selected_files":["repo:path"],"reasoning":["short reason"]}

Rules:
- Select between 4 and 8 files.
- Prefer source files over test files or generated files.
- Prefer files where a small, behavior-preserving cleanup is plausible.
- Bias toward files that sit on critical API paths documented in the coaching section.
- Use exact `repo:path` strings from the inventory.

Inventory:
- api:functions/api/weather/dataStandardization.js | 208 lines | 6482 bytes | score 27
- api:functions/api/weather/inputStandardization.js | 286 lines | 8125 bytes | score 27
- api:functions/api/weather/mlService.js | 169 lines | 5271 bytes | score 27
- api:functions/api/weather/modelCalibration.js | 286 lines | 9763 bytes | score 27
- api:functions/api/weather/nearbyWater.js | 145 lines | 5756 bytes | score 27
- api:functions/api/weather/paddleScore.js | 262 lines | 9705 bytes | score 27
- api:functions/api/weather/paddleScoreCompute.js | 173 lines | 7418 bytes | score 27
- api:functions/api/weather/paddlingout.js | 158 lines | 5084 bytes | score 27
- api:functions/api/weather/sharedWeatherUtils.js | 221 lines | 6600 bytes | score 27
- api:functions/api/weather/smartWarnings.js | 317 lines | 11940 bytes | score 27
- api:functions/api/weather/fastForecast.js | 365 lines | 14628 bytes | score 23
- api:functions/api/weather/forecast.js | 396 lines | 13421 bytes | score 23
- api:functions/api/weather/paddlePenalties.js | 402 lines | 16194 bytes | score 23
- api:functions/api/weather/unifiedWeatherService.js | 780 lines | 32861 bytes | score 19
- api:functions/middleware/apiKeyMiddleware.js | 325 lines | 8488 bytes | score 14
- api:functions/middleware/authMiddleware.js | 316 lines | 8842 bytes | score 14
- api:functions/middleware/kreatorAuthMiddleware.js | 313 lines | 8223 bytes | score 14
- api:functions/middleware/rateLimit.js | 14 lines | 421 bytes | score 14
- api:functions/middleware/securityMiddleware.js | 232 lines | 6652 bytes | score 14
- api:functions/scheduled/forecastScheduler.js | 258 lines | 7403 bytes | score 10
- api:functions/scheduled/paddleScoreWarmer.js | 215 lines | 8178 bytes | score 10
