const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const ForecastCache = require('../cache/forecastCache');
const { fetchAndCacheWeather } = require('../services/weatherService');
const { makeRequest } = require('../utils/httpUtils');

// Use the main API URL for internal calls
const API_BASE_URL = 'https://us-central1-kaaykostore.cloudfunctions.net/api';

/**
 * Ultra-fast forecast API with Firebase cache
 * GET /api/forecast/fast/:locationId - Get cached forecast for known location
 * GET /api/forecast/fast?lat=X&lng=Y - Get forecast for custom coordinates
 */
exports.fastForecast = onRequest({
    cors: true,
    invoker: "public"
}, async (req, res) => {
    const startTime = Date.now();
    const cache = new ForecastCache();

    try {
        // Set CORS headers
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }

        if (req.method !== 'GET') {
            res.status(405).json({
                success: false,
                error: 'Method not allowed',
                allowedMethods: ['GET']
            });
            return;
        }

        const { lat, lng } = req.query;
        const locationId = req.params[0]; // Extract from path

        let forecast = null;
        let source = 'unknown';

        // Case 1: Known location ID (e.g. /api/forecast/fast/merrimack)
        if (locationId && !lat && !lng) {
            forecast = await cache.getCachedForecast(locationId);
            source = 'location_cache';
            
            if (!forecast) {
                res.status(404).json({
                    success: false,
                    error: `No cached forecast found for location: ${locationId}`,
                    suggestion: 'Try using lat/lng parameters or wait for next cache refresh',
                    cacheTTL: '2 hours'
                });
                return;
            }
        }
        // Case 2: Custom coordinates (e.g. /api/forecast/fast?lat=38.781063&lng=-106.277812)
        else if (lat && lng) {
            const latitude = parseFloat(lat);
            const longitude = parseFloat(lng);

            if (isNaN(latitude) || isNaN(longitude)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid coordinates',
                    details: 'lat and lng must be valid numbers'
                });
                return;
            }

            // Check cache for custom coordinates
            forecast = await cache.getCachedCustomForecast(latitude, longitude);
            source = 'coordinate_cache';

            if (!forecast) {
                // Cache miss - fetch from API and cache it
                try {
                    logger.info(`Cache miss for coordinates ${latitude},${longitude} - fetching from API`);
                    const url = `${API_BASE_URL}/paddlePredict/forecast?lat=${latitude}&lng=${longitude}`;
                    forecast = await makeRequest(url, {}, 15000); // 15 second timeout for fast API
                    
                    if (forecast.success) {
                        // Store in cache for future requests
                        await cache.storeCustomForecast(latitude, longitude, forecast);
                        source = 'api_fresh';
                        
                        // Add cache metadata
                        forecast.metadata = forecast.metadata || {};
                        forecast.metadata.cached = false;
                        forecast.metadata.source = 'live_api';
                    }
                } catch (error) {
                    logger.error(`Failed to fetch forecast from API: ${error.message}`);
                    res.status(503).json({
                        success: false,
                        error: 'Forecast service unavailable',
                        details: error.message,
                        suggestion: 'Try again in a few minutes'
                    });
                    return;
                }
            }
        }
        // Case 3: Invalid request
        else {
            res.status(400).json({
                success: false,
                error: 'Invalid request',
                usage: {
                    knownLocation: '/api/forecast/fast/{locationId}',
                    customCoordinates: '/api/forecast/fast?lat={latitude}&lng={longitude}',
                    examples: [
                        '/api/forecast/fast/merrimack',
                        '/api/forecast/fast?lat=38.781063&lng=-106.277812'
                    ]
                }
            });
            return;
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
 * Cache management API
 * GET /api/cache/stats - Get cache statistics
 * POST /api/cache/refresh - Manually refresh cache for a location
 * DELETE /api/cache/clear - Clear expired cache entries
 */
exports.cacheManager = onRequest({
    cors: true,
    invoker: "public"
}, async (req, res) => {
    const cache = new ForecastCache();

    try {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }

        // GET /api/cache/stats
        if (req.method === 'GET' && req.path.includes('/stats')) {
            const stats = await cache.getCacheStats();
            const allForecasts = await cache.getAllCachedForecasts();
            
            res.status(200).json({
                success: true,
                stats,
                cachedLocations: Object.keys(allForecasts),
                timestamp: new Date().toISOString()
            });
            return;
        }

        // DELETE /api/cache/clear
        if (req.method === 'DELETE' && req.path.includes('/clear')) {
            const expiredCount = await cache.clearExpiredCache();
            const stats = await cache.getCacheStats();
            
            res.status(200).json({
                success: true,
                message: `Cleared ${expiredCount} expired cache entries`,
                expiredCount,
                stats,
                timestamp: new Date().toISOString()
            });
            return;
        }

        // POST /api/cache/refresh
        if (req.method === 'POST' && req.path.includes('/refresh')) {
            const { locationId, lat, lng } = req.body;
            
            if (!locationId && (!lat || !lng)) {
                res.status(400).json({
                    success: false,
                    error: 'Must provide either locationId or lat/lng coordinates'
                });
                return;
            }

            try {
                let url;
                let cacheKey;
                
                if (locationId) {
                    // For known locations, we need to get coordinates first
                    // This would require a lookup table or API call
                    res.status(400).json({
                        success: false,
                        error: 'Location refresh not implemented yet',
                        suggestion: 'Use lat/lng coordinates instead'
                    });
                    return;
                } else {
                    url = `${API_BASE_URL}/paddlePredict/forecast?lat=${lat}&lng=${lng}`;
                    cacheKey = `custom_${cache.generateLocationHash(lat, lng)}`;
                }

                const forecast = await makeRequest(url, {}, 15000); // 15 second timeout for cache refresh
                
                if (forecast.success) {
                    await cache.storeForecast(cacheKey, forecast);
                    
                    res.status(200).json({
                        success: true,
                        message: 'Cache refreshed successfully',
                        cacheKey,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    res.status(502).json({
                        success: false,
                        error: 'Failed to fetch fresh forecast',
                        details: forecast
                    });
                }
            } catch (error) {
                res.status(503).json({
                    success: false,
                    error: 'Failed to refresh cache',
                    details: error.message
                });
            }
            return;
        }

        res.status(404).json({
            success: false,
            error: 'Endpoint not found',
            availableEndpoints: [
                'GET /api/cache/stats',
                'POST /api/cache/refresh',
                'DELETE /api/cache/clear'
            ]
        });

    } catch (error) {
        logger.error(`Cache manager error: ${error.message}`);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});
