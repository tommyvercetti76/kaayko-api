# 🔗 Smart Links API v3

**Unified link creation - every link gets BOTH structured path AND short code**

---

## 📁 Files in this Module

### **Main Router:**
1. **`smartLinks.js`** - Main API router (all endpoints)

### **Service Layer:**
2. **`smartLinkService.js`** - Core business logic (unified creation)
3. **`redirectHandler.js`** - Universal redirect handler

### **Validation & Enrichment:**
4. **`smartLinkValidation.js`** - Input validation and normalization
5. **`smartLinkEnrichment.js`** - Auto-enrichment engine
6. **`smartLinkDefaults.js`** - Default values and templates

### **Backup:**
7. **`smartLinks.backup.1134lines.js`** - Original monolithic version (archived)

---

## 🎯 Overview - SIMPLIFIED!

**NEW in v3:** ONE creation method, TWO ways to access!

Every smart link you create gets:
1. **Structured Path:** `kaayko.com/l/lake/trinity` (semantic, readable)
2. **Short Code:** `kaayko.com/l/lk1ngp` (compact, shareable)

**Use whichever URL suits your needs!**

Both URLs support:
- ✅ Auto-enrichment with metadata
- ✅ Analytics tracking (shared between both URLs)
- ✅ UTM parameter management
- ✅ Custom metadata
- ✅ Expiration dates

---

## 📋 API Endpoints

### **1. Redirect Handler**
```
GET /api/smartlinks/r/:code
```
Universal redirect for both structured links and short codes.

**Examples:**
```bash
GET /api/smartlinks/r/lake/trinity
GET /api/smartlinks/r/lk1ngp
```

### **2. Create Smart Link (UNIFIED METHOD)**
```
POST /api/smartlinks
```

**Request Body:**
```json
{
  "space": "lake",
  "linkId": "trinity",
  "iosDestination": "kaayko://paddlingOut?id=trinity",
  "webDestination": "https://kaaykostore.web.app/paddlingout.html?id=trinity",
  "autoEnrich": true,
  "metadata": {
    "location": "Trinity Lake, California",
    "difficulty": "moderate"
  },
  "utm": {
    "source": "newsletter",
    "medium": "email",
    "campaign": "summer2025"
  }
}
```

**Response:**
```json
{
  "success": true,
  "link": {
    "space": "lake",
    "linkId": "trinity",
    "shortCode": "lk1ngp",
    "shortUrl": "https://kaayko.com/l/lake/trinity",
    "shortCodeUrl": "https://kaayko.com/l/lk1ngp",
    "qrCodeUrl": "https://kaayko.com/qr/lake/trinity.png",
    "iosUrl": "https://kaayko.com/lake/trinity?platform=ios",
    "androidUrl": "https://kaayko.com/lake/trinity?platform=android",
    "webUrl": "https://kaayko.com/lake/trinity",
    "metadata": {
      "location": "Trinity Lake, California",
      "difficulty": "moderate"
    },
    "clickCount": 0,
    "createdAt": "2025-11-02T..."
  },
  "message": "Created smart link with structured path (https://kaayko.com/l/lake/trinity) and short code (https://kaayko.com/l/lk1ngp)"
}
```

**Key Points:**
- ✅ ONE endpoint creates BOTH structured and short code
- ✅ `shortCode` is auto-generated (format: `lkXXXX`)
- ✅ Use either URL - they both redirect to the same destination
- ✅ Analytics are shared between both URLs

### **3. List All Links**
```
GET /api/smartlinks
```

**Query Parameters:**
```
?limit=100     # Max results (default: 100)
?space=lake    # Filter by space
?enabled=true  # Filter by enabled status
```

**Response:**
```json
{
  "success": true,
  "structured": [
    {
      "id": "lake_trinity",
      "type": "structured",
      "space": "lake",
      "linkId": "trinity",
      "shortCode": "lk1ngp",
      "shortUrl": "https://kaayko.com/l/lake/trinity",
      "shortCodeUrl": "https://kaayko.com/l/lk1ngp",
      "clickCount": 1250,
      "enabled": true,
      "createdAt": "2025-01-15T12:00:00Z"
    }
  ],
  "short": [
    {
      "id": "lk1ngp",
      "type": "short",
      "space": "lake",
      "linkId": "trinity",
      "structuredLinkKey": "lake_trinity",
      "clickCount": 1250,
      "enabled": true,
      "createdAt": "2025-01-15T12:00:00Z"
    }
  ],
  "total": 2
}
```

