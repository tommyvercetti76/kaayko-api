# 🏄 paddleScore API Documentation

## Overview
The paddleScore API provides instant paddle condition ratings powered by machine learning. It analyzes current weather and marine conditions to deliver a single, actionable paddle score with detailed condition breakdown.

## Endpoint
```
GET /paddleScore
```

## Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `location` | string | Optional* | Comma-separated lat,lng coordinates | `"32.881187,-96.929937"` |
| `spotId` | string | Optional* | Location ID from paddlingOut API (faster) | `"trinity"` |

*One of `location` or `spotId` is required

## Request Examples

### Using Coordinates
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/paddleScore?location=32.881187,-96.929937"
```

### Using Spot ID (Faster)
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/paddleScore?spotId=trinity"
```

## Response Format

### Success Response (200)
```json
{
  "success": true,
  "location": {
    "name": "Custom Location",
    "coordinates": {
      "latitude": 32.881187,
      "longitude": -96.929937
    },
    "region": "Texas",
    "country": "United States of America"
  },
  "paddleScore": {
    "rating": 2.0,
    "interpretation": "Poor - Difficult conditions", 
    "confidence": "high",
    "modelUsed": "production-ml",
    "originalRating": 3.5,
    "penaltiesApplied": [
      "Extreme heat (99.0°F): -1.5"
    ],
    "totalPenalty": 1.5,
    "roundedTo05Increments": true
  },
  "conditions": {
    "temperature": 99,
    "windSpeed": 2.2,
    "beaufortScale": 0,
    "uvIndex": 0,
    "visibility": 21,
    "humidity": 33,
    "cloudCover": 25,
    "hasWarnings": false,
    "waveHeight": 0.2,
    "waterTemp": 31.4,
    "marineDataAvailable": true
  },
  "metadata": {
    "source": "ml-model",
    "modelType": "GradientBoostingRegressor",
    "timestamp": "2025-01-20T14:39:07.544Z",
    "response_time_ms": 240
  }
}
```

## ML Rating System

### Enhanced Penalty Framework
The ML model applies intelligent penalties for challenging paddling conditions:

| Condition Type | Penalty Range | Examples |
|---------------|---------------|----------|
| **Temperature** | -1.0 to -1.5 | High heat (85-94°F): -1.0<br>Extreme heat (95°F+): -1.5 |
| **UV Index** | -0.5 to -1.0 | Moderate (5-8): -0.5<br>High (9-10): -0.5<br>Dangerous (11+): -1.0 |
| **Wind Speed** | -2.0 | Strong wind (25+ mph): -2.0 |
| **Marine Conditions** | Variable | Integrated into base ML prediction |

### Rating Scale (0.5 Increments Only)
- **5.0**: Perfect - Ideal conditions
- **4.5**: Excellent - Great for paddling  
- **4.0**: Very Good - Highly recommended
- **3.5**: Good - Enjoyable conditions
- **3.0**: Fair/Moderate - Acceptable 
- **2.5**: Below Average - Some challenges
- **2.0**: Poor - Difficult conditions
- **1.5**: Difficult - For experienced paddlers only
- **1.0**: Dangerous - Avoid paddling

## Performance

### Response Times
- **Average**: ~250ms
- **P95**: <500ms
- **Cached**: <100ms (for known locations)
- **Peak Load**: <1 second

### Optimization Features
- **Spot ID Lookup**: Faster than coordinate-based queries
- **Intelligent Caching**: Popular locations pre-cached
- **ML Model Caching**: Prediction model loaded in memory
- **Response Compression**: Reduced payload size

## Data Integration

### Weather Sources
- **Primary Weather**: WeatherAPI.com professional service
- **Marine Data**: Wave height and water temperature when available
- **ML Predictions**: Production-grade gradient boosting model
- **Real-time Updates**: Current condition snapshots

### Marine Data Enhancement
- **Wave Height**: Measured in meters, factors into base ML prediction
- **Water Temperature**: Celsius, integrated into comfort calculations
- **Availability**: Coastal and large lake locations
- **Fallback**: Estimated values for inland locations

## Use Cases

### 🎯 Primary Applications
1. **Quick Condition Check**: "Should I paddle right now?"
2. **Spot Comparison**: Compare multiple locations rapidly
3. **Real-time Monitoring**: Track changing conditions
4. **Mobile Widgets**: Compact condition displays

### 📱 Integration Patterns
- **Dashboard Widgets**: Single-score condition summary
- **Map Overlays**: Color-coded location ratings
- **Push Notifications**: Condition alerts
- **Voice Assistants**: "Hey Google, what's the paddle score?"

## API Consistency

### Cross-API Synchronization
- **Identical Ratings**: Same conditions = same score as fastForecast
- **Shared ML Model**: Uses same production prediction engine
- **Unified Penalties**: Consistent penalty system across APIs
- **Synchronized Updates**: Model updates applied simultaneously

