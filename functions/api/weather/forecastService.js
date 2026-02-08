/**
 * Forecast Service — Core forecast generation & batch processing
 *
 * Used by scheduled jobs (forecastScheduler) and the forecast router.
 * @module api/weather/forecastService
 */

const admin = require('firebase-admin');
const UnifiedWeatherService = require('./unifiedWeatherService');
const { generatePaddleSummary, calculateSafetyLevel } = require('./forecastHelpers');

const db = admin.firestore();

/**
 * 🎯 Generate a comprehensive forecast for one location, cache results.
 */
async function generateComprehensiveForecast(location) {
  console.log(`Generating forecast for ${location} (scheduled)`);
  try {
    const weatherService = new UnifiedWeatherService();
    const weatherData = await weatherService.getWeatherData(location, { includeForecast: true });

    if (!weatherData || !weatherData.current || !weatherData.location)
      throw new Error('Invalid weather data - missing current conditions or location');

    const { current, forecast } = weatherData;
    const result = {
      success: true,
      data: {
        location,
        current: {
          ...current,
          paddle_summary: await generatePaddleSummary(current, weatherData.location),
          safety_level: calculateSafetyLevel(current)
        },
        forecast: await Promise.all(forecast.map(async (hour) => ({
          ...hour,
          paddle_summary: await generatePaddleSummary(hour, weatherData.location),
          safety_level: calculateSafetyLevel(hour)
        }))),
        metadata: {
          generated: new Date().toISOString(),
          cached_until: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          source: 'scheduled-forecast'
        }
      }
    };

    // Cache 3-day forecast for fastForecast API (4-hour TTL)
    const cacheKey = `forecast_${location.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    await db.collection('forecast_cache').doc(cacheKey).set({
      ...result.data, cached_at: new Date(),
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000)
    });

    // Cache current conditions for paddleScore API (20-min TTL)
    const currentCacheKey = `current_${location.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    await db.collection('current_conditions_cache').doc(currentCacheKey).set({
      ...result.data.current, location: weatherData.location,
      cached_at: new Date(), expires_at: new Date(Date.now() + 20 * 60 * 1000)
    });

    console.log(`Cached forecast and current conditions: ${cacheKey}`);
    return result;
  } catch (error) {
    console.error(`❌ Forecast failed for ${location}:`, error);
    return { success: false, location, error: error.message, timestamp: new Date().toISOString() };
  }
}

/**
 * 📦 Process multiple locations in rate-limited batches.
 */
async function batchGenerateForecasts(locations, batchSize = 3) {
  const startTime = Date.now();
  console.log(`Starting batch forecast for ${locations.length} locations`);
  try {
    const results = [];
    let successful = 0, failed = 0;

    for (let i = 0; i < locations.length; i += batchSize) {
      const batch = locations.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.map(l => l.name || l.id).join(', ')}`);

      const batchResults = await Promise.all(batch.map(async (loc) => {
        const result = await generateComprehensiveForecast(loc.query || loc.id);
        result.success ? successful++ : failed++;
        return { locationName: loc.name || loc.id, success: result.success, error: result.error || null };
      }));
      results.push(...batchResults);

      if (i + batchSize < locations.length) {
        console.log('⏳ Waiting 2s before next batch…');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log(`Batch complete: ${successful}/${results.length} successful in ${Date.now() - startTime}ms`);
    return {
      success: true, processed: results.length, successful, failed,
      duration_ms: Date.now() - startTime,
      locations_processed: results.map(r => ({ name: r.locationName, success: r.success, error: r.error || null }))
    };
  } catch (error) {
    console.error('❌ Batch generation failed:', error);
    return { success: false, error: error.message, duration_ms: Date.now() - startTime };
  }
}

/**
 * 📍 Fetch all paddling locations from Firestore.
 */
async function getPaddlingLocations() {
  try {
    const snapshot = await db.collection('paddlingSpots').get();
    const locations = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      let locationQuery = null;
      if (data.location?.coordinates?.lat && data.location?.coordinates?.lng)
        locationQuery = `${data.location.coordinates.lat},${data.location.coordinates.lng}`;
      else if (data.location?.latitude && data.location?.longitude)
        locationQuery = `${data.location.latitude},${data.location.longitude}`;
      else if (data.location?.name) locationQuery = data.location.name;
      else if (data.lakeName) locationQuery = data.lakeName;

      if (locationQuery) {
        locations.push({
          id: doc.id, name: data.lakeName || data.title || doc.id, query: locationQuery,
          latitude: data.location?.latitude || data.location?.coordinates?.lat,
          longitude: data.location?.longitude || data.location?.coordinates?.lng
        });
      }
    });
    console.log(`Found ${locations.length} paddling locations`);
    return locations;
  } catch (error) {
    console.error('❌ Failed to get paddling locations:', error);
    return [];
  }
}

module.exports = { generateComprehensiveForecast, batchGenerateForecasts, getPaddlingLocations };
