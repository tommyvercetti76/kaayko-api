# Store / Commerce Backend

## Scope

The Store backend serves Kaayko merchandise browsing, product voting, checkout, image delivery, and order administration.

## Mounted routes on `main`

From [`functions/index.js`](../../functions/index.js):

- `GET /products`
- `GET /products/:id`
- `POST /products/:id/vote`
- `GET /images/health`
- `GET /images`
- `GET /images/:productId/:fileName`
- `POST /createPaymentIntent`
- `POST /createPaymentIntent/updateEmail`
- `POST /createPaymentIntent/webhook`
- `POST /admin/updateOrderStatus`
- `GET /admin/getOrder`
- `GET /admin/listOrders`

Primary route files:

- [`functions/api/products/products.js`](../../functions/api/products/products.js)
- [`functions/api/products/images.js`](../../functions/api/products/images.js)
- [`functions/api/checkout/router.js`](../../functions/api/checkout/router.js)
- [`functions/api/admin/updateOrderStatus.js`](../../functions/api/admin/updateOrderStatus.js)
- [`functions/api/admin/getOrder.js`](../../functions/api/admin/getOrder.js)

## Frontend consumers

The companion frontend uses these routes from:

- `src/index.html`
- `src/store.html`
- `src/cart.html`
- `src/order-success.html`
- `src/js/kaayko_apiClient.js`
- `src/js/kaayko_ui.js`

## External systems

- Stripe for checkout and webhook confirmation
- Firebase Auth for protected admin actions
- Cloud Storage for product imagery

## Security and access

- Stripe webhook handling is raw-body sensitive and mounted before `express.json()`.
- Admin order routes are protected with `requireAuth` and `requireAdmin`.
- Product browsing and voting are public.
- Image delivery is proxied through the backend instead of exposing storage objects directly.

## Quality and maintenance notes

- No dedicated commerce regression suite is wired into `functions/package.json` on `main`.
- The safest minimum automation for this product is: route health checks, Stripe config verification, and protected-route authorization checks.
- Any store deploy should validate both public catalog fetches and admin-only order mutations separately.
