# 🌦️ Weather APIs

**Complete weather and paddle condition intelligence powered by ML**

---

## 📁 Files in this Module

### **Main API Endpoints:**
1. **`paddleScore.js`** - Current paddle conditions with ML rating
2. **`fastForecast.js`** - Ultra-fast cached 3-day forecasts
3. **`forecast.js`** - Premium real-time forecasts with marine data
4. **`paddlingout.js`** - Curated paddling locations database
5. **`nearbyWater.js`** - OpenStreetMap water discovery

### **Service Layer:**
6. **`mlService.js`** - ML model integration (99.98% accuracy)
7. **`unifiedWeatherService.js`** - Weather API aggregation

### **Data Processing:**
8. **`dataStandardization.js`** - ML input/output standardization
9. **`inputStandardization.js`** - Request parameter normalization
10. **`modelCalibration.js`** - ML prediction calibration
11. **`paddlePenalties.js`** - Condition-based rating adjustments
12. **`smartWarnings.js`** - Safety warning system

### **Utilities:**
13. **`sharedWeatherUtils.js`** - Shared utilities and middleware

---

## 🏄 API #1: Paddle Score

**File:** `paddleScore.js`  
**Endpoint:** `GET /api/paddleScore`  
**Purpose:** Get current paddle conditions with ML-powered rating

### Features:
- ✅ Real-time ML predictions (v3 model, 99.98% accuracy)
- ✅ Current weather + marine data integration
- ✅ Safety warnings and condition analysis
- ✅ 0.5-increment ratings (1.0 to 5.0)
- ✅ Detailed penalty breakdown

### Request Parameters:
```
OPTION 1: Separate coordinates
?lat=32.8309&lng=-96.7176

OPTION 2: Combined location
?location=32.8309,-96.7176

OPTION 3: Known spot ID (fastest)
?spotId=whiterlake
```

### Response Format:
```json
{
  "success": true,
  "location": {
    "name": "White Rock Lake",
    "coordinates": { "latitude": 32.8309, "longitude": -96.7176 }
  },
  "paddle_score": 4.5,
  "conditions": {
    "temperature": 72,
    "wind_speed": 8,
    "humidity": 65,
    "precipitation": 0
  },
  "marine_data": {
    "wave_height": 0.3,
    "water_temp": 68
  },
  "penalties": {
    "total": -0.5,
    "breakdown": { "wind": -0.3, "waves": -0.2 }
  },
  "warnings": ["Moderate wind conditions"],
  "timestamp": "2025-10-31T13:30:00Z"
}
```

### Key Implementation Details:
- Uses `UnifiedWeatherService` for weather data
- Calls ML service via `getPrediction()`
- Applies penalties via `applyEnhancedPenalties()`
- Calibrates via `calibrateModelPrediction()`
- Generates warnings via `getSmartWarnings()`

### Response Time:
- **With spotId:** ~250ms (fastest)
- **With coordinates:** ~400ms
- **First request:** ~500ms (cache warming)

---

## ⚡ API #2: Fast Forecast

**File:** `fastForecast.js`  
**Endpoint:** `GET /api/fastForecast`  
**Purpose:** Ultra-fast cached 3-day hourly forecasts

### Features:
- ✅ Cache-first strategy (192ms avg response)
- ✅ 3-day hourly forecasts
- ✅ ML paddle scores for each hour
- ✅ Firestore + memory caching
- ✅ Automatic cache warming (scheduled)

### Request Parameters:
```
Same as paddleScore:
?lat=32.8309&lng=-96.7176
?location=32.8309,-96.7176
?spotId=whiterlake
```

### Response Format:
```json
{
  "success": true,
  "location": { "name": "White Rock Lake", "coordinates": {...} },
  "forecast": {
    "2025-10-31": {
      "hourly": {
        "06:00": { "paddle_score": 4.0, "temp": 68, "wind_kph": 10 },
        "12:00": { "paddle_score": 4.5, "temp": 75, "wind_kph": 8 },
        "18:00": { "paddle_score": 3.5, "temp": 70, "wind_kph": 15 }
      }
    },
    "2025-11-01": { "hourly": {...} },
    "2025-11-02": { "hourly": {...} }
  },
  "cache_hit": true,
  "cached_at": "2025-10-31T12:00:00Z"
}
```

### Caching Strategy:
1. **Memory cache:** Check first (instant)
2. **Firestore cache:** Check second (50ms)
3. **Generate fresh:** If cache miss (2-5s)
4. **Cache TTL:** 6 hours
5. **Scheduled warming:** 4x daily (6am, 12pm, 6pm, 10pm)

### Response Time:
- **Cache hit:** ~192ms
- **Cache miss:** ~3s (generates + caches)

---

## 🚀 API #3: Premium Forecast

**File:** `forecast.js`  
**Endpoint:** `GET /api/forecast`  
**Purpose:** Premium real-time forecasts with advanced analytics

