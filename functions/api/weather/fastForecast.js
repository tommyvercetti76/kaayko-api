// File: functions/src/api/fastForecast.js
//
// ⚡ FAST FORECAST API - Cached 3-Day Weather Forecasts
//
// Ultra-fast cached weather forecasts with ML paddle predictions
// Serves pre-computed or rapidly generated forecasts for frontend

const express = require('express');
const rateLimit = require('../../middleware/rateLimit');
const router = express.Router();
// 120 forecasts per client per 10 minutes: far above any real visitor, well below
// what it takes to burn the paid weather quota through cache misses.
router.use(rateLimit(120, 10 * 60 * 1000));
const admin = require('firebase-admin');
const { logger } = require('firebase-functions');
const ForecastCache = require('../../cache/forecastCache');
const UnifiedWeatherService = require('./unifiedWeatherService');
const { standardizeForMLModel, calculateBeaufortFromKph } = require('./dataStandardization');
const { createInputMiddleware } = require('./inputStandardization');
const { getSmartWarnings } = require('./smartWarnings');
const { scoreFromFeatures } = require('./scoringPipeline');
const { ALGORITHM_VERSION } = require('./scoringConstants');
const { applyCraftAdjustment, sanitizeCraft } = require('./craftAdjustments');
const { setPublicCache } = require('../lib/apiResponse');
const { requireAdmin } = require('../../middleware/authMiddleware');

const db = admin.firestore();

/**
 * Transform weather data to match production fastForecast format
 */
