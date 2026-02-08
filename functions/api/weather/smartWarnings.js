// File: functions/src/utils/smartWarnings.js
//
// 🚨 SMART WARNING SYSTEM
//
// Generates weather-appropriate safety warnings based on actual conditions
// No more fake "heat warnings" when it's cloudy and cool!

const { estimateWaterTemperature } = require('./waterTempEstimation');

/**
 * Generate smart safety warnings based on actual weather conditions
 * @param {object} currentConditions - Current weather data
 * @param {object} forecastData - Forecast data for trend analysis
 * @param {object} locationData - Location information
 * @returns {Array<string>} Array of relevant safety warnings
 */
function generateSmartWarnings(currentConditions, forecastData, locationData) {
  const warnings = [];
  const temp = currentConditions.temperature || 20;
  const windSpeed = currentConditions.windSpeed || 0;
  const gustSpeed = currentConditions.gustSpeed || windSpeed * 1.3;
  const humidity = currentConditions.humidity || 50;
  const cloudCover = currentConditions.cloudCover || 0;
  const uvIndex = currentConditions.uvIndex || 0;
  const visibility = currentConditions.visibility || 10;
  // PRIORITY: Use real marine water temperature data first, then estimate
  let waterTemp = null;
  
  if (currentConditions.waterTemp && currentConditions.waterTemp > 0) {
    waterTemp = currentConditions.waterTemp;
    console.log(`🌊 Using provided waterTemp: ${waterTemp}°C`);
  } else if (currentConditions.water_temp && currentConditions.water_temp > 0) {
    waterTemp = currentConditions.water_temp;
    console.log(`🌊 Using marine water_temp: ${waterTemp}°C`);
  } else {
    waterTemp = estimateWaterTemperature(temp, locationData);
    console.log(`🧮 Using estimated water temp: ${waterTemp}°C for air temp ${temp}°C`);
  }
  
  console.log('🚨 Generating smart warnings for conditions:', {
    temp, windSpeed, cloudCover, uvIndex, waterTemp
  });

  // 1. TEMPERATURE-BASED WARNINGS (context-aware)
  if (temp >= 35) {
    warnings.push("Extreme heat - risk of heat exhaustion");
  } else if (temp >= 30 && cloudCover < 30 && uvIndex > 8) {
    warnings.push("High heat with intense sun exposure - stay hydrated");
  } else if (temp >= 28 && humidity > 80) {
    warnings.push("Hot and humid conditions - take frequent breaks");
  }
  
  if (temp <= -5) {
    warnings.push("Extreme cold - hypothermia risk");
  } else if (temp <= 0) {
    warnings.push("Freezing conditions - ice formation possible");
  } else if (temp <= 5) {
    warnings.push("Very cold air - dress warmly and limit exposure");
  }

  // 2. WATER TEMPERATURE WARNINGS (using real marine data when available)
  console.log(`🌡️ Water temp check: ${waterTemp}°C`);
  
  if (waterTemp <= 4) {
    warnings.push("Extremely cold water - hypothermia risk within minutes");
  } else if (waterTemp <= 10) {
    warnings.push("Very cold water - cold water shock and rapid heat loss risk");
  } else if (waterTemp <= 15) {
    warnings.push("Cold water - hypothermia possible with prolonged exposure");
  } else if (waterTemp <= 18) {
    warnings.push("Cool water - wear appropriate thermal protection");
  }
  // Water above 18°C (64°F) is generally safe for recreational paddling
  // Marine data often shows warmer temperatures than our old estimation

  // 3. WIND CONDITIONS (with context)
  if (windSpeed >= 25) {
    warnings.push("High winds - small craft advisory conditions");
  } else if (windSpeed >= 20) {
    warnings.push("Strong winds - challenging for inexperienced paddlers");
  } else if (gustSpeed >= 25 && gustSpeed > windSpeed * 1.5) {
    warnings.push("Gusty conditions - sudden wind changes expected");
  }

  // 4. VISIBILITY WARNINGS
  if (visibility <= 1) {
    warnings.push("Very poor visibility - navigation hazardous");
  } else if (visibility <= 3) {
    warnings.push("Reduced visibility - stay close to shore");
  }

  // 5. UV/SUN EXPOSURE (intelligent based on cloud cover)
  if (uvIndex >= 8 && cloudCover <= 20) {
    warnings.push("Very high UV - sunburn risk within 15 minutes");
  } else if (uvIndex >= 6 && cloudCover <= 40) {
    warnings.push("High UV exposure - use sun protection");
  }

  // 6. FORECAST-BASED WARNINGS (deteriorating conditions)
  const forecastWarnings = analyzeForecastTrends(forecastData, currentConditions);
  warnings.push(...forecastWarnings);

  // 7. WEATHER PATTERN WARNINGS
  const weatherPatternWarnings = analyzeWeatherPatterns(currentConditions);
  warnings.push(...weatherPatternWarnings);

  // 8. SEASONAL/LOCATION WARNINGS
  const contextualWarnings = generateContextualWarnings(currentConditions, locationData);
  warnings.push(...contextualWarnings);

  console.log(`✅ Generated ${warnings.length} smart warnings:`, warnings);
  return warnings;
}

/**
 * Analyze forecast trends for deteriorating conditions
 */
