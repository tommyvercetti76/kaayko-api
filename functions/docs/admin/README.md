# 🔐 Admin System Documentation

Technical documentation for the Kaayko admin authentication and management system.

> **Last updated:** February 2026 (v5 overhaul)

---

## Documents

| Document | Description |
|----------|-------------|
| [QUICK_DEPLOY.md](QUICK_DEPLOY.md) | 5-minute deployment card |
| [SECURITY_AUDIT_SUMMARY.md](SECURITY_AUDIT_SUMMARY.md) | Security audit results (score: 9/10) |
| [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) | Pre-deployment security checklist |
| [AUTHENTICATION_README.md](AUTHENTICATION_README.md) | JWT token flow, middleware, architecture |
| [AUTHENTICATION_COMPLETE.md](AUTHENTICATION_COMPLETE.md) | Full implementation guide |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Step-by-step deployment |
| [ADMIN_MANAGEMENT_GUIDE.md](ADMIN_MANAGEMENT_GUIDE.md) | User and role management |
| [TESTING_GUIDE.md](TESTING_GUIDE.md) | Local and production testing procedures |

---

## Architecture Overview

- **Auth provider:** Firebase Authentication
- **Middleware:** `authMiddleware.js` → `requireAuth` (verifies Firebase ID token) → `requireAdmin` (checks `admins` collection)
- **Admin panel:** `/admin/` frontend pages (login, dashboard, order management)
- **Admin account:** `rohan@kaayko.com` (role: `super_admin`)

---

## Auth Flow

```
1. Admin signs in via Firebase Auth (email/password)
2. Frontend gets Firebase ID token
3. Every API request sends: Authorization: Bearer <firebase-id-token>
4. authMiddleware verifies token via Firebase Admin SDK
5. requireAdmin checks uid against `admins` Firestore collection
6. Request proceeds to handler
```

---

## Related API Modules

| Module | Endpoints | Description |
|--------|-----------|-------------|
| [Admin API](../../api/admin/README.md) | 10 endpoints | Order + user management |
| [Kreators Admin](../../api/kreators/README.md) | 8 endpoints | Application review + kreator management |

---

## Security Highlights

- Firebase Auth token verification on every request
- Role-based access control via Firestore `admins` collection
- Rate limiting on all API routes
- CORS restricted to allowed origins
- Security headers via `securityMiddleware.js`
