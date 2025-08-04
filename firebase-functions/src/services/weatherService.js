// File: functions/src/services/weatherService.js

const https = require('https');
const cache = require('../utils/cache');
const { WEATHER_CONFIG } = require('../config/weatherConfig');

/**
 * Fetch enhanced weather data with 3-day forecast
 * @param {string} query - location string or "lat,lon"
 * @returns {Promise<object>} enhanced weather data with forecast data
 */
async function fetchAndCacheWeather(query) {
  const cacheKey = `weather_forecast3:${query}`;
  const cached = await cache.get(cacheKey);
  if (cached) {
    console.log(`🌤️ 3-day forecast cache HIT for ${query}`);
    return cached;
  }

  console.log(`🌤️ 3-day forecast cache MISS for ${query} - fetching data`);
  
  try {
    // Fetch current + 3-day forecast (simpler and more reliable)
    const forecastUrl = `${WEATHER_CONFIG.BASE_URL}/forecast.json?key=${WEATHER_CONFIG.API_KEY}&q=${encodeURIComponent(query)}&days=3&aqi=yes&alerts=yes`;
    
    const forecastData = await fetchWeatherData(forecastUrl);

    // Enhanced data with 3-day forecast and trends
    const enhancedData = {
      location: forecastData.location,
      current: forecastData.current,
      forecast: forecastData.forecast,
      alerts: forecastData.alerts || [],
      trends: calculate3DayTrends(forecastData.forecast),
      metadata: {
        dataPoints: forecastData.forecast.forecastday.length + 1,
        forecastDays: 3,
        fetchedAt: new Date().toISOString(),
        hasAlerts: (forecastData.alerts && forecastData.alerts.alert.length > 0)
      }
    };

    // Cache forecast data
    cache.set(cacheKey, enhancedData, WEATHER_CONFIG.CACHE_DURATION).catch(err => 
      console.warn('Failed to cache 3-day forecast data:', err)
    );
    
    console.log(`💾 Cached 3-day forecast for ${query} (${WEATHER_CONFIG.CACHE_DURATION}s TTL)`);
    return enhancedData;

  } catch (error) {
    console.error('3-day forecast fetch failed, falling back to current data:', error);
    // Fallback to current data only
    return await fetchBasicWeatherData(query);
  }
}

/**
 * Calculate 3-day weather trends for better predictions
 */
function calculate3DayTrends(forecast) {
  const days = forecast.forecastday;
  if (days.length < 2) return null;

  // Calculate temperature trends
  const temps = days.map(day => day.day.avgtemp_c);
  const tempTrend = temps[temps.length - 1] - temps[0];

  // Calculate wind trends  
  const winds = days.map(day => day.day.maxwind_kph);
  const windTrend = winds[winds.length - 1] - winds[0];

  // Calculate precipitation trend
  const precips = days.map(day => day.day.totalprecip_mm);
  const precipTrend = precips.reduce((sum, val) => sum + val, 0) / precips.length;

  return {
    temperature: {
      trend: tempTrend > 2 ? 'warming' : tempTrend < -2 ? 'cooling' : 'stable',
      change: tempTrend,
      stability: calculateVariance(temps) < 4 ? 'stable' : 'variable'
    },
    wind: {
      trend: windTrend > 3 ? 'increasing' : windTrend < -3 ? 'decreasing' : 'stable', 
      change: windTrend,
      stability: calculateVariance(winds) < 9 ? 'stable' : 'variable'
    },
    precipitation: {
      average: precipTrend,
      trend: precipTrend > 5 ? 'wet_period' : precipTrend > 1 ? 'some_rain' : 'dry'
    },
    overall: {
      stability: (calculateVariance(temps) < 4 && calculateVariance(winds) < 9) ? 'very_stable' : 
                 (calculateVariance(temps) < 8 && calculateVariance(winds) < 16) ? 'stable' : 'variable'
    }
  };
}

/**
 * Calculate variance for trend analysis
 */
function calculateVariance(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  return variance;
}

/**
 * Fetch basic weather data (fallback)
 */
async function fetchBasicWeatherData(query) {
  const url = `${WEATHER_CONFIG.CURRENT_URL}?key=${WEATHER_CONFIG.API_KEY}&q=${encodeURIComponent(query)}&aqi=yes`;
  return await fetchWeatherData(url);
}

/**
 * Generic weather data fetcher
 */
async function fetchWeatherData(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: WEATHER_CONFIG.TIMEOUT }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.error) {
            return reject(new Error(json.error.message));
          }
          resolve(json);
        } catch (err) {
          reject(new Error('Invalid weather data response'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Weather API timeout'));
    });
  });
}

module.exports = { fetchAndCacheWeather };