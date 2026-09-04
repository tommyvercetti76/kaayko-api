# Order Tracking System

## Overview
Comprehensive order lifecycle tracking from payment creation to delivery/return.

---

## Status Flow

### Payment Intent Statuses
```
created → pending → succeeded → fulfilled/cancelled
```

- **created**: Payment intent created, awaiting customer action
- **pending**: Customer initiated payment
- **succeeded**: Payment successful, order processing
- **fulfilled**: All items delivered
- **cancelled**: Payment failed or cancelled

### Order Item Statuses (Individual Products)
```
pending → processing → shipped → delivered → returned
```

**orderStatus**:
- `pending`: Order paid, awaiting fulfillment
- `processing`: Being prepared for shipment
- `shipped`: Package in transit
- `delivered`: Successfully delivered
- `returned`: Customer initiated return

**fulfillmentStatus**:
- `awaiting_payment`: Waiting for payment
- `processing`: Preparing order
- `ready_to_ship`: Ready for carrier pickup
- `shipped`: In transit
- `delivered`: Delivered to customer
- `cancelled`: Order cancelled

**paymentStatus**:
- `pending`: Payment not yet received
- `paid`: Payment successful
- `failed`: Payment failed
- `refunded`: Full refund issued (`charge.refunded`, or a dispute closed as `charge_refunded`)
- `partially_refunded`: Partial refund issued
- `disputed`: A chargeback is open (`charge.dispute.created`); funds withheld
- `dispute_lost`: The chargeback was lost (`charge.dispute.closed` with status `lost`)

A dispute closed as `won` or `warning_closed` restores `paid`.

---

## Data Structure

### payment_intents Collection
```javascript
{
  // Identity
  paymentIntentId: "pi_3SbV0KGhBi2rBXlY0u9Gn5PY",
  
  // Payment details
  totalAmount: 5998,
  totalAmountFormatted: "$59.98",
  currency: "usd",
  itemCount: 2,
  
  // Lifecycle tracking
  status: "succeeded",
  paymentStatus: "succeeded",
  fulfillmentStatus: "processing",
  
  // Timestamps
  createdAt: Timestamp,
  updatedAt: Timestamp,
  paidAt: "2025-12-06T17:35:08.000Z",
  fulfilledAt: null,
  cancelledAt: null,
  
  // Items array
  items: [
    {
      productId: "ANYtm2qPfhsgwb2oAuz6",
      productTitle: "Stay Hydrated",
      size: "M",
      gender: "Female",
      price: "$29.99",
      priceInCents: 2999
    },
    {
      productId: "LY46yu4JYwulIRmSAEg3",
      productTitle: "No running your..",
      size: "S",
      gender: "Female",
      price: "$29.99",
      priceInCents: 2999
    }
  ],
  
  // Customer info
  customerEmail: "rohan@kaayko.com",
  customerPhone: "+1234567890",
  dataRetentionConsent: true,
  
  // Audit trail
  statusHistory: [
    {
      status: "created",
      timestamp: "2025-12-06T17:35:08.000Z",
      note: "Payment intent created"
    },
    {
      status: "succeeded",
      timestamp: "2025-12-06T17:36:15.000Z",
      note: "Payment successful"
    }
  ]
}
```

