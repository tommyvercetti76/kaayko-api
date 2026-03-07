# KORTEX Backend

## Scope

KORTEX is Kaayko's smart-linking and redirect platform. In `main`, it spans CRUD for smart links, tenant onboarding, analytics, public redirect resolution, auth, and subscription billing.

## Mounted routes on `main`

Smart links:

- `GET /smartlinks/health`
- `GET /smartlinks/admin/migrate`
- `POST /smartlinks/tenant-registration`
- `GET /smartlinks/tenants`
- `GET /smartlinks/stats`
- `GET /smartlinks/r/:code`
- `POST /smartlinks`
- `GET /smartlinks`
- `GET /smartlinks/:code`
- `PUT /smartlinks/:code`
- `DELETE /smartlinks/:code`
- `POST /smartlinks/events/:type`

Legacy deep-link surfaces:

- `GET /l/:id`
- `GET /resolve`
- `GET /health`

Auth and billing:

- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/verify`
- `GET /billing/config`
- `GET /billing/subscription`
- `POST /billing/create-checkout`
- `POST /billing/downgrade`
- `POST /billing/webhook`
- `GET /billing/usage`

Primary route files:

- [`functions/api/smartLinks/smartLinks.js`](../../functions/api/smartLinks/smartLinks.js)
- [`functions/api/deepLinks/deeplinkRoutes.js`](../../functions/api/deepLinks/deeplinkRoutes.js)
- [`functions/api/auth/authRoutes.js`](../../functions/api/auth/authRoutes.js)
- [`functions/api/billing/router.js`](../../functions/api/billing/router.js)

## Frontend consumers

Primary frontend files:

- `src/kortex.html`
- `src/create-kortex-link.html`
- `src/admin/kortex.html`
- `src/admin/login.html`
- `src/admin/js/config.js`
- `src/admin/js/kortex-core.js`
- `src/admin/views/dashboard/*`
- `src/admin/views/create-link/*`
- `src/admin/views/billing/*`
- `src/admin/views/tenant-onboarding/*`
- `src/redirect.html`

## Security and access

- Public redirect and analytics collection routes are intentionally open.
- Admin CRUD requires `requireAuth` and `requireAdmin`.
- Tenant-scoped admin flows rely on the `X-Kaayko-Tenant-Id` header from the frontend admin shell.
- Billing routes require authenticated users except for public config and Stripe webhooks.

## Current mismatches on `main`

- [`functions/api/smartLinks/publicApiRouter.js`](../../functions/api/smartLinks/publicApiRouter.js) exists, but it is not mounted from [`functions/index.js`](../../functions/index.js).
- Some admin onboarding docs in the frontend still describe `/public/smartlinks` flows even though `main` only mounts `/smartlinks`.

## Quality and maintenance notes

- No dedicated KORTEX regression suite is wired into `functions/package.json`.
- The minimum safe automation should verify auth, tenant scoping, CRUD, redirect behavior, billing config, and webhook signature configuration.
