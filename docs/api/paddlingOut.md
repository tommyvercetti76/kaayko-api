# 🏞️ paddlingOut API Documentation

## Overview
The paddlingOut API provides access to Kaayko's curated database of premium paddling locations. It returns comprehensive location data including coordinates, amenities, images, and descriptions for 18+ handpicked paddling destinations.

## Endpoint
```
GET /paddlingOut
```

## Parameters
No parameters required - returns all available paddling locations.

## Request Example
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/paddlingOut"
```

## Response Format

### Success Response (200)
```json
[
  {
    "id": "trinity",
    "title": "Trinity River",
    "subtitle": "Irving, Texas", 
    "text": "Solitude, birds and a good workout",
    "location": {
      "latitude": 32.881187,
      "longitude": -96.929937
    },
    "parkingAvl": true,
    "restroomsAvl": true,
    "youtubeURL": "https://youtube.com/watch?v=example",
    "imgSrc": [
      "https://firebasestorage.googleapis.com/v0/b/kaaykostore.appspot.com/o/images%2Fpaddling_out%2Ftrinity_1.jpg?alt=media&token=abc123",
      "https://firebasestorage.googleapis.com/v0/b/kaaykostore.appspot.com/o/images%2Fpaddling_out%2Ftrinity_2.jpg?alt=media&token=def456"
    ]
  },
  {
    "id": "whiterick",
    "title": "White Rock Lake", 
    "subtitle": "Dallas, Texas",
    "text": "Urban paddling with skyline views and great facilities",
    "location": {
      "latitude": 32.833188,
      "longitude": -96.729687
    },
    "parkingAvl": true,
    "restroomsAvl": true,
    "imgSrc": [
      "https://firebasestorage.googleapis.com/v0/b/kaaykostore.appspot.com/o/images%2Fpaddling_out%2Fwhiterock_1.jpg?alt=media&token=ghi789"
    ]
  }
]
```

## Location Database

### Featured Locations (18 Total)

#### 🇺🇸 Texas (Heat Testing Locations)
- **Trinity River** (`trinity`): `32.881187,-96.929937` - River paddling with wildlife
- **White Rock Lake** (`whiterock`): `32.833188,-96.729687` - Urban lake with amenities  
- **Lewisville Lake** (`lewisville`): `33.156487,-96.949953` - Large recreational lake

#### 🏔️ Colorado (High Altitude)
- **Cottonwood Lake** (`cottonwood`): `38.781063,-106.277812` - Alpine lake at 10,000+ ft
- **Antero Reservoir** (`antero`): `38.982687,-105.896563` - High elevation reservoir
- **Taylor Park** (`taylorpark`): `38.823442,-106.579883` - Mountain wilderness paddling

#### 🌲 Washington (Cool Climate)
- **Lake Crescent** (`crescent`): `48.052813,-123.870438` - Olympic National Park
- **Diablo Lake** (`diablo`): `48.690938,-121.097188` - Stunning turquoise waters
- **Lake Union** (`union`): `47.627413,-122.338984` - Urban Seattle paddling

#### 🦌 Wyoming (National Parks)
- **Jenny Lake** (`jenny`): `43.749638,-110.729578` - Grand Teton National Park
- **Jackson Lake** (`jackson`): `43.845863,-110.600359` - Large mountain lake

#### 🌲 Montana
- **Lake McDonald** (`mcdonald`): `48.52838,-113.992351` - Glacier National Park

#### 🍁 New Hampshire  
- **Merrimack River** (`merrimack`): `42.88141,-71.47342` - Classic New England river

#### 🏜️ Utah (Desert Conditions)
- **Lake Powell** (`powell`): `37.01513,-111.536362` - Desert reservoir
- **Ken's Lake** (`kens`): `38.479188,-109.428062` - Moab area paddling
- **Colorado River** (`coloradoriver`): `38.604813,-109.573563` - River sections

#### 🌍 International
- **Ambazari Lake** (`ambazari`): `21.129713,79.045547` - India testing location

## Data Fields

### Required Fields
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | string | Unique location identifier | `"trinity"` |
| `title` | string | Location name | `"Trinity River"` |  
| `location.latitude` | number | GPS latitude | `32.881187` |
| `location.longitude` | number | GPS longitude | `-96.929937` |

### Optional Fields
| Field | Type | Description |
|-------|------|-------------|
| `subtitle` | string | Location details/region |
| `text` | string | Paddling description and tips |
| `parkingAvl` | boolean | Parking availability |
| `restroomsAvl` | boolean | Restroom facilities |
| `youtubeURL` | string | Video tour link |
| `imgSrc` | array | High-quality location images |

## Image Integration

### Automatic Image Fetching
The API automatically fetches and serves location images from Firebase Storage:

```javascript
// Images are dynamically loaded from:
// gs://kaaykostore.appspot.com/images/paddling_out/{spotId}_{number}.jpg

