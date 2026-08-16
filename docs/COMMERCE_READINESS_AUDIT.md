# Kaayko Commerce Readiness Audit

**Date:** 2026-08-16
**Scope:** `kaayko-api` (Firebase Cloud Functions) at `faee3f9`, plus Firestore rules/indexes and Firebase config.
**Question answered:** can Kaayko take a real customer from Product → Cart → Checkout → Payment → Order → Fulfillment → Shipment → Tracking → Delivery, and reverse it via Cancellation → Refund → Notification?

**Short answer: no.** Payment works. Everything after payment is manual, and three defects can lose money today. Overall commerce readiness is roughly **25–30%**.

---

## 0. Audit boundary — what I could and could not inspect

| Surface | Inspectable here? | Note |
|---|---|---|
| API / Cloud Functions | ✅ Yes | This repo |
| Firestore rules + indexes | ✅ Yes | `firestore.rules`, `firestore.indexes.json` |
| **Storefront (cart, product page, checkout UI, address collection)** | ❌ **No** | `firebase.json` `hosting.public` = `../../frontend/kaayko/src`; `.gitignore` excludes `kaayko-frontend/`. Separate repo, not present. |
| Runtime env vars / secrets | ❌ No | `functions/.env*` is gitignored and absent. No `secrets: []` declared on the function. |
| Firebase Extensions (email delivery) | ❌ No | No `extensions` block in `firebase.json`. |
| Stripe dashboard config (endpoints, events, API version) | ❌ No | External |

Every claim below cites code in this repo. Where a conclusion depends on the frontend or on external config, it is marked **UNKNOWN** rather than guessed.

---

## A. Architecture discovered

### Product catalog (authoritative source)

Firestore collection **`kaaykoproducts`**, served by `functions/api/products/products.js`:
- `GET /api/products` — `products.js:64-113`
- `GET /api/products/:id` — `products.js:122-166`
- `POST /api/products/:id/vote` — `products.js:174-198`

Fields actually read (`products.js:70-90`):

| Concept | Field | Notes |
|---|---|---|
| Product ID | Firestore doc ID (`id`) | Also a separate `productID` used as the **Storage folder key**, not a SKU |
| Title / description | `title`, `description` | |
| Price | `price` (**string**, e.g. `"$29.99"`), `actualPrice` (number\|null) | `actualPrice` exists but **checkout never reads either** |
| Images | `imgSrc[]`, `previewSrc[]` | Signed-URL staleness fallback at `products.js:96-101` |
| Size | `availableSizes[]` | Catalog-level list only |
| Color | `availableColors[]` | Catalog-level list only |
| Availability | `isAvailable` (bool), `maxQuantity` (number) | No inventory count; `maxQuantity` is never enforced server-side |
| Variant ID | **absent** | |
| SKU | **absent** | |
| Fulfillment-provider IDs | **absent** | |

**There is no variant model.** A "product" is one document with loose size/color arrays. There is no `(product, size, color) → variant` entity, therefore no ID that could ever be handed to a print-on-demand provider. This is the root architectural gap for fulfillment.

### Payments

Provider: **Stripe**, SDK `stripe@^17.5.0` (`functions/package.json`).
Mechanism: **Payment Intents**, not Checkout Sessions (`createPaymentIntent.js:102-117`). Therefore there is no `success_url` / `cancel_url` — the frontend supplies `return_url` to `stripe.confirmPayment()` (per `checkout/README.md:70-78`, frontend not inspectable).
API version: **not pinned** (`createPaymentIntent.js:17-21` passes only timeout/retries) → the Stripe account's default version applies, and can change under the code.
Credentials: `process.env.STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`. `functions/index.js:142-147` declares **no `secrets: []`**, so these must arrive via a `functions/.env` file or Cloud Run env — **unverifiable from the repo**.

Endpoints:
- `POST /api/createPaymentIntent` → `checkout/createPaymentIntent.js`
- `POST /api/createPaymentIntent/updateEmail` → `checkout/updatePaymentIntentEmail.js`
- `POST /api/createPaymentIntent/webhook` → `checkout/stripeWebhook.js`, mounted with `express.raw()` **before** `express.json()` at `index.js:56` (correct)

### Webhooks handled

Store checkout — `checkout/stripeWebhook.js:48-63`:

