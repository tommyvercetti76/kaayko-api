# 🧪 Testing Smart Links v4 Locally

## 🚀 Quick Start

### 1. Start Firebase Emulator

```bash
cd /Users/Rohan/Desktop/kaayko-monorepo/api/functions
npm run serve
```

This starts:
- Functions emulator: `http://127.0.0.1:5001/kaaykostore/us-central1/api`
- Firestore emulator: `http://127.0.0.1:8080`

---

## 📋 Test Commands

### Test 1: Create a Short Link

```bash
curl -X POST http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks \
  -H "Content-Type: application/json" \
  -d '{
    "webDestination": "https://kaayko.com/paddlingout?id=antero",
    "iosDestination": "kaayko://paddlingOut?id=antero",
    "title": "Antero Reservoir",
    "description": "High-altitude paddling spot in Colorado"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "link": {
    "code": "lk1ngp",
    "shortUrl": "https://kaayko.com/l/lk1ngp",
    "qrCodeUrl": "https://kaayko.com/qr/lk1ngp.png",
    "destinations": {
      "ios": "kaayko://paddlingOut?id=antero",
      "android": null,
      "web": "https://kaayko.com/paddlingout?id=antero"
    },
    "title": "Antero Reservoir",
    "clickCount": 0,
    "createdAt": "2025-11-02T..."
  },
  "message": "Short link created: https://kaayko.com/l/lk1ngp"
}
```

**Save the `code` value** (e.g., `lk1ngp`) for next tests!

---

### Test 2: List All Links

```bash
curl http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks
```

**Expected Response:**
```json
{
  "success": true,
  "links": [
    {
      "id": "lk1ngp",
      "code": "lk1ngp",
      "shortUrl": "https://kaayko.com/l/lk1ngp",
      "title": "Antero Reservoir",
      "clickCount": 0,
      "enabled": true
    }
  ],
  "total": 1
}
```

---

### Test 3: Get Specific Link

Replace `lk1ngp` with your actual code:

```bash
curl http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/lk1ngp
```

**Expected Response:**
```json
{
  "success": true,
  "link": {
    "id": "lk1ngp",
    "code": "lk1ngp",
    "shortUrl": "https://kaayko.com/l/lk1ngp",
    "destinations": {
      "ios": "kaayko://paddlingOut?id=antero",
      "web": "https://kaayko.com/paddlingout?id=antero"
    },
    "title": "Antero Reservoir",
    "clickCount": 0,
    "enabled": true
  }
}
```

---

### Test 4: Test Redirect (Most Important!)

Replace `lk1ngp` with your actual code:

```bash
curl -L http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/r/lk1ngp
```

**Expected:** Should redirect to `https://kaayko.com/paddlingout?id=antero`

Or test in browser:
```
http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/r/lk1ngp
```

---

### Test 5: Update Link

```bash
curl -X PUT http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/lk1ngp \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated: Antero Reservoir",
    "description": "New description!"
  }'
```

---

### Test 6: Get Link Stats

```bash
curl http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/stats
```

**Expected Response:**
```json
{
  "success": true,
  "stats": {
    "totalLinks": 1,
    "totalClicks": 0,
    "enabledLinks": 1,
    "disabledLinks": 0
  }
}
```

---

### Test 7: Track Event

```bash
curl -X POST http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/events/install \
  -H "Content-Type: application/json" \
  -d '{
    "linkId": "lk1ngp",
    "userId": "test_user_123",
    "platform": "ios"
  }'
```

---

### Test 8: Delete Link

```bash
curl -X DELETE http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/lk1ngp
```

**Expected Response:**
```json
{
  "success": true,
  "code": "lk1ngp"
}
```

---

### Test 9: Health Check

```bash
curl http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/health
```

**Expected Response:**
```json
{
  "success": true,
  "service": "Smart Links API v4 - Short Codes Only",
  "status": "healthy",
  "timestamp": "2025-11-02T..."
}
```

---

## 🌐 Test Admin Dashboard Locally

### Option 1: Direct File Open
1. Open `frontend/src/admin/smartlinks-simple.html` in browser
2. It will connect to local emulator automatically (localhost detection)

### Option 2: Local Server
```bash
cd /Users/Rohan/Desktop/kaayko-monorepo/frontend/src/admin
python3 -m http.server 8000
```

Then open: `http://localhost:8000/smartlinks-simple.html`

---

## 🔍 View Firestore Data

Open Firestore Emulator UI:
```
http://localhost:4000/firestore
```

Look for `short_links` collection to see all created links.

---

## 🧪 Complete Test Script

Create a file `test-smartlinks.sh`:

```bash
#!/bin/bash

API="http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks"

echo "🧪 Testing Smart Links v4..."
echo ""

# Test 1: Create link
echo "1️⃣ Creating link..."
RESPONSE=$(curl -s -X POST $API \
  -H "Content-Type: application/json" \
  -d '{
    "webDestination": "https://kaayko.com/paddlingout",
    "title": "Test Link"
  }')

CODE=$(echo $RESPONSE | grep -o '"code":"[^"]*"' | cut -d'"' -f4)
echo "✅ Created link: $CODE"
echo ""

# Test 2: Get link
echo "2️⃣ Getting link..."
curl -s $API/$CODE | jq .
echo ""

# Test 3: Test redirect
echo "3️⃣ Testing redirect..."
curl -sI $API/r/$CODE | grep -i location
echo ""

# Test 4: Get stats
echo "4️⃣ Getting stats..."
curl -s $API/stats | jq .
echo ""

# Test 5: Delete link
echo "5️⃣ Deleting link..."
curl -s -X DELETE $API/$CODE | jq .
echo ""

echo "✅ All tests complete!"
```

Make it executable:
```bash
chmod +x test-smartlinks.sh
./test-smartlinks.sh
```

---

## 🐛 Troubleshooting

### Emulator not starting?
```bash
# Kill existing processes
lsof -ti:5001 | xargs kill -9
lsof -ti:8080 | xargs kill -9

# Restart
cd /Users/Rohan/Desktop/kaayko-monorepo/api/functions
npm run serve
```

### "Module not found" errors?
```bash
cd /Users/Rohan/Desktop/kaayko-monorepo/api/functions
npm install
```

### Can't connect to emulator?
Check the emulator is running:
```bash
curl http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/health
```

### Firestore data not persisting?
Emulator data is cleared on restart. This is expected for local testing.

---

## ✅ What to Look For

### Success Indicators:
- ✅ `POST /smartlinks` returns `success: true` with short code
- ✅ `GET /smartlinks/:code` returns link details
- ✅ `GET /smartlinks/r/:code` redirects to destination
- ✅ `GET /smartlinks/stats` shows correct counts
- ✅ Dashboard loads and displays links
- ✅ No console errors in Functions logs

### Common Issues:
- ❌ 404 errors → Check emulator is running
- ❌ "Link not found" → Use correct code from creation response
- ❌ CORS errors in dashboard → Use localhost:5001, not 127.0.0.1

---

## 🚀 Next Steps

Once local testing passes:
```bash
cd /Users/Rohan/Desktop/kaayko-monorepo/api/functions
firebase deploy --only functions
```

Then test production:
```bash
curl https://us-central1-kaaykostore.cloudfunctions.net/api/smartlinks/health
```

---

**Happy Testing! 🎉**
