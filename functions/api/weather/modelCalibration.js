// File: functions/src/utils/modelCalibration.js
//
// 🎯 MODEL CALIBRATION UTILITY
//
// Applies real-world adjustments to ML model predictions based on:
// 1. Current weather conditions analysis
// 2. Forecast trend analysis  
// 3. Location-specific factors
// 4. Seasonal adjustments

/**
 * Calibrate ML model prediction with real-world adjustments
 * @param {number} baseRating - Original ML model rating (1-5)
 * @param {object} currentConditions - Current weather data
 * @param {object} forecastData - Weather forecast data
 * @param {object} locationData - Location information (lat, lng)
 * @returns {object} Calibrated prediction with adjustments
 */
function calibrateModelPrediction(baseRating, currentConditions, forecastData, locationData) {
  console.log('🎯 Starting model calibration for base rating:', baseRating);
  
  let adjustedRating = baseRating;
  const adjustments = [];
  
  // 1. WATER TEMPERATURE CALIBRATION
  const waterTempAdjustment = calibrateWaterTemperature(currentConditions, locationData);
  if (waterTempAdjustment.adjustment !== 0) {
    adjustedRating += waterTempAdjustment.adjustment;
    adjustments.push(waterTempAdjustment);
  }
  
  // 2. FORECAST TREND ANALYSIS
  const forecastTrendAdjustment = analyzeForecastTrends(forecastData, currentConditions);
  if (forecastTrendAdjustment.adjustment !== 0) {
    adjustedRating += forecastTrendAdjustment.adjustment;
    adjustments.push(forecastTrendAdjustment);
  }
  
  // 3. SEASONAL CALIBRATION
  const seasonalAdjustment = applySeasonalCalibration(currentConditions, locationData);
  if (seasonalAdjustment.adjustment !== 0) {
    adjustedRating += seasonalAdjustment.adjustment;
    adjustments.push(seasonalAdjustment);
  }
  
  // 4. LOCATION-SPECIFIC CALIBRATION
  const locationAdjustment = applyLocationCalibration(currentConditions, locationData);
  if (locationAdjustment.adjustment !== 0) {
    adjustedRating += locationAdjustment.adjustment;
    adjustments.push(locationAdjustment);
  }
  
  // 5. WIND PATTERN ANALYSIS
  const windPatternAdjustment = analyzeWindPatterns(currentConditions, forecastData);
  if (windPatternAdjustment.adjustment !== 0) {
    adjustedRating += windPatternAdjustment.adjustment;
    adjustments.push(windPatternAdjustment);
  }
  
  // Ensure rating stays within bounds
  adjustedRating = Math.max(1.0, Math.min(5.0, adjustedRating));
  
  // Round to nearest 0.5 for consistent UI increments (1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0)
  adjustedRating = Math.round(adjustedRating * 2) / 2;
  
  const totalAdjustment = adjustedRating - baseRating;
  
  console.log('📈 Model calibration complete:', {
    baseRating,
    adjustedRating,
    totalAdjustment: totalAdjustment.toFixed(2),
    adjustmentsApplied: adjustments.length
  });
  
  return {
    originalRating: baseRating,
    calibratedRating: adjustedRating,
    totalAdjustment: totalAdjustment,
    adjustments: adjustments,
    calibrationApplied: true
  };
}

/**
 * Calibrate water temperature estimation
 */
function calibrateWaterTemperature(conditions, location) {
  const airTemp = conditions.temperature || 15;
  const latitude = Math.abs(location.latitude || 40);
  
  // Default water temp estimation is often too conservative (-8°C)
  // Apply more realistic water temp based on season and location
  
  const month = new Date().getMonth() + 1; // 1-12
  const isSummer = month >= 5 && month <= 9;
  const isWinter = month >= 11 || month <= 2;
  
  let waterTempOffset = -8; // Default conservative estimate
  let adjustment = 0;
  let reason = '';
  
  // Less conservative water temp estimates
  if (isSummer && airTemp > 15) {
    waterTempOffset = -4; // Summer water retains more heat
    adjustment = +0.3;
    reason = 'Summer water temperature adjustment (+0.3)';
  } else if (airTemp > 20) {
    waterTempOffset = -5; // Warm air = warmer water
    adjustment = +0.2;
    reason = 'Warm air temperature adjustment (+0.2)';
  } else if (latitude < 35 && airTemp > 10) {
    // Warmer climates have less air-water temp difference
    adjustment = +0.2;
    reason = 'Warm climate adjustment (+0.2)';
  }
  
  return {
    type: 'water_temperature',
    adjustment: adjustment,
    reason: reason,
    estimatedWaterTemp: airTemp + waterTempOffset
  };
}

/**
 * Analyze forecast trends for stability
 */
