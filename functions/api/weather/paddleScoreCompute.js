// functions/api/weather/paddleScoreCompute.js
//
// Current-conditions paddle score for a single location: fetches weather + marine,
// standardizes features, and delegates ALL scoring to scoringPipeline.js (the one
// core shared with the hourly forecast paths).
// No Express router, no Firestore reads/writes — pure computation.
// Imported by paddleScoreWarmer.js (batch) and paddleScore.js (live requests).

const UnifiedWeatherService = require('./unifiedWeatherService');
const { standardizeForMLModel } = require('./dataStandardization');
const { scoreFromFeatures, selectMarineHour } = require('./scoringPipeline');

/**
 * First daylight hour at or after `fromHour` across the standardized forecast.
 * Returns { date, hour, time } or null when the forecast can't answer.
 */
function findNextDaylightHour(weatherData, fromHour) {
    const days = weatherData.forecast || [];
    for (let d = 0; d < days.length; d++) {
        for (const h of days[d].hourly || []) {
            const hourNum = parseInt(String(h.time).split(' ')[1], 10);
            if (d === 0 && hourNum <= fromHour) continue;
            if (h.isDay) return { date: days[d].date, hour: hourNum, time: h.time };
        }
    }
    return null;
}

/**
 * Compute a paddle score for a single location.
 *
 * @param {object} loc - { id: string, lat: number, lng: number, name: string }
 * @param {object} options
 * @param {Map<string,number>} [options.calibrationOffsets] - Per-spot bias offsets from feedback loop
 * @param {boolean} [options.limitedWeatherFallback] - Cap the coordinate-fallback chain (batch/anonymous callers)
 * @param {object} [options.previousScore] - Prior cached scoreData; reuses its ML prediction when inputs are unchanged
 * @returns {Promise<object|null>} Score payload or null if weather unavailable
 */
