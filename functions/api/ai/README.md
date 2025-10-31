# 🤖 AI & Chat APIs

**GPT-4o powered conversational AI for paddle conditions**

---

## 📁 Files in this Module

1. **`paddleBotConversation.js`** - Main PaddleBot chat API with context management
2. **`gptActions.js`** - GPT Actions for OpenAI custom GPT integration

---

## 🤖 API #1: PaddleBot Conversation

**File:** `paddleBotConversation.js`  
**Endpoints:** 
- `POST /api/paddlebot/chat`
- `GET /api/paddlebot/session/:sessionId`
- `DELETE /api/paddlebot/session/:sessionId`

### Overview

PaddleBot is a conversational AI that combines:
- ✅ OpenAI GPT-4o for natural language understanding
- ✅ Dialogflow-inspired context management
- ✅ Kaayko ML APIs for real-time paddle data
- ✅ Multi-turn conversations with memory
- ✅ Location extraction and geocoding

### Features

#### **1. Natural Language Understanding**
Ask questions naturally:
```
"What are the paddle conditions at Lake Travis?"
"How's the weather at Trinity Lake tomorrow?"
"Find me a lake near Dallas for kayaking"
"What's the best time to paddle White Rock Lake today?"
```

#### **2. Context Management**
Remembers conversation context:
```
User: "What's the weather at Lake Travis?"
Bot: "Lake Travis has great conditions! 4.5/5.0..."

User: "What about tomorrow?"  ← Remembers Lake Travis
Bot: "Tomorrow at Lake Travis..."

User: "Any good spots nearby?"  ← Remembers location
Bot: "Here are lakes near Lake Travis..."
```

#### **3. Intent Recognition**
Automatically recognizes user intents:
- `current_conditions` - Current paddle score
- `forecast` - Future conditions
- `nearby_lakes` - Find paddling spots
- `lake_info` - Location details
- `best_time` - Optimal paddling time
- `general_question` - General paddling questions

#### **4. Location Extraction**
Extracts locations from natural language:
```
"Lake Travis" → { lat: 30.3894, lng: -97.9433 }
"Dallas" → Searches nearby lakes
"30.2672,-97.7431" → Direct coordinates
```

---

## 📋 Endpoint #1: Chat

```
POST /api/paddlebot/chat
```

### Request Body:
```json
{
  "message": "What are the paddle conditions at Lake Travis?",
  "sessionId": "user_12345_session_1",  // required for context
  "context": {  // optional
    "userLocation": { "lat": 30.2672, "lng": -97.7431 },
    "preferences": { "units": "imperial" }
  }
}
```

### Response:
```json
{
  "success": true,
  "response": {
    "message": "Lake Travis has excellent paddle conditions right now! 🚣‍♀️\n\n**Paddle Score:** 4.5/5.0 ⭐\n\n**Current Conditions:**\n- Temperature: 72°F\n- Wind: 8 mph (light breeze)\n- Humidity: 65%\n- Waves: 0.3m (calm)\n\n**Perfect for:** Beginners to advanced paddlers\n\n**Best time today:** Between 10am-2pm when winds are lightest.",
    "intent": "current_conditions",
    "confidence": 0.95,
    "data": {
      "location": {
        "name": "Lake Travis",
        "coordinates": { "lat": 30.3894, "lng": -97.9433 }
      },
      "paddle_score": 4.5,
      "conditions": {
        "temperature": 72,
        "wind_kph": 13,
        "humidity": 65,
        "wave_height": 0.3
      },
      "warnings": []
    }
  },
  "session": {
    "sessionId": "user_12345_session_1",
    "turnCount": 1,
    "context": {
      "lastLocation": "Lake Travis",
      "lastIntent": "current_conditions"
    }
  },
  "cost": {
    "inputTokens": 145,
    "outputTokens": 230,
    "totalCost": 0.00487
  }
}
```

### Follow-up Questions:
```json
{
  "message": "What about tomorrow?",
  "sessionId": "user_12345_session_1"
}
```
Bot remembers "Lake Travis" from context and provides forecast.

---

## 📋 Endpoint #2: Get Session

```
GET /api/paddlebot/session/:sessionId
```

Retrieves conversation context for a session.

### Response:
```json
{
  "success": true,
  "session": {
    "sessionId": "user_12345_session_1",
    "turnCount": 3,
    "context": {
      "lastLocation": "Lake Travis",
      "lastIntent": "forecast",
      "parameters": {
        "location": "Lake Travis",
        "coordinates": { "lat": 30.3894, "lng": -97.9433 }
      }
    },
    "conversationHistory": [
      {
        "role": "user",
        "content": "What are conditions at Lake Travis?"
      },
      {
        "role": "assistant",
        "content": "Lake Travis has excellent conditions..."
      }
    ],
    "created": "2025-10-31T13:00:00Z",
    "lastAccessed": "2025-10-31T13:15:00Z"
  }
}
```

