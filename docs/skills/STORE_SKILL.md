---
description: Use when working on the Kaayko Store — product catalog, image proxy, Stripe checkout, payment intents, order management, or vote functionality. Trigger for any file under functions/api/products/, functions/api/checkout/, or functions/api/admin/ (getOrder, updateOrderStatus, listOrders).
---

# Store API — Developer Runbook

## Purpose

The Store backend serves Kaayko merchandise: product catalog browsing, image delivery, Stripe-based checkout, and admin order fulfillment. It is split across four route modules (`products`, `images`, `checkout`, `admin`) all mounted from `functions/index.js`. There is no creator-facing product management here — that lives in the Kreator API at `/kreators/products`.

---

## Key Files

| File | Responsibility |
|------|---------------|
| `functions/api/products/products.js` | Product catalog — list, get, vote |
| `functions/api/products/images.js` | Image proxy from Cloud Storage (prevents raw storage URL exposure) |
| `functions/api/checkout/router.js` | Checkout router — mounts createPaymentIntent, updateEmail, webhook |
| `functions/api/checkout/createPaymentIntent.js` | Stripe payment intent creation, order docs |
| `functions/api/checkout/updatePaymentIntentEmail.js` | Update customer email on a payment intent |
| `functions/api/checkout/stripeWebhook.js` | Stripe event handler — `payment_intent.succeeded`, `.payment_failed` |
| `functions/api/admin/getOrder.js` | Admin order detail (by orderId or parentOrderId) |
| `functions/api/admin/updateOrderStatus.js` | Admin order status mutation with tracking info |
| `functions/index.js` | Route mounts — raw body config for webhook must stay before `express.json()` |

---

## Endpoints

### Products (`/products`) — Public

| Method | Path | Notes |
|--------|------|-------|
| GET | `/products` | Returns all products with images. Always fetches images from Storage |
| GET | `/products/:id` | Single product with image fallback |
| POST | `/products/:id/vote` | Body: `{ voteChange: 1 \| -1 }` — atomically increments `votes` field |

### Images (`/images`) — Public

| Method | Path | Notes |
|--------|------|-------|
| GET | `/images/health` | Health check |
| GET | `/images` | API info |
| GET | `/images/:productId/:fileName` | Streams image from `kaaykoStoreTShirtImages/{productId}/{fileName}` |

### Checkout (`/createPaymentIntent`)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/createPaymentIntent` | Public | Creates Stripe PaymentIntent + Firestore order docs |
| POST | `/createPaymentIntent/updateEmail` | Public | Updates email on existing PaymentIntent |
| POST | `/createPaymentIntent/webhook` | Public (Stripe signature) | Must receive raw body — mounted before `express.json()` |

### Admin Orders (`/admin`) — requireAuth + requireAdmin

| Method | Path | Notes |
|--------|------|-------|
| GET | `/admin/getOrder` | Query: `?orderId=` OR `?parentOrderId=` |
| GET | `/admin/listOrders` | Query: orderStatus, fulfillmentStatus, paymentStatus, limit, startAfter |
| POST | `/admin/updateOrderStatus` | Body: orderId, orderStatus, fulfillmentStatus, trackingNumber, carrier, etc. |

---

## Auth & Middleware Stack

```
Products + images: No auth, no rate limiting (public)
Checkout: No auth — relies on Stripe signature for webhook
Admin routes: requireAuth (Firebase) → requireAdmin → handler

CRITICAL: Stripe webhook mounted BEFORE express.json() in index.js:
  apiApp.use("/createPaymentIntent/webhook", express.raw({ type: 'application/json' }), stripeWebhook)
```

> **Security gap:** `POST /products/:id/vote` has no rate limiting. Any client can spam votes. A simple in-memory guard should be added (see Improvement Checklist).

---

## Data Model (Firestore)

### `kaaykoproducts/{id}` — Product catalog (also written by Kreator API)
```
id, title, description
price (symbol: $|$$|$$$|$$$$)
votes, tags[], availableColors[], availableSizes[]
maxQuantity, stockQuantity
imgSrc[] (public Firebase Storage URLs — may be stale, always refreshed from Storage on read)
isAvailable, category
productID (format: uid_8chars_uuid_8chars)
kreatorId, storeName, storeSlug, sellerEmail
createdAt, updatedAt
```

### `payment_intents/{paymentIntentId}`
```
id (Stripe pi_... or pi_... id)
status, amount (cents), currency
customerEmail, customerPhone
items[]: { productId, productTitle, size, gender, price, priceInCents }
dataRetentionConsent
createdAt, updatedAt
```

### `orders/{orderId}`
```
id, parentOrderId (payment intent ID)
itemIndex, productId, productTitle, size, gender
orderStatus: 'pending' | 'processing' | 'shipped' | 'delivered' | 'returned' | 'cancelled'
fulfillmentStatus
paymentStatus
trackingNumber, carrier, trackingUrl, estimatedDelivery
internalNote, customerNote
statusHistory[]: { status, timestamp, updatedBy }
processedAt, shippedAt, deliveredAt, returnedAt
createdAt, updatedAt
```

