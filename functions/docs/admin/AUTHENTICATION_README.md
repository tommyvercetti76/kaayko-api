# 🔐 Kaayko Admin Authentication System

**Enterprise-grade authentication with Firebase Auth + Role-Based Access Control (RBAC)**

---

## 🎯 Overview

Complete authentication system built on Firebase Authentication with:
- ✅ **Firebase Auth** - Industry-standard OAuth2/JWT tokens
- ✅ **Role-Based Access Control** - 4 roles with granular permissions
- ✅ **Backend Token Verification** - Secure API endpoint protection
- ✅ **Admin User Management** - Full CRUD for admin users
- ✅ **Enterprise UI** - Professional login portal

---

## 🏗️ Architecture

```
┌─────────────────┐
│  Frontend       │
│  (login.html)   │
└────────┬────────┘
         │ Firebase Auth
         │ (ID Token)
         ▼
┌─────────────────┐
│  Firebase Auth  │
│  (Google OAuth) │
└────────┬────────┘
         │ ID Token
         ▼
┌─────────────────┐
│  API Middleware │
│  (verifyToken)  │
└────────┬────────┘
         │ Validated User
         ▼
┌─────────────────┐
│  Firestore      │
│  admin_users    │
│  (Roles/Perms)  │
└─────────────────┘
```

---

## 👥 User Roles

### **super-admin**
- Full system access
- Can manage other admins
- Cannot be self-demoted
- Permissions: `*` (all)

### **admin**
- Full access to Smart Links
- Can create/edit/delete links
- Cannot manage admin users
- Permissions: `smartlinks:*`, `analytics:read`, `qr:create`

### **editor**
- Can create/edit links
- Cannot delete links
- Cannot manage users
- Permissions: `smartlinks:create`, `smartlinks:read`, `smartlinks:update`

### **viewer**
- Read-only access
- Can view links and analytics
- Cannot modify anything
- Permissions: `smartlinks:read`, `analytics:read`

---

## 🚀 Quick Start

### Step 1: Initialize First Admin

Create your first super-admin user:

```bash
cd /Users/Rohan/Desktop/kaayko-monorepo/api/functions

# Local environment (emulator)
node scripts/initFirstAdmin.js admin@kaayko.com YourSecurePassword123!

# Check it worked
firebase emulators:start --only functions,firestore,auth
```

### Step 2: Login

Open the admin login page:

**Local:**
```
file:///Users/Rohan/Desktop/kaayko-monorepo/frontend/src/admin/login.html
```

Or open the file:
```bash
open /Users/Rohan/Desktop/kaayko-monorepo/frontend/src/admin/login.html
```

**Production:**
```
https://kaaykostore.web.app/admin/login.html
```

Login with the credentials you created in Step 1.

### Step 3: Access Protected Portal

After login, you'll be redirected to:
```
/admin/smartlinks.html
```

All API requests will now include your auth token automatically.

---

## 📋 API Endpoints

### Admin User Management

#### Get Current User Profile
```bash
GET /api/admin/me
Authorization: Bearer <id_token>
```

**Response:**
```json
{
  "success": true,
  "user": {
    "uid": "abc123",
    "email": "admin@kaayko.com",
    "displayName": "Super Admin",
    "role": "super-admin",
    "permissions": ["*"],
    "lastLoginAt": "2025-11-09T..."
  }
}
```

#### List All Admin Users
```bash
GET /api/admin/users
Authorization: Bearer <id_token>
```

**Requires:** `super-admin` role

#### Create Admin User
```bash
POST /api/admin/users
Authorization: Bearer <id_token>

{
  "email": "editor@kaayko.com",
  "password": "SecurePass123!",
  "displayName": "John Editor",
  "role": "editor"
}
```

**Requires:** `super-admin` role

#### Update Admin User
```bash
PUT /api/admin/users/:uid
Authorization: Bearer <id_token>

{
  "role": "admin",
  "displayName": "Updated Name"
}
```

**Requires:** `super-admin` role

#### Delete Admin User
```bash
DELETE /api/admin/users/:uid
Authorization: Bearer <id_token>
```

