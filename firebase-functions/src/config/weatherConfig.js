// File: functions/src/config/weatherConfig.js

const functions = require('firebase-functions');

module.exports = {
  WEATHER_CONFIG: {
    API_KEY: functions.config().weather?.api_key || process.env.WEATHER_API_KEY || '26fbd83a03c945c9b34190954253107',
    BASE_URL: 'https://api.weatherapi.com/v1',
    CURRENT_URL: 'https://api.weatherapi.com/v1/current.json',
    MARINE_URL: 'https://api.weatherapi.com/v1/marine.json',
    TIMEOUT: 8000,            // milliseconds
    CACHE_DURATION: 600,      // seconds
    COORDINATE_PRECISION: 4
  }
};