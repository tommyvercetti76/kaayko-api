# Agent Briefing

- Track: `kortex`
- Area: `kortex`
- Goal: Fix the following low severity issue: Firestore Query Handling in Tenant Context Management. Detail: The createTenantScopedQuery function uses Firestore queries that are automatically scoped by tenantId, but the query logic is not immediately clear from the method name or usage. Consider adding more descriptive comments for maintainability.
- Guided products: KORTEX Platform API, Shared API Infrastructure
- Primary focus products: KORTEX Platform API
- Source docs: README.md, functions/api/smartLinks/README.md, functions/middleware/README.md

## Portfolio Overview

Kaayko API is a Firebase Cloud Functions Express backend. Every route is mounted through functions/index.js. Safe agent work must preserve route contracts, auth middleware chains, Firestore access patterns, and existing error-handling shapes. Security and tenant isolation are the highest-priority concerns.

## Focused Doc Snapshots

- README.md: Kaayko API What this repo powers | Product | Purpose | Mounted base paths on `api` | Primary frontend consumers | Product guide | | Kreator | Creator applications, onboarding, profile, admin review | `/kreators` | `kaayko/src/kreator/*` | [`docs/products/KREATOR.md`](./docs/products/KREATOR.md) | Architecture Runtime: Firebase Functions v2, Node.js 22, Express app exported as `api`. Storage and state: Firebase Admin, Firestore, Cloud Storage, Firebase Auth. Payments: Stripe checkout/payment intent and webhook flows.
- functions/api/smartLinks/README.md: 🔗 Smart Links API v4 — Short codes & Link Management This module implements the Smart Links service used by Kaayko to create short shareable links (short codes + optional semantic paths), handle redirects and track analytics. `smartLinks.js` — primary Express router for `/api/smartlinks` `smartLinkService.js` — core CRUD + stats business logic (writes to Firestore) `redirectHandler.js` — redirect logic, platform detection, click tracking `publicRouter.js` — lightweight public router for `/l/:id` and `/resolve` (deferred linking) helpers: `smartLinkValidation.js`, `smartLinkDefaults.js`, `smartLinkEnrichment.js` For each endpoint we show: Endpoint, Method, Description, Auth, Request (path / query / body), Response (shape + example), Errors, Side effects.

## KORTEX Platform API

- Priority: primary
- Purpose: Protect smart-link CRUD, tenant auth claims, redirect handling, analytics recording, billing visibility, and QR flows as a security-critical multi-tenant surface.
- Source docs:
- README.md
- functions/api/smartLinks/README.md
- API paths:
- functions/api/smartLinks/
- functions/api/billing/
- functions/api/auth/
- Backend routes:
- GET /smartlinks
- POST /smartlinks
- PUT /smartlinks/:id
- DELETE /smartlinks/:id
- GET /l/:id
- GET /resolve
- GET /billing/*
- GET /auth/*
- Validation focus:
- Verify tenant isolation — every data read/write must scope to the authenticated tenant.
- Confirm public redirect paths cannot access admin data or mutation endpoints.
- Validate auth claim checks (admin boolean) run before any tenant-mutation route.
- Ensure analytics recording is append-only and cannot be manipulated by the client.
- Risk focus:
- KORTEX has the highest tenant isolation risk — a missing scope check leaks all tenant data.
- Public redirect (/l/:id) is unauthenticated — it must never resolve admin routes.
- Billing endpoints must be read-only from the tenant perspective.
- Auth token claims must be verified server-side — never trust client-sent admin flags.

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

