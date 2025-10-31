// File: functions/src/services/unifiedWeatherService.js
//
// 🌟 UNIFIED WEATHER SERVICE - Single Source of Truth
// 
// This service consolidates all weather data access:
// - Single API client for WeatherAPI.com
// - Consistent caching strategy
// - Scheduled data collection
// - Frontend isolation from external APIs
//
// Architecture Pattern: "Data Aggregation Layer" with "Cache-Aside"

const https = require('https');
const admin = require('firebase-admin');
const { WEATHER_CONFIG } = require('../../config/weatherConfig');
const { validateCoordinates } = require('./sharedWeatherUtils');

class UnifiedWeatherService {
    constructor() {
        this.db = admin.firestore();
        this.CACHE_COLLECTION = 'unified_weather_cache';
        this.CACHE_TTL_HOURS = 2; // 2 hours for weather data
        this.FORECAST_TTL_HOURS = 4; // 4 hours for forecast data
        
        // In-memory cache for hot data (last 50 requests)
        this.memoryCache = new Map();
        this.MAX_MEMORY_CACHE = 50;
    }

    /**
     * 🎯 MAIN PUBLIC API - Get weather data for any location
     * Frontend should ONLY use this method
     * 
     * @param {string|object} location - Location name or {lat, lng} coordinates
     * @param {object} options - Options: {includeForcast: bool, useCache: bool}
     * @returns {Promise<object>} Standardized weather response
     */
    async getWeatherData(location, options = {}) {
        const startTime = Date.now();
        const { includeForecast = false, useCache = true } = options;
        
        // Normalize location input
        const normalizedLocation = this._normalizeLocation(location);
        const cacheKey = this._generateCacheKey(normalizedLocation, includeForecast);
        
        console.log(`🌤️ Weather request for: ${normalizedLocation.display} (forecast: ${includeForecast})`);
        
        // Try cache first (if enabled)
        if (useCache) {
            const cached = await this._getCachedWeather(cacheKey);
            if (cached) {
                console.log(`⚡ Cache HIT for ${normalizedLocation.display}`);
                return this._addMetadata(cached, startTime, true);
            }
        }
        
        console.log(`📡 Cache MISS - fetching from WeatherAPI for ${normalizedLocation.display}`);
        
        // Fetch fresh data from primary service
        const weatherData = await this._fetchFromWeatherAPI(normalizedLocation, includeForecast);
        
        // Process and standardize
        const standardizedData = this._standardizeWeatherResponse(weatherData);
        
        // Cache the result (fire and forget)
        if (useCache) {
            this._cacheWeatherData(cacheKey, standardizedData, includeForecast).catch(err => 
                console.warn(`Failed to cache weather data: ${err.message}`)
            );
        }
        
        return this._addMetadata(standardizedData, startTime, false, usedBackup ? 'backup' : 'primary');
    }

