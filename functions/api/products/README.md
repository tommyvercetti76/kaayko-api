# 📦 Products API

Public product catalog and image serving for the Kaayko store.

## Files (2)

| File | Purpose |
|------|---------|
| `products.js` | Product listing, detail, and voting endpoints |
| `images.js` | Firebase Storage image proxy with caching |

---

## Endpoints (6)

### Products

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/products` | List all products with images | None |
| GET | `/products/:id` | Single product by Firestore doc ID | None |
| POST | `/products/:id/vote` | Atomic vote increment | None |

### Images

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/images` | Health check | None |
| GET | `/images/` | API info/usage | None |
| GET | `/images/:path` | Proxy image from Firebase Storage | None |

---

## Product Shape

```json
{
  "id": "abc123",
  "name": "Paddleboard X",
  "price": 499.99,
  "description": "...",
  "category": "boards",
  "images": [
    "https://firebasestorage.googleapis.com/v0/b/kaaykostore.appspot.com/o/..."
  ],
  "voteCount": 42
}
```

Images are fetched at runtime from Firebase Storage under `product-images/{docId}/`.

---

## Image Proxy

`GET /images/:path` streams the image directly from Firebase Storage:

- **Content-Type:** `image/jpeg`
- **Cache-Control:** `public, max-age=300` (5 minutes)
- Bucket: `kaaykostore.appspot.com`

---

## Firestore Collection

| Collection | Purpose |
|------------|---------|
| `kaaykoproducts` | Product documents |

---

## Voting

`POST /products/:id/vote` performs an atomic `FieldValue.increment(1)` on the product's `voteCount` field.

**Request body:**
```json
{ "voteType": "up" }
```

---

**Test suite:** `__tests__/products.test.js`
