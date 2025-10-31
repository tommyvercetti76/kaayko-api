/**
 * PaddleBot Conversation API
 * 
 * Hybrid approach combining:
 * - OpenAI GPT-4o for natural language understanding
 * - Dialogflow-inspired context management
 * - Kaayko ML APIs for real-time paddle data
 * 
 * Features:
 * - Multi-turn conversations with memory
 * - Location extraction and geocoding
 * - Intent recognition (current conditions, forecast, nearby lakes)
 * - Follow-up question handling
 * - Conversational context tracking
 */

const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { OPENAI_CONFIG } = require('../../config/openaiConfig');

const router = express.Router();

// Initialize OpenAI with secure config
const openai = new OpenAI({
  apiKey: OPENAI_CONFIG.API_KEY_VALUE
});

// Firestore for session storage
const db = getFirestore();

/**
 * Session Context Manager (Dialogflow-inspired)
 * Maintains conversation state across multiple turns
 */
class ConversationContext {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.parameters = {};
    this.lifespan = 5; // Number of turns to remember context
    this.turnCount = 0;
    this.conversationHistory = [];
    this.lastIntent = null;
    this.lastLocation = null;
    this.userPreferences = {
      units: 'imperial',
      timezone: 'America/Los_Angeles'
    };
  }

  /**
   * Set context parameter (like Dialogflow contexts)
   */
  setParameter(key, value, lifespan = 5) {
    this.parameters[key] = {
      value,
      lifespan,
      setAt: this.turnCount
    };
  }

  /**
   * Get context parameter
   */
  getParameter(key) {
    const param = this.parameters[key];
    if (!param) return null;
    
    // Check if parameter has expired
    const age = this.turnCount - param.setAt;
    if (age > param.lifespan) {
      delete this.parameters[key];
      return null;
    }
    
    return param.value;
  }

  /**
   * Add message to conversation history
   */
  addMessage(role, content) {
    this.conversationHistory.push({
      role,
      content,
      timestamp: Date.now()
    });

    // Keep only last 10 messages for context window
    if (this.conversationHistory.length > 10) {
      this.conversationHistory = this.conversationHistory.slice(-10);
    }
  }

  /**
   * Increment turn counter and cleanup expired contexts
   */
  nextTurn() {
    this.turnCount++;
    
    // Cleanup expired parameters
    Object.keys(this.parameters).forEach(key => {
      const param = this.parameters[key];
      const age = this.turnCount - param.setAt;
      if (age > param.lifespan) {
        delete this.parameters[key];
      }
    });
  }

  /**
   * Serialize to Firestore
   */
  toJSON() {
    return {
      sessionId: this.sessionId,
      parameters: this.parameters,
      turnCount: this.turnCount,
      conversationHistory: this.conversationHistory,
      lastIntent: this.lastIntent,
      lastLocation: this.lastLocation,
      userPreferences: this.userPreferences,
      updatedAt: FieldValue.serverTimestamp()
    };
  }

  /**
   * Load from Firestore
   */
  static fromJSON(data) {
    const context = new ConversationContext(data.sessionId);
    context.parameters = data.parameters || {};
    context.turnCount = data.turnCount || 0;
    context.conversationHistory = data.conversationHistory || [];
    context.lastIntent = data.lastIntent || null;
    context.lastLocation = data.lastLocation || null;
    context.userPreferences = data.userPreferences || context.userPreferences;
    return context;
  }
}

/**
 * Intent Recognition System
 * Analyzes user input to determine what they want
 */
async function recognizeIntent(userMessage, context) {
  const systemPrompt = `You are an intent classifier for a paddle conditions chatbot.

Extract the following from the user's message:
1. Intent: One of [current_conditions, forecast, nearby_lakes, compare_locations, general_question, follow_up]
2. Location: Any mentioned place (lake name, city, address, coordinates)
3. Time: Any time reference (now, tomorrow, this weekend, etc.)
4. Entities: Any relevant details (weather concerns, activity type, etc.)

Context from previous conversation:
- Last location mentioned: ${context.lastLocation?.name || 'none'}
- Last intent: ${context.lastIntent || 'none'}

If the user says "there" or "it" or asks a follow-up, refer to the last location/intent.

Return ONLY valid JSON:
{
  "intent": "string",
  "location": {"name": "string", "needsGeocode": true/false, "lat": number|null, "lon": number|null},
  "timeframe": "string",
  "entities": ["string"],
  "confidence": 0.0-1.0,
  "needsMoreInfo": true/false,
  "clarificationQuestion": "string or null"
}`;

  const response = await openai.chat.completions.create({
    model: OPENAI_CONFIG.INTENT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature: OPENAI_CONFIG.TEMPERATURE.INTENT,
    response_format: { type: 'json_object' }
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Geocoding service to convert location names to coordinates
 */
async function geocodeLocation(locationName) {
  try {
    // Use OpenCage, Google Geocoding, or Nominatim
    // For now, using a simple approach with OpenStreetMap Nominatim
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: locationName,
        format: 'json',
        limit: 1
      },
      headers: {
        'User-Agent': 'Kaayko-PaddleBot/1.0'
      }
    });

    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      return {
        name: result.display_name,
        lat: parseFloat(result.lat),
        lon: parseFloat(result.lon),
        type: result.type,
        confidence: 1.0
      };
    }

    return null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}

