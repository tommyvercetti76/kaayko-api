// Unified Weather Service – single source of truth for weather data
// Delegates to weatherHelpers (pure functions) and weatherFallback (coord recovery)

const admin = require('firebase-admin');
const { WEATHER_CONFIG } = require('../../config/weatherConfig');
const { normalizeLocation, generateCacheKey, makeHTTPRequest, standardizeWeatherResponse } = require('./weatherHelpers');
const { fetchWithCoordinateFallback } = require('./weatherFallback');

class UnifiedWeatherService {
    constructor() {
        this.db = admin.firestore();
        this.CACHE_COLLECTION = 'unified_weather_cache';
        this.CACHE_TTL_HOURS = 2;
        this.FORECAST_TTL_HOURS = 4;
        this.memoryCache = new Map();
        this.MAX_MEMORY_CACHE = 50;
    }

    // ── Public API ───────────────────────────────────────────────────

    async getWeatherData(location, options = {}) {
        const startTime = Date.now();
        const { includeForecast = false, useCache = true } = options;
        const norm = normalizeLocation(location);
        const cacheKey = generateCacheKey(norm, includeForecast);

        console.log(`🌤️ Weather request for: ${norm.display} (forecast: ${includeForecast})`);

        if (useCache) {
            const cached = await this._getCachedWeather(cacheKey);
            if (cached) {
                console.log(`⚡ Cache HIT for ${norm.display}`);
                return this._addMetadata(cached, startTime, true);
            }
        }

        console.log(`📡 Cache MISS – fetching from WeatherAPI for ${norm.display}`);
        const weatherData = await this._fetchFromWeatherAPI(norm, includeForecast);
        const standardized = standardizeWeatherResponse(weatherData);

        if (useCache) {
            this._cacheWeatherData(cacheKey, standardized, includeForecast).catch(err =>
                console.warn(`Failed to cache weather data: ${err.message}`)
            );
        }
        return this._addMetadata(standardized, startTime, false, 'primary');
    }

    async getWeatherDataBatch(locations, options = {}) {
        const { batchSize = 3, delayMs = 500 } = options;
        const results = [];

        for (let i = 0; i < locations.length; i += batchSize) {
            const batch = locations.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(loc => this.getWeatherData(loc, { ...options, useCache: false }).catch(error => ({ error: error.message, location: loc })))
            );
            results.push(...batchResults);
            if (i + batchSize < locations.length) await new Promise(r => setTimeout(r, delayMs));
        }

        const successful = results.filter(r => !r.error).length;
        const failed = results.filter(r => r.error).length;
        const backupUsed = results.filter(r => r.metadata?.serviceType === 'backup').length;

