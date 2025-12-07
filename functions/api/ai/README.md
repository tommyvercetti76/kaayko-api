# 🤖 AI & Chat APIs

**GPT-powered custom actions for paddle conditions**

---

## 📁 Files in this Module

1. **`gptActions.js`** - GPT Actions for OpenAI custom GPT integration (ChatGPT)

---

## 🤖 GPT Actions API

**File:** `gptActions.js`  
**Purpose:** OpenAI Custom GPT integration for ChatGPT

### Overview

GPT Actions provides simplified API endpoints for OpenAI Custom GPT integration:
- ✅ Paddle scores and weather conditions
- ✅ Location-based forecasts
- ✅ Nearby paddling spot discovery
- ✅ Optimized for ChatGPT consumption

---

## 📋 Endpoints

### **1. Get Paddle Score**
```
GET /api/gptActions/paddleScore?latitude=30.3894&longitude=-97.9433
```

Returns current paddle conditions for GPT consumption.

**Response:**
```json
{
  "success": true,
  "data": {
    "paddleScore": 4.5,
    "temperature": 72,
    "windSpeed": 8,
    "conditions": "Excellent for paddling",
    "location": {
      "latitude": 30.3894,
      "longitude": -97.9433
    }
  }
}
```

---

### **2. Get Forecast**
```
GET /api/gptActions/forecast?latitude=30.3894&longitude=-97.9433
```

3-day forecast formatted for GPT consumption.

**Response:**
```json
{
  "success": true,
  "forecast": [
    {
      "date": "2025-12-05",
      "paddleScore": 4.2,
      "temperature": 68,
      "conditions": "Good"
    }
  ]
}
```

---

### **3. List Locations**
```
GET /api/gptActions/locations
```

All paddling locations for GPT knowledge.

---

### **4. Find Nearby**
```
POST /api/gptActions/findNearby
Body: { "latitude": 30.3894, "longitude": -97.9433, "radius": 5000 }
```

Find nearby paddling spots.

---

## 🔧 Configuration

### **OpenAI Custom GPT Setup:**

1. Create Custom GPT in ChatGPT
2. Add Actions with these endpoints
3. Configure authentication (API key)
4. Test with natural language queries

---

## 📚 Related Documentation

- **GPT Setup:** `../../../../docs/chatbot/GPT_SETUP_GUIDE.md`
- **Architecture:** `../../../../docs/chatbot/CHATBOT_ARCHITECTURE.md`

---

## 🚀 Deployment

Deploy AI APIs:
```bash
cd api/deployment
./deploy-firebase-functions.sh
```

---

## 📈 Performance

| Metric | Value | Notes |
|--------|-------|-------|
| **Response Time** | 500ms | Direct API calls |
| **Rate Limiting** | 100 req/min | Per GPT session |

---

**Status:** ✅ Production-ready  
**Integration:** OpenAI Custom GPT (ChatGPT)
