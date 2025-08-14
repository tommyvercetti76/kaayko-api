// File: functions/src/config/weatherConfig.js - Firebase Functions v2 Compatible

const { defineString } = require('firebase-functions/params');

// Define environment parameter for v2
const weatherApiKey = defineString('WEATHER_API_KEY', {
  default: '26fbd83a03c945c9b34190954253107'
});

module.exports = {
  WEATHER_CONFIG: {
    API_KEY: weatherApiKey, // Don't call .value() during deployment
    BASE_URL: 'https://api.weatherapi.com/v1',
    CURRENT_URL: 'https://api.weatherapi.com/v1/current.json',
    MARINE_URL: 'https://api.weatherapi.com/v1/marine.json',
    TIMEOUT: 8000,            // milliseconds
    CACHE_DURATION: 600,      // seconds
    COORDINATE_PRECISION: 4
  }
};