# ⚡ fastForecast API Documentation

## Overview
The fastForecast API provides ultra-fast 3-day weather forecasts with ML-powered paddle ratings. It delivers cached forecast data optimized for paddling conditions with response times under 4 seconds.

## Endpoint
```
GET /fastForecast
```

## Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `lat` | number | Yes | Latitude (-90 to 90) | `32.881187` |
| `lng` | number | Yes | Longitude (-180 to 180) | `-96.929937` |

## Request Example
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/fastForecast?lat=32.881187&lng=-96.929937"
```

## Response Format

### Success Response (200)
```json
{
  "success": true,
  "location": {
    "name": "Irving",
    "region": "Texas", 
    "country": "United States of America",
    "coordinates": {
      "latitude": 32.881187,
      "longitude": -96.929937
    }
  },
  "forecast": [
    {
      "date": "2025-01-20",
      "hourly": {
        "14": {
          "temperature": 36.2,
          "windSpeed": 1.9,
          "windDirection": "E",
          "gustSpeed": 2.47,
          "humidity": 39,
          "cloudCover": 73,
          "uvIndex": 8.3,
          "visibility": 10,
          "waveHeight": 0.1,
          "waterTemp": 28.2,
          "marineDataAvailable": true,
          "hasWarnings": true,
          "warnings": ["DANGER: High UV (8.3) - seek shade/shelter"],
          "beaufortScale": 0,
          "prediction": {
            "rating": 3.0,
            "originalRating": 5.0,
            "penaltiesApplied": [
              "Extreme heat (97.2°F): -1.5",
              "High UV (8.3): -0.5"
            ],
            "totalPenalty": 2.0,
            "roundedTo05Increments": true,
            "mlModelUsed": true,
            "predictionSource": "ml-model"
          },
          "rating": 3.0,
          "mlModelUsed": true,
          "predictionSource": "ml-model"
        }
      }
    }
  ],
  "metadata": {
    "processingTimeMs": 3833,
    "responseTime": "3835ms",
    "cached": false,
    "mlServiceUrl": "https://kaayko-ml-service-87383373015.us-central1.run.app"
  }
}
```

## Features

### ⚡ Ultra-Fast Performance
- **Response Time**: <4 seconds fresh, <1 second cached
- **Cache Hit Rate**: 95%+ for known locations
- **Background Updates**: Automatic cache refreshing
- **67% Performance Improvement**: vs previous API versions

### 🤖 ML-Powered Predictions
- **Production ML Service**: Advanced gradient boosting model
- **Smart Penalty System**: Weather condition adjustments
- **Marine Data Integration**: Wave height and water temperature
- **Rating Scale**: 1.0 to 5.0 in 0.5 increments only

### 📊 Comprehensive Data
- **72 Hours**: Complete 3-day hourly forecasts
- **Weather Metrics**: Temperature, wind, UV, visibility, humidity
- **Marine Conditions**: Wave height, water temperature when available
- **Safety Warnings**: Automated alerts for dangerous conditions

## Rating System

### Penalty Framework
The ML model applies consistent penalties for challenging conditions:

| Condition | Penalty | Example |
|-----------|---------|---------|
| High Heat (85-94°F) | -1.0 | "High heat (88.0°F): -1.0" |
| Extreme Heat (95°F+) | -1.5 | "Extreme heat (99.0°F): -1.5" |
| Moderate UV (5-8) | -0.5 | "Moderate UV (7.2): -0.5" |
| High UV (9-10) | -0.5 | "High UV (9.5): -0.5" |
| Dangerous UV (11+) | -1.0 | "Dangerous UV (11.2): -1.0" |
| Strong Wind (25+ mph) | -2.0 | "Strong wind (28.0 mph): -2.0" |

### Rating Interpretation
- **5.0**: Perfect conditions
- **4.5**: Excellent
- **4.0**: Very good
- **3.5**: Good
- **3.0**: Fair/Moderate
- **2.5**: Below average
- **2.0**: Poor - Difficult conditions
- **1.5**: Difficult
- **1.0**: Dangerous/Avoid

## Caching Strategy

### Intelligent Caching
- **TTL**: 2 hours for forecast data
- **Background Refresh**: Automatic updates before expiration
- **Coordinate-Based Keys**: Efficient cache lookup
- **Stale-While-Revalidate**: Serve cached data while refreshing

### Cache Optimization
- **Known Locations**: Pre-warmed cache for paddlingOut locations
- **Custom Coordinates**: On-demand caching with smart TTL
- **Memory Efficiency**: Automatic cleanup of expired entries

## Data Sources

### Weather Data
- **Primary**: WeatherAPI.com professional service
- **Marine Data**: Integrated wave height and water temperature
- **ML Predictions**: Production ML service with gradient boosting
- **Update Frequency**: Hourly weather updates

### Geographic Data
- **Location Resolution**: City/region identification
- **Coordinate Validation**: Input sanitization and bounds checking
- **Time Zone Handling**: Automatic local time conversion

## Rate Limits & Usage

### Public Access
- **Rate Limit**: 100 requests per minute per IP
- **Concurrent Requests**: Up to 15 simultaneous
- **Burst Allowance**: 200% spike tolerance

### Performance Tiers
- **Cached Response**: <1 second (95% of requests)
- **Fresh API Call**: <4 seconds (5% of requests)
- **Fallback Mode**: <500ms (degraded service)

## Error Handling

| Error Code | Description | Response Time |
|------------|-------------|---------------|
| 200 | Success with data | <4 seconds |
| 400 | Invalid coordinates | <100ms |
| 429 | Rate limit exceeded | <100ms |
| 500 | Service unavailable | <100ms |
| 503 | Temporary maintenance | <100ms |

### Error Response Format
```json
{
  "success": false,
  "error": "Invalid coordinates",
  "details": "lat and lng must be valid numbers",
  "suggestion": "Use coordinates from paddlingOut API",
  "timestamp": "2025-01-20T14:30:00.000Z"
}
```

## Use Cases

### 🏄 Primary Use Cases
1. **Frontend Weather Display**: Main app weather component
2. **Trip Planning**: Multi-day paddling expeditions  
3. **Condition Monitoring**: Track changing weather patterns
4. **Safety Alerts**: Automated warning systems

### 📱 Integration Patterns
- **Real-time Updates**: WebSocket integration for live data
- **Background Sync**: Mobile app cache warming
- **Progressive Enhancement**: Fallback to cached data
- **Smart Retry**: Exponential backoff for failed requests

## API Consistency

### Cross-API Compatibility
- **Same Conditions = Same Rating**: Consistent with paddleScore API
- **Identical ML Model**: Shared prediction engine
- **Unified Penalty System**: Consistent across all weather APIs
- **Standardized Response Format**: Same data structure patterns

## Technical Implementation

### ML Service Integration
```javascript
// Production ML service endpoint
const ML_SERVICE = "https://kaayko-ml-service-87383373015.us-central1.run.app";

