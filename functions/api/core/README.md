# 📚 Core / Docs API

Serves interactive API documentation via Swagger UI and the OpenAPI specification.

## Files

| File | Purpose |
|------|---------|
| `docs.js` | Router — mounted at `/docs` |

---

## Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/docs` | Interactive Swagger UI page | Public |
| GET | `/docs/spec.yaml` | OpenAPI 3.0.3 spec (YAML) | Public |
| GET | `/docs/spec.json` | OpenAPI 3.0.3 spec (JSON) | Public |

### GET `/docs`

Returns an HTML page with Swagger UI rendering the full API specification. Supports try-it-out for all endpoints.

**Production:** `https://us-central1-kaaykostore.cloudfunctions.net/api/docs`  
**Local:** `http://127.0.0.1:5001/kaaykostore/us-central1/api/docs`

### GET `/docs/spec.yaml`

Returns the raw OpenAPI specification in YAML format.

### GET `/docs/spec.json`

Returns the OpenAPI specification converted to JSON.

---

**Test suite:** `__tests__/core.test.js` (24 tests)
