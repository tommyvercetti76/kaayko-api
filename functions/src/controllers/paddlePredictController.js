// File: functions/src/controllers/paddlePredictController.js

const cache = require('../utils/cache');
const { WEATHER_CONFIG } = require('../config/weatherConfig');
const weatherService = require('../services/weatherService');
const mlService = require('../services/mlService');
const enhancementService = require('../services/enhancementService');

// ML Configuration
const ML_CONFIG = {
  MODEL_VERSION: 'kaayko_production_v2.1',
  FEATURES: [
    'temperature', 'windSpeed', 'hasWarnings', 'beaufortScale', 
    'uvIndex', 'visibility', 'humidity', 'cloudCover', 
    'latitude', 'longitude'
  ],
  OUTPUT: {
    range: [1.0, 5.0],
    type: 'paddle_rating'
  },
  TRAINING: {
    samples: 12000,
    lakes: 17,
    accuracy: 0.9956
  }
};

/**
 * GET /paddlePredict
 */
async function getPrediction(req, res) {
  const start = Date.now();
  const { lat, lng, location } = req.validated;

  const key = location
    ? `loc:${location.trim().toLowerCase()}`
    : `coord:${parseFloat(lat).toFixed(WEATHER_CONFIG.COORDINATE_PRECISION)},${parseFloat(lng).toFixed(WEATHER_CONFIG.COORDINATE_PRECISION)}`;

  // Check persistent cache (async)
  const cached = await cache.get(key);
  if (cached) {
    console.log(`🎯 Cache HIT for ${key} (persistent cache)`);
    cached.metadata.cached = true;
    cached.metadata.processingTimeMs = Date.now() - start;
    return res.json(cached);
  }

  console.log(`❌ Cache MISS for ${key} - generating new prediction`);

  try {
    const query = location ? location.trim() : key.split(':')[1];
    const weather = await weatherService.fetchAndCacheWeather(query);
    const features = mlService.extractMLFeatures(weather);
    const mlResult = await mlService.getPrediction(features);
    const interpretation = mlService.interpretRating(mlResult.rating, features);

    const response = {
      success: true,
      location: {
        name: weather.location.name,
        region: weather.location.region,
        country: weather.location.country,
        coordinates: { latitude: weather.location.lat, longitude: weather.location.lon },
        timeZone: weather.location.tz_id,
        localTime: weather.location.localtime
      },
      prediction: {
        rating: mlResult.rating,
        mlModelUsed: mlResult.mlModelUsed,
        predictionSource: mlResult.predictionSource,
        interpretation,
        confidence: mlResult.confidence
      },
      features: {
        input: features,
        explanation: {
          temperature: `${features.temperature}°C`,
          windSpeed: `${features.windSpeed} km/h`,
          hasWarnings: features.hasWarnings ? 'Yes' : 'No',
          beaufortScale: `${features.beaufortScale}/12`,
          uvIndex: `${features.uvIndex}`,
          visibility: `${features.visibility} km`
        }
      },
      weather: {
        temperature: {
          celsius: weather.current.temp_c,
          fahrenheit: weather.current.temp_f,
          feelsLike: weather.current.feelslike_c
        },
        wind: {
          speedKPH: weather.current.wind_kph,
          speedMPH: weather.current.wind_mph,
          direction: weather.current.wind_dir,
          gustKPH: weather.current.gust_kph
        },
        conditions: {
          text: weather.current.condition.text,
          icon: weather.current.condition.icon,
          visibility: weather.current.vis_km,
          uvIndex: weather.current.uv,
          humidity: weather.current.humidity
        }
      },
      metadata: {
        modelVersion: ML_CONFIG.MODEL_VERSION,
        apiVersion: '1.0.0',
        timestamp: new Date().toISOString(),
        processingTimeMs: Date.now() - start,
        cached: false,
        dataSource: 'WeatherAPI.com + ML Model'
      }
    };

    // Store in persistent cache (async - don't wait)
    cache.set(key, response, WEATHER_CONFIG.CACHE_DURATION).catch(err => 
      console.warn('Failed to cache response:', err)
    );
    
    console.log(`💾 Cached prediction for ${key} (${WEATHER_CONFIG.CACHE_DURATION}s TTL)`);
    res.json(response);
  } catch (error) {
    console.error('Prediction Error:', error);
    res.status(500).json({
      success: false,
      error: 'Prediction service unavailable',
      message: error.message,
      timestamp: new Date().toISOString(),
      processingTimeMs: Date.now() - start
    });
  }
}

