# 🌐 FRONTEND → BACKEND API FLOW (LIVE USAGE)

## 👤 **USER INTERACTION FLOW:**

### **1. User Opens Page**
```
User visits: kaayko-frontend/src/paddlingout.html
Browser loads: paddlingout.js + services/apiClient.js
```

### **2. User Clicks Location Pin**
```javascript
// paddlingout.js calls:
const data = await window.apiClient.getFastForecast(lat, lng);
```

### **3. API Client Executes** 
```javascript
// services/apiClient.js getFastForecast() method:
const baseUrl = this.mode === 'emulator' 
  ? 'http://127.0.0.1:5001/kaaykostore/us-central1'    // ✅ FIXED PORT
  : 'https://us-central1-kaaykostore.cloudfunctions.net';

const url = `${baseUrl}/fastForecast?lat=${lat}&lng=${lng}`;  // ✅ NEW API
```

### **4. Network Request Sent**
```
🌐 HTTP GET: https://us-central1-kaaykostore.cloudfunctions.net/fastForecast?lat=37.7749&lng=-122.4194

📡 Your Backend Receives:
  Route: /fastForecast 
  Handler: functions/src/index.js fastForecast function
  Service: UnifiedWeatherService + ML prediction
```

### **5. Backend Response**
```javascript
// Your API returns:
{
  "location": { "lat": 37.7749, "lng": -122.4194 },
  "score": 8.2,
  "conditions": { "wind": "10-15 knots", "waves": "2-4ft" },
  "forecast": [...],
  "generated": "2025-08-19T10:30:00Z"
}
```

### **6. Frontend Displays Results**
```javascript
// paddlingout.js processes response:
displayScoreIcon(data.score);        // Shows: 8.2/10 
updateConditionsText(data.conditions); // Shows: 2-4ft, 10-15kts
showForecastData(data.forecast);     // Shows: 3-day forecast
```

---

## 🎯 **PROOF FRONTEND USES NEW APIS:**

### **✅ Current Frontend API Calls:**
```javascript
// PRIMARY: paddlingout.js main function
window.apiClient.getFastForecast(lat, lng)
  → /fastForecast?lat=X&lng=Y                    // ✅ YOUR NEW API

// FALLBACK: If primary fails  
window.apiClient.getForecastData(lat, lng) 
  → /forecast?lat=X&lng=Y                       // ✅ YOUR NEW API (FIXED!)

window.apiClient.getCurrentData(lat, lng)
  → /paddleScore?location=X,Y                   // ✅ YOUR NEW API (FIXED!)
```

### **❌ OLD APIs (No Longer Called):**
```javascript 
// REMOVED: These don't exist anymore
/paddlePredict/forecast  ← FIXED to /forecast
/paddlePredict          ← FIXED to /paddleScore  
```

---

## 🚀 **FRONTEND IS NOW LIVE WITH YOUR NEW APIS!**

**Test it yourself:**
1. Open: `file:///Users/Rohan/Desktop/kaayko-stable/kaayko-frontend/src/paddlingout.html`
2. Click any location pin
3. Open browser DevTools Network tab
4. See the API calls to your NEW endpoints!

**Expected Network Calls:**
- ✅ `GET /fastForecast?lat=X&lng=Y` 
- ✅ `GET /paddlingOut` (for locations)
- ✅ NO more 404 errors on old endpoints!