| Event | Handled | Signature verified | Writes | Fulfillment | Email | Idempotent |
|---|---|---|---|---|---|---|
| `payment_intent.succeeded` | ✅ | ✅ (`:41`) | `payment_intents` update, `orders` batch create | ❌ none exists | ✅ 2 emails | Orders yes (accidentally); **emails no** |
| `payment_intent.payment_failed` | ✅ | ✅ | `payment_intents` update | — | ❌ | Yes (idempotent update) |
| `charge.refunded` | ❌ **missing** | | | | | |
| `payment_intent.canceled` | ❌ **missing** | | | | | |
| `charge.dispute.created` | ❌ **missing** | | | | | |
| `payment_intent.requires_action` | ❌ **missing** | | | | | |

A second, unrelated Stripe webhook exists for Kortex subscriptions (`api/billing/stripeWebhook.js`, mounted `index.js:60`). **Both read the same `STRIPE_WEBHOOK_SECRET` env var** (`checkout/stripeWebhook.js:28`, `billing/stripeWebhook.js:35`). Two Stripe endpoints have two different signing secrets, so at most one of these can verify successfully in production. `__tests__/setup.js:16` defines an unused `STRIPE_CHECKOUT_WEBHOOK_SECRET`, suggesting the split was intended and never implemented.

### Order database

Two collections, both `allow read, write: if false` in `firestore.rules:44-53` (API-only — correct).

**`payment_intents/{stripePaymentIntentId}`** — written at intent creation (`createPaymentIntent.js:125-168`): totals, `status`/`paymentStatus`/`fulfillmentStatus`, timestamps, `items[]`, client-supplied `customerEmail`/`customerPhone`, `dataRetentionConsent`, `statusHistory[]`.

**`orders/{paymentIntentId}_item{N}`** — written **only** in the webhook (`stripeWebhook.js:179-197`), one document per item. Contains `parentOrderId`, `itemIndex`, product fields, tri-status, timestamps, `shippingAddress`, tracking placeholders, `statusHistory[]`, `internalNotes[]`.

### Fulfillment

**None.** No provider package, no HTTP client, no outbound call. A repo-wide search for `printful|printify|gooten|gelato|teelaunch|scalablepress|shipstation|fulfil` returns only the word *"fulfillment"* used as a status string in docs and code — no integration. `docs/ORDER_TRACKING_SYSTEM.md:470` lists "Integrate with shipping label APIs" as a future ⏳ item.

Fulfillment today = a human reads the admin notification email and does it by hand.

### Tracking

Manual only. `POST /api/admin/updateOrderStatus` (`admin/updateOrderStatus.js:76-96`) accepts `trackingNumber` + `carrier` and derives a `trackingUrl` from a 4-carrier map. No provider sync, no shipment webhook, no customer notification, and **no customer-readable endpoint** (`getOrder` sits behind `requireAdmin`, `index.js:118`).

### Notifications

`stripeWebhook.js:255-328` renders two HTML templates and writes documents to a Firestore **`mail`** collection — the contract of the Firebase *Trigger Email* extension. That extension is **not declared in this repo**, so whether any mail is ever delivered is UNKNOWN. `services/emailNotificationService.js` (SendGrid/console) exists but is **not used by commerce** — only by Kortex, Kreators, Alumni and Paddling Out.

### Admin

`index.js:116-119`, all behind `requireAuth` + `requireAdmin` (`middleware/authMiddleware.js`, admin identity = a doc in `admin_users` with `role`):
- `GET /api/admin/getOrder` (by `orderId` or `parentOrderId`)
- `GET /api/admin/listOrders` (filters + pagination)
- `POST /api/admin/updateOrderStatus`

No cancel, no refund, no retry, no failure inspection. No admin UI in this repo.

### Environments

`.firebaserc` declares **one** project: `kaaykostore`. One Cloud Function (`api`), one env var set, no staging alias, no test-mode flag anywhere in the code.

---

## B. Existing flow (??? replaced with what actually exists)

