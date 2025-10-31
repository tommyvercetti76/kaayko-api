# 🔗 Smart Links API v2

**Advanced link management with auto-enrichment, analytics, and short codes**

---

## 📁 Files in this Module

### **Main Router:**
1. **`smartLinks.js`** - Main API router (all endpoints)

### **Service Layer:**
2. **`smartLinkService.js`** - Core business logic
3. **`redirectHandler.js`** - Universal redirect handler

### **Validation & Enrichment:**
4. **`smartLinkValidation.js`** - Input validation and normalization
5. **`smartLinkEnrichment.js`** - Auto-enrichment engine
6. **`smartLinkDefaults.js`** - Default values and templates

### **Backup:**
7. **`smartLinks.backup.1134lines.js`** - Original monolithic version (archived)

---

## 🎯 Overview

Smart Links v2 provides two link formats:
1. **Structured Links:** `kaayko.com/l/lake/trinity` (semantic, hierarchical)
2. **Short Codes:** `kaayko.com/l/lk1ngp` (compact, Branch-style)

Both formats support:
- ✅ Auto-enrichment with metadata
- ✅ Analytics tracking
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

### **2. Create Structured Link**
```
POST /api/smartlinks
```

**Request Body:**
```json
{
  "space": "lake",
  "itemId": "trinity",
  "destination": "https://kaaykostore.web.app/paddlingout.html",
  "title": "Trinity Lake Paddle",
  "metadata": {
    "location": "Trinity Lake, California",
    "difficulty": "moderate"
  },
  "utmParams": {
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
    "itemId": "trinity",
    "fullId": "lake/trinity",
    "destination": "https://kaaykostore.web.app/paddlingout.html",
    "shortUrl": "kaayko.com/l/lake/trinity",
    "enriched": {
      "title": "Trinity Lake Paddle",
      "description": "Auto-generated description..."
    }
  },
  "message": "Structured link created successfully"
}
```

### **3. Create Short Code Link**
```
POST /api/smartlinks/short
```

**Request Body:**
```json
{
  "destination": "https://kaaykostore.web.app/paddlingout.html",
  "title": "Trinity Lake",
  "customCode": "trinity2025",  // optional
  "expiresAt": "2025-12-31T23:59:59Z",  // optional
  "metadata": { "type": "lake" }
}
```

**Response:**
```json
{
  "success": true,
  "link": {
    "code": "lk1ngp",  // or "trinity2025" if customCode provided
    "destination": "https://kaaykostore.web.app/paddlingout.html",
    "shortUrl": "kaayko.com/l/lk1ngp",
    "enriched": {
      "title": "Trinity Lake",
      "description": "...",
      "ogImage": "..."
    }
  },
  "message": "Short link created successfully"
}
```

### **4. List All Links**
```
GET /api/smartlinks
```

**Query Parameters:**
```
?limit=50      # Max results (default: 50, max: 100)
?offset=0      # Pagination offset
?space=lake    # Filter by space (structured links only)
?type=short    # Filter: 'short' or 'structured'
```

**Response:**
```json
{
  "success": true,
  "links": [
    {
      "id": "lake/trinity",
      "type": "structured",
      "destination": "https://...",
      "clicks": 1250,
      "created": "2025-01-15T12:00:00Z"
    }
  ],
  "pagination": {
    "total": 145,
    "limit": 50,
    "offset": 0,
    "hasMore": true
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
    "space": "lake",
    "itemId": "trinity",
    "fullId": "lake/trinity",
    "destination": "https://...",
    "title": "Trinity Lake Paddle",
    "metadata": {...},
    "analytics": {
      "clicks": 1250,
      "lastClicked": "2025-10-31T13:30:00Z"
    },
    "created": "2025-01-15T12:00:00Z",
    "updated": "2025-10-30T10:00:00Z"
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

### **Auto-Enrichment**
Automatically fetches metadata when creating links:

```javascript
// Input: Just destination URL
{ "destination": "https://kaaykostore.web.app/paddlingout.html" }

// Output: Enriched with metadata
{
  "destination": "https://kaaykostore.web.app/paddlingout.html",
  "enriched": {
    "title": "Kaayko Paddling Locations",
    "description": "Discover 17+ amazing...",
    "ogImage": "https://...",
    "favicon": "https://..."
  }
}
```

**Enrichment Sources:**
1. Open Graph tags (`og:title`, `og:description`, `og:image`)
2. Twitter Cards (`twitter:title`, `twitter:description`)
3. Standard HTML tags (`<title>`, `<meta description>`)
4. Favicons

### **Short Code Generation**
Branch-style 6-character codes:

```javascript
// Format: lk + 4 random chars
"lk1ngp"
"lk9xrf"
"lk2kqm"

// Collision detection: Checks for existing codes
// Retry: Up to 5 attempts if collision
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
  // Document ID: "lake/trinity"
  "space": "lake",
  "itemId": "trinity",
  "fullId": "lake/trinity",
  "destination": "https://...",
  "title": "Trinity Lake Paddle",
  "description": "...",
  "metadata": { /* custom */ },
  "utmParams": { /* utm tracking */ },
  "enriched": { /* auto-enrichment */ },
  "clicks": 1250,
  "lastClicked": Timestamp,
  "created": Timestamp,
  "updated": Timestamp
}
```

### **`short_links`** (Short Code Links)
```javascript
{
  // Document ID: "lk1ngp"
  "code": "lk1ngp",
  "destination": "https://...",
  "title": "Trinity Lake",
  "description": "...",
  "metadata": { /* custom */ },
  "utmParams": { /* utm tracking */ },
  "enriched": { /* auto-enrichment */ },
  "expiresAt": Timestamp,  // optional
  "clicks": 450,
  "lastClicked": Timestamp,
  "created": Timestamp,
  "updated": Timestamp
}
```

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

**Status:** ✅ Production-ready  
**Version:** v2.0  
**Links Created:** 500+  
**Total Clicks:** 15,000+
