# 🔐 Auth API

Firebase Authentication helpers — logout, profile, and token verification.

## Files

| File | Purpose |
|------|---------|
| `authRoutes.js` | Router — mounted at `/auth` |

---

## Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/auth/logout` | Revoke refresh tokens (force logout) | `requireAuth` |
| GET | `/auth/me` | Get current user profile | `requireAuth` |
| POST | `/auth/verify` | Verify a Firebase ID token (debug) | None (token in body) |

### POST `/auth/logout`

Revokes all refresh tokens for the authenticated user. Forces logout across all devices.

**Headers:** `Authorization: Bearer <firebase_id_token>`  
**Response:** `{ success: true, message: "Logout successful", revokedAt: "..." }`

### GET `/auth/me`

Returns the authenticated user's basic info from the decoded token and `admin_users` collection.

**Headers:** `Authorization: Bearer <firebase_id_token>`  
**Response:**
```json
{
  "success": true,
  "user": {
    "uid": "abc123",
    "email": "admin@kaayko.com",
    "role": "super-admin",
    "displayName": "Admin User",
    "emailVerified": true
  }
}
```

### POST `/auth/verify`

Debug endpoint — decodes and returns the contents of a Firebase ID token. Useful for troubleshooting auth issues.

**Body:** `{ "token": "<firebase_id_token>" }`  
**Response:** `{ success: true, decoded: { uid, email, role, exp, iat } }`  
**Errors:** `401` for invalid/expired tokens

---

## Auth Middleware

Auth routes use `requireAuth` from `middleware/authMiddleware.js`:
1. Extracts `Authorization: Bearer <token>` header
2. Verifies token with Firebase Admin SDK
3. Loads user profile from `admin_users` Firestore collection
4. Attaches `req.user` with uid, email, role, permissions

---

**Test suite:** `__tests__/auth.test.js` (12 tests)
