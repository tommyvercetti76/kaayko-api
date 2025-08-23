# 📚 Kaayko API Documentation Index

## Overview
Welcome to the complete Kaayko API documentation. This index provides access to detailed documentation for all 8 API endpoints, covering weather services, location management, e-commerce, and mobile app integration.

## 🚀 Quick Start
```bash
# Base URL
https://us-central1-kaaykostore.cloudfunctions.net/api

# Health check
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/helloWorld"
# Response: "OK"
```

## 📋 API Endpoints Overview

### 🌦️ Weather & Location APIs

#### [nearbyWater API](./nearbyWater.md)
**Find nearby lakes and rivers for custom locations**
- **Endpoint**: `GET /nearbyWater`
- **Use Case**: Discover real water bodies using OpenStreetMap data
- **Response Time**: <2 seconds
- **Example**: Find paddling spots within 10km of any coordinate

#### [fastForecast API](./fastForecast.md)  
**Ultra-fast 3-day weather forecasts with ML predictions**
- **Endpoint**: `GET /fastForecast`  
- **Use Case**: Get cached weather forecasts optimized for paddling
- **Response Time**: <4 seconds fresh, <1 second cached
- **Features**: ML-powered ratings, marine data, safety warnings

#### [paddleScore API](./paddleScore.md)
**Instant paddle condition ratings powered by machine learning**
- **Endpoint**: `GET /paddleScore`
- **Use Case**: Quick "should I paddle now?" condition assessment
- **Response Time**: ~250ms
- **Features**: 0.5-increment ratings, penalty breakdown, marine integration

#### [forecast API](./forecast.md) 🔒
**Premium comprehensive weather analysis (Authentication Required)**
- **Endpoint**: `GET /forecast`
- **Use Case**: Professional weather services and cache infrastructure
- **Access**: API token required
- **Features**: Extended data, marine buoys, meteorological analysis

### 🏞️ Location & Content APIs

#### [paddlingOut API](./paddlingOut.md)
**Curated database of premium paddling locations**
- **Endpoint**: `GET /paddlingOut`
- **Use Case**: Browse 18+ handpicked paddling destinations
- **Response Time**: <200ms
- **Features**: GPS coordinates, amenities, images, descriptions

### 🛍️ E-commerce APIs  

#### [products API](./products.md)
**Product catalog management for paddle boards and accessories**
- **Endpoints**: `GET /products`, `GET /products/:id`, `POST /products/:id/vote`
- **Use Case**: E-commerce product browsing and community voting
- **Features**: Image integration, voting system, inventory data

#### [images API](./images.md)
**Secure image proxy for products and locations**
- **Endpoint**: `GET /images/:productId/:fileName`
- **Use Case**: Serve images from Firebase Storage securely
- **Features**: Direct streaming, CDN compatibility, access control

### 📱 Mobile Integration APIs

#### [deeplinkRoutes API](./deeplinkRoutes.md)
**Universal link management and app-to-web transitions**
- **Endpoints**: `GET /l/:id`, `GET /resolve`, `GET /health`
- **Use Case**: Seamless mobile app integration and context preservation
- **Features**: Platform detection, context storage, analytics tracking

## 🏗️ Architecture Overview

### API Layers
```
┌─────────────────────────────────────────────────────────┐
│                    PUBLIC APIs                          │
│  fastForecast │ paddleScore │ nearbyWater │ paddlingOut │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│                  E-COMMERCE APIs                        │
│      products     │      images     │   deeplinkRoutes  │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│                   PREMIUM APIs                          │
│              forecast (Auth Required)                   │
└─────────────────────────────────────────────────────────┘
```

### Data Flow
```
Weather Request → fastForecast → [Cache Hit?] → Response
                      ↓
                 [Cache Miss] → forecast API → ML Service → Firestore Cache
                      ↓
Location Request → paddlingOut → Firestore → Image URLs → images API
                      ↓
Product Request → products → Firestore → Image URLs → images API
```

## 🔧 Technical Specifications

### Performance Targets
| API | Response Time | Cache Rate | Availability |
|-----|---------------|------------|--------------|
| **fastForecast** | <4s fresh, <1s cached | 95%+ | 99.9% |
| **paddleScore** | <250ms | 80%+ | 99.9% |
| **nearbyWater** | <2s | 60%+ | 99.8% |
| **paddlingOut** | <200ms | 90%+ | 99.9% |
| **products** | <300ms | 85%+ | 99.9% |
| **images** | <500ms | 95%+ CDN | 99.9% |
| **deeplinkRoutes** | <200ms | N/A | 99.9% |
| **forecast** | <2s | N/A | 99.5% |

### Rate Limits
- **Public APIs**: 100-300 requests/minute per IP
- **Premium APIs**: Variable based on subscription
- **E-commerce**: 300 requests/minute per IP  
- **Images**: Unlimited (CDN cached)

## 🔐 Authentication & Security

### Public Access APIs
- **nearbyWater**, **fastForecast**, **paddleScore**: No auth required
- **paddlingOut**, **products**, **images**: No auth required
- **deeplinkRoutes**: No auth required

### Protected APIs  
- **forecast**: API token required
  ```bash
  curl -H "Authorization: Bearer YOUR_TOKEN" \
    "/api/forecast?lat=32.88&lng=-96.93"
  ```

### Security Features
- **Rate Limiting**: Multi-layer DDoS protection
- **Input Validation**: Comprehensive parameter sanitization
- **CORS Enabled**: Cross-origin requests supported
- **HTTPS Only**: Encrypted data transmission

## 📊 ML & Data Integration

