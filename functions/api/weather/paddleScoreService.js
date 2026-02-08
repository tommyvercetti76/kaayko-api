/**
 * Paddle Score Service — ML-powered condition rating engine
 * @module api/weather/paddleScoreService
 */

const admin = require('firebase-admin');
const UnifiedWeatherService = require('./unifiedWeatherService');
const { getPrediction } = require('./mlService');
const { standardizeForMLModel } = require('./dataStandardization');
const { calibrateModelPrediction } = require('./modelCalibration');
const { getSmartWarnings } = require('./smartWarnings');
const ForecastCache = require('../../cache/forecastCache');

const db = admin.firestore();

/**
 * Compute paddle score for given coordinates / spotId.
 * Returns a ready-to-send response object.
 */
async function computePaddleScore(latitude, longitude, spotId) {
  let locationQuery, locationData;

  if (spotId) {
    const spot = await getLocationFromSpotId(spotId);
    if (!spot) return { success: false, _status: 404, error: 'Paddling spot not found', spotId, available_via: '/paddlingOut' };
    locationQuery = `${spot.coordinates.latitude},${spot.coordinates.longitude}`;
    locationData = spot;
  } else {
    locationQuery = `${latitude},${longitude}`;
    locationData = { name: `Location ${latitude}, ${longitude}`, coordinates: { latitude, longitude } };
  }

  console.log(`PaddleScore request: ${locationQuery}`);

  // Check cache
  const cache = new ForecastCache();
  const cacheKey = `current_${locationQuery.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  const cachedConditions = await cache.getCachedCurrentConditions(cacheKey);

  if (cachedConditions) {
    console.log(`Cache hit (${cachedConditions.metadata.cacheAgeMinutes.toFixed(1)} min old)`);
    return { success: true, ...cachedConditions, location: locationData };
  }

  // Cache miss — fetch fresh data
  console.log('Cache miss — fetching fresh current conditions');
  const weatherService = new UnifiedWeatherService();
  const weatherData = await weatherService.getWeatherData(locationQuery, { includeForecast: false, useCache: false });

  let marineData = null;
  try {
    marineData = await weatherService.getMarineData(locationQuery);
    console.log('🌊 Marine data:', marineData?.forecast ? 'Available' : 'Not available');
  } catch (_) { console.log('ℹ️ Marine data not available (likely inland)'); }

  if (!weatherData?.current) {
    return { success: false, _status: 500, error: 'Failed to get weather data', location: locationQuery };
  }

  const current = weatherData.current;
  const marineHour = marineData?.forecast?.forecastday?.[0]?.hour?.[0];

  // Standardize + predict
  const mlInputData = standardizeForMLModel({
    temperature: current.temperature?.celsius,
    windSpeed: current.wind?.speedMPH, windSpeedKph: current.wind?.speedKPH,
    gustSpeed: current.wind?.gustMPH, gustSpeedKph: current.wind?.gustKPH,
    windDirection: current.wind?.direction,
    humidity: current.atmospheric?.humidity, cloudCover: current.atmospheric?.cloudCover,
    uvIndex: current.solar?.uvIndex, visibility: current.atmospheric?.visibility,
    hasWarnings: current.hasWarnings, latitude, longitude
  }, marineData);

  let prediction = await getPrediction(mlInputData);

  const calibrated = calibrateModelPrediction(
    prediction.rating,
    { temperature: mlInputData.temperature, windSpeed: mlInputData.windSpeed,
      gustSpeed: mlInputData.gustSpeed, humidity: mlInputData.humidity,
      cloudCover: mlInputData.cloudCover, uvIndex: mlInputData.uvIndex,
      visibility: mlInputData.visibility },
    weatherData.forecast, { latitude, longitude }
  );

  prediction.rating = calibrated.calibratedRating;
  prediction.originalMLRating = calibrated.originalRating;
  prediction.calibrationApplied = true;
  prediction.adjustments = calibrated.adjustments;

  if (!prediction.success) {
    return { success: false, _status: 500, error: 'ML prediction failed', details: prediction.error || 'Unknown error' };
  }

  const smartWarnings = getSmartWarnings(
    { temperature: mlInputData.temperature, windSpeed: mlInputData.windSpeed,
      gustSpeed: mlInputData.gustSpeed, humidity: mlInputData.humidity,
      cloudCover: mlInputData.cloudCover, uvIndex: mlInputData.uvIndex,
      visibility: mlInputData.visibility,
      waterTemp: marineHour?.water_temp_c || (mlInputData.temperature - 8) },
    weatherData, { latitude, longitude }
  );

  // Build response
  const response = {
    success: true,
    location: {
      name: locationData.name, coordinates: locationData.coordinates,
      region: weatherData.location?.region, country: weatherData.location?.country
    },
    paddleScore: {
      rating: prediction.rating,
      interpretation: getInterpretation(prediction.rating),
      confidence: prediction.confidence || 'high',
      mlModelUsed: prediction.mlModelUsed, predictionSource: prediction.predictionSource,
      modelType: prediction.modelType, originalMLRating: prediction.originalMLRating,
      calibrationApplied: prediction.calibrationApplied, adjustments: prediction.adjustments,
      isGoldStandard: true, v3ModelUsed: true
    },
    warnings: {
      hasWarnings: smartWarnings.length > 0, count: smartWarnings.length,
      messages: smartWarnings, warningType: smartWarnings.length > 0 ? 'weather' : null
    },
    conditions: {
      temperature: current.temperature?.celsius,
      windSpeed: current.wind?.speedMPH || current.windSpeed,
      beaufortScale: Math.min(Math.floor((current.wind?.speedMPH || current.windSpeed || 0) / 3), 12),
      uvIndex: current.solar?.uvIndex || current.uvIndex,
      visibility: current.atmospheric?.visibility || current.visibility,
      humidity: current.atmospheric?.humidity || current.humidity,
      cloudCover: current.atmospheric?.cloudCover || current.cloudCover,
      hasWarnings: current.hasWarnings, marineDataAvailable: !!marineData,
      ...(marineData && { marine: {
        waveHeight: marineHour?.sig_ht_mt || null, swellHeight: marineHour?.swell_ht_mt || null,
        swellDirection: marineHour?.swell_dir || null, swellPeriod: marineHour?.swell_period_secs || null,
        waterTemp: marineHour?.water_temp_c || null,
        tides: marineData?.forecast?.forecastday?.[0]?.astro ? {
          sunrise: marineData.forecast.forecastday[0].astro.sunrise,
          sunset: marineData.forecast.forecastday[0].astro.sunset,
          moonPhase: marineData.forecast.forecastday[0].astro.moon_phase
        } : null,
        rawMarineHour: marineHour
      }})
    },
    metadata: {
      source: prediction.predictionSource, modelType: prediction.modelType,
      timestamp: new Date().toISOString()
    }
  };

  // Cache (fire & forget)
  cache.storeCurrentConditions(cacheKey, response).catch(err =>
    console.warn(`Failed to cache: ${err.message}`)
  );

  return response;
}

/** Look up location from known paddling spot ID. */
async function getLocationFromSpotId(spotId) {
  try {
    const doc = await db.collection('paddlingSpots').doc(spotId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (!data.location?.latitude || !data.location?.longitude) return null;
    return { name: data.lakeName || spotId, coordinates: { latitude: data.location.latitude, longitude: data.location.longitude } };
  } catch (error) {
    console.error(`Failed to get location for ${spotId}:`, error);
    return null;
  }
}

/** Rating → human-readable interpretation. */
function getInterpretation(rating) {
  if (rating >= 4.5) return 'Excellent - Perfect paddling conditions';
  if (rating >= 4.0) return 'Great - Very good conditions';
  if (rating >= 3.5) return 'Good - Favorable conditions';
  if (rating >= 3.0) return 'Fair - Decent conditions';
  if (rating >= 2.5) return 'Below Average - Challenging conditions';
  if (rating >= 2.0) return 'Poor - Difficult conditions';
  return 'Very Poor - Not recommended';
}

module.exports = { computePaddleScore, getLocationFromSpotId, getInterpretation };
