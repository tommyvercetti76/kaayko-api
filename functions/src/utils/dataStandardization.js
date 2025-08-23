// File: functions/src/utils/dataStandardization.js
//
// 🔧 DATA STANDARDIZATION UTILITY
//
// Ensures consistent units and data formats across all APIs for ML model input
// and penalty calculations. This prevents rating mismatches between paddleScore
// and fastForecast APIs.

/**
 * Standard unit conversion constants
 */
const CONVERSIONS = {
  KPH_TO_MPH: 0.621371,
  MPH_TO_KPH: 1.60934,
  CELSIUS_TO_FAHRENHEIT: (c) => (c * 9/5) + 32,
  FAHRENHEIT_TO_CELSIUS: (f) => (f - 32) * 5/9,
  METERS_TO_FEET: 3.28084,
  FEET_TO_METERS: 0.3048
};

/**
 * Standard defaults for missing data
 */
const DEFAULTS = {
  TEMPERATURE_C: 20,
  WIND_SPEED_MPH: 0,
  UV_INDEX: 0,
  VISIBILITY_KM: 10,
  HUMIDITY_PERCENT: 50,
  CLOUD_COVER_PERCENT: 0,
  WAVE_HEIGHT_M: 0.1,
  WATER_TEMP_OFFSET_C: -8, // Estimate water temp as air temp minus 8°C
  MIN_WATER_TEMP_C: 2,
  GUST_MULTIPLIER: 1.3,
  WIND_WAVE_FACTOR_MPH: 0.02, // For estimating wave height from wind
  WIND_WAVE_THRESHOLD_MPH: 10,
  WIND_WAVE_FACTOR_KPH: 0.04, // For estimating wave height from wind in KPH
  WIND_WAVE_THRESHOLD_KPH: 15
};

/**
 * Calculate Beaufort scale from wind speed in MPH
 * @param {number} windSpeedMph - Wind speed in MPH
 * @returns {number} Beaufort scale (0-12)
 */
function calculateBeaufortFromMph(windSpeedMph) {
  if (windSpeedMph < 1) return 0;
  if (windSpeedMph < 4) return 1;
  if (windSpeedMph < 7) return 2;
  if (windSpeedMph < 11) return 3;
  if (windSpeedMph < 16) return 4;
  if (windSpeedMph < 22) return 5;
  if (windSpeedMph < 28) return 6;
  if (windSpeedMph < 34) return 7;
  if (windSpeedMph < 41) return 8;
  if (windSpeedMph < 48) return 9;
  if (windSpeedMph < 56) return 10;
  if (windSpeedMph < 64) return 11;
  return 12;
}

/**
 * Calculate Beaufort scale from wind speed in KPH
 * @param {number} windSpeedKph - Wind speed in KPH
 * @returns {number} Beaufort scale (0-12)
 */
function calculateBeaufortFromKph(windSpeedKph) {
  if (windSpeedKph < 2) return 0;
  if (windSpeedKph < 6) return 1;
  if (windSpeedKph < 12) return 2;
  if (windSpeedKph < 20) return 3;
  if (windSpeedKph < 29) return 4;
  if (windSpeedKph < 39) return 5;
  if (windSpeedKph < 50) return 6;
  if (windSpeedKph < 62) return 7;
  if (windSpeedKph < 75) return 8;
  if (windSpeedKph < 89) return 9;
  if (windSpeedKph < 103) return 10;
  if (windSpeedKph < 118) return 11;
  return 12;
}

/**
 * Standardize weather data for ML model input
 * All outputs are in standard units expected by ML model and penalty system
 * 
 * @param {object} rawData - Raw weather data from various sources
 * @param {object} marineData - Optional marine data
 * @returns {object} Standardized features for ML model
 */