```
Customer
  ↓
Kaayko Store  ......................... SEPARATE REPO — not inspectable
  ↓  POST /api/createPaymentIntent  { items:[{productId,productTitle,size,gender,price}] }
Checkout      ......................... createPaymentIntent.js
                                        ⚠ price taken from the REQUEST BODY, never from kaaykoproducts
                                        ⚠ no quantity, no tax, no shipping cost
  ↓
Payment Provider ...................... Stripe PaymentIntent (automatic_payment_methods)
                                        card + email + address collected client-side by Payment Element
                                        email pushed back separately via POST /updateEmail (best-effort)
  ↓  payment_intent.succeeded (signature verified)
Webhook       ......................... checkout/stripeWebhook.js
                                        ⚠ ALWAYS returns 200, even when processing throws
  ↓
Firebase      ......................... payment_intents/{pi} updated
                                        orders/{pi}_item1..N created (batch.set, deterministic IDs)
                                        mail/{auto} × 2 queued (customer + rohan@kaayko.com)
  ↓
Email         ......................... Firestore `mail` collection
                                        → Trigger Email extension NOT DECLARED IN REPO (delivery UNKNOWN)
                                        ⚠ template reads metadata.productTitle / metadata.size,
                                          which createPaymentIntent NEVER SETS → every email says
                                          "Kaayko Product / N/A"
  ↓
Fulfillment Provider .................. ✗ DOES NOT EXIST
                                        A human reads the admin email and orders merchandise manually
  ↓
Shipment      ......................... ✗ no provider webhook, no polling
  ↓
Tracking      ......................... admin types trackingNumber + carrier into
                                        POST /admin/updateOrderStatus
                                        ⚠ no email is sent to the customer
                                        ⚠ customer has no endpoint to read it (admin-only auth)
  ↓
Delivery      ......................... admin manually sets orderStatus='delivered'

Cancellation  ......................... ✗ NO CODE
Refund        ......................... ✗ NO CODE (Stripe dashboard only; DB never learns —
                                          no charge.refunded handler)
```

---

## C. Readiness table

| Component | Status | Evidence | Risk | Required work |
|---|---|---|---|---|
| Storefront | **UNKNOWN** | Not in repo (`firebase.json` hosting → `../../frontend/kaayko/src`) | Cart/variant/address behaviour unverifiable; API contract implies no qty/variant | Audit frontend repo; add variant + quantity to the checkout contract |
| Checkout | **BROKEN** | `createPaymentIntent.js:43-53,72-73` — price from request body | **P0 money loss:** pay any amount for any product | Re-price server-side from `kaaykoproducts`; reject client prices |
| Payments | **PARTIAL** | `createPaymentIntent.js:102-117` | No API version pin; no idempotency key; no tax/shipping | Pin `apiVersion`; add `idempotencyKey`; decide tax strategy |
| Payment webhooks | **PARTIAL** | `stripeWebhook.js:48-63` | Only 2 of ~6 needed events; **always 200 on failure** → charged-but-no-order is silent and never retried | Return 5xx on failure; add refund/cancel/dispute handlers; split webhook secrets |
| Order creation | **PARTIAL** | `stripeWebhook.js:179-197` | Emails describe the wrong product; unit prices wrong in legacy path (`:89`) | Fix template data; drop or fix the legacy comma-separated path |
| Order database | **PARTIAL** | `stripeWebhook.js:108-194` | No fulfillment/refund/cancel fields; `createdAt` is an ISO string in `orders` but a Timestamp in `payment_intents` | Add lifecycle fields + normalize timestamps |
| Idempotency | **PARTIAL** | Deterministic doc IDs `${pi}_item${n}` + `batch.set` | Orders dedupe **by accident**; emails use `.add()` → duplicates; a late replay **overwrites admin-entered tracking** | Add an explicit `webhook_events/{event.id}` guard; `set(..., {merge:true})` or transactional guard |
| Fulfillment API | **MISSING** | Repo-wide search: no provider anywhere | Cannot ship without manual labour; no scale, no audit trail | Choose provider; build client + order mapping |
| Variant mapping | **MISSING** | `kaaykoproducts` has no variant/SKU/provider IDs | **Wrong shirt/size/colour cannot even be detected**, let alone prevented | Introduce a variant entity keyed to provider variant IDs |
| Fulfillment webhooks | **MISSING** | — | No status ever returns to Kaayko | Build after provider selection |
| Cancellation | **MISSING** | No `cancel` code anywhere | Cannot stop an order; cannot honour a cancellation request | Add admin cancel endpoint + provider cancel + refund |
| Refund | **MISSING** | No `refund` code anywhere | **P0:** refunds only via dashboard, and DB never reflects them | Add refund endpoint + `charge.refunded` handler |
| Tracking | **PARTIAL** | `updateOrderStatus.js:76-96` | Manual; **FedEx URL always null** (`trackingUrls['FEDEX']` vs key `'FedEx'`, `:86`); customer cannot read it | Fix the map; add a public order-lookup endpoint; automate from provider |
| Customer emails | **BROKEN** | `stripeWebhook.js:280-283` vs `createPaymentIntent.js:109-116` | Confirmation email names the wrong product every time; no shipping/cancel/refund emails; delivery mechanism unconfirmed | Fix payload, add items loop + address, add 3 missing templates, confirm the extension |
| Admin notifications | **PARTIAL** | `stripeWebhook.js:315-322` | New-order email only. **No alert on any failure** — a swallowed exception (`:205-207`) means a paid order vanishes silently | Alert on webhook failure, fulfillment failure, email failure |
| Admin order management | **PARTIAL** | `admin/getOrder.js`, `admin/updateOrderStatus.js` | **Filtered `listOrders` and `getOrder?parentOrderId` will fail** — no composite indexes for `orders` in `firestore.indexes.json`; no cancel/refund/retry; no actor recorded (`updateOrderStatus.js:105` TODO) | Add indexes; add actions; write `admin_audit_logs` |
| Logging | **PARTIAL** | `console.log`/`console.error` throughout | No correlation ID, no order-lifecycle trace; customer email logged (`stripeWebhook.js:295`); raw `error.message` returned to clients (`createPaymentIntent.js:183`) — contrary to `CLAUDE.md` | Structured logging keyed by `paymentIntentId`; stop echoing internals |
| Environment separation | **BROKEN** | `.firebaserc` — one project, no staging, no test flag | A test run hits production config; nothing prevents a real charge or a real merchandise order | Add staging project or an explicit `KAAYKO_ENV` gate on all outward effects |
| Test mode | **MISSING** | No test-order marker, no sandbox concept | Cannot safely rehearse the flow end to end | `TEST_ORDER` metadata + draft-only fulfillment + test-product allowlist |

