// File: functions/src/api/paddleScore.js
//
// 🏄 PADDLE SCORE API - ML-Powered Condition Rating
//
// Returns paddle score (1-5) for any location based on current weather conditions
// Uses production ML model for real predictions

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const UnifiedWeatherService = require('./unifiedWeatherService');
const { getPrediction } = require('./mlService');
const { standardizeForMLModel, standardizeForPenalties } = require('./dataStandardization');
const { createInputMiddleware } = require('./inputStandardization');
const { calibrateModelPrediction } = require('./modelCalibration');
const { getSmartWarnings } = require('./smartWarnings');
const ForecastCache = require('../../cache/forecastCache');

const db = admin.firestore();

/**
 * 🏄 GET /paddleScore
 * Get ML-powered paddle score for any location
 * 
 * Standardized Input Parameters:
 * - lat & lng: Separate latitude/longitude coordinates  
 * - location: Combined "lat,lng" coordinates
 * - spotId: Known paddling spot ID (for fastest response)
 * 
 * Examples:
 * - /paddleScore?lat=42.3601&lng=-71.0589
 * - /paddleScore?location=42.3601,-71.0589
 * - /paddleScore?spotId=merrimack
 */
router.get('/', createInputMiddleware('paddleScore'), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { latitude, longitude, spotId } = req.standardizedInputs;
    
    let locationQuery;
    let locationData;
    
    // Determine location source
    if (spotId) {
      // Get coordinates from known spotId
      const spot = await getLocationFromSpotId(spotId);
      if (!spot) {
        return res.status(404).json({
          success: false,
          error: 'Paddling spot not found',
          spotId,
          available_via: '/paddlingOut'
        });
      }
      locationQuery = `${spot.coordinates.latitude},${spot.coordinates.longitude}`;
      locationData = spot;
      
    } else {
      // Use provided coordinates
      locationQuery = `${latitude},${longitude}`;
      locationData = {
        name: `Location ${latitude}, ${longitude}`,
        coordinates: { latitude, longitude }
      };
    }

    console.log(`PaddleScore request: ${locationQuery}`);

    // Check cache first for known locations (from scheduled jobs)
    const cache = new ForecastCache();
    const cacheKey = `current_${locationQuery.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const cachedConditions = await cache.getCachedCurrentConditions(cacheKey);
    
    if (cachedConditions) {
      console.log(`Cache hit - returning cached current conditions (${cachedConditions.metadata.cacheAgeMinutes.toFixed(1)} min old)`);
      return res.json({
        success: true,
        ...cachedConditions,
        location: locationData,
        response_time_ms: Date.now() - startTime
      });
    }

    // Cache miss - fetch fresh data
    console.log(`Cache miss - fetching fresh current conditions`);
    const weatherService = new UnifiedWeatherService();
    const weatherData = await weatherService.getWeatherData(locationQuery, {
      includeForecast: false,
      useCache: false // Don't use weather service cache, we have our own
    });
    
    // Get marine data for wave height (critical for paddle conditions)
    let marineData = null;
    try {
      const marineResponse = await weatherService.getMarineData(locationQuery);
      marineData = marineResponse;
      console.log('🌊 Marine data retrieved:', marineData?.forecast ? 'Available' : 'Not available');
    } catch (marineError) {
      console.log('ℹ️ Marine data not available for this location (likely inland)');
    }
    
    if (!weatherData?.current) {
      return res.status(500).json({
        success: false,
        error: 'Failed to get weather data',
        location: locationQuery
      });
    }

    // Standardize weather data for ML model input
    const current = weatherData.current;
    const marineHour = marineData?.forecast?.forecastday?.[0]?.hour?.[0];
    
    // Create standardized input for ML model
    const rawInput = {
      temperature: current.temperature?.celsius,
      windSpeed: current.wind?.speedMPH,
      windSpeedKph: current.wind?.speedKPH,
      gustSpeed: current.wind?.gustMPH,
      gustSpeedKph: current.wind?.gustKPH,
      windDirection: current.wind?.direction,
      humidity: current.atmospheric?.humidity,
      cloudCover: current.atmospheric?.cloudCover,
      uvIndex: current.solar?.uvIndex,
      visibility: current.atmospheric?.visibility,
      hasWarnings: current.hasWarnings,
      latitude: latitude,
      longitude: longitude
    };
    
    const mlInputData = standardizeForMLModel(rawInput, marineData);

    // Get ML prediction from production v3 model service
    console.log('🔥 SENDING STANDARDIZED DATA to v3 ML model:', {
      temperature: mlInputData.temperature,
      windSpeed: mlInputData.windSpeed,
      latitude: mlInputData.latitude,
      longitude: mlInputData.longitude
    });
    
    let prediction = await getPrediction(mlInputData);
    
    console.log('🎯 ML Prediction received:', JSON.stringify(prediction, null, 2));
    console.log('📈 Base ML rating:', prediction.rating);
    
    // Apply model calibration based on real-world conditions and forecast
    const calibratedPrediction = calibrateModelPrediction(
      prediction.rating,
      {
        temperature: mlInputData.temperature,
        windSpeed: mlInputData.windSpeed,
        gustSpeed: mlInputData.gustSpeed,
        humidity: mlInputData.humidity,
        cloudCover: mlInputData.cloudCover,
        uvIndex: mlInputData.uvIndex,
        visibility: mlInputData.visibility
      },
      weatherData.forecast,
      { latitude, longitude }
    );
    
    console.log('🔧 Model calibration applied:', JSON.stringify(calibratedPrediction, null, 2));
    
    // Use calibrated rating for final prediction
    prediction.rating = calibratedPrediction.calibratedRating;
    prediction.originalMLRating = calibratedPrediction.originalRating;
    prediction.calibrationApplied = true;
    prediction.adjustments = calibratedPrediction.adjustments;
    
    if (!prediction.success) {
      return res.status(500).json({
        success: false,
        error: 'ML prediction failed',
        details: prediction.error || 'Unknown error'
      });
    }

    // Generate smart warnings based on actual weather conditions
    const smartWarnings = getSmartWarnings(
      {
        temperature: mlInputData.temperature,
        windSpeed: mlInputData.windSpeed,
        gustSpeed: mlInputData.gustSpeed,
        humidity: mlInputData.humidity,
        cloudCover: mlInputData.cloudCover,
        uvIndex: mlInputData.uvIndex,
        visibility: mlInputData.visibility,
        waterTemp: marineHour?.water_temp_c || (mlInputData.temperature - 8)
      },
      weatherData,
      { latitude, longitude }
    );
    
    console.log('🚨 Smart warnings generated:', smartWarnings);

    // Build response with detailed penalty breakdown
    const response = {
      success: true,
      location: {
        name: locationData.name,
        coordinates: locationData.coordinates,
        region: weatherData.location?.region,
        country: weatherData.location?.country
      },
      paddleScore: {
        rating: prediction.rating,
        interpretation: getInterpretation(prediction.rating),
        confidence: prediction.confidence || 'high',
        mlModelUsed: prediction.mlModelUsed,
        predictionSource: prediction.predictionSource,
        modelType: prediction.modelType,
        // Model calibration details
        originalMLRating: prediction.originalMLRating,
        calibrationApplied: prediction.calibrationApplied,
        adjustments: prediction.adjustments,
        isGoldStandard: true,
        v3ModelUsed: true
      },
      warnings: {
        hasWarnings: smartWarnings.length > 0,
        count: smartWarnings.length,
        messages: smartWarnings,
        // Legacy compatibility for iOS
        warningType: smartWarnings.length > 0 ? 'weather' : null
      },
      conditions: {
        temperature: current.temperature?.celsius,
        windSpeed: current.wind?.speedMPH || current.windSpeed,
        beaufortScale: Math.min(Math.floor((current.wind?.speedMPH || current.windSpeed || 0) / 3), 12),
        uvIndex: current.solar?.uvIndex || current.uvIndex,
        visibility: current.atmospheric?.visibility || current.visibility,
        humidity: current.atmospheric?.humidity || current.humidity,
        cloudCover: current.atmospheric?.cloudCover || current.cloudCover,
        hasWarnings: current.hasWarnings,
        // Marine conditions from direct data
        marineDataAvailable: !!marineData,
        // Detailed marine data if available
        ...(marineData && {
          marine: {
            waveHeight: marineHour?.sig_ht_mt || null,
            swellHeight: marineHour?.swell_ht_mt || null, 
            swellDirection: marineHour?.swell_dir || null,
            swellPeriod: marineHour?.swell_period_secs || null,
            waterTemp: marineHour?.water_temp_c || null,
            tides: marineData?.forecast?.forecastday?.[0]?.astro ? {
              sunrise: marineData.forecast.forecastday[0].astro.sunrise,
              sunset: marineData.forecast.forecastday[0].astro.sunset,
              moonPhase: marineData.forecast.forecastday[0].astro.moon_phase
            } : null,
            rawMarineHour: marineHour // Full marine data object
          }
        })
      },
      metadata: {
        source: prediction.predictionSource,
        modelType: prediction.modelType,
        timestamp: new Date().toISOString(),
        response_time_ms: Date.now() - startTime
      }
    };

    // Cache the response for 20 minutes (fire and forget)
    cache.storeCurrentConditions(cacheKey, response).catch(err => 
      console.warn(`Failed to cache current conditions: ${err.message}`)
    );

    res.json(response);
    
  } catch (error) {
    console.error('PaddleScore error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      details: error.message,
      response_time_ms: Date.now() - startTime
    });
  }
});

/**
 * 📍 Get location from spotId
 */
async function getLocationFromSpotId(spotId) {
  try {
    const doc = await db.collection('paddlingSpots').doc(spotId).get();
    
    if (!doc.exists) return null;
    
    const data = doc.data();
    
    if (data.location?.latitude && data.location?.longitude) {
      return {
        name: data.lakeName || spotId,
        coordinates: {
          latitude: data.location.latitude,
          longitude: data.location.longitude
        }
      };
    }
    
    return null;
    
  } catch (error) {
    console.error(`Failed to get location for ${spotId}:`, error);
    return null;
  }
}

/**
 * 🎯 Interpret rating
 */
function getInterpretation(rating) {
  if (rating >= 4.5) return 'Excellent - Perfect paddling conditions';
  if (rating >= 4.0) return 'Great - Very good conditions';
  if (rating >= 3.5) return 'Good - Favorable conditions';
  if (rating >= 3.0) return 'Fair - Decent conditions';
  if (rating >= 2.5) return 'Below Average - Challenging conditions';
  if (rating >= 2.0) return 'Poor - Difficult conditions';
  return 'Very Poor - Not recommended';
}

module.exports = router;

module.exports = router;
