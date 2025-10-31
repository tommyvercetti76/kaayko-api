// File: functions/src/config/openaiConfig.js - Firebase Functions v2 Compatible

const { defineString } = require('firebase-functions/params');

// Define environment parameter for v2
const openaiApiKey = defineString('OPENAI_API_KEY', {
  default: 'YOUR_OPENAI_KEY_HERE'  // Never hardcode real keys!
});

// Helper function to get API key (works both locally and deployed)
function getApiKey() {
    // For production, use Firebase Functions config
    // For local development, use environment variable
    const localKey = process.env.OPENAI_API_KEY || 'YOUR_OPENAI_KEY_HERE';
    
    // If we're in Firebase Functions environment
    if (typeof process !== 'undefined' && process.env) {
        return process.env.OPENAI_API_KEY || localKey;
    }
    
    // If we're using Firebase Functions v2 with defineString
    if (typeof openaiApiKey.value === 'function') {
      return openaiApiKey.value();
    } else if (openaiApiKey.value) {
      return openaiApiKey.value;
    }
    
    // Fallback - should be set in environment
    console.warn('⚠️  OPENAI_API_KEY not found in environment variables');
  return process.env.OPENAI_API_KEY || 'YOUR_OPENAI_KEY_HERE';
}

module.exports = {
  OPENAI_CONFIG: {
    API_KEY: openaiApiKey,         // For deployment
    API_KEY_VALUE: getApiKey(),     // For actual use
    INTENT_MODEL: 'gpt-4o-mini',    // Cheap, fast for intent recognition
    RESPONSE_MODEL: 'gpt-4o',       // High quality for responses
    MAX_TOKENS: 300,                // Response length limit
    TEMPERATURE: {
      INTENT: 0.3,                  // Low = more consistent intent extraction
      RESPONSE: 0.7                 // Higher = more natural/varied responses
    },
    TIMEOUT: 30000                  // 30 seconds
  }
};