function analyzeForecastTrends(forecastData, currentConditions) {
  if (!forecastData?.forecast?.forecastday || forecastData.forecast.forecastday.length === 0) {
    return { adjustment: 0, reason: 'No forecast data available' };
  }
  
  const today = forecastData.forecast.forecastday[0];
  const hourlyData = today.hourly || [];
  
  if (hourlyData.length < 6) {
    return { adjustment: 0, reason: 'Insufficient forecast data' };
  }
  
  // Analyze next 6 hours for stability
  const next6Hours = hourlyData.slice(0, 6);
  const currentHour = new Date().getHours();
  const relevantHours = next6Hours.filter(hour => {
    const hourTime = parseInt(hour.time.split(' ')[1].split(':')[0]);
    return hourTime >= currentHour;
  });
  
  if (relevantHours.length < 3) {
    return { adjustment: 0, reason: 'Not enough relevant forecast hours' };
  }
  
  // Check for improving conditions
  const windSpeeds = relevantHours.map(h => h.windKPH || 0);
  const temps = relevantHours.map(h => h.tempC || 15);
  
  const windSpeeds0 = windSpeeds[0] || 0;
  const windSpeedsLast = windSpeeds[windSpeeds.length - 1] || 0;
  const windImproving = windSpeeds.every((speed, i) => i === 0 || speed <= windSpeeds[i-1] + 2);
  const windDeteriorating = windSpeedsLast > windSpeeds0 + 5; // increasing by >5kph over next hours
  const tempImproving = temps.some((temp, i) => i > 0 && temp > temps[i-1]);
  const stableConditions = windSpeeds.every(speed => speed < 15);

  let adjustment = 0;
  let reason = '';

  if (windDeteriorating) {
    adjustment = -0.2;
    reason = 'Wind increasing in forecast (-0.2)';
  } else if (windImproving && stableConditions) {
    adjustment = +0.2;
    reason = 'Improving wind conditions in forecast (+0.2)';
  } else if (tempImproving && stableConditions) {
    adjustment = +0.1;
    reason = 'Warming trend with stable conditions (+0.1)';
  } else if (stableConditions) {
    adjustment = +0.1;
    reason = 'Stable forecast conditions (+0.1)';
  }

  return {
    type: 'forecast_trend',
    adjustment: adjustment,
    reason: reason
  };
}

/**
 * Apply seasonal calibration adjustments
 */
function applySeasonalCalibration(conditions, location) {
  const month = new Date().getMonth() + 1; // 1-12
  const latitude = Math.abs(location.latitude || 40);
  const airTemp = conditions.temperature || 15;
  
  let adjustment = 0;
  let reason = '';
  
  // Spring/Fall in temperate zones often better than model predicts
  const isSpringFall = (month >= 3 && month <= 5) || (month >= 9 && month <= 11);
  const isTemperateZone = latitude >= 30 && latitude <= 60;
  
  if (isSpringFall && isTemperateZone && airTemp >= 10 && airTemp <= 25) {
    adjustment = +0.2;
    reason = 'Spring/Fall temperate zone adjustment (+0.2)';
  }
  
  // Summer adjustments for moderate temperatures
  const isSummer = month >= 6 && month <= 8;
  if (isSummer && airTemp >= 15 && airTemp <= 30) {
    adjustment = +0.15;
    reason = 'Summer moderate temperature adjustment (+0.15)';
  }
  
  return {
    type: 'seasonal',
    adjustment: adjustment,
    reason: reason
  };
}

/**
 * Apply location-specific calibrations
 */
function applyLocationCalibration(conditions, location) {
  const latitude = location.latitude || 40;
  const longitude = location.longitude || -100;
  
  let adjustment = 0;
  let reason = '';
  
  // Great Lakes region - often better conditions than model predicts
  const isGreatLakes = latitude >= 41 && latitude <= 49 && longitude >= -95 && longitude <= -76;
  if (isGreatLakes && conditions.temperature >= 8) {
    adjustment = +0.2;
    reason = 'Great Lakes region adjustment (+0.2)';
  }
  
  // California/Mediterranean climate
  const isCalifornia = latitude >= 32 && latitude <= 42 && longitude >= -125 && longitude <= -114;
  if (isCalifornia && conditions.temperature >= 12) {
    adjustment = +0.25;
    reason = 'California climate adjustment (+0.25)';
  }
  
  // Southern US - generally more paddleable
  const isSouthernUS = latitude >= 25 && latitude <= 37 && longitude >= -106 && longitude <= -75;
  if (isSouthernUS && conditions.temperature >= 10) {
    adjustment = +0.2;
    reason = 'Southern US climate adjustment (+0.2)';
  }
  
  return {
    type: 'location',
    adjustment: adjustment,
    reason: reason
  };
}

/**
 * Analyze wind patterns for paddling suitability
 */
function analyzeWindPatterns(conditions, forecastData) {
  const windSpeed = conditions.windSpeed || 0;
  const gustSpeed = conditions.gustSpeed || windSpeed * 1.3;
  
  let adjustment = 0;
  let reason = '';
  
  // Light, steady winds — optimal for paddling
  if (windSpeed >= 3 && windSpeed <= 8 && gustSpeed <= windSpeed * 1.2) {
    adjustment = +0.2;
    reason = 'Light steady winds optimal for paddling (+0.2)';
  }
  // Moderate winds with manageable gusts
  else if (windSpeed >= 8 && windSpeed <= 12 && gustSpeed <= windSpeed * 1.3) {
    adjustment = +0.1;
    reason = 'Moderate winds with manageable gusts (+0.1)';
  }
  // Very light winds — ideal for beginners
  else if (windSpeed <= 5) {
    adjustment = +0.1;
    reason = 'Very light winds - ideal for beginners (+0.1)';
  }
  // High winds — model may under-penalise in borderline cases
  else if (windSpeed >= 20) {
    adjustment = -0.1;
    reason = 'High wind advisory conditions (-0.1)';
  }

  return {
    type: 'wind_pattern',
    adjustment: adjustment,
    reason: reason
  };
}

module.exports = {
  calibrateModelPrediction
};