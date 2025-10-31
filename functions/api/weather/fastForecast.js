// File: functions/src/api/fastForecast.js
//
// ⚡ FAST FORECAST API - Cached 3-Day Weather Forecasts
//
// Ultra-fast cached weather forecasts with ML paddle predictions
// Serves pre-computed or rapidly generated forecasts for frontend

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { logger } = require('firebase-functions');
const ForecastCache = require('../../cache/forecastCache');
const UnifiedWeatherService = require('./unifiedWeatherService');
const mlService = require('./mlService');
const { standardizeForMLModel, standardizeForPenalties, calculateBeaufortFromKph } = require('./dataStandardization');
const { applyEnhancedPenalties } = require('./paddlePenalties');
const { createInputMiddleware } = require('./inputStandardization');
const { calibrateModelPrediction } = require('./modelCalibration');
const { getSmartWarnings } = require('./smartWarnings');

const db = admin.firestore();

/**
 * Transform weather data to match production fastForecast format
 */
async function transformToFastForecastFormat(weatherData, locationQuery) {
    const { current, location, forecast } = weatherData;
    
    if (!forecast || !Array.isArray(forecast)) {
        throw new Error('No forecast data available');
    }
    
    // Get marine data for consistent penalty application
    let marineData = null;
    try {
        const weatherService = new UnifiedWeatherService();
        marineData = await weatherService.getMarineData(locationQuery);
        console.log('🌊 Marine data for fastForecast:', marineData ? 'Available' : 'Not available');
    } catch (error) {
        console.log('ℹ️ Marine data not available for fastForecast');
    }
    
    // Group forecast by days (24 hours each)
    const forecastByDays = [];
    
    for (const dayData of forecast.slice(0, 3)) { // Max 3 days
        const forecastDay = {
            date: dayData.date,
            hourly: {}
        };
        
        if (!dayData.hourly || !Array.isArray(dayData.hourly)) {
            continue;
        }
        
        for (const hourData of dayData.hourly) {
            // Parse the hour from the time string (format: "2025-08-18 14:00")
            const timeParts = hourData.time.split(' ');
            if (timeParts.length !== 2) continue;
            
            const hourStr = timeParts[1].split(':')[0];
            const hour = parseInt(hourStr, 10);
            
            if (isNaN(hour) || hour < 0 || hour > 23) continue;
            
            // Get ML prediction using standardized data format
            const rawInput = {
                temperature: hourData.tempC,
                windSpeedKph: hourData.windKPH,
                windDirection: hourData.windDir,
                humidity: hourData.humidity,
                cloudCover: hourData.cloudCover,
                uvIndex: hourData.uvIndex,
                visibility: 10,
                hasWarnings: false,
                latitude: weatherData.location?.coordinates?.latitude || location.coordinates?.latitude,
                longitude: weatherData.location?.coordinates?.longitude || location.coordinates?.longitude
            };
            
            const mlInputData = standardizeForMLModel(rawInput, marineData);
            
            // Use v3 model with standardized data and apply calibration
            const prediction = await mlService.getPrediction(mlInputData);
            
            // Apply model calibration for more accurate real-world ratings
            const calibratedPrediction = calibrateModelPrediction(
                prediction.rating,
                {
                    temperature: hourData.tempC,
                    windSpeed: hourData.windKPH * 0.621371, // Convert to MPH
                    gustSpeed: (hourData.windKPH * 1.3) * 0.621371,
                    humidity: hourData.humidity,
                    cloudCover: hourData.cloudCover,
                    uvIndex: hourData.uvIndex,
                    visibility: 10
                },
                weatherData.forecast,
                {
                    latitude: weatherData.location?.coordinates?.latitude || location.coordinates?.latitude,
                    longitude: weatherData.location?.coordinates?.longitude || location.coordinates?.longitude
                }
            );
            
            // Use calibrated rating for heatmap consistency
            const finalRating = calibratedPrediction.calibratedRating;
            
            // Extract water temperature from marine data if available for this hour
            let waterTemp = null;
            if (marineData && marineData.forecast && marineData.forecast.forecastday) {
                const marineDay = marineData.forecast.forecastday.find(day => day.date === dayData.date);
                if (marineDay && marineDay.hour) {
                    const marineHour = marineDay.hour.find(h => h.time === hourData.time);
                    if (marineHour && marineHour.water_temp_c) {
                        waterTemp = marineHour.water_temp_c;
                        console.log(`🌊 MARINE WATER TEMP FOUND for ${hourData.time}: ${waterTemp}°C (was going to estimate from air temp ${hourData.tempC}°C)`);
                    } else {
                        console.log(`⚠️ Marine data available but no water_temp_c for ${hourData.time}`);
                    }
                } else {
                    console.log(`⚠️ Marine data available but no hourly data for ${dayData.date}`);
                }
            } else {
                console.log(`ℹ️ No marine data available for water temp estimation at ${hourData.time}`);
            }
            
            // Generate smart warnings for this hour
            const smartWarnings = getSmartWarnings(
                {
                    temperature: hourData.tempC,
                    windSpeed: hourData.windKPH * 0.621371, // Convert to MPH for warnings
                    gustSpeed: (hourData.windKPH * 1.3) * 0.621371,
                    humidity: hourData.humidity,
                    cloudCover: hourData.cloudCover,
                    uvIndex: hourData.uvIndex,
                    visibility: 10,
                    waterTemp: waterTemp  // Use marine data if available, otherwise smartWarnings will estimate
                },
                weatherData,
                {
                    latitude: weatherData.location?.coordinates?.latitude || location.coordinates?.latitude,
                    longitude: weatherData.location?.coordinates?.longitude || location.coordinates?.longitude
                }
            );
            
            // Transform to production format with calibrated ratings
            forecastDay.hourly[hour] = {
                temperature: hourData.tempC,
                windSpeed: hourData.windKPH,
                windDirection: hourData.windDir,
                gustSpeed: (hourData.windKPH * 1.3), // Simple gust estimate in KPH
                humidity: hourData.humidity,
                cloudCover: hourData.cloudCover,
                uvIndex: hourData.uvIndex,
                visibility: 10, // Default visibility
                hasWarnings: smartWarnings.length > 0,
                warnings: smartWarnings,
                beaufortScale: calculateBeaufortFromKph(hourData.windKPH),
                // Marine data consistency
                waterTemp: Math.max(2, hourData.tempC - 8), // Conservative water temp estimate
                marineDataAvailable: !!marineData,
                prediction: {
                    rating: finalRating,
                    mlModelUsed: prediction.mlModelUsed,
                    predictionSource: prediction.predictionSource,
                    modelType: prediction.modelType,
                    confidence: prediction.confidence,
                    isGoldStandard: true, // Using calibrated ML model
                    v3ModelUsed: true,
                    // Calibration details
                    originalMLRating: calibratedPrediction.originalRating,
                    calibrationApplied: calibratedPrediction.adjustments.length > 0,
                    adjustments: calibratedPrediction.adjustments
                },
                // Calibrated results for heatmap consistency
                originalRating: calibratedPrediction.originalRating,
                safetyDeduction: 0, // No additional penalties with calibration
                apiRating: finalRating,
                rating: finalRating,
                mlModelUsed: prediction.mlModelUsed,
                predictionSource: prediction.predictionSource
            };
        }
        
        forecastByDays.push(forecastDay);
    }
    
    return {
        success: true,
        location: {
            name: location.name,
            region: location.region,
            country: location.country,
            coordinates: {
                latitude: location.coordinates.latitude,
                longitude: location.coordinates.longitude
            }
        },
        forecast: forecastByDays,
        metadata: {
            cached: false,
            processingTimeMs: 0, // Will be set by caller
            mlServiceUrl: 'https://kaayko-ml-service-87383373015.us-central1.run.app',
            apiVersion: '2.0',
            cacheAge: 0,
            cacheTime: new Date().toISOString(),
            responseTime: '0ms', // Will be set by caller
            source: 'unified_weather_service',
            fastAPI: true,
            timestamp: new Date().toISOString()
        }
    };
}

