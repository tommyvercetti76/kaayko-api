# Firebase Functions

Last reviewed: 2026-09-05

This directory contains the Firebase Functions v2 backend for Kaayko. The main exported HTTP API is `api` in `index.js`.

## Runtime Truth

- Main API: `index.js`
- Route modules: `api/`
- Middleware: `middleware/`
- Scheduled jobs: `scheduled/`
- Store mail trigger: `triggers/mailSender.js`
- Tests: `__tests__/`

## Maintained Docs

- [`../docs/README.md`](../docs/README.md) - backend docs index.
- [`api/README.md`](./api/README.md) - mounted API module map.
- [`../docs/products/STORE.md`](../docs/products/STORE.md) - store backend map.
- [`../docs/products/PADDLING_OUT.md`](../docs/products/PADDLING_OUT.md) - Paddling Out backend map.
- [`docs/admin/README.md`](./docs/admin/README.md) - admin docs that exist in this checkout.

## Local Development

```bash
npm install
npm run serve
```

## Deploy Commands

```bash
npm run deploy:api
npm run deploy:store
npm run deploy
```

Note: `package.json` still contains a `deploy:scheduled` script with legacy forecast scheduler function names. Verify and update that script before using it.

## Current Scheduled/Background Exports

From `index.js`:

- `warmPaddleScoreCache`
- `aggregatePaddleFeedback`
- `enrichmentFreshness`
- `mailSender`
- `orderRetention`
- KORTEX scheduled jobs defined near the bottom of `index.js`

The older forecast scheduler export group was deleted because it warmed cache keys no live endpoint read.

## Critical Store Tests

Run from this directory:

```bash
node ./node_modules/jest/bin/jest.js --runInBand \
  __tests__/store-api.test.js \
  __tests__/checkout-payment-intent.test.js \
  __tests__/checkout-webhook.test.js \
  __tests__/checkout-tax.test.js \
  __tests__/checkout-refunds-disputes.test.js \
  __tests__/order-fulfilment.test.js \
  __tests__/order-delay-notice.test.js \
  __tests__/mail-sender.test.js \
  __tests__/order-retention.test.js \
  __tests__/admin-products.test.js \
  __tests__/auth-platform-admin.test.js \
  --forceExit --detectOpenHandles
```

## Critical Paddling Out Tests

```bash
npm run test:paddlingout
node ./node_modules/jest/bin/jest.js --runInBand __tests__/weather-paddle-score.test.js --forceExit --detectOpenHandles
```

## Security Reminders

- Store admin routes use Firebase auth plus platform-admin authorization.
- Paddling admin submission routes require admin auth.
- Stripe webhook raw-body parsing must remain before global JSON parsing.
- Do not expose payment, order, mail, or private submission data through public routes.

