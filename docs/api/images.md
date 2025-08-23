# 🖼️ images API Documentation

## Overview
The images API provides secure image proxy services for Kaayko's product catalog and location imagery. It serves images from Firebase Storage through a controlled endpoint, ensuring security and providing consistent access without exposing raw storage URLs.

## Endpoint
```
GET /images/:productId/:fileName
```

## Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `productId` | string | Yes | Product or location identifier | `"paddle-board-001"` |
| `fileName` | string | Yes | Image filename with extension | `"main.jpg"` |

## Request Examples

### Product Image
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/images/paddle-board-001/main.jpg"
```

### Location Image  
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/images/trinity/hero.jpg"
```

### Paddling Out Images
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/images/trinity/trinity_1.jpg"
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/images/trinity/trinity_2.jpg"
```

## Response Format

### Success Response (200)
- **Content-Type**: `image/jpeg` (default) or appropriate MIME type
- **Body**: Binary image data streamed directly
- **Cache Headers**: Optimized for CDN and browser caching

### Error Responses

#### Image Not Found (404)
```json
{
  "error": "Image not found",
  "details": "No image found at path: kaaykoStoreTShirtImages/invalid-product/missing.jpg",
  "suggestions": [
    "Check product ID and filename spelling",
    "Verify image exists in Firebase Storage"
  ]
}
```

#### Invalid Parameters (400)
```json
{
  "error": "Invalid parameters",
  "details": "ProductId and fileName are required",
  "format": "/images/:productId/:fileName"
}
```

## Storage Structure

### Firebase Storage Organization
```
gs://kaaykostore.appspot.com/
├── kaaykoStoreTShirtImages/          # Main product images
│   ├── paddle-board-001/
│   │   ├── main.jpg                  # Primary product image
│   │   ├── side.jpg                  # Side view
│   │   ├── action.jpg                # Lifestyle/in-use shot
│   │   ├── detail-deck.jpg           # Detail views
│   │   └── package.jpg               # Package contents
│   ├── tshirt-kaayko-logo/
│   │   ├── front.jpg
│   │   ├── back.jpg
│   │   └── lifestyle.jpg
│   └── accessories-paddle-001/
│       └── main.jpg
├── images/paddling_out/              # Location images  
│   ├── trinity_1.jpg
│   ├── trinity_2.jpg
│   ├── whiterock_1.jpg
│   └── cottonwood_1.jpg
└── other-collections/                # Additional image collections
```

### Naming Conventions
- **Product Images**: `{productId}/{descriptive-name}.jpg`
- **Location Images**: `{locationId}_{number}.jpg` or `{locationId}/{filename}.jpg`
- **File Extensions**: `.jpg`, `.jpeg`, `.png`, `.webp` supported
- **Descriptive Names**: `main`, `side`, `action`, `detail-*`, `lifestyle`, etc.

## Image Types & Categories

### 🛍️ Product Images
- **Hero/Main**: Primary product showcase image
- **Multiple Angles**: Side, back, detail views
- **Lifestyle**: Products in use or context
- **Package**: What's included/unboxed
- **Detail Shots**: Close-ups of features

### 🏞️ Location Images  
- **Scenic Views**: Beautiful paddling locations
- **Action Shots**: Paddlers enjoying the location
- **Amenities**: Parking, facilities, access points
- **Seasonal**: Different times of year
- **Perspective Shots**: Various vantage points

## Performance & Optimization

### Streaming Architecture
```javascript
// Direct streaming from Firebase Storage
file.createReadStream()
  .on("error", err => {
    console.error("Stream error:", err);
    res.status(500).json({ error: "Failed to stream image" });
  })
  .pipe(res);
