# 🧪 Complete Testing Guide - Smart Links with Authentication

## 📋 What You Need to Test

1. ✅ Firebase emulators (Auth + Firestore + Functions)
2. ✅ Create first admin user
3. ✅ Login via web portal
4. ✅ Access protected Smart Links API
5. ✅ Test CRUD operations with authentication

---

## 🚀 Step-by-Step Testing (10 minutes)

### Step 1: Stop Current Emulator

Press `Ctrl+C` in the terminal where the emulator is running.

### Step 2: Restart with Full Emulator Suite

```bash
cd /Users/Rohan/Desktop/kaayko-monorepo/api

# Use the new script (easier)
./start-emulators.sh

# Or manually:
firebase emulators:start --only functions,firestore,auth
```

**You should now see:**
```
✔  All emulators ready!
│ Functions │ 127.0.0.1:5001 │
│ Firestore │ 127.0.0.1:8080 │
│ Auth      │ 127.0.0.1:9099 │
```

### Step 3: Create First Admin User

**Open a NEW terminal** (keep emulators running):

```bash
cd /Users/Rohan/Desktop/kaayko-monorepo/api/functions

# Create your first super-admin
node scripts/initFirstAdmin.js admin@kaayko.com YourPassword123!
```

**Expected output:**
```
✅ SUCCESS! First super-admin created!

📋 Admin Details:
   Email: admin@kaayko.com
   UID: [some-uid]
   Role: super-admin
   Permissions: ALL
```

### Step 4: Test API Health

```bash
# Test that API is responding
curl http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/health
```

**Expected:**
```json
{
  "success": true,
  "service": "Smart Links API v4",
  "status": "healthy"
}
```

### Step 5: Test Unauthenticated Access (Should Fail)

```bash
# Try to list links without authentication
curl http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks
```

**Expected (401 Unauthorized):**
```json
{
  "success": false,
  "error": "Unauthorized",
  "message": "No authentication token provided",
  "code": "AUTH_TOKEN_MISSING"
}
```

✅ **This proves auth is working!**

### Step 6: Login via Web Portal

**Option A: Open file directly**
```bash
open /Users/Rohan/Desktop/kaayko-monorepo/frontend/src/admin/login.html
```

**Option B: Navigate manually**
```
file:///Users/Rohan/Desktop/kaayko-monorepo/frontend/src/admin/login.html
```

**Login with:**
- Email: `admin@kaayko.com`
- Password: `YourPassword123!`

**What should happen:**
1. You see "Authenticating..." spinner
2. Success message appears
3. Redirects to Smart Links portal
4. Portal loads with all features

### Step 7: View Emulator UI (Check Data)

Open: **http://127.0.0.1:4000**

**Check:**
1. **Authentication tab** - Should see your admin user
2. **Firestore tab** - Should see `admin_users` collection with 1 document

### Step 8: Test Authenticated API Calls

**Get your auth token** from browser console (⌘⌥I):
```javascript
localStorage.getItem('kaayko_admin_token')
```

Copy the token and test:

```bash
# Replace <TOKEN> with your actual token
TOKEN="your-token-here"

# Test 1: Get your profile
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:5001/kaaykostore/us-central1/api/admin/me

# Test 2: List links (should work now)
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks

# Test 3: Create a link
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Link",
    "webDestination": "https://kaayko.com",
    "description": "My first authenticated link"
  }' \
  http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks
```

### Step 9: Test in Smart Links Portal

The portal should now work with full authentication:

1. **Dashboard** - View stats
2. **Create Link** - Fill form and create
3. **All Links** - See your newly created links
4. **QR Codes** - Generate QR codes
5. **Edit/Delete** - Modify existing links

### Step 10: Test Creating More Admin Users

```bash
# Create an editor (limited permissions)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "editor@kaayko.com",
    "password": "EditorPass123!",
    "displayName": "John Editor",
    "role": "editor"
  }' \
  http://127.0.0.1:5001/kaaykostore/us-central1/api/admin/users
```

---

## 🎯 What to Check

### ✅ Authentication Works
- [ ] Can't access `/api/smartlinks` without token
- [ ] Login page loads properly
- [ ] Login succeeds with correct credentials
- [ ] Login fails with wrong credentials
- [ ] Token is stored in localStorage
- [ ] Portal redirects after successful login

### ✅ Authorization Works
- [ ] Super-admin can create links
- [ ] Super-admin can delete links
- [ ] Super-admin can create other admins
- [ ] Editors can create links but not delete
- [ ] Viewers can only read links

### ✅ Smart Links Portal
- [ ] Dashboard shows stats
- [ ] Create link form works
- [ ] Links appear in "All Links" table
- [ ] QR codes generate
- [ ] Can edit existing links
- [ ] Can delete links (admin only)

### ✅ Emulator UI
- [ ] Auth emulator shows users
- [ ] Firestore shows `admin_users` collection
- [ ] Firestore shows `short_links` collection
- [ ] Functions logs appear in UI

---

## 🐛 Troubleshooting

### "Emulators not starting"
**Fix:** Make sure firebase.json has emulator config (already added)

### "Auth emulator not found"
**Fix:** Restart emulators: `./start-emulators.sh`

### "Token expired"
**Fix:** Log out and log back in to get a fresh token

### "Cannot create user"
**Fix:** Check emulators are running on correct ports:
- Functions: 5001
- Firestore: 8080
- Auth: 9099

### "Login page doesn't redirect"
**Fix:** Check browser console for errors. Make sure portal file exists:
```bash
ls /Users/Rohan/Desktop/kaayko-monorepo/frontend/src/admin/smartlinks.html
```

### "Portal shows no data"
**Fix:** 
1. Check environment switcher is set to "Local"
2. Verify API is at `http://127.0.0.1:5001/...`
3. Check browser console for CORS errors

---

## 📊 Emulator Ports

| Service | Port | URL |
|---------|------|-----|
| Functions | 5001 | http://127.0.0.1:5001 |
| Firestore | 8080 | http://127.0.0.1:8080 |
| Auth | 9099 | http://127.0.0.1:9099 |
| Emulator UI | 4000 | http://127.0.0.1:4000 |

---

## 🎬 Quick Test Script

Save this to test everything at once:

```bash
#!/bin/bash

echo "🧪 Testing Kaayko Admin Auth System"
echo ""

# 1. Health check
echo "1️⃣ Testing API health..."
curl -s http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/health | jq

# 2. Test unauthorized access
echo ""
echo "2️⃣ Testing unauthorized access (should fail)..."
curl -s http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks | jq

echo ""
echo "✅ If you see 401 Unauthorized above, auth is working!"
echo ""
echo "🔑 Next steps:"
echo "   1. Open: file://$(pwd)/frontend/src/admin/login.html"
echo "   2. Login with admin@kaayko.com"
echo "   3. Access the Smart Links portal"
```

---

## 🚀 Next: Production Testing

Once local testing works, deploy to production:

```bash
# Deploy everything
cd /Users/Rohan/Desktop/kaayko-monorepo/api
firebase deploy --only functions,firestore:rules,firestore:indexes

cd ../frontend
firebase deploy --only hosting

# Create production admin
node ../api/functions/scripts/initFirstAdmin.js admin@kaayko.com ProductionPass!

# Test production
open https://kaaykostore.web.app/admin/login.html
```

---

**Current Status:** ✅ All code ready, now testing phase!  
**Next Step:** Restart emulators and run through Step 1-10 above