    /**
     * 📊 Get weather for multiple locations (batch processing)
     * Used by scheduled jobs and bulk operations
     */
    async getWeatherDataBatch(locations, options = {}) {
        const { batchSize = 3, delayMs = 500 } = options;
        const results = [];
        
        console.log(`🚀 Batch weather processing: ${locations.length} locations`);
        
        for (let i = 0; i < locations.length; i += batchSize) {
            const batch = locations.slice(i, i + batchSize);
            
            const batchPromises = batch.map(location => 
                this.getWeatherData(location, { ...options, useCache: false })
                    .catch(error => ({ error: error.message, location }))
            );
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // Delay between batches to respect API limits
            if (i + batchSize < locations.length) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        
        const successful = results.filter(r => !r.error).length;
        const failed = results.filter(r => r.error).length;
        const backupUsed = results.filter(r => r.metadata?.serviceType === 'backup').length;
        
        console.log(`📊 Batch complete: ${successful} successful, ${failed} failed, ${backupUsed} used backup`);
        
        return {
            success: true,
            results,
            summary: { 
                total: locations.length, 
                successful, 
                failed, 
                primaryServiceUsed: successful - backupUsed,
                backupServiceUsed: backupUsed
            }
        };
    }

    /**
     * 🔄 Scheduled job methods - called by Firebase Functions
     */
    async warmCacheForKnownLocations() {
        console.log('🔥 Starting cache warming job...');
        
        // Get known locations from location poller
        const { LocationPoller } = require('../scheduled/locationPoller');
        const poller = new LocationPoller();
        const locations = await poller.getKnownLocations();
        
        // Warm cache with both current weather and 3-day forecasts
        const weatherPromises = locations.map(loc => ({
            location: loc,
            includeForecast: false
        }));
        
        const forecastPromises = locations.map(loc => ({
            location: loc,
            includeForecast: true
        }));
        
        // Process both weather and forecasts
        const allPromises = [...weatherPromises, ...forecastPromises];
        
        return this.getWeatherDataBatch(allPromises, {
            batchSize: 2,
            delayMs: 1000,
            useCache: false // Force fresh data for cache warming
        });
    }

    /**
     * 🧹 Cache management methods
     */
    async cleanExpiredCache() {
        const now = new Date();
        const snapshot = await this.db
            .collection(this.CACHE_COLLECTION)
            .get();

        const expiredDocs = [];
        const validDocs = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.expiresAt && data.expiresAt.toDate() < now) {
                expiredDocs.push(doc.ref);
            } else {
                validDocs.push(doc);
            }
        });

        if (expiredDocs.length > 0) {
            const batch = this.db.batch();
            expiredDocs.forEach(docRef => batch.delete(docRef));
            await batch.commit();
        }

        // Clean memory cache
        const memoryKeys = Array.from(this.memoryCache.keys());
        let memoryCleared = 0;
        
        for (const key of memoryKeys) {
            const entry = this.memoryCache.get(key);
            if (entry && entry.expiresAt < Date.now()) {
                this.memoryCache.delete(key);
                memoryCleared++;
            }
        }

        console.log(`🗑️ Cache cleanup: ${expiredDocs.length} Firestore + ${memoryCleared} memory entries removed`);
        
        return {
            firestoreCleared: expiredDocs.length,
            memoryCleared,
            validRemaining: validDocs.length
        };
    }

    async getCacheStats() {
        const snapshot = await this.db
            .collection(this.CACHE_COLLECTION)
            .get();

        const now = new Date();
        let total = 0;
        let expired = 0;
        let weatherOnly = 0;
        let withForecast = 0;

        snapshot.forEach(doc => {
            total++;
            const data = doc.data();
            
            if (data.expiresAt && data.expiresAt.toDate() < now) {
                expired++;
            }
            
            if (data.type === 'weather') weatherOnly++;
            if (data.type === 'forecast') withForecast++;
        });

        return {
            total,
            valid: total - expired,
            expired,
            weatherOnly,
            withForecast,
            memoryCache: this.memoryCache.size,
            hitRatePercent: total > 0 ? ((total - expired) / total * 100).toFixed(1) : 0
        };
    }

    // =====================================
    // PRIVATE METHODS - Internal Use Only
    // =====================================

    _normalizeLocation(location) {
        if (typeof location === 'string') {
            // Check if string is coordinates (lat,lng format)
            const coordMatch = location.trim().match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
            if (coordMatch) {
                const lat = parseFloat(coordMatch[1]);
                const lng = parseFloat(coordMatch[2]);
                
                const validation = validateCoordinates(lat, lng);
                if (!validation.isValid) {
                    throw new Error(`Invalid coordinates: ${validation.errors.join(', ')}`);
                }
                
                const { latitude, longitude } = validation.coordinates;
                return {
                    type: 'coordinates',
                    value: `${latitude},${longitude}`,
                    display: `${latitude},${longitude}`,
                    lat: latitude,
                    lng: longitude
                };
            }
            
            // Regular location name
            return {
                type: 'name',
                value: location.trim(),
                display: location.trim()
            };
        }
        
        if (location && location.lat !== undefined && location.lng !== undefined) {
            const validation = validateCoordinates(location.lat, location.lng);
            if (!validation.isValid) {
                throw new Error(`Invalid coordinates: ${validation.errors.join(', ')}`);
            }
            
            const { latitude, longitude } = validation.coordinates;
            return {
                type: 'coordinates',
                value: `${latitude},${longitude}`,
                display: `${latitude},${longitude}`,
                lat: latitude,
                lng: longitude
            };
        }
        
        throw new Error('Location must be a string name or object with lat/lng properties');
    }

    _generateCacheKey(normalizedLocation, includeForecast) {
        const prefix = normalizedLocation.type === 'coordinates' ? 'coord' : 'loc';
        const suffix = includeForecast ? '_forecast' : '_weather';
        const version = 'v2'; // Cache version - increment to invalidate old cache
        return `${prefix}:${normalizedLocation.value.toLowerCase()}${suffix}:${version}`;
    }

    async _getCachedWeather(cacheKey) {
        // Check memory cache first
        const memoryEntry = this.memoryCache.get(cacheKey);
        if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
            return memoryEntry.data;
        }

        // Check Firestore cache
        try {
            const doc = await this.db
                .collection(this.CACHE_COLLECTION)
                .doc(cacheKey)
                .get();

            if (doc.exists) {
                const data = doc.data();
                if (data.expiresAt && data.expiresAt.toDate() > new Date()) {
                    // Update memory cache
                    this._updateMemoryCache(cacheKey, data.weatherData, data.expiresAt.toDate());
                    return data.weatherData;
                }
            }
        } catch (error) {
            console.warn(`Cache read error for ${cacheKey}: ${error.message}`);
        }

        return null;
    }

    async _cacheWeatherData(cacheKey, weatherData, includeForecast) {
        const now = new Date();
        const ttlHours = includeForecast ? this.FORECAST_TTL_HOURS : this.CACHE_TTL_HOURS;
        const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

        // Update memory cache
        this._updateMemoryCache(cacheKey, weatherData, expiresAt);

        // Update Firestore cache
        try {
            await this.db
                .collection(this.CACHE_COLLECTION)
                .doc(cacheKey)
                .set({
                    weatherData,
                    cachedAt: now,
                    expiresAt,
                    type: includeForecast ? 'forecast' : 'weather',
                    ttlHours
                });
        } catch (error) {
            console.warn(`Cache write error for ${cacheKey}: ${error.message}`);
        }
    }

    _updateMemoryCache(cacheKey, data, expiresAt) {
        // Implement LRU eviction
        if (this.memoryCache.size >= this.MAX_MEMORY_CACHE) {
            const firstKey = this.memoryCache.keys().next().value;
            this.memoryCache.delete(firstKey);
        }

        this.memoryCache.set(cacheKey, {
            data,
            expiresAt: expiresAt.getTime ? expiresAt.getTime() : expiresAt
        });
    }

    async _fetchFromWeatherAPI(normalizedLocation, includeForecast) {
        const query = normalizedLocation.value;
        
        // COORDINATE FALLBACK SYSTEM - Fix for WeatherAPI coverage changes
        if (normalizedLocation.type === 'coordinates') {
            return this._fetchWithCoordinateFallback(normalizedLocation, includeForecast);
        }
        
        if (includeForecast) {
            const url = `${WEATHER_CONFIG.BASE_URL}/forecast.json?key=${WEATHER_CONFIG.API_KEY_VALUE}&q=${encodeURIComponent(query)}&days=3&aqi=yes&alerts=yes`;
            return this._makeHTTPRequest(url, 'forecast');
        } else {
            const url = `${WEATHER_CONFIG.CURRENT_URL}?key=${WEATHER_CONFIG.API_KEY_VALUE}&q=${encodeURIComponent(query)}&aqi=yes`;
            return this._makeHTTPRequest(url, 'current');
        }
    }

    /**
     * 🎯 COORDINATE FALLBACK SYSTEM
     * Handles WeatherAPI coverage gaps for remote locations
     * Tries multiple coordinate precisions and nearby searches
     */
    async _fetchWithCoordinateFallback(normalizedLocation, includeForecast) {
        const originalLat = normalizedLocation.lat;
        const originalLng = normalizedLocation.lng;
        
        console.log(`🔄 Starting coordinate fallback for: ${originalLat},${originalLng}`);
        
        // Strategy 1: Try original coordinates first
        try {
            console.log(`  1️⃣ Trying original: ${originalLat},${originalLng}`);
            const result = await this._tryCoordinateQuery(originalLat, originalLng, includeForecast);
            console.log(`  ✅ SUCCESS with original coordinates!`);
            return result;
        } catch (error1) {
            console.log(`  ❌ Original failed: ${error1.message}`);
        }
        
        // Strategy 2: Try 4-decimal precision
        try {
            const roundedLat = Math.round(originalLat * 10000) / 10000;
            const roundedLng = Math.round(originalLng * 10000) / 10000;
            console.log(`  2️⃣ Trying 4-decimal precision: ${roundedLat},${roundedLng}`);
            const result = await this._tryCoordinateQuery(roundedLat, roundedLng, includeForecast);
            console.log(`  ✅ SUCCESS with 4-decimal precision!`);
            return result;
        } catch (error2) {
            console.log(`  ❌ 4-decimal precision failed: ${error2.message}`);
        }
        
        // Strategy 3: Try 3-decimal precision
        try {
            const rounded3Lat = Math.round(originalLat * 1000) / 1000;
            const rounded3Lng = Math.round(originalLng * 1000) / 1000;
            console.log(`  3️⃣ Trying 3-decimal precision: ${rounded3Lat},${rounded3Lng}`);
            const result = await this._tryCoordinateQuery(rounded3Lat, rounded3Lng, includeForecast);
            console.log(`  ✅ SUCCESS with 3-decimal precision!`);
            return result;
        } catch (error3) {
            console.log(`  ❌ 3-decimal precision failed: ${error3.message}`);
        }
        
        // Strategy 4: Try nearby coordinates (±0.05 and ±0.1 degree search)
        const offsets = [
            [0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05],
            [0.05, 0.05], [-0.05, -0.05], [0.05, -0.05], [-0.05, 0.05],
            [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]
        ];
        
        for (let i = 0; i < offsets.length; i++) {
            try {
                const [latOffset, lngOffset] = offsets[i];
                const nearbyLat = originalLat + latOffset;
                const nearbyLng = originalLng + lngOffset;
                console.log(`  4️⃣.${i+1} Trying nearby: ${nearbyLat},${nearbyLng} (offset: ${latOffset},${lngOffset})`);
                const result = await this._tryCoordinateQuery(nearbyLat, nearbyLng, includeForecast);
                console.log(`  ✅ SUCCESS with nearby coordinates!`);
                return result;
            } catch (error) {
                // Continue to next offset
            }
        }
        
        // Strategy 5: City/region fallback based on coordinates
        try {
            const cityQuery = this._getCityFromCoordinates(originalLat, originalLng);
            console.log(`  5️⃣ Final fallback - trying city: ${cityQuery}`);
            
            const query = cityQuery;
            let result;
            if (includeForecast) {
                const url = `${WEATHER_CONFIG.BASE_URL}/forecast.json?key=${WEATHER_CONFIG.API_KEY_VALUE}&q=${encodeURIComponent(query)}&days=3&aqi=yes&alerts=yes`;
                result = await this._makeHTTPRequest(url, 'forecast');
            } else {
                const url = `${WEATHER_CONFIG.CURRENT_URL}?key=${WEATHER_CONFIG.API_KEY_VALUE}&q=${encodeURIComponent(query)}&aqi=yes`;
                result = await this._makeHTTPRequest(url, 'current');
            }
            
            // CRITICAL: Validate city fallback coordinates are in reasonable range
            const returnedLat = parseFloat(result.location.lat);
            const returnedLng = parseFloat(result.location.lon);
            const requestLat = parseFloat(originalLat);
            const requestLng = parseFloat(originalLng);
            
            const latDiff = Math.abs(requestLat - returnedLat);
            const lngDiff = Math.abs(requestLng - returnedLng);
            
            // Allow maximum 2 degrees difference for city fallback (roughly 120 miles)
            if (latDiff > 2 || lngDiff > 2) {
                throw new Error(`City fallback returned wrong location: requested area ${requestLat},${requestLng} but got ${returnedLat},${returnedLng} (${latDiff.toFixed(2)}, ${lngDiff.toFixed(2)} degrees off)`);
            }
            
            console.log(`  ✅ SUCCESS with city fallback! Coordinates validated: ${returnedLat},${returnedLng}`);
            return result;
        } catch (finalError) {
            console.error(`  ❌ All fallback strategies failed!`);
            
            // FINAL GEOGRAPHICAL FALLBACK: Use known good coordinates for the region
            const geoFallback = this._getGeographicalFallback(originalLat, originalLng);
            if (geoFallback) {
                console.log(`  🗺️ Using geographical fallback: ${geoFallback.name} (${geoFallback.lat}, ${geoFallback.lng})`);
                return this._tryCoordinateQuery(geoFallback.lat, geoFallback.lng, includeForecast);
            }
            
            throw new Error(`WeatherAPI coverage not available for this remote location (${originalLat},${originalLng}) - all fallback strategies exhausted`);
        }
    }

    async _tryCoordinateQuery(lat, lng, includeForecast) {
        const query = `${lat},${lng}`;
        const requestLat = parseFloat(lat);
        const requestLng = parseFloat(lng);
        
        let result;
        if (includeForecast) {
            const url = `${WEATHER_CONFIG.BASE_URL}/forecast.json?key=${WEATHER_CONFIG.API_KEY_VALUE}&q=${encodeURIComponent(query)}&days=3&aqi=yes&alerts=yes`;
            result = await this._makeHTTPRequest(url, 'forecast');
        } else {
            const url = `${WEATHER_CONFIG.CURRENT_URL}?key=${WEATHER_CONFIG.API_KEY_VALUE}&q=${encodeURIComponent(query)}&aqi=yes`;
            result = await this._makeHTTPRequest(url, 'current');
        }
        
        // CRITICAL: Validate that returned coordinates are reasonable close to requested coordinates
        const returnedLat = parseFloat(result.location.lat);
        const returnedLng = parseFloat(result.location.lon);
        
        // Calculate distance between requested and returned coordinates
        const latDiff = Math.abs(requestLat - returnedLat);
        const lngDiff = Math.abs(requestLng - returnedLng);
        
        // Allow maximum 5 degrees difference (roughly 300 miles)
        if (latDiff > 5 || lngDiff > 5) {
            throw new Error(`WeatherAPI returned wrong location: requested ${requestLat},${requestLng} but got ${returnedLat},${returnedLng} (${latDiff.toFixed(2)}, ${lngDiff.toFixed(2)} degrees off)`);
        }
        
        console.log(`  ✅ Coordinate validation passed: ${returnedLat},${returnedLng} is close to requested ${requestLat},${requestLng}`);
        return result;
    }

        _getCityFromCoordinates(lat, lng) {
        // Specific cities near your paddling locations (based on successful local testing)
        if (lat >= 38.9 && lat <= 39.1 && lng >= -106.0 && lng <= -105.8) return "Fairplay,Colorado,United States"; // Near Antero Reservoir
        if (lat >= 38.5 && lat <= 38.7 && lng >= -109.7 && lng <= -109.4) return "Moab,Utah,United States"; // Near Colorado River
        if (lat >= 38.7 && lat <= 38.9 && lng >= -106.4 && lng <= -106.1) return "Gunnison,Colorado,United States"; // Near Cottonwood Lake
        if (lat >= 43.8 && lat <= 44.0 && lng >= -110.8 && lng <= -110.5) return "Jackson,Wyoming,United States"; // Near Jackson Lake
        if (lat >= 43.7 && lat <= 43.8 && lng >= -110.8 && lng <= -110.6) return "Jackson,Wyoming,United States"; // Near Jenny Lake
        if (lat >= 38.4 && lat <= 38.5 && lng >= -109.5 && lng <= -109.3) return "Moab,Utah,United States"; // Near Kens Lake
        if (lat >= 36.9 && lat <= 37.1 && lng >= -111.7 && lng <= -111.3) return "Kanab,Utah,United States"; // Near Lake Powell
        if (lat >= 38.7 && lat <= 38.9 && lng >= -106.7 && lng <= -106.4) return "Crested Butte,Colorado,United States"; // Near Taylor Park
        
        // General US regions
        if (lat >= 25 && lat <= 49 && lng >= -125 && lng <= -66) {
            // United States - find nearest major city
            if (lat >= 39 && lng >= -108 && lng <= -102) return "Denver,Colorado,United States"; // Colorado area
            if (lat >= 37 && lat <= 42 && lng >= -114 && lng <= -109) return "Salt Lake City,Utah,United States"; // Utah area
            if (lat >= 41 && lat <= 45 && lng >= -111 && lng <= -104) return "Cheyenne,Wyoming,United States"; // Wyoming area
        }
        
        return null;
    }

    _getGeographicalFallback(lat, lng) {
        // Known good coordinates that definitely work with WeatherAPI for each region
        // These are major cities with guaranteed coverage
        
        // Colorado region (Antero, Cottonwood, Taylor Park)
        if (lat >= 38.7 && lat <= 39.3 && lng >= -107 && lng <= -105.5) {
            return { name: "Denver", lat: 39.7392, lng: -104.9903 };
        }
        
        // Utah region (Colorado River, Kens Lake, Lake Powell)
        if (lat >= 36.5 && lat <= 39 && lng >= -112 && lng <= -109) {
            return { name: "Salt Lake City", lat: 40.7608, lng: -111.8910 };
        }
        
        // Wyoming region (Jackson Lake, Jenny Lake)
        if (lat >= 43.5 && lat <= 44.5 && lng >= -111 && lng <= -110) {
            return { name: "Jackson", lat: 43.4799, lng: -110.7624 };
        }
        
        // General US fallback
        if (lat >= 25 && lat <= 49 && lng >= -125 && lng <= -66) {
            return { name: "Denver", lat: 39.7392, lng: -104.9903 };
        }
        
        return null;
    }

    async _makeHTTPRequest(url, type) {
        console.log(`🔗 Making ${type} request to WeatherAPI`);
        console.log(`🔗 URL: ${url.substring(0, 100)}...`); // Log first part of URL
        
        return new Promise((resolve, reject) => {
            const req = https.get(url, { timeout: WEATHER_CONFIG.TIMEOUT }, (res) => {
                let data = '';
                
                console.log(`📡 Response status: ${res.statusCode}`);
                console.log(`📡 Content-Type: ${res.headers['content-type']}`);
                
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    console.log(`📡 Response length: ${data.length}`);
                    console.log(`📡 First 200 chars: ${data.substring(0, 200)}`);
                    
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.error) {
                            reject(new Error(`WeatherAPI Error: ${parsed.error.message}`));
                        } else {
                            console.log(`✅ Successfully parsed ${type} data`);
                            resolve(parsed);
                        }
                    } catch (error) {
                        console.error(`❌ JSON Parse Error: ${error.message}`);
                        console.error(`❌ Raw data: ${data.substring(0, 500)}`);
                        reject(new Error(`Invalid JSON response from WeatherAPI: ${error.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                console.error(`❌ Request error: ${error.message}`);
                reject(error);
            });
            
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('WeatherAPI request timeout'));
            });
        });
    }

    _standardizeWeatherResponse(weatherData) {
        // This method transforms WeatherAPI.com response into our standard format
        // All other services will use this standardized format
        
        if (!weatherData.current || !weatherData.location) {
            throw new Error('Invalid weather data structure from WeatherAPI');
        }

        const standardized = {
            location: {
                name: weatherData.location.name,
                region: weatherData.location.region,
                country: weatherData.location.country,
                coordinates: {
                    latitude: weatherData.location.lat,
                    longitude: weatherData.location.lon
                },
                timeZone: weatherData.location.tz_id,
                localTime: weatherData.location.localtime
            },
            
            current: {
                temperature: {
                    celsius: weatherData.current.temp_c,
                    fahrenheit: weatherData.current.temp_f,
                    feelsLikeC: weatherData.current.feelslike_c,
                    feelsLikeF: weatherData.current.feelslike_f
                },
                wind: {
                    speedKPH: weatherData.current.wind_kph,
                    speedMPH: weatherData.current.wind_mph,
                    direction: weatherData.current.wind_dir,
                    degree: weatherData.current.wind_degree,
                    gustKPH: weatherData.current.gust_kph || weatherData.current.wind_kph,
                    gustMPH: weatherData.current.gust_mph || weatherData.current.wind_mph
                },
                atmospheric: {
                    humidity: weatherData.current.humidity,
                    pressure: weatherData.current.pressure_mb,
                    visibility: weatherData.current.vis_km,
                    cloudCover: weatherData.current.cloud
                },
                conditions: {
                    text: weatherData.current.condition.text,
                    code: weatherData.current.condition.code,
                    icon: weatherData.current.condition.icon
                },
                solar: {
                    uvIndex: weatherData.current.uv,
                    isDay: weatherData.current.is_day === 1
                },
                precipitation: {
                    amountMM: weatherData.current.precip_mm
                }
            }
        };

        // Add forecast data if available
        if (weatherData.forecast && weatherData.forecast.forecastday) {
            standardized.forecast = weatherData.forecast.forecastday.map(day => ({
                date: day.date,
                day: {
                    maxTempC: day.day.maxtemp_c,
                    minTempC: day.day.mintemp_c,
                    avgTempC: day.day.avgtemp_c,
                    maxWindKPH: day.day.maxwind_kph,
                    totalPrecipMM: day.day.totalprecip_mm,
                    condition: day.day.condition
                },
                hourly: day.hour ? day.hour.map(hour => ({
                    time: hour.time,
                    tempC: hour.temp_c,
                    windKPH: hour.wind_kph,
                    windDir: hour.wind_dir,
                    humidity: hour.humidity,
                    cloudCover: hour.cloud,
                    uvIndex: hour.uv,
                    precipMM: hour.precip_mm,
                    condition: hour.condition
                })) : []
            }));
        }

        // Add alerts if available
        if (weatherData.alerts && weatherData.alerts.alert) {
            standardized.alerts = weatherData.alerts.alert.map(alert => ({
                title: alert.headline,
                description: alert.desc,
                severity: alert.severity,
                urgency: alert.urgency,
                areas: alert.areas
            }));
        }

        return standardized;
    }

    /**
     * 🌊 Get marine weather data (wave height, water temperature, tides)
     * 
     * @param {string|object} location - Location name or {lat, lng} coordinates  
     * @returns {Promise<object|null>} Marine data or null if not available
     */
    async getMarineData(location) {
        const normalizedLocation = this._normalizeLocation(location);
        const cacheKey = `marine:${normalizedLocation.value}`;
        
        console.log(`🌊 Marine data request for: ${normalizedLocation.display}`);
        
        // Try cache first
        const cached = await this._getCachedWeather(cacheKey);
        if (cached) {
            console.log('🎯 Marine data: Cache hit');
            return cached;
        }
        
        try {
            const marineUrl = `${WEATHER_CONFIG.MARINE_URL}?key=${WEATHER_CONFIG.API_KEY_VALUE}&q=${encodeURIComponent(normalizedLocation.value)}&days=1&tides=yes`;
            
            const marineData = await this._makeHTTPRequest(marineUrl, 'marine');
            
            if (marineData && !marineData.error) {
                console.log('✅ Marine data: API success');
                
                // Cache marine data for 4 hours
                await this._cacheWeatherData(cacheKey, marineData, this.FORECAST_TTL_HOURS);
                return marineData;
            } else {
                console.log('ℹ️ Marine data: Not available (likely inland location)');
                return null;
            }
            
        } catch (error) {
            console.log('ℹ️ Marine data: Error -', error.message);
            return null;
        }
    }

    _addMetadata(data, startTime, cached, serviceType = 'primary') {
        return {
            ...data,
            metadata: {
                ...data.metadata,
                processingTimeMs: Date.now() - startTime,
                cached,
                service: 'UnifiedWeatherService',
                serviceType: serviceType,
                provider: serviceType === 'backup' ? 'OpenWeatherMap' : 'WeatherAPI',
                version: '1.0.0',
                timestamp: new Date().toISOString()
            }
        };
    }
}

module.exports = UnifiedWeatherService;