No secrets are logged and no card data touches the backend (Payment Element is client-side, PCI-friendly) — those two things are genuinely fine.

---

## D. Blockers

### P0 — must fix before any real money moves

| # | Issue | Evidence | Consequence |
|---|---|---|---|
| **P0-1** | **Client-controlled pricing.** The server sums `item.price` from the request body and never consults `kaaykoproducts`. | `createPaymentIntent.js:43-53`, `:72-73` | `POST {items:[{productId:"<real>",price:"0.50"}]}` buys a $69.98 shirt for 50¢. Direct money loss, fully automatable. `docs/skills/STORE_SKILL.md:...` claims "Server validates prices" — the docs are wrong. |
| **P0-2** | **Webhook returns 200 even when processing fails.** `handlePaymentSuccess` catches and swallows every error; the handler then replies `{received:true}`. | `stripeWebhook.js:52`, `:205-207`, `:65` | Firestore hiccup ⇒ customer charged, **no order document, no email, no retry from Stripe, no alert**. The order simply does not exist. |
| **P0-3** | **No refund or cancellation path anywhere.** | Repo-wide: zero references to `refunds`, `paymentIntents.cancel` | Cannot refund or cancel through Kaayko. Dashboard refunds leave the DB claiming `paymentStatus:'paid'` forever (no `charge.refunded` handler). |
| **P0-4** | **No fulfillment integration.** | No provider code exists | Nothing turns payment into merchandise. Paid orders rest at `fulfillmentStatus:'processing'` indefinitely. |
| **P0-5** | **No variant identity.** Catalog has no SKU/variant/provider ID; the order stores free-text `size`/`gender` strings. | `products.js:70-90`, `stripeWebhook.js:189-193` | Once fulfillment exists there is no safe mapping — wrong size/colour/design cannot be prevented or even detected. Must be fixed *before* wiring any provider. |
| **P0-6** | **Shipping address is optional and may be `null`.** `createPaymentIntent` never sets `shipping`; the webhook reads `paymentIntent.shipping` and stores `null` if absent. Customer email likewise depends on a separate best-effort `/updateEmail` call. | `stripeWebhook.js:135-146`, `:275-276`, `updatePaymentIntentEmail.js:48-53` | A paid order with no address and no email is unfulfillable and unreachable, and nothing rejects or flags it. |

### P1 — must fix before launch

