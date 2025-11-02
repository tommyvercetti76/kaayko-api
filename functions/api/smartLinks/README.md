# 🔗 Smart Links API v4 - SHORT CODES ONLY!# 🔗 Smart Links API v3



**Dead simple link shortener - just like Branch or Bitly****Unified link creation - every link gets BOTH structured path AND short code**



------



## 🎯 What It Does## 📁 Files in this Module



Creates short links that redirect anywhere:### **Main Router:**

- **`kaayko.com/l/lk1ngp`** → `https://kaayko.com/paddlingout?id=antero`1. **`smartLinks.js`** - Main API router (all endpoints)

- **`kaayko.com/l/lk9xrf`** → `https://kaayko.com/store?productID=htmlk`

- **`kaayko.com/l/lk2kqm`** → `https://kaayko.com/paddlingout`### **Service Layer:**

2. **`smartLinkService.js`** - Core business logic (unified creation)

That's it! No complex structured paths, no spaces, no IDs. Just:3. **`redirectHandler.js`** - Universal redirect handler

1. Create link with destination URL

2. Get back short code (`lkXXXX`)### **Validation & Enrichment:**

3. Share `kaayko.com/l/lkXXXX`4. **`smartLinkValidation.js`** - Input validation and normalization

5. **`smartLinkEnrichment.js`** - Auto-enrichment engine

---6. **`smartLinkDefaults.js`** - Default values and templates



## 📋 API Endpoints### **Backup:**

7. **`smartLinks.backup.1134lines.js`** - Original monolithic version (archived)

### **1. Create Short Link**

```---

POST /api/smartlinks

```## 🎯 Overview - SIMPLIFIED!



**Request:****NEW in v3:** ONE creation method, TWO ways to access!

```json

{Every smart link you create gets:

  "iosDestination": "kaayko://paddlingOut?id=antero",1. **Structured Path:** `kaayko.com/l/lake/trinity` (semantic, readable)

  "webDestination": "https://kaayko.com/paddlingout?id=antero",2. **Short Code:** `kaayko.com/l/lk1ngp` (compact, shareable)

  "title": "Antero Reservoir",

  "description": "High-altitude paddling spot",**Use whichever URL suits your needs!**

  "expiresAt": "2026-12-31T23:59:59Z"

}Both URLs support:

```- ✅ Auto-enrichment with metadata

- ✅ Analytics tracking (shared between both URLs)

**Response:**- ✅ UTM parameter management

```json- ✅ Custom metadata

{- ✅ Expiration dates

  "success": true,

  "link": {---

    "code": "lk1ngp",

    "shortUrl": "https://kaayko.com/l/lk1ngp",## 📋 API Endpoints

    "qrCodeUrl": "https://kaayko.com/qr/lk1ngp.png",

    "destinations": {### **1. Redirect Handler**

      "ios": "kaayko://paddlingOut?id=antero",```

      "android": null,GET /api/smartlinks/r/:code

      "web": "https://kaayko.com/paddlingout?id=antero"```

    },Universal redirect for both structured links and short codes.

    "title": "Antero Reservoir",

    "description": "High-altitude paddling spot",**Examples:**

    "clickCount": 0,```bash

    "createdAt": "2025-11-02T..."GET /api/smartlinks/r/lake/trinity

  },GET /api/smartlinks/r/lk1ngp

  "message": "Short link created: https://kaayko.com/l/lk1ngp"```

}

```### **2. Create Smart Link (UNIFIED METHOD)**

```

### **2. List All Links**POST /api/smartlinks

``````

GET /api/smartlinks

```**Request Body:**

```json

**Query Parameters:**{

```  "space": "lake",

?enabled=true    # Filter by enabled status  "linkId": "trinity",

?limit=100       # Max results  "iosDestination": "kaayko://paddlingOut?id=trinity",

```  "webDestination": "https://kaaykostore.web.app/paddlingout.html?id=trinity",

  "autoEnrich": true,

**Response:**  "metadata": {

```json    "location": "Trinity Lake, California",

