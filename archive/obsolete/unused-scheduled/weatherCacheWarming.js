// File: functions/src/scheduled/weatherCacheWarming.js
//
// 🔥 UNIFIED WEATHER CACHE WARMING SERVICE
//
// This replaces the scattered weather caching logic with a centralized approach:
// - Uses UnifiedWeatherService for all weather operations
// - Scheduled cache warming for known locations
// - Intelligent cache refresh based on usage patterns
// - Better error handling and retry logic

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const UnifiedWeatherService = require('../services/unifiedWeatherService');

/**
 * 🌅 DAWN CACHE WARMING - 5:00 AM UTC
 * Fresh weather data for early morning planning
 */
exports.dawnWeatherWarming = onSchedule({
    schedule: '0 5 * * *', // 5:00 AM UTC daily
    timeZone: 'UTC',
    memory: '1GiB',
    timeoutSeconds: 540
}, async (event) => {
    logger.info('🌅 Starting DAWN weather cache warming (5:00 AM UTC)');
    
    const weatherService = new UnifiedWeatherService();
    
    try {
        // Warm both current weather and 3-day forecasts
        const result = await weatherService.warmCacheForKnownLocations();
        
        logger.info(`✅ Dawn warming completed: ${result.summary.successful} successful, ${result.summary.failed} failed`);
        
        return {
            success: true,
            trigger: 'dawn_warming',
            ...result
        };
        
    } catch (error) {
        logger.error(`❌ Dawn warming failed: ${error.message}`);
        throw error;
    }
});

/**
 * 🌤️ MORNING CACHE REFRESH - 8:00 AM UTC  
 * Update weather data for morning activities
 */
exports.morningWeatherRefresh = onSchedule({
    schedule: '0 8 * * *', // 8:00 AM UTC daily
    timeZone: 'UTC',
    memory: '1GiB',
    timeoutSeconds: 540
}, async (event) => {
    logger.info('🌤️ Starting MORNING weather cache refresh (8:00 AM UTC)');
    
    const weatherService = new UnifiedWeatherService();
    
    try {
        const result = await weatherService.warmCacheForKnownLocations();
        
        logger.info(`✅ Morning refresh completed: ${result.summary.successful} successful, ${result.summary.failed} failed`);
        
        return {
            success: true,
            trigger: 'morning_refresh',
            ...result
        };
        
    } catch (error) {
        logger.error(`❌ Morning refresh failed: ${error.message}`);
        throw error;
    }
});

/**
 * 🌞 MIDDAY CACHE REFRESH - 12:00 PM UTC
 * Peak usage time refresh
 */
exports.middayWeatherRefresh = onSchedule({
    schedule: '0 12 * * *', // 12:00 PM UTC daily
    timeZone: 'UTC',
    memory: '1GiB',
    timeoutSeconds: 540
}, async (event) => {
    logger.info('🌞 Starting MIDDAY weather cache refresh (12:00 PM UTC)');
    
    const weatherService = new UnifiedWeatherService();
    
    try {
        const result = await weatherService.warmCacheForKnownLocations();
        
        logger.info(`✅ Midday refresh completed: ${result.summary.successful} successful, ${result.summary.failed} failed`);
        
        return {
            success: true,
            trigger: 'midday_refresh',
            ...result
        };
        
    } catch (error) {
        logger.error(`❌ Midday refresh failed: ${error.message}`);
        throw error;
    }
});

/**
 * 🌇 EVENING CACHE REFRESH - 5:00 PM UTC (17:00)
 * Evening planning update
 */
exports.eveningWeatherRefresh = onSchedule({
    schedule: '0 17 * * *', // 5:00 PM UTC daily
    timeZone: 'UTC',
    memory: '1GiB',
    timeoutSeconds: 540
}, async (event) => {
    logger.info('🌇 Starting EVENING weather cache refresh (5:00 PM UTC)');
    
    const weatherService = new UnifiedWeatherService();
    
    try {
        const result = await weatherService.warmCacheForKnownLocations();
        
        logger.info(`✅ Evening refresh completed: ${result.summary.successful} successful, ${result.summary.failed} failed`);
        
        return {
            success: true,
            trigger: 'evening_refresh',
            ...result
        };
        
    } catch (error) {
        logger.error(`❌ Evening refresh failed: ${error.message}`);
        throw error;
    }
});

/**
 * 🧹 CACHE CLEANUP JOB - 3:30 AM UTC
 * Clean expired cache entries and optimize storage
 */
