# Store Order Data Structure

Last reviewed: 2026-09-05

This document describes the current Firestore structure for kaay.store payment, order, mail, and event records.

## Collections

### `payment_intents/{paymentIntentId}`

Order-level Stripe PaymentIntent record.

Important fields:

- `paymentIntentId`
- `status`: `created`, `succeeded`, `failed`, `refunded`, `partially_refunded`, `disputed`, `dispute_lost`
- `paymentStatus`: `pending`, `paid`, `failed`, `refunded`, `partially_refunded`, `disputed`, `dispute_lost`
- `fulfillmentStatus`: `awaiting_payment`, `processing`, `ready_to_ship`, `shipped`, `delivered`, `cancelled`
- `currency`
- `subtotalCents`
- `taxCents`
- `totalCents`
- `refundedCents`
- `items[]`: server-priced line items
- `customerEmail`
- `customerPhone`
- `customerName`
- `shippingAddress`
- `shippingAddressMissing`
- `stripeCustomerId`
- `paymentMethod`
- `chargeId`
- `taxCalculationId`
- `taxTransactionId`
- `statusHistory[]`
- `delayNotices[]`
- `piiRedacted`
- `createdAt`, `updatedAt`, `paidAt`, `fulfilledAt`, `cancelledAt`

### `orders/{paymentIntentId}_itemN`

One fulfillment record per line item. These are written by the Stripe webhook after payment succeeds.

Important fields:

- `orderId`
- `parentOrderId`
- `itemIndex`
- `totalItems`
- `productId`
- `productTitle`
- `size`
- `gender`
- `quantity`
- `unitPriceCents`
- `lineTotalCents`
- `currency`
- `orderStatus`: `pending`, `processing`, `shipped`, `delivered`, `returned`, `cancelled`
- `fulfillmentStatus`
- `paymentStatus`
- `refundedCents`
- `shippingAddress`
- `shippingAddressMissing`
- `customerEmail`
- `customerPhone`
- `customerName`
- `trackingNumber`
- `carrier`
- `trackingUrl`
- `estimatedDelivery`
- `statusHistory[]`
- `piiRedacted`
- `createdAt`, `updatedAt`, `paidAt`, `processedAt`, `shippedAt`, `deliveredAt`, `returnedAt`

### `mail/{mailId}`

Outbound email queue documents for buyer receipts, admin receipts, shipping notices, delay notices, refunds, disputes, and owner alerts.

Important fields:

- `to`
- `subject`
- `html`
- `text`
- `delivery.state`: `PENDING`, `PROCESSING`, `SUCCESS`, `RETRY`, `ERROR`
- `delivery.attempts`
- `delivery.lastError`
- `paymentIntentId`
- `orderId`
- `createdAt`, `updatedAt`, `sentAt`

Mail docs may contain buyer PII and must not be exposed to the client.

### `stripe_events/{eventId}`

Webhook duplicate-suppression and processing audit records.

### `webhook_failures/{eventId}`

Permanent webhook failure triage records. These should be owner/admin visible operationally, not public.

### `retention_runs/{yyyy-mm-dd}`

Monthly retention job summaries.

## Write Ownership

- `payment_intents`: checkout create/tax/contact update and Stripe webhook.
- `orders`: Stripe webhook and admin fulfillment endpoints.
- `mail`: email queue helpers, webhook handlers, admin status/delay handlers.
- `stripe_events`: Stripe webhook.
- `webhook_failures`: Stripe webhook permanent failure handler.
- `retention_runs`: scheduled retention job.

Direct browser writes are not allowed.

## Query Patterns

- Admin order list: `orders` ordered by `createdAt`, optionally grouped by `parentOrderId`.
- Whole-order fulfillment: update all `orders` with matching `parentOrderId`.
- Order detail: `orders.where(parentOrderId == pi)` plus `payment_intents/{pi}`.
- Retention: age-based scans by `createdAt` or `processedAt`.

## Rules That Must Not Change Casually

- Do not create shippable order docs before Stripe confirms payment.
- Do not trust client prices.
- Do not store multiple purchased line items as a comma-separated string.
- Do not delete order/payment financial records during retention; redact PII instead.
- Do not expose `orders`, `payment_intents`, `mail`, `stripe_events`, or `webhook_failures` to client reads.

