# Data retention — Kaayko Store

**Status:** `scheduled/orderRetention.js` written and tested; needs the `index.js` export and a deploy. Pre-launch compliance audit item #8.

## The problem

`privacy.html` promised that shipping information is kept "for up to 2 years or until you request deletion", and that without consent order data is "not permanently retained by Kaayko". Neither was true in code:

- nothing ever removed anything — `orders`, `payment_intents` and the queued `mail` documents (rendered emails containing the name and address) lived forever;
- the webhook stores the email and shipping address on every order regardless of the consent checkbox, because it cannot ship without them;
- two years is *shorter* than the period tax and accounting records must be kept, so "delete the order after two years" would have been the wrong promise anyway.

## The policy now implemented: keep the transaction, drop the person

Order records are never deleted. Once a record is old enough, the fields that identify a human are removed and everything that makes it a financial record stays.

| Collection | What it holds | Action | After |
|---|---|---|---|
| `orders` | one doc per line item: product, size, quantity, money, status, tracking, **email, phone, name, shipping address** | **redact** `customerEmail`, `customerPhone`, `customerName` → `null`; `shippingAddress` → `{redacted: true, redactedAt}`; add `piiRedacted: true`, `piiRedactedAt`, `piiRedactedFields` | `RETENTION_PII_DAYS` (default **730**) |
| `payment_intents` | the order-level record: items, subtotal, **tax**, total, status, tax calculation/transaction ids, **email, phone, shipping address** | same redaction; `taxCents`, `totalCents`, `taxCalculationId`, `taxTransactionId`, `taxJurisdiction`, `chargeId`, items, statuses untouched | `RETENTION_PII_DAYS` (default **730**) |
| `mail` | queued/sent emails — full HTML with the address in it | **delete** | `MAIL_RETENTION_DAYS` (default **90**) |
| `stripe_events` | webhook duplicate-suppression markers | **delete** | 400 days (fixed) |
| `webhook_failures` | triage records for un-processable deliveries | **delete** | 400 days (fixed) |
| `retention_runs` | one small summary per run | kept | — |

Nothing here touches Stripe's own copy of the payment (name, address, card details) — Stripe holds that as processor under its own retention rules, and the privacy policy should say so.

## The job

`functions/scheduled/orderRetention.js` — `onSchedule`, **04:10 UTC on the 1st of each month**, region `us-central1`, 256 MiB, 540 s timeout.

Wire it in `functions/index.js`:

```js
exports.orderRetention = require('./scheduled/orderRetention').orderRetention;
```

Deploy: `firebase deploy --config ../firebase.json --only functions:orderRetention` (from `functions/`). To run it by hand, open the Cloud Scheduler job Firebase creates (`firebase-schedule-orderRetention-us-central1`) in the Google Cloud console and choose *Force run*.

Properties:

- **Idempotent.** A document carrying `piiRedacted: true` is skipped, so a repeat run redacts nothing twice and never moves the original `redactedAt`. Deletions are naturally idempotent.
- **Chunked.** At most 400 writes per Firestore batch (limit is 500), each chunk committed separately.
- **Resumable.** A crash or the deadline (8 minutes of the 9-minute timeout) loses nothing already committed; the next run simply continues. Such a run writes `complete: false, stoppedEarly: true`.
- **Ages are double-checked in memory** from each document's own timestamp before it is touched; documents without a readable timestamp are left alone. Both Firestore `Timestamp` and the legacy ISO-string `createdAt` (December 2025 schema) are handled.
- **Deletion is only possible for `mail`, `stripe_events`, `webhook_failures`.** There is no code path that deletes an `orders` or `payment_intents` document; the tests assert it.
- **Floors on the env values.** `RETENTION_PII_DAYS` below 30 or `MAIL_RETENTION_DAYS` below 7 (or non-numeric) fall back to the defaults instead of redacting live orders.
- **Summary** written to `retention_runs/{YYYY-MM-DD}`: cutoffs, config, per-collection `scanned / redacted / deleted / alreadyRedacted / nothingToRedact / skippedTooYoung / skippedUndated / pages / commits`, errors, `complete`. A collection error is recorded and the remaining collections still run; the function then fails so it shows in the Functions console.

