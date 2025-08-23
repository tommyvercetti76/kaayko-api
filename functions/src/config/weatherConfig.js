// File: functions/src/config/weatherConfig.js - Firebase Functions v2 Compatible

const { defineString } = require('firebase-functions/params');

// Define environment parameter for v2
const weatherApiKey = defineString('WEATHER_API_KEY', {
  default: 'YOUR_API_KEY_HERE'  // Never hardcode real keys!
});

// Helper function to get API key (works both locally and deployed)
function getApiKey() {
    // For production, use Firebase Functions config
    // For local development, use environment variable
    const localKey = process.env.WEATHER_API_KEY || 'YOUR_API_KEY_HERE';
    
    // If we're in Firebase Functions environment
    if (typeof process !== 'undefined' && process.env) {
        return process.env.WEATHER_API_KEY || localKey;
    }
    
    // If we're using Firebase Functions v2 with defineString
    if (typeof weatherApiKey.value === 'function') {
      return weatherApiKey.value();
    } else if (weatherApiKey.value) {
      return weatherApiKey.value;
    }
    
    // Fallback - should be set in environment
    console.warn('⚠️  WEATHER_API_KEY not found in environment variables');
  return process.env.WEATHER_API_KEY || 'YOUR_API_KEY_HERE';
}

module.exports = {
  WEATHER_CONFIG: {
    API_KEY: weatherApiKey, // For deployment
    API_KEY_VALUE: getApiKey(), // For actual use
    BASE_URL: 'https://api.weatherapi.com/v1',
    CURRENT_URL: 'https://api.weatherapi.com/v1/current.json',
    MARINE_URL: 'https://api.weatherapi.com/v1/marine.json',
    TIMEOUT: 8000,            // milliseconds
    CACHE_DURATION: 600,      // seconds
    COORDINATE_PRECISION: 4
  }
};