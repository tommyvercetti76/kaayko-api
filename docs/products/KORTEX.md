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

Campaign management:

- `GET /campaigns/health`
- `POST /campaigns`
- `GET /campaigns`
- `GET /campaigns/:campaignId`
- `PUT /campaigns/:campaignId`
- `POST /campaigns/:campaignId/pause`
- `POST /campaigns/:campaignId/resume`
- `POST /campaigns/:campaignId/archive`
- `GET /campaigns/:campaignId/members`
- `POST /campaigns/:campaignId/members`
- `DELETE /campaigns/:campaignId/members/:uid`
- `POST /campaigns/:campaignId/links`
- `GET /campaigns/:campaignId/links`
- `GET /campaigns/:campaignId/links/:code`
- `PUT /campaigns/:campaignId/links/:code`
- `POST /campaigns/:campaignId/links/:code/pause`
- `POST /campaigns/:campaignId/links/:code/resume`
- `DELETE /campaigns/:campaignId/links/:code`

Legacy deep-link surfaces:

- `GET /:campaignSlug/:code` (campaign namespace resolver, mounted before legacy deep-links)
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
- [`functions/api/campaigns/campaignRoutes.js`](../../functions/api/campaigns/campaignRoutes.js)
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

- Public redirect routes are intentionally open.
- Public analytics collection is constrained to known event types and known enabled links.
- Aggregate stats require authenticated admin access and should remain tenant-scoped by default.
- Admin CRUD requires `requireAuth` and `requireAdmin`.
- Tenant-scoped admin flows rely on the `X-Kaayko-Tenant-Id` header from the frontend admin shell.
- Billing routes require authenticated users except for public config and Stripe webhooks.

## Current mismatches on `main`

- [`functions/api/smartLinks/publicApiRouter.js`](../../functions/api/smartLinks/publicApiRouter.js) exists but is **intentionally not mounted** from [`functions/index.js`](../../functions/index.js). It defines API-key-authenticated external client endpoints (`POST /api/public/smartlinks`, batch create, stats, attribution) intended for future use. Do not call `/api/public/*` paths — they will 404. Mount this router when external API access is ready to ship.
- Some admin onboarding docs in the frontend still describe `/public/smartlinks` flows even though `main` only mounts `/smartlinks`.

## Quality and maintenance notes

- KORTEX regression tests are available in `functions/__tests__/kortex-api.test.js`, `functions/__tests__/kortex-campaigns.test.js`, and `functions/__tests__/kortex-campaign-resolver.test.js`.
- The minimum safe automation should verify auth, tenant scoping, CRUD, redirect behavior, billing config, and webhook signature configuration.
