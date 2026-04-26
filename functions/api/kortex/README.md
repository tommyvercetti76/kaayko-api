# 🔗 Smart Links API v4 — Short codes & Link Management

This module implements the Smart Links service used by Kaayko to create short shareable links (short codes + optional semantic paths), handle redirects and track analytics.

Note (code-derived): the `smartLinks` router is mounted at `/api/smartlinks` in `functions/index.js`. The public short link direct routes (e.g. `/l/:id`) are handled by the `deepLinks` module and may delegate to the redirect handler in this folder.

Files in this folder
- `smartLinks.js` — primary Express router for `/api/smartlinks`
- `smartLinkService.js` — core CRUD + stats business logic (writes to Firestore)
- `redirectHandler.js` — redirect logic, platform detection, click tracking
- `publicRouter.js` — lightweight public router for `/l/:id` and `/resolve` (deferred linking)
- helpers: `smartLinkValidation.js`, `smartLinkDefaults.js`, `smartLinkEnrichment.js`

Documentation style
For each endpoint we show: Endpoint, Method, Description, Auth, Request (path / query / body), Response (shape + example), Errors, Side effects.

--------------------------------------------------------------------------------
GET /health
Method: GET
Path: /api/smartlinks/health
Description: Basic health check for the Smart Links service.
Auth: public
Request: none
Response:
{
  "success": true,
  "service": "Smart Links API v4 - Short Codes Only",
  "status": "healthy",
  "timestamp": "2025-..."
}

--------------------------------------------------------------------------------
GET /stats
Method: GET
Path: /api/smartlinks/stats
Description: Return aggregated statistics for smart links (total links, total clicks, enabled/disabled counts).
Auth: public (no authentication in code)
Request: none
Response: { success: true, stats: { totalLinks, totalClicks, enabledLinks, disabledLinks } }
Errors: 500 on failure

--------------------------------------------------------------------------------
GET /r/:code
Method: GET
Path: /api/smartlinks/r/:code
Description: Redirect handler entrypoint for short codes (delegates to redirect handler; does not require auth).
Auth: public
Path params: code (string) — short code (eg. "lk1ngp")
Behavior: Delegates to `handleRedirect(req,res,code,{trackAnalytics:false})`. Will return 302 redirect on success, or branded HTML error pages on 404/410/500.
Side effects: increments click counter on `short_links/{code}` in Firestore (post-write) — tracked asynchronously.

--------------------------------------------------------------------------------
POST /
Method: POST
Path: /api/smartlinks
Description: Create a new short link (enriched metadata & destinations). This API assembles the short link, validates or generates a short code, stores the document in `short_links` collection and returns the enriched link object.
Auth: Protected — `requireAuth` and `requireAdmin` are applied in `smartLinks.js`.
Body (JSON) — fields derived from `smartLinkService.createShortLink`:
  - code (optional) — custom alias (validated)
  - webDestination (optional) — URL for web
  - iosDestination (optional)
  - androidDestination (optional)
  - title, description (optional)
  - metadata (optional object)
  - utm (optional object)
  - expiresAt (optional ISO string)
  - enabled (optional boolean)

Response (success 200):
{ success: true, link: { code, shortUrl, qrCodeUrl, destinations, title, metadata, utm, expiresAt, enabled, createdBy, createdAt } , message }

Errors:
 - 400: generic input error — JSON error details
 - 409: ALREADY_EXISTS — custom code already taken (response includes existing)

Side effects:
 - Writes `short_links/{code}` document to Firestore
 - Asynchronously triggers an email notification via `sendLinkCreatedNotification` (does not block response)

Example:
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "webDestination":"https://kaayko.com/paddlingout?id=antero", "title":"Antero" }' \
  https://<host>/api/smartlinks

--------------------------------------------------------------------------------
GET /
Method: GET
Path: /api/smartlinks
Description: List smart links, with optional filtering.
Auth: Protected — `requireAuth` and `requireAdmin` in code.
Query params:
  - enabled (optional) — 'true'|'false'
  - limit (optional) — parseable integer max results
Response: { success: true, links: [...], total }
Errors: 500 on error

