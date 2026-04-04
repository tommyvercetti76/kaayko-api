// File: functions/api/weather/mlService.js
//
// ML Service — calls Cloud Run GradientBoosting model for paddle score predictions.
// Uses native Node https (no axios dependency).
// Falls back to rule-based rating if Cloud Run is unavailable.

const https = require('https');

// URL must be set in Firebase Functions environment: ML_SERVICE_URL
// Never falls back to a hardcoded URL — fail loudly so misconfiguration is caught early.
function getMLServiceURL() {
  const url = process.env.ML_SERVICE_URL;
  if (!url) {
    throw new Error('ML_SERVICE_URL environment variable is not set');
  }
  return url;
}

/**
 * POST JSON to a URL using native https. Returns parsed response body.
 * Enforces a strict timeout and validates the response status.
 */
function httpsPost(url, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`ML service HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('ML service returned non-JSON response'));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`ML service request timed out after ${timeoutMs}ms`));
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Get ML prediction from Cloud Run service.
 * Always returns { success, rating, mlModelUsed, predictionSource, modelType, confidence }.
 * On any failure, returns rule-based fallback with success: true so callers don't need
 * to handle two code paths.
 */
async function getPrediction(features) {
  console.log(`ML request — temp: ${features.temperature}°C, wind: ${features.windSpeed}mph`);

  try {
    const mlUrl = getMLServiceURL();
    const result = await httpsPost(`${mlUrl}/predict`, features, 10000);

    console.log(`ML prediction — rating: ${result.rating}, source: ${result.predictionSource}`);

    return {
      success: true,
      rating: result.rating,
      mlModelUsed: result.mlModelUsed,
      predictionSource: result.predictionSource || 'ml-model',
      modelType: result.modelType || 'GradientBoostingRegressor',
      confidence: result.confidence || 0.99,
      featuresUsed: result.featuresUsed
    };

  } catch (error) {
    console.error('Cloud Run ML prediction failed:', error.message);
    console.log('Falling back to rule-based rating');

    const fallbackRating = calculateFallbackRating(features);
    return {
      success: true,
      rating: fallbackRating,
      mlModelUsed: false,
      predictionSource: 'fallback-rules',
      modelType: 'rule-based',
      confidence: 0.7
    };
  }
}

/**
 * Rule-based fallback when ML service is unavailable.
 * Operates on standardized MPH wind and Celsius temperature.
 */
function calculateFallbackRating(features) {
  let rating = 3.0;

  // Wind (major impact — features.windSpeed is in MPH)
  if (features.windSpeed < 5)       rating += 0.8;
  else if (features.windSpeed < 10) rating += 0.4;
  else if (features.windSpeed > 20) rating -= 1.2;
  else if (features.windSpeed > 15) rating -= 0.6;

  // Temperature (features.temperature is in Celsius)
  const tempC = features.temperature;
  if (tempC >= 18 && tempC <= 30)      rating += 0.3; // ~65-86°F
  else if (tempC < 10 || tempC > 35)   rating -= 0.4; // Too cold or too hot

  // Conditions
  if (features.hasWarnings)  rating -= 0.8;
  if (features.uvIndex > 8)  rating -= 0.2;
  if (features.visibility < 5) rating -= 0.3;

  return Math.round(Math.max(1.0, Math.min(5.0, rating)) * 2) / 2;
}

/**
 * Extract a minimal feature set from raw weather data.
 * Used by legacy callers — prefer standardizeForMLModel() for new code.
 */
function extractMLFeatures(weatherData) {
  return {
    temperature: weatherData.temperature || 20,
    windSpeed: weatherData.windSpeed || 5,
    hasWarnings: weatherData.hasWarnings || false,
    beaufortScale: Math.min(Math.floor((weatherData.windSpeed || 5) / 3.0), 12),
    uvIndex: weatherData.uvIndex || 5,
    visibility: weatherData.visibility || 10,
    humidity: weatherData.humidity || 50,
    cloudCover: weatherData.cloudCover || 50,
    latitude: weatherData.latitude || 30.0,
    longitude: weatherData.longitude || -97.0
  };
}

function interpretRating(rating) {
  if (rating >= 4.0) return 'Excellent';
  if (rating >= 3.0) return 'Good';
  if (rating >= 2.0) return 'Fair';
  return 'Poor';
}

function applyPersonalizedAdjustments(prediction, userPrefs = {}) {
  return prediction;
}

module.exports = {
  extractMLFeatures,
  getPrediction,
  interpretRating,
  applyPersonalizedAdjustments
};