async function transformToFastForecastFormat(weatherData, locationQuery) {
    const { current, location, forecast } = weatherData;
    
    if (!forecast || !Array.isArray(forecast)) {
        throw new Error('No forecast data available');
    }
    
    // Marine data is DISABLED for inland water — WeatherAPI fabricates a full
    // marine record (waves, swell, sea-surface temp) for landlocked points
    // rather than erroring, which published invented swell on alpine lakes and
    // rivers. Kaayko is a lake/river product; re-enable per-spot only if a
    // genuinely coastal spot is ever curated.
    const marineData = null;
    
    // Group forecast by days (24 hours each). Hours are scored through a
    // CONCURRENT pool — 72 sequential ML calls made every cache miss take tens
    // of seconds; a pool of 12 brings a miss down to a few seconds.
    const forecastByDays = [];
    const hourTasks = [];

    for (const dayData of forecast.slice(0, 3)) { // Max 3 days
        const forecastDay = {
            date: dayData.date,
            hourly: {}
        };
        forecastByDays.push(forecastDay);

        if (!dayData.hourly || !Array.isArray(dayData.hourly)) {
            continue;
        }

        for (const hourData of dayData.hourly) {
            // Parse the hour from the time string (format: "2025-08-18 14:00")
            const timeParts = hourData.time.split(' ');
            if (timeParts.length !== 2) continue;

            const hourStr = timeParts[1].split(':')[0];
            const hour = parseInt(hourStr, 10);

            if (isNaN(hour) || hour < 0 || hour > 23) continue;

            hourTasks.push(async () => {
            const KPH_TO_MPH = 0.621371;
            const lat = weatherData.location?.coordinates?.latitude || location.coordinates?.latitude;
            const lng = weatherData.location?.coordinates?.longitude || location.coordinates?.longitude;

            // Real gust from API (WeatherAPI hourly has gust_kph)
            const realGustKph = hourData.gust_kph || hourData.gustKph || (hourData.windKPH * 1.3);
            // ?? not || — zero visibility (fog) is real data, not a missing value
            const realVisKm   = hourData.vis_km   ?? hourData.visibility ?? 10;
            const realPrecipMm = hourData.precip_mm ?? hourData.precipMM ?? 0;
            const realRainChancePct = hourData.chance_of_rain ?? hourData.chanceOfRain ?? 0;

            // Marine hour matched by date + time (not midnight-of-day-0)
            let marineHour = null;
            if (marineData?.forecast?.forecastday) {
                const marineDay = marineData.forecast.forecastday.find(d => d.date === dayData.date);
                marineHour = marineDay?.hour?.find(h => h.time === hourData.time) || null;
            }
            // WATER TEMPERATURE — one policy, shared with paddleScoreCompute.js.
            //
            // Two defects lived on this line. First, `||` treats a MEASURED 0.0 C —
            // ice water, the most dangerous possible reading for cold shock — as
            // falsy and silently replaces it with the air-derived estimate. It must
            // be an explicit null check.
            //
            // Second, and worse for trust: this single value was used both as the
            // MODEL INPUT and as the PUBLISHED number. paddleScoreCompute.js adopted
            // MEASURED OR NOTHING and publishes null when nobody measured the water,
            // so the hero read "No sensor" while this path published "81F" for the
            // same river in the same hour, on the same screen. A user who sees that
            // is right to distrust everything else on the page.
            //
            // The split below is the same one paddleScoreCompute makes:
            //   - the model keeps a derived value, because that is how it was trained
            //   - the RULES and the UI get null, so every water rule stands down and
            //     the surface says "no sensor" rather than inventing a temperature.
            // The MODEL's derived input is produced inside standardizeForMLModel from
            // (marineData, marineHour); we do not duplicate it here.
            const measuredWaterTempC = marineHour?.water_temp_c ?? null;
            const waterTempPublished = measuredWaterTempC;   // null when unmeasured — deliberate

            // ML input — real values, no hardcoded defaults. Government alerts are
            // location-wide, so every hour inherits the current alert state.
            const mlInputData = standardizeForMLModel({
                temperature:          hourData.tempC,
                feelsLike:            hourData.feelsLikeC,
                windSpeedKph:         hourData.windKPH,
                windDirection:        hourData.windDir,
                humidity:             hourData.humidity,
                cloudCover:           hourData.cloudCover,
                uvIndex:              hourData.uvIndex,
                visibility:           realVisKm,
                precipMm:             realPrecipMm,
                precipChancePercent:  realRainChancePct,
                gustSpeedKph:         realGustKph,
                hasWarnings:          weatherData.current?.hasWarnings ?? false,
                hour,
                // See paddleScoreCompute.js: `month` is a model feature and its
                // absence made the in-process model reject every vector. Taken
                // from THIS forecast hour's own local timestamp, so an hour
                // three days out is scored against its month, not today's.
                month: (() => {
                    const m = parseInt(String(hourData.time).slice(5, 7), 10);
                    return (m >= 1 && m <= 12) ? m : null;
                })(),
                latitude:  lat,
                longitude: lng
            }, marineData, marineHour);

            // Tell the penalty layer whether anyone actually MEASURED this water.
            // paddlePenalties stands its water rules down only on an explicit
            // `false` (see paddlePenalties.js: `features.waterTempMeasured !== false`).
            // This path never set the flag, so it read as undefined and the water
            // penalties FIRED on the air-derived estimate — while the current-
            // conditions path, which does set it, correctly suppressed them. Same
            // water, same hour, different score. That is the divergence the ONE
            // scoring core exists to prevent.
            mlInputData.waterTempMeasured = measuredWaterTempC !== null;

            // The shared scoring core — same predict→calibrate→penalize→interpret
            // path the current-conditions score uses.
            const score = await scoreFromFeatures({
                mlFeatures: mlInputData,
                marineHour,
                forecast: weatherData.forecast,
                loc: { lat, lng },
                // hourData.time is already LOCATION-LOCAL ("2026-09-18 14:00").
                // Season and forecast-trend calibration read it; a forecast hour
                // three days out must be scored against ITS month and hour, not
                // against the server's clock at request time.
                localTime: hourData.time,
                includeWarnings: false
            });
            if (!score) return;

            // Smart warnings with real data
            const smartWarnings = getSmartWarnings(
                {
                    temperature: hourData.tempC,
                    windSpeed:   hourData.windKPH * KPH_TO_MPH,
                    gustSpeed:   realGustKph      * KPH_TO_MPH,
                    humidity:    hourData.humidity,
                    cloudCover:  hourData.cloudCover,
                    uvIndex:     hourData.uvIndex,
                    visibility:  realVisKm,
                    // null when unmeasured, so the water-temperature warnings stand down
                    waterTemp:   waterTempPublished
                },
                weatherData,
                { latitude: lat, longitude: lng }
            );

            forecastDay.hourly[hour] = {
                // Night gate. Passed through UNCOERCED: weather payloads cached
                // before this field existed have no isDay, and `!== false` would
                // turn "unknown" into "daylight" — which offered a next-daylight
                // window of 10 PM. Consumers must treat undefined as unknown.
                isDay:         hourData.isDay,
                temperature:   hourData.tempC,
                windSpeed:     hourData.windKPH,
                windDirection: hourData.windDir,
                gustSpeed:     realGustKph,
                humidity:      hourData.humidity,
                cloudCover:    hourData.cloudCover,
                uvIndex:       hourData.uvIndex,
                visibility:    realVisKm,
                precipMM:      realPrecipMm,
                chanceOfRain:  realRainChancePct,
                hasWarnings:   smartWarnings.length > 0,
                warnings:      smartWarnings,
                beaufortScale: calculateBeaufortFromKph(hourData.windKPH),
                waterTemp:     waterTempPublished,          // C, or null when no sensor
                waterTempMeasured: measuredWaterTempC !== null,
                marineDataAvailable: !!marineHour,
                prediction: {
                    rating:           score.rating,
                    ratingPrecise:    score.ratingPrecise,
                    interpretation:   score.interpretation,
                    mlModelUsed:      score.mlModelUsed,
                    predictionSource: score.predictionSource,
                    modelType:        score.modelType,
                    degraded:         score.degraded === true,
                    degradedReason:   score.degradedReason ?? null,
                    // 'measured' | 'estimated' | 'unvalidated' — one vocabulary
                    // for every producer, normalized in scoringPipeline (#19).
                    confidence:       score.confidence,
                    confidenceBasis:  score.confidenceBasis ?? null,
                    uncertainty:      score.uncertainty ?? null,
                    algorithmVersion: score.algorithmVersion ?? null,
                    isGoldStandard:   !!score.mlModelUsed,
                    v3ModelUsed:      !!score.mlModelUsed,
                    riskClass:        score.riskClass,
                    originalMLRating:     score.originalMLRating,
                    calibrationApplied:   score.calibrationApplied,
                    adjustments:          score.adjustments,
                    // ── AUDIT-2026-09-18 #9: the forecast path was un-auditable ──
                    // Measured on the live API: an hour whose originalMLRating was
                    // 2.5 published 1.5, and reported `penaltyDetails: []` with
                    // `totalPenalty: null`. A full point of safety deduction had
                    // been applied and NOTHING in the payload said which rule
                    // fired or how much it took. The hero path (paddleScore.js)
                    // reported both all along, so the same deduction was auditable
                    // on one surface and invisible on the other.
                    //
                    // These four fields are now the SAME structured objects the
                    // hero publishes, straight off the shared scoring core — not
                    // re-derived here, so the two surfaces cannot drift again.
                    //
                    // They also carry the only signal that distinguishes a 20 mph
                    // hour from a 40 mph one: both publish a clamped 1.0 rating,
                    // and only totalPenalty/penaltyDetails show how far past the
                    // floor the day is (#21).
                    penaltiesApplied:     score.penaltiesApplied || [],
                    penaltyDetails:       score.penaltyDetails || [],
                    totalPenalty:         score.totalPenalty ?? 0,
                    dynamicOffset:        score.dynamicOffset ?? 0
                },
                originalRating:   score.originalMLRating,
                safetyDeduction:  score.totalPenalty || 0,
                apiRating:        score.rating,
                rating:           score.rating,
                ratingPrecise:    score.ratingPrecise,
                interpretation:   score.interpretation,
                mlModelUsed:      score.mlModelUsed,
                predictionSource: score.predictionSource
            };
            });   // end hour task
        }
    }

    // Concurrency pool over all 72 hour tasks
    const POOL = 12;
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(POOL, hourTasks.length) }, async () => {
        while (cursor < hourTasks.length) {
            const task = hourTasks[cursor++];
            try { await task(); } catch (err) { console.warn(`fastForecast hour task failed: ${err.message}`); }
        }
    }));

    return {
        success: true,
        location: {
            name: location.name,
            region: location.region,
            country: location.country,
            coordinates: {
                latitude: location.coordinates.latitude,
                longitude: location.coordinates.longitude
            }
        },
        forecast: forecastByDays,
        metadata: {
            cached: false,
            processingTimeMs: 0, // Will be set by caller
            algorithmVersion: ALGORITHM_VERSION,
            apiVersion: '2.0',
            cacheAge: 0,
            cacheTime: new Date().toISOString(),
            responseTime: '0ms', // Will be set by caller
            source: 'unified_weather_service',
            fastAPI: true,
            timestamp: new Date().toISOString()
        }
    };
}

