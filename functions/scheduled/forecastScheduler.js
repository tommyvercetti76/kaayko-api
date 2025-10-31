// File: functions/src/scheduled/forecastScheduler.js
//
// 🕒 SCHEDULED FORECAST GENERATOR
//
// Runs comprehensive forecasts for all paddling locations on schedule
// Caches results for fastForecast API to serve to frontend users
//
// Schedule:
// - Every 2 hours during day (6am - 10pm)
// - Every 4 hours at night (10pm - 6am)

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const { batchGenerateForecasts, getPaddlingLocations } = require('../api/weather/forecast');

/**
 * 🌅 MORNING FORECAST WARMING (6am)
 * Full forecast generation for all paddling spots
 */
exports.morningForecastWarming = onSchedule({
  schedule: '0 6 * * *', // 6:00 AM every day
  timeZone: 'America/Los_Angeles',
  retryConfig: {
    retryCount: 2,
    maxRetryDuration: '300s'
  }
}, async (event) => {
  logger.info('🌅 Starting morning forecast warming at 6am');
  
  try {
    const result = await batchGenerateForecasts();
    
    logger.info(`Morning forecast complete: ${result.successful}/${result.processed} locations`, {
      duration_ms: result.duration_ms,
      failed: result.failed
    });
    
    return result;
  } catch (error) {
    logger.error('Morning forecast warming failed:', error);
    throw error;
  }
});

/**
 * 🌞 MIDDAY FORECAST UPDATE (12pm)
 * Refresh forecasts for high-traffic locations
 */
exports.middayForecastUpdate = onSchedule({
  schedule: '0 12 * * *', // 12:00 PM every day
  timeZone: 'America/Los_Angeles',
  retryConfig: {
    retryCount: 2,
    maxRetryDuration: '300s'
  }
}, async (event) => {
  logger.info('🌞 Starting midday forecast update at 12pm');
  
  try {
    const result = await batchGenerateForecasts();
    
    logger.info(`Midday forecast complete: ${result.successful}/${result.processed} locations`, {
      duration_ms: result.duration_ms
    });
    
    return result;
  } catch (error) {
    logger.error('Midday forecast update failed:', error);
    throw error;
  }
});

/**
 * 🌆 EVENING FORECAST UPDATE (6pm)
 * Update forecasts for next-day planning
 */
exports.eveningForecastUpdate = onSchedule({
  schedule: '0 18 * * *', // 6:00 PM every day
  timeZone: 'America/Los_Angeles',
  retryConfig: {
    retryCount: 2,
    maxRetryDuration: '300s'
  }
}, async (event) => {
  logger.info('🌆 Starting evening forecast update at 6pm');
  
  try {
    const result = await batchGenerateForecasts();
    
    logger.info(`Evening forecast complete: ${result.successful}/${result.processed} locations`, {
      duration_ms: result.duration_ms
    });
    
    return result;
  } catch (error) {
    logger.error('Evening forecast update failed:', error);
    throw error;
  }
});

/**
 * 🌙 NIGHT FORECAST MAINTENANCE (10pm)
 * Light maintenance and cache cleanup
 */
exports.nightForecastMaintenance = onSchedule({
  schedule: '0 22 * * *', // 10:00 PM every day
  timeZone: 'America/Los_Angeles',
  retryConfig: {
    retryCount: 1,
    maxRetryDuration: '180s'
  }
}, async (event) => {
  logger.info('🌙 Starting night forecast maintenance at 10pm');
  
  try {
    // Run forecasts for priority locations only at night
    const locations = await getPaddlingLocations();
    const priorityLocations = locations.slice(0, 10); // Top 10 locations only
    
    logger.info(`Night maintenance: processing ${priorityLocations.length} priority locations`);
    
    const result = await batchGenerateForecasts();
    
    // Also clean up expired cache entries
    await cleanupExpiredCache();
    
    logger.info(`Night maintenance complete: ${result.successful}/${result.processed} locations`);
    
    return result;
  } catch (error) {
    logger.error('Night forecast maintenance failed:', error);
    throw error;
  }
});