exports.weatherCacheCleanup = onSchedule({
    schedule: '30 3 * * *', // 3:30 AM UTC daily (30 mins before dawn warming)
    timeZone: 'UTC',
    memory: '512MiB',
    timeoutSeconds: 300
}, async (event) => {
    logger.info('🧹 Starting weather cache cleanup (3:30 AM UTC)');
    
    const weatherService = new UnifiedWeatherService();
    
    try {
        const cleanupResult = await weatherService.cleanExpiredCache();
        const stats = await weatherService.getCacheStats();
        
        logger.info(`🧹 Cache cleanup completed:`);
        logger.info(`   - Firestore cleared: ${cleanupResult.firestoreCleared}`);
        logger.info(`   - Memory cleared: ${cleanupResult.memoryCleared}`);
        logger.info(`   - Valid remaining: ${cleanupResult.validRemaining}`);
        logger.info(`📊 Updated cache stats: ${JSON.stringify(stats)}`);
        
        return {
            success: true,
            trigger: 'cleanup',
            cleanupResult,
            stats
        };
        
    } catch (error) {
        logger.error(`❌ Cache cleanup failed: ${error.message}`);
        throw error;
    }
});

/**
 * 📊 HOURLY CACHE MONITORING - Every hour
 * Monitor cache performance and health
 */
exports.hourlyCacheMonitoring = onSchedule({
    schedule: '0 * * * *', // Every hour at minute 0
    timeZone: 'UTC',
    memory: '256MiB',
    timeoutSeconds: 120
}, async (event) => {
    const weatherService = new UnifiedWeatherService();
    
    try {
        const stats = await weatherService.getCacheStats();
        
        // Log stats for monitoring
        logger.info(`📊 Hourly cache stats: ${JSON.stringify(stats)}`);
        
        // Alert if cache hit rate is too low
        const hitRate = parseFloat(stats.hitRatePercent);
        if (hitRate < 75) {
            logger.warn(`⚠️ Low cache hit rate: ${hitRate}% (target: >75%)`);
        }
        
        // Alert if too many expired entries
        if (stats.expired > stats.total * 0.2) {
            logger.warn(`⚠️ High expired cache ratio: ${stats.expired}/${stats.total} (${(stats.expired/stats.total*100).toFixed(1)}%)`);
        }
        
        return {
            success: true,
            trigger: 'hourly_monitoring',
            stats,
            alerts: {
                lowHitRate: hitRate < 75,
                highExpiredRatio: stats.expired > stats.total * 0.2
            }
        };
        
    } catch (error) {
        logger.error(`❌ Cache monitoring failed: ${error.message}`);
        return {
            success: false,
            trigger: 'hourly_monitoring',
            error: error.message
        };
    }
});

/**
 * 🔧 MANUAL CACHE REFRESH TRIGGER
 * For manual cache refresh (never runs automatically)
 */
exports.manualWeatherRefresh = onSchedule({
    schedule: '0 0 31 2 *', // Feb 31st (never exists) - manual trigger only
    timeZone: 'UTC',
    memory: '1GiB',
    timeoutSeconds: 540
}, async (event) => {
    logger.info('🔧 Manual weather cache refresh triggered');
    
    const weatherService = new UnifiedWeatherService();
    
    try {
        // Force refresh without cache check
        const result = await weatherService.warmCacheForKnownLocations();
        
        logger.info(`✅ Manual refresh completed: ${result.summary.successful} successful, ${result.summary.failed} failed`);
        
        return {
            success: true,
            trigger: 'manual',
            ...result
        };
        
    } catch (error) {
        logger.error(`❌ Manual refresh failed: ${error.message}`);
        throw error;
    }
});

/**
 * Helper function to get cache warming status
 * Can be called from HTTP endpoints for monitoring
 */
async function getCacheWarmingStatus() {
    const weatherService = new UnifiedWeatherService();
    
    try {
        const stats = await weatherService.getCacheStats();
        
        return {
            success: true,
            status: 'healthy',
            stats,
            lastUpdated: new Date().toISOString(),
            nextScheduled: {
                dawn: '05:00 UTC',
                morning: '08:00 UTC', 
                midday: '12:00 UTC',
                evening: '17:00 UTC',
                cleanup: '03:30 UTC'
            }
        };
        
    } catch (error) {
        return {
            success: false,
            status: 'error',
            error: error.message,
            lastUpdated: new Date().toISOString()
        };
    }
}

module.exports = {
    getCacheWarmingStatus
};
