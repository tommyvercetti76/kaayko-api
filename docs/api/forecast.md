# 📊 forecast API Documentation

## Overview
The forecast API is a premium, authenticated service providing comprehensive weather analysis and extended forecasting capabilities. It supports the caching infrastructure for fastForecast and offers advanced meteorological data for professional use.

⚠️ **Authentication Required**: This API requires valid authentication tokens and is intended for internal services and premium integrations.

## Endpoint
```
GET /forecast
```

## Authentication
```bash
# Authentication header required
Authorization: Bearer <API_TOKEN>

# Or API key parameter
?apikey=<API_KEY>
```

## Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `lat` | number | Yes | Latitude (-90 to 90) | `38.781063` |
| `lng` | number | Yes | Longitude (-180 to 180) | `-106.277812` |
| `days` | number | No | Forecast days (1-7, default: 3) | `5` |
| `extended` | boolean | No | Include extended meteorological data | `true` |

## Request Example
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://us-central1-kaaykostore.cloudfunctions.net/api/forecast?lat=38.781063&lng=-106.277812&days=5&extended=true"
```

## Response Format

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "location": "38.781063,-106.277812",
    "resolvedLocation": {
      "name": "Buena Vista",
      "region": "Colorado", 
      "country": "United States of America",
      "timezone": "America/Denver",
      "elevation": 2400
    },
    "current": {
      "temperature": 15.2,
      "windSpeed": 8.4,
      "windDirection": "SW",
      "humidity": 45,
      "pressure": 1013.2,
      "dewPoint": 3.1,
      "uvIndex": 6.2,
      "visibility": 16,
      "cloudCover": 25,
      "conditions": "Partly Cloudy",
      "paddleAnalysis": {
        "rating": 4.5,
        "interpretation": "Excellent conditions",
        "primaryFactors": ["mild temperature", "light winds", "good visibility"],
        "challenges": []
      }
    },
    "forecast": [
      {
        "date": "2025-01-20",
        "summary": {
          "maxTemp": 18.3,
          "minTemp": 2.1,
          "avgWindSpeed": 6.2,
          "precipitation": 0.0,
          "paddleWindow": "10:00-16:00",
          "bestRating": 4.5,
          "avgRating": 3.8
        },
        "hourly": [
          {
            "time": "2025-01-20T14:00:00",
            "temperature": 16.8,
            "windSpeed": 5.2,
            "windDirection": "W",
            "windGust": 8.1,
            "humidity": 42,
            "dewPoint": 2.8,
            "pressure": 1015.1,
            "uvIndex": 5.8,
            "visibility": 20,
            "cloudCover": 30,
            "precipitation": 0.0,
            "precipitationType": null,
            "conditions": "Sunny",
            "marineData": {
              "waveHeight": 0.3,
              "waterTemp": 12.4,
              "currentStrength": 0.2,
              "dataSource": "model"
            },
            "advanced": {
              "feelsLike": 18.2,
              "heatIndex": 16.8,
              "windChill": 15.1,
              "airQuality": 85,
              "solarRadiation": 750,
              "stormProbability": 5
            },
            "paddleAnalysis": {
              "rating": 4.5,
              "mlPrediction": {
                "baseRating": 4.5,
                "penalties": [],
                "confidence": 0.92,
                "modelVersion": "v2.1.0"
              },
              "safetyFlags": [],
              "recommendations": [
                "Excellent conditions for all skill levels",
                "Consider sun protection (UV 5.8)"
              ]
            }
          }
        ]
      }
    ]
  },
  "metadata": {
    "generated": "2025-01-20T14:30:00.000Z",
    "cached_until": "2025-01-20T16:30:00.000Z",
    "source": "weatherapi-premium",
    "processing_time_ms": 1240,
    "data_sources": {
      "weather": "WeatherAPI Professional",
      "marine": "NOAA Buoy Network",
      "ml_model": "Kaayko ML Service v2.1.0"
    },
    "coverage": {
      "forecast_days": 5,
      "hourly_resolution": 1,
      "marine_data_available": true,
      "extended_meteorology": true
    }
  }
}
```

## Premium Features

