const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const ForecastCache = require('../cache/forecastCache');
const { LocationPoller } = require('./locationPoller');
const https = require('https');

const API_BASE_URL = 'https://api-vwcc5j4qda-uc.a.run.app';

/**
 * Make HTTP request with retry logic
 */
function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(JSON.parse(data));
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

/**
 * Fetch forecast for a single location with retry logic
 */
async function fetchLocationForecast(location, retries = 3) {
    const url = `${API_BASE_URL}/paddlePredict/forecast?lat=${location.lat}&lng=${location.lng}`;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            logger.info(`Fetching forecast for ${location.id || location.name} (attempt ${attempt}/${retries})`);
            const forecast = await makeRequest(url);
            
            if (forecast.success && forecast.forecast) {
                logger.info(`✅ Successfully fetched forecast for ${location.id || location.name}`);
                return forecast;
            } else {
                throw new Error(`Invalid forecast response: ${JSON.stringify(forecast)}`);
            }
        } catch (error) {
            logger.warn(`❌ Attempt ${attempt} failed for ${location.id || location.name}: ${error.message}`);
            
            if (attempt === retries) {
                logger.error(`🚨 All ${retries} attempts failed for ${location.id || location.name}`);
                throw error;
            }
            
            // Exponential backoff
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Get current locations dynamically from location poller
 */
async function getCurrentLocations() {
    try {
        const poller = new LocationPoller();
        const locations = await poller.getKnownLocations();
        logger.info(`📍 Retrieved ${locations.length} known locations for forecast processing`);
        return locations;
    } catch (error) {
        logger.error('Failed to get dynamic locations, using fallback');
        // Fallback to basic list if location poller fails
        return [
            { id: "merrimack", lat: 42.88141, lng: -71.47342, name: "Merrimack River" },
            { id: "cottonwood", lat: 38.781063, lng: -106.277812, name: "Cottonwood Lake" },
            { id: "union", lat: 47.627413, lng: -122.338984, name: "Lake Union" },
            { id: "antero", lat: 38.982687, lng: -105.896563, name: "Antero Reservoir" },
            { id: "jackson", lat: 43.845863, lng: -110.600359, name: "Jackson Lake" }
        ];
    }
}

/**
 * Enhanced forecast processing with dynamic locations
 */
async function processAllLocations(updateReason = 'scheduled') {
    const startTime = Date.now();
    const cache = new ForecastCache();
    
    // Get current locations dynamically
    const locations = await getCurrentLocations();
    
    logger.info(`🚀 Starting ${updateReason} forecast processing for ${locations.length} locations`);
    
    const results = {
        successful: 0,
        failed: 0,
        skipped: 0,
        errors: [],
        updateReason
    };

    // Process locations in smaller batches for better performance
    const BATCH_SIZE = 2; // Reduced batch size for more frequent updates
    const BATCH_DELAY = 1500; // 1.5 seconds between batches

    for (let i = 0; i < locations.length; i += BATCH_SIZE) {
        const batch = locations.slice(i, i + BATCH_SIZE);
        
        logger.info(`📦 Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(locations.length/BATCH_SIZE)} (${updateReason})`);
        
        const batchPromises = batch.map(async (location) => {
            try {
                // For scheduled updates, only refresh if cache is old or missing
                if (updateReason !== 'manual_trigger') {
                    const cached = await cache.getCachedForecast(location.id);
                    if (cached && cached.metadata?.cacheAge < 2.5) { // Allow some overlap
                        logger.info(`⚡ Skipping ${location.id} - fresh cache available (${cached.metadata.cacheAge.toFixed(1)}h old)`);
                        results.skipped++;
                        return { success: true, cached: true };
                    }
                }

                const forecast = await fetchLocationForecast(location);
                await cache.storeForecast(location.id, forecast);
                
                results.successful++;
                return { success: true, cached: false };
            } catch (error) {
                logger.error(`Failed to process ${location.id}: ${error.message}`);
                results.failed++;
                results.errors.push({
                    location: location.id,
                    error: error.message
                });
                return { success: false, error: error.message };
            }
        });

        await Promise.all(batchPromises);
        
        // Delay between batches (except for the last batch)
        if (i + BATCH_SIZE < locations.length) {
            logger.info(`⏱️  Waiting ${BATCH_DELAY}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
    }

    // Clean up expired cache
    const expiredCount = await cache.clearExpiredCache();
    
    // Get cache statistics
    const stats = await cache.getCacheStats();
    
    const duration = Date.now() - startTime;
    logger.info(`✅ ${updateReason} forecast processing completed in ${duration}ms`);
    logger.info(`📊 Results: ${results.successful} successful, ${results.failed} failed, ${results.skipped} skipped`);
    logger.info(`🗑️  Cleaned ${expiredCount} expired cache entries`);
    logger.info(`📈 Cache stats: ${JSON.stringify(stats)}`);

    if (results.errors.length > 0) {
        logger.warn(`⚠️  Errors encountered: ${JSON.stringify(results.errors)}`);
    }

    return {
        success: true,
        duration,
        results,
        expiredCount,
        stats,
        updateReason
    };
}

/**
 * DAWN FORECAST UPDATE - 5:00 AM UTC
 * First update of the day, fresh forecasts for early morning planning
 */
exports.dawnForecastUpdate = onSchedule({
    schedule: '0 5 * * *', // Daily at 5:00 AM UTC
    timeZone: 'UTC',
    memory: '1GiB',
    timeoutSeconds: 540
}, async (event) => {
    logger.info('🌅 Starting DAWN forecast update (5:00 AM UTC)');
    return processAllLocations('dawn');
});

/**
 * MORNING FORECAST UPDATE - 8:00 AM UTC  
 * Morning update for day planning
 */
exports.morningForecastUpdate = onSchedule({
    schedule: '0 8 * * *', // Daily at 8:00 AM UTC
    timeZone: 'UTC',
    memory: '1GiB',
    timeoutSeconds: 540
}, async (event) => {
    logger.info('🌤️  Starting MORNING forecast update (8:00 AM UTC)');
    return processAllLocations('morning');
});

/**
 * LATE MORNING FORECAST UPDATE - 11:00 AM UTC
 * Pre-lunch update for afternoon planning
 */
exports.lateMorningForecastUpdate = onSchedule({
    schedule: '0 11 * * *', // Daily at 11:00 AM UTC
    timeZone: 'UTC',
    memory: '1GiB',
    timeoutSeconds: 540
}, async (event) => {
    logger.info('☀️ Starting LATE MORNING forecast update (11:00 AM UTC)');
    return processAllLocations('late_morning');
});

/**
 * AFTERNOON FORECAST UPDATE - 2:00 PM UTC (14:00)
 * Mid-day update
 */
exports.afternoonForecastUpdate = onSchedule({
    schedule: '0 14 * * *', // Daily at 2:00 PM UTC
    timeZone: 'UTC',
    memory: '1GiB',
    timeoutSeconds: 540
}, async (event) => {
    logger.info('🌞 Starting AFTERNOON forecast update (2:00 PM UTC)');
    return processAllLocations('afternoon');
});

/**
 * LATE AFTERNOON FORECAST UPDATE - 5:00 PM UTC (17:00)
 * Evening planning update
 */
exports.lateAfternoonForecastUpdate = onSchedule({
    schedule: '0 17 * * *', // Daily at 5:00 PM UTC
    timeZone: 'UTC',
    memory: '1GiB',
    timeoutSeconds: 540
}, async (event) => {
    logger.info('🌇 Starting LATE AFTERNOON forecast update (5:00 PM UTC)');
    return processAllLocations('late_afternoon');
});

/**
 * FINAL EVENING FORECAST UPDATE - 6:00 PM UTC (18:00)
 * Last update of the day, ratings stay until next dawn
 */
exports.finalEveningForecastUpdate = onSchedule({
    schedule: '0 18 * * *', // Daily at 6:00 PM UTC
    timeZone: 'UTC',
    memory: '1GiB',
    timeoutSeconds: 540
}, async (event) => {
    logger.info('🌆 Starting FINAL EVENING forecast update (6:00 PM UTC) - Last update until dawn');
    return processAllLocations('final_evening');
});

/**
 * Legacy function - kept for backward compatibility
 * Now redirects to the dawn update
 */
exports.precomputeForecasts = onSchedule({
    schedule: '0 0 31 2 *', // Never runs automatically (Feb 31st doesn't exist)
    timeZone: 'UTC'
}, async (event) => {
    logger.info('🔄 Legacy precompute function called - redirecting to dawn update');
    return processAllLocations('legacy');
});

/**
 * Manual trigger for forecast processing
 * Can be called via gcloud or HTTP for testing
 */
exports.triggerManualUpdate = onSchedule({
    schedule: '0 0 31 2 *', // Never runs automatically (Feb 31st doesn't exist)
    timeZone: 'UTC'
}, async (event) => {
    logger.info('🔧 Manual forecast update trigger called');
    return processAllLocations('manual_trigger');
});

/**
 * Cache cleanup job - runs daily at 3:30 AM UTC (between dawn updates)
 * Enhanced to handle multiple daily updates
 */
exports.cleanupCache = onSchedule({
    schedule: '30 3 * * *', // Daily at 3:30 AM UTC (30 mins before dawn update)
    timeZone: 'UTC',
    memory: '256MiB'
}, async (event) => {
    logger.info('🧹 Starting enhanced cache cleanup job');
    
    const cache = new ForecastCache();
    const expiredCount = await cache.clearExpiredCache();
    const stats = await cache.getCacheStats();
    
    // Additional cleanup: Remove very old custom location caches (older than 24 hours)
    const { getFirestore } = require('firebase-admin/firestore');
    const db = getFirestore();
    
    try {
        const snapshot = await db
            .collection(cache.CACHE_COLLECTION)
            .where('location_id', '>=', 'custom_')
            .where('location_id', '<', 'custom_z')
            .get();

        const now = new Date();
        const oldCustomCaches = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.cached_at) {
                const cacheTime = data.cached_at.toDate();
                const hoursOld = (now - cacheTime) / (1000 * 60 * 60);
                
                // Remove custom caches older than 24 hours
                if (hoursOld > 24) {
                    oldCustomCaches.push(doc.ref);
                }
            }
        });

        if (oldCustomCaches.length > 0) {
            const batch = db.batch();
            oldCustomCaches.forEach(docRef => batch.delete(docRef));
            await batch.commit();
            
            logger.info(`🗑️  Cleaned ${oldCustomCaches.length} old custom location caches`);
        }
        
        logger.info(`🧹 Cache cleanup completed:`);
        logger.info(`   - Expired entries: ${expiredCount}`);
        logger.info(`   - Old custom caches: ${oldCustomCaches.length}`);
        logger.info(`📊 Updated cache stats: ${JSON.stringify(stats)}`);
        
        return {
            success: true,
            expiredCount,
            oldCustomCaches: oldCustomCaches.length,
            stats
        };
    } catch (error) {
        logger.error('Error during enhanced cache cleanup:', error);
        return {
            success: false,
            error: error.message,
            basicCleanup: { expiredCount, stats }
        };
    }
});
