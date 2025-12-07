# 🔐 Authentication Routes

This module implements authentication helpers and session endpoints used by the frontend and other services. The router `authRoutes.js` exposes auth-related endpoints in this folder.

Mount status: `authRoutes.js` is mounted in `functions/index.js` at `/auth` (endpoints: `/auth/logout`, `/auth/me`, `/auth/verify`).

Files
- `authRoutes.js` — logout, me, and token verification endpoints

Endpoints implemented (code-driven)

POST /logout
Method: POST
Path: /api/auth/logout
Description: Revoke a user's refresh tokens to force logout across devices. Uses `requireAuth` middleware in the handler.
Auth: requireAuth (token required)
Body: none
Response: { success: true, message: 'Logout successful', revokedAt }
Errors: 500 internal error

GET /me
Method: GET
Path: /api/auth/me
Description: Returns authenticated user's basic info (uid, email, role, displayName, emailVerified). Uses `requireAuth` middleware.
Auth: requireAuth
Response: { success: true, user: { uid, email, role, displayName, emailVerified } }

POST /verify
Method: POST
Path: /api/auth/verify
Description: Debug/debugging endpoint — verify a provided Firebase ID token and return decoded token contents.
Auth: none required (accepts token in body); primarily useful for debugging.
Body: { token }
Response: { success: true, decoded: { uid, email, role, exp, iat } } or 401 for invalid/expired tokens

Security notes:
- `requireAuth` depends on Firebase ID tokens in Authorization: Bearer <token> header. See `middleware/authMiddleware.js` for verification logic and role/permission loading.