/**
 * GET /paddlePredict/health
 */
function healthCheck(req, res) {
  res.json({
    status: 'healthy',
    service: 'paddlePredict',
    modelVersion: ML_CONFIG.MODEL_VERSION,
    timestamp: new Date().toISOString(),
    features: ML_CONFIG.FEATURES
  });
}

/**
 * GET /paddlePredict/model
 */
function modelInfo(req, res) {
  res.json({
    name: 'Paddle Conditions ML Model',
    version: ML_CONFIG.MODEL_VERSION,
    type: 'Random Forest Regressor',
    features: { count: ML_CONFIG.FEATURES.length, list: ML_CONFIG.FEATURES },
    output: ML_CONFIG.OUTPUT,
    training: ML_CONFIG.TRAINING,
    timestamp: new Date().toISOString()
  });
}

/**
 * POST /paddlePredict/enhance
 * Fetches data from paddlingReport API and enhances with ML predictions
 */
async function enhanceReports(req, res) {
  const start = Date.now();
  const { preferences } = req.validated;

  try {
    // Import and call paddlingReport function directly
    const paddlingReportModule = require('../api/paddlingReport');
    console.log('Fetching paddling reports from internal API...');
    
    // Call the internal paddlingReport function
    const paddlingReports = await callInternalPaddlingReport();
    
    if (!paddlingReports.success) {
      throw new Error('Failed to fetch paddling reports: ' + paddlingReports.error);
    }

    // Transform paddlingReport data to match enhance format
    const reports = paddlingReports.data.reports
      .filter(report => report.status === 'success' && report.conditions)
      .map(report => ({
        id: report.id,
        name: report.name,
        conditions: {
          temperature: report.conditions.temperature,
          windSpeed: report.conditions.windSpeed,
          beaufortScale: report.conditions.beaufortScale,
          uvIndex: report.conditions.uvIndex,
          visibility: report.conditions.visibility,
          warnings: report.conditions.warnings || []
        }
      }));

    console.log(`Enhancing ${reports.length} reports with ML predictions...`);
    
    // Enhance reports using the enhancement service
    const result = await enhancementService.enhanceReports(reports, preferences);
    
    return res.json({
      success: true,
      enhanced: true,
      source: 'internal paddlingReport API',
      originalCount: paddlingReports.data.reports.length,
      enhancedCount: reports.length,
      ...result,
      metadata: {
        ...result.metadata,
        processingTimeMs: Date.now() - start,
        dataSource: 'Internal PaddlingReport API + ML Enhancement'
      }
    });
    
  } catch (error) {
    console.error('Enhancement Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Enhancement service unavailable',
      message: error.message,
      timestamp: new Date().toISOString(),
      processingTimeMs: Date.now() - start
    });
  }
}

/**
 * Call internal paddlingReport function
 */
