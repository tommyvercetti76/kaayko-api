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
const ForecastCache = require('../cache/forecastCache');
const UnifiedWeatherService = require('../services/unifiedWeatherService');
const mlService = require('../services/mlService');
const { applyEnhancedPenalties } = require('../utils/paddlePenalties');
const { standardizeForMLModel, standardizeForPenalties, calculateBeaufortFromKph } = require('../utils/dataStandardization');
const { createInputMiddleware } = require('../utils/inputStandardization');

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
            
            // Standardize weather data for consistent ML model input
            const standardizedData = standardizeForMLModel({
                temperatureC: hourData.tempC,
                windSpeedKph: hourData.windKPH,
                windDirection: hourData.windDir,
                humidity: hourData.humidity,
                cloudCover: hourData.cloudCover,
                uvIndex: hourData.uvIndex,
                visibility: 10 // Default visibility
            }, marineData);
            
            // Get ML prediction for this hour with standardized data
            const rawPrediction = await mlService.getPrediction(standardizedData);
            
            // Apply enhanced penalties with standardized data
            const prediction = applyEnhancedPenalties(rawPrediction, standardizedData, marineData?.forecast?.forecastday?.[0]?.hour?.[0]);
            
            // Transform to production format with enhanced details
            forecastDay.hourly[hour] = {
                temperature: hourData.tempC,
                windSpeed: hourData.windKPH,
                windDirection: hourData.windDir,
                gustSpeed: standardizedData.gustSpeed / 0.621371, // Convert back to KPH for display
                humidity: hourData.humidity,
                cloudCover: hourData.cloudCover,
                uvIndex: hourData.uvIndex,
                visibility: 10, // Default visibility
                hasWarnings: prediction.warnings && prediction.warnings.length > 0,
                warnings: prediction.warnings || [],
                beaufortScale: calculateBeaufortFromKph(hourData.windKPH),
                // Enhanced marine data
                waveHeight: standardizedData.waveHeight,
                waterTemp: standardizedData.waterTemp,
                marineDataAvailable: !!marineData,
                prediction: {
                    rating: prediction.rating,
                    originalRating: prediction.originalRating,
                    penaltiesApplied: prediction.penaltiesApplied,
                    totalPenalty: prediction.totalPenalty,
                    roundedTo05Increments: prediction.roundedTo05Increments,
                    safetyDeduction: prediction.totalPenalty || 0, // Backward compatibility
                    mlModelUsed: prediction.mlModelUsed,
                    predictionSource: prediction.predictionSource
                },
                // Duplicate fields for compatibility
                originalRating: prediction.originalRating,
                safetyDeduction: prediction.totalPenalty || 0,
                apiRating: prediction.rating,
                rating: prediction.rating,
                mlModelUsed: prediction.mlModelUsed,
                predictionSource: prediction.predictionSource,
                // New penalty fields
                penaltiesApplied: prediction.penaltiesApplied,
                totalPenalty: prediction.totalPenalty,
                roundedTo05Increments: prediction.roundedTo05Increments
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
