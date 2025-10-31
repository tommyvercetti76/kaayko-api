# 🔗 Kaayko Smart Links V2

**Production-Ready Deep Linking System for iOS App Integration**

## What Are Smart Links?

Smart links are shareable URLs that intelligently route users based on their device:

- **iOS Users with App Installed** → Opens Kaayko app directly to the location
- **iOS Users without App** → Redirects to App Store, preserves context for after install
- **Desktop/Android Users** → Shows web fallback with location details

## Quick Start

### 1. Create a Smart Link via Web UI

Visit: **https://kaayko.com/create-link.html**

1. Search for any Kaayko location (Trinity River, Diablo Lake, etc.)
2. Choose link type: `lake`, `spot`, `qr`, or `custom`
3. Click "Create Smart Link"
4. Get your shareable URL: `https://k.kaayko.com/lake/trinity`

### 2. Create a Smart Link via API

```bash
curl -X POST https://us-central1-kaaykostore.cloudfunctions.net/api/smartlinks \
  -H "Content-Type: application/json" \
  -d '{
    "space": "lake",
    "id": "trinity",
    "title": "Trinity River",
    "destinations": {
      "ios": {
        "universalLink": "kaayko://location/trinity"
      }
    },
    "params": {
      "locationId": "trinity",
      "lat": 32.881187,
      "lon": -96.929937
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "link": {
    "id": "trinity",
    "space": "lake",
    "title": "Trinity River",
    "shortURL": "https://k.kaayko.com/lake/trinity",
    "qrCodeURL": "https://k.kaayko.com/qr/lake/trinity.png",
    "createdAt": "2025-10-28T..."
  }
}
```

### 3. Share the Link

Users click: `https://k.kaayko.com/lake/trinity`

**What happens:**
1. Backend detects device type (iOS/Android/Web)
2. For iOS: Attempts universal link `kaayko://location/trinity`
3. If app not installed: Redirects to App Store
4. Sets context cookie for post-install attribution
5. Tracks click analytics

## Architecture

### Collections in Firestore

#### `smart_links`
Stores link configuration and destinations.

```javascript
{
  "id": "trinity",
  "space": "lake",
  "title": "Trinity River",
  "createdBy": "user_abc123",
  
  "destinations": {
    "ios": {
      "universalLink": "kaayko://location/trinity",
      "appStoreURL": "https://apps.apple.com/app/kaayko/id6738635091"
    },
    "android": {
      "intentURI": "intent://...",
      "playStoreURL": "https://play.google.com/..."
    },
    "web": {
      "url": "https://kaayko.com/paddlingout?id=trinity",
      "fallbackURL": "https://kaayko.com"
    }
  },
  
  "params": {
    "locationId": "trinity",
    "lat": 32.881187,
    "lon": -96.929937,
    "name": "Trinity River"
  },
  
  "stats": {
    "totalClicks": 127,
    "uniqueClicks": 89,
    "iosClicks": 67,
    "androidClicks": 12,
    "webClicks": 48,
    "lastClickedAt": "2025-10-28T..."
  },
  
  "createdAt": "2025-10-20T...",
  "updatedAt": "2025-10-28T...",
  "expiresAt": null
}
```

