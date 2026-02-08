# 💳 Checkout API

Stripe payment processing — create payment intents, handle webhooks, manage orders.

## Files

| File | Purpose |
|------|---------|
| `router.js` | Router — mounted at `/createPaymentIntent` |
| `createPaymentIntent.js` | Handler — create Stripe payment intent |
| `updatePaymentIntentEmail.js` | Handler — attach email to payment |
| `stripeWebhook.js` | Handler — process Stripe webhook events |
| `stripeOrderHandler.js` | Business logic — create orders from successful payments |

---

## Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/createPaymentIntent` | Create a Stripe payment intent | Public |
| POST | `/createPaymentIntent/update-email` | Attach customer email to PI | Public |
| POST | `/stripe-webhook` | Stripe webhook handler | Stripe signature |

### POST `/createPaymentIntent`

Creates a Stripe PaymentIntent for checkout. Stores cart items and creates a `payment_intents` Firestore document.

**Body:**
```json
{
  "items": [
    { "productId": "prod_001", "productTitle": "Maple Paddle", "size": "54\"", "price": "$29.99", "priceInCents": 2999 }
  ],
  "customerEmail": "buyer@example.com"
}
```
**Response:** `{ clientSecret: "pi_xxx_secret_yyy" }`

### POST `/stripe-webhook`

Handles `payment_intent.succeeded` and `payment_intent.payment_failed`. On success, creates individual `orders` documents for each line item via `stripeOrderHandler.js`.

**Auth:** Raw body + `STRIPE_WEBHOOK_SECRET` for Stripe signature verification.  
**Note:** Mounted before `express.json()` in `index.js` to preserve the raw body needed for signature verification.

---

## Payment Flow

```
Frontend                      Backend                         Stripe
   │                            │                               │
   ├─ POST /createPaymentIntent ─►│                               │
   │                            ├── Create PI in Firestore ──►  │
   │                            ├── stripe.paymentIntents.create ─►│
   │  ◄── { clientSecret } ─────┤                               │
   │                            │                               │
   ├── stripe.confirmPayment ──────────────────────────────────►│
   │                            │  ◄── webhook: PI succeeded ───┤
   │                            ├── Create order documents       │
   │                            ├── Send confirmation email      │
   │  ◄── redirect to /order-success                            │
```

---

## Firestore Collections

- **`payment_intents`** — Parent records with items, totals, customer info, status
- **`orders`** — Individual order items with shipping, tracking, status history

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |

---

**Test suite:** Part of `__tests__/billing-checkout.test.js` (25 tests)  
**Integration tests:** `__tests__/integration/checkout-orders.integration.test.js` (17 tests)