---

## 📋 Endpoint #3: Delete Session

```
DELETE /api/paddlebot/session/:sessionId
```

Clears conversation context (privacy/GDPR).

### Response:
```json
{
  "success": true,
  "message": "Session deleted successfully",
  "sessionId": "user_12345_session_1"
}
```

---

## 🧠 Context Management

### **ConversationContext Class**

Dialogflow-inspired context tracking:

```javascript
class ConversationContext {
  sessionId: string
  parameters: object         // Extracted entities (location, date, etc.)
  lifespan: number          // Number of turns to remember (default: 5)
  turnCount: number         // Current turn number
  conversationHistory: []   // Full chat history
  lastIntent: string        // Last recognized intent
  lastLocation: string      // Last mentioned location
  userPreferences: object   // User settings
}
```

### Context Lifespan:
- **5 turns:** Default context memory
- **Auto-expire:** After 5 conversational turns
- **Manual reset:** DELETE /session/:sessionId

### Example Context Flow:
```
Turn 1: "What's the weather at Lake Travis?"
  → Sets lastLocation = "Lake Travis"
  → Sets lastIntent = "current_conditions"

Turn 2: "What about tomorrow?"
  → Uses lastLocation (Lake Travis)
  → Intent = "forecast"

Turn 3: "Any good spots nearby?"
  → Uses lastLocation coordinates
  → Intent = "nearby_lakes"

Turn 4: "Tell me about the first one"
  → Uses nearby_lakes results from Turn 3
  → Intent = "lake_info"

Turn 5: "What's the best time to go?"
  → Uses lake from Turn 4
  → Intent = "best_time"

Turn 6: Context expires (lifespan = 5)
  → Need to specify location again
```

---

## 🎯 Intent Recognition

### Supported Intents:

#### **1. current_conditions**
Get current paddle score.

**Trigger phrases:**
- "What are conditions at [location]?"
- "How's the weather at [location]?"
- "Can I paddle at [location] right now?"
- "Current conditions [location]"

**API Called:** `GET /api/paddleScore`

---

#### **2. forecast**
Get future conditions.

**Trigger phrases:**
- "What's the forecast for [location]?"
- "Weather tomorrow at [location]"
- "How will conditions be this weekend?"
- "Can I paddle [location] on Saturday?"

**API Called:** `GET /api/fastForecast`

---

#### **3. nearby_lakes**
Find paddling spots.

**Trigger phrases:**
- "Find lakes near me"
- "What are good spots around [location]?"
- "Where can I paddle near Dallas?"
- "Recommend a lake for kayaking"

**API Called:** `GET /api/nearbyWater`

---

#### **4. lake_info**
Get location details.

**Trigger phrases:**
- "Tell me about [lake]"
- "What amenities does [lake] have?"
- "Is [lake] good for beginners?"
- "Does [lake] have parking?"

**API Called:** `GET /api/paddlingout/:id`

---

#### **5. best_time**
Find optimal paddling time.

**Trigger phrases:**
- "When's the best time to paddle [location]?"
- "What time should I go?"
- "When are conditions best?"

**API Called:** `GET /api/fastForecast` + analysis

---

#### **6. general_question**
General paddling questions.

**Trigger phrases:**
- "What gear do I need?"
- "How do paddle scores work?"
- "What's a good score for beginners?"

**Data Source:** GPT-4o knowledge base

---

## 🗺️ Location Extraction

### Location Recognition:

```javascript
// Named locations
"Lake Travis" → Geocode → { lat: 30.3894, lng: -97.9433 }

// City names
"Dallas" → Nearby lakes → Lake Lewisville, White Rock Lake

// Coordinates
"30.2672,-97.7431" → Direct use

// Relative
"near me" → Uses context.userLocation

// Context-based
"there" / "that lake" → Uses lastLocation from context
```

### Geocoding Service:
- **Primary:** Google Maps Geocoding API
- **Fallback:** Paddling locations database
- **Cache:** Recent locations cached for 1 hour

---

## 💬 Response Formatting

### **Rich Responses:**

PaddleBot formats responses with:
1. **Conversational tone** (friendly, helpful)
2. **Structured data** (scores, conditions)
3. **Emojis** (🚣‍♀️, ⭐, 🌊, ☀️)
4. **Safety warnings** (⚠️ when needed)
5. **Follow-up suggestions**