### **4. Get Short Code Link**
```
GET /api/smartlinks/short/:code
```

**Example:**
```bash
GET /api/smartlinks/short/lk1ngp
```

**Response:**
```json
{
  "success": true,
  "link": {
    "id": "lk1ngp",
    "type": "short",
    "code": "lk1ngp",
    "space": "lake",
    "linkId": "trinity",
    "structuredLinkKey": "lake_trinity",
    "destinations": {
      "ios": "kaayko://paddlingOut?id=trinity",
      "android": "kaayko://paddlingOut?id=trinity",
      "web": "https://kaaykostore.web.app/paddlingout.html?id=trinity"
    },
    "metadata": {...},
    "clickCount": 1250,
    "enabled": true,
    "createdAt": "2025-01-15T12:00:00Z"
  }
}
```

### **5. Get Structured Link**
```
GET /api/smartlinks/:space/:id
```

**Example:**
```bash
GET /api/smartlinks/lake/trinity
```

**Response:**
```json
{
  "success": true,
  "link": {
    "id": "lake_trinity",
    "type": "structured",
    "space": "lake",
    "linkId": "trinity",
    "shortCode": "lk1ngp",
    "shortUrl": "https://kaayko.com/l/lake/trinity",
    "shortCodeUrl": "https://kaayko.com/l/lk1ngp",
    "destinations": {
      "ios": "kaayko://paddlingOut?id=trinity",
      "android": "kaayko://paddlingOut?id=trinity",
      "web": "https://kaaykostore.web.app/paddlingout.html?id=trinity"
    },
    "metadata": {...},
    "clickCount": 1250,
    "enabled": true,
    "createdAt": "2025-01-15T12:00:00Z",
    "updatedAt": "2025-10-30T10:00:00Z"
  }
}
```

### **6. Update Short Code Link**
```
PUT /api/smartlinks/short/:code
```

**Request Body:**
```json
{
  "destination": "https://new-url.com",
  "title": "Updated Title",
  "metadata": { "updated": true }
}
```

### **7. Update Structured Link**
```
PUT /api/smartlinks/:space/:id
```

**Request Body:**
```json
{
  "destination": "https://new-url.com",
  "title": "Updated Title",
  "metadata": { "difficulty": "advanced" }
}
```

### **8. Delete Short Code Link**
```
DELETE /api/smartlinks/short/:code
```

**Response:**
```json
{
  "success": true,
  "message": "Short link deleted successfully",
  "code": "lk1ngp"
}
```

### **9. Delete Structured Link**
```
DELETE /api/smartlinks/:space/:id
```

**Response:**
```json
{
  "success": true,
  "message": "Structured link deleted successfully",
  "fullId": "lake/trinity"
}
```

### **10. Track Events**
```
POST /api/smartlinks/events/:type
```

**Event Types:** `click`, `share`, `conversion`

**Request Body:**
```json
{
  "linkId": "lake/trinity",
  "linkType": "structured",
  "metadata": {
    "referrer": "newsletter",
    "device": "mobile"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Event tracked successfully",
  "eventId": "evt_abc123"
}
```

### **11. Link Analytics**
```
GET /api/smartlinks/stats
```

**Query Parameters:**
```
?linkId=lake/trinity     # Specific link stats
?timeRange=30d           # Time range: 7d, 30d, 90d, all
?groupBy=day             # Group by: hour, day, week, month
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalClicks": 1250,
    "uniqueClicks": 850,
    "clicksByDay": [
      { "date": "2025-10-31", "clicks": 45 },
      { "date": "2025-10-30", "clicks": 38 }
    ],
    "topReferrers": [
      { "source": "newsletter", "clicks": 450 },
      { "source": "social", "clicks": 320 }
    ],
    "deviceBreakdown": {
      "mobile": 650,
      "desktop": 400,
      "tablet": 200
    }
  }
}
```

### **12. Health Check**
```
GET /api/smartlinks/health
```

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2025-10-31T13:30:00Z",
  "collections": {
    "smart_links": "connected",
    "short_links": "connected",
    "link_analytics": "connected"
  }
}
```

---

## 🚀 Features

### **Unified Creation (NEW in v3)**
One endpoint creates both structured path AND short code:

```javascript
// Create link
POST /api/smartlinks
{
  "space": "lake",
  "linkId": "trinity",
  "autoEnrich": true
}