**Requires:** `super-admin` role  
**Note:** Soft delete - just disables the user

---

## 🔒 Protected Smart Links API

All Smart Links endpoints now require authentication:

### Create Link (Requires Auth)
```bash
POST /api/smartlinks
Authorization: Bearer <id_token>

{
  "title": "My Link",
  "webDestination": "https://kaayko.com"
}
```

**Permissions Required:** `smartlinks:create`

### List Links (Requires Auth)
```bash
GET /api/smartlinks
Authorization: Bearer <id_token>
```

**Permissions Required:** `smartlinks:read`

### Update Link (Requires Auth)
```bash
PUT /api/smartlinks/:code
Authorization: Bearer <id_token>
```

**Permissions Required:** `smartlinks:update`

### Delete Link (Requires Admin)
```bash
DELETE /api/smartlinks/:code
Authorization: Bearer <id_token>
```

**Permissions Required:** `admin` or `super-admin` role

---

## 🧪 Testing Authentication

### Test 1: Create Admin User (Local)

```bash
cd /Users/Rohan/Desktop/kaayko-monorepo/api/functions

# Start emulator
firebase emulators:start --only functions,firestore,auth

# In another terminal, create admin
node scripts/initFirstAdmin.js test@kaayko.com TestPass123!
```

### Test 2: Login via Portal

1. Open: `file:///.../frontend/src/admin/login.html`
2. Enter: `test@kaayko.com` / `TestPass123!`
3. Should redirect to Smart Links portal
4. Browser console should show:
   ```javascript
   ✅ Authenticated as: test@kaayko.com
   👤 Role: super-admin
   🔑 Token stored
   ```

### Test 3: Test Protected API

```bash
# Get ID token from browser console
# localStorage.getItem('kaayko_admin_token')

# Test authenticated request
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
  http://127.0.0.1:5001/kaaykostore/us-central1/api/admin/me

# Should return your user profile
```

### Test 4: Test Unauthorized Access

```bash
# Try without token
curl http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks

# Should return 401 Unauthorized
```

---

## 🛠️ Implementation Details

### Backend Files

#### Middleware
```
api/functions/middleware/
└── authMiddleware.js         # Token verification + RBAC
```

