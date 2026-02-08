/**
 * Fast Forecast Service — Transform weather data into production format
 * @module api/weather/fastForecastService
 */

const UnifiedWeatherService = require('./unifiedWeatherService');
const mlService = require('./mlService');
const { standardizeForMLModel, calculateBeaufortFromKph } = require('./dataStandardization');
const { calibrateModelPrediction } = require('./modelCalibration');
const { getSmartWarnings } = require('./smartWarnings');

/**
 * Transform weather data to match production fastForecast format.
 * Groups hourly forecast into 3-day buckets with ML predictions.
 */
async function transformToFastForecastFormat(weatherData, locationQuery) {
  const { current, location, forecast } = weatherData;
  if (!forecast || !Array.isArray(forecast)) throw new Error('No forecast data available');

  // Get marine data for consistent penalty application
  let marineData = null;
  try {
    const weatherService = new UnifiedWeatherService();
    marineData = await weatherService.getMarineData(locationQuery);
    console.log('🌊 Marine data for fastForecast:', marineData ? 'Available' : 'Not available');
  } catch (_) { console.log('ℹ️ Marine data not available for fastForecast'); }

  const forecastByDays = [];

  for (const dayData of forecast.slice(0, 3)) {
    const forecastDay = { date: dayData.date, hourly: {} };
    if (!dayData.hourly || !Array.isArray(dayData.hourly)) continue;

    for (const hourData of dayData.hourly) {
      const timeParts = hourData.time.split(' ');
      if (timeParts.length !== 2) continue;
      const hour = parseInt(timeParts[1].split(':')[0], 10);
      if (isNaN(hour) || hour < 0 || hour > 23) continue;

      const lat = weatherData.location?.coordinates?.latitude || location.coordinates?.latitude;
      const lng = weatherData.location?.coordinates?.longitude || location.coordinates?.longitude;

      const mlInputData = standardizeForMLModel({
        temperature: hourData.tempC, windSpeedKph: hourData.windKPH,
        windDirection: hourData.windDir, humidity: hourData.humidity,
        cloudCover: hourData.cloudCover, uvIndex: hourData.uvIndex,
        visibility: 10, hasWarnings: false, latitude: lat, longitude: lng
      }, marineData);

      const prediction = await mlService.getPrediction(mlInputData);

      const windMph = hourData.windKPH * 0.621371;
      const gustMph = (hourData.windKPH * 1.3) * 0.621371;

      const calibratedPrediction = calibrateModelPrediction(
        prediction.rating,
        { temperature: hourData.tempC, windSpeed: windMph, gustSpeed: gustMph,
          humidity: hourData.humidity, cloudCover: hourData.cloudCover,
          uvIndex: hourData.uvIndex, visibility: 10 },
        weatherData.forecast, { latitude: lat, longitude: lng }
      );
      const finalRating = calibratedPrediction.calibratedRating;

      // Extract water temperature from marine data for this hour
      let waterTemp = null;
      if (marineData?.forecast?.forecastday) {
        const marineDay = marineData.forecast.forecastday.find(d => d.date === dayData.date);
        const marineHour = marineDay?.hour?.find(h => h.time === hourData.time);
        if (marineHour?.water_temp_c) waterTemp = marineHour.water_temp_c;
      }

      const smartWarnings = getSmartWarnings(
        { temperature: hourData.tempC, windSpeed: windMph, gustSpeed: gustMph,
          humidity: hourData.humidity, cloudCover: hourData.cloudCover,
          uvIndex: hourData.uvIndex, visibility: 10, waterTemp },
        weatherData, { latitude: lat, longitude: lng }
      );

      forecastDay.hourly[hour] = {
        temperature: hourData.tempC, windSpeed: hourData.windKPH,
        windDirection: hourData.windDir, gustSpeed: hourData.windKPH * 1.3,
        humidity: hourData.humidity, cloudCover: hourData.cloudCover,
        uvIndex: hourData.uvIndex, visibility: 10,
        hasWarnings: smartWarnings.length > 0, warnings: smartWarnings,
        beaufortScale: calculateBeaufortFromKph(hourData.windKPH),
        waterTemp: Math.max(2, hourData.tempC - 8),
        marineDataAvailable: !!marineData,
        prediction: {
          rating: finalRating, mlModelUsed: prediction.mlModelUsed,
          predictionSource: prediction.predictionSource, modelType: prediction.modelType,
          confidence: prediction.confidence, isGoldStandard: true, v3ModelUsed: true,
          originalMLRating: calibratedPrediction.originalRating,
          calibrationApplied: calibratedPrediction.adjustments.length > 0,
          adjustments: calibratedPrediction.adjustments
        },
        originalRating: calibratedPrediction.originalRating,
        safetyDeduction: 0, apiRating: finalRating, rating: finalRating,
        mlModelUsed: prediction.mlModelUsed, predictionSource: prediction.predictionSource
      };
    }
    forecastByDays.push(forecastDay);
  }

  return {
    success: true,
    location: {
      name: location.name, region: location.region, country: location.country,
      coordinates: { latitude: location.coordinates.latitude, longitude: location.coordinates.longitude }
    },
    forecast: forecastByDays,
    metadata: {
      cached: false, processingTimeMs: 0, apiVersion: '2.0', cacheAge: 0,
      mlServiceUrl: 'https://kaayko-ml-service-87383373015.us-central1.run.app',
      cacheTime: new Date().toISOString(), responseTime: '0ms',
      source: 'unified_weather_service', fastAPI: true, timestamp: new Date().toISOString()
    }
  };
}

/**
 * Fetch fresh weather data and transform to fastForecast format.
 */
async function generateFreshForecast(latitude, longitude) {
  const weatherService = new UnifiedWeatherService();
  const weatherData = await weatherService.getWeatherData(
    { lat: latitude, lng: longitude },
    { includeForecast: true }
  );
  if (!weatherData || !weatherData.current || !weatherData.location)
    throw new Error('Invalid weather data - missing current conditions or location');

  return transformToFastForecastFormat(weatherData);
}

module.exports = { transformToFastForecastFormat, generateFreshForecast };
