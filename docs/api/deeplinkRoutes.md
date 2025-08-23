# 🔗 deeplinkRoutes API Documentation

## Overview
The deeplinkRoutes API manages universal links and deep link functionality for the Kaayko mobile app. It provides seamless app-to-web redirection, context preservation, and intelligent routing based on user platform and app installation status.

## Endpoints

### Short Link Redirect  
```
GET /l/:id
```

### Context Resolution
```
GET /resolve
```

### Health Check
```
GET /health
```

## Features

### 🚀 Universal Link Management
- **Short URLs**: Create shareable links like `kaayko.com/l/trinity456`
- **Context Preservation**: Maintain location data through app installs
- **Platform Detection**: Automatically detect iOS/Android/Web
- **Smart Routing**: Direct to app store or existing app based on installation

### 📱 Multi-Platform Support
- **iOS**: App Store redirection and universal link handling
- **Android**: Google Play Store and intent-based app launching
- **Web**: Fallback web experience for unsupported platforms
- **Desktop**: Graceful handling with app download suggestions

## Parameters

### GET /l/:id
| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `id` | string | Yes | Location context identifier | `"trinity456"` |

### Query Parameters (Optional)
| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `src` | string | Traffic source tracking | `"social"`, `"email"`, `"qr"` |
| `utm_*` | string | UTM campaign parameters | `utm_source=facebook` |

### GET /resolve
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| No parameters | | | Reads context from cookies set during initial redirect |

## Request Examples

### Short Link Access
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/l/trinity456"
```

### Context Resolution
```bash
curl -H "Cookie: kaayko_ctxid=abc123; kaayko_location=..." \
  "https://us-central1-kaaykostore.cloudfunctions.net/api/resolve"
```

### Health Check
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/health"
```

## Response Formats

### Short Link Redirect (302/200)

#### Mobile Platform - App Store Redirect (302)
```http
HTTP/1.1 302 Found
Location: https://apps.apple.com/app/kaayko/id123456789
Set-Cookie: kaayko_ctxid=abc123; Max-Age=1800; HttpOnly=false
Set-Cookie: kaayko_location={"id":"trinity","name":"Trinity River",...}; Max-Age=1800
```

#### Web Platform - Fallback Page (200)
```html
<!DOCTYPE html>
<html>
<head>
  <title>Kaayko - Trinity River</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <div class="container">
    <div class="logo">🏞️ Kaayko</div>
    <div class="location">
      <h2>Trinity River</h2>
      <p>Get the Kaayko app for the best paddling experience!</p>
    </div>
    <a href="https://apps.apple.com/app/kaayko/id123456789" class="btn">
      Download Kaayko App
    </a>
  </div>
</body>
</html>
```

### Context Resolution (200)
```json
{
  "success": true,
  "context": {
    "id": "trinity",
    "name": "Trinity River",
    "lat": 32.881187,
    "lon": -96.929937,
    "region": "Texas"
  },
  "metadata": {
    "ctxId": "abc123",
    "created": "2025-01-20T14:30:00.000Z",
    "platform": "ios",
    "source": "social"
  }
}
```

### Health Check (200)
```json
{
  "status": "healthy",
  "timestamp": "2025-01-20T14:30:00.000Z",
  "version": "2.0.0",
  "service": "Kaayko Deep Link Router",
  "description": "Universal link management with context preservation",
  "security": {
    "rateLimitEnabled": true,
    "maxRequestsPerMinute": 30,
    "cookieMaxAge": 1800000
  },
  "endpoints": [
    "GET /l/:id - Short link redirect with context",
    "GET /resolve - Context restoration after app install", 
    "GET /health - This health check"
  ]
}
```

## Context System

### Context Storage
Location context is stored in multiple places for reliability:

```javascript
// Firestore document
{
  "id": "trinity456",
  "locationId": "trinity",
  "name": "Trinity River",
  "lat": 32.881187,
  "lon": -96.929937,
  "created": "2025-01-20T14:30:00.000Z",
  "expires": "2025-01-20T20:30:00.000Z"  // 6-hour TTL
}

// Browser cookies (redundant storage)
kaayko_ctxid=abc123                      // Context ID
kaayko_location={"id":"trinity",...}     // Full location data
```