/**
 * Call Kaayko API based on intent
 */
async function callKaaykoAPI(intent, location, timeframe, context) {
  const baseURL = 'https://us-central1-kaaykostore.cloudfunctions.net/api';
  
  try {
    switch (intent) {
      case 'current_conditions':
        const scoreResponse = await axios.get(`${baseURL}/paddleScore`, {
          params: {
            lat: location.lat,
            lon: location.lon
          }
        });
        return {
          type: 'current_conditions',
          data: scoreResponse.data,
          location
        };

      case 'forecast':
        const forecastResponse = await axios.get(`${baseURL}/fastForecast`, {
          params: {
            lat: location.lat,
            lon: location.lon
          }
        });
        return {
          type: 'forecast',
          data: forecastResponse.data,
          location
        };

      case 'nearby_lakes':
        const nearbyResponse = await axios.get(`${baseURL}/nearbyWater`, {
          params: {
            lat: location.lat,
            lon: location.lon,
            radius: 25000 // 25km default
          }
        });
        return {
          type: 'nearby_lakes',
          data: nearbyResponse.data,
          location
        };

      case 'compare_locations':
        // Could fetch data for multiple locations
        return {
          type: 'compare_locations',
          data: { message: 'Comparison feature coming soon!' },
          location
        };

      default:
        return {
          type: 'error',
          data: { message: 'Intent not recognized' },
          location
        };
    }
  } catch (error) {
    console.error('Kaayko API error:', error);
    return {
      type: 'error',
      data: { message: error.message },
      location
    };
  }
}

/**
 * Generate natural language response using GPT
 */
async function generateResponse(apiData, userMessage, context) {
  // Special handling for nearby lakes - list them with details
  if (apiData.type === 'nearby_lakes' && apiData.data.waterBodies) {
    const lakes = apiData.data.waterBodies.slice(0, 5); // Top 5
    
    if (lakes.length === 0) {
      return "🚣‍♀️ No lakes found within 25km. Try expanding your search area!";
    }
    
    let response = `🚣‍♀️ Found ${apiData.data.waterBodies.length} nearby paddling spots!\n\n**Top ${lakes.length} closest:**\n`;
    
    lakes.forEach((lake, idx) => {
      const distance = lake.distanceMiles < 1 
        ? `${(lake.distanceMiles * 5280).toFixed(0)}ft`
        : `${lake.distanceMiles.toFixed(1)}mi`;
      
      const typeEmoji = lake.type === 'lake' ? '🏞️' : lake.type === 'river' ? '🌊' : '💧';
      const publicAccess = lake.access === 'public' || lake.publicLand ? '✅ Public' : '';
      
      response += `${idx + 1}. ${typeEmoji} **${lake.name}** - ${distance} away ${publicAccess}\n`;
    });
    
    response += `\nAsk me about conditions at any of these locations! 🌤️`;
    return response;
  }

  // For other intents, use GPT to generate response
  const systemPrompt = `You are Kaayko PaddleBot - concise paddling assistant.

Response rules:
- CONCISE: 2-3 sentences max
- START with paddle score prominently (e.g., "🚣‍♀️ Score: 4.5/5.0 ⭐ - Great!")
- KEY FACTS ONLY: Wind, temp, water temp
- Bold important warnings
- Use emojis: ⭐ ⚠️ 🌊 🌡️ 💨
- Skip filler words

Example format:
"🚣‍♀️ Score: 4.5/5.0 ⭐ - Excellent conditions!
Wind: 6 km/h (calm) 💨 | Temp: 21°C | Water: 25°C 🌡️
**Warning:** Cool water - wear wetsuit. Enjoy! 🌊"

Data: ${JSON.stringify(apiData, null, 2)}
User: ${userMessage}`;

  const response = await openai.chat.completions.create({
    model: OPENAI_CONFIG.RESPONSE_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.7,
    max_tokens: 150
  });

  return response.choices[0].message.content;
}

/**
 * Main conversation endpoint
 */
