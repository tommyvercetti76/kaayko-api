// functions/api/weather/paddleScoreCompute.js
//
// Canonical paddle score computation pipeline.
// No Express router, no Firestore reads/writes — pure computation.
// Imported by paddleScoreWarmer.js (batch) and paddleScore.js (live requests).

const UnifiedWeatherService = require('./unifiedWeatherService');
const { getPrediction } = require('./mlService');
const { standardizeForMLModel } = require('./dataStandardization');
const { calibrateModelPrediction } = require('./modelCalibration');
const { applyEnhancedPenalties } = require('./paddlePenalties');
const { getSmartWarnings } = require('./smartWarnings');

/**
 * Compute a paddle score for a single location.
 *
 * @param {object} loc - { id: string, lat: number, lng: number, name: string }
 * @param {object} options
 * @param {Map<string,number>} [options.calibrationOffsets] - Per-spot bias offsets from feedback loop
 * @returns {Promise<object|null>} Score payload or null if weather unavailable
 */
async function computePaddleScoreForSpot(loc, options = {}) {
    const { calibrationOffsets = new Map() } = options;

    if (!loc.lat || !loc.lng) {
        console.warn(`computePaddleScoreForSpot: missing coordinates for ${loc.id}`);
        return null;
    }

    const locationQuery = `${loc.lat},${loc.lng}`;
    const weatherService = new UnifiedWeatherService();

    // Fetch weather and marine data in parallel — saves 200-400ms vs sequential
    const [weatherResult, marineResult] = await Promise.allSettled([
        weatherService.getWeatherData(locationQuery, { includeForecast: false, useCache: true }),
        weatherService.getMarineData(locationQuery)
    ]);

    const weatherData = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
    const marineData  = marineResult.status === 'fulfilled'  ? marineResult.value  : null;

    if (!weatherData?.current) {
        console.warn(`computePaddleScoreForSpot: no weather data for ${loc.id} (${locationQuery})`);
        return null;
    }

    const current = weatherData.current;
    const marineHour = marineData?.forecast?.forecastday?.[0]?.hour?.[0];

    // Standardize into 57-feature ML input
    const mlFeatures = standardizeForMLModel({
        temperature: current.temperature?.celsius,
        windSpeed:   current.wind?.speedMPH || current.windSpeed,
        gustSpeed:   current.wind?.gustMPH  || (current.wind?.speedMPH || 0) * 1.3,
        windDirection: current.wind?.direction || current.windDirection,
        humidity:    current.atmospheric?.humidity  || current.humidity,
        cloudCover:  current.atmospheric?.cloudCover || current.cloudCover,
        uvIndex:     current.solar?.uvIndex || current.uvIndex,
        visibility:  current.atmospheric?.visibility || current.visibility,
        hasWarnings: current.hasWarnings,
        latitude:    loc.lat,
        longitude:   loc.lng
    }, marineData);

    // ML prediction (with built-in fallback to rule-based if Cloud Run is down)
    let prediction;
    try {
        prediction = await getPrediction(mlFeatures);
    } catch (err) {
        console.warn(`computePaddleScoreForSpot: ML prediction failed for ${loc.id}: ${err.message}`);
        return null;
    }

    if (!prediction?.success) {
        return null;
    }

    // Apply model calibration (trend, seasonal, location, wind pattern adjustments)
    const calibratedPrediction = calibrateModelPrediction(
        prediction.rating,
        {
            temperature: mlFeatures.temperature,
            windSpeed:   mlFeatures.windSpeed,
            gustSpeed:   mlFeatures.gustSpeed,
            humidity:    mlFeatures.humidity,
            cloudCover:  mlFeatures.cloudCover,
            uvIndex:     mlFeatures.uvIndex,
            visibility:  mlFeatures.visibility
        },
        weatherData.forecast,
        { latitude: loc.lat, longitude: loc.lng }
    );

    // Apply enhanced penalties (wind, temp, wave, precip, visibility, marine)
    const penaltyResult = applyEnhancedPenalties(
        calibratedPrediction.calibratedRating,
        mlFeatures,
        marineData
    );

    // Apply per-spot dynamic calibration offset from feedback loop (defaults to 0)
    const dynamicOffset = calibrationOffsets.get(loc.id) || 0;
    let finalRating = penaltyResult.finalRating + dynamicOffset;
    finalRating = Math.max(1.0, Math.min(5.0, finalRating));
    finalRating = Math.round(finalRating * 2) / 2;

    // Generate smart warnings
    const smartWarnings = getSmartWarnings(
        {
            temperature: mlFeatures.temperature,
            windSpeed:   mlFeatures.windSpeed,
            gustSpeed:   mlFeatures.gustSpeed,
            humidity:    mlFeatures.humidity,
            cloudCover:  mlFeatures.cloudCover,
            uvIndex:     mlFeatures.uvIndex,
            visibility:  mlFeatures.visibility,
            waterTemp:   marineHour?.water_temp_c || (mlFeatures.temperature - 8)
        },
        weatherData,
        { latitude: loc.lat, longitude: loc.lng }
    );

    return {
        rating: finalRating,
        interpretation: getInterpretation(finalRating),
        confidence: prediction.confidence || 'high',
        mlModelUsed: prediction.mlModelUsed,
        predictionSource: prediction.predictionSource,
        originalMLRating: calibratedPrediction.originalRating,
        calibrationApplied: calibratedPrediction.adjustments.length > 0,
        adjustments: calibratedPrediction.adjustments,
        penaltiesApplied: penaltyResult.penaltiesApplied || [],
        dynamicOffset,
        conditions: {
            temperature: mlFeatures.temperature,
            windSpeed:   mlFeatures.windSpeed,
            hasWarnings: smartWarnings.length > 0
        },
        warnings: {
            hasWarnings: smartWarnings.length > 0,
            count: smartWarnings.length,
            messages: smartWarnings,
            warningType: smartWarnings.length > 0 ? 'weather' : null
        },
        computedAt: new Date().toISOString()
    };
}

function getInterpretation(rating) {
    if (rating >= 4.5) return 'Excellent';
    if (rating >= 4.0) return 'Great';
    if (rating >= 3.5) return 'Good';
    if (rating >= 3.0) return 'Fair';
    if (rating >= 2.5) return 'Below Average';
    if (rating >= 2.0) return 'Poor';
    return 'Very Poor';
}

module.exports = { computePaddleScoreForSpot };
