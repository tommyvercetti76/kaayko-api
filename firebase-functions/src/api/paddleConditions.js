//  functions/src/api/paddleConditions.js
//
//  Streamlined paddle conditions API - leverages WeatherAPI fully
//  Eliminates redundant calculations by using API's marine and weather data
//

const express = require('express');
const router = express.Router();
const https = require('https');
const { createRateLimitMiddleware, validateCoordinates } = require('../utils/sharedWeatherUtils');
const { WEATHER_CONFIG } = require('../config/weatherConfig');

// Production-ready input validation and safety
function validateAndSanitizeInput(lat, lng, location) {
  const errors = [];
  
  if (location) {
    // Location name validation
    if (typeof location !== 'string' || location.trim().length === 0) {
      errors.push('Location name must be a non-empty string');
    }
    if (location.length > 100) {
      errors.push('Location name too long (max 100 characters)');
    }
    return { isValid: errors.length === 0, errors, sanitized: location.trim().slice(0, 100) };
  }
  
  if (!lat || !lng) {
    errors.push('Both latitude and longitude are required');
    return { isValid: false, errors };
  }
  
  // Type and range validation
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  
  if (isNaN(latitude) || isNaN(longitude)) {
    errors.push('Coordinates must be valid numbers');
    return { isValid: false, errors };
  }
  
  // Strict range validation
  if (latitude < -90 || latitude > 90) {
    errors.push('Latitude must be between -90 and 90 degrees');
  }
  if (longitude < -180 || longitude > 180) {
    errors.push('Longitude must be between -180 and 180 degrees');
  }
  
  // Round coordinates for cache efficiency and consistency
  const precision = Math.pow(10, WEATHER_CONFIG.COORDINATE_PRECISION);
  const roundedLat = Math.round(latitude * precision) / precision;
  const roundedLng = Math.round(longitude * precision) / precision;
  
  return {
    isValid: errors.length === 0,
    errors,
    coordinates: { latitude: roundedLat, longitude: roundedLng },
    cacheKey: `${roundedLat},${roundedLng}`
  };
}

// Apply enhanced rate limiting with caching
router.use(createRateLimitMiddleware(20, 60000)); // Reduced to 20/min for production

// In-memory cache for production performance
const responseCache = new Map();
const requestLogs = [];

// Production logging for ML and debugging
function logRequest(req, response, processingTime, error = null) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    query: req.query,
    processingTimeMs: processingTime,
    success: !error,
    error: error?.message,
    responseSize: JSON.stringify(response || {}).length,
    cacheHit: response?._cacheHit || false
  };
  
  requestLogs.push(logEntry);
  
  // Keep only last 1000 logs in memory
  if (requestLogs.length > 1000) {
    requestLogs.shift();
  }
  
  // In production, you'd send this to your logging service
  if (process.env.NODE_ENV === 'production') {
    console.log('PaddleConditions Request:', JSON.stringify(logEntry));
  }
}

// Enhanced cache management
function getCachedResponse(cacheKey) {
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < WEATHER_CONFIG.CACHE_DURATION * 1000) {
    cached.response._cacheHit = true;
    return cached.response;
  }
  return null;
}

function setCachedResponse(cacheKey, response) {
  responseCache.set(cacheKey, {
    timestamp: Date.now(),
    response: { ...response }
  });
  
  // Cleanup old cache entries
  if (responseCache.size > 500) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
}

/**
 * Fetch weather data with marine forecast if available
 * @param {string} query - Either "lat,lng" coordinates or location name
 */
async function fetchCompleteWeatherData(query) {
  const queries = [
    `${WEATHER_CONFIG.CURRENT_URL}?key=${WEATHER_CONFIG.API_KEY.value()}&q=${encodeURIComponent(query)}&aqi=yes`,
    `${WEATHER_CONFIG.MARINE_URL}?key=${WEATHER_CONFIG.API_KEY.value()}&q=${encodeURIComponent(query)}&days=1&tides=yes`
  ];

  console.log('Weather API Key being used:', WEATHER_CONFIG.API_KEY.value() ? WEATHER_CONFIG.API_KEY.value().substring(0, 8) + '...' : 'UNDEFINED');
  console.log('Weather URLs:', queries);

  const results = await Promise.allSettled(
    queries.map(url => 
      new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: WEATHER_CONFIG.TIMEOUT }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                console.error('Weather API Error:', parsed.error);
                resolve(null);
              } else {
                resolve(parsed);
              }
            } catch (e) {
              console.error('JSON Parse Error:', e);
              resolve(null);
            }
          });
        });
        req.on('error', (err) => {
          console.error('HTTP Request Error:', err);
          resolve(null);
        });
        req.on('timeout', () => {
          console.error('HTTP Request Timeout');
          resolve(null);
        });
      })
    )
  );

  return {
    current: results[0].status === 'fulfilled' ? results[0].value : null,
    marine: results[1].status === 'fulfilled' ? results[1].value : null
  };
}