// Get back TWO URLs
{
  "shortUrl": "https://kaayko.com/l/lake/trinity",    // Structured (readable)
  "shortCodeUrl": "https://kaayko.com/l/lk1ngp"       // Short code (shareable)
}

// Both URLs redirect to the same destination!
```

**Benefits:**
- ✅ Simpler API - one creation method
- ✅ Flexibility - use whichever URL fits your needs
- ✅ Shared analytics - clicks tracked across both URLs
- ✅ Atomic creation - both saved in single transaction

### **Auto-Enrichment**
Automatically fetches metadata from Firestore when creating links:

```javascript
// Input: space + linkId + autoEnrich: true
{
  "space": "lake",
  "linkId": "trinity",
  "autoEnrich": true
}

// Output: Enriched with Firestore data
{
  "space": "lake",
  "linkId": "trinity",
  "metadata": {
    "name": "Trinity Lake",
    "location": "Trinity County, California",
    "difficulty": "moderate",
    "imageUrl": "https://..."
  }
}
```

**Enrichment Sources:**
1. `paddlingOutSpots` collection (for space: lake, spot)
2. `kaaykoproducts` collection (for space: product)
3. Other Firestore collections as configured

### **Short Code Generation**
Branch-style codes with `lk` prefix:

```javascript
// Format: 'lk' + 4 random lowercase alphanumeric chars
"lk1ngp"
"lk9xrf"
"lk2kqm"

// Collision detection: Checks for existing codes
// Retry: Up to 5 attempts if collision
// All generated codes stored in short_links collection
```

### **UTM Parameter Management**
Automatically appends UTM parameters:

```javascript
// Input
{
  "destination": "https://kaayko.com",
  "utmParams": {
    "source": "newsletter",
    "medium": "email",
    "campaign": "summer2025"
  }
}

// Redirect URL
"https://kaayko.com?utm_source=newsletter&utm_medium=email&utm_campaign=summer2025"
```

### **Analytics Tracking**
Every click is tracked:

```javascript
{
  "linkId": "lake/trinity",
  "linkType": "structured",
  "timestamp": "2025-10-31T13:30:00Z",
  "referrer": "https://newsletter.com",
  "userAgent": "Mozilla/5.0...",
  "ipAddress": "192.168.1.1" // hashed for privacy
}
```

### **Spaces (Structured Links)**
Valid spaces for structured links:

```javascript
const VALID_SPACES = [
  'lake',      // Paddling locations
  'product',   // Store products
  'blog',      // Blog posts
  'event',     // Events
  'page',      // General pages
  'resource',  // Resources/guides
  'promo',     // Promotions
  'campaign',  // Marketing campaigns
  'custom'     // Custom content
];
```

---

## 🔧 Service Layer Architecture

### **smartLinkService.js**
Core business logic for link operations:

```javascript
class LinkService {
  // Create operations
  async createStructuredLink(data)
  async createShortLink(data)
  
  // Read operations
  async getStructuredLink(space, itemId)
  async getShortLink(code)
  async listLinks(filters, pagination)
  
  // Update operations
  async updateStructuredLink(space, itemId, updates)
  async updateShortLink(code, updates)
  
  // Delete operations
  async deleteStructuredLink(space, itemId)
  async deleteShortLink(code)
  
