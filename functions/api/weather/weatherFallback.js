// Weather Fallback – coordinate precision fallback + city lookup + geo fallback
// Handles WeatherAPI coverage gaps for remote paddling locations

const { WEATHER_CONFIG } = require('../../config/weatherConfig');
const { makeHTTPRequest } = require('./weatherHelpers');

/** Try a coordinate query and validate returned location is nearby */
async function tryCoordinateQuery(lat, lng, includeForecast) {
  const query = `${lat},${lng}`;
  const requestLat = parseFloat(lat);
  const requestLng = parseFloat(lng);

  let result;
  if (includeForecast) {
    const url = `${WEATHER_CONFIG.BASE_URL}/forecast.json?key=${WEATHER_CONFIG.API_KEY_VALUE}&q=${encodeURIComponent(query)}&days=3&aqi=yes&alerts=yes`;
    result = await makeHTTPRequest(url, 'forecast');
  } else {
    const url = `${WEATHER_CONFIG.CURRENT_URL}?key=${WEATHER_CONFIG.API_KEY_VALUE}&q=${encodeURIComponent(query)}&aqi=yes`;
    result = await makeHTTPRequest(url, 'current');
  }

  const returnedLat = parseFloat(result.location.lat);
  const returnedLng = parseFloat(result.location.lon);
  const latDiff = Math.abs(requestLat - returnedLat);
  const lngDiff = Math.abs(requestLng - returnedLng);

  if (latDiff > 5 || lngDiff > 5) {
    throw new Error(`WeatherAPI returned wrong location: requested ${requestLat},${requestLng} but got ${returnedLat},${returnedLng}`);
  }
  return result;
}

/** Map coordinates to known nearby cities for paddling locations */
function getCityFromCoordinates(lat, lng) {
  // Specific cities near paddling locations
  if (lat >= 38.9 && lat <= 39.1 && lng >= -106.0 && lng <= -105.8) return 'Fairplay,Colorado,United States';
  if (lat >= 38.5 && lat <= 38.7 && lng >= -109.7 && lng <= -109.4) return 'Moab,Utah,United States';
  if (lat >= 38.7 && lat <= 38.9 && lng >= -106.4 && lng <= -106.1) return 'Gunnison,Colorado,United States';
  if (lat >= 43.8 && lat <= 44.0 && lng >= -110.8 && lng <= -110.5) return 'Jackson,Wyoming,United States';
  if (lat >= 43.7 && lat <= 43.8 && lng >= -110.8 && lng <= -110.6) return 'Jackson,Wyoming,United States';
  if (lat >= 38.4 && lat <= 38.5 && lng >= -109.5 && lng <= -109.3) return 'Moab,Utah,United States';
  if (lat >= 36.9 && lat <= 37.1 && lng >= -111.7 && lng <= -111.3) return 'Kanab,Utah,United States';
  if (lat >= 38.7 && lat <= 38.9 && lng >= -106.7 && lng <= -106.4) return 'Crested Butte,Colorado,United States';

  // General US regions
  if (lat >= 25 && lat <= 49 && lng >= -125 && lng <= -66) {
    if (lat >= 39 && lng >= -108 && lng <= -102) return 'Denver,Colorado,United States';
    if (lat >= 37 && lat <= 42 && lng >= -114 && lng <= -109) return 'Salt Lake City,Utah,United States';
    if (lat >= 41 && lat <= 45 && lng >= -111 && lng <= -104) return 'Cheyenne,Wyoming,United States';
  }
  return null;
}

/** Get known-good coordinates for a region (last resort) */
function getGeographicalFallback(lat, lng) {
  if (lat >= 38.7 && lat <= 39.3 && lng >= -107 && lng <= -105.5) return { name: 'Denver', lat: 39.7392, lng: -104.9903 };
  if (lat >= 36.5 && lat <= 39 && lng >= -112 && lng <= -109) return { name: 'Salt Lake City', lat: 40.7608, lng: -111.8910 };
  if (lat >= 43.5 && lat <= 44.5 && lng >= -111 && lng <= -110) return { name: 'Jackson', lat: 43.4799, lng: -110.7624 };
  if (lat >= 25 && lat <= 49 && lng >= -125 && lng <= -66) return { name: 'Denver', lat: 39.7392, lng: -104.9903 };
  return null;
}

/**
 * Coordinate fallback system – tries multiple precision levels,
 * nearby offsets, city lookup, and geographical fallback.
 */
async function fetchWithCoordinateFallback(normalizedLocation, includeForecast) {
  const originalLat = normalizedLocation.lat;
  const originalLng = normalizedLocation.lng;

  console.log(`🔄 Starting coordinate fallback for: ${originalLat},${originalLng}`);

  // Strategy 1: Original coordinates
  try {
    return await tryCoordinateQuery(originalLat, originalLng, includeForecast);
  } catch (e) { console.log(`  ❌ Original failed: ${e.message}`); }

  // Strategy 2: 4-decimal precision
  try {
    const lat4 = Math.round(originalLat * 10000) / 10000;
    const lng4 = Math.round(originalLng * 10000) / 10000;
    return await tryCoordinateQuery(lat4, lng4, includeForecast);
  } catch (e) { console.log(`  ❌ 4-decimal failed: ${e.message}`); }

  // Strategy 3: 3-decimal precision
  try {
    const lat3 = Math.round(originalLat * 1000) / 1000;
    const lng3 = Math.round(originalLng * 1000) / 1000;
    return await tryCoordinateQuery(lat3, lng3, includeForecast);
  } catch (e) { console.log(`  ❌ 3-decimal failed: ${e.message}`); }

  // Strategy 4: Nearby offsets
  const offsets = [
    [0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05],
    [0.05, 0.05], [-0.05, -0.05], [0.05, -0.05], [-0.05, 0.05],
    [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]
  ];
  for (const [latOff, lngOff] of offsets) {
    try {
      return await tryCoordinateQuery(originalLat + latOff, originalLng + lngOff, includeForecast);
    } catch { /* next offset */ }
  }

  // Strategy 5: City fallback
  try {
    const cityQuery = getCityFromCoordinates(originalLat, originalLng);
    if (cityQuery) {
      let result;
      if (includeForecast) {
        const url = `${WEATHER_CONFIG.BASE_URL}/forecast.json?key=${WEATHER_CONFIG.API_KEY_VALUE}&q=${encodeURIComponent(cityQuery)}&days=3&aqi=yes&alerts=yes`;
        result = await makeHTTPRequest(url, 'forecast');
      } else {
        const url = `${WEATHER_CONFIG.CURRENT_URL}?key=${WEATHER_CONFIG.API_KEY_VALUE}&q=${encodeURIComponent(cityQuery)}&aqi=yes`;
        result = await makeHTTPRequest(url, 'current');
      }
      const latDiff = Math.abs(originalLat - parseFloat(result.location.lat));
      const lngDiff = Math.abs(originalLng - parseFloat(result.location.lon));
      if (latDiff <= 2 && lngDiff <= 2) return result;
    }
  } catch { /* fall through */ }

  // Strategy 6: Geographical fallback
  const geoFallback = getGeographicalFallback(originalLat, originalLng);
  if (geoFallback) {
    console.log(`  🗺️ Using geographical fallback: ${geoFallback.name}`);
    return tryCoordinateQuery(geoFallback.lat, geoFallback.lng, includeForecast);
  }

  throw new Error(`WeatherAPI coverage not available for (${originalLat},${originalLng}) - all fallback strategies exhausted`);
}

module.exports = {
  tryCoordinateQuery,
  getCityFromCoordinates,
  getGeographicalFallback,
  fetchWithCoordinateFallback
};
