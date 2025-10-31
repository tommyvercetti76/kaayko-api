# 🛍️ Products & Images APIs

**E-commerce product catalog and image serving**

---

## 📁 Files in this Module

1. **`products.js`** - Product catalog API
2. **`images.js`** - Image proxy service

---

## 🛍️ API #1: Products

**File:** `products.js`  
**Endpoints:**
- `GET /api/products` - List all products
- `GET /api/products/:productId` - Get single product

### Overview

Serves Kaayko t-shirt catalog with Firebase Storage integration.

### Features

- ✅ Product catalog from Firestore
- ✅ Firebase Storage image URLs
- ✅ Auto-fallback to Storage if imgSrc missing
- ✅ Public image URLs (no signed URLs needed)
- ✅ 25+ product variants

---

## 📋 Endpoint #1: List Products

```
GET /api/products
```

### Response:
```json
{
  "success": true,
  "products": [
    {
      "id": "classic-navy-tee",
      "name": "Classic Navy Kaayko Tee",
      "price": 24.99,
      "description": "Premium cotton t-shirt with Kaayko logo",
      "sizes": ["S", "M", "L", "XL", "XXL"],
      "colors": ["navy", "black", "white"],
      "imgSrc": [
        "https://firebasestorage.googleapis.com/.../front.jpg",
        "https://firebasestorage.googleapis.com/.../back.jpg"
      ],
      "category": "apparel",
      "inStock": true
    }
  ],
  "total": 25
}
```

### Image Handling:
1. **Primary:** Read `imgSrc` array from Firestore
2. **Fallback:** If `imgSrc` missing/empty, fetch from Storage
3. **Path:** `kaaykoStoreTShirtImages/{productID}/`
4. **Format:** Public URLs (no authentication needed)

---

## 📋 Endpoint #2: Single Product

```
GET /api/products/classic-navy-tee
```

### Response:
```json
{
  "success": true,
  "product": {
    "id": "classic-navy-tee",
    "name": "Classic Navy Kaayko Tee",
    "price": 24.99,
    "description": "Premium cotton t-shirt with Kaayko logo",
    "sizes": ["S", "M", "L", "XL", "XXL"],
    "colors": ["navy", "black", "white"],
    "imgSrc": [
      "https://firebasestorage.googleapis.com/.../front.jpg",
      "https://firebasestorage.googleapis.com/.../back.jpg",
      "https://firebasestorage.googleapis.com/.../detail.jpg"
    ],
    "category": "apparel",
    "inStock": true,
    "details": {
      "material": "100% cotton",
      "fit": "Regular",
      "care": "Machine wash cold"
    }
  }
}
```

---

## 🖼️ API #2: Images

**File:** `images.js`  
**Endpoint:** `GET /api/images`

### Overview

Image proxy service with fallback support.

### Features

- ✅ Proxy external images
- ✅ Fallback to placeholder
- ✅ Cache headers
- ✅ Error handling

---

## 📋 Image Proxy

```
GET /api/images?url=https://example.com/image.jpg
```

### Query Parameters:
```
?url=https://...          # Image URL to proxy (required)
?fallback=placeholder     # Fallback if image fails (optional)
```

### Response:
- **Success:** Image binary (proxied)
- **Failure:** Placeholder image or 404

### Use Cases:
1. **CORS bypass:** Proxy images from external sources
2. **Fallback:** Show placeholder if original fails
3. **Cache:** Browser caching via headers

---

## 📊 Firestore Structure

### **`kaaykoproducts` Collection**
```javascript
{
  // Document ID: product ID (e.g., "classic-navy-tee")
  "id": "classic-navy-tee",
  "name": "Classic Navy Kaayko Tee",
  "price": 24.99,
  "description": "...",
  "sizes": ["S", "M", "L", "XL", "XXL"],
  "colors": ["navy", "black", "white"],
  "imgSrc": [
    "https://firebasestorage.googleapis.com/.../front.jpg",
    "https://firebasestorage.googleapis.com/.../back.jpg"
  ],
  "category": "apparel",
  "inStock": true,
  "featured": false,
  "tags": ["t-shirt", "casual", "logo"],
  "created": Timestamp,
  "updated": Timestamp
}
```

---

## 💾 Firebase Storage Structure

```
kaaykoStoreTShirtImages/
├── classic-navy-tee/
│   ├── front.jpg
│   ├── back.jpg
│   └── detail.jpg
├── vintage-black-tee/
│   ├── front.jpg
│   └── back.jpg
└── ...
```

### Image URL Format:
```
https://firebasestorage.googleapis.com/v0/b/BUCKET_NAME/o/
kaaykoStoreTShirtImages%2Fclassic-navy-tee%2Ffront.jpg?alt=media
```

---

## 🧪 Testing

### Test Products Locally:
```bash
curl http://127.0.0.1:5001/kaaykostore/us-central1/api/products
```

### Test Single Product:
```bash
curl http://127.0.0.1:5001/kaaykostore/us-central1/api/products/classic-navy-tee
```

### Test Image Proxy:
```bash
curl "http://127.0.0.1:5001/kaaykostore/us-central1/api/images?url=https://example.com/image.jpg"
```

---

## 📈 Performance

| Endpoint | Response Time | Notes |
|----------|---------------|-------|
| List Products | ~150ms | Firestore query |
| Single Product | ~80ms | Single doc read |
| Image Proxy | Variable | Depends on source |

---

## 🚀 Deployment

Deploy products APIs:
```bash
cd api/deployment
./deploy-firebase-functions.sh
```

---

## 📚 Related Documentation

- **API Reference:** `../../docs/API-QUICK-REFERENCE-v2.1.0.md`
- **Store Frontend:** `../../../frontend/src/store.html`

---

**Status:** ✅ Production-ready  
**Products:** 25+  
**Images:** Cloud-hosted  
**Uptime:** 99.9%