--------------------------------------------------------------------------------
GET /:code
Method: GET
Path: /api/smartlinks/:code
Description: Retrieve a short link by short code. Public access.
Auth: public
Path params: code (string)
Response (200): { success: true, link: { ... } }
Errors:
  - 404: Short code not found (error.code === 'NOT_FOUND')
  - 500: internal error

--------------------------------------------------------------------------------
PUT /:code
Method: PUT
Path: /api/smartlinks/:code
Description: Update an existing short link. Admin only (protected by requireAuth + requireAdmin).
Auth: requireAuth + requireAdmin
Path params: code
Body: partial updates allowed (metadata, utm, destinations, enabled, title, description, expiresAt)
Response: { success: true, link: updated }
Errors: 404 if not found, 500 otherwise

--------------------------------------------------------------------------------
DELETE /:code
Method: DELETE
Path: /api/smartlinks/:code
Description: Delete a short link (admin-only).
Auth: requireAuth + requireAdmin
Path params: code
Response: { success: true, code }
Errors: 404 if not found, 500 otherwise

--------------------------------------------------------------------------------
POST /events/:type
Method: POST
Path: /api/smartlinks/events/:type
Description: Track custom events for short links. Stores click/install/open events in `link_analytics` collection and updates counters for installs.
Auth: public
Path params: type — event type string (install, open, click, etc.)
Body: { linkId (required), userId (optional), platform (optional), metadata (optional) }
Response: { success: true, message }
Errors: 400 if linkId missing, 500 on internal error

Side effects:
 - Writes to `link_analytics` collection
 - If type === 'install': increments `installCount` on `short_links/{linkId}` document

--------------------------------------------------------------------------------
Notes / TODOs (code-driven & non-hallucinated):
- The Smart Links router calls `requireAuth` and `requireAdmin` for creation/management endpoints. Confirm deployment configuration ensures these routes are reachable only to intended admin frontends or internal clients.
- Public short-link redirect flows are handled by `deepLinks/deeplinkRoutes.js` for top-level `/l/:id` and may use `redirectHandler` here. Verify public mounting differences if you rely on `/smartlinks/r/:code` vs `/l/:id` in production.

If anything above is not clear from the code or behavior depends on runtime wiring/hosting configuration, mark as TODO: verify in this README.
# 🔗 Smart Links API v4 - Enterprise Link Shortener# 🔗 Smart Links API v4 - Enterprise Link Shortener



**Dead simple link shortener - just like Branch or Bitly****Dead simple link shortener - just like Branch or Bitly**



Create short links that redirect anywhere:

- **`kaayko.com/l/lk1ngp`** → `https://kaayko.com/paddlingout?id=antero`

- **`kaayko.com/l/summer`** → `https://kaayko.com/store?campaign=summer2024`------

- **`kaayko.com/l/lk9xrf`** → `https://apps.apple.com/app/kaayko/id6738596808`



That's it! No complex paths, just:

1. Create link with destination URL## 🎯 What It Does## 📁 Files in this Module

2. Get back short code (`lkXXXX`) or custom alias

3. Share `kaayko.com/l/{code}`



---Creates short links that redirect anywhere:### **Main Router:**



## 📁 Module Structure- **`kaayko.com/l/lk1ngp`** → `https://kaayko.com/paddlingout?id=antero`1. **`smartLinks.js`** - Main API router (all endpoints)



### Main Router- **`kaayko.com/l/lk9xrf`** → `https://kaayko.com/store?productID=htmlk`

- **`smartLinks.js`** - Express router with 9 API endpoints

- **`kaayko.com/l/lk2kqm`** → `https://kaayko.com/paddlingout`### **Service Layer:**

### Service Layer

- **`smartLinkService.js`** - Core business logic (create, read, update, delete, stats)2. **`smartLinkService.js`** - Core business logic (unified creation)

- **`redirectHandler.js`** - Universal redirect handler with platform detection

That's it! No complex structured paths, no spaces, no IDs. Just:3. **`redirectHandler.js`** - Universal redirect handler

### Validation & Enrichment

- **`smartLinkValidation.js`** - Input validation and code generation1. Create link with destination URL

- **`smartLinkEnrichment.js`** - Auto-enrichment engine for metadata

- **`smartLinkDefaults.js`** - Default values and configuration2. Get back short code (`lkXXXX`)### **Validation & Enrichment:**



---3. Share `kaayko.com/l/lkXXXX`4. **`smartLinkValidation.js`** - Input validation and normalization



