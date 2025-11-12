# 👤 Admin User Management Guide

## 🎯 Overview

You are the **super-admin**. You control who has access to the system and what they can do.

---

## 🔐 Your Admin Account

### Creating Your Account (First Time)

```bash
cd /Users/Rohan/Desktop/kaayko-monorepo/api/functions
node scripts/initFirstAdmin.js admin@kaayko.com YourPassword123!
```

This creates:
- ✅ Firebase Auth account (for login)
- ✅ Firestore admin record (for permissions)
- ✅ Super-admin role (full access)

---

## 🔄 Password Management

### **Option 1: Self-Service Password Reset (Recommended)**

1. Go to login page
2. Click **"Forgot password?"**
3. Enter your email: `admin@kaayko.com`
4. Check your email inbox
5. Click reset link from Firebase
6. Set your new password
7. Login with new password ✅

**Email will come from:** `noreply@kaaykostore.firebaseapp.com`

### **Option 2: Re-create Your Account**

If you forget your password and can't access email:

```bash
# This will override your existing account
node scripts/initFirstAdmin.js admin@kaayko.com NewPassword456!
```

⚠️ **Warning:** This resets your account to default state.

### **Option 3: Firebase Console (Production Only)**

For production, you can reset via Firebase Console:
1. Go to: https://console.firebase.google.com
2. Select project: `kaaykostore`
3. Navigate to: Authentication → Users
4. Find your user → Click options → Reset password

---

## 👥 Managing Other Users

### Creating Additional Admins

**Via Admin Portal (Easiest):**
1. Login to admin portal
2. Navigate to "Admin Users" section (if you want me to add this UI)
3. Click "Create New Admin"
4. Enter details and assign role

**Via API:**
```bash
# Get your token from browser console:
# localStorage.getItem('kaayko_admin_token')

curl -X POST \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "editor@kaayko.com",
    "password": "TheirPassword123!",
    "displayName": "John Editor",
    "role": "editor"
  }' \
  http://127.0.0.1:5001/kaaykostore/us-central1/api/admin/users
```

**Via Script (DevOps):**
```bash
node scripts/initFirstAdmin.js newadmin@kaayko.com Password123!
```

### User Roles Explained

| Role | Create Links | Edit Links | Delete Links | Manage Admins | Use Case |
|------|-------------|------------|--------------|---------------|----------|
| **super-admin** | ✅ | ✅ | ✅ | ✅ | You (owner) |
| **admin** | ✅ | ✅ | ✅ | ❌ | Trusted team members |
| **editor** | ✅ | ✅ | ❌ | ❌ | Content creators |
| **viewer** | ❌ | ❌ | ❌ | ❌ | Read-only access |

### Updating User Roles

```bash
# Promote editor to admin
curl -X PUT \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin"}' \
  http://127.0.0.1:5001/kaaykostore/us-central1/api/admin/users/<USER_UID>
```

### Disabling Users

```bash
# Disable (soft delete) a user
curl -X DELETE \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  http://127.0.0.1:5001/kaaykostore/us-central1/api/admin/users/<USER_UID>
```

---

## 🔒 Security Best Practices

### Password Requirements

✅ **Minimum 6 characters** (Firebase requirement)  
✅ **Recommended: 12+ characters**  
✅ **Mix of uppercase, lowercase, numbers, symbols**  
✅ **Avoid common words**  

**Good examples:**
- `KaaykoAdmin2025!`
- `SecureP@ssw0rd123`
- `MyStr0ng!Pass`

**Bad examples:**
- `password` (too weak)
- `123456` (too weak)
- `admin` (too weak)

### Account Security

1. **Use unique passwords** - Different for each admin
2. **Enable 2FA** (optional, can add later)
3. **Regular password changes** - Every 90 days
4. **Limit super-admins** - Only 1-2 people
5. **Use strong emails** - Gmail with 2FA enabled

### Auditing

Track admin activity:
```bash
# View all admin users
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
  http://127.0.0.1:5001/kaaykostore/us-central1/api/admin/users

# View specific user
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
  http://127.0.0.1:5001/kaaykostore/us-central1/api/admin/users/<USER_UID>
```

---

## 🆘 Troubleshooting

### "I forgot my password and can't access email"

**Solution 1: Firebase Console** (Production)
1. Go to Firebase Console
2. Authentication → Users
3. Find your email → Reset password

**Solution 2: Re-run Script** (Local/Production)
```bash
node scripts/initFirstAdmin.js admin@kaayko.com NewPassword!
```

### "I locked myself out"

If you:
- Changed your role by accident
- Disabled your own account
- Can't login

**Fix via Firebase Console:**
1. Go to Firestore in Firebase Console
2. Find `admin_users` collection
3. Find your UID
4. Edit: `role: "super-admin"`, `enabled: true`

### "Reset email not arriving"

1. **Check spam folder**
2. **Wait 5 minutes** (can be slow)
3. **Verify email is correct**
4. **Check Firebase Console** → Authentication → Templates → Verify email template is enabled

### "Can't create more admins"

**Cause:** Your role isn't `super-admin`

**Fix:**
```bash
# Check your role
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
  http://127.0.0.1:5001/kaaykostore/us-central1/api/admin/me

# Should show: "role": "super-admin"
```

---

## 🚀 Production Deployment

### Step 1: Deploy Backend

```bash
cd /Users/Rohan/Desktop/kaayko-monorepo/api
firebase deploy --only functions,firestore:rules,firestore:indexes
```

### Step 2: Deploy Frontend

```bash
cd /Users/Rohan/Desktop/kaayko-monorepo/frontend
firebase deploy --only hosting
```

### Step 3: Create Production Admin

```bash
# Set production credentials
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"

# Create admin
cd /Users/Rohan/Desktop/kaayko-monorepo/api/functions
node scripts/initFirstAdmin.js admin@kaayko.com ProductionPassword123!
```

### Step 4: Test Production Login

Go to: **https://kaaykostore.web.app/admin/login.html**

---

## 📋 Regular Maintenance

### Monthly Tasks

- [ ] Review admin user list
- [ ] Remove inactive accounts
- [ ] Check for suspicious activity
- [ ] Verify roles are appropriate
- [ ] Update passwords (optional)

### Quarterly Tasks

- [ ] Full security audit
- [ ] Review Firebase Auth logs
- [ ] Update admin documentation
- [ ] Test password reset flow
- [ ] Verify backup access methods

---

## 🎯 Quick Reference

### Common Commands

```bash
# Create first admin (local)
node scripts/initFirstAdmin.js admin@kaayko.com Pass123!

# Create additional user (API)
curl -X POST -H "Authorization: Bearer <TOKEN>" \
  -d '{"email":"user@kaayko.com","password":"Pass!","role":"editor"}' \
  http://127.0.0.1:5001/kaaykostore/us-central1/api/admin/users

# List all admins
curl -H "Authorization: Bearer <TOKEN>" \
  http://127.0.0.1:5001/kaaykostore/us-central1/api/admin/users

# Get your profile
curl -H "Authorization: Bearer <TOKEN>" \
  http://127.0.0.1:5001/kaaykostore/us-central1/api/admin/me
```

### URLs

- **Local Login:** `file://.../frontend/src/admin/login.html`
- **Prod Login:** `https://kaaykostore.web.app/admin/login.html`
- **Emulator UI:** `http://127.0.0.1:4000`
- **Firebase Console:** `https://console.firebase.google.com`

---

**Remember:** You are the super-admin. With great power comes great responsibility! 🦸‍♂️