### Features:
- ✅ Always fresh data (no cache)
- ✅ Marine data integration
- ✅ Extended forecasts (up to 7 days)
- ✅ Detailed analytics
- ✅ Professional-grade accuracy

### Request Parameters:
```
?lat=32.8309&lng=-96.7176
?days=3  (optional, default: 3, max: 7)
```

### Response Format:
```json
{
  "success": true,
  "location": {...},
  "forecast": {
    "daily": [
      {
        "date": "2025-10-31",
        "paddle_score_avg": 4.2,
        "paddle_score_range": { "min": 3.5, "max": 4.5 },
        "best_time": "12:00",
        "conditions": {...},
        "hourly": [...]
      }
    ]
  },
  "marine_forecast": {...},
  "generated_at": "2025-10-31T13:30:00Z"
}
```

### Batch Endpoint:
```
POST /api/forecast/batch
Body: {
  "locations": [
    { "lat": 32.8309, "lng": -96.7176 },
    { "lat": 30.2672, "lng": -97.7431 }
  ]
}
```

### Response Time:
- **Single location:** ~2-5s
- **Batch (multiple):** ~3-8s

---

## 🏞️ API #4: Paddling Out (Locations)

**File:** `paddlingout.js`  
**Endpoint:** `GET /api/paddlingout`  
**Purpose:** Curated paddling locations with amenities and images

### Features:
- ✅ 17+ premium locations
- ✅ Amenities (parking, restrooms, rentals)
- ✅ Images and descriptions
- ✅ Coordinates and directions
- ✅ Difficulty ratings

### Request Parameters:
```
GET /api/paddlingout          # All locations
GET /api/paddlingout/whiterlake  # Specific location by ID
```

### Response Format (All Locations):
```json
{
  "success": true,
  "locations": [
    {
      "id": "whiterlake",
      "name": "White Rock Lake",
      "coordinates": { "latitude": 32.8309, "longitude": -96.7176 },
      "description": "9-mile loop in Dallas...",
      "amenities": {
        "parking": true,
        "restrooms": true,
        "rentals": false
      },
      "images": ["url1.jpg", "url2.jpg"],
      "difficulty": "easy"
    }
  ],
  "total": 17
}
```

### Response Format (Single Location):
```json
{
  "success": true,
  "location": {
    "id": "whiterlake",
    "name": "White Rock Lake",
    ...full details...
  }
}
```

### Data Source:
- Firestore collection: `paddlingSpots`
- Manually curated with high-quality data
- Updated regularly by team

### Response Time:
- **All locations:** ~150ms
- **Single location:** ~80ms

---

## 🗺️ API #5: Nearby Water

**File:** `nearbyWater.js`  
**Endpoint:** `GET /api/nearbyWater`  
**Purpose:** Discover paddleable water bodies via OpenStreetMap

### Features:
- ✅ Real-time OpenStreetMap data
- ✅ Multiple water types (lakes, rivers, ponds)
- ✅ Public access filtering
- ✅ Distance calculation
- ✅ Multi-server failover

### Request Parameters:
```
?lat=32.8309&lng=-96.7176
?radius=5000  (optional, meters, default: 5000, max: 50000)
?limit=20     (optional, default: 20, max: 100)
```

### Response Format:
```json
{
  "success": true,
  "location": { "latitude": 32.8309, "longitude": -96.7176 },
  "waterBodies": [
    {
      "id": "way/123456",
      "name": "White Rock Lake",
      "type": "lake",
      "distance": 450,
      "coordinates": { "latitude": 32.8309, "longitude": -96.7176 },
      "tags": {
        "access": "yes",
        "sport": "canoe"
      }
    }
  ],
  "total": 12
}
```

### Overpass API Query:
- Queries OpenStreetMap via Overpass API
- Searches for: natural=water, waterway=river, leisure=swimming_area
- Filters by: public access, proximity
- Failover servers: 3 (kumi.systems, overpass-api.de, z.overpass-api.de)

### Response Time:
- **Typical:** ~800ms
- **With failover:** ~2s

---

## 🤖 ML Service Integration

**File:** `mlService.js`

### Key Functions:

#### `getPrediction(features)`
Calls Cloud Run ML service with standardized features.

```javascript
const prediction = await getPrediction({
  latitude, longitude, temperature, wind_kph, humidity,
  cloud, precipitation, visibility, uv_index, pressure,
  // ... 57 total features
});
// Returns: { paddle_score: 4.5, raw_prediction: 4.3 }
```

### ML Model Details:
- **Version:** v3
- **Accuracy:** 99.98% R²
- **Training data:** 13.6M samples across 2,779 lakes
- **Features:** 57 engineered features
- **Output:** Raw score (0-5 continuous)

### Cloud Run Service:
- **Endpoint:** `https://kaayko-ml-service-HASH.run.app/predict`
- **Method:** POST
- **Timeout:** 10s
- **Retry:** 2 attempts

---

## 📊 Data Standardization

**File:** `dataStandardization.js`

