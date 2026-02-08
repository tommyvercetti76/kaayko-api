// Weather Helpers – pure utility functions (no class state)

const https = require('https');
const { WEATHER_CONFIG } = require('../../config/weatherConfig');
const { validateCoordinates } = require('./sharedWeatherUtils');

/** Normalize location input to a consistent format */
function normalizeLocation(location) {
  if (typeof location === 'string') {
    const coordMatch = location.trim().match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      const validation = validateCoordinates(lat, lng);
      if (!validation.isValid) throw new Error(`Invalid coordinates: ${validation.errors.join(', ')}`);
      const { latitude, longitude } = validation.coordinates;
      return { type: 'coordinates', value: `${latitude},${longitude}`, display: `${latitude},${longitude}`, lat: latitude, lng: longitude };
    }
    return { type: 'name', value: location.trim(), display: location.trim() };
  }
  if (location && location.lat !== undefined && location.lng !== undefined) {
    const validation = validateCoordinates(location.lat, location.lng);
    if (!validation.isValid) throw new Error(`Invalid coordinates: ${validation.errors.join(', ')}`);
    const { latitude, longitude } = validation.coordinates;
    return { type: 'coordinates', value: `${latitude},${longitude}`, display: `${latitude},${longitude}`, lat: latitude, lng: longitude };
  }
  throw new Error('Location must be a string name or object with lat/lng properties');
}

/** Generate deterministic cache key */
function generateCacheKey(normalizedLocation, includeForecast) {
  const prefix = normalizedLocation.type === 'coordinates' ? 'coord' : 'loc';
  const suffix = includeForecast ? '_forecast' : '_weather';
  return `${prefix}:${normalizedLocation.value.toLowerCase()}${suffix}:v2`;
}

/** Make HTTP request to WeatherAPI */
function makeHTTPRequest(url, type) {
  console.log(`🔗 Making ${type} request to WeatherAPI`);
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: WEATHER_CONFIG.TIMEOUT }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`WeatherAPI Error: ${parsed.error.message}`));
          } else {
            resolve(parsed);
          }
        } catch (error) {
          reject(new Error(`Invalid JSON response from WeatherAPI: ${error.message}`));
        }
      });
    });
    req.on('error', (error) => reject(error));
    req.on('timeout', () => { req.destroy(); reject(new Error('WeatherAPI request timeout')); });
  });
}

/** Transform WeatherAPI response into Kaayko standard format */
function standardizeWeatherResponse(weatherData) {
  if (!weatherData.current || !weatherData.location) {
    throw new Error('Invalid weather data structure from WeatherAPI');
  }

  const standardized = {
    location: {
      name: weatherData.location.name,
      region: weatherData.location.region,
      country: weatherData.location.country,
      coordinates: { latitude: weatherData.location.lat, longitude: weatherData.location.lon },
      timeZone: weatherData.location.tz_id,
      localTime: weatherData.location.localtime
    },
    current: {
      temperature: {
        celsius: weatherData.current.temp_c, fahrenheit: weatherData.current.temp_f,
        feelsLikeC: weatherData.current.feelslike_c, feelsLikeF: weatherData.current.feelslike_f
      },
      wind: {
        speedKPH: weatherData.current.wind_kph, speedMPH: weatherData.current.wind_mph,
        direction: weatherData.current.wind_dir, degree: weatherData.current.wind_degree,
        gustKPH: weatherData.current.gust_kph || weatherData.current.wind_kph,
        gustMPH: weatherData.current.gust_mph || weatherData.current.wind_mph
      },
      atmospheric: {
        humidity: weatherData.current.humidity, pressure: weatherData.current.pressure_mb,
        visibility: weatherData.current.vis_km, cloudCover: weatherData.current.cloud
      },
      conditions: {
        text: weatherData.current.condition.text,
        code: weatherData.current.condition.code,
        icon: weatherData.current.condition.icon
      },
      solar: { uvIndex: weatherData.current.uv, isDay: weatherData.current.is_day === 1 },
      precipitation: { amountMM: weatherData.current.precip_mm }
    }
  };

  if (weatherData.forecast && weatherData.forecast.forecastday) {
    standardized.forecast = weatherData.forecast.forecastday.map(day => ({
      date: day.date,
      day: {
        maxTempC: day.day.maxtemp_c, minTempC: day.day.mintemp_c, avgTempC: day.day.avgtemp_c,
        maxWindKPH: day.day.maxwind_kph, totalPrecipMM: day.day.totalprecip_mm, condition: day.day.condition
      },
      hourly: day.hour ? day.hour.map(h => ({
        time: h.time, tempC: h.temp_c, windKPH: h.wind_kph, windDir: h.wind_dir,
        humidity: h.humidity, cloudCover: h.cloud, uvIndex: h.uv, precipMM: h.precip_mm, condition: h.condition
      })) : []
    }));
  }

  if (weatherData.alerts && weatherData.alerts.alert) {
    standardized.alerts = weatherData.alerts.alert.map(a => ({
      title: a.headline, description: a.desc, severity: a.severity, urgency: a.urgency, areas: a.areas
    }));
  }

  return standardized;
}

module.exports = {
  normalizeLocation,
  generateCacheKey,
  makeHTTPRequest,
  standardizeWeatherResponse
};