### Context Lifecycle
1. **Creation**: Context generated when short link is created
2. **Storage**: Saved in Firestore with 6-hour expiration
3. **Cookie Setting**: Redundant storage in browser cookies  
4. **Resolution**: App uses cookies to restore context after install
5. **Cleanup**: Automatic removal after expiration

## Platform Detection

### User-Agent Analysis
```javascript
function detectPlatform(userAgent) {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';  
  if (/Windows Phone/i.test(userAgent)) return 'windows';
  return 'web';
}
```

### Routing Logic
- **iOS**: Redirect to App Store with universal link preparation
- **Android**: Direct to Google Play Store with intent handling
- **Web/Desktop**: Show web fallback with download options
- **Unknown**: Default to web experience with auto-detection

## App Store URLs

### Configuration
```javascript
const APP_STORE_URLS = {
  ios: "https://apps.apple.com/app/kaayko/id123456789",
  android: "https://play.google.com/store/apps/details?id=com.kaayko.app",
  windows: "https://www.microsoft.com/store/apps/kaayko"  // Future
};
```

### Fallback Strategy
```javascript
// Primary: Platform-specific store
// Fallback 1: iOS App Store (most common)  
// Fallback 2: Kaayko website landing page
const getAppStoreURL = (platform) => {
  return APP_STORE_URLS[platform] || 
         APP_STORE_URLS.ios ||
         "https://kaayko.com/download";
};
```

## Security Features

### Rate Limiting
- **30 requests per minute** per IP address
- **Burst tolerance**: Short spikes allowed
- **DDoS protection**: Multi-layer request filtering

### Input Validation
```javascript
// Context ID validation
const CONTEXT_ID_PATTERN = /^[a-zA-Z0-9_-]{6,50}$/;

// Location data sanitization
function sanitizeLocationData(data) {
  return {
    id: String(data.id).slice(0, 50),
    name: String(data.name).slice(0, 100),
    lat: Number(data.lat),
    lon: Number(data.lon)
  };
}
```

### Cookie Security
```javascript
// Secure cookie settings
res.cookie("kaayko_ctxid", ctxId, {
  maxAge: 30 * 60 * 1000,        // 30 minutes
  httpOnly: false,               // Allow JS access
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'               // CSRF protection
});
```

## Analytics & Tracking

### Deep Link Analytics
```javascript
// Automatic event logging
await logDeeplinkEvent('short_link_access', {
  ctxId: 'abc123',
  locationName: 'Trinity River',
  platform: 'ios',
  userAgent: req.get('User-Agent'),
  source: req.query.src || 'direct'
});
```

### Event Types
- **short_link_access**: Initial short link clicked
- **app_store_redirect**: User sent to app store
- **context_resolution**: Context restored in app
- **fallback_served**: Web fallback displayed

### Analytics Data
```json
{
  "event": "short_link_access",
  "data": {
    "ctxId": "abc123", 
    "locationName": "Trinity River",
    "platform": "ios",
    "source": "social",
    "userAgent": "Mozilla/5.0..."
  },
  "timestamp": "2025-01-20T14:30:00.000Z"
}
```

## Error Handling

### Context Not Found (404)
```json
{
  "success": false,
  "error": "Context not found",
  "details": "No context found for ID: invalid123",
  "suggestions": [
    "Check if the link has expired (6-hour limit)",
    "Verify the context ID is correct"
  ]
}
```

### Invalid Context ID (400)  
```json
{
  "success": false,
  "error": "Invalid context ID format",
  "details": "Context ID must be 6-50 alphanumeric characters",
  "received": "invalid-chars!@#",
  "pattern": "^[a-zA-Z0-9_-]{6,50}$"
}
```

### Rate Limit Exceeded (429)
```json
{
  "success": false,
  "error": "Rate limit exceeded", 
  "details": "Maximum 30 requests per minute",
  "retry_after": 45,
  "current_limit": {
    "requests_this_minute": 30,
    "window_resets_in": 45
  }
}
```

## Integration Examples

