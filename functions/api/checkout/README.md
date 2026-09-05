# Checkout API

Last reviewed: 2026-09-05

This module powers kaay.store checkout, Stripe PaymentIntent creation, tax, contact updates, webhook order creation, buyer/admin mail, refunds, and disputes.

## Routes

Mounted in `functions/index.js`:

- `POST /createPaymentIntent`
- `POST /createPaymentIntent/tax`
- `POST /createPaymentIntent/updateEmail`
- `POST /createPaymentIntent/webhook`

The webhook must be mounted with `express.raw({ type: 'application/json' })` before global JSON parsing.

## Files

- `router.js`
- `createPaymentIntent.js`
- `pricing.js`
- `tax.js`
- `updatePaymentIntentEmail.js`
- `stripeWebhook.js`

Related:

- `../admin/getOrder.js`
- `../admin/updateOrderStatus.js`
- `../admin/orderNotices.js`
- `../../triggers/mailSender.js`
- `../../scheduled/orderRetention.js`

## Checkout Flow

1. Browser posts cart line items to `/createPaymentIntent`.
2. `pricing.js` loads products from Firestore and computes authoritative totals.
3. `createPaymentIntent.js` creates Stripe PaymentIntent and writes `payment_intents/{pi}`.
4. Browser collects shipping address and calls `/createPaymentIntent/tax` when tax is enabled.
5. Browser posts buyer contact to `/createPaymentIntent/updateEmail`.
6. Stripe confirms payment and redirects to `/order-success`.
7. Stripe sends webhook to `/createPaymentIntent/webhook`.
8. Webhook writes one `orders/{pi}_itemN` doc per line item and queues buyer/admin mail.

## Security Rules

- Restrict checkout origins to configured Kaayko/store origins.
- Never trust client prices.
- Validate product availability, size, gender, quantity, line count, and total amount.
- Webhook signature verification is required.
- Webhook is the only creator of paid order docs.

## Stripe Environment Rules

- Test frontend key must pair with test backend secret and test webhook secret.
- Live frontend key must pair with live backend secret and live webhook secret.
- Do not mix modes.
- Do not switch to live mode until legal, SMTP, tax, and owner approval are complete.

Required secrets:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `MAIL_SMTP_URL`

## Mail

Webhook queues:

- customer receipt
- admin new-order notification
- refund/dispute owner alerts when applicable

Admin fulfillment queues:

- shipping confirmation
- delay notice

Mail delivery is handled by `functions/triggers/mailSender.js`. Stale `RETRY`/`ERROR` mail docs need operational alerting or redrive before real-money launch.

## Refunds And Disputes

Handled webhook events:

- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.closed`

Refunds and disputes update `payment_intents` and `orders`. Full unshipped refunds should cancel fulfillment.

## Tests

Run the relevant focused suite:

```bash
node ./node_modules/jest/bin/jest.js --runInBand \
  __tests__/checkout-payment-intent.test.js \
  __tests__/checkout-webhook.test.js \
  __tests__/checkout-tax.test.js \
  __tests__/checkout-refunds-disputes.test.js \
  __tests__/order-fulfilment.test.js \
  __tests__/order-delay-notice.test.js \
  __tests__/mail-sender.test.js \
  __tests__/order-retention.test.js \
  --forceExit --detectOpenHandles
```

