# 🔗 Deep Links API

**Universal link management for iOS app integration**

---

## 📁 Files in this Module

1. **`deeplinkRoutes.js`** - Universal link handler for iOS/web bridging

---

## 📱 Overview

Deep Links API handles Universal Links (iOS) and provides context-aware redirection between the Kaayko app and website.

### Features

- ✅ Universal Links support (apple-app-site-association)
- ✅ Context preservation across app install
- ✅ Smart routing (app vs web)
- ✅ Deferred deep linking
- ✅ Analytics tracking

---

## 🔗 API Endpoints

### **1. Universal Link Handler**
```
GET /api/l/:id
```

Handles all Universal Links from iOS.

**Examples:**
```bash
GET /api/l/whiterlake           # Paddling location
GET /api/l/trinity              # Lake Trinity
GET /api/l/product/navy-tee     # Product link
GET /api/l/custom/promo123      # Custom content
```

### **2. Context Restoration**
```
GET /api/resolve
```

Restores context after app install (deferred deep linking).

### **3. Health Check**
```
GET /api/health
```

Deep link system health check.

---

## 📋 Endpoint #1: Universal Link

```
GET /api/l/:id
```

### URL Patterns:

#### **Paddling Location:**
```
https://kaayko.com/l/whiterlake
https://kaayko.com/l/trinity
https://kaayko.com/l/lake-travis
```

#### **Product:**
```
https://kaayko.com/l/product/navy-tee
https://kaayko.com/l/product/vintage-black
```

#### **Custom Content:**
```
https://kaayko.com/l/promo/summer2025
https://kaayko.com/l/event/paddle-fest
```

### Behavior:

#### **iOS App Installed:**
1. Opens Kaayko iOS app
2. Passes context to app
3. App navigates to content

#### **iOS App NOT Installed:**
1. Sets context cookie
2. Redirects to web version
3. Shows "Download App" banner
4. After install: Restores context

#### **Web Browser:**
1. Redirects to web version
2. Displays full content

---

## 📋 Endpoint #2: Context Restore

```
GET /api/resolve?ctx=<contextToken>
```

### Purpose:
Restores user context after app installation (deferred deep linking).

### Flow:
```
1. User clicks: kaayko.com/l/whiterlake (no app)
2. Backend sets context cookie + token
3. User redirected to web
4. User downloads app
5. App opens with: kaayko.com/resolve?ctx=<token>
6. Backend returns original context
7. App navigates to White Rock Lake
```

### Response:
```json
{
  "success": true,
  "context": {
    "type": "location",
    "locationId": "whiterlake",
    "name": "White Rock Lake",
    "coordinates": {
      "latitude": 32.8309,
      "longitude": -96.7176
    },
    "originalUrl": "https://kaayko.com/l/whiterlake",
    "timestamp": "2025-10-31T13:30:00Z"
  }
}
```

---

## 🗺️ Location Context

### Location ID Formats:

```javascript
// Direct lake ID
"whiterlake" → White Rock Lake

// Normalized name
"lake-travis" → Lake Travis

// Coordinates
"30.3894,-97.9433" → Lake Travis (nearest)
```

### Location Database:
Fetches from Firestore `paddlingSpots` collection.

---

## 🍪 Context Cookies

### Cookie Structure:
```javascript
{
  name: "kaayko_deep_link_context",
  value: {
    locationId: "whiterlake",
    type: "location",
    timestamp: 1730376000000
  },
  maxAge: 1800000,  // 30 minutes
  httpOnly: true,
  secure: true,
  sameSite: "lax"
}
```

### Context Token:
```javascript
{
  token: "ctx_abc123def456",
  context: { /* full context */ },
  expiresAt: Timestamp  // 30 minutes
}
```

---

## 📱 iOS Integration

### Universal Links Setup:

#### **1. apple-app-site-association**
```json
{
  "applinks": {
    "apps": [],
    "details": [{
      "appID": "TEAM_ID.com.kaayko.app",
      "paths": [
        "/l/*",
        "/resolve"
      ]
    }]
  }
}
```

Hosted at: `https://kaayko.com/.well-known/apple-app-site-association`

#### **2. iOS App Delegate**
```swift
func application(
  _ application: UIApplication,
  continue userActivity: NSUserActivity,
  restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
) -> Bool {
  guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
        let url = userActivity.webpageURL else {
    return false
  }
  
  // Handle deep link
  handleDeepLink(url)
  return true
}
```

---

## 🔄 Routing Logic

### Decision Tree:
```
User clicks: kaayko.com/l/whiterlake
        ↓
Is iOS device?
    ↓ Yes              ↓ No
App installed?         Go to web
    ↓ Yes    ↓ No
Open app    Set cookie
            ↓
        Go to web + banner
```

### Smart Routing:
1. **Detect iOS:** Check user-agent
2. **Check app:** Universal Links auto-handle
3. **Fallback:** Web with app prompt
4. **Context:** Preserve for post-install

---

## 📊 Firestore Collections

### **`deep_link_contexts`**
```javascript
{
  // Document ID: contextToken
  "token": "ctx_abc123def456",
  "context": {
    "type": "location",
    "locationId": "whiterlake",
    "name": "White Rock Lake",
    "coordinates": { "lat": 32.8309, "lng": -96.7176 }
  },
  "originalUrl": "https://kaayko.com/l/whiterlake",
  "userAgent": "Mozilla/5.0...",
  "created": Timestamp,
  "expiresAt": Timestamp  // 30 minutes
}
```

### **Auto-Cleanup:**
Contexts auto-expire after 30 minutes via Firestore TTL.

---

## 🧪 Testing

### Test Universal Link:
```bash
curl -L http://127.0.0.1:5001/kaaykostore/us-central1/api/l/whiterlake
```

### Test Context Restore:
```bash
# 1. Get context token from cookie
# 2. Call resolve
curl "http://127.0.0.1:5001/kaaykostore/us-central1/api/resolve?ctx=<token>"
```

### Test iOS Simulation:
```bash
curl -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)" \
  -L http://127.0.0.1:5001/kaaykostore/us-central1/api/l/whiterlake
```

---

## 📈 Performance

| Operation | Response Time | Notes |
|-----------|---------------|-------|
| Direct link | ~100ms | Simple redirect |
| With context | ~150ms | Cookie + redirect |
| Context restore | ~80ms | Token lookup |
| Location lookup | ~120ms | Firestore query |

---

## 🔐 Security

- ✅ **Rate limiting:** 30 req/min per IP
- ✅ **Context expiry:** 30 minutes max
- ✅ **Secure cookies:** HttpOnly, Secure, SameSite
- ✅ **Token validation:** Cryptographic tokens
- ✅ **Input sanitization:** All IDs validated

---

## 📚 Related Documentation

- **Deep Links Guide:** `../../../../docs/paddlebot/DEEP_LINK_IMPLEMENTATION.md`
- **iOS Integration:** `../../../../Kaayko/README_DEEP_LINKS.md`
- **Apple Docs:** [Universal Links](https://developer.apple.com/ios/universal-links/)

---

## 🚀 Deployment

Deploy deep links API:
```bash
cd api/deployment
./deploy-firebase-functions.sh
```

**Important:** Also deploy apple-app-site-association file to frontend.

---

**Status:** ✅ Production-ready  
**iOS App:** Integrated  
**Context Preservation:** 30 minutes  
**Universal Links:** Active
