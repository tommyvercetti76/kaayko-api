# 🏄‍♂️ Kaayko API

**Fast paddling weather forecasts with ML-powered ratings for kayakers and paddlers**

## 🔒 Security Update (Dec 6, 2025)

**Admin Endpoints Now Protected:**
- `/admin/updateOrderStatus` - Requires authentication + admin role
- `/admin/getOrder` - Requires authentication + admin role  
- `/admin/listOrders` - Requires authentication + admin role

All admin endpoints now require:
1. Valid Firebase ID token in `Authorization: Bearer <token>` header
2. User must be in admin users list (verified via `requireAdmin` middleware)

**Frontend Protection:**
- Smart Links admin portal (`/admin/kortex.html`) now redirects unauthenticated users to `/admin/login.html`
- Login page uses Firebase Authentication (production)
- ID tokens are stored in localStorage and sent with API requests

## 📁 Directory Structure

```
api/
├── functions/        # ☁️ Firebase Cloud Functions
│   └── api/         # API endpoints (7 modules, 33 endpoints documented)
├── ml-service/      # 🧠 ML inference service (Cloud Run)
├── docs/            # 📚 Technical documentation & OpenAPI spec
├── archive/         # 📦 Archived/legacy code (if exists)
└── README.md        # 📘 This file
```

**Quick Navigation:**
- **API Endpoints** → [`functions/api/README.md`](./functions/api/README.md) (7 comprehensive READMEs)
- **API Reference** → [`API-QUICK-REFERENCE-v2.1.0.md`](./API-QUICK-REFERENCE-v2.1.0.md)
- **ML Implementation** → [`GOLD_STANDARD_IMPLEMENTATION.md`](./GOLD_STANDARD_IMPLEMENTATION.md)

## 🚀 Production APIs

NOTE: The list below is derived from the current `functions/index.js`. Most API modules are mounted; some pieces (e.g., adminUsers router) still exist in-code but are not automatically mounted and are marked in the module READMEs when relevant.

### **FastForecast** - `/api/fastForecast` 
**Public API for frontend - Super fast cached responses**

- **Purpose**: Serves pre-computed weather forecasts to frontend users
- **Speed**: ~192ms (cache-first architecture)
- **Rate Limit**: 60 requests/minute
- **Usage**: 
  - `GET /api/fastForecast?location=Malibu,CA`
  - `GET /api/fastForecast?spotId=malibu_surfrider`
- **Returns**: Weather + ML paddle ratings (1-5 scale) + safety levels
- **Status**: mounted and available at `/api/fastForecast` (ensure ML/Cache services are configured before heavy load)

### **Forecast** - `/api/forecast`
**Internal API for scheduled jobs and premium users**

- **Purpose**: Generates comprehensive real-time forecasts with full ML predictions
- **Speed**: ~2-5 seconds (real-time generation)
- **Rate Limit**: 10 requests/minute (internal use)
- **Usage**: 
  - `GET /api/forecast?location=Lake Tahoe`
  - `POST /api/forecast/batch` (processes all paddling spots)
- **Returns**: Deep weather analysis + ML ratings + caches results for FastForecast
- **Status**: mounted and available at `/api/forecast` (internal/premium — rate-limited)

### Scheduled Functions (forecast warming & maintenance)
The scheduled forecast jobs are enabled. They run on the following schedule (America/Los_Angeles):
- `earlyMorningForecast` — 05:00 daily
- `morningForecastUpdate` — 09:00 daily
- `afternoonForecastUpdate` — 13:00 daily
- `eveningForecastUpdate` — 17:00 daily
- `emergencyForecastRefresh` — Every 4 hours (backup)
- `forecastSchedulerHealth` — Weekly health check (Sunday midnight)

These scheduled functions are exported from `functions/scheduled/forecastScheduler.js` and will populate the `forecast_cache` Firestore collection used by `fastForecast`.

### **NearbyWater** - `/api/nearbyWater` 
**Find nearby lakes and rivers for paddling using OpenStreetMap**

- **Purpose**: Discover real water bodies (lakes, rivers, reservoirs) near any location
- **Speed**: ~2-4 seconds (Overpass API query)
- **Rate Limit**: 60 requests/minute
- **Usage**: 
  - `GET /api/nearbyWater?lat=32.7767&lng=-96.7970&radius=20`
  - `GET /api/nearbyWater?lat=33.1487&lng=-96.7005&radius=50&publicOnly=true`
