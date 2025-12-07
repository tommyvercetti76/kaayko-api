# Order Data Structure - Kaayko E-commerce

## Overview
This document defines the EXACT data structure for storing orders in Firestore. This is critical for legal compliance and inventory tracking.

---

## 1. Payment Intents Collection (`payment_intents`)

**Purpose**: Track payment creation and status  
**Document ID**: Stripe Payment Intent ID (e.g., `pi_3SbUZSGhBi2rBXlY0TNsQS1n`)

### Structure:
```json
{
  "paymentIntentId": "pi_3SbUZSGhBi2rBXlY0TNsQS1n",
  "totalAmount": 13998,
  "totalAmountFormatted": "$139.98",
  "currency": "usd",
  "itemCount": 2,
  "status": "created",  // or "succeeded"
  "createdAt": "2025-12-06T23:07:22.207Z",
  "completedAt": "2025-12-06T23:08:45.123Z",  // Added when payment succeeds
  
  "items": [
    {
      "productId": "3ulpQlJEnvR1sDqaBLj5LY46yu4JYwulIRmSAEg3",
      "productTitle": "Straight Outta Sabarmati (Male S)",
      "size": "S",
      "gender": "Male",
      "price": "$69.98",
      "priceInCents": 6998
    },
    {
      "productId": "8NMICFJl5pOJeHDfzqA",
      "productTitle": "HTMLK (Female M)",
      "size": "M",
      "gender": "Female",
      "price": "$69.98",
      "priceInCents": 6998
    }
  ],
  
  "dataRetentionConsent": true
}
```

---

## 2. Orders Collection (`orders`)

**Purpose**: Individual order records for fulfillment (ONE per item)  
**Document ID**: `{paymentIntentId}_item{number}` (e.g., `pi_3SbUZSGhBi2rBXlY0TNsQS1n_item1`)

### Structure (Per Item):
```json
{
  // Order identification
  "orderId": "pi_3SbUZSGhBi2rBXlY0TNsQS1n_item1",
  "parentOrderId": "pi_3SbUZSGhBi2rBXlY0TNsQS1n",
  "itemIndex": 1,
  "totalItems": 2,
  
  // Product details (THIS ITEM ONLY)
  "productId": "3ulpQlJEnvR1sDqaBLj5LY46yu4JYwulIRmSAEg3",
  "productTitle": "Straight Outta Sabarmati (Male S)",
  "size": "S",
  "gender": "Male",
  "price": "$69.98",
  
  // Payment details (TOTAL ORDER)
  "totalAmount": 13998,
  "currency": "usd",
  "paymentMethod": "card",
  
  // Timestamps
  "status": "completed",
  "createdAt": "2025-12-06T23:07:22.207Z",
  "completedAt": "2025-12-06T23:08:45.123Z",
  
  // Customer contact (if consent given)
  "customerEmail": "rohanramekar17@gmail.com",
  "customerPhone": "+1 (555) 123-4567",
  
  // Shipping address (ALWAYS stored - needed for fulfillment)
  "shippingAddress": {
    "name": "Rohan Ramekar",
    "line1": "5205 Tuskegee Trail",
    "line2": null,
    "city": "McKinney",
    "state": "TX",
    "postal_code": "75070",
    "country": "US"
  },
  
  // Privacy
  "dataRetentionConsent": true
}
```

---

## 3. Example: 2-Item Order

### Payment Intent Document:
```
payment_intents/pi_3SbUZSGhBi2rBXlY0TNsQS1n
```
- Contains: Array of 2 items
- Total: $139.98 (13998 cents)

### Order Documents (2 separate):
```
orders/pi_3SbUZSGhBi2rBXlY0TNsQS1n_item1
orders/pi_3SbUZSGhBi2rBXlY0TNsQS1n_item2
```
- Each contains: Single item details + shared customer/shipping info

---

## 4. Data Flow

1. **User adds items to cart** → Frontend stores in localStorage
2. **User clicks checkout** → Frontend sends items array to `/api/createPaymentIntent`
3. **API validates items** → Creates Stripe Payment Intent → Stores in `payment_intents` collection
4. **User completes payment** → Stripe sends webhook to `/api/stripeWebhook`
5. **Webhook receives success** → Creates SEPARATE order documents in `orders` collection (one per item)

---

## 5. Inventory Queries

### Get all orders for a product:
```javascript
db.collection('orders')
  .where('productId', '==', '3ulpQlJEnvR1sDqaBLj5LY46yu4JYwulIRmSAEg3')
  .get()
```

### Get all items from a single payment:
```javascript
db.collection('orders')
  .where('parentOrderId', '==', 'pi_3SbUZSGhBi2rBXlY0TNsQS1n')
  .get()
```

### Count total sales by size:
```javascript
db.collection('orders')
  .where('size', '==', 'M')
  .where('status', '==', 'completed')
  .count()
```

---

## 6. Legal Compliance

- ✅ **Each item stored separately** - No data loss
- ✅ **Customer consent tracked** - `dataRetentionConsent` field
- ✅ **Shipping address always stored** - Required for fulfillment
- ✅ **Email/phone conditional** - Only if consent given
- ✅ **Timestamps accurate** - Firestore server timestamps
- ✅ **Audit trail complete** - Payment intent → Orders linkage

---

## 7. Critical Rules

1. **NEVER join multiple items into comma-separated strings**
2. **ALWAYS store items as array in payment_intents**
3. **ALWAYS create separate order documents (one per item)**
4. **ALWAYS link orders via parentOrderId**
5. **NEVER lose data** - Each item must be traceable

---

**Last Updated**: December 6, 2025  
**Version**: 2.0 (Multi-item support)