## 🚀 Quick Start5. **`smartLinkEnrichment.js`** - Auto-enrichment engine



### 1. Start Local Development Server---6. **`smartLinkDefaults.js`** - Default values and templates



```bash

cd /Users/Rohan/Desktop/kaayko-monorepo/api/functions

npm run serve## 📋 API Endpoints### **Backup:**

```

7. **`smartLinks.backup.1134lines.js`** - Original monolithic version (archived)

Functions run at: **http://127.0.0.1:5001/kaaykostore/us-central1/api**

### **1. Create Short Link**

### 2. Open Admin Portal

```---

```bash

open /Users/Rohan/Desktop/kaayko-monorepo/frontend/src/admin/smartlinks.htmlPOST /api/smartlinks

```

```## 🎯 Overview - SIMPLIFIED!

Or navigate to:

```

file:///Users/Rohan/Desktop/kaayko-monorepo/frontend/src/admin/smartlinks.html

```**Request:****NEW in v3:** ONE creation method, TWO ways to access!



### 3. Create Your First Link```json



**Via Admin UI:**{Every smart link you create gets:

1. Click "Create Link" in sidebar

2. Enter title and web destination  "iosDestination": "kaayko://paddlingOut?id=antero",1. **Structured Path:** `kaayko.com/l/lake/trinity` (semantic, readable)

3. (Optional) Add custom code, UTM params, metadata

4. Click "Create Short Link"  "webDestination": "https://kaayko.com/paddlingout?id=antero",2. **Short Code:** `kaayko.com/l/lk1ngp` (compact, shareable)



**Via API:**  "title": "Antero Reservoir",

```bash

curl -X POST http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks \  "description": "High-altitude paddling spot",**Use whichever URL suits your needs!**

  -H "Content-Type: application/json" \

  -d '{  "expiresAt": "2026-12-31T23:59:59Z"

    "title": "Test Link",

    "webDestination": "https://kaayko.com"}Both URLs support:

  }'

``````- ✅ Auto-enrichment with metadata



---- ✅ Analytics tracking (shared between both URLs)



## 📋 API Endpoints**Response:**- ✅ UTM parameter management



All endpoints under `/api/smartlinks`:```json- ✅ Custom metadata



### 1. Health Check{- ✅ Expiration dates

```

GET /api/smartlinks/health  "success": true,

```

  "link": {---

**Response:**

```json    "code": "lk1ngp",

{

  "success": true,    "shortUrl": "https://kaayko.com/l/lk1ngp",## 📋 API Endpoints

  "service": "Smart Links API v4 - Short Codes Only",

  "status": "healthy",    "qrCodeUrl": "https://kaayko.com/qr/lk1ngp.png",

  "timestamp": "2025-11-09T..."

}    "destinations": {### **1. Redirect Handler**

```

      "ios": "kaayko://paddlingOut?id=antero",```

### 2. Create Short Link

```      "android": null,GET /api/smartlinks/r/:code

POST /api/smartlinks

```      "web": "https://kaayko.com/paddlingout?id=antero"```



**Request:**    },Universal redirect for both structured links and short codes.

```json

{    "title": "Antero Reservoir",

  "title": "Summer Sale",

  "webDestination": "https://kaayko.com/sale",    "description": "High-altitude paddling spot",**Examples:**

  "code": "summer-sale",

  "iosDestination": "kaayko://sale/summer",    "clickCount": 0,```bash

  "androidDestination": "kaayko://sale/summer",

  "description": "Q3 2024 summer sale campaign",    "createdAt": "2025-11-02T..."GET /api/smartlinks/r/lake/trinity

  "metadata": {

    "campaign": "summer2024",  },GET /api/smartlinks/r/lk1ngp

    "region": "west-coast"

  },  "message": "Short link created: https://kaayko.com/l/lk1ngp"```

  "utm": {

    "utm_source": "newsletter",}

    "utm_medium": "email",

    "utm_campaign": "summer_sale_2024"```### **2. Create Smart Link (UNIFIED METHOD)**

  },

  "expiresAt": "2024-09-01T00:00:00Z",```

  "enabled": true,

  "createdBy": "marketing-team"### **2. List All Links**POST /api/smartlinks

}

`````````



**Response:**GET /api/smartlinks