| # | Issue | Evidence |
|---|---|---|
| **P1-1** | Confirmation emails always show the wrong product. Templates are fed `metadata.productTitle` / `metadata.size`, which `createPaymentIntent` never writes (it writes `items`, `itemCount`, `timestamp`, `notifyEmail`, `dataRetentionConsent`). | `stripeWebhook.js:280-283` vs `createPaymentIntent.js:109-116` |
| **P1-2** | Duplicate webhook delivery ⇒ **duplicate emails** (`mail` uses `.add()`), and a late replay **overwrites** the order doc (`batch.set`, no merge), wiping admin-entered tracking and resetting status to `pending`. | `stripeWebhook.js:182`, `:287`, `:315` |
| **P1-3** | Admin order queries will fail at runtime — `firestore.indexes.json` has **no `orders` composite indexes**, but `listOrders` filters + `orderBy('createdAt')` and `getOrder` filters `parentOrderId` + `orderBy('itemIndex')`. | `admin/getOrder.js:46-49`, `:88-105`; `firestore.indexes.json` |
| **P1-4** | Customer cannot see their own order or tracking — the only read endpoint is admin-gated. | `index.js:118` |
| **P1-5** | No shipping / cancellation / refund / delivery emails exist. Only 2 templates, both order-confirmation. | `api/email/templates/` |
| **P1-6** | No admin alert on any operational failure; failures land in `console.error` only. | `stripeWebhook.js:205-207`, `:325-327` |
| **P1-7** | Both Stripe webhooks share one `STRIPE_WEBHOOK_SECRET`; two endpoints have two secrets, so one must fail verification. | `checkout/stripeWebhook.js:28`, `billing/stripeWebhook.js:35` |
| **P1-8** | **A real Stripe test secret key is committed to the repo.** | `functions/api/checkout/README.md:140` — rotate it |
| **P1-9** | Single environment. One Firebase project, one key set, no test-order marker — an E2E test runs against production config. | `.firebaserc` |
| **P1-10** | Email delivery unconfirmed: the `mail` collection needs the Trigger Email extension, declared nowhere. | `firebase.json` |
| **P1-11** | No quantity anywhere. Buying 2 of one shirt requires 2 array entries; `maxQuantity` is never enforced. | `createPaymentIntent.js:54-62` |
| **P1-12** | No tax and no shipping cost. Total = sum of item prices. | `createPaymentIntent.js:102-104` |

### P2 — should fix

- FedEx tracking URL is always `null`: lookup `trackingUrls[carrier.toUpperCase()]` = `'FEDEX'`, map key is `'FedEx'` (`updateOrderStatus.js:80-86`).
- `updateOrderStatus` accepts any status string — no state machine; `delivered` can precede `shipped`.
- No admin actor recorded; `internalNotes.author` hardcoded `'admin'` (`updateOrderStatus.js:105`). `admin_audit_logs` exists in rules/indexes but order routes never write it.
- Raw `error.message` returned to clients across checkout/admin (`createPaymentIntent.js:183`, `getOrder.js`, `updateOrderStatus.js`) — contrary to `CLAUDE.md` "do not return raw Firestore errors".
- No Stripe idempotency key on `paymentIntents.create`; abandoned intents stay `status:'created'` forever (no `payment_intent.canceled` handler).
- Legacy comma-separated checkout path splits the total evenly across items, recording wrong unit prices (`createPaymentIntent.js:89`).
- Customer email written to logs (`stripeWebhook.js:295`, `updatePaymentIntentEmail.js:57`).

### P3 — nice to have

- Structured logging with a `paymentIntentId` correlation ID; emoji-prefixed `console.log` throughout.
- `orders.createdAt` ISO string vs `payment_intents.createdAt` Timestamp — normalize.
- Order-lifecycle metrics/dashboards.

---

## E. Completion estimate (not inflated)

| Area | % | Rationale |
|---|---|---|
| Checkout | **55%** | Multi-item intent creation works; pricing is unsafe, no qty/tax/shipping |
| Payment | **65%** | PI + verified signature + failure handling; missing events, no idempotency guard, no refunds |
| Order management (DB) | **50%** | Reasonable schema and audit trail; missing indexes, missing lifecycle fields, no state machine |
| Fulfillment | **0%** | Nothing exists |
| Tracking | **25%** | Manual field + URL map (with a FedEx bug); no sync, no customer view, no notification |
| Notifications | **30%** | 2 templates wired to an unconfirmed extension, and they render the wrong product |
| Cancellation / refunds | **0%** | Nothing exists |
| Admin tooling | **35%** | 3 authed endpoints, no UI here, filtered queries broken, no actions |
| **Overall commerce flow** | **~25–30%** | Payment is real; everything downstream is manual or absent |

