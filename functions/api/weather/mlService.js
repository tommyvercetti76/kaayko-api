// File: functions/api/weather/mlService.js
//
// ML Service — calls Cloud Run GradientBoosting model for paddle score predictions.
// Uses native Node https (no axios dependency).
// Falls back to rule-based rating if Cloud Run is unavailable.

const https = require('https');
const { getPaddleLlmPrediction } = require('./paddleLlmClient');
const { predictLocal } = require('./localModel');

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

  // ── In-process model (no network) ─────────────────────────────────────────
  // Tried first when a versioned model artifact is on disk. It is ADDITIVE:
  // with no artifact present (the state today) predictLocal returns null and
  // every line below runs exactly as it did before. Set PADDLE_LOCAL_MODEL=off
  // to force the remote path even when an artifact exists.
  //
  // This removes a TLS handshake + Cloud Run cold start from every spot-hour —
  // /fastForecast alone issues ~24 of them per spot per day.
  try {
    const local = predictLocal(features);
    if (local) {
      console.log(`Local model prediction — rating: ${local.rating}, model: ${local.modelVersion}`);
      return local;
    }
  } catch (error) {
    // An artifact that is present but cannot be honestly evaluated is a real
    // fault: log loudly, then use the remote path, which is a known quantity.
    console.error('Local model prediction failed, falling back to remote:', error.message);
  }

  if (process.env.PADDLE_LLM_URL) {
    try {
      const result = await getPaddleLlmPrediction(features);
      console.log(`Paddle LLM prediction — rating: ${result.rating}, model: ${result.modelType}`);
      return result;
    } catch (error) {
      console.warn('Paddle LLM prediction failed, trying legacy ML service:', error.message);
    }
  }

  try {
    const mlUrl = getMLServiceURL();
    // ONE retry. A cold Cloud Run instance loading its model from GCS routinely
    // exceeds the 10 s budget, but that first attempt is what warms it — the
    // retry then lands on a warm instance and returns in ~0.1 s. Without this,
    // every cold start silently demoted a spot to the heuristic for a full
    // warmer cycle. Only one retry: if the second also fails, the service is
    // genuinely unavailable and we should degrade rather than pile on load.
    let result;
    try {
      result = await httpsPost(`${mlUrl}/predict`, features, 10000);
    } catch (firstErr) {
      console.warn(`ML first attempt failed (${firstErr.message}); retrying once`);
      result = await httpsPost(`${mlUrl}/predict`, features, 10000);
    }

    // A malformed response must fall through to the rule-based fallback — without
    // this check a missing rating would publish as a hard 1.0 at high confidence.
    if (!Number.isFinite(result?.rating) || result.rating < 1 || result.rating > 5) {
      throw new Error(`ML service returned invalid rating: ${result?.rating}`);
    }

    console.log(`ML prediction — rating: ${result.rating}, source: ${result.predictionSource}`);

    return {
      success: true,
      rating: result.rating,
      mlModelUsed: result.mlModelUsed,
      predictionSource: result.predictionSource || 'ml-model',
      modelType: result.modelType || 'GradientBoostingRegressor',
      // What the remote service DECLARED, verbatim — null when it declared
      // nothing. This used to invent 0.99 for a service that said nothing at
      // all, which is a number nobody earned. The published `confidence` is
      // derived from this by scoringPipeline.normalizeConfidence (#19): the
      // remote model states no out-of-fold error, so it lands on 'estimated'
      // whatever number it asserts here.
      confidence: result.confidence ?? null,
      featuresUsed: result.featuresUsed
    };

  } catch (error) {
    // A SILENT FALLBACK IS HOW THIS WENT UNNOTICED.
    //
    // Measured in production on 2026-09-18: 13 of 17 live spots were being scored
    // by calculateFallbackRating below — a hand-written heuristic that has never
    // been evaluated against anything — because the Cloud Run call timed out at
    // 10 s during cold starts. The service answers in 0.11 s warm; the warmer
    // fires batches of 5 and the cold instances blow the budget. Because this
    // block returned `success: true` with no marker, nothing surfaced it: not the
    // response, not a dashboard, not an alert. The visible symptom was a hero
    // reading 3.5 "Careful" while the forecast strip read 1.5 "Hard pass" for the
    // same hour — two different models on one screen.
    //
    // The real fix is in-process evaluation (localModel.js); this makes the
    // degraded state impossible to miss until that artifact ships.
    console.error(JSON.stringify({
      severity: 'ERROR',
      event: 'ml_prediction_fallback',
      reason: error.message,
      lat: features?.latitude ?? null,
      lng: features?.longitude ?? null,
      note: 'published score came from the unevaluated rule heuristic, NOT the model'
    }));

    const fallbackRating = calculateFallbackRating(features);
    return {
      success: true,
      rating: fallbackRating,
      mlModelUsed: false,
      predictionSource: 'fallback-rules',
      modelType: 'rule-based',
      // Carried to the response so every surface — and any future dashboard —
      // can tell that this number is not the model's.
      degraded: true,
      degradedReason: error.message,
      // Historical, and kept only as the DECLARED value. This heuristic has
      // never been evaluated against the label corpus, so 0.7 is an assertion
      // with nothing behind it. scoringPipeline.normalizeConfidence publishes
      // it as 'unvalidated' — see #19. Do not raise this number; raising it
      // would change nothing published and would only make the log lie.
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

// Canonical tier thresholds — keep in sync with getInterpretation in paddleScoreCompute.js.
function interpretRating(rating) {
  if (rating >= 3.7) return 'Worth it';
  if (rating >= 2.7) return 'Careful';
  return 'Hard pass';
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
