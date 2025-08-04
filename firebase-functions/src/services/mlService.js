// File: functions/src/services/mlService.js

const axios = require('axios');

// Cloud Run ML service URL - Updated for production
// For local testing, use localhost. For production, use Cloud Run URL
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || (process.env.FUNCTIONS_EMULATOR 
  ? 'http://127.0.0.1:8080'
  : 'https://kaayko-ml-service-87383373015.us-central1.run.app');

/**
 * Get ML prediction using Cloud Run ML service
 * @param {object} features
 * @returns {Promise<object>} result object with { success, rating, mlModelUsed, predictionSource }
 */
async function getPrediction(features) {
  console.log('🤖 Getting ML prediction from Cloud Run service for features:', features);
  
  try {
    // Make HTTP request to Cloud Run ML service
    const response = await axios.post(`${ML_SERVICE_URL}/predict`, features, {
      timeout: 10000, // 10 second timeout
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = response.data;
    console.log('✅ ML prediction successful:', result);

    return {
      success: true,
      rating: result.rating,
      mlModelUsed: result.mlModelUsed,
      predictionSource: result.predictionSource || 'ml-model',
      modelType: result.modelType || 'GradientBoostingRegressor',
      confidence: result.confidence || 0.99
    };

  } catch (error) {
    console.error('❌ Cloud Run ML prediction failed:', error.message);
    
    // Fallback to rule-based system
    console.log('🔄 Falling back to rule-based system...');
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
 * Simple fallback rating calculation
 * @param {object} features 
 * @returns {number} rating between 1-5
 */
function calculateFallbackRating(features) {
  let rating = 3.0; // Start with neutral
  
  // Wind factor (major impact)
  if (features.windSpeed < 5) rating += 0.8;
  else if (features.windSpeed < 10) rating += 0.4;
  else if (features.windSpeed > 20) rating -= 1.2;
  else if (features.windSpeed > 15) rating -= 0.6;
  
  // Temperature factor
  if (features.temperature >= 70 && features.temperature <= 85) rating += 0.3;
  else if (features.temperature < 60 || features.temperature > 90) rating -= 0.4;
  
  // Weather warnings
  if (features.hasWarnings) rating -= 0.8;
  
  // UV and visibility
  if (features.uvIndex > 8) rating -= 0.2;
  if (features.visibility < 5) rating -= 0.3;
  
  // Ensure final rating is within bounds
  rating = Math.max(1.0, Math.min(5.0, rating));
  
  // Round to nearest 0.5 for UI consistency (1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0)
  rating = Math.round(rating * 2) / 2;
  
  return rating;
}

/**
 * Extract features needed for ML prediction
 * @param {object} weatherData
 * @returns {object} features object
 */
function extractMLFeatures(weatherData) {
  return {
    temperature: weatherData.temperature || 70,
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

/**
 * Interpret rating result
 * @param {number} rating
 * @returns {string} interpretation
 */
function interpretRating(rating) {
  if (rating >= 4.0) return 'Excellent';
  if (rating >= 3.0) return 'Good';
  if (rating >= 2.0) return 'Fair';
  return 'Poor';
}

/**
 * Apply personalized adjustments (placeholder)
 * @param {object} prediction
 * @param {object} userPrefs
 * @returns {object} adjusted prediction
 */
function applyPersonalizedAdjustments(prediction, userPrefs = {}) {
  return prediction; // No adjustments for now
}

module.exports = {
  extractMLFeatures,
  getPrediction,
  interpretRating,
  applyPersonalizedAdjustments
};