/**
 * Calculate Beaufort scale from wind speed (km/h)
 */
/**
 * ⚡ GET /fastForecast
 * Ultra-fast forecast API with Firebase cache
 * 
 * Standardized Input Parameters:
 * - lat & lng: Separate latitude/longitude coordinates  
 * - location: Combined "lat,lng" coordinates
 * - spotId: Known paddling spot ID (for fastest response)
 * 
 * Examples:
 * - /fastForecast?lat=42.3601&lng=-71.0589
 * - /fastForecast?location=42.3601,-71.0589
 * - /fastForecast?spotId=merrimack
 */
router.get('/', createInputMiddleware('fastForecast'), async (req, res) => {
    const startTime = Date.now();
    const cache = new ForecastCache();

    try {
        const { latitude, longitude, spotId } = req.standardizedInputs;

        let locationQuery;
        let locationName;

        // Determine location source  
        if (spotId) {
            // Handle spotId if needed (implement spot lookup)
            locationQuery = spotId; // This would need spot lookup implementation
            locationName = spotId;
        } else {
            locationQuery = `${latitude},${longitude}`;
            locationName = `${latitude},${longitude}`;
        }

        console.log(`⚡ FastForecast: ${locationQuery}`);

        let forecast = null;
        let source = 'unknown';

        // Check cache for custom coordinates
        forecast = await cache.getCachedCustomForecast(latitude, longitude);
        source = 'coordinate_cache';

        if (!forecast) {
            // Cache miss - generate fresh forecast using UnifiedWeatherService
            try {
                logger.info(`Cache miss for coordinates ${latitude},${longitude} - generating forecast`);
                
                const weatherService = new UnifiedWeatherService();
                const weatherData = await weatherService.getWeatherData(
                    { lat: latitude, lng: longitude }, 
                    { includeForecast: true }
                );

                if (!weatherData || !weatherData.current || !weatherData.location) {
                    throw new Error('Invalid weather data - missing current conditions or location');
                }

                // Transform to the same format as production API
                forecast = await transformToFastForecastFormat(weatherData);
                
                if (forecast.success) {
                    // Update processing time
                    const processingTime = Date.now() - startTime;
                    forecast.metadata.processingTimeMs = processingTime;
                    forecast.metadata.responseTime = `${processingTime}ms`;
                    
                    // Store in cache for future requests
                    await cache.storeCustomForecast(latitude, longitude, forecast);
                    source = 'api_fresh';
                    
                    // Add cache metadata
                    forecast.metadata = forecast.metadata || {};
                    forecast.metadata.cached = false;
                    forecast.metadata.source = 'live_api';
                }
            } catch (error) {
                logger.error(`Failed to generate forecast: ${error.message}`);
                res.status(503).json({
                    success: false,
                    error: 'Forecast service unavailable',
                    details: error.message,
                    suggestion: 'Try again in a few minutes'
                });
                return;
            }
        }

        const responseTime = Date.now() - startTime;
        
        // Add performance metadata
        forecast.metadata = forecast.metadata || {};
        forecast.metadata.responseTime = `${responseTime}ms`;
        forecast.metadata.source = source;
        forecast.metadata.fastAPI = true;
        forecast.metadata.timestamp = new Date().toISOString();

        logger.info(`✅ Fast forecast served in ${responseTime}ms (source: ${source})`);
        
        res.status(200).json(forecast);

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Fast forecast error after ${responseTime}ms: ${error.message}`);
        
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message,
            responseTime: `${responseTime}ms`
        });
    }
});

/**
 * GET /fastForecast/cache/stats - Get cache statistics
 */
router.get('/cache/stats', async (req, res) => {
    try {
        const cache = new ForecastCache();
        const stats = await cache.getCacheStats();
        const allForecasts = await cache.getAllCachedForecasts();
        
        res.status(200).json({
            success: true,
            stats,
            cachedLocations: Object.keys(allForecasts),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error(`Cache stats error: ${error.message}`);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

module.exports = router;