### orders Collection (Separate Document Per Item)
```javascript
{
  // Identity
  orderId: "pi_3SbV0KGhBi2rBXlY0u9Gn5PY_item1",
  parentOrderId: "pi_3SbV0KGhBi2rBXlY0u9Gn5PY",
  itemIndex: 1,
  totalItems: 2,
  
  // Product details
  productId: "ANYtm2qPfhsgwb2oAuz6",
  productTitle: "Stay Hydrated",
  size: "M",
  gender: "Female",
  price: "$29.99",
  
  // Order tracking
  orderStatus: "processing",
  fulfillmentStatus: "processing",
  paymentStatus: "paid",
  
  // Timestamps
  createdAt: "2025-12-06T17:35:08.000Z",
  updatedAt: "2025-12-06T17:36:15.000Z",
  paidAt: "2025-12-06T17:36:15.000Z",
  processedAt: null,
  shippedAt: null,
  deliveredAt: null,
  returnedAt: null,
  
  // Shipping info
  shippingAddress: {
    name: "Rohan Karanam",
    line1: "123 Main St",
    line2: "Apt 4B",
    city: "San Francisco",
    state: "CA",
    postal_code: "94102",
    country: "US"
  },
  
  // Tracking
  trackingNumber: "1Z999AA10123456784",
  carrier: "UPS",
  trackingUrl: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
  estimatedDelivery: "2025-12-10",
  
  // Contact
  customerEmail: "rohan@kaayko.com",
  customerPhone: "+1234567890",
  
  // Privacy
  dataRetentionConsent: true,
  
  // Payment method
  paymentMethod: "card",
  totalAmount: 5998,
  currency: "usd",
  
  // Status history (audit trail)
  statusHistory: [
    {
      status: "pending",
      timestamp: "2025-12-06T17:35:08.000Z",
      note: "Order created"
    },
    {
      status: "paid",
      timestamp: "2025-12-06T17:36:15.000Z",
      note: "Payment successful"
    },
    {
      status: "processing",
      timestamp: "2025-12-06T17:36:15.000Z",
      note: "Order processing started"
    }
  ],
  
  // Notes
  internalNotes: [],
  customerNotes: null
}
```

---

## API Endpoints

### 1. Update Order Status (Admin)
**POST** `/api/admin/updateOrderStatus`

**Body**:
```json
{
  "orderId": "pi_3SbV0KGhBi2rBXlY0u9Gn5PY_item1",
  "orderStatus": "shipped",
  "fulfillmentStatus": "shipped",
  "trackingNumber": "1Z999AA10123456784",
  "carrier": "UPS",
  "estimatedDelivery": "2025-12-10",
  "internalNote": "Shipped via UPS Ground",
  "customerNote": "Your order has been shipped!"
}
```

**Response**:
```json
{
  "success": true,
  "orderId": "pi_3SbV0KGhBi2rBXlY0u9Gn5PY_item1",
  "updates": {
    "orderStatus": "shipped",
    "shippedAt": "2025-12-06T18:00:00.000Z",
    "trackingNumber": "1Z999AA10123456784",
    "carrier": "UPS",
    "trackingUrl": "https://www.ups.com/track?tracknum=1Z999AA10123456784"
  }
}
```

**Supported Carriers**:
- USPS → https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking}
- UPS → https://www.ups.com/track?tracknum={tracking}
- FedEx → https://www.fedex.com/fedextrack/?trknbr={tracking}
- DHL → https://www.dhl.com/en/express/tracking.html?AWB={tracking}

---

### 2. Get Order Details
**GET** `/api/admin/getOrder?orderId={orderId}`

Get single order item.

**GET** `/api/admin/getOrder?parentOrderId={paymentIntentId}`

Get all items from same payment (with payment intent details).

**Response**:
```json
{
  "success": true,
  "paymentIntent": { /* payment_intents document */ },
  "orders": [
    { /* order item 1 */ },
    { /* order item 2 */ }
  ],
  "totalItems": 2
}
```

---

### 3. List Orders (Admin)
**GET** `/api/admin/listOrders?orderStatus=processing&limit=50`

**Query Parameters**:
- `orderStatus`: Filter by order status
- `fulfillmentStatus`: Filter by fulfillment status
- `paymentStatus`: Filter by payment status
- `limit`: Results per page (default: 50)
- `startAfter`: Order ID for pagination

**Response**:
```json
{
  "success": true,
  "orders": [ /* array of orders */ ],
  "count": 50,
  "hasMore": true
}
```

---

## Status Update Workflow

### When Order is Shipped
```bash
curl -X POST https://api-vwcc5j4qda-uc.a.run.app/admin/updateOrderStatus \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "pi_xxx_item1",
    "orderStatus": "shipped",
    "fulfillmentStatus": "shipped",
    "trackingNumber": "1Z999AA10123456784",
    "carrier": "UPS",
    "estimatedDelivery": "2025-12-10",
    "internalNote": "Shipped via UPS Ground"
  }'
```

