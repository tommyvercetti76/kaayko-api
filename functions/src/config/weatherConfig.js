// File: functions/src/config/weatherConfig.js - Firebase Functions v2 Compatible

const { defineString } = require('firebase-functions/params');

// Define environment parameter for v2
const weatherApiKey = defineString('WEATHER_API_KEY', {
  default: '26fbd83a03c945c9b34190954253107'
});

// Helper function to get API key (works both locally and deployed)
function getApiKey() {
  // For local testing, always use the hardcoded key
  if (process.env.NODE_ENV !== 'production') {
    const localKey = '26fbd83a03c945c9b34190954253107';
    console.log(`Using local API key: ${localKey.substring(0, 8)}...`);
    return localKey;
  }
  
  try {
    // Try to get from Firebase Functions parameter first (production)
    if (typeof weatherApiKey.value === 'function') {
      return weatherApiKey.value();
    }
  } catch (error) {
    console.log('Firebase parameter not available, using fallback');
  }
  
  // Fallback
  return process.env.WEATHER_API_KEY || '26fbd83a03c945c9b34190954253107';
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