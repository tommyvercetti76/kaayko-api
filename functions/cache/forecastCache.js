const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { logger } = require('firebase-functions');

class ForecastCache {
    constructor() {
        this.db = getFirestore();
        this.CACHE_COLLECTION = 'forecast_cache';
        this.CACHE_TTL_HOURS = 3.5; // Refresh every 3.5 hours (fits 6 daily updates)
    }

    /**
     * Get cached forecast for a location
     */
    async getCachedForecast(locationId) {
        try {
            const doc = await this.db
                .collection(this.CACHE_COLLECTION)
                .doc(locationId)
                .get();

            if (!doc.exists) {
                logger.info(`No cache found for location: ${locationId}`);
                return null;
            }

            const data = doc.data();
            const now = new Date();
            const cacheTime = data.cached_at.toDate();
            const hoursSinceCache = (now - cacheTime) / (1000 * 60 * 60);

            if (hoursSinceCache > this.CACHE_TTL_HOURS) {
                logger.info(`Cache expired for location: ${locationId}, hours since cache: ${hoursSinceCache}`);
                return null;
            }

            logger.info(`Cache hit for location: ${locationId}, cached ${hoursSinceCache.toFixed(1)} hours ago`);
            return {
                ...data.forecast,
                metadata: {
                    ...data.forecast.metadata,
                    cached: true,
                    cacheAge: hoursSinceCache,
                    cacheTime: cacheTime.toISOString()
                }
            };
        } catch (error) {
            logger.error(`Error getting cached forecast for ${locationId}:`, error);
            return null;
        }
    }

    /**
     * Store forecast in cache
     */
    async storeForecast(locationId, forecastData) {
        try {
            const cacheDoc = {
                location_id: locationId,
                forecast: forecastData,
                cached_at: FieldValue.serverTimestamp(),
                ttl_hours: this.CACHE_TTL_HOURS
            };

            await this.db
                .collection(this.CACHE_COLLECTION)
                .doc(locationId)
                .set(cacheDoc);

            logger.info(`Forecast cached for location: ${locationId}`);
            return true;
        } catch (error) {
            logger.error(`Error caching forecast for ${locationId}:`, error);
            return false;
        }
    }

    /**
     * Store forecast for custom coordinates (lat/lng hash)
     */
    async storeCustomForecast(lat, lng, forecastData) {
        const locationHash = this.generateLocationHash(lat, lng);
        return this.storeForecast(`custom_${locationHash}`, forecastData);
    }

    /**
     * Get cached forecast for custom coordinates
     */
    async getCachedCustomForecast(lat, lng) {
        const locationHash = this.generateLocationHash(lat, lng);
        return this.getCachedForecast(`custom_${locationHash}`);
    }

    /**
     * Generate consistent hash for lat/lng coordinates
     */
    generateLocationHash(lat, lng) {
        // Round to 3 decimal places for ~100m accuracy
        const roundedLat = Math.round(lat * 1000) / 1000;
        const roundedLng = Math.round(lng * 1000) / 1000;
        return `${roundedLat}_${roundedLng}`.replace(/[.-]/g, '_');
    }

    /**
     * Get all cached forecasts
     */
    async getAllCachedForecasts() {
        try {
            const snapshot = await this.db
                .collection(this.CACHE_COLLECTION)
                .get();

            const forecasts = {};
            snapshot.forEach(doc => {
                const data = doc.data();
                forecasts[doc.id] = {
                    ...data.forecast,
                    cacheInfo: {
                        cached_at: data.cached_at?.toDate?.()?.toISOString(),
                        ttl_hours: data.ttl_hours
                    }
                };
            });

            return forecasts;
        } catch (error) {
            logger.error('Error getting all cached forecasts:', error);
            return {};
        }
    }

    /**
     * Clear expired cache entries
     */
    async clearExpiredCache() {
        try {
            const snapshot = await this.db
                .collection(this.CACHE_COLLECTION)
                .get();

            const now = new Date();
            const expiredDocs = [];

            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.cached_at) {
                    const cacheTime = data.cached_at.toDate();
                    const hoursSinceCache = (now - cacheTime) / (1000 * 60 * 60);
                    
                    if (hoursSinceCache > this.CACHE_TTL_HOURS) {
                        expiredDocs.push(doc.ref);
                    }
                }
            });

            if (expiredDocs.length > 0) {
                const batch = this.db.batch();
                expiredDocs.forEach(docRef => batch.delete(docRef));
                await batch.commit();
                
                logger.info(`Cleared ${expiredDocs.length} expired cache entries`);
            }

            return expiredDocs.length;
        } catch (error) {
            logger.error('Error clearing expired cache:', error);
            return 0;
        }
    }

    /**
     * Get cache statistics
     */
    async getCacheStats() {
        try {
            const snapshot = await this.db
                .collection(this.CACHE_COLLECTION)
                .get();

            const now = new Date();
            let totalEntries = 0;
            let validEntries = 0;
            let expiredEntries = 0;

            snapshot.forEach(doc => {
                totalEntries++;
                const data = doc.data();
                
                if (data.cached_at) {
                    const cacheTime = data.cached_at.toDate();
                    const hoursSinceCache = (now - cacheTime) / (1000 * 60 * 60);
                    
                    if (hoursSinceCache <= this.CACHE_TTL_HOURS) {
                        validEntries++;
                    } else {
                        expiredEntries++;
                    }
                }
            });

            return {
                totalEntries,
                validEntries,
                expiredEntries,
                hitRate: totalEntries > 0 ? (validEntries / totalEntries * 100).toFixed(1) : 0,
                ttlHours: this.CACHE_TTL_HOURS
            };
        } catch (error) {
            logger.error('Error getting cache stats:', error);
            return {
                totalEntries: 0,
                validEntries: 0,
                expiredEntries: 0,
                hitRate: 0,
                ttlHours: this.CACHE_TTL_HOURS
            };
        }
    }

    /**
     * Get cached current conditions (short TTL for real-time feel)
     * TTL: 20 minutes for current conditions
     */
    async getCachedCurrentConditions(locationId) {
        try {
            const doc = await this.db
                .collection('current_conditions_cache')
                .doc(locationId)
                .get();

            if (!doc.exists) {
                return null;
            }

            const data = doc.data();
            const now = new Date();
            const cacheTime = data.cached_at.toDate();
            const minutesSinceCache = (now - cacheTime) / (1000 * 60);

            // 20 minute TTL for current conditions
            if (minutesSinceCache > 20) {
                return null;
            }

            logger.info(`Current conditions cache hit: ${locationId}, cached ${minutesSinceCache.toFixed(1)} min ago`);
            return {
                ...data.conditions,
                metadata: {
                    cached: true,
                    cacheAgeMinutes: minutesSinceCache,
                    cacheTime: cacheTime.toISOString()
                }
            };
        } catch (error) {
            logger.error(`Error getting cached current conditions for ${locationId}:`, error);
            return null;
        }
    }

    /**
     * Store current conditions with short TTL
     */
    async storeCurrentConditions(locationId, conditionsData) {
        try {
            const cacheDoc = {
                location_id: locationId,
                conditions: conditionsData,
                cached_at: FieldValue.serverTimestamp(),
                ttl_minutes: 20
            };

            await this.db
                .collection('current_conditions_cache')
                .doc(locationId)
                .set(cacheDoc);

            logger.info(`Current conditions cached for: ${locationId}`);
            return true;
        } catch (error) {
            logger.error(`Error caching current conditions for ${locationId}:`, error);
            return false;
        }
    }
}

module.exports = ForecastCache;