```

### Performance Features
- **Direct Streaming**: No server-side image storage
- **Efficient Pipe**: Memory-efficient data transfer
- **Error Handling**: Graceful failure with JSON error responses
- **Content-Type Detection**: Automatic MIME type setting

### Caching Strategy
- **CDN Compatible**: Works with Firebase's global CDN
- **Browser Caching**: Cache-friendly headers
- **Proxy Benefits**: Consistent URLs across deployments
- **Security**: No direct storage URL exposure

## Security Features

### Access Control
- **No Authentication**: Public images (appropriate for product catalog)
- **Storage Rules**: Firebase Storage rules prevent unauthorized uploads
- **Path Validation**: Server-side path sanitization
- **Error Sanitization**: No system information in error responses

### Privacy Protection
- **No Direct URLs**: Raw Firebase Storage URLs never exposed
- **Referer Checking**: Optional domain restriction (configurable)
- **Rate Limiting**: Prevents abuse (shares API rate limits)

### Allowed Origins (Configurable)
```javascript
const ALLOWED_ORIGINS = [
  "https://kaayko.com",
  "https://kaaykostore.web.app", 
  "https://kaaykostore.firebaseapp.com",
  "https://localhost:3000",         // Development
  "https://127.0.0.1:3000"          // Local testing
];
```

## Error Handling & Debugging

### Common Error Scenarios

#### File Not Found
```bash
# Request
GET /images/invalid-product/missing.jpg

# Response (404)
{
  "error": "Image not found",
  "path": "kaaykoStoreTShirtImages/invalid-product/missing.jpg",
  "exists": false
}
```

#### Stream Error
```bash
# Response (500) 
{
  "error": "Failed to stream image",
  "details": "Storage read error or network issue",
  "retry": true
}
```

#### Invalid Path
```bash
# Request  
GET /images/invalid/path/structure

# Response (400)
{
  "error": "Invalid path format",
  "expected": "/images/:productId/:fileName",
  "received": "/images/invalid/path/structure"
}
```

## Integration Examples

### Frontend Image Display
```javascript
// React component
function ProductImage({ productId, fileName, alt, className }) {
  const imageUrl = `/api/images/${productId}/${fileName}`;
  
  return (
    <img 
      src={imageUrl}
      alt={alt}
      className={className}
      onError={(e) => {
        e.target.src = '/placeholder-image.jpg';
      }}
    />
  );
}

// Usage
<ProductImage 
  productId="paddle-board-001"
  fileName="main.jpg"
  alt="Kaayko Pro SUP Board"
  className="product-hero"
/>
```

### Image Gallery
```javascript
// Dynamic gallery from products API
function ProductGallery({ product }) {
  return (
    <div className="image-gallery">
      {product.imgSrc.map((fullUrl, index) => {
        // Extract productId and fileName from signed URL
        const match = fullUrl.match(/images%2F(.+?)%2F(.+?)\?/);
        if (match) {
          const [, productId, fileName] = match;
          return (
            <img 
              key={index}
              src={`/api/images/${productId}/${fileName}`}
              alt={`${product.title} view ${index + 1}`}
            />
          );
        }
        // Fallback to signed URL if parsing fails
        return <img key={index} src={fullUrl} alt={product.title} />;
      })}
    </div>
  );
}
```

### Lazy Loading Integration
```javascript
// Intersection Observer for lazy loading
function LazyImage({ productId, fileName, alt, className }) {
  const [src, setSrc] = useState(null);
  const imgRef = useRef();
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSrc(`/api/images/${productId}/${fileName}`);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    
    if (imgRef.current) {
      observer.observe(imgRef.current);
    }
    
    return () => observer.disconnect();
  }, [productId, fileName]);
  
  return (
    <img
      ref={imgRef}
      src={src || '/placeholder.jpg'}
      alt={alt}
      className={className}
    />
  );
}
```

## Rate Limits & Usage

### Access Policy  
- **Public Access**: No authentication required
- **Rate Limits**: Shares main API rate limits (300 requests/minute)
- **Concurrent Downloads**: Up to 50 simultaneous streams
- **Fair Usage**: Implement client-side caching

### Optimization Recommendations
```javascript
// Cache images locally where possible
const imageCache = new Map();

