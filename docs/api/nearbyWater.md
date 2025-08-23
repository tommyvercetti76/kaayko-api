# 🌊 nearbyWater API Documentation

## Overview
The nearbyWater API discovers real water bodies near any location using OpenStreetMap's Overpass API. It finds lakes, rivers, and other paddleable water features within a specified radius.

## Endpoint
```
GET /nearbyWater
```

## Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `lat` | number | Yes | Latitude (-90 to 90) | `32.881187` |
| `lng` | number | Yes | Longitude (-180 to 180) | `-96.929937` |
| `radius` | number | No | Search radius in meters (default: 5000, max: 50000) | `10000` |

## Request Example
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/nearbyWater?lat=32.881187&lng=-96.929937&radius=10000"
```

## Response Format

### Success Response (200)
```json
{
  "success": true,
  "location": {
    "latitude": 32.881187,
    "longitude": -96.929937,
    "radius": 10000
  },
  "waterBodies": [
    {
      "id": "way/123456789",
      "name": "White Rock Lake",
      "type": "natural",
      "waterType": "lake",
      "distance": 2340,
      "coordinates": {
        "lat": 32.833188,
        "lon": -96.729687
      },
      "tags": {
        "natural": "water",
        "name": "White Rock Lake",
        "leisure": "swimming"
      }
    }
  ],
  "metadata": {
    "totalFound": 5,
    "searchRadius": 10000,
    "source": "OpenStreetMap Overpass API",
    "processingTime": "1.2s"
  }
}
```

### Error Response (400)
```json
{
  "success": false,
  "error": "Invalid coordinates",
  "details": "lat and lng must be valid numbers within range"
}
```

## Water Body Types
The API returns various types of water bodies suitable for paddling:

- **Lakes**: `natural=water` with `water=lake`
- **Rivers**: `waterway=river`
- **Streams**: `waterway=stream`
- **Reservoirs**: `landuse=reservoir`
- **Ponds**: `natural=water` (smaller bodies)

## Features

### ✅ Real Data
- Uses OpenStreetMap's comprehensive water body database
- Returns actual named water features (White Rock Lake, Trinity River, etc.)
- No synthetic or placeholder data

### ✅ Distance Calculation
- Calculates exact distance from search center
- Sorts results by proximity
- Provides coordinates for navigation

### ✅ Smart Filtering
- Removes duplicate entries
- Filters out tiny water bodies
- Prioritizes named, accessible water features

### ✅ Performance Optimized
- Efficient Overpass API queries
- Response caching for popular locations
- Sub-2 second response times

## Use Cases

1. **Custom Location Weather**: Find nearest water body for weather/paddle conditions
2. **Location Discovery**: Explore paddling spots in unfamiliar areas  
3. **Trip Planning**: Identify multiple water bodies within travel radius
4. **Map Integration**: Populate maps with real paddling destinations

## Rate Limits
- **Public Access**: 60 requests per minute
- **Burst Allowance**: Up to 10 concurrent requests
- **Caching**: Popular locations cached for 1 hour

## Error Handling

| Error Code | Description | Solution |
|------------|-------------|----------|
| 400 | Invalid coordinates | Check lat/lng format and range |
| 400 | Radius too large | Use radius ≤ 50,000 meters |
| 429 | Rate limit exceeded | Implement request throttling |
| 500 | Overpass API unavailable | Retry with exponential backoff |
| 503 | Service temporarily unavailable | Check system status |

## Technical Details

### Data Source
- **Primary**: OpenStreetMap Overpass API
- **Coverage**: Global water body data
- **Update Frequency**: Real-time OSM updates
- **Accuracy**: Community-maintained, high quality

### Query Optimization
- Uses efficient Overpass QL queries
- Targets only paddleable water features
- Implements smart radius handling
- Deduplicates results automatically

### Geographic Coverage
- **Global**: Works worldwide where OSM has data
- **Best Coverage**: North America, Europe, Australia
- **Emerging Markets**: Basic coverage, improving rapidly

## Integration Examples

### JavaScript Frontend
```javascript
const nearbyWater = await fetch(
  `/api/nearbyWater?lat=${lat}&lng=${lng}&radius=10000`
).then(r => r.json());

if (nearbyWater.success && nearbyWater.waterBodies.length > 0) {
  const closest = nearbyWater.waterBodies[0];
  console.log(`Found ${closest.name} at ${closest.distance}m`);
}
```

### Mobile App Deep Link
```
kaayko://nearbywater?lat=32.881187&lng=-96.929937&radius=10000
```

## Related APIs
- **fastForecast**: Get weather conditions for discovered water bodies
- **paddleScore**: Get paddle ratings for specific coordinates
- **paddlingOut**: Browse curated paddling locations

## Support
For technical support or feature requests regarding the nearbyWater API, please refer to the main API documentation or contact the development team.

---
*Last Updated: December 2024*
*API Version: 2.1.0*
