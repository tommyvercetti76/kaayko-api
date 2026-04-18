# Agent Briefing

- Track: `commerce`
- Area: `commerce`
- Goal: Audit checkout and payment flows for security issues
- Guided products: Commerce & Checkout API, Shared API Infrastructure
- Primary focus products: Commerce & Checkout API
- Source docs: README.md, functions/api/products/README.md, functions/api/checkout/README.md, functions/middleware/README.md

## Portfolio Overview

Kaayko API is a Firebase Cloud Functions Express backend. Every route is mounted through functions/index.js. Safe agent work must preserve route contracts, auth middleware chains, Firestore access patterns, and existing error-handling shapes. Security and tenant isolation are the highest-priority concerns.

## Focused Doc Snapshots

- README.md: Kaayko API What this repo powers | Product | Purpose | Mounted base paths on `api` | Primary frontend consumers | Product guide | | Kreator | Creator applications, onboarding, profile, admin review | `/kreators` | `kaayko/src/kreator/*` | [`docs/products/KREATOR.md`](./docs/products/KREATOR.md) | Architecture Runtime: Firebase Functions v2, Node.js 22, Express app exported as `api`. Storage and state: Firebase Admin, Firestore, Cloud Storage, Firebase Auth. Payments: Stripe checkout/payment intent and webhook flows.
- functions/api/products/README.md: 🛍️ Products & Images APIs *E-commerce product catalog and image serving** 📁 Files in this Module 1. **`products.js`** - Product catalog API 2. **`images.js`** - Image proxy service 🛍️ API #1: Products `GET /api/products` - List all products `GET /api/products/:productId` - Get single product
- functions/api/checkout/README.md: Kaayko Checkout System Complete email notification system for Stripe payments with customer confirmations and admin alerts. 🎯 Overview ✅ Email collection during Stripe checkout (mandatory) ✅ Order confirmation page with email display ✅ Webhook processing for payment events ✅ Dual email notifications (customer + admin) ✅ Order storage in Firestore

## Commerce & Checkout API

- Priority: primary
- Purpose: Protect the products catalog, voting, image serving, Stripe payment intent creation, and order-completion flow as a paired, transaction-critical surface.
- Source docs:
- README.md
- functions/api/products/README.md
- functions/api/checkout/README.md
- API paths:
- functions/api/products/
- functions/api/checkout/
- Backend routes:
- GET /products
- GET /products/:id
- POST /products/:id/vote
- GET /images/:productId/:fileName
- POST /createPaymentIntent
- POST /createPaymentIntent/updateEmail
- Validation focus:
- Validate product fetch, image serving, voting, and checkout as one paired flow.
- Confirm Stripe payment intent creation returns the correct client secret shape.
- Verify vote rate limiting middleware is still active and correctly scoped.
- Ensure image serving enforces content-type and does not expose directory listings.
- Risk focus:
- Stripe webhook and intent handling are transaction-critical — no silent fallbacks.
- Rate limiting on vote endpoints must not be removed or weakened during cleanup.
- Image serving routes must validate productId before reading from storage.
- Checkout email update must not allow overwriting a confirmed payment's email.

## Shared API Infrastructure

- Priority: supporting
- Purpose: Protect the middleware stack, auth guards, error handling, CORS, Firebase Admin initialization, and rate limiting that all routes depend on.
- Source docs:
- README.md
- functions/middleware/README.md
- API paths:
- functions/middleware/
- functions/api/core/
- functions/index.js
- functions/api/auth/
- functions/utils/
- Backend routes:
- /health
- /api/**
- Validation focus:
- Verify middleware execution order is preserved for every mounted router.
- Ensure auth claim validation runs before any data mutation endpoint.
- Confirm error handlers return consistent shapes without leaking stack traces.
- Validate Firebase Admin SDK is initialized once and not duplicated per-request.
- Risk focus:
- Middleware order bugs are silent — a reorder can bypass security checks entirely.
- Firebase Admin double-initialization causes memory and auth failures.
- Error shape inconsistencies cause frontend parsing failures across multiple products.
- CORS misconfiguration can silently allow unauthorized cross-origin requests.

