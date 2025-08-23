# 🛍️ products API Documentation

## Overview
The products API manages Kaayko's e-commerce product catalog including paddle boards, accessories, and apparel. It provides comprehensive product information, image management, and voting functionality for the online store.

## Endpoints

### Get All Products
```
GET /products
```

### Get Single Product
```
GET /products/:id
```

### Vote for Product
```
POST /products/:id/vote
```

## Parameters

### GET /products (No parameters)
Returns all available products with complete information.

### GET /products/:id
| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `id` | string | Yes | Product document ID | `"paddle-board-001"` |

### POST /products/:id/vote
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Product document ID |
| Body: `vote` | number | Yes | Vote increment (+1 or -1) |

## Request Examples

### Get All Products
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/products"
```

### Get Single Product
```bash
curl "https://us-central1-kaaykostore.cloudfunctions.net/api/products/paddle-board-001"
```

### Vote for Product
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"vote": 1}' \
  "https://us-central1-kaaykostore.cloudfunctions.net/api/products/paddle-board-001/vote"
```

## Response Formats

### Product List Response (GET /products)
```json
[
  {
    "id": "paddle-board-001",
    "title": "Kaayko Pro SUP Board",
    "description": "Professional stand-up paddleboard designed for all skill levels with enhanced stability and durability.",
    "price": "$599.99",
    "votes": 147,
    "productID": "KAAYKO-PRO-001", 
    "tags": ["paddle-board", "sup", "water-sports", "beginner-friendly"],
    "availableColors": ["Ocean Blue", "Sunset Orange", "Forest Green"],
    "availableSizes": ["10'6\"", "11'2\"", "12'0\""],
    "maxQuantity": 5,
    "imgSrc": [
      "https://firebasestorage.googleapis.com/v0/b/kaaykostore.appspot.com/o/kaaykoStoreTShirtImages%2Fpaddle-board-001%2Fmain.jpg?alt=media&token=abc123",
      "https://firebasestorage.googleapis.com/v0/b/kaaykostore.appspot.com/o/kaaykoStoreTShirtImages%2Fpaddle-board-001%2Fside.jpg?alt=media&token=def456",
      "https://firebasestorage.googleapis.com/v0/b/kaaykostore.appspot.com/o/kaaykoStoreTShirtImages%2Fpaddle-board-001%2Faction.jpg?alt=media&token=ghi789"
    ]
  },
  {
    "id": "tshirt-kaayko-logo",
    "title": "Kaayko Logo T-Shirt",
    "description": "Comfortable cotton t-shirt featuring the iconic Kaayko logo. Perfect for paddling enthusiasts.",
    "price": "$24.99",
    "votes": 89,
    "productID": "TSHIRT-LOGO-001",
    "tags": ["apparel", "t-shirt", "cotton", "logo"],
    "availableColors": ["Black", "White", "Navy Blue"],
    "availableSizes": ["S", "M", "L", "XL", "XXL"],
    "maxQuantity": 10,
    "imgSrc": [
      "https://firebasestorage.googleapis.com/v0/b/kaaykostore.appspot.com/o/kaaykoStoreTShirtImages%2Ftshirt-kaayko-logo%2Ffront.jpg?alt=media&token=jkl012"
    ]
  }
]
```

### Single Product Response (GET /products/:id)
```json
{
  "id": "paddle-board-001",
  "title": "Kaayko Pro SUP Board", 
  "description": "Professional stand-up paddleboard designed for all skill levels with enhanced stability and durability. Features include:\n\n• Lightweight yet durable construction\n• Non-slip deck pad for safety\n• Bungee storage system\n• Includes paddle, pump, and carry bag",
  "price": "$599.99",
  "votes": 147,
  "productID": "KAAYKO-PRO-001",
  "tags": ["paddle-board", "sup", "water-sports", "beginner-friendly", "complete-package"],
  "availableColors": ["Ocean Blue", "Sunset Orange", "Forest Green"],
  "availableSizes": ["10'6\"", "11'2\"", "12'0\""],
  "maxQuantity": 5,
  "imgSrc": [
    "https://firebasestorage.googleapis.com/v0/b/kaaykostore.appspot.com/o/kaaykoStoreTShirtImages%2Fpaddle-board-001%2Fmain.jpg?alt=media&token=abc123",
    "https://firebasestorage.googleapis.com/v0/b/kaaykostore.appspot.com/o/kaaykoStoreTShirtImages%2Fpaddle-board-001%2Fside.jpg?alt=media&token=def456",
    "https://firebasestorage.googleapis.com/v0/b/kaaykostore.appspot.com/o/kaaykoStoreTShirtImages%2Fpaddle-board-001%2Faction.jpg?alt=media&token=ghi789",
    "https://firebasestorage.googleapis.com/v0/b/kaaykostore.appspot.com/o/kaaykoStoreTShirtImages%2Fpaddle-board-001%2Fdetail-deck.jpg?alt=media&token=mno345",
    "https://firebasestorage.googleapis.com/v0/b/kaaykostore.appspot.com/o/kaaykoStoreTShirtImages%2Fpaddle-board-001%2Fpackage.jpg?alt=media&token=pqr678"
  ]
}
```