function analyzeForecastTrends(forecastData, currentConditions) {
  const warnings = [];
  
  if (!forecastData?.forecast?.forecastday || forecastData.forecast.forecastday.length === 0) {
    return warnings;
  }

  const today = forecastData.forecast.forecastday[0];
  const hourlyData = today.hourly || [];
  
  if (hourlyData.length < 6) return warnings;

  // Check next 6 hours for deteriorating conditions
  const currentHour = new Date().getHours();
  const next6Hours = hourlyData.slice(0, 6).filter(hour => {
    const hourTime = parseInt(hour.time.split(' ')[1].split(':')[0]);
    return hourTime >= currentHour;
  });

  if (next6Hours.length < 3) return warnings;

  // Wind trend analysis
  const windSpeeds = next6Hours.map(h => h.windKPH || 0);
  const windIncreasing = windSpeeds.some((speed, i) => i > 0 && speed > windSpeeds[i-1] + 10);
  
  if (windIncreasing && windSpeeds[windSpeeds.length - 1] > 20) {
    warnings.push("Wind speeds increasing - conditions deteriorating");
  }

  // Temperature drop analysis
  const temps = next6Hours.map(h => h.tempC || 15);
  const tempDrop = temps[0] - temps[temps.length - 1];
  
  if (tempDrop > 10) {
    warnings.push("Rapid temperature drop expected - dress in layers");
  }

  // Precipitation analysis
  const precipitation = next6Hours.some(h => h.precipMM > 2);
  const thunderstorm = next6Hours.some(h => h.condition?.text?.toLowerCase().includes('thunder'));
  
  if (thunderstorm) {
    warnings.push("Thunderstorms approaching - seek shelter immediately");
  } else if (precipitation) {
    warnings.push("Rain expected - reduced visibility and comfort");
  }

  return warnings;
}

/**
 * Analyze current weather patterns for specific risks
 */
function analyzeWeatherPatterns(conditions) {
  const warnings = [];
  const temp = conditions.temperature || 20;
  const windSpeed = conditions.windSpeed || 0;
  const humidity = conditions.humidity || 50;
  const cloudCover = conditions.cloudCover || 0;

  // High pressure system with light winds and high temperatures
  if (temp > 25 && windSpeed < 5 && cloudCover < 20 && humidity < 40) {
    warnings.push("Stable high pressure - monitor for afternoon thermal winds");
  }

  // Low pressure system indicators
  if (cloudCover > 80 && humidity > 85 && windSpeed > 15) {
    warnings.push("Low pressure system - unstable weather likely");
  }

  // Temperature inversion conditions
  if (temp < 10 && humidity > 90 && windSpeed < 3) {
    warnings.push("Fog formation likely - visibility may deteriorate rapidly");
  }

  return warnings;
}

/**
 * Generate contextual warnings based on location and season
 */
function generateContextualWarnings(conditions, locationData) {
  const warnings = [];
  const latitude = Math.abs(locationData.latitude || 40);
  const month = new Date().getMonth() + 1; // 1-12
  const temp = conditions.temperature || 20;

  // Northern latitudes in winter
  if (latitude > 45 && (month >= 11 || month <= 3) && temp < 5) {
    warnings.push("Winter conditions - daylight limited, inform others of plans");
  }

  // Southern locations in summer
  if (latitude < 35 && month >= 6 && month <= 8 && temp > 30) {
    warnings.push("Summer heat - start early, avoid midday sun exposure");
  }

  // Great Lakes specific
  const isGreatLakes = latitude >= 41 && latitude <= 49 && 
                      locationData.longitude >= -95 && locationData.longitude <= -76;
  if (isGreatLakes && conditions.windSpeed > 15) {
    warnings.push("Great Lakes conditions - waves build quickly with wind");
  }

  return warnings;
}

/**
 * Filter and prioritize warnings to avoid overwhelming users
 */
function prioritizeWarnings(warnings) {
  // Remove duplicates
  const uniqueWarnings = [...new Set(warnings)];
  
  // Priority order (most critical first)
  const priorityKeywords = [
    'extreme', 'dangerous', 'hypothermia', 'heat exhaustion', 'thunderstorm',
    'high winds', 'very poor visibility', 'cold water shock',
    'strong winds', 'gusty', 'deteriorating', 'rapid',
    'high heat', 'cold air', 'reduced visibility'
  ];

  // Sort by priority
  const prioritized = uniqueWarnings.sort((a, b) => {
    const aPriority = priorityKeywords.findIndex(keyword => 
      a.toLowerCase().includes(keyword));
    const bPriority = priorityKeywords.findIndex(keyword => 
      b.toLowerCase().includes(keyword));
    
    if (aPriority === -1 && bPriority === -1) return 0;
    if (aPriority === -1) return 1;
    if (bPriority === -1) return -1;
    return aPriority - bPriority;
  });

  // Limit to top 3 warnings to avoid overwhelming users
  return prioritized.slice(0, 3);
}

/**
 * Main function to generate and prioritize smart warnings
 */
function getSmartWarnings(currentConditions, forecastData, locationData) {
  const allWarnings = generateSmartWarnings(currentConditions, forecastData, locationData);
  const prioritizedWarnings = prioritizeWarnings(allWarnings);
  
  console.log(`🎯 Final warnings (${prioritizedWarnings.length}):`, prioritizedWarnings);
  
  return prioritizedWarnings;
}

module.exports = {
  getSmartWarnings,
  generateSmartWarnings,
  prioritizeWarnings
};