/**
 * Simple Beaufort scale mapping
 */
function getBeaufortScale(windKph) {
  if (windKph < 1) return 0;
  if (windKph < 6) return 1;
  if (windKph < 12) return 2;
  if (windKph < 20) return 3;
  if (windKph < 29) return 4;
  if (windKph < 39) return 5;
  if (windKph < 50) return 6;
  if (windKph < 62) return 7;
  if (windKph < 75) return 8;
  return windKph < 89 ? 9 : 10; // Cap at 10 for safety
}

/**
 * Generate paddle rating based on key factors
 */
function calculatePaddleRating(weather, marine) {
  const { current } = weather;
  let rating = 5;
  const warnings = [];
  const recommendations = [];

  // Wind conditions (primary safety factor)
  const beaufort = getBeaufortScale(current.wind_kph);
  if (beaufort >= 6) {
    warnings.push("Strong winds - dangerous conditions");
    rating = Math.min(rating, 1);
  } else if (beaufort >= 4) {
    warnings.push("Moderate winds - experienced paddlers only");
    rating = Math.min(rating, 3);
  }

  // Temperature comfort
  if (current.temp_c < 5) {
    warnings.push("Very cold - hypothermia risk");
    rating = Math.min(rating, 2);
  } else if (current.temp_c > 35) {
    warnings.push("Extreme heat - heat exhaustion risk");
    rating = Math.min(rating, 2);
  }

  // Visibility safety
  if (current.vis_km < 2) {
    warnings.push("Poor visibility - unsafe");
    rating = Math.min(rating, 2);
  }

  // Precipitation
  if (current.precip_mm > 5) {
    warnings.push("Heavy rain - poor conditions");
    rating = Math.min(rating, 3);
  }

  // Marine conditions (if available)
  if (marine?.forecast?.forecastday?.[0]?.hour?.[0]) {
    const marineHour = marine.forecast.forecastday[0].hour[0];
    
    if (marineHour.sig_ht_mt > 2) {
      warnings.push("Large waves - dangerous");
      rating = Math.min(rating, 1);
    }
    
    // Use actual water temperature if available
    if (marineHour.water_temp_c < 10) {
      warnings.push("Cold water - wetsuit required");
    }
  }

  // Add positive recommendations
  if (beaufort <= 2) recommendations.push("Light winds - ideal for beginners");
  if (current.temp_c >= 15 && current.temp_c <= 25) recommendations.push("Perfect temperature");
  if (current.vis_km >= 10) recommendations.push("Excellent visibility");

  const conditions = rating >= 4 ? "Excellent" : rating >= 3 ? "Good" : rating >= 2 ? "Fair" : "Poor";

  return { rating, conditions, warnings, recommendations, beaufortScale: beaufort };
}

/**
 * Main endpoint - production-ready paddle conditions
 * Supports both coordinates (?lat=40.7&lng=-74.0) and location names (?location=Antero Reservoir)
 */