{    "difficulty": "moderate"

  "success": true,  },

  "links": [  "utm": {

    {    "source": "newsletter",

      "id": "lk1ngp",    "medium": "email",

      "code": "lk1ngp",    "campaign": "summer2025"

      "shortUrl": "https://kaayko.com/l/lk1ngp",  }

      "destinations": {...},}

      "title": "Antero Reservoir",```

      "clickCount": 45,

      "enabled": true,**Response:**

      "createdAt": {...}```json

    }{

  ],  "success": true,

  "total": 1  "link": {

}    "space": "lake",

```    "linkId": "trinity",

    "shortCode": "lk1ngp",

### **3. Get Link by Code**    "shortUrl": "https://kaayko.com/l/lake/trinity",

```    "shortCodeUrl": "https://kaayko.com/l/lk1ngp",

GET /api/smartlinks/:code    "qrCodeUrl": "https://kaayko.com/qr/lake/trinity.png",

```    "iosUrl": "https://kaayko.com/lake/trinity?platform=ios",

    "androidUrl": "https://kaayko.com/lake/trinity?platform=android",

**Example:**    "webUrl": "https://kaayko.com/lake/trinity",

```bash    "metadata": {

GET /api/smartlinks/lk1ngp      "location": "Trinity Lake, California",

```      "difficulty": "moderate"

    },

**Response:**    "clickCount": 0,

```json    "createdAt": "2025-11-02T..."

{  },

  "success": true,  "message": "Created smart link with structured path (https://kaayko.com/l/lake/trinity) and short code (https://kaayko.com/l/lk1ngp)"

  "link": {}

    "id": "lk1ngp",```

    "code": "lk1ngp",

    "shortUrl": "https://kaayko.com/l/lk1ngp",**Key Points:**

    "qrCodeUrl": "https://kaayko.com/qr/lk1ngp.png",- ✅ ONE endpoint creates BOTH structured and short code

    "destinations": {- ✅ `shortCode` is auto-generated (format: `lkXXXX`)

      "ios": "kaayko://paddlingOut?id=antero",- ✅ Use either URL - they both redirect to the same destination

      "web": "https://kaayko.com/paddlingout?id=antero"- ✅ Analytics are shared between both URLs

    },

    "title": "Antero Reservoir",### **3. List All Links**

    "description": "High-altitude paddling spot",```

    "clickCount": 45,GET /api/smartlinks

    "enabled": true,```

    "createdAt": {...}

  }**Query Parameters:**

}```

```?limit=100     # Max results (default: 100)

?space=lake    # Filter by space

### **4. Update Link**?enabled=true  # Filter by enabled status

``````

PUT /api/smartlinks/:code

```**Response:**

```json

**Request:**{

```json  "success": true,

{  "structured": [

  "destinations": {    {

    "web": "https://kaayko.com/new-url"      "id": "lake_trinity",

  },      "type": "structured",

  "title": "Updated Title",      "space": "lake",

  "enabled": false      "linkId": "trinity",

}      "shortCode": "lk1ngp",

```      "shortUrl": "https://kaayko.com/l/lake/trinity",

      "shortCodeUrl": "https://kaayko.com/l/lk1ngp",

### **5. Delete Link**      "clickCount": 1250,

```      "enabled": true,

DELETE /api/smartlinks/:code      "createdAt": "2025-01-15T12:00:00Z"

```    }

  ],

**Response:**  "short": [

```json    {

{      "id": "lk1ngp",

  "success": true,      "type": "short",

  "code": "lk1ngp"      "space": "lake",

}      "linkId": "trinity",

```      "structuredLinkKey": "lake_trinity",

      "clickCount": 1250,

### **6. Redirect (Public)**      "enabled": true,

```      "createdAt": "2025-01-15T12:00:00Z"

GET /api/smartlinks/r/:code    }

```  ],

  "total": 2

Automatically redirects to the appropriate destination based on user's platform (iOS/Android/Web).}

```

### **7. Link Stats**

```### **4. Get Short Code Link**

GET /api/smartlinks/stats```

```GET /api/smartlinks/short/:code

```

**Response:**

```json**Example:**

{```bash

  "success": true,GET /api/smartlinks/short/lk1ngp

  "stats": {```

    "totalLinks": 150,

    "totalClicks": 5234,**Response:**

    "enabledLinks": 145,```json

    "disabledLinks": 5{

  }  "success": true,

}  "link": {

```    "id": "lk1ngp",

    "type": "short",

### **8. Track Events**    "code": "lk1ngp",

```    "space": "lake",

POST /api/smartlinks/events/:type    "linkId": "trinity",

```    "structuredLinkKey": "lake_trinity",

    "destinations": {

Event types: `click`, `install`, `share`, `conversion`      "ios": "kaayko://paddlingOut?id=trinity",

      "android": "kaayko://paddlingOut?id=trinity",

**Request:**      "web": "https://kaaykostore.web.app/paddlingout.html?id=trinity"

```json    },

{    "metadata": {...},

  "linkId": "lk1ngp",    "clickCount": 1250,

  "userId": "user_123",    "enabled": true,

  "platform": "ios",    "createdAt": "2025-01-15T12:00:00Z"

  "metadata": {...}  }

}}

``````



### **9. Health Check**### **5. Get Structured Link**

``````

GET /api/smartlinks/healthGET /api/smartlinks/:space/:id

``````



---**Example:**

```bash

## 🚀 FeaturesGET /api/smartlinks/lake/trinity

```

### **Auto-Generated Short Codes**

Every link gets a unique 6-character code:**Response:**

```json

```javascript{

// Format: 'lk' + 4 random lowercase alphanumeric chars  "success": true,

"lk1ngp"  "link": {

"lk9xrf"    "id": "lake_trinity",

"lk2kqm"    "type": "structured",

    "space": "lake",

// Collision detection with retry logic    "linkId": "trinity",

```    "shortCode": "lk1ngp",

    "shortUrl": "https://kaayko.com/l/lake/trinity",

### **Platform Detection**    "shortCodeUrl": "https://kaayko.com/l/lk1ngp",

Automatically redirects to correct destination based on user agent:    "destinations": {

- **iOS users** → `iosDestination`      "ios": "kaayko://paddlingOut?id=trinity",

- **Android users** → `androidDestination`        "android": "kaayko://paddlingOut?id=trinity",

- **Everyone else** → `webDestination`      "web": "https://kaaykostore.web.app/paddlingout.html?id=trinity"

    },

### **Click Tracking**    "metadata": {...},

Every redirect is tracked:    "clickCount": 1250,

- Click count auto-increments    "enabled": true,

- Optional detailed analytics (referrer, user agent, timestamp)    "createdAt": "2025-01-15T12:00:00Z",

    "updatedAt": "2025-10-30T10:00:00Z"

### **Expiration Dates**  }

Links can expire automatically:}

```json```

{

  "expiresAt": "2026-12-31T23:59:59Z"### **6. Update Short Code Link**

}```

```PUT /api/smartlinks/short/:code

```

After expiration, users see a branded 410 Gone page.

**Request Body:**

### **Enable/Disable**```json

Toggle links on/off without deleting:{

```json  "destination": "https://new-url.com",

{  "title": "Updated Title",

  "enabled": false  "metadata": { "updated": true }

}}

``````



Disabled links show a branded 410 Disabled page.### **7. Update Structured Link**

```

---PUT /api/smartlinks/:space/:id

```

## 📊 Firestore Collection

**Request Body:**

### **`short_links`**```json

```javascript{

{  "destination": "https://new-url.com",

  // Document ID: "lk1ngp"  "title": "Updated Title",

  "code": "lk1ngp",  "metadata": { "difficulty": "advanced" }

  "shortUrl": "https://kaayko.com/l/lk1ngp",}

  "qrCodeUrl": "https://kaayko.com/qr/lk1ngp.png",```

  "destinations": {

    "ios": "kaayko://paddlingOut?id=antero",### **8. Delete Short Code Link**

    "android": null,```

    "web": "https://kaayko.com/paddlingout?id=antero"DELETE /api/smartlinks/short/:code

  },```

  "title": "Antero Reservoir",

  "description": "High-altitude paddling spot",**Response:**

  "metadata": { /* custom fields */ },```json

  "utm": { /* utm tracking */ },{

  "expiresAt": Timestamp | null,  "success": true,

  "clickCount": 45,  "message": "Short link deleted successfully",

  "installCount": 12,  "code": "lk1ngp"

  "uniqueUsers": [],}

  "enabled": true,```

  "createdBy": "system",

  "createdAt": Timestamp,### **9. Delete Structured Link**

  "updatedAt": Timestamp,```

  "lastClickedAt": TimestampDELETE /api/smartlinks/:space/:id

}```

```

**Response:**

---```json

{

## 🧪 Testing  "success": true,

  "message": "Structured link deleted successfully",

### **Local Testing:**  "fullId": "lake/trinity"

```bash}

# Start local environment```

cd local-dev/scripts

./start-local.sh### **10. Track Events**

```

# Create linkPOST /api/smartlinks/events/:type

curl -X POST http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks \```

  -H "Content-Type: application/json" \

  -d '{**Event Types:** `click`, `share`, `conversion`

    "webDestination": "https://kaayko.com/paddlingout",

    "title": "Test Link"**Request Body:**

  }'```json

{

# Test redirect  "linkId": "lake/trinity",

curl -L http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/r/lk1ngp  "linkType": "structured",

```  "metadata": {

    "referrer": "newsletter",

### **Admin Dashboard:**    "device": "mobile"

Open `frontend/src/admin/smartlinks-simple.html` in browser or deploy to Firebase Hosting.  }

}

---```



## 🚀 Deployment**Response:**

```json

```bash{

cd api/deployment  "success": true,

./deploy-firebase-functions.sh  "message": "Event tracked successfully",

```  "eventId": "evt_abc123"

}

Or deploy just Functions:```

```bash

cd api/functions### **11. Link Analytics**

firebase deploy --only functions```

```GET /api/smartlinks/stats

```

---

**Query Parameters:**

## 📈 Performance```

?linkId=lake/trinity     # Specific link stats

| Operation | Response Time |?timeRange=30d           # Time range: 7d, 30d, 90d, all

|-----------|---------------|?groupBy=day             # Group by: hour, day, week, month

| Create Link | ~150ms |```

| Get Link | ~50ms |

| List Links | ~120ms |**Response:**

| Redirect | ~80ms |```json

| Update Link | ~100ms |{

| Delete Link | ~90ms |  "success": true,

  "stats": {

---    "totalClicks": 1250,

    "uniqueClicks": 850,

## 🔐 Security    "clicksByDay": [

      { "date": "2025-10-31", "clicks": 45 },

- ✅ Rate limiting: 100 req/min per IP      { "date": "2025-10-30", "clicks": 38 }

- ✅ Input validation: All fields sanitized    ],

- ✅ XSS protection: Output escaped    "topReferrers": [

- ✅ CORS: Configured for kaayko.com domains      { "source": "newsletter", "clicks": 450 },

- ✅ Analytics: IP addresses hashed for privacy      { "source": "social", "clicks": 320 }

    ],

---    "deviceBreakdown": {

      "mobile": 650,

## 🆕 What Changed from v3?      "desktop": 400,

      "tablet": 200

**Removed:**    }

- ❌ Structured paths (`/l/space/id`)  }

- ❌ Space/linkId requirements}

- ❌ smart_links collection```

- ❌ Dual creation methods

- ❌ Complex routing logic### **12. Health Check**

```

**Kept:**GET /api/smartlinks/health

- ✅ Short codes (`/l/lkXXXX`)```

- ✅ Platform detection

- ✅ Click tracking**Response:**

- ✅ Expiration dates```json

- ✅ Enable/disable functionality{

  "success": true,

**Result:** 50% less code, 100% simpler API!  "status": "healthy",

  "timestamp": "2025-10-31T13:30:00Z",

---  "collections": {

    "smart_links": "connected",

**Status:** ✅ Production-ready      "short_links": "connected",

**Version:** v4.0      "link_analytics": "connected"

**Total Lines of Code:** ~500 (down from ~1200)  }

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
