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
- `refunded`: Full refund issued
- `partially_refunded`: Partial refund issued

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

Triggered automatically via Firebase Extensions (to be configured):

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
7. ⏳ Configure Firebase email extension
8. ⏳ Set up automated email triggers
9. ⏳ Add return/refund workflow
10. ⏳ Integrate with shipping label APIs (ShipStation, EasyPost)