        return { success: true, results, summary: { total: locations.length, successful, failed, primaryServiceUsed: successful - backupUsed, backupServiceUsed: backupUsed } };
    }

    async warmCacheForKnownLocations() {
        console.log('🔥 Starting cache warming job...');
        const { LocationPoller } = require('../../scheduled/locationPoller');
        const poller = new LocationPoller();
        const locations = await poller.getKnownLocations();

        const all = [
            ...locations.map(loc => ({ location: loc, includeForecast: false })),
            ...locations.map(loc => ({ location: loc, includeForecast: true }))
        ];
        return this.getWeatherDataBatch(all, { batchSize: 2, delayMs: 1000, useCache: false });
    }

    async getMarineData(location) {
        const norm = normalizeLocation(location);
        const cacheKey = `marine:${norm.value}`;

        const cached = await this._getCachedWeather(cacheKey);
        if (cached) return cached;

        try {
            const url = `${WEATHER_CONFIG.MARINE_URL}?key=${WEATHER_CONFIG.API_KEY_VALUE}&q=${encodeURIComponent(norm.value)}&days=1&tides=yes`;
            const marineData = await makeHTTPRequest(url, 'marine');
            if (marineData && !marineData.error) {
                await this._cacheWeatherData(cacheKey, marineData, this.FORECAST_TTL_HOURS);
                return marineData;
            }
            return null;
        } catch { return null; }
    }

    // ── Cache ────────────────────────────────────────────────────────

    async _getCachedWeather(cacheKey) {
        const mem = this.memoryCache.get(cacheKey);
        if (mem && mem.expiresAt > Date.now()) return mem.data;

        try {
            const doc = await this.db.collection(this.CACHE_COLLECTION).doc(cacheKey).get();
            if (doc.exists) {
                const d = doc.data();
                if (d.expiresAt && d.expiresAt.toDate() > new Date()) {
                    this._updateMemoryCache(cacheKey, d.weatherData, d.expiresAt.toDate());
                    return d.weatherData;
                }
            }
        } catch (err) { console.warn(`Cache read error for ${cacheKey}: ${err.message}`); }
        return null;
    }

    async _cacheWeatherData(cacheKey, weatherData, includeForecast) {
        const now = new Date();
        const ttl = includeForecast ? this.FORECAST_TTL_HOURS : this.CACHE_TTL_HOURS;
        const expiresAt = new Date(now.getTime() + ttl * 3600000);
        this._updateMemoryCache(cacheKey, weatherData, expiresAt);
        try {
            await this.db.collection(this.CACHE_COLLECTION).doc(cacheKey).set({
                weatherData, cachedAt: now, expiresAt, type: includeForecast ? 'forecast' : 'weather', ttlHours: ttl
            });
        } catch (err) { console.warn(`Cache write error: ${err.message}`); }
    }

    _updateMemoryCache(cacheKey, data, expiresAt) {
        if (this.memoryCache.size >= this.MAX_MEMORY_CACHE) {
            this.memoryCache.delete(this.memoryCache.keys().next().value);
        }
        this.memoryCache.set(cacheKey, { data, expiresAt: expiresAt.getTime ? expiresAt.getTime() : expiresAt });
    }

    async cleanExpiredCache() {
        const now = new Date();
        const snapshot = await this.db.collection(this.CACHE_COLLECTION).get();
        const expired = [];
        let valid = 0;
        snapshot.forEach(doc => {
            const d = doc.data();
            if (d.expiresAt && d.expiresAt.toDate() < now) expired.push(doc.ref);
            else valid++;
        });
        if (expired.length > 0) {
            const batch = this.db.batch();
            expired.forEach(ref => batch.delete(ref));
            await batch.commit();
        }
        let memCleared = 0;
        for (const [key, entry] of this.memoryCache) {
            if (entry.expiresAt < Date.now()) { this.memoryCache.delete(key); memCleared++; }
        }
        console.log(`🗑️ Cache cleanup: ${expired.length} Firestore + ${memCleared} memory entries removed`);
        return { firestoreCleared: expired.length, memoryCleared: memCleared, validRemaining: valid };
    }

    async getCacheStats() {
        const snapshot = await this.db.collection(this.CACHE_COLLECTION).get();
        const now = new Date();
        let total = 0, expired = 0, weatherOnly = 0, withForecast = 0;
        snapshot.forEach(doc => {
            total++;
            const d = doc.data();
            if (d.expiresAt && d.expiresAt.toDate() < now) expired++;
            if (d.type === 'weather') weatherOnly++;
            if (d.type === 'forecast') withForecast++;
        });
        return {
            total, valid: total - expired, expired, weatherOnly, withForecast,
            memoryCache: this.memoryCache.size,
            hitRatePercent: total > 0 ? ((total - expired) / total * 100).toFixed(1) : 0
        };
    }

    // ── Internal ─────────────────────────────────────────────────────

    async _fetchFromWeatherAPI(normalizedLocation, includeForecast) {
        const query = normalizedLocation.value;
        if (normalizedLocation.type === 'coordinates') {
            return fetchWithCoordinateFallback(normalizedLocation, includeForecast);
        }
        if (includeForecast) {
            const url = `${WEATHER_CONFIG.BASE_URL}/forecast.json?key=${WEATHER_CONFIG.API_KEY_VALUE}&q=${encodeURIComponent(query)}&days=3&aqi=yes&alerts=yes`;
            return makeHTTPRequest(url, 'forecast');
        }
        const url = `${WEATHER_CONFIG.CURRENT_URL}?key=${WEATHER_CONFIG.API_KEY_VALUE}&q=${encodeURIComponent(query)}&aqi=yes`;
        return makeHTTPRequest(url, 'current');
    }

    _addMetadata(data, startTime, cached, serviceType = 'primary') {
        return {
            ...data,
            metadata: {
                ...data.metadata,
                processingTimeMs: Date.now() - startTime,
                cached, service: 'UnifiedWeatherService', serviceType,
                provider: serviceType === 'backup' ? 'OpenWeatherMap' : 'WeatherAPI',
                version: '1.0.0', timestamp: new Date().toISOString()
            }
        };
    }
}

module.exports = UnifiedWeatherService;