```json

{```**Request Body:**

  "success": true,

  "link": {```json

    "code": "summer-sale",

    "shortUrl": "https://kaayko.com/l/summer-sale",**Query Parameters:**{

    "qrCodeUrl": "https://kaayko.com/qr/summer-sale.png",

    "destinations": {```  "space": "lake",

      "ios": "kaayko://sale/summer",

      "android": "kaayko://sale/summer",?enabled=true    # Filter by enabled status  "linkId": "trinity",

      "web": "https://kaayko.com/sale"

    },?limit=100       # Max results  "iosDestination": "kaayko://paddlingOut?id=trinity",

    "title": "Summer Sale",

    "description": "Q3 2024 summer sale campaign",```  "webDestination": "https://kaaykostore.web.app/paddlingout.html?id=trinity",

    "metadata": { "campaign": "summer2024" },

    "utm": { "utm_source": "newsletter" },  "autoEnrich": true,

    "clickCount": 0,

    "installCount": 0,**Response:**  "metadata": {

    "enabled": true,

    "createdBy": "marketing-team",```json    "location": "Trinity Lake, California",

    "createdAt": "2025-11-09T..."

  },{    "difficulty": "moderate"

  "message": "Short link created: https://kaayko.com/l/summer-sale"

}  "success": true,  },

```

  "links": [  "utm": {

**Note:** If `code` is not provided, system auto-generates format `lkXXXX` (e.g., `lk1ngp`, `lk9xrf`).

    {    "source": "newsletter",

### 3. List All Links

```      "id": "lk1ngp",    "medium": "email",

GET /api/smartlinks

```      "code": "lk1ngp",    "campaign": "summer2025"



**Query Parameters:**      "shortUrl": "https://kaayko.com/l/lk1ngp",  }

```

?enabled=true    # Filter by enabled status      "destinations": {...},}

?limit=100       # Max results (default: 100)

```      "title": "Antero Reservoir",```



**Response:**      "clickCount": 45,

```json

{      "enabled": true,**Response:**

  "success": true,

  "links": [      "createdAt": {...}```json

    {

      "id": "lk1ngp",    }{

      "code": "lk1ngp",

      "shortUrl": "https://kaayko.com/l/lk1ngp",  ],  "success": true,

      "destinations": {...},

      "title": "Antero Reservoir",  "total": 1  "link": {

      "clickCount": 45,

      "enabled": true,}    "space": "lake",

      "createdAt": {...}

    }```    "linkId": "trinity",

  ],

  "total": 1    "shortCode": "lk1ngp",

}

```### **3. Get Link by Code**    "shortUrl": "https://kaayko.com/l/lake/trinity",



### 4. Get Link by Code```    "shortCodeUrl": "https://kaayko.com/l/lk1ngp",

```

GET /api/smartlinks/:codeGET /api/smartlinks/:code    "qrCodeUrl": "https://kaayko.com/qr/lake/trinity.png",

```

```    "iosUrl": "https://kaayko.com/lake/trinity?platform=ios",

**Example:**

```bash    "androidUrl": "https://kaayko.com/lake/trinity?platform=android",

GET /api/smartlinks/lk1ngp

```**Example:**    "webUrl": "https://kaayko.com/lake/trinity",



**Response:**```bash    "metadata": {

```json

{GET /api/smartlinks/lk1ngp      "location": "Trinity Lake, California",

  "success": true,

  "link": {```      "difficulty": "moderate"

    "id": "lk1ngp",

    "code": "lk1ngp",    },

    "shortUrl": "https://kaayko.com/l/lk1ngp",

    "qrCodeUrl": "https://kaayko.com/qr/lk1ngp.png",**Response:**    "clickCount": 0,

    "destinations": {

      "ios": "kaayko://paddlingOut?id=antero",```json    "createdAt": "2025-11-02T..."

      "web": "https://kaayko.com/paddlingout?id=antero"

    },{  },

    "title": "Antero Reservoir",

    "description": "High-altitude paddling spot",  "success": true,  "message": "Created smart link with structured path (https://kaayko.com/l/lake/trinity) and short code (https://kaayko.com/l/lk1ngp)"

    "clickCount": 45,

    "enabled": true,  "link": {}

    "createdAt": {...}

  }    "id": "lk1ngp",```

}

