You are selecting files for a local coding agent run on a Node.js Firebase Cloud Functions API.
Run ID: kortex-fix-the-following-low-severity-issue-redundant-error-messages-in-auth-middleware-20260418-160351z
Track: kortex
Area: kortex
Goal: Fix the following low severity issue: Redundant Error Messages in Auth Middleware. Detail: The requireAuth and requireAdmin functions return similar error messages for different authentication failures. This can be refactored into a single function or constant to avoid redundancy.
Mode: edit

PORTFOLIO COACHING
Portfolio overview: Kaayko API is a Firebase Cloud Functions Express backend. Every route is mounted through functions/index.js. Safe agent work must preserve route contracts, auth middleware chains, Firestore access patterns, and existing error-handling shapes. Security and tenant isolation are the highest-priority concerns.
Guided products: KORTEX Platform API, Shared API Infrastructure
Primary focus products: KORTEX Platform API, Shared API Infrastructure
Source docs: README.md, functions/api/smartLinks/README.md, functions/middleware/README.md

Focused doc snapshots:
- README.md: Kaayko API What this repo powers | Product | Purpose | Mounted base paths on `api` | Primary frontend consumers | Product guide | | Kreator | Creator applications, onboarding, profile, admin review | `/kreators` | `kaayko/src/kreator/*` | [`docs/products/KREATOR.md`](./docs/products/KREATOR.md) | Architecture Runtime: Firebase Functions v2, Node.js 22, Express app exported as `api`. Storage and state: Firebase Admin, Firestore, Cloud Storage, Firebase Auth. Payments: Stripe checkout/payment intent and webhook flows.
- functions/api/smartLinks/README.md: 🔗 Smart Links API v4 — Short codes & Link Management This module implements the Smart Links service used by Kaayko to create short shareable links (short codes + optional semantic paths), handle redirects and track analytics. `smartLinks.js` — primary Express router for `/api/smartlinks` `smartLinkService.js` — core CRUD + stats business logic (writes to Firestore) `redirectHandler.js` — redirect logic, platform detection, click tracking `publicRouter.js` — lightweight public router for `/l/:id` and `/resolve` (deferred linking) helpers: `smartLinkValidation.js`, `smartLinkDefaults.js`, `smartLinkEnrichment.js` For each endpoint we show: Endpoint, Method, Description, Auth, Request (path / query / body), Response (shape + example), Errors, Side effects.
- functions/middleware/README.md: Document not found in the current workspace.

Product: KORTEX Platform API (Primary focus)
Purpose: Protect smart-link CRUD, tenant auth claims, redirect handling, analytics recording, billing visibility, and QR flows as a security-critical multi-tenant surface.
API paths:
  - functions/api/smartLinks/
  - functions/api/billing/
  - functions/api/auth/
Backend routes:
  - GET /smartlinks
  - POST /smartlinks
  - PUT /smartlinks/:id
  - DELETE /smartlinks/:id
  - GET /l/:id
  - GET /resolve
  - GET /billing/*
  - GET /auth/*
Validation focus:
  - Verify tenant isolation — every data read/write must scope to the authenticated tenant.
  - Confirm public redirect paths cannot access admin data or mutation endpoints.
  - Validate auth claim checks (admin boolean) run before any tenant-mutation route.
  - Ensure analytics recording is append-only and cannot be manipulated by the client.
Risk focus:
  - KORTEX has the highest tenant isolation risk — a missing scope check leaks all tenant data.
  - Public redirect (/l/:id) is unauthenticated — it must never resolve admin routes.
  - Billing endpoints must be read-only from the tenant perspective.
  - Auth token claims must be verified server-side — never trust client-sent admin flags.

Product: Shared API Infrastructure (Primary focus)
Purpose: Protect the middleware stack, auth guards, error handling, CORS, Firebase Admin initialization, and rate limiting that all routes depend on.
API paths:
  - functions/middleware/
  - functions/api/core/
  - functions/index.js
  - functions/api/auth/
  - functions/utils/
Backend routes:
  - /health
  - /api/**
Validation focus:
  - Verify middleware execution order is preserved for every mounted router.
  - Ensure auth claim validation runs before any data mutation endpoint.
  - Confirm error handlers return consistent shapes without leaking stack traces.
  - Validate Firebase Admin SDK is initialized once and not duplicated per-request.
Risk focus:
  - Middleware order bugs are silent — a reorder can bypass security checks entirely.
  - Firebase Admin double-initialization causes memory and auth failures.
  - Error shape inconsistencies cause frontend parsing failures across multiple products.
  - CORS misconfiguration can silently allow unauthorized cross-origin requests.

Choose the files most relevant to achieving this goal. Use the coaching context above to prioritize files on critical API paths.
Return JSON only with this shape:
{"selected_files":["repo:path"],"reasoning":["short reason"]}

Rules:
- Select between 4 and 8 files.
- Prefer source files over test files or generated files.
- Prefer files where a small, behavior-preserving cleanup is plausible.
- Bias toward files that sit on critical API paths documented in the coaching section.
- Use exact `repo:path` strings from the inventory.

Inventory:
- api:functions/middleware/authMiddleware.js | 316 lines | 8842 bytes | score 44
- api:functions/middleware/kreatorAuthMiddleware.js | 313 lines | 8223 bytes | score 44
- api:functions/middleware/apiKeyMiddleware.js | 325 lines | 8488 bytes | score 39
- api:functions/middleware/rateLimit.js | 14 lines | 421 bytes | score 39
- api:functions/middleware/securityMiddleware.js | 232 lines | 6652 bytes | score 39
- api:functions/api/auth/authRoutes.js | 109 lines | 2788 bytes | score 31
- api:functions/api/smartLinks/redirectHandler.js | 401 lines | 12403 bytes | score 27
- api:functions/api/smartLinks/attributionService.js | 303 lines | 8142 bytes | score 26
- api:functions/api/smartLinks/publicApiRouter.js | 396 lines | 10208 bytes | score 26
- api:functions/api/smartLinks/publicRouter.js | 214 lines | 7274 bytes | score 26
- api:functions/api/smartLinks/rateLimitService.js | 314 lines | 8778 bytes | score 26
- api:functions/api/smartLinks/smartLinkDefaults.js | 108 lines | 3519 bytes | score 26
- api:functions/api/smartLinks/smartLinkEnrichment.js | 163 lines | 4500 bytes | score 26
- api:functions/api/smartLinks/smartLinkService.js | 284 lines | 7563 bytes | score 26
- api:functions/api/smartLinks/smartLinkValidation.js | 84 lines | 2108 bytes | score 26
- api:functions/api/smartLinks/tenantContext.js | 265 lines | 7720 bytes | score 26
- api:functions/api/smartLinks/webhookService.js | 393 lines | 10144 bytes | score 26
- api:functions/api/billing/router.js | 433 lines | 12669 bytes | score 22
- api:functions/api/smartLinks/clickTracking.js | 457 lines | 12307 bytes | score 22
- api:functions/api/smartLinks/smartLinks.js | 498 lines | 15657 bytes | score 22
