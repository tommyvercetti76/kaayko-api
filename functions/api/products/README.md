# Products And Images API

Last reviewed: 2026-09-05

This module powers the public kaay.store catalog and image proxy.

## Routes

Mounted in `functions/index.js`:

- `GET /products`
- `GET /products/:id`
- `POST /products/:id/vote`
- `GET /images/health`
- `GET /images`
- `GET /images/:productId/:fileName`

## Files

- `products.js`
- `images.js`

## Product Contract

Public product responses expose only store-safe fields. Hidden, unavailable, sold-out, and soft-deleted handling must stay server-side.

Important public fields:

- `id`
- `title`
- `description`
- `price`
- `actualPrice`
- `type`
- `category`
- `tags`
- `availableSizes`
- `availableColors`
- `imgSrc`
- `votes`
- `soldOut`

`actualPrice` should be the preferred launch-ready money field. Tier `price` is currently still supported as a fallback by checkout pricing.

## Security

- Product browsing is public.
- Voting is public and rate-limited in-process.
- Do not expose seller/admin-only fields.
- Do not trust product price from the browser during checkout.

## Tests

Run:

```bash
node ./node_modules/jest/bin/jest.js --runInBand __tests__/store-api.test.js --forceExit --detectOpenHandles
```