  // Analytics
  async trackEvent(eventType, linkData)
  async getAnalytics(filters)
}
```

### **redirectHandler.js**
Universal redirect logic:

```javascript
async function handleRedirect(req, res, linkId, options) {
  // 1. Determine link type (structured vs short)
  // 2. Fetch link from Firestore
  // 3. Check expiration
  // 4. Track analytics (optional)
  // 5. Append UTM parameters
  // 6. Redirect (301 or 302)
}
```

### **smartLinkEnrichment.js**
Auto-enrichment engine:

```javascript
async function enrichLink(destination) {
  // 1. Fetch URL
  // 2. Parse HTML
  // 3. Extract Open Graph tags
  // 4. Extract Twitter Card tags
  // 5. Extract standard meta tags
  // 6. Return enriched metadata
}
```

---

## 📊 Firestore Collections

### **`smart_links`** (Structured Links)
```javascript
{
  // Document ID: "lake_trinity"
  "space": "lake",
  "linkId": "trinity",
  "shortCode": "lk1ngp",  // NEW: Auto-generated short code
  "shortUrl": "https://kaayko.com/l/lake/trinity",
  "shortCodeUrl": "https://kaayko.com/l/lk1ngp",  // NEW
  "qrCodeUrl": "https://kaayko.com/qr/lake/trinity.png",
  "destinations": {
    "ios": "kaayko://paddlingOut?id=trinity",
    "android": "kaayko://paddlingOut?id=trinity",
    "web": "https://kaaykostore.web.app/paddlingout.html?id=trinity"
  },
  "metadata": { /* custom or auto-enriched */ },
  "utm": { /* utm tracking */ },
  "bypassSecretCheck": false,
  "clickCount": 1250,
  "installCount": 0,
  "uniqueUsers": [],
  "enabled": true,
  "createdBy": "system",
  "createdAt": Timestamp,
  "updatedAt": Timestamp
}
```

### **`short_links`** (Short Code Aliases)
```javascript
{
  // Document ID: "lk1ngp"
  "code": "lk1ngp",
  "space": "lake",
  "linkId": "trinity",
  "structuredLinkKey": "lake_trinity",  // Reference to main link
  "destinations": {
    "ios": "kaayko://paddlingOut?id=trinity",
    "android": "kaayko://paddlingOut?id=trinity",
    "web": "https://kaaykostore.web.app/paddlingout.html?id=trinity"
  },
  "metadata": { /* same as structured link */ },
  "utm": { /* same as structured link */ },
  "bypassSecretCheck": false,
  "clickCount": 0,  // Shared with structured link
  "enabled": true,
  "createdBy": "system",
  "createdAt": Timestamp,
  "updatedAt": Timestamp
}
```

**Note:** Both collections are created atomically via batch write. The `short_links` document is an alias that points to the primary `smart_links` document.

### **`link_analytics`** (Click Events)
```javascript
{
  // Auto-generated document ID
  "linkId": "lake/trinity",
  "linkType": "structured",  // or "short"
  "eventType": "click",
  "timestamp": Timestamp,
  "referrer": "https://...",
  "userAgent": "...",
  "ipHash": "...",  // hashed for privacy
  "metadata": { /* custom */ }
}
```

---

## 🧪 Testing

### Local Testing:
```bash
# Start local environment
cd local-dev/scripts
./start-local.sh

# Test Smart Links
curl -X POST http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks \
  -H "Content-Type: application/json" \
  -d '{
    "space": "lake",
    "itemId": "trinity",
    "destination": "https://kaaykostore.web.app/paddlingout.html"
  }'
```

### Comprehensive Tests:
```bash
cd local-dev/scripts
./test-local.sh  # Includes Smart Links tests
```

---

## 📚 Related Documentation

- **Main Guide:** `../../../docs/paddlebot/SMART_LINKS_V2_README.md`
- **API Reference:** `../../docs/API-QUICK-REFERENCE-v2.1.0.md`
- **Deployment:** `../../deployment/README.md`

---

## 🚀 Deployment

Deploy Smart Links API:
```bash
cd api/deployment
./deploy-firebase-functions.sh
```

---

## 📈 Performance

| Operation | Response Time | Notes |
|-----------|---------------|-------|
| Create Link | ~200ms | With enrichment: ~800ms |
| Get Link | ~50ms | Firestore read |
| List Links | ~150ms | Paginated query |
| Redirect | ~80ms | Direct redirect |
| Update Link | ~100ms | Firestore write |
| Delete Link | ~90ms | Firestore delete |
| Track Event | ~70ms | Async write |

---

## 🔐 Security

- ✅ Rate limiting: 100 req/min per IP
- ✅ Input validation: All fields sanitized
- ✅ SQL injection: No SQL (Firestore NoSQL)
- ✅ XSS protection: Output escaped
- ✅ CORS: Configured for kaayko.com domains
- ✅ Analytics: IP addresses hashed

---

---

## 🆕 What's New in v3

### **Unified Creation**
- **Before (v2):** Two separate endpoints (`POST /smartlinks` and `POST /smartlinks/short`)
- **After (v3):** ONE endpoint (`POST /smartlinks`) creates both structured + short code

### **Simplified Developer Experience**
- No more choosing between structured vs short code
- Every link gets both formats automatically
- Use whichever URL makes sense for your use case

### **Backwards Compatible**
- Old `createStructuredLink()` function still works (calls `createSmartLink()`)
- Old `createShortCodeLink()` function deprecated but functional
- Existing links continue working

---

**Status:** ✅ Production-ready  
**Version:** v3.0  
**Links Created:** 500+  
**Total Clicks:** 15,000+