This will:
1. Update `orderStatus` to `shipped`
2. Set `shippedAt` timestamp
3. Add tracking number & generate tracking URL
4. Add entry to `statusHistory`
5. Add internal note
6. If all items in parent order are shipped, update `payment_intents` status

### When Order is Delivered
```bash
curl -X POST https://api-vwcc5j4qda-uc.a.run.app/admin/updateOrderStatus \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "pi_xxx_item1",
    "orderStatus": "delivered",
    "fulfillmentStatus": "delivered"
  }'
```

This will:
1. Update `orderStatus` to `delivered`
2. Set `deliveredAt` timestamp
3. Add entry to `statusHistory`
4. If all items delivered, mark parent `payment_intents` as `fulfilled`

---

## Query Examples

### Get All Pending Orders
```javascript
const pendingOrders = await db.collection('orders')
  .where('orderStatus', '==', 'pending')
  .orderBy('createdAt', 'desc')
  .get();
```

### Get Orders Ready to Ship
```javascript
const readyToShip = await db.collection('orders')
  .where('fulfillmentStatus', '==', 'ready_to_ship')
  .get();
```

### Get All Orders from Same Payment
```javascript
const allItems = await db.collection('orders')
  .where('parentOrderId', '==', 'pi_3SbV0KGhBi2rBXlY0u9Gn5PY')
  .orderBy('itemIndex', 'asc')
  .get();
```

### Get Orders by Customer Email
```javascript
const customerOrders = await db.collection('orders')
  .where('customerEmail', '==', 'rohan@kaayko.com')
  .orderBy('createdAt', 'desc')
  .get();
```

### Get Unfulfilled Orders
```javascript
const unfulfilled = await db.collection('orders')
  .where('orderStatus', 'in', ['pending', 'processing', 'shipped'])
  .get();
```

---

## Frontend Integration

### Customer Order Tracking Page
```javascript
// Fetch order status by parentOrderId (from email link)
const response = await fetch(
  `${API_URL}/admin/getOrder?parentOrderId=${orderId}`
);
const { paymentIntent, orders } = await response.json();

// Display:
// - Payment status
// - Each item with individual tracking
// - Shipping address
// - Status history timeline
```

### Admin Dashboard
```javascript
// List orders needing fulfillment
const response = await fetch(
  `${API_URL}/admin/listOrders?orderStatus=pending&limit=100`
);
const { orders } = await response.json();

// Update order when shipped
await fetch(`${API_URL}/admin/updateOrderStatus`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    orderId: order.orderId,
    orderStatus: 'shipped',
    trackingNumber: '1Z999AA10123456784',
    carrier: 'UPS'
  })
});
```

---

## Email Notifications

Queued as documents in the Firestore `mail` collection and delivered by the
in-repo `mailSender` trigger (`functions/triggers/mailSender.js`) — see
`STRIPE_EMAIL_SETUP_GUIDE.md` for the one secret it needs:

### Order Confirmation Email
- Sent when: `paymentStatus` = `succeeded`
- Includes: Order summary, items, total, shipping address
- Template: `order_confirmation`

### Shipping Notification Email
- Sent when: `orderStatus` = `shipped`
- Includes: Tracking number, tracking URL, estimated delivery
- Template: `order_shipped`

### Delivery Confirmation Email
- Sent when: `orderStatus` = `delivered`
- Includes: Delivery confirmation, request feedback
- Template: `order_delivered`

---

## Security & Privacy

### Data Retention
- If `dataRetentionConsent` = `false`:
  - Store only shipping address (needed for fulfillment)
  - Email/phone cleared after 30 days
  - Keep anonymized analytics only

- If `dataRetentionConsent` = `true`:
  - Store email/phone permanently
  - Enable customer account creation
  - Send marketing emails (with unsubscribe)

### Admin Access Control
TODO: Add authentication middleware to admin endpoints
- Require Firebase Auth token
- Check custom claims for `admin: true`
- Log all admin actions

---

## Next Steps