// Example: Trinity River images
[
  "trinity_1.jpg",  // Main hero image
  "trinity_2.jpg",  // Secondary view
  "trinity_3.jpg"   // Additional angles
]
```

### Image Features
- **Signed URLs**: Secure, expiring image links
- **High Resolution**: Optimized for web and mobile display
- **Multiple Views**: Hero shots, amenity photos, action shots
- **Cache Optimized**: CDN delivery for fast loading

## API Integration

### Weather API Coordination
The paddlingOut locations are optimized for use with other Kaayko weather APIs:

```javascript
// Get locations
const locations = await fetch('/api/paddlingOut').then(r => r.json());

// Get weather for each location  
const weather = await Promise.all(
  locations.map(loc => 
    fetch(`/api/fastForecast?lat=${loc.location.latitude}&lng=${loc.location.longitude}`)
      .then(r => r.json())
  )
);
```

### Spot ID Usage
Use the location `id` field for faster API calls:

```javascript
// Fast paddle score lookup using spotId
const score = await fetch('/api/paddleScore?spotId=trinity')
  .then(r => r.json());

// Slower coordinate-based lookup
const score2 = await fetch('/api/paddleScore?location=32.881187,-96.929937') 
  .then(r => r.json());
```

## Performance & Caching

### Response Optimization
- **Response Time**: <200ms average
- **Payload Size**: ~50KB compressed JSON
- **Image Loading**: Async/lazy loading supported
- **Cache Headers**: 1-hour browser cache recommended

### Backend Caching
- **Location Data**: Cached for 6 hours in Firestore
- **Image URLs**: Signed URLs valid for 7 days
- **Coordinate Cache**: Popular locations pre-cached for weather APIs

## Use Cases

### 🎯 Primary Applications
1. **Location Browser**: Main app location selection
2. **Trip Planning**: Discover new paddling destinations
3. **Weather Integration**: Get forecasts for known locations
4. **Map Display**: Populate interactive maps with paddling spots

### 📱 Frontend Integration Patterns
```javascript
// React component example
function LocationList() {
  const [locations, setLocations] = useState([]);
  
  useEffect(() => {
    fetch('/api/paddlingOut')
      .then(r => r.json())
      .then(setLocations);
  }, []);
  
  return locations.map(loc => (
    <LocationCard
      key={loc.id}
      id={loc.id}
      title={loc.title}
      subtitle={loc.subtitle}
      description={loc.text}
      coordinates={loc.location}
      images={loc.imgSrc}
      hasParking={loc.parkingAvl}
      hasRestrooms={loc.restroomsAvl}
    />
  ));
}
```

## Data Quality

### Location Validation
All paddlingOut locations are:
- **GPS Verified**: Coordinates validated on-site
- **Accessibility Confirmed**: Parking and launch access verified
- **Seasonally Updated**: Conditions reviewed quarterly
- **Safety Checked**: No dangerous or prohibited locations

### Content Standards
- **High-Quality Images**: Professional photography preferred
- **Accurate Descriptions**: Realistic condition expectations
- **Amenity Accuracy**: Facilities status regularly updated
- **Legal Compliance**: Only public or permitted access locations

## Rate Limits & Usage

### Access Policy
- **Public API**: No authentication required
- **Rate Limit**: 1000 requests per hour per IP
- **Fair Usage**: Cache responses client-side for 30+ minutes
- **Bulk Access**: Contact team for high-volume usage

### Optimization Recommendations
```javascript
// Good: Cache locations locally
const locations = localStorage.getItem('kaayko-locations');
if (!locations || isExpired(locations)) {
  // Fetch fresh data
  const fresh = await fetch('/api/paddlingOut');
  localStorage.setItem('kaayko-locations', JSON.stringify(fresh));
}