### Vote Response (POST /products/:id/vote)
```json
{
  "success": true,
  "newVoteCount": 148,
  "message": "Vote recorded successfully"
}
```

## Product Categories

### 🏄 Paddle Boards & SUPs
- **Entry Level**: Beginner-friendly boards with stability focus
- **Performance**: Advanced boards for experienced paddlers  
- **Inflatable**: Portable and convenient storage options
- **Touring**: Long-distance paddling boards
- **Racing**: Competition-grade performance boards

### 🎽 Apparel & Accessories  
- **T-Shirts**: Cotton and performance materials
- **Hoodies & Sweatshirts**: Comfort wear with branding
- **Hats & Caps**: Sun protection and style
- **Accessories**: Keychains, stickers, patches

### ⚡ Paddling Gear
- **Paddles**: Adjustable and fixed-length options
- **Safety Equipment**: Life jackets, whistles, leashes
- **Storage Solutions**: Dry bags, deck bags, coolers
- **Maintenance**: Board care and repair kits

## Product Data Fields

### Core Fields
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique product identifier |
| `title` | string | Yes | Product name |
| `description` | string | Yes | Product description and features |
| `price` | string | Yes | Formatted price with currency |
| `productID` | string | Yes | Internal SKU identifier |

### Optional Fields
| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `votes` | number | Community vote count | `0` |
| `tags` | array | Product category tags | `[]` |
| `availableColors` | array | Color options | `[]` |
| `availableSizes` | array | Size options | `[]` |
| `maxQuantity` | number | Maximum order quantity | `1` |
| `imgSrc` | array | Product image URLs | `[]` |

## Image Management

### Automatic Image Loading
The API automatically fetches product images from Firebase Storage:

```javascript
// Image storage path structure:
// gs://kaaykostore.appspot.com/kaaykoStoreTShirtImages/{productID}/{filename}

// Example for product "paddle-board-001":
- main.jpg          // Hero/primary image
- side.jpg          // Side view
- action.jpg        // In-use lifestyle shot  
- detail-deck.jpg   // Close-up details
- package.jpg       // Package contents
```

### Image Features
- **High Resolution**: Optimized for e-commerce display
- **Multiple Angles**: Comprehensive product views
- **Lifestyle Shots**: Products in use for context
- **Detail Views**: Close-ups of important features
- **Signed URLs**: Secure, time-limited access

### Fallback System
```javascript
// If Firestore imgSrc is empty, API falls back to:
1. Live Firebase Storage scan for product images
2. Generate signed URLs with 7-day expiration
3. Cache results in Firestore for future requests
```

## Voting System

### Community Ratings
The voting system allows users to express preferences:

```javascript
// Vote mechanics
POST /products/:id/vote
{
  "vote": 1    // +1 for upvote, -1 for downvote
}

// Response includes updated count
{
  "success": true,
  "newVoteCount": 148,
  "message": "Vote recorded successfully"
}
```

### Voting Rules
- **Single Vote Increment**: Only +1 or -1 allowed per request
- **No Authentication**: Anonymous voting (currently)
- **Cumulative**: Votes accumulate over time
- **Real-time Updates**: Vote count updated immediately

## E-commerce Integration

### Frontend Integration
```javascript
// React component example
function ProductCatalog() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    fetch('/api/products')
      .then(r => r.json())
      .then(data => {
        setProducts(data);
        setLoading(false);
      });
  }, []);
  
  const handleVote = async (productId, vote) => {
    await fetch(`/api/products/${productId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vote })
    });
    
    // Refresh products to get updated vote count
    // Or update state optimistically
  };
  
  return (
    <div className="product-grid">
      {products.map(product => (
        <ProductCard 
          key={product.id}
          product={product}
          onVote={handleVote}
        />
      ))}
    </div>
  );
}
```

### Shopping Cart Integration
```javascript
// Add to cart functionality (example)
function addToCart(product, selectedColor, selectedSize, quantity) {
  const cartItem = {
    productId: product.id,
    title: product.title,
    price: product.price,
    color: selectedColor,
    size: selectedSize,
    quantity: Math.min(quantity, product.maxQuantity),
    imageUrl: product.imgSrc[0] // Use first image as thumbnail
  };
  
  // Add to local storage or state management
  const cart = JSON.parse(localStorage.getItem('cart') || '[]');
  cart.push(cartItem);
  localStorage.setItem('cart', JSON.stringify(cart));
}
```

## Performance & Optimization

### Response Times
- **Product List**: <300ms average
- **Single Product**: <200ms average  
- **Vote Recording**: <150ms average
- **Image Loading**: Lazy loading supported

### Caching Strategy
- **Product Data**: Firestore native caching
- **Images**: CDN with 7-day cache headers
- **Vote Counts**: Real-time, no caching
- **Product List**: Client-side cache recommended (30 minutes)

## Rate Limits & Usage

### Access Policy
- **Public API**: No authentication required for browsing
- **Rate Limits**: 300 requests per minute per IP
- **Voting Limits**: 10 votes per minute per IP
- **Image Access**: Unlimited (CDN cached)

### Fair Usage Guidelines
```javascript
// Good practices
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Cache product list locally
const cachedProducts = localStorage.getItem('products-cache');
if (cachedProducts && isCacheValid(cachedProducts)) {
  return JSON.parse(cachedProducts).data;
}

