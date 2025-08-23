// File: functions/src/api/paddleScore.js
//
// 🏄 PADDLE SCORE API - ML-Powered Condition Rating
//
// Returns paddle score (1-5) for any location based on current weather conditions
// Uses production ML model for real predictions

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const UnifiedWeatherService = require('../services/unifiedWeatherService');
const { getPrediction } = require('../services/mlService');
const { applyEnhancedPenalties } = require('../utils/paddlePenalties');
const { standardizeForMLModel, standardizeForPenalties } = require('../utils/dataStandardization');
const { createInputMiddleware } = require('../utils/inputStandardization');

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

    console.log(`🏄 PaddleScore: ${locationQuery}`);

    // Get current weather AND marine data
    const weatherService = new UnifiedWeatherService();
    const weatherData = await weatherService.getWeatherData(locationQuery, {
      includeForecast: false,
      useCache: true
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

    // Extract features for ML model with marine data integration
    const current = weatherData.current;
    const marineHour = marineData?.forecast?.forecastday?.[0]?.hour?.[0];
    
    // Standardize all data for consistent ML model input
    const mlFeatures = standardizeForMLModel({
      temperature: current.temperature?.celsius,
      windSpeed: current.wind?.speedMPH || current.windSpeed,
      gustSpeed: current.wind?.gustMPH || (current.wind?.speedMPH * 1.3),
      windDirection: current.wind?.direction || current.windDirection,
      humidity: current.atmospheric?.humidity || current.humidity,
      cloudCover: current.atmospheric?.cloudCover || current.cloudCover,
      uvIndex: current.solar?.uvIndex || current.uvIndex,
      visibility: current.atmospheric?.visibility || current.visibility,
      hasWarnings: current.hasWarnings,
      latitude: locationData.coordinates.latitude,
      longitude: locationData.coordinates.longitude
    }, marineData);

    // Get ML prediction from production service
    console.log('🔥 TEMPERATURE DEBUG - Standardized temperature data:', {
      rawCelsius: current.temperature?.celsius,
      rawFahrenheit: current.temperature?.fahrenheit,
      standardizedTemp: mlFeatures.temperature
    });
    console.log('� WIND DEBUG - Standardized wind data:', {
      rawWindMPH: current.wind?.speedMPH,
      rawWindSpeed: current.windSpeed,
      standardizedWindMPH: mlFeatures.windSpeed
    });
    console.log('📊 Standardized ML Features:', JSON.stringify(mlFeatures, null, 2));
    
    let prediction = await getPrediction(mlFeatures);
    
    console.log('🎯 ML Prediction received:', JSON.stringify(prediction, null, 2));
    console.log('📈 Original ML rating before penalties:', prediction.rating);
    
    // ENFORCE 0.5 INCREMENT RULE AND APPLY CONSISTENT PENALTIES
    const penaltyFeatures = standardizeForPenalties({
      temperature: current.temperature?.celsius,
      windSpeed: current.wind?.speedMPH || current.windSpeed,
      gustSpeed: current.wind?.gustMPH || (current.wind?.speedMPH * 1.3),
      windDirection: current.wind?.direction || current.windDirection,
      humidity: current.atmospheric?.humidity || current.humidity,
      cloudCover: current.atmospheric?.cloudCover || current.cloudCover,
      uvIndex: current.solar?.uvIndex || current.uvIndex,
      visibility: current.atmospheric?.visibility || current.visibility,
      hasWarnings: current.hasWarnings,
      latitude: locationData.coordinates.latitude,
      longitude: locationData.coordinates.longitude
    }, marineData);
    
    prediction = applyEnhancedPenalties(prediction, penaltyFeatures, marineData);
    
    if (!prediction.success) {
      return res.status(500).json({
        success: false,
        error: 'ML prediction failed',
        details: prediction.error || 'Unknown error'
      });
    }

    // Build response with penalty details
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
        // Show penalty details
        originalRating: prediction.originalRating,
        penalties: prediction.penaltiesApplied || [],
        totalPenalty: prediction.totalPenalty || 0,
        roundedTo05Increments: prediction.roundedTo05Increments || false
      },
      conditions: {
        temperature: mlFeatures.temperature,
        windSpeed: mlFeatures.windSpeed,
        beaufortScale: mlFeatures.beaufortScale,
        uvIndex: mlFeatures.uvIndex,
        visibility: mlFeatures.visibility,
        humidity: mlFeatures.humidity,
        cloudCover: mlFeatures.cloudCover,
        hasWarnings: mlFeatures.hasWarnings,
        // Marine conditions
        waveHeight: mlFeatures.waveHeight,
        waterTemp: mlFeatures.waterTemp,
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