---

## F. Implementation plan — smallest safe sequence

Ordering principle: **stop the money leaks, then make the flow honest, then automate it.** Steps 1–4 are worth doing regardless of which fulfillment provider is ever chosen.

1. **Server-side re-pricing** (fixes P0-1). Checkout accepts `{productId, size, color, quantity}` only. The server loads each `kaaykoproducts` doc, resolves the price from `actualPrice`, enforces `isAvailable` and `maxQuantity`, and computes the total. Any client-supplied price is ignored.
2. **Webhook integrity** (fixes P0-2, P1-2, P1-7). Wrap dispatch in try/catch that returns **500** so Stripe retries; add a `webhook_events/{event.id}` transactional guard so retries are safe; switch order writes to merge semantics; give the checkout webhook its own `STRIPE_CHECKOUT_WEBHOOK_SECRET` (the test setup already anticipates it).
3. **Required-data gate** (fixes P0-6). If a succeeded PI has no shipping address or no email, write the order with `orderStatus:'needs_attention'` and fire an admin alert — never silently store `null`.
4. **Order model + indexes** (fixes P1-3, P1-4). Add `fulfillment*`, `refund*`, `cancel*` fields and normalized timestamps; add the missing `orders` composite indexes; add a public, token-scoped `GET /api/orders/lookup` so customers can see status and tracking.
5. **Email correctness** (fixes P1-1, P1-5, P1-10). Feed templates from the real `items[]`; add items loop, quantity, totals, shipping address; add shipping / cancellation / refund templates; add a per-order `emailXSent` flag for send-once; confirm the Trigger Email extension exists (or move commerce onto `emailNotificationService`).
6. **Refund + cancel** (fixes P0-3). `POST /api/admin/cancelOrder` and `POST /api/admin/refundOrder` calling Stripe, plus a `charge.refunded` handler — the DB flips to `refunded` **only** when Stripe confirms, never optimistically.
7. **Variant model** (fixes P0-5). Add a variant entity: `(productId, size, color) → {sku, providerProductId, providerVariantId, price}`. Backfill the catalog. This is the prerequisite for any provider integration and is the largest single item on this list.
8. **Environment gate** (fixes P1-9). A `KAAYKO_ENV` (`dev|staging|prod`) that every outward effect checks; non-prod stamps `TEST_ORDER` metadata and refuses to confirm fulfillment.
9. **Fulfillment provider** (fixes P0-4). Only after 7 and 8. Recommend **Printful** for POD apparel — it has a documented order API, a create-without-confirm (draft) mode that gives a real safety valve for testing, and shipment webhooks carrying tracking number, carrier and URL. Submit as **draft** first; require explicit admin confirmation until a full cycle has been proven.
10. **Provider status sync + admin actions.** Provider webhook → order status + tracking + customer shipping email; admin gets retry-fulfillment and a visible `fulfillment_failed` state.

### Five-day plan (≈3 h/day = 15 h)

| Day | Focus | Items |
|---|---|---|
| **1 — Payment integrity** | Steps 1, 2, 3 | Server-side re-pricing + tests; webhook returns 5xx + event-ID idempotency; merge-safe order writes; separate checkout webhook secret; needs-attention gate; **rotate the leaked test key** |
| **2 — Order model + fulfillment groundwork** | Steps 4, 7 | Lifecycle fields, indexes, customer lookup endpoint; variant model + catalog backfill (this will consume the day) |
| **3 — Notifications + tracking** | Step 5 + P2 tracking fixes | Correct multi-item emails, shipping/cancel/refund templates, send-once flags, admin failure alerts, FedEx URL fix |
| **4 — Cancellation, refund, failure paths** | Step 6, 8 | Cancel + refund endpoints, `charge.refunded` handler, `KAAYKO_ENV` gate, `TEST_ORDER` marker, duplicate/failure test cases |
| **5 — Regression + acceptance** | Test matrix (§ below) | Full suite in Stripe test mode against a dedicated test product; then a go/no-go decision |