### Machine Learning Pipeline
```
Weather Data → ML Service → Paddle Rating → Cache → API Response
     ↓              ↓              ↓           ↓
WeatherAPI.com → Gradient    → Enhanced   → Firestore → fastForecast
                 Boosting     Penalties              → paddleScore
                 Model        System
```

### Data Sources
- **Weather**: WeatherAPI.com professional service
- **Marine**: NOAA buoy network integration  
- **Geography**: OpenStreetMap via Overpass API
- **ML**: Production gradient boosting service
- **Images**: Firebase Storage with CDN

## 🗂️ Data Models

### Location Object
```json
{
  "id": "trinity",
  "name": "Trinity River", 
  "coordinates": { "latitude": 32.881187, "longitude": -96.929937 },
  "region": "Texas",
  "amenities": { "parking": true, "restrooms": true }
}
```

### Weather Forecast  
```json
{
  "temperature": 36.2,
  "windSpeed": 1.9,
  "uvIndex": 8.3,
  "prediction": {
    "rating": 3.0,
    "penalties": ["Extreme heat (97.2°F): -1.5"],
    "mlModelUsed": true
  }
}
```

### Product Catalog
```json
{
  "id": "paddle-board-001",
  "title": "Kaayko Pro SUP Board",
  "price": "$599.99", 
  "votes": 147,
  "images": ["main.jpg", "side.jpg", "action.jpg"]
}
```

## 🔄 API Integration Patterns

### Weather Workflow
```javascript
// 1. Get locations
const locations = await fetch('/api/paddlingOut').then(r => r.json());

// 2. Get weather for specific location
const weather = await fetch(`/api/fastForecast?lat=${lat}&lng=${lng}`).then(r => r.json());

// 3. Get current conditions  
const current = await fetch(`/api/paddleScore?spotId=${locationId}`).then(r => r.json());
```

### E-commerce Workflow
```javascript
// 1. Browse products
const products = await fetch('/api/products').then(r => r.json());

// 2. Get detailed product info
const product = await fetch(`/api/products/${productId}`).then(r => r.json());

// 3. Display product images
products.forEach(p => {
  p.imgSrc.forEach(imageUrl => {
    // Images automatically load via images API
  });
});
```

### Mobile Deep Link Workflow
```javascript
// 1. Create shareable link (backend)
const contextId = generateId();
const shareUrl = `https://kaayko.com/l/${contextId}`;

// 2. User clicks link → platform detection → app store or app

// 3. App resolves context after install
const context = await fetch('/api/resolve').then(r => r.json());
```

## 🛠️ Development & Testing

### Local Development
```bash
# Start Firebase emulators  
firebase serve --only hosting,functions

# Test local endpoints
curl "http://127.0.0.1:5001/kaaykostore/us-central1/api/fastForecast?lat=32.88&lng=-96.93"
```

### Production Testing
```bash
# Test production endpoints
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/paddlingOut"
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/fastForecast?lat=32.88&lng=-96.93"
```

### Error Handling
All APIs return consistent error formats:
```json
{
  "success": false,
  "error": "Invalid coordinates",
  "details": "lat and lng must be valid numbers",
  "suggestion": "Use coordinates from paddlingOut API"
}
```

## 📈 Monitoring & Analytics

### Health Endpoints
- `GET /helloWorld` - Basic API health
- `GET /health` - Detailed service status (where available)
- `GET /images/health` - Image service status

### Performance Monitoring
- **Response Times**: P95 targets for all endpoints
- **Error Rates**: <0.1% target across all services
- **Cache Performance**: Hit rates tracked per API
- **ML Model Accuracy**: Validated against user feedback

## 🚀 Migration & Updates

### API Versioning
- **Current Version**: 2.1.0 across all endpoints
- **Backward Compatibility**: Maintained for critical endpoints
- **Deprecation Policy**: 6-month notice for breaking changes

### Recent Updates (v2.1.0)
- **Enhanced ML Penalties**: 0.5-increment ratings only
- **Marine Data Integration**: Wave height and water temperature
- **Performance Improvements**: 67% faster fastForecast
- **Unified Rating System**: Consistent across weather APIs

## 📞 Support & Resources

### Documentation
- **Individual API Docs**: Detailed guides for each endpoint
- **Integration Examples**: Code samples for common patterns  
- **Error Reference**: Comprehensive error code documentation
- **Migration Guides**: Upgrading from legacy versions

### Development Resources
- **Swagger/OpenAPI**: [kaayko-paddling-api-swagger.yaml](../kaayko-paddling-api-swagger.yaml)
- **Postman Collection**: Available for API testing
- **SDK Libraries**: Official client libraries (planned)

### Getting Help
- **Technical Issues**: Check individual API documentation
- **Performance Problems**: Review rate limits and caching strategies
- **Integration Questions**: Refer to code examples in each API doc
- **Feature Requests**: Contact development team

---

## 📑 Quick Reference

| Need | API | Documentation |
|------|-----|---------------|
| **Weather for location** | fastForecast | [fastForecast.md](./fastForecast.md) |
| **Current conditions** | paddleScore | [paddleScore.md](./paddleScore.md) |
| **Find nearby water** | nearbyWater | [nearbyWater.md](./nearbyWater.md) |
| **Browse locations** | paddlingOut | [paddlingOut.md](./paddlingOut.md) |
| **Product catalog** | products | [products.md](./products.md) |
| **Image serving** | images | [images.md](./images.md) |
| **Mobile integration** | deeplinkRoutes | [deeplinkRoutes.md](./deeplinkRoutes.md) |
| **Premium weather** | forecast | [forecast.md](./forecast.md) |

---
*Last Updated: December 2024*  
*API Version: 2.1.0*  
*Total Endpoints: 8*  
*Documentation Coverage: Complete*
