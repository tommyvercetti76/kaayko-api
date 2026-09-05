# Kaayko API Documentation

Last reviewed: 2026-09-05

This directory contains maintained backend documentation for `kaayko-api`. Runtime truth comes from `functions/index.js` and the route files it mounts.

## Start Here

- [`products/README.md`](./products/README.md) - product-level backend map.
- [`functions/api/README.md`](../functions/api/README.md) - mounted API module map.
- [`products/STORE.md`](./products/STORE.md) - store checkout, admin fulfillment, mail, refunds, disputes, and launch blockers.
- [`products/PADDLING_OUT.md`](./products/PADDLING_OUT.md) - Paddling Out routes, submissions, scoring, forecast, search, and trainer gaps.
- [`ORDER_TRACKING_SYSTEM.md`](./ORDER_TRACKING_SYSTEM.md) - current order lifecycle and fulfillment runbook.
- [`ORDER_DATA_STRUCTURE.md`](./ORDER_DATA_STRUCTURE.md) - current Firestore order/payment schema.
- [`DATA_RETENTION.md`](./DATA_RETENTION.md) - store PII retention and mail/event cleanup.
- [`SALES_TAX.md`](./SALES_TAX.md) - Stripe Tax behavior.

## Current Critical Notes

- Store checkout is architecturally complete in tests, but live real-money launch is blocked until legal placeholders, live Stripe config, SMTP verification, and mail retry/alerting are resolved.
- Paddling Out public directory/forecast/search APIs are live, but Add Lake copy and Rate/trainer routing need product cleanup.
- The old Stripe email/setup guides were removed because they referenced the retired `order-confirmation.html` flow and pre-webhook checkout assumptions. Use `functions/api/checkout/README.md` and `docs/products/STORE.md` instead.

## Tests To Know

Store/checkout critical path:

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

## Obsolete Docs Removed

- `docs/STRIPE_EMAIL_SETUP_GUIDE.md`
- `functions/api/checkout/STRIPE_SETUP_GUIDE.md`

Those were superseded by current checkout docs and contained stale file paths, old contact addresses, and future-work items that are now implemented.