async function computePaddleScoreForSpot(loc, options = {}) {
    const {
        calibrationOffsets = new Map(),
        limitedWeatherFallback = false,
        previousScore = null,
        hydrologyContext = null,
        // Marine (wave/swell/sea-surface-temp) is OFF unless a spot is explicitly
        // coastal. WeatherAPI's marine endpoint does not error or snap to the
        // ocean for a landlocked point — it FABRICATES a full marine record.
        // Verified 2026-09-01: Antero Reservoir (8,900 ft, Colorado Rockies)
        // returned "1.4 m waves, 0.7 m swell @ 5.2 s, 28.8 °C water", which fired
        // WAVE/SWELL penalties and published "Moderate waves (4.6 ft)" on an
        // alpine reservoir. Inland water gets no marine data at all — consistent
        // with the pipeline's "never penalize for data we don't have" rule.
        marineApplicable = false
    } = options;

    if (!loc.lat || !loc.lng) {
        console.warn(`computePaddleScoreForSpot: missing coordinates for ${loc.id}`);
        return null;
    }

    const locationQuery = `${loc.lat},${loc.lng}`;
    const weatherService = new UnifiedWeatherService();

    // Fetch weather and marine data in parallel — saves 200-400ms vs sequential.
    // includeForecast: true is required for government alerts (WeatherAPI only returns
    // them on forecast.json), which feed the hasWarnings safety penalty.
    const [weatherResult, marineResult] = await Promise.allSettled([
        weatherService.getWeatherData(locationQuery, { includeForecast: true, useCache: true, limitedFallback: limitedWeatherFallback }),
        marineApplicable ? weatherService.getMarineData(locationQuery) : Promise.resolve(null)
    ]);

    const weatherData = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
    const marineData  = marineResult.status === 'fulfilled'  ? marineResult.value  : null;

    if (!weatherData?.current) {
        console.warn(`computePaddleScoreForSpot: no weather data for ${loc.id} (${locationQuery})`);
        return null;
    }

    const current = weatherData.current;

    // Location-local hour drives marine + PoP hourly indexing ("2026-08-31 19:05")
    const localHourStr = String(weatherData.location?.localTime || '').split(' ')[1];
    const localHour = Math.max(0, Math.min(23, parseInt(localHourStr, 10) || 0));
    const marineHour = selectMarineHour(marineData, localHour);

    // PoP: current.json has no chance-of-rain — source it from this hour's forecast
    const forecastHour = weatherData.forecast?.[0]?.hourly?.[localHour];

    // Standardize into ML input — pass ALL available real values
    const mlFeatures = standardizeForMLModel({
        temperature:   current.temperature?.celsius,
        windSpeed:     current.wind?.speedMPH  || current.windSpeed,
        gustSpeed:     current.wind?.gustMPH   || (current.wind?.speedMPH || 0) * 1.3,
        windDirection: current.wind?.direction || current.windDirection,
        humidity:      current.atmospheric?.humidity   || current.humidity,
        cloudCover:    current.atmospheric?.cloudCover || current.cloudCover,
        uvIndex:       current.solar?.uvIndex  || current.uvIndex,
        // Real visibility — never default to 10 when we have actual data
        visibility:    current.atmospheric?.visibility ?? current.visibility ?? 10,
        hasWarnings:   current.hasWarnings,
        // Precipitation — critical for accuracy in rain events
        precipMm:      current.precipitation?.amountMM ?? 0,
        precipChancePercent: forecastHour?.chance_of_rain ?? 0,
        hour:          localHour,
        latitude:  loc.lat,
        longitude: loc.lng
    }, marineData, marineHour);

    // Water temperature estimate. Water has enormous thermal mass — it tracks the
    // DAY's average air temperature, not the current hour. Estimating from
    // instantaneous air made an alpine lake read 2 °C at night (tripping the
    // harshest cold-water penalty) purely because the air had dropped after dark.
    const measuredWaterTemp = marineHour?.water_temp_c ?? null;
    const avgAirToday = weatherData.forecast?.[0]?.day?.avgTempC;
    const airForWaterEstimate = Number.isFinite(avgAirToday) ? avgAirToday : mlFeatures.temperature;
    const waterTempC = measuredWaterTemp ?? Math.max(2, airForWaterEstimate - 8);

    // Night gate: Kaayko does not score night paddling (see methodology/terms).
    // The score is still computed, but surfaces present it as unavailable and
    // point at the next daylight hour instead.
    const isDay = current.solar?.isDay !== false;
    const nextDaylight = isDay ? null : findNextDaylightHour(weatherData, localHour);

    let score;
    try {
        score = await scoreFromFeatures({
            mlFeatures,
            marineHour,
            forecast: weatherData.forecast || null,
            loc,
            dynamicOffset: calibrationOffsets.get(loc.id) || 0,
            hydrologyContext,
            weatherData,
            includeWarnings: true,
            warningsConditions: {
                temperature: mlFeatures.temperature,
                windSpeed:   mlFeatures.windSpeed,
                gustSpeed:   mlFeatures.gustSpeed,
                humidity:    mlFeatures.humidity,
                cloudCover:  mlFeatures.cloudCover,
                uvIndex:     mlFeatures.uvIndex,
                visibility:  mlFeatures.visibility,
                waterTemp:   waterTempC
            },
            previousMLResult: previousScore ? {
                mlInputsHash:     previousScore.mlInputsHash,
                originalMLRating: previousScore.originalMLRating,
                mlModelUsed:      previousScore.mlModelUsed,
                predictionSource: previousScore.predictionSource,
                modelType:        previousScore.modelType,
                confidence:       previousScore.confidence,
                riskClass:        previousScore.riskClass,
                explanations:     previousScore.explanations
            } : null
        });
    } catch (err) {
        console.warn(`computePaddleScoreForSpot: scoring failed for ${loc.id}: ${err.message}`);
        return null;
    }

    if (!score) return null;

    const smartWarnings = score.warnings || [];

    return {
        ...score,
        conditions: {
            temperature:   mlFeatures.temperature,                               // °C
            windSpeed:     current.wind?.speedKPH || (mlFeatures.windSpeed * 1.60934), // KPH for display
            windDirection: current.wind?.direction || mlFeatures.windDirection,
            gustSpeed:     current.wind?.gustKPH || (mlFeatures.gustSpeed * 1.60934),  // KPH
            humidity:      mlFeatures.humidity,
            cloudCover:    mlFeatures.cloudCover,
            uvIndex:       mlFeatures.uvIndex,
            visibility:    mlFeatures.visibility,                                // km
            waterTemp:     waterTempC,                                           // °C
            // Inland water has no measured temperature source — say so rather
            // than presenting an estimate as a reading.
            waterTempEstimated: measuredWaterTemp == null,
            precipMm:      mlFeatures.precipMm || 0,
            precipChancePercent: mlFeatures.precipChancePercent || 0,
            isDay,
            hasWarnings:   smartWarnings.length > 0
        },
        night: isDay ? null : { isNight: true, nextDaylight },
        warnings: {
            hasWarnings: smartWarnings.length > 0,
            count: smartWarnings.length,
            messages: smartWarnings,
            warningType: smartWarnings.length > 0 ? 'weather' : null
        }
    };
}

module.exports = { computePaddleScoreForSpot };
