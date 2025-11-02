// File: functions/src/scheduled/forecastScheduler.js
//
// 🕒 SCHEDULED FORECAST GENERATOR
//
// Runs comprehensive forecasts for all paddling locations on schedule
// Caches results for fastForecast API to serve to frontend users
//
// Schedule:
// - Every 4 hours: 5am, 9am, 1pm, 5pm (America/Los_Angeles)

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const { batchGenerateForecasts, getPaddlingLocations } = require('../api/weather/forecast');

/**
 * 🌅 EARLY MORNING FORECAST (5am)
 * Full forecast generation for all paddling spots
 */
exports.earlyMorningForecast = onSchedule({
  schedule: '0 5 * * *', // 5:00 AM every day
  timeZone: 'America/Los_Angeles',
  retryConfig: {
    retryCount: 2,
    maxRetryDuration: '300s'
  }
}, async (event) => {
  logger.info('🌅 Starting early morning forecast at 5am');
  
  try {
    const locations = await getPaddlingLocations();
    const result = await batchGenerateForecasts(locations);
    
    logger.info(`Early morning forecast complete: ${result.successful}/${result.processed} locations`, {
      duration_ms: result.duration_ms,
      failed: result.failed
    });
    
    return result;
  } catch (error) {
    logger.error('Early morning forecast failed:', error);
    throw error;
  }
});

/**
 * 🌞 MORNING FORECAST UPDATE (9am)
 * Refresh forecasts for all locations
 */
exports.morningForecastUpdate = onSchedule({
  schedule: '0 9 * * *', // 9:00 AM every day
  timeZone: 'America/Los_Angeles',
  retryConfig: {
    retryCount: 2,
    maxRetryDuration: '300s'
  }
}, async (event) => {
  logger.info('🌞 Starting morning forecast update at 9am');
  
  try {
    const locations = await getPaddlingLocations();
    const result = await batchGenerateForecasts(locations);
    
    logger.info(`Morning forecast complete: ${result.successful}/${result.processed} locations`, {
      duration_ms: result.duration_ms
    });
    
    return result;
  } catch (error) {
    logger.error('Morning forecast update failed:', error);
    throw error;
  }
});

/**
 * �️ AFTERNOON FORECAST UPDATE (1pm)
 * Update forecasts for afternoon paddlers
 */
exports.afternoonForecastUpdate = onSchedule({
  schedule: '0 13 * * *', // 1:00 PM every day
  timeZone: 'America/Los_Angeles',
  retryConfig: {
    retryCount: 2,
    maxRetryDuration: '300s'
  }
}, async (event) => {
  logger.info('�️ Starting afternoon forecast update at 1pm');
  
  try {
    const locations = await getPaddlingLocations();
    const result = await batchGenerateForecasts(locations);
    
    logger.info(`Afternoon forecast complete: ${result.successful}/${result.processed} locations`, {
      duration_ms: result.duration_ms
    });
    
    return result;
  } catch (error) {
    logger.error('Afternoon forecast update failed:', error);
    throw error;
  }
});

/**
 * 🌆 EVENING FORECAST UPDATE (5pm)
 * Final update for evening/next-day planning
 */
exports.eveningForecastUpdate = onSchedule({
  schedule: '0 17 * * *', // 5:00 PM every day
  timeZone: 'America/Los_Angeles',
  retryConfig: {
    retryCount: 1,
    maxRetryDuration: '180s'
  }
}, async (event) => {
  logger.info('� Starting evening forecast update at 5pm');
  
  try {
    const locations = await getPaddlingLocations();
    const result = await batchGenerateForecasts(locations);
    
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
 * 🗑️ CLEANUP EXPIRED CACHE ENTRIES
 */
async function cleanupExpiredCache() {
  const admin = require('firebase-admin');
  const db = admin.firestore();
  
  try {
    logger.info('🗑️ Starting cache cleanup...');
    
    const now = new Date();
    const expiredSnapshot = await db.collection('forecast_cache')
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
    
    const recentCache = await db.collection('forecast_cache')
      .where('cached_at', '>', new Date(Date.now() - 4 * 60 * 60 * 1000)) // 4 hours ago
      .limit(1)
      .get();
    
    if (!recentCache.empty) {
      logger.info('Recent cache found, skipping emergency refresh');
      return { success: true, skipped: 'recent_cache_exists' };
    }
    
    logger.info('No recent cache found, running emergency forecast...');
    const locations = await getPaddlingLocations();
    const result = await batchGenerateForecasts(locations);
    
    logger.info(`Emergency forecast complete: ${result.successful}/${result.processed} locations`);
    
    return result;
  } catch (error) {
    logger.error('Emergency forecast refresh failed:', error);
    throw error;
  }
});

/**
 * FORECAST SCHEDULER HEALTH CHECK
 */
exports.forecastSchedulerHealth = onSchedule({
  schedule: '0 0 * * 0', // Weekly on Sunday at midnight
  timeZone: 'America/Los_Angeles'
}, async (event) => {
  logger.info('Weekly forecast scheduler health check');
  
  try {
    const admin = require('firebase-admin');
    const db = admin.firestore();
    
    // Count total cache entries
    const cacheSnapshot = await db.collection('forecast_cache').get();
    const totalCacheEntries = cacheSnapshot.size;
    
    // Count locations
    const locations = await getPaddlingLocations();
    const totalLocations = locations.length;
    
    // Count recent cache entries (last 24 hours)
    const recentCache = await db.collection('forecast_cache')
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
    
    logger.info('Forecast scheduler health report', healthReport);
    
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
