# Knowledge Graph: kamera

- Track: kamera
- Generated: 2026-04-18T19:58:14.368Z
- Files: 50
- Exports: 9
- Import edges: 39

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
- functions/api/cameras/audit/capabilitySchema.js (127 lines, 0 exports)
- functions/api/cameras/audit/officialBodies.js (127 lines, 0 exports)
- functions/api/cameras/camerasRoutes.js (62 lines, 0 exports, router, firebase)
- functions/api/cameras/data_cameras/canon.json (1054 lines, 0 exports)
- functions/api/cameras/data_cameras/sony.json (870 lines, 0 exports)
- functions/api/cameras/data_lenses/canon.json (2251 lines, 0 exports)
- functions/api/cameras/data_lenses/sony.json (1998 lines, 0 exports)
- functions/api/cameras/data_presets/architecture.json (382 lines, 0 exports)
- functions/api/cameras/data_presets/astro.json (458 lines, 0 exports)
- functions/api/cameras/data_presets/automotive.json (163 lines, 0 exports)
- functions/api/cameras/data_presets/concert.json (163 lines, 0 exports)
- functions/api/cameras/data_presets/drone.json (165 lines, 0 exports)
- functions/api/cameras/data_presets/event.json (382 lines, 0 exports)
- functions/api/cameras/data_presets/fashion.json (163 lines, 0 exports)
- functions/api/cameras/data_presets/food.json (164 lines, 0 exports)
- functions/api/cameras/data_presets/goldenhour.json (382 lines, 0 exports)
- functions/api/cameras/data_presets/index.js (24 lines, 0 exports)
- functions/api/cameras/data_presets/indoorlowlight.json (382 lines, 0 exports)
- functions/api/cameras/data_presets/landscape.json (559 lines, 0 exports)
- functions/api/cameras/data_presets/macro.json (434 lines, 0 exports)
- functions/api/cameras/data_presets/newborn.json (164 lines, 0 exports)
- functions/api/cameras/data_presets/portrait.json (510 lines, 0 exports)
- functions/api/cameras/data_presets/product.json (163 lines, 0 exports)
- functions/api/cameras/data_presets/realestate.json (163 lines, 0 exports)
- functions/api/cameras/data_presets/sports.json (362 lines, 0 exports)
- functions/api/cameras/data_presets/street.json (382 lines, 0 exports)
- functions/api/cameras/data_presets/travel.json (382 lines, 0 exports)
- functions/api/cameras/data_presets/underwater.json (163 lines, 0 exports)
- functions/api/cameras/data_presets/wildlife.json (361 lines, 0 exports)
- functions/api/cameras/engine/evCalc.js (56 lines, 0 exports)
- functions/api/cameras/engine/presetEngine.js (123 lines, 0 exports, middleware)
- functions/api/cameras/engine/sessionAdvisor.js (929 lines, 0 exports)
- functions/api/cameras/lensesRoutes.js (44 lines, 0 exports, router, firebase)
- functions/api/cameras/presetsRoutes.js (84 lines, 0 exports, router)
- functions/api/cameras/smartRoutes.js (139 lines, 0 exports, router)
- functions/api/cameras/validate.js (107 lines, 0 exports, middleware)
- functions/scripts/camera-audit-report.js (398 lines, 0 exports)
- functions/scripts/camera-catalog-maintenance.js (830 lines, 0 exports)
- functions/scripts/camera-catalog-validate.js (96 lines, 0 exports)
- functions/scripts/camera-validation-packet.js (241 lines, 0 exports)
- functions/scripts/predeploy-check.js (64 lines, 0 exports, firebase)
