// File: functions/src/api/forecast.js
//
// 🔒 INTERNAL FORECAST API - Used by scheduled jobs and premium users
//
// This generates comprehensive weather forecasts with ML predictions
// Results are cached for fastForecast API to serve to frontend

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const rateLimit = require('../../middleware/rateLimit');
const UnifiedWeatherService = require('./unifiedWeatherService');
const mlService = require('./mlService');
const { createInputMiddleware } = require('./inputStandardization');

const db = admin.firestore();

// Limited rate for internal/premium use only
router.use(rateLimit(10, 60_000));

/**
 * 🎯 GENERATE COMPREHENSIVE FORECAST
 * Core function used by scheduled jobs
 */
async function generateComprehensiveForecast(location) {
  console.log(`🔮 Generating forecast for ${location} (scheduled)`);
  
  try {
    const weatherService = new UnifiedWeatherService();
    const weatherData = await weatherService.getWeatherData(location, { includeForecast: true });

    if (!weatherData || !weatherData.current || !weatherData.location) {
      throw new Error('Invalid weather data - missing current conditions or location');
    }

    const { current, forecast } = weatherData;

    // Create comprehensive forecast with paddle predictions
    const result = {
      success: true,
      data: {
        location,
        current: {
          ...current,
          paddle_summary: await generatePaddleSummary(current, weatherData.location),
          safety_level: calculateSafetyLevel(current)
        },
        forecast: await Promise.all(forecast.map(async (hour) => ({
          ...hour,
          paddle_summary: await generatePaddleSummary(hour, weatherData.location),
          safety_level: calculateSafetyLevel(hour)
        }))),
        metadata: {
          generated: new Date().toISOString(),
          cached_until: new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString(), // 2 hours
          source: 'scheduled-forecast'
        }
      }
    };

    // Cache the result in Firestore for fastForecast API
    const cacheKey = `forecast_${location.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    await db.collection('forecastCache').doc(cacheKey).set({
      ...result.data,
      cached_at: new Date(),
      expires_at: new Date(Date.now() + (2 * 60 * 60 * 1000))
    });

    console.log(`💾 Cached forecast: ${cacheKey}`);
    return result;

  } catch (error) {
    console.error(`❌ Forecast failed for ${location}:`, error);
    return {
      success: false,
      location,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * 📦 BATCH GENERATE FORECASTS
 * Used by scheduled functions to process multiple locations
 */
async function batchGenerateForecasts(locations, batchSize = 3) {
  const startTime = Date.now();
  console.log(`🔄 Starting batch forecast for ${locations.length} locations`);

  try {
    const results = [];
    let successful = 0;
    let failed = 0;

    // Process in batches to avoid overwhelming APIs
    for (let i = 0; i < locations.length; i += batchSize) {
      const batch = locations.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      
      console.log(`Processing batch ${batchNum}: ${batch.map(l => l.name || l.id).join(', ')}`);
      
      // Process batch in parallel
      const batchPromises = batch.map(async (loc) => {
        const locationQuery = loc.query || loc.id;
        const result = await generateComprehensiveForecast(locationQuery);
        
        if (result.success) {
          successful++;
          console.log(`✅ Forecast generated for ${loc.name || loc.id} in ${Date.now() - startTime}ms`);
        } else {
          failed++;
        }
        
        return {
          locationName: loc.name || loc.id,
          success: result.success,
          error: result.error || null
        };
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Add small delay between batches
      if (i + batchSize < locations.length) {
        console.log('⏳ Waiting 2 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    const summary = {
      success: true,
      processed: results.length,
      successful,
      failed,
      duration_ms: Date.now() - startTime,
      locations_processed: results.map(r => ({
        name: r.locationName,
        success: r.success,
        error: r.error || null
      }))
    };
    
    console.log(`✅ Batch complete: ${successful}/${results.length} successful in ${Date.now() - startTime}ms`);
    
    return summary;
    
  } catch (error) {
    console.error('❌ Batch generation failed:', error);
    return {
      success: false,
      error: error.message,
      duration_ms: Date.now() - startTime
    };
  }
}

/**
 * 📍 GET PADDLING LOCATIONS
 */
async function getPaddlingLocations() {
  try {
    const snapshot = await db.collection('paddlingSpots').get();
    const locations = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      
      // Extract location query from paddling spot data
      let locationQuery = null;
      
      // Try coordinates first (most accurate for WeatherAPI)
      if (data.location?.coordinates?.lat && data.location?.coordinates?.lng) {
        locationQuery = `${data.location.coordinates.lat},${data.location.coordinates.lng}`;
      } else if (data.location?.latitude && data.location?.longitude) {
        // Handle the actual data structure we found
        locationQuery = `${data.location.latitude},${data.location.longitude}`;
      } else if (data.location?.name) {
        locationQuery = data.location.name;
      } else if (data.lakeName) {
        locationQuery = data.lakeName;
      }
      
      if (locationQuery) {
        locations.push({
          id: doc.id,
          name: data.lakeName || data.title || doc.id,
          query: locationQuery,
          latitude: data.location?.latitude || data.location?.coordinates?.lat,
          longitude: data.location?.longitude || data.location?.coordinates?.lng
        });
      }
    });
    
    console.log(`📍 Found ${locations.length} paddling locations`);
    return locations;
    
  } catch (error) {
    console.error('❌ Failed to get paddling locations:', error);
    return [];
  }
}

/**
 * 🏄‍♂️ GENERATE PADDLE SUMMARY using ML Service
 */
async function generatePaddleSummary(weather, location) {
  try {
    // DEBUG: Log what we're getting from UnifiedWeatherService
    console.log('🌤️ Weather data structure received:', {
      temperature_f: weather.current?.temperature?.fahrenheit,
      wind_mph: weather.current?.wind?.speedMPH,  
      conditions: weather.current?.conditions?.text,
      humidity: weather.current?.atmospheric?.humidity,
      uvIndex: weather.current?.solar?.uvIndex,
      visibility: weather.current?.atmospheric?.visibility,
      cloudCover: weather.current?.atmospheric?.cloudCover,
      structure_keys: Object.keys(weather),
      current_keys: weather.current ? Object.keys(weather.current) : 'no current key'
    });
    
    // Extract features for ML prediction using CORRECT UnifiedWeatherService data structure
    const features = mlService.extractMLFeatures({
      temperature: weather.current?.temperature?.fahrenheit || 65,
      windSpeed: weather.current?.wind?.speedMPH || 5,
      hasWarnings: false, // Only use real WeatherAPI government alerts
      uvIndex: weather.current?.solar?.uvIndex || 5,
      visibility: weather.current?.atmospheric?.visibility || 10,
      humidity: weather.current?.atmospheric?.humidity || 50,
      cloudCover: weather.current?.atmospheric?.cloudCover || 50,
      latitude: location?.latitude || 30.0,
      longitude: location?.longitude || -97.0
    });

    console.log('🎯 Features extracted for ML:', features);

    // Get ML prediction
    const prediction = await mlService.getPrediction(features);
    
    console.log('🎯 ML prediction result:', prediction);
    
    if (!prediction.success) {
      throw new Error('ML prediction failed');
    }
    
    // Convert 1-5 scale to 0-1 scale for UI compatibility
    const normalizedScore = (prediction.rating - 1) / 4; // 1->0, 5->1
    
    // Determine interpretation based on ML rating
    let interpretation;
    if (prediction.rating >= 4.0) interpretation = 'excellent';
    else if (prediction.rating >= 3.0) interpretation = 'good';
    else if (prediction.rating >= 2.0) interpretation = 'fair';
    else interpretation = 'poor';
    
    return {
      score: normalizedScore,
      mlRating: prediction.rating, // Keep original 1-5 scale
      interpretation,
      wind_mph: weather.wind?.speedMPH || 0,
      temp_f: weather.temperature?.fahrenheit || 65,
      factors: {
        wind: (weather.wind?.speedMPH || 0) > 15 ? 'high' : (weather.wind?.speedMPH || 0) > 10 ? 'moderate' : 'low',
        temperature: (weather.temperature?.fahrenheit || 65) < 55 ? 'cold' : (weather.temperature?.fahrenheit || 65) > 75 ? 'warm' : 'comfortable',
        weather: weather.conditions?.text || 'Clear'
      },
      mlModelUsed: prediction.mlModelUsed,
      predictionSource: prediction.predictionSource,
      confidence: prediction.confidence
    };
  
  } catch (error) {
    console.error('❌ ML paddle summary failed:', error);
    
    // Fallback to simple rule-based (but still proper format)
    const windMph = weather.wind?.speedMPH || 0;
    const temp = weather.temperature?.fahrenheit || 65;
    const condition = weather.conditions?.text?.toLowerCase() || '';
    
    let score = 0.8; // Start with good conditions
    
    // Wind adjustments
    if (windMph > 20) score -= 0.4;
    else if (windMph > 15) score -= 0.3;
    else if (windMph > 10) score -= 0.2;
    
    // Temperature adjustments
    if (temp < 50) score -= 0.3;
    else if (temp < 60) score -= 0.1;
    
    // Weather condition adjustments
    if (condition.includes('storm')) score -= 0.6;
    else if (condition.includes('rain')) score -= 0.4;
    else if (condition.includes('fog')) score -= 0.2;
    
    score = Math.max(0, Math.min(1, score));
    const fallbackRating = Math.round((score * 4 + 1) * 2) / 2; // Convert to 1-5 scale with 0.5 increments
    
    return {
      score,
      mlRating: fallbackRating,
      interpretation: score > 0.7 ? 'excellent' : score > 0.5 ? 'good' : score > 0.3 ? 'fair' : 'poor',
      wind_mph: windMph,
      temp_f: temp,
      factors: {
        wind: windMph > 15 ? 'high' : windMph > 10 ? 'moderate' : 'low',
        temperature: temp < 55 ? 'cold' : temp > 75 ? 'warm' : 'comfortable',
        weather: condition
      },
      mlModelUsed: false,
      predictionSource: 'fallback-rules',
      confidence: 0.7
    };
  }
}

/**
 * 🛡️ CALCULATE SAFETY LEVEL
 */
function calculateSafetyLevel(weather) {
  const windMph = weather.wind?.speedMPH || 0;
  const condition = weather.conditions?.text?.toLowerCase() || '';
  
  if (windMph > 20 || condition.includes('storm')) {
    return { level: 'dangerous', color: '#ff4444', warning: 'Not safe for paddling' };
  } else if (windMph > 15 || condition.includes('rain')) {
    return { level: 'caution', color: '#ffaa44', warning: 'Experienced paddlers only' };
  } else if (windMph > 10) {
    return { level: 'moderate', color: '#44aaff', warning: 'Good conditions with wind' };
  } else {
    return { level: 'excellent', color: '#44ff44', warning: 'Perfect for paddling' };
  }
}

// API Routes
router.get('/', createInputMiddleware('forecast'), async (req, res) => {
  try {
    const { latitude, longitude, spotId, locationString } = req.standardizedInputs;
    
    // Determine the location query format for weather API
    const location = locationString || spotId || `${latitude},${longitude}`;
    
    const result = await generateComprehensiveForecast(location);
    res.json(result);
    
  } catch (error) {
    console.error('❌ Forecast API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Batch forecast endpoint (for scheduled jobs)
router.post('/batch', async (req, res) => {
  try {
    const locations = await getPaddlingLocations();
    
    if (locations.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No paddling locations found'
      });
    }
    
    const result = await batchGenerateForecasts(locations);
    res.json(result);
    
  } catch (error) {
    console.error('❌ Batch forecast error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = {
  router,
  generateComprehensiveForecast,
  batchGenerateForecasts,
  getPaddlingLocations,
  generatePaddleSummary
};
