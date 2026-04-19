# Knowledge Graph: kutz

- Track: kutz
- Generated: 2026-04-18T19:58:14.421Z
- Files: 17
- Exports: 10
- Import edges: 18

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
- functions/api/kutz/aiClient.js (131 lines, 0 exports)
- functions/api/kutz/fitbit.js (307 lines, 0 exports, middleware, firebase)
- functions/api/kutz/kutzRouter.js (57 lines, 0 exports, router)
- functions/api/kutz/parseFoods.js (242 lines, 1 exports, firebase)
- functions/api/kutz/parsePhoto.js (192 lines, 0 exports)
- functions/api/kutz/searchFoods.js (148 lines, 0 exports)
- functions/api/kutz/suggest.js (278 lines, 0 exports, firebase)
- functions/api/kutz/weeklyReport.js (101 lines, 0 exports, firebase)