**Indexes Needed:**
- `space + id` (composite, unique)
- `createdBy` (for listing user's links)
- `expiresAt` (for cleanup jobs)

#### `link_clicks`
Tracks every click for analytics.

```javascript
{
  "clickId": "uuid-v4",
  "linkId": "trinity",
  "space": "lake",
  "timestamp": "2025-10-28T14:30:00Z",
  
  "device": {
    "os": "iOS",
    "osVersion": "18.1",
    "deviceModel": "iPhone 15 Pro",
    "userAgent": "Mozilla/5.0..."
  },
  
  "geo": {
    "ip": "sha256-hash",
    "country": "US",
    "region": "TX",
    "city": "Dallas"
  },
  
  "params": {
    "utm_source": "instagram",
    "utm_medium": "social",
    "utm_campaign": "spring2024"
  },
  
  "resolvedTo": "app",  // "app" | "appstore" | "web"
  "ctxId": "ctx_abc123xyz",
  "httpStatus": 302
}
```

**Indexes Needed:**
- `linkId + timestamp` (composite, for analytics)
- `space + linkId` (composite)
- `ctxId` (for attribution matching)

#### `ctx_tokens`
Short-lived tokens for post-install attribution. **TTL: 7 days**

```javascript
{
  "ctxId": "ctx_abc123xyz",
  "linkId": "trinity",
  "space": "lake",
  "params": {
    "locationId": "trinity",
    "lat": 32.881187,
    "lon": -96.929937
  },
  "createdAt": "2025-10-28T14:30:00Z",
  "expiresAt": "2025-11-04T14:30:00Z",  // +7 days
  "claimed": false,
  "claimedBy": null,  // installId when claimed
  "claimedAt": null
}
```

**Indexes Needed:**
- `ctxId` (primary lookup)
- `expiresAt` (for TTL cleanup)
- `linkId + claimed` (for analytics)

#### `app_events`
Tracks app lifecycle events (install, open, purchase).

```javascript
{
  "eventId": "uuid-v4",
  "type": "install",  // "install" | "open" | "purchase" | "custom"
  
  "device": {
    "installId": "device_unique_id",
    "os": "iOS",
    "osVersion": "18.1",
    "deviceModel": "iPhone 15 Pro"
  },
  
  "attribution": {
    "ctxId": "ctx_abc123xyz",
    "matchedLinkId": "trinity",
    "matchedVia": "ctxId",  // "ctxId" | "fingerprint" | "none"
    "matchedAt": "2025-10-28T14:35:00Z"
  },
  
  "payload": {
    // Event-specific data
  },
  
  "timestamp": "2025-10-28T14:35:00Z",
  "idempotencyKey": "device_unique_id_2025-10-28"  // For installs only
}
```

**Indexes Needed:**
- `type + timestamp` (for event queries)
- `installId` (for user journey)
- `matchedLinkId` (for attribution)
- `idempotencyKey` (for deduplication)

## API Endpoints

### Create Smart Link
```
POST /api/smartlinks
```

**Request:**
```json
{
  "space": "lake",
  "id": "trinity",
  "title": "Trinity River",
  "destinations": {
    "ios": { "universalLink": "kaayko://location/trinity" }
  },
  "params": { "locationId": "trinity", "lat": 32.881187, "lon": -96.929937 },
  "tags": ["texas", "paddling"],
  "expiresAt": "2026-01-28T00:00:00Z"  // Optional
}
```

**Response:**
```json
{
  "success": true,
  "link": {
    "id": "trinity",
    "space": "lake",
    "shortURL": "https://k.kaayko.com/lake/trinity",
    "qrCodeURL": "https://k.kaayko.com/qr/lake/trinity.png"
  }
}
```

### Get Link Details
```
GET /api/smartlinks/:space/:id
```

**Response:**
```json
{
  "success": true,
  "link": {
    "id": "trinity",
    "title": "Trinity River",
    "stats": {
      "totalClicks": 127,
      "iosClicks": 67
    }
  }
}
```

### Track App Event
```
POST /api/events/:type
```

**Types:** `install`, `open`, `purchase`, `custom`

**Request (Install Event):**
```json
{
  "installId": "ABC123-DEVICE-UUID",
  "os": "iOS",
  "osVersion": "18.1",
  "deviceModel": "iPhone 15 Pro",
  "ctxId": "ctx_abc123xyz",  // From cookie after clicking smart link
  "timestamp": "2025-10-28T14:35:00Z"
}
```

**Response:**
```json
{
  "success": true,
  "eventId": "uuid-v4",
  "attribution": {
    "matched": true,
    "linkId": "trinity",
    "space": "lake",
    "matchedVia": "ctxId"
  }
}
```

### Get Link Analytics
```
GET /api/stats?linkId=trinity&space=lake&range=7d
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "totalClicks": 127,
    "uniqueClicks": 89,
    "clicksByPlatform": {
      "ios": 67,
      "android": 12,
      "web": 48
    },
    "conversionRate": 0.23
  },
  "installs": {
    "total": 29,
    "ios": 24,
    "android": 5
  },
  "timeline": [
    { "date": "2025-10-21", "clicks": 18, "installs": 4 },
    { "date": "2025-10-22", "clicks": 22, "installs": 6 }
  ],
  "topReferrers": [
    { "source": "instagram", "clicks": 45 },
    { "source": "direct", "clicks": 32 }
  ]
}
```

## iOS App Integration

### 1. Enable Universal Links

**Add to your `Kaayko.entitlements`:**
```xml
<key>com.apple.developer.associated-domains</key>
<array>
    <string>applinks:kaayko.com</string>
    <string>applinks:k.kaayko.com</string>
</array>
```

### 2. Handle Universal Links in AppDelegate

```swift
func application(_ application: UIApplication,
                continue userActivity: NSUserActivity,
                restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    
    guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
          let url = userActivity.webpageURL else {
        return false
    }
    
    // Check if it's a Kaayko link
    if url.host == "kaayko.com" || url.host == "k.kaayko.com" {
        return handleDeepLink(url)
    }
    
    return false
}

func handleDeepLink(_ url: URL) -> Bool {
    // Parse URL: https://k.kaayko.com/lake/trinity
    let pathComponents = url.pathComponents  // ["/" "lake", "trinity"]
    
    guard pathComponents.count >= 3 else { return false }
    
    let space = pathComponents[1]  // "lake"
    let linkId = pathComponents[2]  // "trinity"
    
    // Resolve context from backend
    Task {
        await resolveSmartLink(space: space, linkId: linkId)
    }
    
    return true
}

func resolveSmartLink(space: String, linkId: String) async {
    let url = URL(string: "https://us-central1-kaaykostore.cloudfunctions.net/api/smartlinks/\(space)/\(linkId)")!
    
    do {
        let (data, _) = try await URLSession.shared.data(from: url)
        let response = try JSONDecoder().decode(SmartLinkResponse.self, from: data)
        
        if let locationId = response.link.params["locationId"] as? String {
            // Navigate to location screen
            navigateToLocation(locationId: locationId)
            
            // Track app open event
            trackAppOpen(ctxId: getCtxIdFromCookies(), linkId: linkId)
        }
    } catch {
        print("Failed to resolve smart link: \(error)")
    }
}
```

### 3. Track Install Events

**On first app launch:**
```swift
func trackInstall() {
    guard !UserDefaults.standard.bool(forKey: "hasTrackedInstall") else {
        return  // Already tracked
    }
    
    let installId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
    let ctxId = getCtxIdFromCookies()  // If user clicked smart link before install
    
    let event = [
        "installId": installId,
        "os": "iOS",
        "osVersion": UIDevice.current.systemVersion,
        "deviceModel": UIDevice.current.model,
        "ctxId": ctxId ?? "",
        "timestamp": ISO8601DateFormatter().string(from: Date())
    ]
    
    Task {
        let url = URL(string: "https://us-central1-kaaykostore.cloudfunctions.net/api/events/install")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: event)
        
        let (data, _) = try? await URLSession.shared.data(for: request)
        
        if let data = data,
           let response = try? JSONDecoder().decode(EventResponse.self, from: data),
           response.success {
            UserDefaults.standard.set(true, forKey: "hasTrackedInstall")
            print("✅ Install tracked, attributed to: \(response.attribution.linkId ?? "none")")
        }
    }
}
```

## Testing

### Test Smart Link Creation

```bash
# Create link for Trinity River
curl -X POST http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks \
  -H "Content-Type: application/json" \
  -d '{
    "space": "lake",
    "id": "trinity-test",
    "title": "Trinity River Test",
    "destinations": {
      "ios": { "universalLink": "kaayko://location/trinity" }
    },
    "params": { "locationId": "trinity" }
  }'

# Expected: 
# {
#   "success": true,
#   "link": {
#     "shortURL": "https://k.kaayko.com/lake/trinity-test"
#   }
# }
```

### Test Link Resolution

```bash
# Simulate iOS user clicking link
curl -v -A "iPhone" http://127.0.0.1:5001/kaaykostore/us-central1/api/l/lake/trinity-test

# Expected:
# - 302 redirect to kaayko://location/trinity (if app installed)
# - OR 302 to App Store (if not installed)
# - Sets cookie: kaayko_ctxid=xxx
```

### Test Event Tracking

```bash
# Track install event
curl -X POST http://127.0.0.1:5001/kaaykostore/us-central1/api/events/install \
  -H "Content-Type: application/json" \
  -d '{
    "installId": "TEST-DEVICE-123",
    "os": "iOS",
    "osVersion": "18.1",
    "ctxId": "ctx_from_cookie",
    "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
  }'

# Expected:
# {
#   "success": true,
#   "attribution": {
#     "matched": true,
#     "linkId": "trinity-test"
#   }
# }
```

### Test Analytics

```bash
# Get link stats
curl "http://127.0.0.1:5001/kaaykostore/us-central1/api/stats?linkId=trinity-test&space=lake&range=7d"

# Expected:
# {
#   "summary": {
#     "totalClicks": 5,
#     "iosClicks": 3
#   },
#   "installs": {
#     "total": 1,
#     "ios": 1
#   }
# }
```

## Production Deployment

### 1. Deploy Firebase Functions

```bash
cd api/functions
firebase deploy --only functions:api
```

### 2. Deploy Frontend

```bash
cd frontend
firebase deploy --only hosting
```

### 3. Configure Apple Associated Domains

Upload `apple-app-site-association` to:
- `https://kaayko.com/.well-known/apple-app-site-association`
- `https://k.kaayko.com/.well-known/apple-app-site-association`

**File content:**
```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAM_ID.com.kaayko.Kaayko",
        "paths": ["/l/*", "/lake/*", "/spot/*", "/qr/*"]
      }
    ]
  }
}
```

### 4. Set Environment Variables

```bash
firebase functions:config:set \
  ios.app_store_url="https://apps.apple.com/app/kaayko/id6738635091" \
  ios.bundle_id="com.kaayko.Kaayko"
```

## Performance Targets

- **Link Creation**: < 500ms (p95)
- **Link Resolution**: < 120ms (p95)
- **Event Tracking**: < 200ms (p95)
- **Analytics Query**: < 1s (p95)

## Security

### Input Validation
- Link IDs: `^[a-zA-Z0-9_-]{3,50}$`
- Spaces: Whitelist of `['lake', 'spot', 'qr', 'custom']`
- UTM params: Lowercase, max 100 chars

### PII Protection
- IP addresses stored as SHA-256 hashes
- User agents truncated to 500 chars
- No raw email/phone storage

### Bot Filtering
Automatic filtering of common crawlers:
- Googlebot, Bingbot, Slackbot
- Facebook/Twitter link previews
- SEO monitoring tools

## Support

- **Documentation**: This README
- **API Reference**: `functions/api/smartLinks/README.md`
- **iOS Integration**: See `DEEP_LINK_IMPLEMENTATION.md`
- **Analytics Dashboard**: Coming soon

---

**Last Updated:** October 28, 2025  
**Version:** 2.0.0  
**Status:** ✅ Production Ready
