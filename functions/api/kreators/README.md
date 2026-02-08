# 🎨 Kreators API

Complete creator lifecycle — application, admin review, onboarding, authentication (password + Google OAuth), profile management, and product CRUD.

## Files (12)

| File | Purpose |
|------|---------|
| **Routers** | |
| `kreatorRoutes.js` | Orchestrator — mounted at `/kreators`, delegates to sub-routers |
| `publicRoutes.js` | Public endpoints (apply, check status, onboarding) |
| `kreatorAuthRoutes.js` | Google OAuth (signin, connect, disconnect) |
| `profileRoutes.js` | Profile CRUD (`/me`) |
| `kreatorProductRoutes.js` | Product CRUD |
| `adminRoutes.js` | Admin endpoints (list/approve/reject applications, manage kreators) |
| `testRoutes.js` | Test-only endpoints (emulator only) |
| **Handlers** | |
| `publicHandlers.js` | Application submit, status check, onboarding |
| `kreatorAuthHandlers.js` | Google OAuth handlers |
| `kreatorProductHandlers.js` | Product CRUD + image upload (multer) |
| `adminHandlers.js` | Admin review workflow |
| `testHandlers.js` | Test helpers (emulator only) |

**Global middleware on all `/kreators` routes:** `attachClientInfo` (IP, user-agent)

---

## Endpoints (27 total)

### Public (no auth, rate-limited)

| Method | Path | Description | Rate Limit |
|--------|------|-------------|------------|
| GET | `/kreators/health` | Health check | — |
| POST | `/kreators/apply` | Submit creator application | 5/hour |
| GET | `/kreators/applications/:id/status` | Check application status | 10/min |
| POST | `/kreators/onboarding/verify` | Verify magic link token | 20/min |
| POST | `/kreators/onboarding/complete` | Set password to complete setup | 5/min |

### Auth — Google OAuth

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/kreators/auth/google/signin` | Sign in with Google | None (Google ID token in body) |
| POST | `/kreators/auth/google/connect` | Link Google to existing account | `requireKreatorAuth` |
| POST | `/kreators/auth/google/disconnect` | Unlink Google account | `requireKreatorAuth` + `requireActiveKreator` |

### Profile

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/kreators/me` | Get kreator profile | `requireKreatorAuth` |
| PUT | `/kreators/me` | Update profile | `requireKreatorAuth` + `requireActiveKreator` |
| DELETE | `/kreators/me` | Delete account | `requireKreatorAuth` + `requireActiveKreator` |

### Products

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/kreators/products` | List kreator's products | `requireKreatorAuth` |
| POST | `/kreators/products` | Create product (+ up to 5 images) | `requireKreatorAuth` + `requireActiveKreator` |
| GET | `/kreators/products/:productId` | Get single product | `requireKreatorAuth` |
| PUT | `/kreators/products/:productId` | Update product (+ images) | `requireKreatorAuth` + `requireActiveKreator` |
| DELETE | `/kreators/products/:productId` | Delete product | `requireKreatorAuth` + `requireActiveKreator` |

### Admin (Kreator management)

All require `requireAuth` (Firebase) + `requireAdmin`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/kreators/admin/applications` | List all applications |
| GET | `/kreators/admin/applications/:id` | Get application details |
| PUT | `/kreators/admin/applications/:id/approve` | Approve application |
| PUT | `/kreators/admin/applications/:id/reject` | Reject application |
| GET | `/kreators/admin/list` | List all kreators |
| GET | `/kreators/admin/:uid` | Get kreator profile |
| GET | `/kreators/admin/stats` | Platform statistics |
| POST | `/kreators/admin/:uid/resend-link` | Resend magic link |

### Test (emulator only — not available in production)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/kreators/test/list-applications` | List all applications |
| GET | `/kreators/test/list-kreators` | List all kreators |
| POST | `/kreators/test/direct-approve` | Approve without magic link |
| POST | `/kreators/test/create-test-kreator` | Create test kreator |
| GET | `/kreators/test/application/:id` | Get application detail |
| POST | `/kreators/test/login` | Login with email/password |

---

## Creator Lifecycle

```
1. APPLY        POST /kreators/apply
                  ↓
2. REVIEW       Admin: GET /kreators/admin/applications
                Admin: PUT .../approve  or  .../reject
                  ↓ (on approve)
3. ONBOARD      Magic link email → kreator clicks link
                POST /kreators/onboarding/verify  (validates token)
                POST /kreators/onboarding/complete (sets password)
                  ↓
4. ACTIVE       POST /kreators/auth/google/signin  or  JWT login
                GET/PUT /kreators/me
                CRUD /kreators/products
```

---

## Auth System

Kreators use a **separate JWT auth system** (not Firebase Auth for the admin panel):

- **Password auth:** scrypt hashing via `kreatorCrypto.js`
- **JWT tokens:** Signed with `JWT_SECRET`, verified by `kreatorAuthMiddleware.js`
- **Google OAuth:** Connect/disconnect via `kreatorOAuthService.js`
- **Magic links:** Scrypt-hashed tokens with 24h expiry for onboarding

Tokens are sent as `Authorization: Bearer <jwt>` and stored in `localStorage` as `kreator_token`.

---

## Services

| Service | Purpose |
|---------|---------|
| `kreatorService.js` | Kreator CRUD, auth login |
| `kreatorApplicationService.js` | Application submit, status check |
| `applicationApprovalService.js` | Approve/reject workflow, magic link generation |
| `applicationValidation.js` | Input validation for applications |
| `kreatorOnboardingService.js` | Magic link verification + password setup |
| `kreatorCrypto.js` | scrypt hashing, JWT sign/verify |
| `kreatorOAuthService.js` | Google OAuth connect/disconnect |

---

## Firestore Collections

| Collection | Purpose |
|------------|---------|
| `kreator_applications` | Application submissions (status: pending/approved/rejected) |
| `kreators` | Active kreator profiles |
| `kaaykoproducts` | Products created by kreators |

---

## Password Requirements

- 8–128 characters
- At least 1 uppercase, 1 lowercase, 1 number, 1 special character

---

**Test suites:**
- `__tests__/kreators.test.js` (52 tests)
- `__tests__/integration/kreator-lifecycle.integration.test.js` (23 tests)
