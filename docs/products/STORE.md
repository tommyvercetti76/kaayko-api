# Store Backend Product Map

Last reviewed: 2026-09-05

The Store backend supports kaay.store browsing, server-priced Stripe checkout, tax, webhook-created order records, email notifications, admin fulfillment, refunds, disputes, product administration, and retention.

## Runtime Mounts

Mounted in `functions/index.js`:

- `GET /products`
- `GET /products/:id`
- `POST /products/:id/vote`
- `GET /images/health`
- `GET /images`
- `GET /images/:productId/:fileName`
- `POST /createPaymentIntent`
- `POST /createPaymentIntent/tax`
- `POST /createPaymentIntent/updateEmail`
- `POST /createPaymentIntent/webhook`
- `GET /admin/getOrder`
- `GET /admin/listOrders`
- `POST /admin/updateOrderStatus`
- `POST /admin/orders/delay-notice`
- `GET /admin/products`
- `PATCH /admin/products/:id`

## Primary Files

- `functions/api/products/products.js`
- `functions/api/products/images.js`
- `functions/api/checkout/router.js`
- `functions/api/checkout/createPaymentIntent.js`
- `functions/api/checkout/pricing.js`
- `functions/api/checkout/tax.js`
- `functions/api/checkout/updatePaymentIntentEmail.js`
- `functions/api/checkout/stripeWebhook.js`
- `functions/api/admin/getOrder.js`
- `functions/api/admin/updateOrderStatus.js`
- `functions/api/admin/orderNotices.js`
- `functions/api/admin/products.js`
- `functions/triggers/mailSender.js`
- `functions/scheduled/orderRetention.js`

## Security Model

- Product list/detail/vote are public.
- Checkout create/tax/updateEmail are public but protected by origin checks and strict input validation.
- Stripe webhook verifies Stripe signature and must receive the raw body before JSON parsing.
- Admin order/product routes require Firebase auth plus platform-admin authorization.
- Firestore rules deny direct client reads/writes to products, orders, payment intents, Stripe events, webhook failures, and mail docs.
- Prices are server-authoritative. Client price fields are ignored.

## Purchase And Fulfillment Flow

1. Buyer adds product to cart in frontend.
2. Cart posts product id, size, gender, and quantity to `/createPaymentIntent`.
3. Backend loads products from Firestore, validates availability/options/quantity, and computes subtotal.
4. Backend creates a Stripe PaymentIntent and `payment_intents/{pi}` with status `created`.
5. Cart collects shipping address and calls `/createPaymentIntent/tax` if tax is enabled.
6. Cart posts contact details to `/createPaymentIntent/updateEmail`.
7. Stripe confirms payment and redirects buyer to `/order-success`.
8. Webhook handles `payment_intent.succeeded`, updates `payment_intents/{pi}`, writes `orders/{pi}_itemN`, and queues buyer/admin mail.
9. `mailSender` sends Firestore `mail/{id}` docs through SMTP.
10. Admin fulfills in Kortex Orders via `/admin/listOrders` and `/admin/updateOrderStatus`.
11. Shipping confirmation is queued once when an order is marked shipped.
12. Refund and dispute webhooks update money/fulfillment state and alert the owner.

## Launch Blockers

- Frontend currently exposes a Stripe `pk_test` key. Do not accept real purchases until matching live frontend/backend/webhook/tax config is provided.
- `kaayko/src/legal/terms.html` still needs real legal operator details.
- `MAIL_SMTP_URL` deployment must be verified.
- Mail docs in `RETRY` need a scheduled redrive or admin alert.
- Buyer-facing support/contact email must be normalized.
- Admin delay notice UI currently needs response-shape alignment with `orderNotices.js`.

## Tests

Run from `functions/`:

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

The September audit run passed 11 suites and 248 tests.

## Related Docs

- `docs/ORDER_TRACKING_SYSTEM.md`
- `docs/ORDER_DATA_STRUCTURE.md`
- `docs/DATA_RETENTION.md`
- `docs/SALES_TAX.md`
- `functions/api/checkout/README.md`

