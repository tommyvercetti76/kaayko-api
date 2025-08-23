# 🏄 Kaayko Paddling APIs - Quick Reference v2.1.0

## 🚀 What's New in v2.1.0

### ✅ Enhanced Penalty System
- **0.5 increment ratings only**: 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0
- **Satisfactory penalties**: Extreme heat (95°F+): -1.5, High UV (9+): -0.5, Strong wind (25+ mph): -2.0
- **Detailed breakdown**: See exactly why ratings are adjusted

### ✅ Marine Data Integration
- **Wave height** and **water temperature** now factor into predictions
- **Enhanced accuracy** when marine data is available
- **Fallback logic** when marine data is unavailable

### ✅ API Consistency
- **Same conditions = same rating** across paddleScore and fastForecast
- **Shared penalty logic** ensures identical scoring
- **67% performance improvement** in fastForecast (3.8s vs 11.6s)

---

## 🎯 Core Endpoints

### 1. 🏞️ Get All Locations
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/paddlingOut"
```
**Returns**: 18+ curated paddling locations with coordinates and amenities

### 2. 🏄 Current Paddle Score (Enhanced)
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/paddleScore?location=32.881187,-96.929937"
```
**New Features**:
- Detailed penalty breakdown
- Marine data integration
- 0.5 increment ratings only

**Example Response**:
```json
{
  "paddleScore": {
    "rating": 2,
    "interpretation": "Poor - Difficult conditions", 
    "originalRating": 3.5,
    "penaltiesApplied": ["Extreme heat (99.0°F): -1.5"],
    "totalPenalty": 1.5,
    "roundedTo05Increments": true
  },
  "conditions": {
    "temperature": 99,
    "waveHeight": 0.2,
    "waterTemp": 31.4,
    "marineDataAvailable": true
  }
}
```

### 3. ⚡ 3-Day Forecast (Enhanced)
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/fastForecast?lat=32.881187&lng=-96.929937"
```
**New Features**:
- Enhanced penalty system in hourly predictions
- Marine data for each hour
- Consistent with paddleScore ratings
- 67% faster performance

**Example Hourly Data**:
```json
{
  "21": {
    "temperature": 36.2,
    "waveHeight": 0.1,
    "waterTemp": 28.2,
    "marineDataAvailable": true,
    "prediction": {
      "rating": 3,
      "originalRating": 5,
      "penaltiesApplied": [
        "Extreme heat (97.2°F): -1.5",
        "High UV (8.3): -0.5"
      ],
      "totalPenalty": 2,
      "roundedTo05Increments": true
    }
  }
}
```

---

## 📊 Enhanced Penalty System

### 🌡️ Temperature Penalties
- **High heat (85-94°F)**: -1.0 penalty
- **Extreme heat (95°F+)**: -1.5 penalty

### ☀️ UV Index Penalties
- **Moderate UV (5-8)**: -0.5 penalty
- **High UV (9-10)**: -0.5 penalty  
- **Dangerous UV (11+)**: -1.0 penalty

### 💨 Wind Speed Penalties
- **Strong wind (25+ mph)**: -2.0 penalty

### 🌊 Marine Integration
- **Wave height**: Factored into base ML prediction
- **Water temperature**: Affects comfort ratings
- **Real marine data** when available, wind-based estimates otherwise

---

## 📍 Test Locations with Expected Behaviors

### 🔥 Extreme Heat Testing
**Trinity River, TX**: `32.881187,-96.929937`
- Expected: Rating ~2.0 with "Extreme heat (99.0°F): -1.5"
- Best for testing temperature penalties

### 🏔️ High Altitude Perfect Conditions
**Cottonwood Lake, CO**: `38.781063,-106.277812` 
- Expected: Rating 4.5-5.0 with no penalties
- Best for testing normal conditions

### 🌊 Marine Data Testing
**Lake Crescent, WA**: `48.052813,-123.870438`
- Expected: Enhanced accuracy with marine data
- Look for `marineDataAvailable: true`

### ☀️ High UV Testing
**Lake Powell, UT**: `37.01513,-111.536362`
- Expected: UV penalties during peak hours
- Desert conditions with high UV index

---

## 💡 Quick Test Commands

### Test Penalty Consistency
```bash
# Both should return similar ratings for same conditions
echo "PaddleScore:" && curl -s "API_BASE/paddleScore?location=32.881187,-96.929937" | jq '.paddleScore.rating'
echo "FastForecast:" && curl -s "API_BASE/fastForecast?lat=32.881187&lng=-96.929937" | jq '.forecast[0].hourly["21"].prediction.rating'
```

### Check Penalty Breakdown
```bash
# See detailed penalty explanations
curl -s "API_BASE/paddleScore?location=32.881187,-96.929937" | jq '.paddleScore.penaltiesApplied'
```

### Verify Marine Data
```bash  
# Check marine data availability
curl -s "API_BASE/paddleScore?location=32.881187,-96.929937" | jq '{waveHeight, waterTemp, marineDataAvailable}'
```

### Test 0.5 Increment Enforcement
```bash
# All ratings should be in 0.5 increments only
curl -s "API_BASE/fastForecast?lat=32.881187&lng=-96.929937" | jq '[.forecast[].hourly[].prediction.rating] | unique'
```

---

## 🚨 Important Notes

### ⚠️ Only Use paddlingOut Coordinates
- **Required**: Always use coordinates from `/paddlingOut` endpoint
- **Reason**: Ensures accurate marine data and cached performance
- **Example**: Don't use random coordinates, use curated locations

### 🎯 Rating Scale (0.5 Increments Only)
- **Valid ratings**: 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0
- **No longer valid**: 2.3, 4.1, 3.7 (automatically rounded)

### 🌊 Marine Data Availability
- **When available**: Enhanced accuracy with real wave/water data  
- **When unavailable**: Wind-based estimates used
- **Check field**: `marineDataAvailable` in responses

### ⚡ Performance Expectations
- **paddlingOut**: ~50ms (static data)
- **paddleScore**: ~250ms (ML + weather + marine)
- **fastForecast**: <1s cached, <4s fresh (67% improvement)

---

## 🔗 Full Documentation

- **Comprehensive Guide**: `COMPREHENSIVE_API_GUIDE.md`
- **Swagger Documentation**: `kaayko-paddling-api-swagger.yaml`  
- **GitHub Repository**: [kaayko-api](https://github.com/tommyvercetti76/kaayko-api)

---

*Updated: August 18, 2025 - API Version 2.1.0*
