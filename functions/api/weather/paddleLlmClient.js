// functions/api/weather/paddleLlmClient.js
//
// Adapter for the standalone Paddle LLM service.
// Paddling Out keeps its public API surface; this client translates the
// existing standardized weather features into Paddle LLM's public /predict
// contract and normalizes the response back into the legacy mlService shape.

const http = require('http');
const https = require('https');

const COMPASS_TO_DEGREES = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5
};

function getPaddleLlmURL() {
  const url = (process.env.PADDLE_LLM_URL || '').trim();
  return url || null;
}

function getTimeoutMs() {
  const parsed = Number(process.env.PADDLE_LLM_TIMEOUT_MS || 8000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8000;
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function windDirectionToDegrees(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();
    if (COMPASS_TO_DEGREES[trimmed] !== undefined) return COMPASS_TO_DEGREES[trimmed];
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 180;
}

function mapFeaturesToPaddleLlmRequest(features = {}) {
  const now = new Date();
  const temperature = toNumber(features.temperature, 20);
  const windSpeed = toNumber(features.windSpeed, 5);
  const gustSpeed = toNumber(features.gustSpeed, windSpeed * 1.3);

  return {
    temperature_c: temperature,
    feels_like_c: toNumber(features.feelsLike ?? features.feelsLikeC, temperature),
    wind_mph: windSpeed,
    gust_mph: gustSpeed,
    wind_degree: windDirectionToDegrees(features.windDegree ?? features.windDirection),
    humidity_pct: toNumber(features.humidity, 50),
    uv_index: toNumber(features.uvIndex, 4),
    visibility_km: toNumber(features.visibility ?? features.visibilityKm, 10),
    cloud_cover_pct: toNumber(features.cloudCover, 30),
    pressure_mb: toNumber(features.pressure ?? features.pressureMb, 1013),
    precip_chance_pct: toNumber(features.precipChancePercent ?? features.precipChance, 0),
    precip_mm: toNumber(features.precipMm ?? features.precipMM, 0),
    wave_height_m: toNumber(features.waveHeight, 0.1),
    water_temp_c: toNumber(features.waterTemp, Math.max(2, temperature - 8)),
    hour: toNumber(features.hour, now.getUTCHours()),
    month: toNumber(features.month, now.getUTCMonth() + 1),
    is_weekend: features.isWeekend !== undefined
      ? Number(Boolean(features.isWeekend))
      : Number(now.getUTCDay() === 0 || now.getUTCDay() === 6),
    latitude: toNumber(features.latitude, 0),
    longitude: toNumber(features.longitude, 0),
    location_id: String(features.location_id || features.spotId || 'paddling-out-api'),
    time: String(features.time || now.toISOString())
  };
}

function postJson(url, body, headers = {}, timeoutMs = getTimeoutMs()) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const transport = parsed.protocol === 'http:' ? http : https;

    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers
      },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Paddle LLM HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Paddle LLM returned non-JSON response'));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Paddle LLM request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function normalizePaddleLlmResponse(result) {
  const prediction = result?.prediction || result;
  const rating = toNumber(prediction?.score ?? prediction?.rating, NaN);
  if (!Number.isFinite(rating)) {
    throw new Error('Paddle LLM response missing prediction.score');
  }

  return {
    success: true,
    rating,
    mlModelUsed: prediction.model_type !== 'expert-rule-baseline',
    predictionSource: 'paddle-llm',
    modelType: prediction.model_type || 'paddle-llm',
    confidence: prediction.confidence || 0.8,
    featuresUsed: result?.featuresUsed,
    riskClass: prediction.risk_class,
    explanations: prediction.explanations || []
  };
}

async function getPaddleLlmPrediction(features) {
  const baseUrl = getPaddleLlmURL();
  if (!baseUrl) {
    throw new Error('PADDLE_LLM_URL is not set');
  }

  const headers = {};
  const apiKey = (process.env.PADDLE_LLM_API_KEY || '').trim();
  if (apiKey) headers['X-API-Key'] = apiKey;

  const body = mapFeaturesToPaddleLlmRequest(features);
  const result = await postJson(`${baseUrl.replace(/\/$/, '')}/predict`, body, headers);
  return normalizePaddleLlmResponse(result);
}

module.exports = {
  getPaddleLlmPrediction,
  mapFeaturesToPaddleLlmRequest,
  normalizePaddleLlmResponse,
  postJson
};