function standardizeForMLModel(rawData, marineData = null) {
  const {
    // Temperature (accept both C and F)
    temperature,
    temperatureC, 
    tempC,
    temperatureF,
    tempF,
    
    // Wind (accept both MPH and KPH)
    windSpeed,
    windSpeedMph,
    windSpeedKph,
    windKPH,
    gustSpeed,
    gustSpeedMph,
    gustSpeedKph,
    
    // Other weather parameters
    windDirection,
    windDir,
    humidity,
    cloudCover,
    uvIndex,
    visibility,
    hasWarnings,
    
    // Location
    latitude,
    longitude
  } = rawData;

  // Standardize temperature to Celsius (ML model expects Celsius)
  let standardTemp = DEFAULTS.TEMPERATURE_C;
  if (temperature !== undefined) standardTemp = temperature;
  else if (temperatureC !== undefined) standardTemp = temperatureC;
  else if (tempC !== undefined) standardTemp = tempC;
  else if (temperatureF !== undefined) standardTemp = CONVERSIONS.FAHRENHEIT_TO_CELSIUS(temperatureF);
  else if (tempF !== undefined) standardTemp = CONVERSIONS.FAHRENHEIT_TO_CELSIUS(tempF);

  // Standardize wind speed to MPH (ML model expects MPH)
  let standardWindMph = DEFAULTS.WIND_SPEED_MPH;
  if (windSpeedMph !== undefined) standardWindMph = windSpeedMph;
  else if (windSpeed !== undefined) {
    // Assume windSpeed is in MPH if no unit specified
    standardWindMph = windSpeed;
  } else if (windSpeedKph !== undefined) {
    standardWindMph = windSpeedKph * CONVERSIONS.KPH_TO_MPH;
  } else if (windKPH !== undefined) {
    standardWindMph = windKPH * CONVERSIONS.KPH_TO_MPH;
  }

  // Standardize gust speed to MPH
  let standardGustMph = standardWindMph * DEFAULTS.GUST_MULTIPLIER;
  if (gustSpeedMph !== undefined) standardGustMph = gustSpeedMph;
  else if (gustSpeed !== undefined) {
    // Assume gustSpeed is in MPH if no unit specified
    standardGustMph = gustSpeed;
  } else if (gustSpeedKph !== undefined) {
    standardGustMph = gustSpeedKph * CONVERSIONS.KPH_TO_MPH;
  }

  // Marine data integration
  const marineHour = marineData?.forecast?.forecastday?.[0]?.hour?.[0];
  
  return {
    // Core weather parameters (standardized units)
    temperature: standardTemp, // °C
    windSpeed: standardWindMph, // MPH
    gustSpeed: standardGustMph, // MPH
    windDirection: windDirection || windDir || 0,
    
    // Derived parameters
    beaufortScale: calculateBeaufortFromMph(standardWindMph),
    
    // Environmental conditions
    humidity: humidity || DEFAULTS.HUMIDITY_PERCENT,
    cloudCover: cloudCover || DEFAULTS.CLOUD_COVER_PERCENT,
    uvIndex: uvIndex || DEFAULTS.UV_INDEX,
    visibility: visibility || DEFAULTS.VISIBILITY_KM,
    hasWarnings: hasWarnings || false,
    
    // Marine conditions (standardized)
    waveHeight: marineHour?.sig_ht_mt || 
                (standardWindMph > DEFAULTS.WIND_WAVE_THRESHOLD_MPH ? 
                 standardWindMph * DEFAULTS.WIND_WAVE_FACTOR_MPH : 
                 DEFAULTS.WAVE_HEIGHT_M),
    waterTemp: marineHour?.water_temp_c || 
               Math.max(DEFAULTS.MIN_WATER_TEMP_C, standardTemp + DEFAULTS.WATER_TEMP_OFFSET_C),
    
    // Location
    latitude: latitude || 0,
    longitude: longitude || 0
  };
}

/**
 * Standardize data for penalty calculations
 * Ensures consistent penalty application across all APIs
 * 
 * @param {object} rawData - Raw weather data
 * @param {object} marineData - Optional marine data
 * @returns {object} Standardized features for penalty system
 */
function standardizeForPenalties(rawData, marineData = null) {
  // Penalty system expects specific units - use same standardization as ML model
  return standardizeForMLModel(rawData, marineData);
}

module.exports = {
  CONVERSIONS,
  DEFAULTS,
  calculateBeaufortFromMph,
  calculateBeaufortFromKph,
  standardizeForMLModel,
  standardizeForPenalties
};