router.post('/chat', async (req, res) => {
  try {
    const { message, sessionId, latitude, longitude } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Generate sessionId if not provided
    const finalSessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Load or create conversation context
    const sessionRef = db.collection('paddle_bot_sessions').doc(finalSessionId);
    const sessionDoc = await sessionRef.get();
    
    let context;
    if (sessionDoc.exists) {
      context = ConversationContext.fromJSON(sessionDoc.data());
    } else {
      context = new ConversationContext(finalSessionId);
    }

    // Add user message to history
    context.addMessage('user', message);

    // Step 1: Recognize intent
    const intentData = await recognizeIntent(message, context);
    console.log('Intent recognized:', intentData);

    // Check if we need clarification
    if (intentData.needsMoreInfo) {
      const response = intentData.clarificationQuestion || 
        "I'd love to help! Which lake or location are you asking about?";
      
      context.addMessage('assistant', response);
      context.nextTurn();
      await sessionRef.set(context.toJSON());

      return res.json({
        sessionId: finalSessionId,
        response,
        needsMoreInfo: true,
        suggestedActions: ['Specify a lake name', 'Share your location', 'Browse popular spots']
      });
    }

    // Step 2: Geocode if needed
    let location = intentData.location;
    
    // If user provided coordinates (from browser geolocation), use those
    if (latitude && longitude) {
      location = {
        name: 'Your location',
        lat: parseFloat(latitude),
        lon: parseFloat(longitude),
        needsGeocode: false
      };
      context.setParameter('location', location, 5);
      context.lastLocation = location;
    } else if (location.needsGeocode && location.name) {
      const geocoded = await geocodeLocation(location.name);
      if (geocoded) {
        location = geocoded;
        context.setParameter('location', location, 5);
        context.lastLocation = location;
      } else {
        const response = `I couldn't find "${location.name}". Could you provide more details or try a different location?`;
        context.addMessage('assistant', response);
        context.nextTurn();
        await sessionRef.set(context.toJSON());

        return res.json({
          sessionId: finalSessionId,
          response,
          needsMoreInfo: true,
          error: 'geocoding_failed'
        });
      }
    }

    // Use last known location if user is asking follow-up
    if (!location.lat && !location.lon && context.lastLocation) {
      location = context.lastLocation;
    }

    // Step 3: Call Kaayko API
    const apiData = await callKaaykoAPI(intentData.intent, location, intentData.timeframe, context);
    
    // Update context
    context.lastIntent = intentData.intent;
    context.lastLocation = location;
    context.setParameter('last_api_result', apiData, 3);

    // Step 4: Generate natural language response
    const naturalResponse = await generateResponse(apiData, message, context);

    context.addMessage('assistant', naturalResponse);
    context.nextTurn();

    // Save session
    await sessionRef.set(context.toJSON());

    // Generate suggestions
    const suggestions = generateFollowUpSuggestions(intentData.intent, apiData);

    // Step 5: Return response with rich data
    const responseData = {
      sessionId: finalSessionId,
      response: naturalResponse,
      intent: intentData.intent,
      location: {
        name: location.name,
        lat: location.lat,
        lon: location.lon
      },
      data: apiData.data, // Raw data for UI to render cards/charts
      suggestedFollowUps: suggestions
    };
    
    return res.json(responseData);

  } catch (error) {
    console.error('Conversation error:', error);
    return res.status(500).json({ 
      error: 'Failed to process conversation',
      details: error.message 
    });
  }
});

/**
 * Generate contextual follow-up suggestions
 */
function generateFollowUpSuggestions(intent, apiData) {
  const suggestions = [];

  switch (intent) {
    case 'current_conditions':
      suggestions.push(
        'Show me the 3-day forecast',
        'Find nearby lakes',
        'What about tomorrow?'
      );
      break;
    case 'forecast':
      suggestions.push(
        'What are conditions right now?',
        'Show me other lakes nearby',
        'Is it safe for beginners?'
      );
      break;
    case 'nearby_lakes':
      suggestions.push(
        'Tell me about the first one',
        'Which has the best conditions?',
        'Show me only lakes with rentals'
      );
      break;
  }

  return suggestions.slice(0, 3);
}

/**
 * Get session history
 */
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionDoc = await db.collection('paddle_bot_sessions').doc(sessionId).get();

    if (!sessionDoc.exists) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.json(sessionDoc.data());
  } catch (error) {
    console.error('Session retrieval error:', error);
    return res.status(500).json({ error: 'Failed to retrieve session' });
  }
});

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'PaddleBot Conversation API',
    status: 'running',
    openai: OPENAI_CONFIG.API_KEY_VALUE ? 'configured' : 'missing',
    version: '2.0.0'
  });
});

/**
 * Clear session (start fresh)
 */
router.delete('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    await db.collection('paddle_bot_sessions').doc(sessionId).delete();
    return res.json({ success: true, message: 'Session cleared' });
  } catch (error) {
    console.error('Session deletion error:', error);
    return res.status(500).json({ error: 'Failed to clear session' });
  }
});

module.exports = router;