Env (`functions/.env`, plain config, not secrets): `RETENTION_PII_DAYS=730`, `MAIL_RETENTION_DAYS=90`.

Queries used: `where(field, '<', cutoff).orderBy(field).limit(400)` on `createdAt` (`processedAt` for `stripe_events`) — single-field, no composite index required.

`runRetentionOnce({ now, db, chunkSize, deadlineMs, env })` is exported for tests and scripts; it returns the summary it wrote.

## Alternative for the delete-only collections: Firestore TTL policies

`mail`, `stripe_events` and `webhook_failures` are pure expiry cases, which is exactly what a Firestore **TTL policy** does natively: Firestore deletes a document once the Timestamp in its TTL field is in the past (typically within 24 hours of expiry; billed as ordinary deletes).

What it needs — and why the job is the live mechanism today:

1. TTL keys off an **expiry** timestamp, not a creation one. The writers must stamp `expireAt` (creation + 90 days for `mail`, + 400 days for the event collections): `queueMailOnce` in `api/email/render.js`, `markEventProcessed` / `recordWebhookFailure` in `api/checkout/stripeWebhook.js`, and the new mail sender trigger. None do yet.
2. Enable the policy once per collection:
   ```bash
   gcloud firestore fields ttls update expireAt --collection-group=mail             --enable-ttl --project=kaaykostore
   gcloud firestore fields ttls update expireAt --collection-group=stripe_events    --enable-ttl --project=kaaykostore
   gcloud firestore fields ttls update expireAt --collection-group=webhook_failures --enable-ttl --project=kaaykostore
   ```
   (or Firebase console → Firestore → *Time-to-live*).
3. Existing documents without `expireAt` are never expired by TTL — the scheduled job still has to sweep the backlog.

TTL must **not** be enabled on `orders` or `payment_intents`: the policy is redaction, never deletion. Once writers stamp `expireAt`, the three delete steps in the job become a safety net and can stay as they are.

## What `privacy.html` should say

Replace the two bullets under **Data Retention → Order Data** with:

> **Order records:** what you bought, what you paid, the sales tax charged and the payment status are kept for as long as tax and accounting rules require. Stripe, our payment processor, keeps its own record of the payment under its privacy policy.
>
> **Your details on an order:** your name, email address, phone number and shipping address are removed from our order records automatically 2 years after the order, or earlier if you ask us at rohan@kaayko.com. Copies of order emails in our sending queue are deleted after 90 days.

And drop the "Without Consent … not permanently retained" bullet: the address and email are stored for every order because fulfilment needs them. The consent checkbox at checkout (`dataRetentionConsent`) now only records a preference; either give it a real meaning (e.g. shorter redaction for non-consenting shoppers) or remove it from the form.

## Not covered by the job (be honest in the policy)

- **Stripe's records** — Stripe retains payment data (including shipping/billing details) as processor; Kaayko cannot delete it.
- **Sent email** — the mail provider (SendGrid/Gmail) and the owner's own inbox keep the order-notification emails, which contain the address.
- **Cloud Logging** — Functions logs (30 days per the policy) contain payment-intent ids and the shipping state, not addresses or emails; keep it that way.
- **Backups / exports** of Firestore, if any are taken.
- **Deletion requests** — the job is age-based only. For a "delete my data" request, redact the specific `orders/{pi}_item*` and `payment_intents/{pi}` documents by hand (same fields as above) and remove the matching `mail/{pi}_*` documents; a small script using `planRedaction()` from the module would do it.

## Tests

`functions/__tests__/order-retention.test.js` — redaction on old orders/intents with money, tax, product and status fields intact; younger records untouched; exclusive cutoff; idempotent second run; legacy ISO-string timestamps; undated documents skipped; `mail` / `stripe_events` / `webhook_failures` expiry; orders never deleted; env overrides and floors; summary document; deadline stop; per-collection error isolation; the scheduled export; and cursor pagination with one commit per chunk against an in-memory Firestore double.
