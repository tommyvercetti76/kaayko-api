# 🤖 AI / GPT Actions API

OpenAI Custom GPT integration — paddle conditions, forecasts, and spot discovery optimized for ChatGPT consumption.

## Files

| File | Purpose |
|------|---------|
| `gptActions.js` | Router — mounted at `/gptActions` |
| `gptActionHandlers.js` | Handler implementations |

---

## Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/gptActions/paddleScore` | Current paddle score + weather | Public |
| GET | `/gptActions/forecast` | 3-day forecast | Public |
| GET | `/gptActions/locations` | All paddling locations | Public |
| GET | `/gptActions/nearbyWater` | Nearby water bodies | Public |
| POST | `/gptActions/findNearby` | Find spots by lat/lng/radius | Public |

### GET `/gptActions/paddleScore`

**Query:** `?latitude=30.3894&longitude=-97.9433`  
**Response:**
```json
{
  "success": true,
  "data": {
    "paddleScore": 4.5,
    "temperature": 72,
    "windSpeed": 8,
    "conditions": "Excellent for paddling",
    "location": { "latitude": 30.3894, "longitude": -97.9433 }
  }
}
```

### GET `/gptActions/forecast`

**Query:** `?latitude=30.3894&longitude=-97.9433`  
**Response:**
```json
{
  "success": true,
  "forecast": [
    { "date": "2026-02-07", "paddleScore": 4.2, "temperature": 68, "conditions": "Good" }
  ]
}
```

### GET `/gptActions/locations`

Returns all paddling spots — names, coordinates, types.

### GET `/gptActions/nearbyWater`

**Query:** `?latitude=30.39&longitude=-97.94&radius=5000`

### POST `/gptActions/findNearby`

**Body:** `{ "latitude": 30.39, "longitude": -97.94, "radius": 5000 }`

---

## OpenAI Custom GPT Setup

1. Create Custom GPT in ChatGPT
2. Add Actions with these 5 endpoints
3. Base URL: `https://us-central1-kaaykostore.cloudfunctions.net/api/gptActions`
4. No authentication required

---

**Test suite:** Part of `__tests__/core.test.js`