async function callInternalPaddlingReport() {
  const admin = require('firebase-admin');
  const { fetchPaddlingLocations } = require('../utils/sharedWeatherUtils');
  
  try {
    // Import the generatePaddlingReports function from paddlingReport
    const paddlingReportPath = require.resolve('../api/paddlingReport');
    delete require.cache[paddlingReportPath];
    
    // Call the internal function directly by importing the module
    const db = admin.firestore();
    const locations = await fetchPaddlingLocations(db);
    
    // Use the same logic as paddlingReport but call it directly
    const reports = [];
    const batchSize = 5; // Increased from 3 for better performance
    
    for (let i = 0; i < locations.length; i += batchSize) {
      const batch = locations.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (location) => {
        try {
          const https = require('https');
          const conditions = await new Promise((resolve, reject) => {
            const url = `https://api-vwcc5j4qda-uc.a.run.app/paddleConditions?lat=${location.coordinates.latitude}&lng=${location.coordinates.longitude}`;
            
            const req = https.get(url, { timeout: 6000 }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                try {
                  resolve(JSON.parse(data));
                } catch (error) {
                  reject(error);
                }
              });
            });
            
            req.on('error', reject);
            req.on('timeout', () => {
              req.destroy();
              reject(new Error('Timeout'));
            });
          });
          
          return {
            id: location.id,
            name: location.name,
            coordinates: location.coordinates,
            conditions: {
              rating: conditions.paddleAnalysis?.rating || 0,
              temperature: Math.round(conditions.weather?.temperature?.celsius || 0),
              windSpeed: Math.round(conditions.weather?.wind?.speedKPH || 0),
              beaufortScale: conditions.paddleAnalysis?.beaufortScale || 0,
              uvIndex: conditions.weather?.solar?.uvIndex || 0,
              visibility: conditions.weather?.atmospheric?.visibilityKM || 0,
              warnings: conditions.paddleAnalysis?.warnings || []
            },
            status: 'success'
          };
          
        } catch (error) {
          return {
            id: location.id,
            name: location.name,
            coordinates: location.coordinates,
            conditions: null,
            status: 'error',
            error: error.message
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      reports.push(...batchResults);
      
      // Small delay between batches
      if (i + batchSize < locations.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return {
      success: true,
      data: {
        reports,
        summary: {
          total: reports.length,
          successful: reports.filter(r => r.status === 'success').length,
          failed: reports.filter(r => r.status === 'error').length
        }
      }
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get 3-day forecast for heatmap visualization
 * Returns forecast data structured for the heatmap component
 */
async function getForecast(req, res) {
  const start = Date.now();
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: lat, lng'
    });
  }

  const key = `forecast:${parseFloat(lat).toFixed(4)},${parseFloat(lng).toFixed(4)}`;

  try {
    // Get weather forecast data (3 days)
    const query = `${lat},${lng}`;
    const weather = await weatherService.fetchAndCacheWeather(query);
    
    // Structure forecast data for heatmap (3 days x 3 time periods)
    const forecastData = [];
    
    for (let dayIndex = 0; dayIndex < 3; dayIndex++) {
      const dayData = weather.forecast?.forecastday?.[dayIndex];
      if (!dayData) continue;
      
      const hourlyData = {};
      
      // Generate predictions for ALL 24 HOURS (0-23) for detailed heatmap
      const allHours = Array.from({length: 24}, (_, i) => i); // [0, 1, 2, ..., 23]
      
      for (const hour of allHours) {
        const hourData = dayData.hour?.[hour] || {}; // Get actual hourly weather data
        
        // If no specific hour data, interpolate from available data
        const fallbackData = dayData.hour?.[12] || dayData.day || {};
        
        // Extract features for ML prediction
        const features = {
          temperature: hourData.temp_c || fallbackData.avgtemp_c || 20,
          windSpeed: hourData.wind_kph || fallbackData.maxwind_kph || 10,
          hasWarnings: weather.alerts?.alert?.length > 0 || false,
          beaufortScale: Math.min(Math.floor((hourData.wind_kph || fallbackData.maxwind_kph || 10) / 3.0), 12),
          uvIndex: hourData.uv || fallbackData.uv || 5,
          visibility: hourData.vis_km || 10,
          humidity: hourData.humidity || 50,
          cloudCover: hourData.cloud || 50,
          latitude: parseFloat(lat),
          longitude: parseFloat(lng)
        };
        
        // Generate CRITICAL SAFETY WARNINGS for paddle safety
        const warnings = [];
        const windKph = features.windSpeed;
        const gustKph = hourData.gust_kph || 0;
        const waterTemp = features.temperature; // Approximating water temp from air temp
        const airTemp = features.temperature;
        const visibility = features.visibility;
        const uvIndex = features.uvIndex;
        
        // 🌊 WATER TEMPERATURE WARNINGS (CRITICAL for hypothermia)
        if (waterTemp < 15) {
          warnings.push("DANGER: Cold water - hypothermia risk in minutes");
        } else if (waterTemp < 20) {
          warnings.push("WARNING: Cool water - wetsuit recommended");
        }
        
        // 💨 WIND & GUST WARNINGS (CRITICAL for paddle control)
        if (windKph > 25 || gustKph > 35) {
          warnings.push("DANGER: High winds - unsafe for all paddlers");
        } else if (windKph > 20 || gustKph > 30) {
          warnings.push("WARNING: Strong winds - experienced paddlers only");
        } else if (windKph > 15 || gustKph > 25) {
          warnings.push("CAUTION: Moderate winds - intermediate+ skills required");
        }
        
        // 🌫️ VISIBILITY WARNINGS (CRITICAL for navigation)
        if (visibility < 2) {
          warnings.push("DANGER: Very poor visibility - unsafe conditions");
        } else if (visibility < 5) {
          warnings.push("WARNING: Poor visibility - stay close to shore");
        } else if (visibility < 10) {
          warnings.push("CAUTION: Limited visibility - exercise caution");
        }
        
        // ☀️ UV INDEX WARNINGS (CRITICAL for sun exposure)
        if (uvIndex > 8) {
          warnings.push("DANGER: Extreme UV - severe burn risk");
        } else if (uvIndex > 6) {
          warnings.push("WARNING: High UV - sun protection essential");
        } else if (uvIndex > 4) {
          warnings.push("CAUTION: Moderate UV - use sun protection");
        }
        
        // 🌡️ AIR TEMPERATURE WARNINGS
        if (airTemp < 5) {
          warnings.push("DANGER: Extreme cold - hypothermia risk");
        } else if (airTemp > 35) {
          warnings.push("WARNING: Extreme heat - heat exhaustion risk");
        }
        
        // Get ML prediction
        const mlResult = await mlService.getPrediction(features);
        
        // APPLY SAFETY DEDUCTIONS: -0.5 for each warning
        let adjustedRating = mlResult.rating;
        const safetyDeduction = warnings.length * 0.5;
        adjustedRating = Math.max(1.0, adjustedRating - safetyDeduction);
        
        console.log(`⚠️ Safety check for hour ${hour}: ${warnings.length} warnings, deduction: -${safetyDeduction}, rating: ${mlResult.rating} → ${adjustedRating}`);
        
        // Store the prediction data
        hourlyData[hour] = {
          temperature: features.temperature,
          windSpeed: features.windSpeed,
          windDirection: hourData.wind_dir || 'N', // Add wind direction from weather API
          gustSpeed: gustKph,
          humidity: features.humidity,
          cloudCover: features.cloudCover,
          uvIndex: features.uvIndex,
          visibility: features.visibility,
          hasWarnings: warnings.length > 0,
          warnings: warnings, // Include actual warning messages
          beaufortScale: features.beaufortScale,
          
          // ML prediction results with safety adjustments
          prediction: {
            rating: adjustedRating,
            originalRating: mlResult.rating,
            safetyDeduction: safetyDeduction,
            mlModelUsed: mlResult.mlModelUsed,
            predictionSource: mlResult.predictionSource
          },
          
          // For backward compatibility
          originalRating: mlResult.rating,
          safetyDeduction: safetyDeduction,
          apiRating: adjustedRating,
          rating: adjustedRating,
          mlModelUsed: mlResult.mlModelUsed,
          predictionSource: mlResult.predictionSource
        };
      }
      
      forecastData.push({
        date: dayData.date,
        hourly: hourlyData
      });
    }

    const response = {
      success: true,
      location: {
        name: weather.location.name,
        region: weather.location.region,
        country: weather.location.country,
        coordinates: { latitude: weather.location.lat, longitude: weather.location.lon }
      },
      forecast: forecastData,
      metadata: {
        cached: false,
        processingTimeMs: Date.now() - start,
        mlServiceUrl: process.env.ML_SERVICE_URL || 'https://kaayko-ml-service-87383373015.us-central1.run.app',
        apiVersion: '2.0'
      }
    };

    res.json(response);
    
  } catch (error) {
    console.error(`Forecast error for ${key}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate forecast data',
      details: error.message
    });
  }
}

module.exports = { getPrediction, healthCheck, modelInfo, enhanceReports, getForecast };