### 🚀 Extended Forecasting
- **Up to 7 Days**: Beyond standard 3-day forecasts
- **Hourly Resolution**: Complete 168-hour datasets
- **Historical Context**: Weather pattern analysis
- **Trend Prediction**: Short-term weather system tracking

### 🌊 Advanced Marine Data
- **Real Buoy Data**: NOAA integration for coastal locations
- **Current Analysis**: River and tidal current strength
- **Water Quality**: Temperature profiles and clarity estimates
- **Surf Conditions**: Wave period, direction, and height

### 📈 Meteorological Analysis
- **Pressure Trends**: Barometric pressure changes and storm prediction
- **Air Quality Index**: Pollution levels and visibility impact
- **Solar Radiation**: UV intensity and heat index calculations
- **Storm Probability**: Precipitation timing and intensity forecasting

### 🤖 Enhanced ML Integration
- **Model Confidence**: Statistical confidence in predictions
- **Factor Analysis**: Detailed breakdown of rating components
- **Historical Validation**: Model performance against past conditions
- **Adaptive Learning**: Real-time model improvements

## Authentication & Access

### API Token Management
```bash
# Generate new token (admin only)
POST /forecast/auth/token
{
  "service": "premium-client",
  "permissions": ["forecast", "extended"],
  "expires": "30d"
}
```

### Access Levels
| Level | Features | Rate Limit | Cost |
|-------|----------|------------|------|
| **Basic** | Standard 3-day forecast | 1000/hour | $0.01/request |
| **Premium** | Extended data, marine integration | 5000/hour | $0.05/request |
| **Professional** | Full meteorological suite | 20000/hour | $0.10/request |

### Usage Tracking
```json
{
  "usage": {
    "requests_today": 1247,
    "monthly_limit": 50000,
    "current_tier": "premium",
    "overage_charges": 0.0
  }
}
```

## Caching Integration

### FastForecast Support
The forecast API powers the public fastForecast endpoint:
```javascript
// Internal cache warming
const forecastData = await forecast.get({
  lat, lng, 
  days: 3,
  cacheFor: '2hours'
});

// Store in Firestore for fastForecast
await firestore.collection('forecast_cache').doc(cacheKey).set({
  data: forecastData,
  expires: Date.now() + (2 * 60 * 60 * 1000)
});
```

### Intelligent Pre-warming
- **Scheduled Updates**: Automatic cache refresh for popular locations
- **Demand Prediction**: Pre-fetch based on usage patterns  
- **Geographic Clustering**: Efficient regional data fetching
- **Error Recovery**: Fallback data generation for API failures

## Rate Limits & Billing

### Rate Limiting
```json
{
  "rate_limits": {
    "requests_per_minute": 100,
    "concurrent_requests": 25,
    "burst_allowance": 200,
    "daily_quota": 10000
  }
}
```

### Billing Structure
- **Pay-per-Request**: $0.01 - $0.10 based on features used
- **Monthly Subscriptions**: Volume discounts available
- **Enterprise Plans**: Custom pricing for high-volume usage
- **Free Tier**: 100 requests/day for development

## Error Handling

### Authentication Errors (401)
```json
{
  "success": false,
  "error": "Authentication required",
  "details": "Valid API token required for forecast API access",
  "documentation": "https://docs.kaayko.com/api/auth"
}
```

### Rate Limit Exceeded (429)
```json
{
  "success": false, 
  "error": "Rate limit exceeded",
  "details": "100 requests per minute exceeded",
  "retry_after": 47,
  "current_usage": {
    "requests_this_minute": 100,
    "requests_today": 8547
  }
}
```

### Service Unavailable (503)
```json
{
  "success": false,
  "error": "Service temporarily unavailable", 
  "details": "Weather data provider maintenance in progress",
  "estimated_recovery": "2025-01-20T16:00:00.000Z",
  "fallback_available": true
}
```

## Use Cases

### 🏗️ Infrastructure Services
1. **Cache Pre-warming**: Power fastForecast with fresh data
2. **Batch Processing**: Generate forecasts for multiple locations
3. **Data Analysis**: Weather pattern research and validation
4. **Service Integration**: Feed other weather-dependent systems

