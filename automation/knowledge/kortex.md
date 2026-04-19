# Knowledge Graph: kortex

- Track: kortex
- Generated: 2026-04-18T19:58:14.261Z
- Files: 23
- Exports: 9
- Import edges: 26

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
- functions/api/smartLinks/attributionService.js (303 lines, 0 exports, firebase)
- functions/api/smartLinks/clickTracking.js (457 lines, 0 exports, firebase)
- functions/api/smartLinks/publicApiRouter.js (396 lines, 0 exports, router, firebase)
- functions/api/smartLinks/publicRouter.js (214 lines, 0 exports, router, firebase)
- functions/api/smartLinks/rateLimitService.js (314 lines, 0 exports, firebase)
- functions/api/smartLinks/redirectHandler.js (401 lines, 0 exports, firebase)
- functions/api/smartLinks/smartLinkDefaults.js (108 lines, 0 exports)
- functions/api/smartLinks/smartLinkEnrichment.js (163 lines, 0 exports, firebase)
- functions/api/smartLinks/smartLinkService.js (284 lines, 0 exports, firebase)
- functions/api/smartLinks/smartLinkValidation.js (84 lines, 0 exports)
- functions/api/smartLinks/smartLinks.js (498 lines, 0 exports, router, firebase)
- functions/api/smartLinks/tenantContext.js (265 lines, 0 exports, firebase)
- functions/api/smartLinks/webhookService.js (393 lines, 0 exports, firebase)
- functions/api/billing/router.js (433 lines, 0 exports, router, firebase)
