# Knowledge Graph: weather

- Track: weather
- Generated: 2026-04-18T19:58:14.156Z
- Files: 25
- Exports: 17
- Import edges: 33

## Conventions

- Express.js routers mounted in functions/index.js
- Middleware in functions/middleware/ — auth, CORS, rate limiting
- Services in functions/services/ — shared business logic
- Scheduled functions in functions/scheduled/
- API routes follow RESTful patterns: router.get(), router.post()
- Firebase Admin SDK for Firestore, Auth, Cloud Storage
- Environment config via functions.config() or process.env
- Error handling: try/catch with structured JSON error responses
- module.exports for all public interfaces

## Files

- functions/middleware/apiKeyMiddleware.js (325 lines, 0 exports, firebase)
- functions/middleware/authMiddleware.js (316 lines, 0 exports, firebase)
- functions/middleware/kreatorAuthMiddleware.js (313 lines, 0 exports, firebase)
- functions/middleware/rateLimit.js (14 lines, 0 exports)
- functions/middleware/securityMiddleware.js (232 lines, 0 exports, firebase)
- functions/api/core/docs.js (144 lines, 0 exports, router)
- functions/index.js (122 lines, 9 exports, firebase)
- functions/api/auth/authRoutes.js (109 lines, 0 exports, router, firebase)
- functions/utils/shared/cache.js (120 lines, 0 exports, firebase)
- functions/api/weather/dataStandardization.js (208 lines, 0 exports)
- functions/api/weather/fastForecast.js (365 lines, 0 exports, router, firebase)
- functions/api/weather/forecast.js (396 lines, 0 exports, router, firebase)
- functions/api/weather/inputStandardization.js (286 lines, 0 exports)
- functions/api/weather/mlService.js (169 lines, 0 exports)
- functions/api/weather/modelCalibration.js (286 lines, 0 exports)
- functions/api/weather/nearbyWater.js (145 lines, 0 exports, router)
- functions/api/weather/paddlePenalties.js (402 lines, 0 exports)
- functions/api/weather/paddleScore.js (262 lines, 0 exports, router, firebase)
- functions/api/weather/paddleScoreCompute.js (173 lines, 0 exports)
- functions/api/weather/paddlingout.js (158 lines, 0 exports, router, firebase)
- functions/api/weather/sharedWeatherUtils.js (221 lines, 0 exports)
- functions/api/weather/smartWarnings.js (317 lines, 0 exports)
- functions/api/weather/unifiedWeatherService.js (780 lines, 0 exports, firebase)
- functions/scheduled/forecastScheduler.js (258 lines, 6 exports, firebase, scheduled)
- functions/scheduled/paddleScoreWarmer.js (215 lines, 2 exports, scheduled)
