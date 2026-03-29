# Kaayko API

Firebase Cloud Functions — Express.js backend serving all `/api/**` routes for the Kaayko platform.
Frontend context + module map: `/Users/Rohan/Kaayko_v6/kaayko/MODULE-MAP.md`

## Stack
- **Runtime:** Node.js Cloud Functions (Firebase)
- **Framework:** Express.js
- **Database:** Firestore (Firebase Admin SDK)
- **Auth:** Firebase Admin SDK — verifies ID tokens, reads custom claims (`admin`, `kreator`)
- **Entry point:** `functions/api/index.js` — Express app root
- **Routing:** All `/api/**` → this function (defined in `kaayko/firebase.json`)

## Deploy
```bash
firebase deploy --only functions        # deploy API
firebase emulators:start --only functions  # local dev
```

## Module structure
```
functions/api/
├── index.js          ← Express app, mounts all routers
├── core/             ← health, utilities
├── products/         ← GET /api/products, voting
├── checkout/         ← POST /api/createPaymentIntent (Stripe)
├── weather/          ← GET /api/paddlingOut, /paddleScore, /forecast
├── kutz/             ← POST /api/kutz/* (nutrition, Claude AI, Fitbit)
├── smartLinks/       ← CRUD /api/smartlinks
├── kreators/         ← /api/kreators/* (application pipeline)
├── admin/            ← /api/admin/* (orders, restricted)
├── billing/          ← /api/billing/subscriptions
├── cameras/          ← GET /api/cameras, /lenses, /presets
├── auth/             ← POST /api/auth/logout
├── ai/               ← POST /api/gptActions (ChatGPT plugin)
├── email/            ← email utilities
└── deepLinks/        ← /api/l/** deep link resolution
```

## Auth pattern
```js
// Verify Firebase token (middleware used across protected routes)
const token = req.headers.authorization?.split('Bearer ')[1]
const decoded = await admin.auth().verifyIdToken(token)

// Check custom claims
decoded.admin === true    // admin operations
decoded.kreator === true  // kreator operations
```

## Firestore collections
| Collection | Module | Description |
|------------|--------|-------------|
| `kaaykoproducts` | products | Product catalog |
| `orders` | checkout, admin | Customer orders |
| `paddlingSpots` | weather | Paddle spot definitions |
| `smartlinks` | smartLinks | Smart link definitions |
| `smartLinkClicks` | smartLinks | Click event log |
| `subscriptions` | billing | Kortex subscriptions |
| `kreatorApplications` | kreators | Pending applications |
| `kreators` | kreators | Active creator accounts |
| `kreatorProducts` | kreators | Creator-submitted products |
| `users/{uid}/kutz*` | kutz | All nutrition tracking data |
| `cameras` | cameras | Camera reference data |
| `lenses` | cameras | Lens reference data |
| `presets` | cameras | Photography presets |

## External services
| Service | Module | Env var |
|---------|--------|---------|
| Stripe | checkout | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Anthropic Claude | kutz | `ANTHROPIC_API_KEY` |
| Open Food Facts | kutz | no auth (public) |
| Fitbit | kutz | `FITBIT_CLIENT_ID`, `FITBIT_CLIENT_SECRET` |
| Open-Meteo | weather | no auth (public) |
| Google OAuth | kreators | Firebase Auth built-in |

## What NOT to do
- Do not return raw Firestore errors to clients — sanitize error responses
- Do not skip auth middleware on admin or kreator endpoints
- Do not remove rate limiting on product voting
- Do not expose API keys in responses or logs
- `.claude/` is gitignored in this repo — do not fight it
