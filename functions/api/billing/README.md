# 💰 Billing API

Stripe subscription management — plans, checkout sessions, downgrades, invoices, and billing webhooks.

## Files

| File | Purpose |
|------|---------|
| `router.js` | Router — mounted at `/billing` |
| `billingHandlers.js` | Handler implementations for all billing endpoints |
| `billingConfig.js` | Stripe initialization + `requireStripe` middleware |

---

## Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/billing/plans` | List available subscription plans | Public |
| GET | `/billing/subscription` | Get current tenant subscription | `requireAuth` |
| POST | `/billing/create-checkout` | Create Stripe checkout session | `requireAuth` + tenant context |
| POST | `/billing/downgrade` | Downgrade to free tier | `requireAuth` |
| GET | `/billing/invoices` | List billing invoices | `requireAuth` |
| POST | `/billing/webhook` | Stripe billing webhook | Stripe signature |

### GET `/billing/plans`

Returns all available subscription tiers with pricing and feature lists.

### POST `/billing/create-checkout`

Creates a Stripe Checkout session for upgrading a tenant's plan.

**Headers:** `Authorization: Bearer <token>`, `X-Kaayko-Tenant-Id: <tenantId>`  
**Body:** `{ "planId": "pro-monthly" }`  
**Response:** `{ success: true, checkoutUrl: "https://checkout.stripe.com/..." }`

### POST `/billing/webhook`

Handles Stripe billing events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.

**Auth:** Verified via `STRIPE_BILLING_WEBHOOK_SECRET`

---

## Configuration

`billingConfig.js` initializes Stripe and exports a `requireStripe` middleware that returns 503 if Stripe is not configured (missing `STRIPE_SECRET_KEY`).

**Env vars:**
- `STRIPE_SECRET_KEY` — Stripe API key
- `STRIPE_BILLING_WEBHOOK_SECRET` — Webhook signature secret

---

**Test suite:** Part of `__tests__/billing-checkout.test.js` (25 tests)