### Key Functions:

#### `standardizeForMLModel(weatherData, marineData)`
Converts weather API response to ML model input format (57 features).

#### `standardizeForPenalties(weatherData, marineData)`
Prepares data for penalty calculation.

#### `calculateBeaufortFromKph(windKph)`
Converts wind speed to Beaufort scale (0-12).

### Standardization Flow:
```
Weather API Response
        ↓
standardizeForMLModel()
        ↓
ML Service (57 features)
        ↓
Raw Prediction
        ↓
calibrateModelPrediction()
        ↓
applyEnhancedPenalties()
        ↓
Final Score
```

---

## ⚙️ Configuration & Penalties

**File:** `paddlePenalties.js`

### Penalty System:
Adjusts ML predictions based on real-world conditions:

```javascript
{
  wind: -0.3,        // High wind penalty
  waves: -0.2,       // Wave height penalty
  precipitation: -0.5, // Rain penalty
  temperature: -0.1,  // Extreme temp penalty
  visibility: -0.2   // Low visibility penalty
}
```

### Total Penalty Range:
- **Minimum:** 0.0 (perfect conditions)
- **Maximum:** -2.0 (dangerous conditions)

---

## ⚠️ Smart Warnings

**File:** `smartWarnings.js`

### Warning Categories:
1. **Wind warnings** (>15 kph)
2. **Wave warnings** (>1m)
3. **Precipitation warnings** (>5mm)
4. **Temperature warnings** (<50°F or >95°F)
5. **Visibility warnings** (<5km)
6. **Combined condition warnings**

### Example Warnings:
```json
[
  "High wind conditions (18 kph) - experienced paddlers only",
  "Wave height 1.2m - choppy conditions",
  "Low visibility (3km) - stay close to shore"
]
```

---

## 🔧 Shared Utilities

**File:** `sharedWeatherUtils.js`

### Key Functions:
- `createRateLimitMiddleware()` - Rate limiting
- `securityHeadersMiddleware` - Security headers
- `fetchPaddlingLocations()` - Get locations from Firestore
- `createAPIErrorHandler()` - Consistent error handling

---

## 📊 Response Time Summary

| API | Cache Hit | Cache Miss | Notes |
|-----|-----------|------------|-------|
| **paddleScore** | N/A | 250-500ms | Real-time only |
| **fastForecast** | 192ms | 3s | Cache-first |
| **forecast** | N/A | 2-5s | Premium, always fresh |
| **paddlingout** | 150ms | 150ms | Firestore only |
| **nearbyWater** | N/A | 800ms-2s | OpenStreetMap API |

---

## 🔄 Cache Architecture

### Memory Cache:
- **Location:** Node.js memory
- **TTL:** 5 minutes
- **Scope:** Per Cloud Function instance

### Firestore Cache:
- **Collection:** `forecast_cache`
- **TTL:** 6 hours
- **Scope:** Global (all instances)

### Cache Warming:
- **Schedule:** 4x daily (6am, 12pm, 6pm, 10pm PST)
- **Function:** `scheduledForecastUpdate`
- **Purpose:** Pre-compute all popular locations

---

## 🚀 Deployment

All weather APIs are deployed as Firebase Cloud Functions:

```bash
cd api/deployment
./deploy-firebase-functions.sh
```

Individual deployment:
```bash
cd api/functions
firebase deploy --only functions:api
```

---

## 📚 Related Documentation

- **ML Implementation:** `../../docs/GOLD_STANDARD_IMPLEMENTATION.md`
- **Scheduled Jobs:** `../../docs/HOW_SCHEDULED_FUNCTIONS_WORK.md`
- **API Reference:** `../../docs/API-QUICK-REFERENCE-v2.1.0.md`
- **Overpass Integration:** `../../docs/WHY_OVERPASS_IS_PERFECT.md`

---

## 🧪 Testing

Test all weather APIs:
```bash
cd local-dev/scripts
./test-local.sh
```

Test specific endpoint:
```bash
curl "http://127.0.0.1:5001/kaaykostore/us-central1/api/paddleScore?lat=32.8309&lng=-96.7176"
```

---

## 📝 Code Organization

```
weather/
├── paddleScore.js           # Current conditions (GOLD STANDARD)
├── fastForecast.js          # Cached forecasts
├── forecast.js              # Premium forecasts
├── paddlingout.js           # Location database
├── nearbyWater.js           # Water discovery
├── mlService.js             # ML integration
├── unifiedWeatherService.js # Weather APIs
├── dataStandardization.js   # Data transformation
├── inputStandardization.js  # Request normalization
├── modelCalibration.js      # Prediction calibration
├── paddlePenalties.js       # Penalty system
├── smartWarnings.js         # Warning generation
└── sharedWeatherUtils.js    # Shared utilities
```

---

**Status:** ✅ Production-ready  
**ML Accuracy:** 99.98% R²  
**Uptime:** 99.9%  
**Average Response:** <500ms