1. ✅ Implement order tracking structure
2. ✅ Create admin update endpoints
3. ✅ Add comprehensive status history
4. ⏳ Add authentication to admin endpoints
5. ⏳ Build admin dashboard UI
6. ⏳ Build customer order tracking page
7. ✅ Email delivery — `mailSender` trigger over SMTP (`MAIL_SMTP_URL` secret)
8. ✅ Automated email triggers — confirmation, shipping, delay notice, refund/dispute alerts
9. ✅ Refund / chargeback bookkeeping (`charge.refunded`, `charge.dispute.*`); returns intake still manual
10. ⏳ Integrate with shipping label APIs (ShipStation, EasyPost)

---

## Fulfilment cycle — how the owner actually works an order (Sep 2026)

**Prerequisite:** the `MAIL_SMTP_URL` secret must be set and the `mailSender`
function deployed, or the emails below sit in the `mail` collection with
`delivery.state = ERROR` ("secret is not set"). See the banner at the top of
`STRIPE_EMAIL_SETUP_GUIDE.md`. Do NOT also install the `firestore-send-email`
extension — mail would go out twice.

### 1. See what to ship
```
GET /api/admin/listOrders?orderStatus=pending&groupByOrder=true
```
Returns one **shipment** per payment intent — customer email, shipping address,
every line item (product, gender, size, quantity), the order total, and
`shippingAddressMissing` for orders that cannot be shipped as recorded.
Without `groupByOrder` the flat per-line-item list is returned as before.

`GET /api/admin/getOrder?parentOrderId=pi_…` gives the same order in full,
including the `payment_intents` record.

### 2. Mark it shipped
```
POST /api/admin/updateOrderStatus
{ "parentOrderId": "pi_…", "orderStatus": "shipped",
  "trackingNumber": "9400…", "carrier": "USPS",
  "estimatedDelivery": "2026-09-09" }
```
* `parentOrderId` updates **every** line item of the order; `orderId` updates a
  single item (partial shipment).
* `orderStatus` / `fulfillmentStatus` are validated against the vocabularies
  above — an invalid value is a 400, not a silently written document.
* Carrier is turned into a tracking URL for USPS / UPS / FedEx / DHL.
* The customer is emailed the tracking number, once, keyed `mail/{pi}_shipped`.
  Pass `"notifyCustomer": false` to suppress that.
* The parent `payment_intents` doc rolls forward only when **all** line items
  share the new status.

### 3. Mark it delivered
Same call with `"orderStatus": "delivered"` — sets `deliveredAt` and
`fulfilledAt` on the parent. No customer email is sent for delivery.

### Owner notifications
| Event | Mail doc id | Goes to |
|---|---|---|
| Payment succeeded | `{pi}_admin` | `ORDER_NOTIFY_EMAIL` |
| Payment failed | `{pi}_failed` | `ORDER_NOTIFY_EMAIL` |
| Unprocessable webhook (`webhook_failures`) | `{eventId}_webhook_failure` | `ORDER_NOTIFY_EMAIL` |
| Refund, full or partial | `{pi}_refund_{cumulativeRefundedCents}` | `ORDER_NOTIFY_EMAIL` |
| Chargeback opened | `{pi}_dispute_{disputeId}` | `ORDER_NOTIFY_EMAIL` |
| Chargeback closed | `{pi}_dispute_{disputeId}_closed` | `ORDER_NOTIFY_EMAIL` |
| Order confirmation | `{pi}_customer` | buyer |
| Shipping confirmation | `{pi}_shipped` | buyer |
| Delay notice (FTC) | `{pi}_delay_{YYYYMMDD}` | buyer |

`ORDER_NOTIFY_EMAIL` (functions/.env) → `metadata.notifyEmail` →
`rohanramekar17@gmail.com`. Every mail id is deterministic, so no event replay
or double-click can send the same email twice.

### Shipping address
`shippingAddress` is resolved from, in order: `payment_intent.shipping`,
`payment_intent.collected_information.shipping_details` (2025+ API versions),
`latest_charge.shipping`, `charges.data[0].shipping`, the stored
`payment_intents` doc, and finally a re-read of the PaymentIntent from Stripe
with `latest_charge` expanded. The winning source is recorded on the order as
`shippingSource`, and `shippingAddressMissing: true` marks an order nobody can
ship.