// Prediction request format
const predictionRequest = {
  temperature: 36.2,
  windSpeed: 1.9,
  uvIndex: 8.3,
  waveHeight: 0.1,
  waterTemp: 28.2
};
```

### Cache Key Strategy  
```javascript
// Cache key format
const cacheKey = `forecast_${lat}_${lng}_${Math.floor(Date.now() / 7200000)}`;

// TTL management
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours
```

## Monitoring & Analytics

### Performance Metrics
- **P95 Response Time**: <4 seconds
- **Cache Hit Rate**: 95%+
- **Error Rate**: <0.1%
- **Availability**: 99.9%

### Usage Analytics
- **Request Volume**: ~10,000 requests/day
- **Popular Locations**: Trinity River, White Rock Lake, Lake Crescent
- **Peak Usage**: Weekend mornings (9-11 AM)

## Migration Notes

### From Legacy APIs
The fastForecast API replaces several slower endpoints:
- **67% faster** than previous forecast API
- **Unified response format** across all weather endpoints
- **Enhanced penalty system** with detailed explanations
- **Marine data integration** for coastal locations

### Breaking Changes
- Response format updated to include penalty breakdowns
- Rating scale limited to 0.5 increments only
- Marine data fields added when available
- Metadata structure enhanced with performance metrics

## Related APIs
- **paddleScore**: Current conditions for same coordinates
- **forecast**: Premium version with extended features (requires authentication)
- **paddlingOut**: Curated locations optimized for fastForecast

## Support & Troubleshooting

### Common Issues
1. **Slow Response**: Check if coordinates are in known location cache
2. **No Marine Data**: Expected for inland locations
3. **High Penalties**: Review extreme weather conditions
4. **Cache Misses**: New coordinates require initial API call

### Performance Optimization
- Use coordinates from paddlingOut API for best cache performance
- Implement client-side caching with 30-minute TTL
- Handle errors gracefully with fallback UI states
- Monitor response times and adjust request patterns

---
*Last Updated: December 2024*  
*API Version: 2.1.0*  
*Performance Target: <4 seconds fresh, <1 second cached*