/**
 * 🗑️ CLEANUP EXPIRED CACHE ENTRIES
 */
async function cleanupExpiredCache() {
  const admin = require('firebase-admin');
  const db = admin.firestore();
  
  try {
    logger.info('🗑️ Starting cache cleanup...');
    
    const now = new Date();
    const expiredSnapshot = await db.collection('forecastCache')
      .where('expires_at', '<', now)
      .get();
    
    if (expiredSnapshot.empty) {
      logger.info('No expired cache entries found');
      return;
    }
    
    const batch = db.batch();
    let deleteCount = 0;
    
    expiredSnapshot.forEach(doc => {
      batch.delete(doc.ref);
      deleteCount++;
    });
    
    await batch.commit();
    
    logger.info(`🗑️ Cache cleanup complete: deleted ${deleteCount} expired entries`);
    
  } catch (error) {
    logger.error('Cache cleanup failed:', error);
  }
}

/**
 * 🚨 EMERGENCY FORECAST REFRESH
 * Manual trigger for immediate forecast updates
 */
exports.emergencyForecastRefresh = onSchedule({
  schedule: '0 */4 * * *', // Every 4 hours as backup
  timeZone: 'America/Los_Angeles'
}, async (event) => {
  logger.info('🚨 Emergency forecast refresh trigger');
  
  try {
    // Check if regular schedules are working
    const admin = require('firebase-admin');
    const db = admin.firestore();
    
    const recentCache = await db.collection('forecastCache')
      .where('cached_at', '>', new Date(Date.now() - 4 * 60 * 60 * 1000)) // 4 hours ago
      .limit(1)
      .get();
    
    if (!recentCache.empty) {
      logger.info('Recent cache found, skipping emergency refresh');
      return { success: true, skipped: 'recent_cache_exists' };
    }
    
    logger.info('No recent cache found, running emergency forecast...');
    const result = await batchGenerateForecasts();
    
    logger.info(`Emergency forecast complete: ${result.successful}/${result.processed} locations`);
    
    return result;
  } catch (error) {
    logger.error('Emergency forecast refresh failed:', error);
    throw error;
  }
});

/**
 * 📊 FORECAST SCHEDULER HEALTH CHECK
 */
exports.forecastSchedulerHealth = onSchedule({
  schedule: '0 0 * * 0', // Weekly on Sunday at midnight
  timeZone: 'America/Los_Angeles'
}, async (event) => {
  logger.info('📊 Weekly forecast scheduler health check');
  
  try {
    const admin = require('firebase-admin');
    const db = admin.firestore();
    
    // Count total cache entries
    const cacheSnapshot = await db.collection('forecastCache').get();
    const totalCacheEntries = cacheSnapshot.size;
    
    // Count locations
    const locations = await getPaddlingLocations();
    const totalLocations = locations.length;
    
    // Count recent cache entries (last 24 hours)
    const recentCache = await db.collection('forecastCache')
      .where('cached_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
      .get();
    const recentCacheEntries = recentCache.size;
    
    const healthReport = {
      timestamp: new Date().toISOString(),
      total_locations: totalLocations,
      total_cache_entries: totalCacheEntries,
      recent_cache_entries: recentCacheEntries,
      cache_coverage: totalCacheEntries / totalLocations,
      health_status: recentCacheEntries > 0 ? 'healthy' : 'unhealthy'
    };
    
    logger.info('📊 Forecast scheduler health report', healthReport);
    
    // Store health report
    await db.collection('systemHealth').doc('forecastScheduler').set({
      ...healthReport,
      last_check: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return healthReport;
    
  } catch (error) {
    logger.error('Forecast scheduler health check failed:', error);
    throw error;
  }
});