**Honest scope warning.** 15 hours does not cover steps 9–10. What five days *can* deliver is a **production-safe, manually-fulfilled store**: correct pricing, no lost orders, working refunds and cancellations, accurate customer emails, visible failures. That is a legitimate launch posture for low volume. Automated Printful fulfillment (provider client, variant sync, order submission, webhook status, retry logic) is realistically another 12–20 hours on top and should be scheduled as a second block — not squeezed into Day 5.

---

## Test matrix

Legend: **A** = automatable now (Jest, `functions/__tests__/`) · **S** = Stripe test mode + CLI · **M** = manual/admin · **F** = needs fulfillment provider (blocked)

| # | Case | How | Status today |
|---|---|---|---|
| 1 | Successful checkout creates a PI | A | ✅ passes (no price validation) |
| 2 | Checkout rejects a client-supplied price | A | ❌ **fails — P0-1** |
| 3 | Checkout rejects unavailable product / over `maxQuantity` | A | ❌ not implemented |
| 4 | Successful payment → order docs created | S | ✅ |
| 5 | Correct product mapping | A | ⚠️ free-text only |
| 6 | Correct size mapping | A | ⚠️ free-text only |
| 7 | Correct colour mapping | A | ❌ colour is never sent to checkout |
| 8 | Correct quantity | A | ❌ no quantity field |
| 9 | Correct customer details | S | ⚠️ email via best-effort side call |
| 10 | Correct shipping address | S | ⚠️ may be `null`, unflagged |
| 11 | Correct tax | S | ❌ none |
| 12 | Correct shipping cost | S | ❌ none |
| 13 | Fulfillment order created | F | ❌ blocked |
| 14 | Provider order ID stored | F | ❌ blocked |
| 15 | Confirmation email content correct | A | ❌ **fails — P1-1** |
| 16 | Admin new-order notification | S | ✅ (single-item content wrong) |
| 17 | Fulfillment status update | F | ❌ blocked |
| 18 | Shipment creation | F | ❌ blocked |
| 19 | Tracking number received | F | ❌ blocked |
| 20 | Tracking link stored | M | ⚠️ manual; FedEx broken |
| 21 | Shipping email sent | M | ❌ none |
| 22 | Delivery state | M | ⚠️ manual only |
| 23 | Cancel before fulfillment | M | ❌ no code |
| 24 | Cancel after provider submission | F | ❌ blocked |
| 25 | Full refund | M | ❌ no code |
| 26 | Refund notification | M | ❌ no code |
| 27 | Declined card | S | ✅ `payment_intent.payment_failed` handled |
| 28 | Abandoned checkout | S | ⚠️ intent stuck at `created` forever |
| 29 | Expired checkout | S | ❌ no `payment_intent.canceled` handler |
| 30 | Duplicate payment webhook | A | ⚠️ orders dedupe; **emails duplicate**, late replay overwrites tracking |
| 31 | Duplicate fulfillment webhook | F | ❌ blocked |
| 32 | Payment success + fulfillment failure | F | ❌ blocked — and no `fulfillment_failed` state exists |
| 33 | Fulfillment retry | F | ❌ blocked |
| 34 | Invalid shipping address | S | ❌ no validation |
| 35 | Provider API outage | F | ❌ blocked |
| 36 | Email-send failure | A | ❌ swallowed silently (`stripeWebhook.js:325-327`) |
| 37 | Firestore write failure after charge | A | ❌ **fails — P0-2**, returns 200, no retry, no alert |
| 38 | Admin endpoints reject non-admin | A | ✅ covered in `store-api.test.js` |
| 39 | `listOrders` with a status filter | A | ❌ missing composite index |

---

## Production acceptance tests (§21–22 of the brief) — not yet runnable

Both proposed production tests are **blocked** and should not be attempted in the current state:

- **The single real production order (§21)** cannot exercise "Fulfillment provider → Manufacturing → Shipping → Tracking → Customer email" because no provider is integrated and no shipping email exists. It would also be placed against a checkout that accepts client-supplied prices.
- **The cancellation test (§22)** cannot be performed at all: there is no cancellation code and no refund code.

Prerequisites before either is scheduled: P0-1 through P0-6 closed, steps 1–6 shipped, and (for §21/§22 in full) a fulfillment provider integrated with draft-order mode. The five-day plan above closes the first two; the provider work is the follow-on block.

---

*Prepared as a read-only audit. No production behaviour was modified.*
