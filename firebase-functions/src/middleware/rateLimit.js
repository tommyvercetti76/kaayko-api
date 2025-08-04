// File: functions/src/middleware/rateLimit.js

const { createRateLimitMiddleware } = require('../utils/sharedWeatherUtils');

/**
 * Rate limit middleware factory
 * @param {number} maxRequests - maximum number of requests
 * @param {number} windowMs - time window in milliseconds
 */
function rateLimit(maxRequests, windowMs) {
  return createRateLimitMiddleware(maxRequests, windowMs);
}

module.exports = rateLimit;