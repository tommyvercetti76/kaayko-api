# Store Order Tracking And Fulfillment

Last reviewed: 2026-09-05

This is the current lifecycle model for kaay.store orders, from PaymentIntent creation through fulfillment, refunds, disputes, and retention.

## Statuses

### PaymentIntent status fields

- `status`: lifecycle marker from checkout/webhook.
- `paymentStatus`: money state.
- `fulfillmentStatus`: operational state for the order as a whole.

Common `paymentStatus` values:

- `pending`
- `paid`
- `failed`
- `refunded`
- `partially_refunded`
- `disputed`
- `dispute_lost`

Common `fulfillmentStatus` values:

- `awaiting_payment`
- `processing`
- `ready_to_ship`
- `shipped`
- `delivered`
- `cancelled`

### Order item status fields

`orderStatus`:

- `pending`
- `processing`
- `shipped`
- `delivered`
- `returned`
- `cancelled`

`fulfillmentStatus` mirrors the operational state and is used by admin workflows.

## Current Purchase Lifecycle

1. `/createPaymentIntent` validates the cart and creates Stripe PaymentIntent plus `payment_intents/{pi}`.
2. `/createPaymentIntent/tax` applies tax when Stripe Tax is enabled.
3. `/createPaymentIntent/updateEmail` stores buyer contact details on the PaymentIntent.
4. Stripe confirms payment in the browser and redirects to `/order-success`.
5. `/createPaymentIntent/webhook` handles `payment_intent.succeeded`.
6. Webhook writes one `orders/{pi}_itemN` document per line item.
7. Webhook queues:
   - `mail/{pi}_customer`
   - `mail/{pi}_admin`
8. Kortex Orders reads `GET /admin/listOrders?groupByOrder=true`.
9. Admin marks the whole order processing/shipped/delivered/returned/cancelled with `/admin/updateOrderStatus`.
10. Marking shipped queues a deterministic shipping confirmation email.

## Admin Fulfillment

Frontend:

- `kaayko/src/admin/kortex.html`
- `kaayko/src/admin/views/orders/orders.js`

Backend:

- `GET /admin/listOrders`
- `GET /admin/getOrder`
- `POST /admin/updateOrderStatus`
- `POST /admin/orders/delay-notice`

Security:

- All store admin routes require Firebase auth plus platform-admin authorization.
- X-Admin-Key alone is not enough for store admin routes mounted in `functions/index.js`.

## Shipping

When admin marks an order shipped:

- all matching line-item docs can be updated by `parentOrderId`;
- tracking number, carrier, tracking URL, shipped timestamp, and history are saved;
- `payment_intents/{pi}` is updated when all line items share the shipped status;
- customer shipping confirmation mail is queued once.

Supported carrier tracking URL generation:

- USPS
- UPS
- FedEx
- DHL

If the webhook could not resolve a shipping address, order docs carry `shippingAddressMissing: true`. Kortex should not allow "Mark shipped" for those orders.

## Delay Notices

Endpoint:

```text
POST /api/admin/orders/delay-notice
```

Body:

```json
{
  "parentOrderId": "pi_...",
  "newEstimatedDate": "2026-10-06",
  "reason": "Blank stock arrived late"
}
```

Current backend returns top-level `queued`, `mailId`, and related fields. Frontend must read that actual response shape or backend must also return `customerNotification`.

The notice email tells the buyer:

- the original shipping promise;
- the new expected ship date;
- how to cancel for a full refund if they do not want to wait.

Cancellation and refund are still manual in Stripe; refund webhooks record the money movement.

## Refunds And Disputes

Webhook events:

- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.closed`

Expected behavior:

- Full refund on an unshipped order cancels fulfillment.
- Partial refund records order-level and per-line-item refunded cents.
- Dispute opened marks payment/order state as disputed and alerts owner.
- Dispute closed maps outcome back to paid/refunded/dispute_lost as appropriate.
- Refund/dispute alerts are queued to owner/admin mail.

## Operational Gaps

- Mail documents in `RETRY` do not currently have a scheduled redrive documented as deployed.
- There should be a visible admin/ops indicator for mail `ERROR` and stale `RETRY`.
- Inventory decrement is not currently part of the successful-payment flow.
- Legal and live Stripe setup are owner-required launch gates, not code-only tasks.

## Tests

Use:

- `checkout-webhook.test.js`
- `checkout-refunds-disputes.test.js`
- `order-fulfilment.test.js`
- `order-delay-notice.test.js`
- `mail-sender.test.js`
- `order-retention.test.js`

These are the tests to run after touching webhook, fulfillment, mail, delay, refund, dispute, or retention behavior.