```    "code": "lk1ngp",



### 5. Update Link    "shortUrl": "https://kaayko.com/l/lk1ngp",**Key Points:**

```

PUT /api/smartlinks/:code    "qrCodeUrl": "https://kaayko.com/qr/lk1ngp.png",- ✅ ONE endpoint creates BOTH structured and short code

```

    "destinations": {- ✅ `shortCode` is auto-generated (format: `lkXXXX`)

**Request:**

```json      "ios": "kaayko://paddlingOut?id=antero",- ✅ Use either URL - they both redirect to the same destination

{

  "destinations": {      "web": "https://kaayko.com/paddlingout?id=antero"- ✅ Analytics are shared between both URLs

    "web": "https://kaayko.com/new-url"

  },    },

  "title": "Updated Title",

  "enabled": false    "title": "Antero Reservoir",### **3. List All Links**

}

```    "description": "High-altitude paddling spot",```



### 6. Delete Link    "clickCount": 45,GET /api/smartlinks

```

DELETE /api/smartlinks/:code    "enabled": true,```

```

    "createdAt": {...}

**Response:**

```json  }**Query Parameters:**

{

  "success": true,}```

  "code": "lk1ngp"

}```?limit=100     # Max results (default: 100)

```

?space=lake    # Filter by space

### 7. Redirect (Public)

```### **4. Update Link**?enabled=true  # Filter by enabled status

GET /api/smartlinks/r/:code

`````````



Automatically redirects to the appropriate destination based on user's platform (iOS/Android/Web).PUT /api/smartlinks/:code



**Example:** User visits `https://kaayko.com/l/lk1ngp````**Response:**

- **iOS users** → Redirected to iOS app deep link

