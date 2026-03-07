# Kreator Backend

## Scope

Kreator covers creator applications, onboarding, authentication, profile management, and admin review workflows.

## Mounted routes on `main`

Public and authenticated creator lifecycle routes:

- `GET /kreators/health`
- `GET /kreators/debug`
- `POST /kreators/apply`
- `GET /kreators/applications/:id/status`
- `POST /kreators/onboarding/verify`
- `POST /kreators/onboarding/complete`
- `GET /kreators/me`
- `PUT /kreators/me`
- `DELETE /kreators/me`
- `POST /kreators/auth/google/signin`
- `POST /kreators/auth/google/connect`
- `POST /kreators/auth/google/disconnect`
- `GET /kreators/admin/applications`
- `GET /kreators/admin/applications/:id`
- `PUT /kreators/admin/applications/:id/approve`
- `PUT /kreators/admin/applications/:id/reject`
- `GET /kreators/admin/list`
- `GET /kreators/admin/:uid`
- `POST /kreators/admin/:uid/resend-link`
- `GET /kreators/admin/stats`

Primary route file:

- [`functions/api/kreators/kreatorRoutes.js`](../../functions/api/kreators/kreatorRoutes.js)

## Frontend consumers

Primary frontend files:

- `src/kreator/index.html`
- `src/kreator/apply.html`
- `src/kreator/check-status.html`
- `src/kreator/onboarding.html`
- `src/kreator/kreator-login.html`
- `src/kreator/dashboard.html`
- `src/kreator/add-product.html`
- `src/kreator/admin/index.html`
- `src/kreator/js/kreator-api.js`

## Security and access

- Public actions are rate-limited inside the route layer.
- Profile and account mutations require Kreator auth middleware.
- Admin review flows require an admin user via the shared auth middleware.
- Google sign-in is brokered through Firebase identity plus backend verification.

## Current mismatch on `main`

- [`functions/api/kreators/kreatorProductRoutes.js`](../../functions/api/kreators/kreatorProductRoutes.js) defines `/products` CRUD, but it is not mounted from [`functions/index.js`](../../functions/index.js).
- The frontend dashboard and add-product pages call `/kreators/products`, so those product-management surfaces are currently documented-but-unshipped in `main`.

## Quality and maintenance notes

- No automated Kreator regression suite is wired into `functions/package.json`.
- Product-management work should first resolve the route-mount mismatch before adding more frontend capability.