// Avoid: Fetching on every page load
// DON'T: fetch('/api/paddlingOut') in every component
```

## Error Handling

### Success Response (200)
Array of location objects - always returns data, never empty array.

### Service Errors
```json
{
  "error": "Service temporarily unavailable",
  "details": "Firestore connection timeout",
  "retry_after": 30,
  "fallback": "Use cached location data"
}
```

### Rate Limit (429)
```json
{
  "error": "Rate limit exceeded", 
  "limit": 1000,
  "window": "1 hour",
  "retry_after": 1800
}
```

## Geographic Distribution

### Regional Coverage
- **United States**: 15 locations across 8 states
- **Climate Diversity**: Desert, mountain, urban, wilderness
- **Skill Levels**: Beginner-friendly to advanced locations
- **Seasonal Variety**: Year-round and seasonal locations

### Expansion Roadmap
- **Canada**: Mountain lakes and rivers
- **International**: European alpine lakes
- **Coastal**: Ocean paddling locations
- **Urban**: More city-accessible locations

## Data Management

### Content Updates
Location data is updated through:
- **Admin Dashboard**: Internal content management system
- **Field Reports**: On-site condition updates
- **User Feedback**: Community-reported changes
- **Seasonal Reviews**: Quarterly data validation

### Version Control
```json
{
  "metadata": {
    "version": "2024-12",
    "last_updated": "2024-12-15T10:30:00Z",
    "location_count": 18,
    "regions_covered": 8
  }
}
```

## Development & Testing

### Local Development
```bash
# Test with local emulator
curl "http://127.0.0.1:5001/kaaykostore/us-central1/api/paddlingOut"

# Production testing
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/paddlingOut"
```

### Data Validation
```javascript
// Validate location data structure
function validateLocation(loc) {
  return (
    loc.id && typeof loc.id === 'string' &&
    loc.title && typeof loc.title === 'string' &&
    loc.location && 
    typeof loc.location.latitude === 'number' &&
    typeof loc.location.longitude === 'number' &&
    loc.location.latitude >= -90 && loc.location.latitude <= 90 &&
    loc.location.longitude >= -180 && loc.location.longitude <= 180
  );
}
```

## Related APIs
- **fastForecast**: 3-day weather for paddlingOut locations
- **paddleScore**: Current conditions for specific spots  
- **nearbyWater**: Discover additional water bodies near paddlingOut locations
- **images**: Direct image access and manipulation

## Migration Notes

### From Legacy Endpoints
The paddlingOut API consolidates several older location services:
- **Replaces**: `/locations`, `/spots`, `/paddleSpots`
- **Enhanced**: Added image integration and amenity data
- **Optimized**: Faster response times and better caching
- **Standardized**: Consistent coordinate format for weather APIs

### Breaking Changes from v1.0
- `coordinates` renamed to `location` with nested `latitude`/`longitude`
- Image URLs now use Firebase signed URLs (temporary, secure)
- Added required `id` field for spot identification
- Removed deprecated `difficulty` and `rating` fields

---
*Last Updated: December 2024*  
*API Version: 2.1.0*  
*Total Locations: 18*  
*Coverage: 8 US States + International*