### 💼 Professional Applications
1. **Marine Operations**: Commercial paddling outfitters
2. **Safety Systems**: Emergency weather monitoring
3. **Research Projects**: Academic weather studies
4. **Business Intelligence**: Weather impact analysis

## Advanced Configuration

### Extended Options
```bash
# Full featured request
curl -H "Authorization: Bearer TOKEN" \
  "/forecast?lat=38.78&lng=-106.28&days=7&extended=true&marine=true&quality=high&format=detailed"
```

### Response Customization
```json
{
  "options": {
    "include_history": true,
    "marine_detail": "full",
    "air_quality": true, 
    "storm_tracking": true,
    "ml_confidence": true,
    "paddle_analysis": "detailed"
  }
}
```

## Data Quality & Sources

### Primary Weather Sources
- **WeatherAPI Professional**: High-resolution meteorological data
- **NOAA Integration**: Official US weather service data
- **European Model**: ECMWF integration for enhanced accuracy
- **Satellite Imagery**: Real-time cloud and precipitation analysis

### Marine Data Sources
- **NOAA Buoy Network**: Real-time marine observations
- **USGS River Gauges**: River level and flow data
- **Coastal Stations**: Wave height and water temperature
- **Tidal Predictions**: Harmonic analysis for coastal areas

### Quality Assurance
- **Multi-source Validation**: Cross-reference multiple data providers
- **Outlier Detection**: Automatic data quality filtering
- **Historical Validation**: Model accuracy against past conditions
- **Real-time Monitoring**: Continuous data quality assessment

## Integration Examples

### Node.js Integration
```javascript
const KaaykoForecast = require('@kaayko/forecast-api');

const forecast = new KaaykoForecast({
  token: process.env.KAAYKO_API_TOKEN,
  tier: 'premium'
});

const data = await forecast.getForecast({
  lat: 38.781063,
  lng: -106.277812,
  days: 5,
  extended: true
});
```

### Python Integration
```python
import kaayko_forecast

client = kaayko_forecast.Client(
    token=os.environ['KAAYKO_API_TOKEN'],
    tier='premium'
)

forecast = client.get_forecast(
    lat=38.781063,
    lng=-106.277812,
    days=5,
    extended=True
)
```

## Monitoring & Analytics

### API Performance Monitoring
```json
{
  "performance": {
    "avg_response_time": 1240,
    "p95_response_time": 2100,
    "error_rate": 0.02,
    "uptime": 99.97,
    "cache_hit_rate": 78.5
  }
}
```

### Usage Analytics
- **Geographic Distribution**: Request patterns by region
- **Feature Usage**: Most requested advanced features  
- **Performance Metrics**: Response time trends and optimization
- **Error Analysis**: Common failure patterns and prevention

## Security & Compliance

### Data Security
- **Token Encryption**: Secure API token management
- **Request Logging**: Audit trail for premium features
- **Data Residency**: Configurable data storage regions
- **GDPR Compliance**: Privacy-first data handling

### API Security
- **Rate Limiting**: Multi-layer DDoS protection
- **Input Validation**: Comprehensive parameter sanitization  
- **SSL/TLS**: Encrypted data transmission
- **Access Controls**: Role-based feature permissions

## Migration & Support

### Migration from Legacy APIs
```javascript
// Old premium weather API
const weather = await legacyAPI.getWeather(lat, lng);

// New forecast API
const forecast = await forecastAPI.getForecast({
  lat, lng,
  extended: true,
  marine: true
});
```

### Support Resources
- **Documentation**: Comprehensive API reference
- **SDKs**: Official client libraries for popular languages
- **Support Team**: Dedicated technical support for premium users  
- **Status Page**: Real-time service status and incident reports

## Related APIs
- **fastForecast**: Public cached version powered by forecast API
- **paddleScore**: Current conditions using forecast data sources
- **paddlingOut**: Location data integration for targeted forecasting

---
*Last Updated: December 2024*  
*API Version: 2.1.0*  
*Access Level: Premium/Professional Only*  
*Authentication Required: API Token*
