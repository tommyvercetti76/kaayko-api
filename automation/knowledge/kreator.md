# Knowledge Graph: kreator

- Track: kreator
- Generated: 2026-04-18T19:58:14.312Z
- Files: 12
- Exports: 9
- Import edges: 10

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
- functions/api/kreators/kreatorProductRoutes.js (428 lines, 0 exports, router, firebase)
- functions/api/kreators/kreatorRoutes.js (1040 lines, 0 exports, router, firebase)
- functions/api/kreators/testRoutes.js (321 lines, 0 exports, router, firebase)
