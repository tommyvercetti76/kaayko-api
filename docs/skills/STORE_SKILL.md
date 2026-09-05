---
description: Use when working on the Kaayko Store backend: product catalog, image proxy, Stripe checkout, tax, payment intents, webhooks, mail, order fulfillment, admin products, refunds, disputes, or retention.
---

# Store Backend Runbook

Last reviewed: 2026-09-05

## Read First

- `docs/products/STORE.md`
- `docs/ORDER_TRACKING_SYSTEM.md`
- `docs/ORDER_DATA_STRUCTURE.md`
- `docs/DATA_RETENTION.md`
- `functions/api/checkout/README.md`

## Core Rules

- Runtime truth is `functions/index.js`.
- Stripe webhook must remain mounted with `express.raw({ type: 'application/json' })` before `express.json()`.
- Client prices are never authoritative.
- Store admin endpoints require Firebase auth plus platform-admin checks.
- Do not expose `orders`, `payment_intents`, `mail`, `stripe_events`, or `webhook_failures` to browser reads.
- Do not switch live/test Stripe modes unless frontend key, backend secret, webhook secret, tax mode, and dashboard webhook destination are all known and matching.

## Main Routes

Public:

- `GET /products`
- `GET /products/:id`
- `POST /products/:id/vote`
- `GET /images/:productId/:fileName`
- `POST /createPaymentIntent`
- `POST /createPaymentIntent/tax`
- `POST /createPaymentIntent/updateEmail`
- `POST /createPaymentIntent/webhook`

Admin:

- `GET /admin/getOrder`
- `GET /admin/listOrders`
- `POST /admin/updateOrderStatus`
- `POST /admin/orders/delay-notice`
- `GET /admin/products`
- `PATCH /admin/products/:id`

## Before Editing

- Check the matching frontend file in `kaayko` if UI behavior changes.
- Check focused tests in `functions/__tests__`.
- Keep edits narrow and avoid unrelated KORTEX/Kreator changes.

## Verification

Critical store suite:

```bash
node ./node_modules/jest/bin/jest.js --runInBand \
  __tests__/store-api.test.js \
  __tests__/checkout-payment-intent.test.js \
  __tests__/checkout-webhook.test.js \
  __tests__/checkout-tax.test.js \
  __tests__/checkout-refunds-disputes.test.js \
  __tests__/order-fulfilment.test.js \
  __tests__/order-delay-notice.test.js \
  __tests__/mail-sender.test.js \
  __tests__/order-retention.test.js \
  __tests__/admin-products.test.js \
  __tests__/auth-platform-admin.test.js \
  --forceExit --detectOpenHandles
```

Run the narrowest subset during iteration, then this focused suite before handoff.

