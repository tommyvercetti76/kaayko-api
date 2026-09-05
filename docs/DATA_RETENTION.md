# Store Data Retention

Last reviewed: 2026-09-05

Status: `functions/scheduled/orderRetention.js` is written, tested, and exported from `functions/index.js` as `orderRetention`. Deployment status must still be verified in Firebase before live sales.

## Policy

Order/payment financial records are retained for business, tax, refund, and dispute history. Personally identifying fields are redacted after the retention window.

Default retention behavior:

| Collection | Action | Default age |
|---|---|---|
| `orders` | Redact buyer PII; keep product, money, tax, fulfillment, and status history | 730 days |
| `payment_intents` | Redact buyer PII; keep transaction, item, tax, Stripe ids, and status history | 730 days |
| `mail` | Delete queued/sent email docs | 90 days |
| `stripe_events` | Delete webhook duplicate markers | 400 days |
| `webhook_failures` | Delete permanent failure triage docs | 400 days |
| `retention_runs` | Keep summary docs | no scheduled deletion |

## What Gets Redacted

PII fields include:

- `customerEmail`
- `customerPhone`
- `customerName`
- `shippingAddress`

The job adds:

- `piiRedacted: true`
- `piiRedactedAt`
- `piiRedactedFields`

It must not delete `orders` or `payment_intents`.

## Job

File:

- `functions/scheduled/orderRetention.js`

Export:

- `exports.orderRetention = require('./scheduled/orderRetention').orderRetention;`

Schedule:

- monthly, `04:10 UTC` on the first day of the month.

Configuration:

- `RETENTION_PII_DAYS`, default 730, floored to avoid accidental short retention.
- `MAIL_RETENTION_DAYS`, default 90, floored to avoid deleting fresh mail.

## Not Covered

- Stripe keeps its own payment processor records.
- The SMTP/mail provider and owner inbox may keep sent messages.
- Cloud logs should not contain addresses/emails and should remain that way.
- Backups/exports are outside this job.
- Deletion requests are not automated; use targeted redaction/deletion of matching order/payment/mail docs.

## Buyer-Facing Copy

Buyer-facing privacy and support copy should use the final chosen support address. If the support address is not final, keep the legal/store launch checklist marked blocked rather than inventing an address.

## Tests

Run:

```bash
cd functions
node ./node_modules/jest/bin/jest.js --runInBand __tests__/order-retention.test.js --forceExit --detectOpenHandles
```

