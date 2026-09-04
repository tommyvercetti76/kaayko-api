# Sales tax on the Kaayko Store (Stripe Tax)

**Status:** code shipped, feature OFF until `STRIPE_TAX_ENABLED=true` is set *and* the Stripe Dashboard steps below are done.

## Why this exists

Stripe is a **payment processor**, not a marketplace facilitator. It moves the money; it does not collect or remit sales tax for Kaayko. Until this change nothing in the checkout added tax — `pricing.js` priced the cart from the catalogue and the PaymentIntent was created for exactly that subtotal. Pre-launch compliance audit item #4.

The fix uses **Stripe Tax** (calculation + reporting) inside the existing custom checkout. Stripe Tax works out *whether* an item is taxable at a given address, at *what* combined rate, and keeps a transaction record for tax reports. Filing and remitting is still the owner's job (see "What a CPA hour needs to settle").

## How it works

The PaymentIntent has to exist before the shopper types an address (the Payment Element is mounted against its client secret), so tax cannot be part of intent creation. It is applied once the address is complete and before confirmation:

```
1. POST /api/createPaymentIntent            → PaymentIntent for the SUBTOTAL
                                              payment_intents/{pi}: taxCents 0, totalCents = subtotal,
                                              taxStatus 'not_calculated'
2. Storefront mounts Address Element (shipping, US) + Payment Element
3. Address Element reports complete
   POST /api/createPaymentIntent/tax        → Stripe Tax calculation on the server-priced items
                                              PaymentIntent amount := subtotal + tax
                                              PaymentIntent metadata.taxCalculationId := taxcalc_…
                                              payment_intents/{pi}: taxCents, totalCents, breakdown, address
4. stripe.confirmPayment()                  → shopper pays the taxed amount
5. payment_intent.succeeded webhook         → recordTaxTransaction(paymentIntent)
                                              Stripe Tax transaction (reference = pi id) → appears in tax reports
                                              payment_intents/{pi}: taxTransactionId, taxStatus 'recorded'
```

Files: `functions/api/checkout/tax.js` (calculation, route handler, transaction), `router.js` (route), `createPaymentIntent.js` (initial fields), `pricing.js` (per-product `taxCode`).

### The route

`POST /api/createPaymentIntent/tax` — same origin allowlist and the **same per-IP rate-limit bucket** as intent creation (15 calls / 10 min across all checkout routes). The storefront must call it only when the Address Element reports `complete`, never per keystroke.

```json
{ "paymentIntentId": "pi_…",
  "address": { "name": "optional", "line1": "…", "line2": "", "city": "…", "state": "TX", "postal_code": "75070", "country": "US" } }
```

Response (feature on):

```json
{ "success": true, "enabled": true, "paymentIntentId": "pi_…", "currency": "usd",
  "subtotalCents": 6998, "taxCents": 577, "totalCents": 7575,
  "breakdown": [ { "amountCents": 437, "taxableAmountCents": 6998, "inclusive": false,
                   "taxabilityReason": "standard_rated", "ratePercent": "6.25", "rateType": "percentage",
                   "taxType": "sales_tax", "country": "US", "state": "TX" }, … ] }
```

Response (feature off): `{ "success": true, "enabled": false, "subtotalCents": …, "taxCents": 0, "totalCents": subtotal, "breakdown": [] }` — no Stripe call is made; the shipping address is still recorded on the payment intent.

| Status | `code` | Meaning | Storefront should |
|---|---|---|---|
| 400 | `INVALID_ADDRESS` | missing line1/city, non-2-letter state, bad ZIP | show the field error, keep Pay disabled |
| 400 | `ADDRESS_COUNTRY_NOT_SUPPORTED` | country ≠ US (**server-side check**; the Address Element restriction is client-only) | say "US only", keep Pay disabled |
| 404 | `PAYMENT_INTENT_NOT_FOUND` | id we never issued | restart checkout |
| 409 | `PAYMENT_ALREADY_COMPLETED` | our record says paid | go to the success page |
| 409 | `PAYMENT_ALREADY_CONFIRMED` | Stripe refused the amount change (amount can only change before confirmation) | do not re-confirm; reload the order |
| 422 | `PAYMENT_INTENT_NOT_PRICED` | legacy intent without server-priced items | restart checkout |
| 502 | `TAX_CALCULATION_FAILED` / `TAX_APPLY_FAILED` | tax is ON but Stripe Tax could not be applied | **do not confirm**; show "couldn't calculate tax, try again" |

The 502 is deliberate: when the feature is on, the shopper is never allowed to pay an un-taxed total. Nothing fails open.

### What is stored

`payment_intents/{pi}` gains: `taxCents`, `totalCents` (= subtotal + tax; also mirrored to the legacy `totalAmount`/`totalAmountFormatted`), `taxStatus` (`not_calculated` → `calculated` → `recorded`, or `disabled`), `taxCalculationId`, `taxCalculationExpiresAt`, `taxCalculatedAt`, `taxJurisdiction` (country/state/ZIP, `taxable`, `combinedRatePercent`, `taxTypes`, `reasons`), `taxBreakdown[]`, `shippingAddress`, and after the webhook `taxTransactionId` / `taxTransactionRecordedAt`.

Stripe PaymentIntent metadata gains `taxCalculationId`, `subtotalCents`, `taxCents`, `totalCents`, `taxState`. `recordTaxTransaction` treats the metadata as authoritative (it is what Stripe charged).

### Per-product tax codes