### Mobile App Integration
```javascript
// iOS Universal Link handling
func application(_ application: UIApplication,
                continue userActivity: NSUserActivity,
                restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    
    guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
          let url = userActivity.webpageURL else {
        return false
    }
    
    // Handle Kaayko deep links
    if url.host == "kaayko.com" {
        handleDeepLink(url)
        return true
    }
    
    return false
}

// Context resolution after app launch
func resolveContext() {
    let url = URL(string: "https://api.kaayko.com/resolve")!
    
    URLSession.shared.dataTask(with: url) { data, response, error in
        if let data = data,
           let context = try? JSONDecoder().decode(ContextResponse.self, from: data) {
            // Navigate to location with context
            navigateToLocation(context.context)
        }
    }.resume()
}
```

### Web Integration
```javascript
// Create shareable deep links
function createShareableLink(locationId, source = 'web') {
  const baseUrl = 'https://kaayko.com';
  const contextId = generateContextId();
  
  // Store context (implementation depends on backend)
  await storeContext(contextId, {
    locationId,
    source,
    created: new Date().toISOString()
  });
  
  return `${baseUrl}/l/${contextId}?src=${source}`;
}

// Social sharing integration
function shareLocation(location) {
  const shareUrl = createShareableLink(location.id, 'social');
  
  if (navigator.share) {
    navigator.share({
      title: `Check out ${location.name} on Kaayko`,
      text: `Great paddling conditions at ${location.name}!`,
      url: shareUrl
    });
  } else {
    // Fallback to clipboard
    navigator.clipboard.writeText(shareUrl);
  }
}
```

## Performance & Reliability  

### Response Times
- **Short Link Redirect**: <200ms average
- **Context Resolution**: <150ms average  
- **Web Fallback**: <300ms average
- **Error Responses**: <50ms average

### Reliability Features
- **Firestore Backup**: Context stored in reliable database
- **Cookie Redundancy**: Multiple storage mechanisms
- **Graceful Degradation**: Fallback to web experience
- **Automatic Cleanup**: Expired context removal

### Monitoring
```json
{
  "performance_metrics": {
    "avg_response_time_ms": 180,
    "p95_response_time_ms": 350,
    "error_rate": 0.02,
    "success_rate": 99.98,
    "context_hit_rate": 94.5
  }
}
```

## Use Cases

### 🔗 Primary Use Cases
1. **Social Sharing**: Share specific paddling locations
2. **QR Codes**: Physical location markers with digital context
3. **Email Campaigns**: Location-specific marketing  
4. **SMS Integration**: Text-based location sharing
5. **Cross-Platform**: Seamless app/web transitions

### 📱 Advanced Scenarios
- **App Re-engagement**: Bring users back to specific locations
- **Offline Context**: Store location data for later app use
- **Campaign Attribution**: Track marketing campaign effectiveness
- **User Journey**: Maintain context through app install flow

## Configuration & Customization

### Environment Configuration
```javascript
const DEEPLINK_CONFIG = {
  CONTEXT_TTL: 6 * 60 * 60 * 1000,     // 6 hours
  COOKIE_MAX_AGE: 30 * 60 * 1000,       // 30 minutes
  RATE_LIMIT: 30,                       // requests per minute
  APP_STORE_URLS: { /* ... */ }
};
```

### Custom Routing Parameters
```bash
# Advanced routing with source tracking
GET /l/trinity456?src=email&utm_campaign=winter2024&utm_medium=newsletter

# QR code integration  
GET /l/trinity456?src=qr&location=trailhead

# Social platform tracking
GET /l/trinity456?src=instagram&post_id=abc123
```

## Related APIs
- **paddlingOut**: Provides location data for context creation
- **fastForecast**: Weather integration for shared locations
- **paddleScore**: Current conditions for deep-linked locations

## Migration & Updates

### Version 2.0 Features
- **Enhanced Security**: Improved rate limiting and validation
- **Better Analytics**: Comprehensive event tracking
- **Platform Detection**: Smarter user-agent analysis
- **Context Redundancy**: Multiple storage mechanisms

### Breaking Changes
- Context IDs now require 6+ characters (was 3+)
- Cookie names changed from `ctx_*` to `kaayko_*`
- Analytics events structure updated
- Rate limiting applied (previously unlimited)

---
*Last Updated: December 2024*  
*API Version: 2.0.0*  
*Context TTL: 6 hours*  
*Rate Limit: 30 requests/minute*
