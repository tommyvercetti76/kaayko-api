# Shared Platform Backend

## Scope

These are the backend capabilities that support more than one Kaayko product or govern the operational surface of the whole API deployment.

## Shared mounts and files

- API mount and runtime config: [`functions/index.js`](../../functions/index.js)
- Firebase deploy/runtime config: [`firebase.json`](../../firebase.json)
- Auth routes: [`functions/api/auth/authRoutes.js`](../../functions/api/auth/authRoutes.js)
- API docs surface: [`functions/api/core/docs.js`](../../functions/api/core/docs.js)
- Shared middleware:
  - [`functions/middleware/authMiddleware.js`](../../functions/middleware/authMiddleware.js)
  - [`functions/middleware/kreatorAuthMiddleware.js`](../../functions/middleware/kreatorAuthMiddleware.js)
  - [`functions/middleware/securityMiddleware.js`](../../functions/middleware/securityMiddleware.js)
  - [`functions/middleware/apiKeyMiddleware.js`](../../functions/middleware/apiKeyMiddleware.js)
  - [`functions/middleware/rateLimit.js`](../../functions/middleware/rateLimit.js)

## Operational responsibilities

- Keep `functions/index.js` as the route inventory source of truth.
- Keep `firebase.json` and `functions/package.json` aligned so predeploy checks actually run before production deploys.
- Preserve raw-body ordering for Stripe webhooks and any future signature-based integrations.
- Use product docs in this directory to determine whether a route file is actually mounted or only staged in-code.

## Cross-product risks to watch

- Unmounted route modules can create frontend expectations that do not exist in production.
- The current checked-in automated suite is concentrated on Kamera Quest, leaving most of the platform dependent on manual verification.
- Several frontend experiences hardcode the production Cloud Run URL. Any backend URL or auth-flow change needs a coordinated frontend pass.

## Out-of-scope but adjacent

- The `kaayko` frontend repo contains `knowledge` and `roots` views that talk to an external `cool-schools` API. Those surfaces are not powered by this repository's `main` branch and should not be documented as Kaayko API features.
