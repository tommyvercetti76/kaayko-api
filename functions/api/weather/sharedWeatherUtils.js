//  functions/src/utils/sharedWeatherUtils.js
//
//  Shared utilities for weather and paddling APIs
//  Maximizes code reuse and ensures consistency across APIs
//

const https = require('https');
const { WEATHER_CONFIG } = require('../../config/weatherConfig');

/**
 * Shared rate limiting middleware
 */
function createRateLimitMiddleware(maxRequests = 30, windowMs = 60000) {
  const rateLimitMap = new Map();

  return function rateLimitMiddleware(req, res, next) {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    
    if (!rateLimitMap.has(clientIP)) {
      rateLimitMap.set(clientIP, { count: 0, resetTime: now + windowMs });
    }
    
    const clientData = rateLimitMap.get(clientIP);
    
    if (now > clientData.resetTime) {
      clientData.count = 0;
      clientData.resetTime = now + windowMs;
    }
    
    if (clientData.count >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        details: 'Too many requests. Please slow down.',
        retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
      });
    }
    
    clientData.count++;
    next();
  };
}

/**
 * Shared security headers middleware
 */
function securityHeadersMiddleware(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  next();
}

/**
 * Shared location fetching with fallback
 */
async function fetchPaddlingLocations(db) {
  try {
    const response = await new Promise((resolve, reject) => {
      const req = https.get('https://kaayko.com/api/paddlingOut', {
        timeout: 8000,
        headers: { 'User-Agent': 'Kaayko-SharedUtils/1.0' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON from paddlingOut API'));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));
    });
    
    if (!Array.isArray(response)) throw new Error('Invalid response format');
    
    return response
      .filter(spot => spot.location?.latitude && spot.location?.longitude)
      .map(spot => ({
        id: spot.id,
        name: spot.title || spot.lakeName || spot.id,
        coordinates: {
          latitude: spot.location.latitude,
          longitude: spot.location.longitude
        },
        amenities: {
          parking: spot.parkingAvl === true || spot.parkingAvl === 'Y',
          restrooms: spot.restroomsAvl === true || spot.restroomsAvl === 'Y'
        }
      }))
      .filter(spot => 
        Math.abs(spot.coordinates.latitude) <= 90 &&
        Math.abs(spot.coordinates.longitude) <= 180
      );
      
  } catch (error) {
    console.warn('paddlingOut API failed, using Firestore fallback:', error.message);
    
    // Fallback to Firestore with timeout
    const snapshot = await Promise.race([
      db.collection('paddlingSpots').get(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Firestore timeout')), 5000)
      )
    ]);
    
    return snapshot.docs
      .map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.title || data.lakeName || doc.id,
          coordinates: {
            latitude: data.location?.latitude,
            longitude: data.location?.longitude
          },
          amenities: {
            parking: data.parkingAvl === true || data.parkingAvl === 'Y',
            restrooms: data.restroomsAvl === true || data.restroomsAvl === 'Y'
          }
        };
      })
      .filter(spot => 
        spot.coordinates.latitude && 
        spot.coordinates.longitude
      );
  }
}

/**
 * Validates WeatherAPI response structure and adds safe defaults
 */
function validateAndSanitizeWeatherData(weatherData) {
  if (!weatherData || !weatherData.current || !weatherData.location) {
    throw new Error('Invalid weather data structure received from WeatherAPI');
  }

  const current = weatherData.current;
  const location = weatherData.location;

  return {
    current: {
      temp_c: current.temp_c || 15,
      temp_f: current.temp_f || 59,
      feelslike_c: current.feelslike_c || current.temp_c || 15,
      feelslike_f: current.feelslike_f || current.temp_f || 59,
      wind_mph: current.wind_mph || 0,
      wind_kph: current.wind_kph || 0,
      wind_dir: current.wind_dir || 'N',
      wind_degree: current.wind_degree || 0,
      gust_mph: current.gust_mph || current.wind_mph || 0,
      gust_kph: current.gust_kph || current.wind_kph || 0,
      pressure_mb: current.pressure_mb || 1013,
      pressure_in: current.pressure_in || 29.92,
      humidity: current.humidity || 50,
      vis_km: current.vis_km || 10,
      vis_miles: current.vis_miles || 6,
      cloud: current.cloud || 0,
      uv: current.uv || 0,
      is_day: current.is_day !== undefined ? current.is_day : 1,
      precip_mm: current.precip_mm || 0,
      precip_in: current.precip_in || 0,
      windchill_c: current.windchill_c || current.temp_c || 15,
      windchill_f: current.windchill_f || current.temp_f || 59,
      heatindex_c: current.heatindex_c || current.temp_c || 15,
      heatindex_f: current.heatindex_f || current.temp_f || 59,
      dewpoint_c: current.dewpoint_c || (current.temp_c - 5) || 10,
      dewpoint_f: current.dewpoint_f || (current.temp_f - 9) || 50,
      condition: current.condition || { text: 'Unknown', code: 0, icon: '' },
      air_quality: current.air_quality || null
    },
    location: {
      name: location.name || 'Unknown',
      region: location.region || '',
      country: location.country || 'Unknown',
      lat: location.lat || 0,
      lon: location.lon || 0,
      tz_id: location.tz_id || 'UTC',
      localtime: location.localtime || new Date().toISOString()
    }
  };
}

/**
 * Enhanced error handling for API calls
 */
function createAPIErrorHandler(serviceName) {
  return function handleAPIError(error, req, res, next) {
    console.error(`${serviceName} API Error:`, error);
    
    const statusCode = error.statusCode || 500;
    const errorResponse = {
      success: false,
      error: `${serviceName} service error`,
      timestamp: new Date().toISOString()
    };

    // Add development details
    if (process.env.NODE_ENV === 'development') {
      errorResponse.details = error.message;
      errorResponse.stack = error.stack;
    }

    // Rate limit specific error
    if (statusCode === 429) {
      errorResponse.retryAfter = error.retryAfter || 60;
    }

    res.status(statusCode).json(errorResponse);
  };
}

/**
 * Coordinate validation utility
 */
function validateCoordinates(lat, lng) {
  const errors = [];
  
  if (!lat || !lng) {
    errors.push('Both latitude and longitude are required');
    return { isValid: false, errors };
  }
  
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  
  if (isNaN(latitude) || isNaN(longitude)) {
    errors.push('Coordinates must be valid numbers');
    return { isValid: false, errors };
  }
  
  if (latitude < -90 || latitude > 90) {
    errors.push('Latitude must be between -90 and 90 degrees');
  }
  
  if (longitude < -180 || longitude > 180) {
    errors.push('Longitude must be between -180 and 180 degrees');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    coordinates: { latitude, longitude }
  };
}

module.exports = {
  WEATHER_CONFIG,
  createRateLimitMiddleware,
  securityHeadersMiddleware,
  fetchPaddlingLocations,
  validateAndSanitizeWeatherData,
  createAPIErrorHandler,
  validateCoordinates
};
