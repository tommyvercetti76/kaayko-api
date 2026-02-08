/**
 * Forecast Helpers — Paddle summary generation & safety level
 * @module api/weather/forecastHelpers
 */

const mlService = require('./mlService');

/**
 * 🏄‍♂️ Generate paddle summary using ML Service
 */
async function generatePaddleSummary(weather, location) {
  try {
    const features = mlService.extractMLFeatures({
      temperature: weather.current?.temperature?.fahrenheit || 65,
      windSpeed: weather.current?.wind?.speedMPH || 5,
      hasWarnings: false,
      uvIndex: weather.current?.solar?.uvIndex || 5,
      visibility: weather.current?.atmospheric?.visibility || 10,
      humidity: weather.current?.atmospheric?.humidity || 50,
      cloudCover: weather.current?.atmospheric?.cloudCover || 50,
      latitude: location?.latitude || 30.0,
      longitude: location?.longitude || -97.0
    });

    const prediction = await mlService.getPrediction(features);
    if (!prediction.success) throw new Error('ML prediction failed');

    const normalizedScore = (prediction.rating - 1) / 4;
    let interpretation;
    if (prediction.rating >= 4.0) interpretation = 'excellent';
    else if (prediction.rating >= 3.0) interpretation = 'good';
    else if (prediction.rating >= 2.0) interpretation = 'fair';
    else interpretation = 'poor';

    return {
      score: normalizedScore, mlRating: prediction.rating, interpretation,
      wind_mph: weather.wind?.speedMPH || 0,
      temp_f: weather.temperature?.fahrenheit || 65,
      factors: {
        wind: (weather.wind?.speedMPH || 0) > 15 ? 'high' : (weather.wind?.speedMPH || 0) > 10 ? 'moderate' : 'low',
        temperature: (weather.temperature?.fahrenheit || 65) < 55 ? 'cold' : (weather.temperature?.fahrenheit || 65) > 75 ? 'warm' : 'comfortable',
        weather: weather.conditions?.text || 'Clear'
      },
      mlModelUsed: prediction.mlModelUsed,
      predictionSource: prediction.predictionSource,
      confidence: prediction.confidence
    };
  } catch (error) {
    console.error('❌ ML paddle summary failed:', error);
    return ruleFallback(weather);
  }
}

/** Rule-based fallback when ML fails */
function ruleFallback(weather) {
  const windMph = weather.wind?.speedMPH || 0;
  const temp = weather.temperature?.fahrenheit || 65;
  const condition = weather.conditions?.text?.toLowerCase() || '';
  let score = 0.8;

  if (windMph > 20) score -= 0.4;
  else if (windMph > 15) score -= 0.3;
  else if (windMph > 10) score -= 0.2;
  if (temp < 50) score -= 0.3;
  else if (temp < 60) score -= 0.1;
  if (condition.includes('storm')) score -= 0.6;
  else if (condition.includes('rain')) score -= 0.4;
  else if (condition.includes('fog')) score -= 0.2;

  score = Math.max(0, Math.min(1, score));
  const fallbackRating = Math.round((score * 4 + 1) * 2) / 2;

  return {
    score, mlRating: fallbackRating,
    interpretation: score > 0.7 ? 'excellent' : score > 0.5 ? 'good' : score > 0.3 ? 'fair' : 'poor',
    wind_mph: windMph, temp_f: temp,
    factors: {
      wind: windMph > 15 ? 'high' : windMph > 10 ? 'moderate' : 'low',
      temperature: temp < 55 ? 'cold' : temp > 75 ? 'warm' : 'comfortable',
      weather: condition
    },
    mlModelUsed: false, predictionSource: 'fallback-rules', confidence: 0.7
  };
}

/**
 * 🛡️ Calculate safety level from weather conditions
 */
function calculateSafetyLevel(weather) {
  const windMph = weather.wind?.speedMPH || 0;
  const condition = weather.conditions?.text?.toLowerCase() || '';

  if (windMph > 20 || condition.includes('storm'))
    return { level: 'dangerous', color: '#ff4444', warning: 'Not safe for paddling' };
  if (windMph > 15 || condition.includes('rain'))
    return { level: 'caution', color: '#ffaa44', warning: 'Experienced paddlers only' };
  if (windMph > 10)
    return { level: 'moderate', color: '#44aaff', warning: 'Good conditions with wind' };
  return { level: 'excellent', color: '#44ff44', warning: 'Perfect for paddling' };
}

module.exports = { generatePaddleSummary, calculateSafetyLevel };
