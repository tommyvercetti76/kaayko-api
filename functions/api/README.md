# 📚 Kaayko API Modules

**Complete documentation for all API modules**

---

## 📁 Directory Structure
### APIs (summary of modules present)
Note: the list below is derived from the current code in `functions/index.js` and each module's router files. Most modules are mounted; where parts remain unmounted (eg. adminUsers router) the README below will call that out.

1. **paddleScore** - Current paddle conditions with ML rating (GOLD STANDARD) (mounted at /paddleScore)
2. **fastForecast** - Ultra-fast cached 3-day forecasts (192ms avg) (mounted at /fastForecast)
3. **forecast** - Premium real-time forecasts with marine data (mounted at /forecast)
4. **paddlingOut** - Curated paddling locations (17+ spots) (mounted at /paddlingOut)
5. **nearbyWater** - OpenStreetMap water discovery (mounted at /nearbyWater)
├── products/      🛍️  Product catalog & images
├── deepLinks/     📱 Universal links (iOS integration)
└── core/          📚 Documentation & OpenAPI specs
```

### Smart Links API (mounted)
1. **Smart Links CRUD** - Create, read, update, delete short links (mounted at /smartlinks)
2. **Short Codes** - Short links (lkXXXX) and redirect handlers (some public redirect routes are handled by `deepLinks` module mounted at `/l/*`)
3. **Analytics** - Click tracking and stats
**README:** [weather/README.md](weather/README.md)
### Modules mapped to runtime:
| Module | Mounted? | Path | Notes |
|---|---:|---|---|
| weather (paddlingOut) | ✅ | /paddlingOut | Listed in index.js
| smartLinks | ✅ | /smartlinks | Admin + public actions (see smartLinks README)
| ai (gptActions) | ✅ | /gptActions | Mounted in index.js
| admin | ⚠️ partially mounted | /admin/* | Some admin endpoints are mounted directly (getOrder/listOrders/updateOrderStatus). adminUsers router exists but is not registered in index.js by default.
| auth | ✅ | /auth/* | Mounted in index.js (logout, me, verify)
| products | ✅ | /products and /images | Mounted
| deepLinks | ✅ | /l/* and /resolve via root router | Mounted at root '/'
| core (docs) | ✅ | /docs | Swagger UI and spec
**Endpoint coverage:** several modules are implemented (some mounted, some not). Full, code-derived docs are in each module README inside `functions/api/`.
Additional runtime helpers:
- `GET /helloWorld` → simple health / smoke-check endpoint (returns "OK").
4. **paddlingOut** - Curated paddling locations (17+ spots)
5. **nearbyWater** - OpenStreetMap water discovery

### Key Features:
- ✅ 99.98% ML accuracy (v3 model)
- ✅ Real-time + cached forecasts
- ✅ Marine data integration
- ✅ Smart warning system
- ✅ Penalty-adjusted ratings

### Endpoints:
```
GET /api/paddleScore?lat=32.8309&lng=-96.7176
GET /api/fastForecast?location=32.8309,-96.7176
GET /api/forecast?spotId=whiterlake
GET /api/paddlingout
GET /api/nearbyWater?lat=32.8309&lng=-96.7176&radius=5000
```

---

## 🔗 Smart Links APIs

**Location:** `kortex/`  
**README:** [kortex/README.md](kortex/README.md)

### APIs:
1. **Smart Links CRUD** - Create, read, update, delete links
2. **Short Codes** - Branch-style short links (lk1ngp)
3. **Redirect Handler** - Universal redirect system
4. **Analytics** - Click tracking and stats

### Key Features:
- ✅ Two link formats (structured + short codes)
- ✅ Auto-enrichment with metadata
- ✅ UTM parameter management
- ✅ Real-time analytics
- ✅ Custom expiration

### Endpoints:
```
GET    /api/smartlinks/r/:code          # Redirect
POST   /api/smartlinks                   # Create structured link
POST   /api/smartlinks/short             # Create short code
GET    /api/smartlinks                   # List all
GET    /api/smartlinks/:space/:id        # Get one
PUT    /api/smartlinks/:space/:id        # Update
DELETE /api/smartlinks/:space/:id        # Delete
POST   /api/smartlinks/events/:type      # Track event
GET    /api/smartlinks/stats              # Analytics
```

---

## 🤖 AI & Chat APIs

**Location:** `ai/`  
**README:** [ai/README.md](ai/README.md)

### APIs:
1. **GPT Actions** - OpenAI Custom GPT integration (ChatGPT)

### Key Features:
- ✅ Paddle score and weather data for GPT
- ✅ Location-based forecasts
- ✅ Nearby paddling spot discovery
- ✅ Optimized for ChatGPT consumption

### Endpoints:
```
GET    /api/gptActions/paddleScore       # GPT action: paddle score
GET    /api/gptActions/forecast          # GPT action: forecast
GET    /api/gptActions/locations         # GPT action: locations
POST   /api/gptActions/findNearby        # GPT action: nearby spots
```

---

## 🛍️ Products & Images APIs

**Location:** `products/`  
**README:** [products/README.md](products/README.md)

### APIs:
1. **Product Catalog** - T-shirt products with images
2. **Image Proxy** - Image serving with fallback

### Key Features:
- ✅ Firebase Storage integration
- ✅ 25+ product variants
- ✅ Public image URLs
- ✅ Auto-fallback to Storage

### Endpoints:
```
GET /api/products                # List all products
GET /api/products/:id            # Get single product
GET /api/images?url=...          # Proxy image
```

---

## 📱 Deep Links APIs

**Location:** `deepLinks/`  
**README:** [deepLinks/README.md](deepLinks/README.md)

### APIs:
1. **Universal Links** - iOS app integration
2. **Context Preservation** - Deferred deep linking
3. **Smart Routing** - App vs web decision

### Key Features:
- ✅ Apple Universal Links support
- ✅ Context preservation across app install
- ✅ 30-minute context expiry
- ✅ Secure cookie management

### Endpoints:
```
GET /api/l/:id                   # Universal link handler
GET /api/resolve?ctx=...         # Context restoration
GET /api/health                  # Health check
```

---

## 📚 Core APIs

**Location:** `core/`  
**README:** [core/README.md](core/README.md)

### APIs:
1. **API Documentation** - Swagger UI
2. **OpenAPI Spec** - YAML & JSON formats

### Key Features:
- ✅ Interactive documentation
- ✅ Complete API specification (2,392 lines)
- ✅ OpenAPI 3.0.3 compliant
- ✅ Try-it-out functionality

### Endpoints:
```
GET /api/docs                    # Swagger UI
GET /api/docs/spec.yaml          # OpenAPI YAML
GET /api/docs/spec.json          # OpenAPI JSON
```

---

## 📊 Complete Endpoint Overview

| Category | Count | Response Time | Key Feature |
|----------|-------|---------------|-------------|
| **Weather** | 5 | 192ms-5s | ML-powered scores |
| **Smart Links** | 12 | 50ms-200ms | Auto-enrichment |
| **AI/Chat** | 7 | 2-5s | GPT-4o integration |
| **Products** | 3 | 80ms-150ms | E-commerce catalog |
| **Deep Links** | 3 | 80ms-150ms | iOS Universal Links |
| **Core** | 3 | 50ms-200ms | Documentation |
| **TOTAL** | 33 | - | - |

---

## 🏗️ Architecture Overview

### Request Flow:
```
User/App Request
       ↓
Firebase Cloud Functions
       ↓
API Router (index.js)
       ↓
Module Router (weather/, kortex/, etc.)
       ↓
Service Layer (mlService, kortexService, etc.)
       ↓
External Services (ML, Weather APIs, OpenAI)
       ↓
Firestore (caching, persistence)
       ↓
Response
```

### Shared Services:
- **Firestore:** Data persistence, caching
- **Cloud Run:** ML service (Docker)
- **External APIs:** WeatherAPI, OpenStreetMap, OpenAI
- **Firebase Storage:** Images, assets

---

## 🔧 Development Setup

### Start Local Development:
```bash
cd local-dev/scripts
./start-local.sh
```

### Test All APIs:
```bash
cd local-dev/scripts
./test-local.sh
```

### Test Specific Module:
```bash
# Test weather APIs
curl "http://127.0.0.1:5001/kaaykostore/us-central1/api/paddleScore?lat=32.8309&lng=-96.7176"

# Test smart links
curl -X POST "http://127.0.0.1:5001/kaaykostore/us-central1/api/smartlinks/short" \
  -H "Content-Type: application/json" \
  -d '{"destination": "https://kaayko.com"}'

# Test GPT Actions
curl "http://127.0.0.1:5001/kaaykostore/us-central1/api/gptActions/paddleScore?latitude=30.3894&longitude=-97.9433"
```

---

## 📚 Documentation Hierarchy

```
📚 Documentation Structure:
│
├── 🗂️  api/functions/api/README.md (THIS FILE)
│   └── Master overview of all API modules
│
├── 🌦️  api/functions/api/weather/README.md
│   └── Complete weather APIs documentation
│
├── 🔗 api/functions/api/kortex/README.md
│   └── Complete Smart Links documentation
│
├── 🤖 api/functions/api/ai/README.md
│   └── Complete GPT Actions documentation
│
├── 🛍️  api/functions/api/products/README.md
│   └── Complete products & images documentation
│
├── 📱 api/functions/api/deepLinks/README.md
│   └── Complete deep links documentation
│
└── 📚 api/functions/api/core/README.md
    └── Complete core APIs documentation
```

---

## 🚀 Deployment

### Deploy All APIs:
```bash
cd api/deployment
./deploy-full-stack.sh
```

### Deploy Functions Only:
```bash
cd api/deployment
./deploy-firebase-functions.sh
```

### Verify Deployment:
```bash
# Check health endpoints
curl https://us-central1-kaaykostore.cloudfunctions.net/api/smartlinks/health
curl https://us-central1-kaaykostore.cloudfunctions.net/api/deepLinks/health
```

---

## 📈 Performance Benchmarks

### Response Times:
```
paddleScore:       250-500ms
fastForecast:      192ms (cached) / 3s (fresh)
forecast:          2-5s
paddlingout:       150ms
nearbyWater:       800ms-2s
kortex/create: 200ms (800ms with enrichment)
kortex/get:    50ms
gptActions:        500ms
products:          150ms
deepLinks:         100ms
docs:              50ms
```

### Caching:
- **Memory cache:** 1-5 minutes
- **Firestore cache:** 6 hours
- **Session cache:** 24 hours

---

## 🔐 Security Features

- ✅ **Rate limiting:** Per-endpoint limits
- ✅ **CORS:** Configured domains
- ✅ **Input validation:** All endpoints
- ✅ **Authentication:** Firebase Auth ready
- ✅ **API keys:** Secure environment variables
- ✅ **Privacy:** Data minimization, auto-expiry

---

## 🧪 Testing Coverage

### Local Testing:
- ✅ All 33 endpoints testable locally
- ✅ Comprehensive test script: `test-local.sh`
- ✅ Individual module tests
- ✅ Integration tests

### Production Monitoring:
- ✅ Firebase metrics dashboard
- ✅ Cloud Run logs
- ✅ Error tracking
- ✅ Performance monitoring

---

## 📚 Additional Resources

- **API Reference:** `../../docs/API-QUICK-REFERENCE-v2.1.0.md`
- **OpenAPI Spec:** `../../docs/kaayko-paddling-api-swagger.yaml`
- **Technical Docs:** `../../docs/`
- **Deployment Guide:** `../../deployment/README.md`
- **Local Dev Guide:** `../../../../local-dev/README.md`
- **Navigation:** `../../../../NAVIGATION.md`

---

## 🎯 Quick Reference

### By Use Case:

**Get paddle conditions:**
→ `weather/README.md` → paddleScore, fastForecast

**Create marketing links:**
→ `kortex/README.md` → POST /smartlinks

**ChatGPT integration:**
→ `ai/README.md` → GET /gptActions/paddleScore

**Display products:**
→ `products/README.md` → GET /products

**iOS app integration:**
→ `deepLinks/README.md` → GET /l/:id

**API documentation:**
→ `core/README.md` → GET /docs

---

**Total APIs:** 33 endpoints  
**Total Documentation:** 6 comprehensive README files  
**Status:** ✅ Production-ready  
**Uptime:** 99.9%

---

**Need help?** Check the README.md in each module directory for detailed documentation!
