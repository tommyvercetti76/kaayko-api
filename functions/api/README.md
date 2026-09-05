# API Module Map

Last reviewed: 2026-09-05

This file maps modules mounted by `functions/index.js`. If this file disagrees with code, trust `functions/index.js` and update this doc.

## Mounted Public Product Areas

| Area | Mounts | Primary docs |
|---|---|---|
| Paddling Out | `/paddlingOut`, `/nearbyWater`, `/paddleScore`, `/fastForecast`, `/forecast`, `/paddle-trainer` | `../../docs/products/PADDLING_OUT.md`, `weather/README.md` |
| Store | `/products`, `/images`, `/createPaymentIntent`, `/admin/*` store routes | `../../docs/products/STORE.md`, `checkout/README.md`, `products/README.md`, `admin/README.md` |
| KORTEX | `/kortex`, `/smartlinks`, campaigns, `/l/*`, `/resolve` | `kortex/README.md` |
| Kreator | `/kreators/*` | `kreators/README.md` |
| Auth | `/auth/*` | `auth/README.md` |
| AI wrappers | `/gptActions/*` | `ai/README.md` |
| Docs | `/docs/*` | `core/README.md` |

## Store Critical Routes

- `POST /createPaymentIntent`
- `POST /createPaymentIntent/tax`
- `POST /createPaymentIntent/updateEmail`
- `POST /createPaymentIntent/webhook`
- `GET /admin/listOrders`
- `GET /admin/getOrder`
- `POST /admin/updateOrderStatus`
- `POST /admin/orders/delay-notice`
- `GET /admin/products`
- `PATCH /admin/products/:id`

The webhook mount must keep raw-body parsing.

## Paddling Out Critical Routes

- `GET /paddlingOut`
- `GET /paddlingOut/:id`
- `GET /paddlingOut/geocode`
- `POST /paddlingOut/submitEntry`
- `GET /paddlingOut/admin/submissions`
- `POST /paddlingOut/admin/submissions/:id/validate`
- `POST /paddlingOut/admin/submissions/:id/reject`
- `GET /nearbyWater`
- `GET /paddleScore`
- `POST /paddleScore/publicRating`
- `POST /paddleScore/batch`
- `GET /fastForecast`

Trainer currently has only partial backend route coverage.

## Verification

Run focused tests, not the entire world, unless the change crosses product boundaries.

Store critical path:

- `store-api.test.js`
- `checkout-payment-intent.test.js`
- `checkout-webhook.test.js`
- `checkout-tax.test.js`
- `checkout-refunds-disputes.test.js`
- `order-fulfilment.test.js`
- `order-delay-notice.test.js`
- `mail-sender.test.js`
- `order-retention.test.js`
- `admin-products.test.js`
- `auth-platform-admin.test.js`

Paddling Out:

- `paddlingout-submit.test.js`
- `weather-paddle-score.test.js`