---

## Stripe Integration

**Payment flow:**
1. Client POSTs `{ items: [...] }` to `/createPaymentIntent`
2. Server validates prices, creates Stripe PaymentIntent
3. Server creates `payment_intents` doc + one `orders` doc per item
4. Returns `{ clientSecret, paymentIntentId }` to client
5. Client confirms payment with Stripe Elements
6. Stripe sends `payment_intent.succeeded` webhook → server updates orders to `processing`

**Price format:** `items[].price` accepts `"$45"`, `"45.00"`, or `"$45.00"` — dollar signs and commas are stripped, converted to cents (×100, rounded)

**Legacy format still supported:** Single product in body (`productId`, `productTitle`, `size`, `gender`, `price` as top-level fields)

**Tracking URL generation by carrier:**
- `usps` → `https://tools.usps.com/go/TrackConfirmAction?tLabels={number}`
- `ups` → `https://www.ups.com/track?tracknum={number}`
- `fedex` → `https://www.fedex.com/fedextrack/?trknbr={number}`
- `dhl` → `https://www.dhl.com/en/express/tracking.html?AWB={number}`

---

## Image Proxy

Images are served from Cloud Storage via the proxy at `/images/:productId/:fileName` rather than exposing raw Firebase Storage URLs. The products endpoint always fetches fresh image URLs from Storage (not relying on stored `imgSrc` array), which can cause latency on large catalogs.

Storage path: `kaaykoStoreTShirtImages/{productID}/{fileName}`

Cache headers: `Cache-Control: public, max-age=300` (5 minutes)

---

## Error Shape

All Store files now use the standard error shape (normalized in this pass):

```json
// Error (normalized target)
{ "success": false, "error": "Short title", "message": "Human message", "code": "ERROR_CODE" }

// Success (normalized target)
{ "success": true, ...payload }
```

See Improvement Checklist for normalization status.

---

## Firestore Security Rules (relevant)

```
kaaykoproducts — not in firestore.rules (falls to deny-all default)
orders — not in firestore.rules (deny-all default)
payment_intents — not in firestore.rules (deny-all default)
```

All Store collections rely on the Cloud Functions Admin SDK bypassing security rules. Direct client writes to these collections are blocked by the deny-all default rule.

---

## Known Issues & Gaps

- **Inconsistent error shape in `products.js`** — returns `{ error: "..." }` without `success` field. All other APIs use `{ success: false, ... }`. Fixed in this pass (see Improvement Checklist).
- **No rate limiting on `POST /products/:id/vote`** — completely open to vote spam. Adding in-memory guard.
- **Image fetch on every read** — `products.js` always calls `fetchImagesFromStorage()` even when `imgSrc` is populated in Firestore. This adds latency. A hybrid (prefer stored, fallback to Storage) would be faster.
- **No dedicated regression suite** — no Jest tests. Minimum needed: product list/get, vote validation, payment intent creation, admin auth gate.
- **`listOrders` not in STORE.md** — docs list it but it's actually defined in `functions/api/admin/getOrder.js` (same file as `getOrder`).

---

## Improvement Checklist

- [x] Stripe webhook raw body correctly mounted before `express.json()`
- [x] Admin order routes protected with `requireAuth + requireAdmin`
- [x] Image proxy prevents raw Storage URL exposure
- [x] Atomic vote increment with `FieldValue.increment()`
- [x] **Normalize `products.js` error shape** — all errors now use `{ success: false, error, message, code }`
- [x] **Normalize `images.js` error shape** — all errors now use standard shape
- [x] **Add vote rate limiting** — in-memory guard: 10 votes per product per IP per minute
- [x] Add `functions/__tests__/store-api.test.js` (14 tests — see Testing section)
- [x] Wire regression suite into `functions/package.json` (npm run test:store)
- [ ] Optimize `products.js` image fetch — prefer stored `imgSrc`, fall back to Storage only when empty

---

## Testing

**Run existing smoke tests:**
```bash
cd functions && npm run test:smoke
```

**New tests to add** (`functions/__tests__/store-api.test.js`):
1. `GET /products` → 200 with array, each product has `success: true` wrapper
2. `GET /products/:id` with valid ID → 200 with product
3. `GET /products/:id` with unknown ID → 404 `{ success: false, error: "Not found" }`
4. `POST /products/:id/vote` with `voteChange: 1` → 200 `{ success: true }`
5. `POST /products/:id/vote` with `voteChange: 5` → 400 (invalid value)
6. `POST /products/:id/vote` with missing `voteChange` → 400
7. `POST /createPaymentIntent` with valid items array → 200 with `{ clientSecret, paymentIntentId }`
8. `POST /createPaymentIntent` with invalid price → 400
9. `GET /admin/getOrder` without auth → 401
10. `GET /admin/listOrders` without auth → 401
11. `POST /admin/updateOrderStatus` without auth → 401

**Environment variables needed:**
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
ADMIN_PASSPHRASE=...
```