### Response Standardization
- **Common Fields**: Consistent naming across weather APIs  
- **Error Formats**: Standardized error response structure
- **Metadata**: Uniform timestamp and source tracking
- **Rating Format**: Always 0.5 increments, never decimals

## Error Handling

| Error Code | Description | Typical Cause |
|------------|-------------|---------------|
| 200 | Success | Valid request with data |
| 400 | Bad Request | Invalid coordinates or missing parameters |
| 404 | Not Found | Invalid spotId |
| 429 | Rate Limited | Too many requests |
| 500 | Internal Error | Service or ML model unavailable |

### Error Response Format
```json
{
  "success": false,
  "error": "Invalid coordinates",
  "details": "lat and lng must be valid numbers",
  "suggestion": "Use coordinates from paddlingOut API or valid spotId",
  "timestamp": "2025-01-20T14:39:07.544Z"
}
```

## Rate Limits & Usage

### Access Limits
- **Rate Limit**: 120 requests per minute per IP
- **Burst Allowance**: 240 requests per minute (2-minute window)
- **Concurrent**: Up to 20 simultaneous requests
- **Daily Limit**: 10,000 requests per IP

### Fair Usage
- **Caching Recommended**: Client-side cache for 5-15 minutes
- **Batch Requests**: Prefer spotId for known locations
- **Error Handling**: Implement exponential backoff
- **Monitoring**: Track response times and error rates

## Advanced Features

### Confidence Scoring
The API provides confidence levels for ML predictions:
- **High**: Normal weather conditions, reliable data sources
- **Medium**: Borderline conditions or limited marine data
- **Low**: Extreme conditions or sparse data availability

### Penalty Transparency
Detailed penalty breakdowns help users understand ratings:
```json
{
  "originalRating": 5.0,
  "penaltiesApplied": [
    "Extreme heat (99.0°F): -1.5",
    "High UV (9.2): -0.5"
  ],
  "totalPenalty": 2.0,
  "rating": 3.0
}
```

### Marine Data Integration
Enhanced accuracy for water bodies with marine data:
- **Wave Conditions**: Real wave height measurements
- **Water Temperature**: Actual water temperature readings
- **Tidal Information**: Where applicable (coastal areas)
- **Current Strength**: River and tidal current data

## Security & Privacy

### Data Protection
- **No Personal Data**: Anonymous location-based queries only
- **Request Logging**: Minimal logging for performance monitoring
- **Rate Limiting**: Prevents abuse and ensures fair access
- **Secure Transmission**: HTTPS encryption for all requests

### API Security
- **Input Validation**: Comprehensive parameter sanitization
- **SQL Injection Prevention**: Parameterized queries only
- **DDoS Protection**: Multi-layer rate limiting
- **Error Message Sanitization**: No system information leakage

## Testing & Validation

### Test Locations
Use these coordinates for testing different scenarios:

#### Extreme Heat Testing
```
Trinity River, TX: 32.881187,-96.929937
Expected: Rating ~2.0 with "Extreme heat" penalty
```

#### Perfect Conditions
```
Cottonwood Lake, CO: 38.781063,-106.277812  
Expected: Rating 4.5-5.0, minimal penalties
```

#### Marine Data Testing
```
White Rock Lake, TX: 32.833188,-96.729687
Expected: Marine data available, wave height included
```

### Validation Checks
- **Rating Range**: Always 1.0-5.0 in 0.5 increments
- **Penalty Logic**: Penalties always reduce rating
- **Response Time**: <500ms for 95% of requests
- **Data Completeness**: All required fields present

## Migration Guide

### From Legacy APIs
The paddleScore API consolidates several older endpoints:
- **Replaces**: `paddleConditions`, `currentWeather`, `spotRating`
- **Performance**: 3x faster than legacy APIs
- **Features**: Enhanced ML model with marine data
- **Consistency**: Unified with fastForecast rating system

### Integration Updates
```javascript
// Old API pattern
const conditions = await fetch('/api/paddleConditions?lat=32.88&lng=-96.93');
const rating = await fetch('/api/spotRating?lat=32.88&lng=-96.93');

// New unified pattern  
const paddle = await fetch('/api/paddleScore?location=32.881187,-96.929937');
const { rating, conditions } = paddle.paddleScore;
```

## Related APIs
- **fastForecast**: 3-day forecast with same ML ratings
- **paddlingOut**: Curated locations with optimized spotId lookup  
- **nearbyWater**: Discover new locations for paddle scoring

## Monitoring & Support

### Health Monitoring
```bash
# Check API health
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/paddleScore/health"
```

### Performance Metrics
- **Uptime**: 99.9% availability target
- **Response Time**: P95 < 500ms
- **Error Rate**: < 0.1%
- **ML Model Accuracy**: Validated against user feedback

### Support Resources
- **Status Page**: Real-time API status monitoring
- **Error Logging**: Comprehensive error tracking
- **Performance Dashboards**: Response time and usage analytics
- **User Feedback**: Rating accuracy improvement system

---
*Last Updated: December 2024*  
*API Version: 2.1.0*  
*Response Time Target: <250ms average, <500ms P95*
