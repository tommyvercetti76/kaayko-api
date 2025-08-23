# 🏄‍♂️ Kaayko API

**Fast paddling weather forecasts with ML-powered ratings for kayakers and paddlers**

## 🚀 Production APIs

### **FastForecast** - `/api/fastForecast` 
**Public API for frontend - Super fast cached responses**

- **Purpose**: Serves pre-computed weather forecasts to frontend users
- **Speed**: ~192ms (cache-first architecture)
- **Rate Limit**: 60 requests/minute
- **Usage**: 
  - `GET /api/fastForecast?location=Malibu,CA`
  - `GET /api/fastForecast?spotId=malibu_surfrider`
- **Returns**: Weather + ML paddle ratings (1-5 scale) + safety levels

### **Forecast** - `/api/forecast`
**Internal API for scheduled jobs and premium users**

- **Purpose**: Generates comprehensive real-time forecasts with full ML predictions
- **Speed**: ~2-5 seconds (real-time generation)
- **Rate Limit**: 10 requests/minute (internal use)
- **Usage**: 
  - `GET /api/forecast?location=Lake Tahoe`
  - `POST /api/forecast/batch` (processes all paddling spots)
- **Returns**: Deep weather analysis + ML ratings + caches results for FastForecast

### **NearbyWater** - `/api/nearbyWater` 
**Find nearby lakes and rivers for paddling using OpenStreetMap**

- **Purpose**: Discover real water bodies (lakes, rivers, reservoirs) near any location
- **Speed**: ~2-4 seconds (Overpass API query)
- **Rate Limit**: 60 requests/minute
- **Usage**: 
  - `GET /api/nearbyWater?lat=32.7767&lng=-96.7970&radius=20`
  - `GET /api/nearbyWater?lat=33.1487&lng=-96.7005&radius=50&publicOnly=true`
- **Returns**: Real water bodies with coordinates, type (Lake/River/Reservoir), distance

---

## 📍 Location APIs

### **PaddlingOut** - `/api/paddlingOut`
**Paddling spots directory with images and details**

- **Purpose**: Manages paddling location database
- **Usage**: 
  - `GET /api/paddlingOut` → List all paddling spots
  - `GET /api/paddlingOut/:id` → Get spot details + images
- **Returns**: Spot info, amenities (parking/restrooms), coordinates, YouTube videos, photos

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

### **Images** - `/api/images`
**Secure image proxy for store products**

- **Purpose**: Proxies product images from Cloud Storage
- **Usage**: `GET /api/images/:productId/:fileName`
- **Features**: Referer checking, caching, secure image delivery

---

## 🏗️ Project Structure

```
kaayko-api/
├── functions/                    # 🎯 Core Firebase Functions
│   ├── src/
│   │   ├── api/                  # API endpoints
│   │   ├── services/             # Business logic
│   │   ├── scheduled/            # Scheduled functions
│   │   ├── middleware/           # Request middleware
│   │   ├── utils/                # Utilities
│   │   ├── config/               # Configuration
│   │   └── cache/                # Caching logic
│   └── package.json              # Dependencies
├── ml-service/                   # 🧠 ML Prediction Service
├── docs/                         # � Documentation
│   ├── API-QUICK-REFERENCE-v2.1.0.md
│   ├── DEPLOYMENT_GUIDE.md
│   └── kaayko-paddling-api-swagger.yaml
└── archive/                      # 📦 Archived/obsolete files
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

| API | Purpose | Speed | Usage |
|-----|---------|-------|-------|
| `/api/fastForecast` | Public weather | 192ms | Frontend |
| `/api/forecast` | Real-time ML | 2-5s | Scheduled jobs |
| `/api/nearbyWater` | Find lakes/rivers | 2-4s | Water discovery |
| `/api/paddlingOut` | Location data | Fast | Spot directory |
| `/api/l/:id` | Smart routing | Instant | Deep links |
| `/api/products` | Store catalog | Fast | E-commerce |
| `/api/images` | Image proxy | Fast | Secure delivery |

**Production**: Firebase Functions + Cloud Run ML Service + Firestore caching + Cloud Storage + OpenStreetMap
