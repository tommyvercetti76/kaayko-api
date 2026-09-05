# Kaayko API

Firebase Cloud Functions — Express.js backend serving all `/api/**` routes for the Kaayko platform.
Frontend context + module map: `/Users/Rohan/Kaayko_v6/kaayko/MODULE-MAP.md`

## Stack
- **Runtime:** Node.js Cloud Functions (Firebase)
- **Framework:** Express.js
- **Database:** Firestore (Firebase Admin SDK)
- **Auth:** Two separate systems — see "Auth pattern" below. Admin = Firebase ID token + a Firestore role lookup. Kreator = a custom HMAC session token. There are no `admin`/`kreator` boolean custom claims.
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
├── kortex/           ← /api/kortex/* (smart links, tenants, analytics, security)
├── kreators/         ← /api/kreators/* (application pipeline)
├── admin/            ← /api/admin/* (orders, restricted)
├── billing/          ← /api/billing/subscriptions
├── cameras/          ← GET /api/cameras, /lenses, /presets
├── auth/             ← POST /api/auth/logout
├── ai/               ← POST /api/gptActions (ChatGPT plugin)
└── email/            ← email utilities
```

## Auth pattern

There are **two independent auth systems**. They do not interoperate, and neither
uses a boolean custom claim. (An earlier version of this file said they did —
`decoded.admin === true` / `decoded.kreator === true`. No such claims are set or
read anywhere in the codebase. Do not write code against them.)

**Admin / Kortex** — `functions/middleware/authMiddleware.js`. Never hand-roll it;
use the exported middleware.
```js
// requireAuth: verifies the Firebase ID token, THEN reads the role from
// Firestore admin_users/{uid}. The role is not in the token.
apiApp.get("/admin/thing", requireAuth, requireAdmin, handler);
// req.user = { uid, email, role, permissions }   role ∈ super-admin|admin|editor|viewer
// requireAdmin passes for super-admin|admin, and also honours an X-Admin-Key
// header matched against ADMIN_PASSPHRASE / KORTEX_SYNC_KEY.
```
The only custom claim ever written is a string `role`, set in
`api/kortex/provisioning.js` and `api/kortex/guestRouter.js`. It is read by the
*client* (`kortex.html`) to gate the login redirect — it is not a server-side
authorization check and must never be treated as one.

**Kreator** — `functions/middleware/kreatorAuthMiddleware.js`. A custom
HMAC-SHA256 session token verified by `api/kreators/services/kreatorService.js`,
plus a `kreators/{uid}` document. Not a Firebase ID token.
```js
router.put("/products/:id", requireKreatorAuth, requireActiveKreator, handler);
// req.kreator = { uid, email, businessName, ... }
```

## Firestore collections
| Collection | Module | Description |
|------------|--------|-------------|
| `kaaykoproducts` | products | Product catalog |
| `orders` | checkout, admin | Customer orders — one doc per line item, keyed `{paymentIntentId}_item{n}`; per-item money only (`lineTotalCents`), order total lives on `payment_intents` |
| `payment_intents` | checkout | Server-priced order record; authoritative line items the webhook reads |
| `stripe_events` | checkout | Handled Stripe event IDs (webhook duplicate suppression) |
| `webhook_failures` | checkout | Permanently un-processable webhook deliveries, for triage |
| `mail` | checkout, email | Outbound mail queue. Delivered by the `mailSender` Firestore trigger (`functions/triggers/mailSender.js`) over SMTP — NOT the Firestore Send Email extension, which is not installed. Do not install it alongside: mail would send twice. |
| `paddlingSpots` | weather | Paddle spot definitions |
| `public_paddle_ratings` | weather | Public ratings from rate.html (deduped by fingerprint+spot+day) |
| `rate_limits` | weather | IP-based daily rate limits for public ratings |
| `short_links` | kortex | Short link definitions (enriched with intent, audience, etc.) |
| `click_events` | kortex | Unified click analytics (device, platform, utm, referrer) |
| `smartLinkClicks` | kortex | Legacy click log (kept for backwards compat) |
| `tenants` | kortex | Tenant configuration (slug, name, enabled, domains) |
| `security_alerts` | kortex | Bot/abuse/canary security events |
| `subscriptions` | billing | Kortex subscriptions |
| `kreator_applications` | kreators | Pending applications (underscored — an earlier version of this table said `kreatorApplications`, which does not exist) |
| `kreators` | kreators | Active creator accounts |
| `admin_users` | admin, auth | `{uid}` → `role` + `permissions`. This, not a custom claim, is what `requireAuth` reads to authorize an admin |
| `product_audit` | admin | Append-only log of every catalogue edit: who, when, field, from → to |
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