**Functions:**
- `requireAuth` - Verify Firebase ID token
- `requireAdmin` - Require admin/super-admin role
- `requireRole(roles)` - Require specific role(s)
- `requirePermission(perms)` - Require specific permission(s)
- `optionalAuth` - Optional auth (doesn't block if missing)

#### Services
```
api/functions/services/
└── adminUserService.js       # Admin user CRUD + roles
```

**Functions:**
- `createAdminUser(uid, data)` - Create admin user
- `getAdminUser(uid)` - Get by UID
- `getAdminUserByEmail(email)` - Get by email
- `listAdminUsers(filters)` - List with filters
- `updateAdminUser(uid, updates)` - Update admin
- `deleteAdminUser(uid)` - Soft delete
- `initializeFirstAdmin(email, password)` - First setup

#### API Routes
```
api/functions/api/admin/
└── adminUsers.js            # Admin management endpoints
```

**Endpoints:**
- `GET /api/admin/me` - Current user profile
- `GET /api/admin/users` - List all admins
- `POST /api/admin/users` - Create admin
- `PUT /api/admin/users/:uid` - Update admin
- `DELETE /api/admin/users/:uid` - Delete admin
- `GET /api/admin/roles` - List available roles

### Frontend Files

```
frontend/src/admin/
└── login.html               # Login portal with Firebase Auth SDK
```

**Features:**
- Firebase Auth integration
- Environment switcher (local/prod)
- Token storage in localStorage
- Auto-redirect if already logged in
- Error handling with user-friendly messages

---

## 🔐 Security Features

### Token Verification
- ✅ **ID Token Verification** - Firebase Admin SDK verifies all tokens
- ✅ **Expiration Checking** - Tokens expire after 1 hour
- ✅ **Revocation Support** - Can revoke user sessions
- ✅ **Email Verification** - Can require verified emails

### Role-Based Access Control
- ✅ **Firestore-backed Roles** - Centralized role management
- ✅ **Granular Permissions** - Fine-grained access control
- ✅ **Self-protection** - Users can't modify their own roles
- ✅ **Audit Trail** - All changes tracked with timestamps

### API Security
- ✅ **CORS Protection** - Configured for kaayko.com domains
- ✅ **Rate Limiting** - Existing rate limit middleware
- ✅ **Error Masking** - No sensitive data in error messages
- ✅ **HTTPS Only** - Production enforces HTTPS

---

## 📊 Firestore Schema

### `admin_users` Collection

```javascript
{
  // Document ID: Firebase Auth UID
  "uid": "abc123xyz",
  "email": "admin@kaayko.com",
  "displayName": "Super Admin",
  "role": "super-admin",  // super-admin | admin | editor | viewer
  "permissions": ["*"],  // Array of permissions or "*" for all
  "enabled": true,
  "metadata": {
    "createdBy": "system",
    "environment": "production"
  },
  "createdAt": Timestamp,
  "updatedAt": Timestamp,
  "lastLoginAt": Timestamp,
  "deletedAt": null
}
```

**Indexes Required:**
- `role` - For filtering by role
- `email` - For email lookups
- `enabled` - For active user queries

---

## 🚀 Production Deployment

### Step 1: Deploy Functions
```bash
cd api/deployment
./deploy-firebase-functions.sh
```

Or:
```bash
cd api/functions
firebase deploy --only functions
```

### Step 2: Deploy Frontend
```bash
cd frontend
firebase deploy --only hosting
```

### Step 3: Create Production Admin
```bash
# Switch to production environment
export GOOGLE_APPLICATION_CREDENTIALS="path/to/service-account.json"

node scripts/initFirstAdmin.js admin@kaayko.com SecureProductionPass123!
```

### Step 4: Setup Firestore Security Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Admin users collection - API-only writes
    match /admin_users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if false;  // Only via Cloud Functions
    }
    
    // Short links - read-only for users
    match /short_links/{linkId} {
      allow read: if true;  // Public read for redirects
      allow write: if false;  // API-only writes
    }
  }
}
```

---

## 🆘 Troubleshooting

### "User not found in admin system"
**Cause:** User exists in Firebase Auth but not in `admin_users` collection

**Solution:**
```bash
# Re-run initialization for that user
node scripts/initFirstAdmin.js their@email.com TempPass123!
```

### "Token expired"
**Cause:** ID tokens expire after 1 hour

**Solution:** User needs to log in again. Frontend should handle this automatically.

### "Forbidden - Insufficient permissions"
**Cause:** User doesn't have required role/permission

**Solution:** Update user role via super-admin:
```bash
PUT /api/admin/users/:uid
{ "role": "admin" }
```

### "Firebase Auth not initialized"
**Cause:** Missing Firebase config in frontend

**Solution:** Check `login.html` has correct Firebase config.

---

## 📚 Best Practices

### Security
1. **Use strong passwords** - Min 12 characters, mixed case, numbers, symbols
2. **Limit super-admins** - Only 1-2 super-admins needed
3. **Regular audits** - Review admin user list monthly
4. **Rotate credentials** - Change passwords every 90 days
5. **Enable 2FA** - Use Firebase Auth multi-factor authentication

### User Management
1. **Least privilege** - Start users as `viewer`, upgrade as needed
2. **Descriptive names** - Use full names for `displayName`
3. **Disable, don't delete** - Soft delete preserves audit trail
4. **Document access** - Add metadata explaining why user has access

### Development
1. **Use local emulator** - Test auth flows locally first
2. **Separate environments** - Different admin users for dev/prod
3. **Log auth events** - Track login attempts and permission checks
4. **Test error cases** - Verify expired tokens, invalid roles, etc.

---

**Status:** ✅ Production-ready  
**Version:** 1.0.0  
**Security Level:** Enterprise-grade  
**Last Updated:** November 9, 2025
