// File: functions/src/scheduled/cacheCleanup.js

const { onSchedule } = require('firebase-functions/v2/scheduler');
const cache = require('../utils/cache');

/**
 * Scheduled function to clean up expired cache entries
 * Runs every hour to prevent Firestore from growing too large
 */
exports.cleanupExpiredCache = onSchedule(
  {
    schedule: 'every 1 hours',
    timeZone: 'UTC',
    memory: '256MiB',
    maxInstances: 1
  },
  async (event) => {
    console.log('🧹 Starting cache cleanup...');
    
    try {
      await cache.cleanup();
      console.log('✅ Cache cleanup completed successfully');
    } catch (error) {
      console.error('❌ Cache cleanup failed:', error);
      throw error;
    }
  }
);