### Refunds and chargebacks (Sep 2026)
The store webhook also handles the events that move money back. Each one
updates `payment_intents/{pi}` and every `orders/{pi}_item*` document, appends
a `statusHistory` entry (timestamped from Stripe, so a replay unions instead of
duplicating), records the Stripe event id in `stripe_events`, and alerts the
owner once. `chargeId` is stored on both records at payment time so a Charge
or Dispute is matched to its order without a Stripe lookup.

| Event | Effect |
|---|---|
| `charge.refunded` (full) | `paymentStatus: refunded`, `refundedCents`, `refundedAt`. An order that has not shipped is also cancelled (`orderStatus`/`fulfillmentStatus: cancelled`) so it does not get packed. A shipped one is left for the owner to mark `returned`. |
| `charge.refunded` (partial) | `paymentStatus: partially_refunded`, cumulative `refundedCents`; fulfilment untouched. |
| `charge.dispute.created` | `paymentStatus: disputed`, `disputeId`, `disputeReason`, `disputeStatus`, `disputeDeadline` (evidence due), `disputeAmountCents`. Fulfilment untouched — the alert says not to ship. |
| `charge.dispute.closed` | `disputeOutcome` = `won` / `lost` / `warning_closed` / `charge_refunded`; `paymentStatus` becomes `paid`, `dispute_lost`, `paid`, `refunded` respectively. |

Per-item `refundedCents` is a **pro-rata share** of the order-level refund
(Stripe refunds carry no line items), capped at each line total, so
`SUM(lineTotalCents − refundedCents)` over `orders` is still net revenue. The
authoritative figure is `payment_intents.refundedCents`. A refund or dispute on
a charge with no `payment_intents` record (a Kortex subscription on the same
Stripe account) is acknowledged and ignored — disputes still alert the owner.

The Stripe endpoint must subscribe to `charge.refunded`,
`charge.dispute.created` and `charge.dispute.closed` — see
`STRIPE_EMAIL_SETUP_GUIDE.md`, Step 1.

### Ship time and the delay notice (FTC Mail Order Rule)
The ship time promised at checkout is ONE constant —
`SHIP_TIME_TEXT` in `functions/api/email/policy.js`
("Made to order — ships in 5–7 business days, delivered within 7–14.") —
injected into every customer email by `renderEmail()`. The storefront must say
the same thing; compare `kaayko/src/cart.html` against the export.

When an order will miss that window:
```
POST /api/admin/orders/delay-notice
{ "parentOrderId": "pi_…", "newEstimatedDate": "2026-10-06", "reason": "Blank stock arrived late" }
```
* Queues `delayNotice.html` to the buyer — apology, the original promise, the
  new date, and the choice to **keep the order** or **cancel for a full
  refund** by replying — with a link to `/legal/returns`. Keyed
  `mail/{pi}_delay_{YYYYMMDD}`: one notice per order per date, a later date
  sends a fresh one.
* Writes `estimatedDelivery` on every line item and the payment intent, a
  `statusHistory` entry (`delay_notice`) and `payment_intents.delayNotices[]`.
* If the new date is more than 30 days past the originally promised delivery
  window (order date + 14 days), the notice states that silence cancels the
  order (`consentRequired: true` in the response); otherwise silence keeps it
  open. The cancellation and refund themselves are manual — refund in Stripe,
  the webhook records it.

### Still missing (by design, not oversight)
* **No admin UI.** These are API-only endpoints behind `requireAuth` +
  `requireAdmin`; there is no orders screen in the frontend yet.
* **No returns intake** beyond the `returned` status string; refunds are issued
  in the Stripe dashboard and recorded here by the webhook.
* **No automatic re-drive** of `mail` documents left in `RETRY`.
* **No inventory decrement** on a successful order.
* The composite indexes these queries need are in `firestore.indexes.json` but
  must be deployed (`firebase deploy --only firestore:indexes`).
