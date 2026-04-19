# Knowledge Graph: commerce

- Track: commerce
- Generated: 2026-04-18T19:58:14.210Z
- Files: 15
- Exports: 9
- Import edges: 11

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
- functions/api/products/images.js (96 lines, 0 exports, router, firebase)
- functions/api/products/products.js (171 lines, 0 exports, router, firebase)
- functions/api/checkout/createPaymentIntent.js (189 lines, 0 exports, firebase)
- functions/api/checkout/router.js (23 lines, 0 exports, router)
- functions/api/checkout/stripeWebhook.js (331 lines, 0 exports, firebase)
- functions/api/checkout/updatePaymentIntentEmail.js (79 lines, 0 exports, firebase)