router.get('/', async (req, res) => {
  const startTime = Date.now();
  const { lat, lng, location } = req.query;
  
  let queryString, cacheKey;
  
  try {
    // Enhanced input validation and sanitization
    if (location) {
      const validation = validateAndSanitizeInput(null, null, location);
      if (!validation.isValid) {
        return res.status(400).json({ 
          error: 'Invalid location parameter', 
          details: validation.errors,
          timestamp: new Date().toISOString()
        });
      }
      queryString = validation.sanitized;
      cacheKey = `loc:${queryString.toLowerCase()}`;
    } else if (lat && lng) {
      const validation = validateAndSanitizeInput(lat, lng);
      if (!validation.isValid) {
        return res.status(400).json({ 
          error: 'Invalid coordinates', 
          details: validation.errors,
          timestamp: new Date().toISOString()
        });
      }
      queryString = `${validation.coordinates.latitude},${validation.coordinates.longitude}`;
      cacheKey = `coord:${validation.cacheKey}`;
    } else {
      return res.status(400).json({ 
        error: 'Missing location parameters', 
        details: ['Provide either coordinates (?lat=40.7&lng=-74.0) or location name (?location=Antero Reservoir)'],
        examples: [
          '?lat=40.7128&lng=-74.0060',
          '?location=Antero Reservoir',
          '?location=Lake Tahoe',
          '?location=San Francisco Bay'
        ],
        timestamp: new Date().toISOString()
      });
    }

    // Check cache first
    const cachedResponse = getCachedResponse(cacheKey);
    if (cachedResponse) {
      logRequest(req, cachedResponse, Date.now() - startTime);
      return res.set('Cache-Control', `public, max-age=${WEATHER_CONFIG.CACHE_DURATION}`).json(cachedResponse);
    }

    const { current: weather, marine } = await fetchCompleteWeatherData(queryString);
    
    if (!weather?.current) {
      throw new Error('Weather data unavailable for this location');
    }

    const analysis = calculatePaddleRating(weather, marine);
    
    // Enhanced water body type detection using multiple strategies
    const locationName = weather.location.name.toLowerCase();
    const regionName = weather.location.region.toLowerCase();
    const queryLower = queryString.toLowerCase();
    
    let waterBodyType = 'unknown';
    let detectionSource = 'location_name';
    
    // Strategy 1: Check the original query string for water body indicators
    if (queryLower.includes('lake') || queryLower.includes('reservoir')) {
      waterBodyType = 'lake';
      detectionSource = 'query_string';
    } else if (queryLower.includes('river') || queryLower.includes('creek') || queryLower.includes('stream')) {
      waterBodyType = 'river';
      detectionSource = 'query_string';
    } else if (queryLower.includes('bay') || queryLower.includes('sound') || queryLower.includes('inlet') || queryLower.includes('harbor')) {
      waterBodyType = 'bay';
      detectionSource = 'query_string';
    } else if (queryLower.includes('ocean') || queryLower.includes('sea')) {
      waterBodyType = 'ocean';
      detectionSource = 'query_string';
    }
    // Strategy 2: Check location name from WeatherAPI
    else if (locationName.includes('lake') || locationName.includes('reservoir')) {
      waterBodyType = 'lake';
    } else if (locationName.includes('river') || locationName.includes('creek') || locationName.includes('stream')) {
      waterBodyType = 'river';
    } else if (locationName.includes('bay') || locationName.includes('sound') || locationName.includes('inlet') || locationName.includes('harbor')) {
      waterBodyType = 'bay';
    } else if (locationName.includes('ocean') || locationName.includes('sea') || regionName.includes('coast')) {
      waterBodyType = 'ocean';
    } else if (locationName.includes('pond') || locationName.includes('lagoon') || locationName.includes('canal')) {
      waterBodyType = 'other';
    }
    // Strategy 3: Geographic inference based on coordinates and known patterns
    else {
      const lat = weather.location.lat;
      const lng = weather.location.lon;
      
      // Known water body coordinate patterns (approximate)
      if ((lat >= 38.9 && lat <= 39.1 && lng >= -106.0 && lng <= -105.8)) {
        waterBodyType = 'lake'; // Antero Reservoir area
        detectionSource = 'coordinate_inference';
      } else if ((lat >= 47.9 && lat <= 48.2 && lng >= -124.0 && lng <= -123.7)) {
        waterBodyType = 'lake'; // Lake Crescent area
        detectionSource = 'coordinate_inference';
      } else if ((lat >= 38.5 && lat <= 38.7 && lng >= -109.7 && lng <= -109.4)) {
        waterBodyType = 'river'; // Colorado River area
        detectionSource = 'coordinate_inference';
      } else if ((lat >= 21.0 && lat <= 21.3 && lng >= 78.9 && lng <= 79.2)) {
        waterBodyType = 'lake'; // Ambazari Lake area
        detectionSource = 'coordinate_inference';
      }
    }
    
    const isCoastal = waterBodyType === 'ocean' || waterBodyType === 'bay' || regionName.includes('coast');
    const isProtectedWater = waterBodyType === 'lake' || waterBodyType === 'river' || locationName.includes('protected');
    
    // Build comprehensive response matching README structure
    const response = {
      location: {
        name: weather.location.name,
        region: weather.location.region,
        country: weather.location.country,
        fullName: `${weather.location.name}, ${weather.location.region}, ${weather.location.country}`,
        displayName: `${weather.location.name}, ${weather.location.region}`,
        coordinates: { 
          latitude: weather.location.lat, 
          longitude: weather.location.lon 
        },
        timeZone: weather.location.tz_id,
        localTime: weather.location.localtime,
        waterBodyType: waterBodyType
      },
      
      weather: {
        temperature: {
          celsius: weather.current.temp_c,
          fahrenheit: weather.current.temp_f,
          feelsLikeC: weather.current.feelslike_c,
          feelsLikeF: weather.current.feelslike_f
        },
        wind: {
          speedMPH: weather.current.wind_mph,
          speedKPH: weather.current.wind_kph,
          gustMPH: weather.current.gust_mph,
          gustKPH: weather.current.gust_kph,
          direction: weather.current.wind_dir,
          degree: weather.current.wind_degree
        },
        atmospheric: {
          pressureMB: weather.current.pressure_mb,
          pressureIN: weather.current.pressure_in,
          humidity: weather.current.humidity,
          visibilityKM: weather.current.vis_km,
          visibilityMiles: weather.current.vis_miles,
          cloudCover: weather.current.cloud
        },
        comfort: {
          windchillC: weather.current.windchill_c,
          windchillF: weather.current.windchill_f,
          heatIndexC: weather.current.heatindex_c,
          heatIndexF: weather.current.heatindex_f,
          dewpointC: weather.current.dewpoint_c,
          dewpointF: weather.current.dewpoint_f
        },
        precipitation: {
          amountMM: weather.current.precip_mm,
          amountIN: weather.current.precip_in
        },
        solar: {
          uvIndex: weather.current.uv,
          isDay: weather.current.is_day === 1
        },
        condition: {
          text: weather.current.condition.text,
          code: weather.current.condition.code,
          icon: weather.current.condition.icon
        }
      },

      waterConditions: {
        estimatedWaveHeightM: marine?.forecast?.forecastday?.[0]?.hour?.[0]?.sig_ht_mt || 
                              (weather.current.wind_kph > 15 ? Math.min(weather.current.wind_kph * 0.04, 3.0) : 0.2),
        estimatedWaterTempC: marine?.forecast?.forecastday?.[0]?.hour?.[0]?.water_temp_c || 
                             Math.max(2, weather.current.temp_c - (waterBodyType === 'lake' ? 3 : waterBodyType === 'river' ? 2 : 6)),
        estimatedWaterTempF: marine?.forecast?.forecastday?.[0]?.hour?.[0]?.water_temp_f || 
                             Math.max(36, weather.current.temp_f - (waterBodyType === 'lake' ? 5 : waterBodyType === 'river' ? 4 : 11)),
        waterFlow: waterBodyType === 'river' ? 'moderate' : 'minimal',
        isCoastal: isCoastal,
        isProtectedWater: isProtectedWater,
        detectionMethod: detectionSource,
        // Include tide data if available for coastal locations
        ...(marine?.forecast?.forecastday?.[0]?.tides && {
          tideData: marine.forecast.forecastday[0].tides
        })
      },

      paddleAnalysis: {
        beaufortScale: analysis.beaufortScale,
        conditions: analysis.conditions,
        rating: analysis.rating,
        warnings: analysis.warnings,
        recommendations: analysis.recommendations
      },

      // Include air quality if available
      ...(weather.current.air_quality && {
        airQuality: {
          usEpaIndex: weather.current.air_quality.us_epa_index,
          gbDefraIndex: weather.current.air_quality.gb_defra_index,
          co: weather.current.air_quality.co,
          no2: weather.current.air_quality.no2,
          o3: weather.current.air_quality.o3,
          so2: weather.current.air_quality.so2,
          pm2_5: weather.current.air_quality.pm2_5,
          pm10: weather.current.air_quality.pm10
        }
      }),

      metadata: {
        lastUpdated: new Date().toISOString(),
        dataSource: 'WeatherAPI.com',
        version: '2.0.0',
        cacheExpiry: new Date(Date.now() + WEATHER_CONFIG.CACHE_DURATION * 1000).toISOString(),
        processingTimeMs: Date.now() - startTime,
        dataStatus: weather?.current ? 'complete' : 'partial',
        apiStatus: 'healthy',
        cacheHit: false,
        coordinatePrecision: WEATHER_CONFIG.COORDINATE_PRECISION,
        requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      }
    };

    // Cache the response
    setCachedResponse(cacheKey, response);
    
    // Log successful request
    logRequest(req, response, Date.now() - startTime);

    res.set('Cache-Control', `public, max-age=${WEATHER_CONFIG.CACHE_DURATION}`);
    res.json(response);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('Paddle conditions error:', error);
    
    const errorResponse = {
      error: 'Service unavailable',
      message: error.message,
      timestamp: new Date().toISOString(),
      processingTimeMs: processingTime,
      requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    
    // Log failed request
    logRequest(req, null, processingTime, error);
    
    res.status(500).json(errorResponse);
  }
});

/**
 * GET /summary - Public simplified paddle summary (limited data)
 */
router.get('/summary', async (req, res) => {
  const startTime = Date.now();
  const { lat, lng, location } = req.query;
  
  let queryString, cacheKey;
  
  try {
    // Enhanced input validation and sanitization
    if (location) {
      const validation = validateAndSanitizeInput(null, null, location);
      if (!validation.isValid) {
        return res.status(400).json({ 
          error: 'Invalid location parameter', 
          details: validation.errors,
          timestamp: new Date().toISOString()
        });
      }
      queryString = validation.sanitized;
      cacheKey = `summary:loc:${queryString.toLowerCase()}`;
    } else if (lat && lng) {
      const validation = validateAndSanitizeInput(lat, lng);
      if (!validation.isValid) {
        return res.status(400).json({ 
          error: 'Invalid coordinates', 
          details: validation.errors,
          timestamp: new Date().toISOString()
        });
      }
      queryString = `${validation.coordinates.latitude},${validation.coordinates.longitude}`;
      cacheKey = `summary:coord:${validation.cacheKey}`;
    } else {
      return res.status(400).json({ 
        error: 'Missing location parameters', 
        details: ['Provide either coordinates (?lat=40.7&lng=-74.0) or location name (?location=Lake Name)'],
        timestamp: new Date().toISOString()
      });
    }

    // Check cache first
    const cachedResponse = getCachedResponse(cacheKey);
    if (cachedResponse) {
      logRequest(req, cachedResponse, Date.now() - startTime);
      return res.set('Cache-Control', `public, max-age=${WEATHER_CONFIG.CACHE_DURATION}`).json(cachedResponse);
    }

    const { current: weather, marine } = await fetchCompleteWeatherData(queryString);
    
    if (!weather?.current) {
      throw new Error('Weather data unavailable');
    }

    const analysis = calculatePaddleRating(weather, marine);
    
    // Simple water body detection for public endpoint
    const queryLower = queryString.toLowerCase();
    let waterBodyType = 'unknown';
    if (queryLower.includes('lake') || queryLower.includes('reservoir')) {
      waterBodyType = 'lake';
    } else if (queryLower.includes('river') || queryLower.includes('creek')) {
      waterBodyType = 'river';
    } else if (queryLower.includes('bay') || queryLower.includes('sound')) {
      waterBodyType = 'bay';  
    } else if (queryLower.includes('ocean') || queryLower.includes('sea')) {
      waterBodyType = 'ocean';
    }
    
    // Simplified public response - hide detailed data
    const publicResponse = {
      location: {
        name: weather.location.name,
        region: weather.location.region,
        displayName: `${weather.location.name}, ${weather.location.region}`,
        waterBodyType: waterBodyType
      },
      
      conditions: {
        rating: analysis.rating,
        description: analysis.conditions,
        temperature: weather.current.temp_c + '°C',
        windSpeed: weather.current.wind_kph + ' km/h',
        windDirection: weather.current.wind_dir,
        beaufortScale: analysis.beaufortScale
      },

      paddleSummary: {
        recommended: analysis.rating >= 4,
        skillLevel: analysis.rating >= 4 ? 'Beginner' : analysis.rating >= 3 ? 'Intermediate' : 'Advanced',
        warnings: analysis.warnings.length > 0 ? ['Check conditions'] : [],
        uvLevel: weather.current.uv > 6 ? 'High' : weather.current.uv > 3 ? 'Moderate' : 'Low'
      },

      metadata: {
        lastUpdated: new Date().toISOString(),
        version: '1.0.0-public'
      }
    };

    // Cache the public response
    setCachedResponse(cacheKey, publicResponse);
    
    logRequest(req, publicResponse, Date.now() - startTime);
    res.set('Cache-Control', `public, max-age=${WEATHER_CONFIG.CACHE_DURATION}`);
    res.json(publicResponse);

  } catch (error) {
    logRequest(req, null, Date.now() - startTime, error);
    console.error('Paddle summary error:', error);
    res.status(500).json({ 
      error: 'Service unavailable',
      message: 'Unable to analyze paddle conditions',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Health check
 */
router.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    version: '2.0.0',
    description: 'Kaayko Paddle Conditions API',
    timestamp: new Date().toISOString(),
    endpoints: {
      public: [
        'GET /paddleConditions/summary - Simplified paddle conditions',
        'GET /paddleConditions/health - API status'
      ],
      private: [
        'GET /paddleConditions - Full analysis (internal use)'
      ]
    },
    publicFeatures: [
      'Basic weather analysis',
      'Safety ratings (1-5)',
      'Simplified recommendations',
      'Water body type detection'
    ]
  });
});

module.exports = router;
