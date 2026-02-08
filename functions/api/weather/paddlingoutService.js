/**
 * Paddling Out Service — Paddle score computation for spot listings
 * @module api/weather/paddlingoutService
 */

const UnifiedWeatherService = require('./unifiedWeatherService');
const { getPrediction } = require('./mlService');
const { calibrateModelPrediction } = require('./modelCalibration');
const { standardizeForMLModel } = require('./dataStandardization');
const { getSmartWarnings } = require('./smartWarnings');

/**
 * Get paddle score for a specific location using ML model.
 * @param {object} location - Location object with { latitude, longitude }
 * @returns {Promise<object|null>} Paddle score data or null
 */
async function getPaddleScoreForLocation(location) {
  try {
    if (!location.latitude || !location.longitude) return null;

    const locationQuery = `${location.latitude},${location.longitude}`;
    const weatherService = new UnifiedWeatherService();
    const weatherData = await weatherService.getWeatherData(locationQuery, {
      includeForecast: false, useCache: true
    });

    let marineData = null;
    try { marineData = await weatherService.getMarineData(locationQuery); }
    catch (_) { console.log(`ℹ️ Marine data not available for ${locationQuery}`); }

    if (!weatherData?.current) return null;
    const current = weatherData.current;

    const mlFeatures = standardizeForMLModel({
      temperature: current.temperature?.celsius,
      windSpeed: current.wind?.speedMPH || current.windSpeed,
      gustSpeed: current.wind?.gustMPH || (current.wind?.speedMPH * 1.3),
      windDirection: current.wind?.direction || current.windDirection,
      humidity: current.atmospheric?.humidity || current.humidity,
      cloudCover: current.atmospheric?.cloudCover || current.cloudCover,
      uvIndex: current.solar?.uvIndex || current.uvIndex,
      visibility: current.atmospheric?.visibility || current.visibility,
      hasWarnings: current.hasWarnings,
      latitude: location.latitude, longitude: location.longitude
    }, marineData);

    let prediction = await getPrediction(mlFeatures);
    if (!prediction.success) return null;

    const calibrated = calibrateModelPrediction(
      prediction.rating,
      {
        temperature: current.temperature?.celsius,
        windSpeed: current.wind?.speedMPH || current.windSpeed,
        gustSpeed: current.wind?.gustMPH || (current.wind?.speedMPH * 1.3),
        humidity: current.atmospheric?.humidity || current.humidity,
        cloudCover: current.atmospheric?.cloudCover || current.cloudCover,
        uvIndex: current.solar?.uvIndex || current.uvIndex,
        visibility: current.atmospheric?.visibility || current.visibility
      },
      weatherData.forecast,
      { latitude: location.latitude, longitude: location.longitude }
    );
    prediction.rating = calibrated.calibratedRating;

    const smartWarnings = getSmartWarnings(
      {
        temperature: current.temperature?.celsius,
        windSpeed: current.wind?.speedMPH || current.windSpeed,
        gustSpeed: current.wind?.gustMPH || (current.wind?.speedMPH * 1.3),
        humidity: current.atmospheric?.humidity || current.humidity,
        cloudCover: current.atmospheric?.cloudCover || current.cloudCover,
        uvIndex: current.solar?.uvIndex || current.uvIndex,
        visibility: current.atmospheric?.visibility || current.visibility,
        waterTemp: current.marine?.water_temp_c || (current.temperature?.celsius - 8)
      },
      weatherData,
      { latitude: location.latitude, longitude: location.longitude }
    );

    return {
      rating: prediction.rating,
      interpretation: getScoreInterpretation(prediction.rating),
      confidence: prediction.confidence || 'high',
      mlModelUsed: prediction.mlModelUsed,
      predictionSource: prediction.predictionSource,
      originalMLRating: calibrated.originalRating,
      calibrationApplied: calibrated.adjustments.length > 0,
      adjustments: calibrated.adjustments,
      conditions: {
        temperature: mlFeatures.temperature,
        windSpeed: mlFeatures.windSpeed,
        hasWarnings: smartWarnings.length > 0
      },
      warnings: {
        hasWarnings: smartWarnings.length > 0,
        count: smartWarnings.length,
        messages: smartWarnings,
        warningType: smartWarnings.length > 0 ? 'weather' : null
      }
    };
  } catch (error) {
    console.error(`❌ Paddle score failed for ${location.latitude},${location.longitude}:`, error);
    return null;
  }
}

/**
 * Rating → human-readable interpretation.
 */
function getScoreInterpretation(rating) {
  if (rating >= 4.5) return 'Excellent';
  if (rating >= 4.0) return 'Great';
  if (rating >= 3.5) return 'Good';
  if (rating >= 3.0) return 'Fair';
  if (rating >= 2.5) return 'Below Average';
  if (rating >= 2.0) return 'Poor';
  return 'Very Poor';
}

module.exports = { getPaddleScoreForLocation, getScoreInterpretation };