/**
 * Calculate Beaufort scale from wind speed (km/h)
 */
/**
 * ⚡ GET /fastForecast
 * Ultra-fast forecast API with Firebase cache
 * 
 * Standardized Input Parameters:
 * - lat & lng: Separate latitude/longitude coordinates  
 * - location: Combined "lat,lng" coordinates
 * - spotId: Known paddling spot ID (for fastest response)
 * 
 * Examples:
 * - /fastForecast?lat=42.3601&lng=-71.0589
 * - /fastForecast?location=42.3601,-71.0589
 * - /fastForecast?spotId=merrimack
 */
router.get('/', createInputMiddleware('fastForecast'), async (req, res) => {
    const startTime = Date.now();
    const cache = new ForecastCache();

    try {
        const { latitude, longitude, spotId } = req.standardizedInputs;

        // Resolve spotId to real coordinates — the old passthrough never worked
        // (spot ids are not WeatherAPI queries and broke the coordinate cache key).
        let lat = latitude;
        let lng = longitude;
        let locationName = `${latitude},${longitude}`;

        if (spotId) {
            const doc = await db.collection('paddlingSpots').doc(spotId).get();
            const spotLat = doc.exists ? doc.data().location?.latitude : null;
            const spotLng = doc.exists ? doc.data().location?.longitude : null;
            if (!Number.isFinite(spotLat) || !Number.isFinite(spotLng)) {
                return res.status(404).json({ success: false, error: 'Unknown spotId', spotId });
            }
            lat = spotLat;
            lng = spotLng;
            locationName = doc.data().lakeName || spotId;
        }
        const locationQuery = `${lat},${lng}`;

        console.log(`⚡ FastForecast: ${locationQuery}`);

        let forecast = null;
        let source = 'unknown';

        // Check cache for custom coordinates
        forecast = await cache.getCachedCustomForecast(lat, lng);
        source = 'coordinate_cache';

        if (!forecast) {
            // Cache miss - generate fresh forecast using UnifiedWeatherService
            try {
                logger.info(`Cache miss for coordinates ${locationQuery} - generating forecast`);

                const weatherService = new UnifiedWeatherService();
                const weatherData = await weatherService.getWeatherData(
                    { lat, lng },
                    { includeForecast: true }
                );

                if (!weatherData || !weatherData.current || !weatherData.location) {
                    throw new Error('Invalid weather data - missing current conditions or location');
                }

                // Transform to the same format as production API.
                // locationQuery is REQUIRED — without it the marine fetch inside the
                // transform silently failed and every hour lost marine data.
                forecast = await transformToFastForecastFormat(weatherData, locationQuery);

                if (forecast.success) {
                    // Update processing time
                    const processingTime = Date.now() - startTime;
                    forecast.metadata.processingTimeMs = processingTime;
                    forecast.metadata.responseTime = `${processingTime}ms`;

                    // Store in cache for future requests
                    await cache.storeCustomForecast(lat, lng, forecast);
                    source = 'api_fresh';
                    
                    // Add cache metadata
                    forecast.metadata = forecast.metadata || {};
                    forecast.metadata.cached = false;
                    forecast.metadata.source = 'live_api';
                }
            } catch (error) {
                logger.error(`Failed to generate forecast: ${error.message}`);
                res.status(503).json({
                    success: false,
                    error: 'Forecast service unavailable',
                    suggestion: 'Try again in a few minutes'
                });
                return;
            }
        }

        // Craft layer — applied at response time so the cached forecast stays
        // craft-neutral. Hour objects carry windSpeed/gustSpeed in KPH.
        //
        // penaltyDetails used to be passed as a hard-coded `[]` here, because the
        // per-hour payload did not store them — so wave escalation (the extra
        // deduction a paddleboard takes in chop) silently never fired on the
        // forecast strip while it did fire on the hero. Finding #9 put the real
        // structured penalties on every hour, so the craft layer now reads them.
        // Craft deltas are clamped to <= 0, so this can only ever make a small
        // craft's forecast MORE cautious, never more optimistic.
        //
        // `?? []` matters: forecasts cached before #9 shipped have no
        // penaltyDetails, and those hours keep the previous behaviour until the
        // cache turns over rather than throwing.
        const craftId = sanitizeCraft(req.query.craft);
        if (craftId !== 'kayak' && Array.isArray(forecast.forecast)) {
            forecast = JSON.parse(JSON.stringify(forecast)); // never mutate a cached object
            for (const day of forecast.forecast) {
                for (const key of Object.keys(day.hourly || {})) {
                    const h = day.hourly[key];
                    const adj = applyCraftAdjustment({
                        rating: h.rating,
                        ratingPrecise: h.ratingPrecise ?? h.rating,
                        conditions: { windSpeed: h.windSpeed, gustSpeed: h.gustSpeed },
                        penaltyDetails: h.prediction?.penaltyDetails ?? []
                    }, craftId);
                    if (adj && adj.craftAdjustment) {
                        h.rating = adj.rating;
                        h.ratingPrecise = adj.ratingPrecise;
                        h.interpretation = adj.interpretation;
                        h.craftAdjustment = adj.craftAdjustment;
                        if (h.prediction) {
                            h.prediction.rating = adj.rating;
                            h.prediction.ratingPrecise = adj.ratingPrecise;
                            h.prediction.interpretation = adj.interpretation;
                        }
                    }
                }
            }
            forecast.metadata = forecast.metadata || {};
            forecast.metadata.craft = craftId;
        }

        const responseTime = Date.now() - startTime;

        // Add performance metadata
        forecast.metadata = forecast.metadata || {};
        forecast.metadata.responseTime = `${responseTime}ms`;
        forecast.metadata.source = source;
        forecast.metadata.fastAPI = true;
        forecast.metadata.timestamp = new Date().toISOString();

        logger.info(`✅ Fast forecast served in ${responseTime}ms (source: ${source})`);

        // Hourly outlook is public and changes slowly — let the CDN carry it.
        setPublicCache(res, 300, 600);
        res.status(200).json(forecast);

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Fast forecast error after ${responseTime}ms: ${error.message}`);
        
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            responseTime: `${responseTime}ms`
        });
    }
});

/**
 * GET /fastForecast/cache/stats - Get cache statistics
 * Admin-only: performs full collection scans and enumerates cached coordinates.
 */
router.get('/cache/stats', requireAdmin, async (req, res) => {
    try {
        const cache = new ForecastCache();
        const stats = await cache.getCacheStats();
        const allForecasts = await cache.getAllCachedForecasts();
        
        res.status(200).json({
            success: true,
            stats,
            cachedLocations: Object.keys(allForecasts),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error(`Cache stats error: ${error.message}`);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

module.exports = router;