- **Returns**: Real water bodies with coordinates, type (Lake/River/Reservoir), distance
- **Status**: mounted and available at `/api/nearbyWater`

---

## 📍 Location APIs

### **PaddlingOut** - `/api/paddlingOut`
**Paddling spots directory with images and details**

- **Purpose**: Manages paddling location database
- **Usage**: 
  - `GET /api/paddlingOut` → List all paddling spots
  - `GET /api/paddlingOut/:id` → Get spot details + images
- **Returns**: Spot info, amenities (parking/restrooms), coordinates, YouTube videos, photos
 - **Status**: mounted and active (see `functions/index.js` → apiApp.use('/paddlingOut', require('./api/weather/paddlingout')))

### **DeepLink** - `/api/l`
**Universal link routing with context preservation**

- **Purpose**: Smart app/web routing with location context
- **Usage**: 
  - `GET /api/l/:id` → Redirect with preserved context (e.g., `/api/l/antero456`)
  - `GET /api/resolve` → Restore context after app install
- **Features**: Platform detection, app store redirects, context cookies

---

## 🛍️ Store APIs

### **Products** - `/api/products`
**E-commerce for Kaayko merchandise**

- **Purpose**: Kaayko store product catalog
- **Usage**: 
  - `GET /api/products` → List all products with images
  - `GET /api/products/:id` → Product details
  - `POST /api/products/:id/vote` → Vote on products
- **Returns**: T-shirts, gear with images, pricing, availability, voting

### Admin endpoints (important security note)
Some admin endpoints are mounted directly in `functions/index.js` without authentication wrappers (see `apiApp.post('/admin/updateOrderStatus', ...)` and `apiApp.get('/admin/getOrder', ...)`). Confirm this is intended for your deployment; otherwise add `requireAuth` or `requireAdmin` where appropriate.

### **Images** - `/api/images`
**Secure image proxy for store products**

- **Purpose**: Proxies product images from Cloud Storage
- **Usage**: `GET /api/images/:productId/:fileName`
- **Features**: Referer checking, caching, secure image delivery

---

## 🏗️ Project Structure

```
```
kaayko-api/
├── functions/                    # 🎯 Core Firebase Functions
│   ├── api/                      # API endpoints
│   ├── config/                   # Configuration
│   ├── cache/                    # Caching logic
│   └── package.json              # Dependencies
├── ml-service/                   # 🧠 ML Prediction Service
└── docs/                         # 📚 Technical Documentation
    ├── API-QUICK-REFERENCE-v2.1.0.md
    ├── GOLD_STANDARD_IMPLEMENTATION.md
    ├── HOW_SCHEDULED_FUNCTIONS_WORK.md
    └── kaayko-paddling-api-swagger.yaml
```
```

---

## �🔧 Architecture

**Two-Tier Weather System:**
- **FastForecast**: Public → Cache → 192ms responses
- **Forecast**: Internal → Real-time ML → Caches for FastForecast

**Scheduled Jobs** (6am, 12pm, 6pm, 10pm):
- Pre-compute all paddling locations using `/forecast/batch`
- Store results in Firestore cache
- FastForecast serves cached data instantly

**ML Service**: Cloud Run deployment provides dynamic paddle ratings (1-5 scale) based on weather conditions

**Water Discovery**: Overpass API integration finds real lakes/rivers using OpenStreetMap data

---

## 📊 Quick Reference

**33 endpoints across 6 modules** - Full docs in [`functions/api/README.md`](./functions/api/README.md)

| Module | Endpoints | Documentation | Key Features |
|--------|-----------|---------------|--------------|
| **Weather** | 5 APIs | [`weather/README.md`](./functions/api/weather/README.md) | ML ratings, forecasts, locations |
| **Smart Links** | 12 APIs | [`kortex/README.md`](./functions/api/kortex/README.md) | Link management, analytics |
| **AI/Chat** | 4 APIs | [`ai/README.md`](./functions/api/ai/README.md) | GPT Actions (ChatGPT) |
| **Products** | 3 APIs | [`products/README.md`](./functions/api/products/README.md) | E-commerce catalog |
| **Deep Links** | 3 APIs | [`deepLinks/README.md`](./functions/api/deepLinks/README.md) | Universal links (iOS) |
| **Core** | 3 APIs | [`core/README.md`](./functions/api/core/README.md) | API documentation |

**Production**: Firebase Functions + Cloud Run ML Service + Firestore caching + Cloud Storage + OpenStreetMap
