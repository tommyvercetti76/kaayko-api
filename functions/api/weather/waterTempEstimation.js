/**
 * Water Temperature Estimation
 *
 * Provides a heuristic estimate of water temperature from air temperature,
 * latitude, and season. Used by smartWarnings when marine data is unavailable.
 *
 * @module api/weather/waterTempEstimation
 */

/**
 * Estimate water temperature based on air temperature and location factors.
 * @param {number} airTemp  Air temperature in °C
 * @param {object} locationData  { latitude, longitude }
 * @returns {number} Estimated water temperature in °C
 */
function estimateWaterTemperature(airTemp, locationData = {}) {
  const currentMonth = new Date().getMonth(); // 0-11
  const latitude = Math.abs(locationData.latitude || 40);

  // Water lags air by ~6-8 weeks — peaks September, low March
  const seasonalOffset = Math.sin((currentMonth - 1) * Math.PI / 6) * 4;
  const latitudeEffect = Math.max(0, (50 - latitude) / 10);
  const thermalMass = 1.2; // Lakes > rivers for thermal mass

  let waterTemp;
  if (airTemp >= 25)      waterTemp = airTemp - (8 + latitudeEffect) + seasonalOffset;
  else if (airTemp >= 15) waterTemp = airTemp - (5 + latitudeEffect * 0.7) + seasonalOffset;
  else if (airTemp >= 5)  waterTemp = airTemp - (2 + latitudeEffect * 0.5) + seasonalOffset + thermalMass;
  else                    waterTemp = airTemp + (2 + thermalMass) + seasonalOffset * 0.5;

  waterTemp = Math.max(1, Math.min(35, waterTemp));
  console.log(`💧 Water temp: Air ${airTemp}°C → Water ${waterTemp.toFixed(1)}°C (month=${currentMonth}, lat=${latitude})`);
  return waterTemp;
}

module.exports = { estimateWaterTemperature };