function getCachedImage(productId, fileName) {
  const key = `${productId}/${fileName}`;
  
  if (imageCache.has(key)) {
    return imageCache.get(key);
  }
  
  const imageUrl = `/api/images/${productId}/${fileName}`;
  imageCache.set(key, imageUrl);
  
  return imageUrl;
}

// Use responsive images for different screen sizes
function getResponsiveImageUrl(productId, fileName, size = 'medium') {
  const baseName = fileName.split('.')[0];
  const ext = fileName.split('.')[1];
  
  // If you have different sizes stored
  const sizedFileName = `${baseName}_${size}.${ext}`;
  return `/api/images/${productId}/${sizedFileName}`;
}
```

## Health & Monitoring

### Health Check
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/images/health"
```

### Response
```json
{
  "status": "healthy",
  "service": "images-api", 
  "timestamp": "2025-01-20T14:30:00.000Z",
  "storage_connection": "active",
  "stream_capacity": "normal"
}
```

### API Information
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/images/"
```

### Response
```json
{
  "service": "Images API",
  "status": "running",
  "usage": "GET /api/images/:productId/:fileName",
  "health": "GET /api/images/health",
  "timestamp": "2025-01-20T14:30:00.000Z",
  "supported_formats": [".jpg", ".jpeg", ".png", ".webp"],
  "features": ["direct_streaming", "error_handling", "cache_friendly"]
}
```

## Development & Testing

### Local Development
```bash
# Test with emulator
curl "http://127.0.0.1:5001/kaaykostore/us-central1/api/images/trinity/trinity_1.jpg"

# Production testing
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/images/paddle-board-001/main.jpg"
```

### Image Upload (Not via API)
Images are uploaded through:
- **Firebase Console**: Direct storage uploads
- **Admin Dashboard**: Content management system  
- **Bulk Uploads**: Firebase CLI or custom scripts
- **Third-party Tools**: Image management platforms

### Testing Checklist
- [ ] Valid product images load correctly
- [ ] Invalid paths return 404 with JSON error
- [ ] Large images stream without memory issues
- [ ] Error handling works for missing files
- [ ] Content-Type headers are set correctly
- [ ] Rate limiting functions properly

## Migration & Compatibility

### Legacy Image System
The images API replaces direct Firebase Storage access:
- **Before**: Direct signed URLs with expiration
- **After**: Consistent proxy URLs through API
- **Benefits**: URL stability, security, monitoring
- **Migration**: Update frontend to use API endpoints

### URL Migration
```javascript
// Old pattern (direct Firebase Storage)
const oldUrl = "https://firebasestorage.googleapis.com/v0/b/kaaykostore.appspot.com/o/images%2Fproduct123%2Fmain.jpg?alt=media&token=xyz";

// New pattern (API proxy)
const newUrl = "/api/images/product123/main.jpg";

// Migration function
function migrateImageUrl(firebaseUrl) {
  const match = firebaseUrl.match(/images%2F(.+?)%2F(.+?)\?/);
  if (match) {
    const [, productId, fileName] = match;
    return `/api/images/${productId}/${fileName}`;
  }
  return firebaseUrl; // Fallback to original
}
```

## Related APIs
- **products**: Provides image URLs that work with images API
- **paddlingOut**: Location images accessible through images API
- Main API endpoints provide signed URLs that can be migrated to images API

## Future Enhancements

### Planned Features
- **Image Resizing**: On-the-fly image size adjustment
- **Format Conversion**: WebP conversion for modern browsers
- **Image Optimization**: Automatic compression and quality adjustment
- **Upload Endpoint**: Direct image uploads via API

### Advanced Features (Roadmap)
- **CDN Integration**: Enhanced global delivery
- **Image Analytics**: View tracking and performance metrics
- **Batch Operations**: Multiple image requests
- **Thumbnail Generation**: Automatic thumbnail creation

---
*Last Updated: December 2024*  
*API Version: 2.1.0*  
*Storage Backend: Firebase Storage*  
*Streaming: Direct pipe from storage*
