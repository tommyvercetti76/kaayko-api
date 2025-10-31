# 📚 Core APIs

**Documentation and API specification serving**

---

## 📁 Files in this Module

1. **`docs.js`** - API documentation and OpenAPI spec serving

---

## 📖 Overview

Core APIs module serves Kaayko API documentation and specifications.

### Features

- ✅ Interactive API documentation
- ✅ OpenAPI 3.0 specification (YAML + JSON)
- ✅ Swagger UI integration
- ✅ API reference serving

---

## 📋 Endpoints

### **1. API Documentation Home**
```
GET /api/docs
```

Returns interactive API documentation (Swagger UI).

**Response:**
HTML page with Swagger UI displaying full API documentation.

---

### **2. OpenAPI Spec (YAML)**
```
GET /api/docs/spec.yaml
```

Returns complete OpenAPI 3.0 specification in YAML format.

**Response:**
```yaml
openapi: 3.0.3
info:
  title: Kaayko Paddling Intelligence APIs
  version: "2.1.0"
  description: |
    Enterprise-grade paddling condition intelligence...

servers:
  - url: https://us-central1-kaaykostore.cloudfunctions.net/api

paths:
  /paddleScore:
    get:
      summary: Get Current Paddle Score
      parameters:
        - name: latitude
          in: query
          required: true
          schema:
            type: number
      ...
```

**Use Cases:**
- API client generation
- Integration documentation
- Testing tools (Postman, Insomnia)

---

### **3. OpenAPI Spec (JSON)**
```
GET /api/docs/spec.json
```

Returns complete OpenAPI 3.0 specification in JSON format.

**Response:**
```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "Kaayko Paddling Intelligence APIs",
    "version": "2.1.0"
  },
  "servers": [...],
  "paths": {...}
}
```

**Use Cases:**
- Programmatic API discovery
- Automated testing
- Code generation tools

---

## 📄 OpenAPI Specification

### Source File:
**`api/docs/kaayko-paddling-api-swagger.yaml`** (2,392 lines)

### Coverage:
Complete specification for:
1. **Weather APIs** (paddleScore, fastForecast, forecast)
2. **Location APIs** (paddlingOut, nearbyWater)
3. **Smart Links** (all CRUD operations)
4. **PaddleBot** (chat, session management)
5. **Products** (catalog, images)
6. **Deep Links** (universal links, context)

### Schema Definitions:
```yaml
components:
  schemas:
    PaddleScore:
      type: object
      properties:
        paddle_score:
          type: number
          minimum: 1.0
          maximum: 5.0
        conditions:
          $ref: '#/components/schemas/WeatherConditions'
    
    WeatherConditions:
      type: object
      properties:
        temperature:
          type: number
        wind_kph:
          type: number
        humidity:
          type: integer
```

---

## 🎨 Swagger UI Integration

### Features:
- ✅ Interactive endpoint testing
- ✅ Request/response examples
- ✅ Authentication configuration
- ✅ Try-it-out functionality
- ✅ Schema visualization

### Access:
**Production:** `https://us-central1-kaaykostore.cloudfunctions.net/api/docs`  
**Local:** `http://127.0.0.1:5001/kaaykostore/us-central1/api/docs`

---

## 🔧 Configuration

### Swagger UI Config:
```javascript
{
  docExpansion: 'list',    // Collapse all by default
  defaultModelsExpandDepth: 1,
  displayRequestDuration: true,
  filter: true,
  showExtensions: true,
  showCommonExtensions: true
}
```

---

## 🧪 Testing

### Test Documentation Endpoint:
```bash
curl http://127.0.0.1:5001/kaaykostore/us-central1/api/docs
```

### Test OpenAPI YAML:
```bash
curl http://127.0.0.1:5001/kaaykostore/us-central1/api/docs/spec.yaml
```

### Test OpenAPI JSON:
```bash
curl http://127.0.0.1:5001/kaaykostore/us-central1/api/docs/spec.json
```

---

## 📈 Performance

| Endpoint | Response Time | Notes |
|----------|---------------|-------|
| /docs | ~200ms | HTML page |
| /spec.yaml | ~50ms | Static file |
| /spec.json | ~50ms | Static file |

---

## 📚 Related Documentation

- **OpenAPI Spec:** `../../docs/kaayko-paddling-api-swagger.yaml`
- **API Reference:** `../../docs/API-QUICK-REFERENCE-v2.1.0.md`
- **Technical Docs:** `../../docs/`

---

## 🚀 Deployment

Deploy docs API:
```bash
cd api/deployment
./deploy-firebase-functions.sh
```

---

**Status:** ✅ Production-ready  
**OpenAPI:** 3.0.3  
**Spec Lines:** 2,392  
**Coverage:** Complete
