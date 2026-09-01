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
    const { calibrationOffsets = new Map(), limitedWeatherFallback = false, previousScore = null, hydrologyContext = null } = options;

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
        weatherService.getMarineData(locationQuery)
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

    const waterTempC = marineHour?.water_temp_c || Math.max(2, mlFeatures.temperature - 8);

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
            precipMm:      mlFeatures.precipMm || 0,
            precipChancePercent: mlFeatures.precipChancePercent || 0,
            hasWarnings:   smartWarnings.length > 0
        },
        warnings: {
            hasWarnings: smartWarnings.length > 0,
            count: smartWarnings.length,
            messages: smartWarnings,
            warningType: smartWarnings.length > 0 ? 'weather' : null
        }
    };
}

module.exports = { computePaddleScoreForSpot };