Every line is sent with `tax_behavior: 'exclusive'`, `reference` = productId (a repeat of the same product in another size gets `#2`, `#3`…) and `tax_code` = the product document's `taxCode` if it carries a well-formed one (`txcd_…`), otherwise the default **`txcd_30011000` — Clothing & Footwear (general apparel)**. Non-apparel products (stickers, prints, accessories) should get their own `taxCode` on the product document; the uploader does not write one today. Codes: <https://stripe.com/docs/tax/tax-categories>.

## Owner checklist — Stripe Dashboard

Do these in **test mode first**, then repeat in **live mode** (Stripe Tax settings and registrations are per mode).

1. **Enable Stripe Tax.** Dashboard → *Tax*. Accept the Stripe Tax terms. Note the per-transaction fee on Stripe's pricing page before enabling in live mode.
2. **Set the origin address** (Tax settings → *Origin address* / business address). Stripe Tax needs a ship-from location; without it calculations fail and, with the flag on, checkout returns 502.
3. **Set the default product tax code** in Tax settings to Clothing & Footwear as a backstop. The API sends `txcd_30011000` explicitly anyway.
4. **Add a registration for your home state** (Tax → *Registrations* → *Add registration*: country US, state, effective date). **This is the switch that makes Stripe collect.** With no registration for a state, Stripe Tax answers `not_collecting` / `taxCents: 0` for every address in that state — it is not an error, checkout proceeds, and no tax is charged. So an enabled flag with zero registrations collects nothing anywhere.
5. **Turn on threshold monitoring** (Tax → *Monitoring*). Stripe tracks sales by state against each state's economic-nexus thresholds and tells you when a new registration is due. It does not register for you.
6. Decide how filing will happen (Stripe's tax reports export, a filing partner, or the CPA). Stripe Tax calculates and records; it does not file or remit unless you set that up separately.

Then set `STRIPE_TAX_ENABLED=true` in `functions/.env` (it is a plain config value, not a secret — it deploys with the function) and deploy `functions:api`. Run one test-mode checkout to an address in the registered state and confirm `payment_intents/{pi}.taxCents > 0` and, after the webhook, `taxTransactionId` is set.

## Storefront integration (kaayko/src/cart.html)

Not part of this change; needed before the flag goes on:

- On `addressElement.on('change', e => …)` with `e.complete === true`, POST the address (`e.value.address` plus `e.value.name`) to `/api/createPaymentIntent/tax`, debounced. Disable Pay until it answers.
- Show `subtotalCents`, `taxCents`, `totalCents` from the response and label the Pay button with `totalCents`.
- Because the PaymentIntent amount changed server-side, call `await elements.fetchUpdates()` so the Payment Element (wallet buttons in particular) reflects the new amount before `confirmPayment`.
- On 502 or 409, do **not** call `confirmPayment`. On 400, keep Pay disabled and show the message.
- With the flag off the response says `enabled: false` — render no tax line and proceed as today.

## Webhook hook-up

In `payment_intent.succeeded` (after the order documents are written):

```js
const { recordTaxTransaction, TaxError } = require('./tax');
// …
try {
  const taxTransactionId = await recordTaxTransaction(paymentIntent); // null when no tax was applied
  if (taxTransactionId) console.log(`Tax transaction ${taxTransactionId} recorded for ${paymentIntent.id}`);
} catch (err) {
  // TAX_AMOUNT_MISMATCH: the charged amount is not the taxed total — do not file; alert the owner.
  // TAX_TRANSACTION_FAILED: transient — rethrow (5xx) so Stripe redelivers; the call is idempotent.
}
```

Idempotency: the stored `taxTransactionId` short-circuits repeats, the Stripe idempotency key replays for 24 h, and Stripe rejects a second transaction with the same `reference`.

**Refunds:** a refund (full or partial) should reverse the tax transaction with `stripe.tax.transactions.createReversal({ mode, original_transaction, reference })` so the tax report nets out. Not implemented in this change — the `charge.refunded` handler is the natural place.

## What a CPA hour needs to settle (no numbers in this document on purpose)

- **Where Kaayko must be registered.** Sales tax is owed where the *buyer* is, and each state sets its own economic-nexus threshold (a dollar amount and/or a transaction count over a trailing period). Physical presence (inventory, the owner's home) creates nexus regardless of volume. The home state is the obvious first registration; the rest depend on sales.
- **Whether apparel is taxable.** Several states exempt clothing entirely, exempt it below a price threshold, or tax it at a reduced rate — and the rules change. Stripe Tax applies these from the tax code, which is why the code matters and why `taxCents: 0` in some states is correct behaviour, not a bug.
- **Which tax code fits each product line** (apparel vs. printed goods vs. accessories vs. digital).
- **Filing cadence and remittance** per registration, and whether to use Stripe's reports, a filing service, or the CPA.
- **Record-keeping period** for the tax records — longer than the 2-year personal-data window; see `DATA_RETENTION.md`, which keeps the money/tax fields and removes only the personal ones.

Nothing in this repository should be read as tax advice. Thresholds, rates, exemptions and filing rules are state-specific and time-specific.

## Tests

`functions/__tests__/checkout-tax.test.js` (mocked Stripe): flag off/on, non-US rejection, invalid addresses, already-succeeded 409, Stripe failure → 502 with the intent left un-taxed, amount update called with `totalCents`, calculation sanity checks, per-product tax codes, unique references, origin guard, shared rate limit, `recordTaxTransaction` idempotency and mismatch refusal. `checkout-payment-intent.test.js` covers the initial `taxCents: 0` fields and the tax-independent idempotency key.