### Example Response Structure:
```
[Friendly greeting + summary]

**Paddle Score:** 4.5/5.0 ⭐

**Current Conditions:**
- Temperature: 72°F
- Wind: 8 mph
- Humidity: 65%

[Detailed analysis]

**Perfect for:** [Skill level]

**Best time:** [Recommendation]

[Optional warnings]

[Follow-up suggestions]
```

---

## 💰 Cost Analysis

### OpenAI Pricing (GPT-4o):
- **Input:** $5.00 / 1M tokens
- **Output:** $15.00 / 1M tokens

### Average Conversation:
```
Input tokens:  ~150 tokens
Output tokens: ~250 tokens
Cost per turn: ~$0.005 (half a cent)
```

### Monthly Estimates:
```
1,000 conversations/month  = $5
10,000 conversations/month = $50
100,000 conversations/month = $500
```

---

## 🔧 Configuration

### **OpenAI Setup:**
```javascript
const openai = new OpenAI({
  apiKey: OPENAI_CONFIG.API_KEY_VALUE
});

const MODEL = 'gpt-4o';
const MAX_TOKENS = 500;
const TEMPERATURE = 0.7;  // Balance creativity/accuracy
```

### **System Prompt:**
```
You are PaddleBot, a friendly AI assistant specializing in paddle conditions.

Your capabilities:
1. Provide real-time paddle scores (1-5) using Kaayko ML
2. Analyze weather and water conditions
3. Recommend paddling locations
4. Give safety advice based on conditions

Guidelines:
- Be conversational and helpful
- Use emojis appropriately
- Provide detailed condition breakdowns
- Include safety warnings when needed
- Suggest follow-up questions

Always prioritize safety and accuracy.
```

---

## 📊 Firestore Collections

### **`paddlebot_sessions`**
```javascript
{
  // Document ID: sessionId
  "sessionId": "user_12345_session_1",
  "context": {
    "parameters": {...},
    "lastIntent": "current_conditions",
    "lastLocation": "Lake Travis",
    "turnCount": 3
  },
  "conversationHistory": [...],
  "created": Timestamp,
  "lastAccessed": Timestamp,
  "expiresAt": Timestamp  // Auto-delete after 24 hours
}
```

### **Auto-Cleanup:**
Sessions auto-expire after 24 hours via Firestore TTL.

---

## 🎭 GPT Actions API

**File:** `gptActions.js`  
**Purpose:** OpenAI Custom GPT integration

### Endpoints:

#### **1. Get Paddle Score**
```
GET /api/gptActions/paddleScore?latitude=30.3894&longitude=-97.9433
```

Simplified endpoint for GPT Action integration.

#### **2. Get Forecast**
```
GET /api/gptActions/forecast?latitude=30.3894&longitude=-97.9433
```

3-day forecast formatted for GPT consumption.

#### **3. List Locations**
```
GET /api/gptActions/locations
```

All paddling locations for GPT knowledge.

#### **4. Find Nearby**
```
POST /api/gptActions/findNearby
Body: { "latitude": 30.3894, "longitude": -97.9433, "radius": 5000 }
```

Find nearby paddling spots.

---

## 🧪 Testing

### Test PaddleBot Locally:
```bash
cd local-dev/scripts
./test-paddlebot-local.sh
```

### Manual Testing:
```bash
curl -X POST http://127.0.0.1:5001/kaaykostore/us-central1/api/paddlebot/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What are conditions at Lake Travis?",
    "sessionId": "test_session_123"
  }'
```

---

## 📚 Related Documentation

- **PaddleBot Guide:** `../../../../docs/paddlebot/PADDLEBOT_README.md`
- **GPT Setup:** `../../../../docs/chatbot/GPT_SETUP_GUIDE.md`
- **Architecture:** `../../../../docs/chatbot/CHATBOT_ARCHITECTURE.md`
- **Local Testing:** `../../../../docs/paddlebot/PADDLEBOT_LOCAL_TESTING.md`

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
| **Response Time** | 2-5s | Includes GPT + API calls |
| **Context Load** | ~50ms | Firestore session fetch |
| **Intent Recognition** | ~1.5s | GPT-4o processing |
| **API Calls** | ~500ms | Parallel when possible |
| **Cost per Turn** | $0.005 | Half a cent |

---

## 🔐 Security & Privacy

- ✅ **Session IDs:** User-generated (no PII)
- ✅ **Auto-expire:** 24-hour session TTL
- ✅ **Delete endpoint:** GDPR compliance
- ✅ **No storage:** User messages not permanently stored
- ✅ **Rate limiting:** 30 req/min per session

---

**Status:** ✅ Production-ready  
**Model:** GPT-4o  
**Accuracy:** High (GPT-4o + Kaayko ML)  
**Cost:** $0.005/conversation