- **Android users** → Redirected to Android deep link```json

- **Everyone else** → Redirected to web URL

**Request:**{

### 8. Link Statistics

``````json  "success": true,

GET /api/smartlinks/stats

```{  "structured": [



**Response:**  "destinations": {    {

```json

{    "web": "https://kaayko.com/new-url"      "id": "lake_trinity",

  "success": true,

  "stats": {  },      "type": "structured",

    "totalLinks": 150,

    "totalClicks": 5234,  "title": "Updated Title",      "space": "lake",

    "enabledLinks": 145,

    "disabledLinks": 5  "enabled": false      "linkId": "trinity",

  }

}}      "shortCode": "lk1ngp",

```

```      "shortUrl": "https://kaayko.com/l/lake/trinity",

### 9. Track Events

```      "shortCodeUrl": "https://kaayko.com/l/lk1ngp",

POST /api/smartlinks/events/:type

```### **5. Delete Link**      "clickCount": 1250,



**Event Types:** `click`, `install`, `share`, `conversion````      "enabled": true,



**Request:**DELETE /api/smartlinks/:code      "createdAt": "2025-01-15T12:00:00Z"

```json

{```    }

  "linkId": "lk1ngp",

  "userId": "user_123",  ],

  "platform": "ios",

  "metadata": {...}**Response:**  "short": [

}

``````json    {



---{      "id": "lk1ngp",



## 🚀 Features  "success": true,      "type": "short",



### Auto-Generated Short Codes  "code": "lk1ngp"      "space": "lake",

Every link gets a unique 6-character code:

```javascript}      "linkId": "trinity",

// Format: 'lk' + 4 random lowercase alphanumeric chars

"lk1ngp"```      "structuredLinkKey": "lake_trinity",

"lk9xrf"

"lk2kqm"      "clickCount": 1250,



// Collision detection with retry logic (max 5 attempts)### **6. Redirect (Public)**      "enabled": true,

```

```      "createdAt": "2025-01-15T12:00:00Z"

### Custom Aliases

Users can provide memorable codes:GET /api/smartlinks/r/:code    }

```json

{```  ],

  "code": "summer-sale",

  "webDestination": "https://kaayko.com/sale"  "total": 2

}

// Creates: kaayko.com/l/summer-saleAutomatically redirects to the appropriate destination based on user's platform (iOS/Android/Web).}

```

```

### Platform Detection

Automatically redirects to correct destination based on user agent:### **7. Link Stats**

- **iOS users** → `iosDestination`

- **Android users** → `androidDestination````### **4. Get Short Code Link**

- **Everyone else** → `webDestination`

GET /api/smartlinks/stats```

### Click Tracking

Every redirect is tracked:```GET /api/smartlinks/short/:code

- Click count auto-increments

- Optional detailed analytics (referrer, user agent, timestamp)```

- Install event tracking

**Response:**

### Expiration Dates

Links can expire automatically:```json**Example:**

```json

{{```bash

  "expiresAt": "2026-12-31T23:59:59Z"

}  "success": true,GET /api/smartlinks/short/lk1ngp

```

After expiration, users see a branded 410 Gone page.  "stats": {```



### Enable/Disable    "totalLinks": 150,

Toggle links on/off without deleting:

```json    "totalClicks": 5234,**Response:**

{

  "enabled": false    "enabledLinks": 145,```json

}

```    "disabledLinks": 5{

Disabled links show a branded 410 Disabled page.

  }  "success": true,

### UTM Parameters

Built-in UTM tracking for analytics:}  "link": {

```json

{```    "id": "lk1ngp",

  "utm": {

    "utm_source": "newsletter",    "type": "short",

    "utm_medium": "email",

    "utm_campaign": "summer_sale_2024",### **8. Track Events**    "code": "lk1ngp",

    "utm_term": "paddle",

    "utm_content": "hero-cta"```    "space": "lake",

  }

}POST /api/smartlinks/events/:type    "linkId": "trinity",

```

```    "structuredLinkKey": "lake_trinity",

### Custom Metadata

Store arbitrary JSON data:    "destinations": {

```json

{Event types: `click`, `install`, `share`, `conversion`      "ios": "kaayko://paddlingOut?id=trinity",

  "metadata": {

    "campaign": "summer2024",      "android": "kaayko://paddlingOut?id=trinity",

    "region": "west-coast",

    "budget": 5000,**Request:**      "web": "https://kaaykostore.web.app/paddlingout.html?id=trinity"

    "targetAudience": ["kayakers", "paddleboarders"]

  }```json    },

}

```{    "metadata": {...},



---  "linkId": "lk1ngp",    "clickCount": 1250,



## 📊 Firestore Collection  "userId": "user_123",    "enabled": true,



### `short_links` Collection  "platform": "ios",    "createdAt": "2025-01-15T12:00:00Z"

```javascript

{  "metadata": {...}  }

  // Document ID: "lk1ngp" or custom code

  "code": "lk1ngp",}}

  "shortUrl": "https://kaayko.com/l/lk1ngp",

  "qrCodeUrl": "https://kaayko.com/qr/lk1ngp.png",``````

  "destinations": {

    "ios": "kaayko://paddlingOut?id=antero",

    "android": null,

    "web": "https://kaayko.com/paddlingout?id=antero"### **9. Health Check**### **5. Get Structured Link**

  },

  "title": "Antero Reservoir",``````

  "description": "High-altitude paddling spot",

  "metadata": { /* custom fields */ },GET /api/smartlinks/healthGET /api/smartlinks/:space/:id

  "utm": { /* utm tracking */ },

  "expiresAt": Timestamp | null,``````

  "clickCount": 45,

  "installCount": 12,

  "uniqueUsers": [],

  "lastClickedAt": Timestamp | null,---**Example:**

  "enabled": true,

  "createdBy": "system",```bash

  "createdAt": Timestamp,

  "updatedAt": Timestamp## 🚀 FeaturesGET /api/smartlinks/lake/trinity

}

``````



### `link_analytics` Collection### **Auto-Generated Short Codes**

```javascript

{Every link gets a unique 6-character code:**Response:**

  // Auto-generated document ID

  "type": "click",  // or "install", "share", "conversion"```json

  "linkId": "lk1ngp",

  "userId": "user_123",```javascript{

  "platform": "ios",

  "metadata": { /* event-specific data */ },// Format: 'lk' + 4 random lowercase alphanumeric chars  "success": true,

  "timestamp": Timestamp

}"lk1ngp"  "link": {

```

"lk9xrf"    "id": "lake_trinity",

---

"lk2kqm"    "type": "structured",

## 🧪 Testing

    "space": "lake",

### Test Health Check

```bash// Collision detection with retry logic    "linkId": "trinity",

curl http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/health

``````    "shortCode": "lk1ngp",



### Test Create Link    "shortUrl": "https://kaayko.com/l/lake/trinity",

```bash

curl -X POST http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks \### **Platform Detection**    "shortCodeUrl": "https://kaayko.com/l/lk1ngp",

  -H "Content-Type: application/json" \

  -d '{Automatically redirects to correct destination based on user agent:    "destinations": {

    "webDestination": "https://kaayko.com/paddlingout",

    "title": "Test Link"- **iOS users** → `iosDestination`      "ios": "kaayko://paddlingOut?id=trinity",

  }'

```- **Android users** → `androidDestination`        "android": "kaayko://paddlingOut?id=trinity",



### Test Redirect- **Everyone else** → `webDestination`      "web": "https://kaaykostore.web.app/paddlingout.html?id=trinity"

```bash

curl -L http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/r/lk1ngp    },

```

### **Click Tracking**    "metadata": {...},

### Test List Links

```bashEvery redirect is tracked:    "clickCount": 1250,

curl http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks

```- Click count auto-increments    "enabled": true,



### Test Get Link- Optional detailed analytics (referrer, user agent, timestamp)    "createdAt": "2025-01-15T12:00:00Z",

```bash

curl http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/lk1ngp    "updatedAt": "2025-10-30T10:00:00Z"

```

### **Expiration Dates**  }

### Test Update Link

```bashLinks can expire automatically:}

curl -X PUT http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/lk1ngp \

  -H "Content-Type: application/json" \```json```

  -d '{

    "enabled": false{

  }'

```  "expiresAt": "2026-12-31T23:59:59Z"### **6. Update Short Code Link**



### Test Delete Link}```

```bash

curl -X DELETE http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/lk1ngp```PUT /api/smartlinks/short/:code

```

```

---

After expiration, users see a branded 410 Gone page.

## 🎨 Admin Portal

**Request Body:**

### Access

Open in browser:### **Enable/Disable**```json

```

file:///Users/Rohan/Desktop/kaayko-monorepo/frontend/src/admin/smartlinks.htmlToggle links on/off without deleting:{

```

```json  "destination": "https://new-url.com",

Or after deploying:

```{  "title": "Updated Title",

https://kaaykostore.web.app/admin/smartlinks.html

```  "enabled": false  "metadata": { "updated": true }



### Features}}

- **📊 Dashboard** - Stats overview and recent links

- **➕ Create Link** - Form with collapsible sections``````

- **📋 All Links** - Table with search, filter, actions

- **📱 QR Codes** - Gallery and download center

- **📈 Analytics** - Performance metrics

Disabled links show a branded 410 Disabled page.### **7. Update Structured Link**

### Environment Switcher

Toggle between:```

- **Local Development** - `http://127.0.0.1:5001/...`

- **Production** - `https://us-central1-kaaykostore.cloudfunctions.net/...`---PUT /api/smartlinks/:space/:id



### QR Code Actions```

- **View** - Modal preview with full-size QR code

- **Download PNG** - 1024px high-resolution image## 📊 Firestore Collection

- **Download SVG** - Vector format for print

- **Print** - Browser print dialog**Request Body:**



---### **`short_links`**```json



## 🚀 Deployment```javascript{



### Deploy Firebase Functions{  "destination": "https://new-url.com",

```bash

cd api/deployment  // Document ID: "lk1ngp"  "title": "Updated Title",

./deploy-firebase-functions.sh

```  "code": "lk1ngp",  "metadata": { "difficulty": "advanced" }



Or deploy just Functions:  "shortUrl": "https://kaayko.com/l/lk1ngp",}

```bash

cd api/functions  "qrCodeUrl": "https://kaayko.com/qr/lk1ngp.png",```

firebase deploy --only functions

```  "destinations": {



### Deploy Frontend    "ios": "kaayko://paddlingOut?id=antero",### **8. Delete Short Code Link**

```bash

cd frontend    "android": null,```

firebase deploy --only hosting

```    "web": "https://kaayko.com/paddlingout?id=antero"DELETE /api/smartlinks/short/:code



---  },```



## 📈 Performance  "title": "Antero Reservoir",



| Operation | Response Time | Notes |  "description": "High-altitude paddling spot",**Response:**

|-----------|---------------|-------|

| Create Link | ~200ms | With enrichment: ~800ms |  "metadata": { /* custom fields */ },```json

| Get Link | ~50ms | Firestore read |

| List Links | ~150ms | Paginated query |  "utm": { /* utm tracking */ },{

| Redirect | ~80ms | Direct redirect |

| Update Link | ~100ms | Firestore write |  "expiresAt": Timestamp | null,  "success": true,

| Delete Link | ~90ms | Firestore delete |

| Track Event | ~70ms | Async write |  "clickCount": 45,  "message": "Short link deleted successfully",

| Stats | ~150ms | Aggregate query |

  "installCount": 12,  "code": "lk1ngp"

---

  "uniqueUsers": [],}

## 🔐 Security

  "enabled": true,```

- ✅ **Rate limiting**: 100 req/min per IP (public), 10 req/min (premium)

- ✅ **Input validation**: All fields sanitized, codes validated  "createdBy": "system",

- ✅ **XSS protection**: Output escaped, HTML stripped

- ✅ **CORS**: Configured for kaayko.com domains  "createdAt": Timestamp,### **9. Delete Structured Link**

- ✅ **Analytics privacy**: IP addresses hashed

- ✅ **SQL injection**: N/A (Firestore NoSQL)  "updatedAt": Timestamp,```



---  "lastClickedAt": TimestampDELETE /api/smartlinks/:space/:id



## 📚 Related Documentation}```



- **Admin Portal**: `frontend/src/admin/SMARTLINKS_README.md````

- **API Reference**: `api/docs/API-QUICK-REFERENCE-v2.1.0.md`

- **Deployment Guide**: `api/deployment/README.md`**Response:**

- **V2 Legacy Docs**: `api/SMART_LINKS_V2_README.md`

---```json

---

{

## 🆕 What Changed from v3

## 🧪 Testing  "success": true,

**Removed:**

- ❌ Structured paths (`/l/space/id`)  "message": "Structured link deleted successfully",

- ❌ Space/linkId requirements

- ❌ `smart_links` collection (separate from `short_links`)### **Local Testing:**  "fullId": "lake/trinity"

- ❌ Dual creation methods

- ❌ Complex routing logic```bash}



**Kept:**# Start local environment```

- ✅ Short codes (`/l/lkXXXX`)

- ✅ Custom aliases (`/l/summer-sale`)cd local-dev/scripts

- ✅ Platform detection

- ✅ Click tracking./start-local.sh### **10. Track Events**

- ✅ Expiration dates

- ✅ Enable/disable functionality```

- ✅ UTM parameters

- ✅ Custom metadata# Create linkPOST /api/smartlinks/events/:type



**Result:** 50% less code, 100% simpler API!curl -X POST http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks \```



---  -H "Content-Type: application/json" \



## 🎯 Best Practices  -d '{**Event Types:** `click`, `share`, `conversion`



### Link Creation    "webDestination": "https://kaayko.com/paddlingout",

1. **Always provide title** - Required for identification

2. **Use descriptive custom codes** - Easier to remember (`summer-sale` vs `lk1ngp`)    "title": "Test Link"**Request Body:**

3. **Add UTM parameters** - Essential for analytics

4. **Set expiry for campaigns** - Prevents stale links  }'```json

5. **Use metadata for segmentation** - Advanced tracking

{

### QR Code Usage

1. **Download high-res PNG** - For print materials (1024x1024px)# Test redirect  "linkId": "lake/trinity",

2. **Use SVG for logos** - Scalable without quality loss

3. **Test before printing** - Scan QR to verify URLcurl -L http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/r/lk1ngp  "linkType": "structured",

4. **Add branding** - Consider QR code frames

```  "metadata": {

### Analytics

1. **Monitor click-through rates** - Track engagement    "referrer": "newsletter",

2. **Check expiry warnings** - Renew campaigns

3. **Review disabled links** - Re-enable or delete### **Admin Dashboard:**    "device": "mobile"

4. **Analyze UTM data** - Measure campaign success

Open `frontend/src/admin/smartlinks-simple.html` in browser or deploy to Firebase Hosting.  }

---

}

**Status:** ✅ Production-ready  

**Version:** v4.0  ---```

**Total Lines of Code:** ~500 (down from ~1200 in v3)  

**Links Created:** 500+  

**Total Clicks:** 15,000+

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