// Avoid excessive voting requests
const lastVoteTime = localStorage.getItem('last-vote-time');
if (Date.now() - lastVoteTime < 1000) {
  console.log('Please wait before voting again');
  return;
}
```

## Error Handling

### Success Responses
- **200**: Successful data retrieval or vote recording
- **JSON**: Always returns valid JSON structure

### Error Responses

#### Product Not Found (404)
```json
{
  "error": "Not found",
  "details": "Product with ID 'invalid-product' does not exist",
  "suggestions": [
    "Check product ID spelling",
    "Use GET /products to see available products"
  ]
}
```

#### Invalid Vote (400)
```json
{
  "error": "Invalid vote value",
  "details": "Vote must be +1 or -1",
  "received": 5,
  "valid_values": [-1, 1]
}
```

#### Rate Limit Exceeded (429)
```json
{
  "error": "Rate limit exceeded",
  "limit": 300,
  "window": "1 minute",
  "retry_after": 45
}
```

## Data Management

### Product Updates
Products are managed through:
- **Admin Dashboard**: Content management system
- **Direct Firestore**: Database updates
- **Bulk Import**: CSV/JSON batch uploads
- **API Integration**: Third-party inventory systems

### Content Standards
- **High-Quality Images**: Professional product photography
- **Accurate Descriptions**: Detailed feature lists and specifications
- **Competitive Pricing**: Market-researched price points
- **Complete Information**: All variants and options specified

## Security & Privacy

### Data Protection
- **Public Product Info**: Product details are publicly accessible
- **No Personal Data**: Anonymous browsing and voting
- **Secure Images**: Time-limited signed URLs
- **Input Validation**: All parameters sanitized

### E-commerce Security
- **XSS Prevention**: Output encoding for user-generated content
- **Rate Limiting**: Prevents abuse and spam
- **Image Security**: Firebase Storage rules prevent unauthorized uploads
- **Vote Integrity**: Server-side validation for vote values

## Analytics & Insights

### Product Performance Metrics
```json
{
  "analytics": {
    "most_viewed": "paddle-board-001",
    "highest_voted": "tshirt-kaayko-logo", 
    "newest_products": ["accessories-paddle-001"],
    "trending": ["inflatable-sup-002"],
    "conversion_data": "Available in admin dashboard"
  }
}
```

### Usage Statistics
- **Daily Views**: ~2,000 product page views
- **Popular Categories**: Paddle boards (60%), Apparel (25%), Accessories (15%)
- **Peak Times**: Weekend mornings, summer months
- **Vote Activity**: ~50 votes per day across all products

## Future Enhancements

### Planned Features
- **Inventory Management**: Real-time stock levels
- **Product Reviews**: User-generated reviews and ratings
- **Wishlist Functionality**: Save products for later
- **Recommendation Engine**: "Customers also viewed" suggestions
- **Search & Filtering**: Advanced product discovery

### API Expansion
- **Categories Endpoint**: Structured product categorization
- **Search Endpoint**: Full-text search across products
- **Inventory Endpoint**: Stock level checking
- **Recommendations**: Personalized product suggestions

## Related APIs
- **images**: Direct image access and manipulation
- **paddlingOut**: Location-based product recommendations
- Integration opportunities with weather APIs for seasonal promotions

## Migration & Compatibility

### Legacy Support
The products API maintains compatibility with:
- **Original SKU System**: productID field preserved
- **Image URL Format**: Backward compatible signed URLs  
- **Vote System**: Maintains historical vote counts
- **Response Format**: Consistent JSON structure

### Breaking Changes from v1.0
- Image URLs now use Firebase signed URLs (temporary, secure)
- Added `maxQuantity` field for inventory control
- Enhanced `description` field with markdown support
- Voting endpoint moved from `/vote` to `/products/:id/vote`

---
*Last Updated: December 2024*  
*API Version: 2.1.0*  
*E-commerce Platform: Firebase & Firestore*  
*Image Storage: Firebase Storage with CDN*
