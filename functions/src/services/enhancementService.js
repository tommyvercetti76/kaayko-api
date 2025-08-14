// File: functions/src/services/enhancementService.js

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
    beaufortScale: Math.min(Math.floor(weatherData.windSpeed / 3.0), 12),
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

/**
 * Get batch ML predictions (placeholder)
 * @param {array} features
 * @returns {Promise<array>} predictions
 */
async function getBatchMLPredictions(features) {
  return features.map(f => ({ rating: 2.5, mlModelUsed: false }));
}

/**
 * Generate location-specific recommendations based on features
 */
function generateLocationRecommendations(features, rating, preferences = {}) {
  const recs = [];
  const { skillLevel } = preferences;

  if (features.windSpeed < 8) {
    recs.push({ type: 'conditions', message: 'Perfect for beginners - very calm conditions', priority: 'high' });
  } else if (features.windSpeed > 20) {
    recs.push({ type: 'safety', message: 'Strong winds - experienced paddlers only', priority: 'critical' });
  }

  if (features.temperature < 10) {
    recs.push({ type: 'gear', message: 'Cold conditions - wetsuit strongly recommended', priority: 'high' });
  } else if (features.temperature > 30) {
    recs.push({ type: 'safety', message: 'Hot conditions - bring extra water and sun protection', priority: 'medium' });
  }

  if (features.visibility < 5) {
    recs.push({ type: 'safety', message: 'Poor visibility - consider postponing', priority: 'critical' });
  }

  if (skillLevel === 'beginner' && rating < 3.5) {
    recs.push({ type: 'skill', message: 'Consider sheltered waters for first outings', priority: 'medium' });
  } else if (skillLevel === 'advanced' && rating > 4.5) {
    recs.push({ type: 'skill', message: 'Excellent conditions for skill development', priority: 'low' });
  }

  return recs;
}

/**
 * Calculate confidence score for a location prediction
 */
function calculateLocationConfidence(features, rating) {
  let confidence = 0.8;
  if (features.windSpeed > 25 || features.temperature < 5 || features.temperature > 35) confidence -= 0.2;
  if (!features.uvIndex || !features.visibility) confidence -= 0.1;
  if (
    features.windSpeed >= 5 && features.windSpeed <= 20 &&
    features.temperature >= 10 && features.temperature <= 30
  ) {
    confidence += 0.1;
  }
  return Math.max(0.3, Math.min(1.0, confidence));
}

/**
 * Generate insights across all enhanced reports
 */
function generateIntelligentInsights(enhancedReports = [], preferences = {}) {
  const success = enhancedReports.filter(r => r.mlEnhancement?.success);
  if (!success.length) return { message: 'No successful enhancements available' };

  const ratings = success.map(r => r.mlEnhancement.prediction.personalizedRating);
  const avg = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;

  const insights = {
    overview: {
      averageRating: Math.round(avg * 10) / 10,
      bestLocation: success.reduce((best, cur) =>
        cur.mlEnhancement.prediction.personalizedRating > best.mlEnhancement.prediction.personalizedRating
          ? cur
          : best
      ),
      totalAnalyzed: success.length
    },
    patterns: [],
    alerts: []
  };

  const highWindCount = success.filter(r => r.mlEnhancement.features.extracted.windSpeed > 18).length;
  if (highWindCount > success.length * 0.6) {
    insights.patterns.push({ type: 'wind', message: `High wind at ${highWindCount} locations`, impact: 'Consider sheltered waters' });
  }

  const coldCount = success.filter(r => r.mlEnhancement.features.extracted.temperature < 12).length;
  if (coldCount) {
    insights.patterns.push({ type: 'temperature', message: `Cold conditions at ${coldCount} locations`, impact: 'Wetsuit recommended' });
  }

  const dangerousCount = success.filter(r => r.mlEnhancement.prediction.personalizedRating < 2.0).length;
  if (dangerousCount) {
    insights.alerts.push({ severity: 'high', message: `${dangerousCount} dangerous locations`, locations: success.filter(r => r.mlEnhancement.prediction.personalizedRating < 2.0).map(r => r.name) });
  }

  return insights;
}

/**
 * Generate overall personalized recommendations
 */
function generatePersonalizedRecommendations(enhancedReports = [], preferences = {}) {
  const success = enhancedReports.filter(r => r.mlEnhancement?.success);
  const sorted = success.sort((a, b) => b.mlEnhancement.prediction.personalizedRating - a.mlEnhancement.prediction.personalizedRating);

  const recs = { topPicks: [], alternatives: [], avoid: [], tips: [] };

  recs.topPicks = sorted
    .filter(r => r.mlEnhancement.prediction.personalizedRating >= 4.0)
    .slice(0, 3)
    .map(r => ({ name: r.name, rating: r.mlEnhancement.prediction.personalizedRating, reason: r.mlEnhancement.prediction.interpretation.category }));

  recs.alternatives = sorted
    .filter(r => r.mlEnhancement.prediction.personalizedRating >= 2.5 && r.mlEnhancement.prediction.personalizedRating < 4.0)
    .slice(0, 3)
    .map(r => ({ name: r.name, rating: r.mlEnhancement.prediction.personalizedRating, caution: r.mlEnhancement.recommendations.filter(x => x.priority === 'critical').map(x => x.message) }));

  recs.avoid = sorted
    .filter(r => r.mlEnhancement.prediction.personalizedRating < 2.5)
    .map(r => ({ name: r.name, rating: r.mlEnhancement.prediction.personalizedRating }));

  if (preferences.skillLevel === 'beginner') recs.tips.push('Focus on calm, protected waters');
  if (preferences.skillLevel === 'advanced') recs.tips.push('Challenge yourself with dynamic conditions');
  if (preferences.preferredConditions === 'calm') recs.tips.push('Morning is usually calmest');
  if (preferences.preferredConditions === 'challenging') recs.tips.push('Afternoon often more dynamic');

  return recs;
}

/**
 * Orchestrate enhancement of multiple reports
 */
async function enhanceReports(reports = [], preferences = {}) {
  const featuresList = reports.map(r => extractMLFeatures(r));
  const batch = await getBatchMLPredictions(featuresList);
  if (!batch.success) throw new Error(batch.error || 'ML batch prediction failed');

  const enhanced = reports.map((report, i) => {
    const ml = batch.results[i];
    const feats = featuresList[i];
    if (!ml.success) {
      return { ...report, mlEnhancement: { success: false, error: ml.error || 'ML failed', fallback: true } };
    }

    const personalized = applyPersonalizedAdjustments(ml.rating, feats, preferences);
    const recs = generateLocationRecommendations(feats, ml.rating, preferences);
    const conf = calculateLocationConfidence(feats, ml.rating);

    return {
      ...report,
      mlEnhancement: {
        success: true,
        prediction: {
          rating: ml.rating,
          personalizedRating: personalized,
          interpretation: interpretRating(personalized),
          confidence: conf,
          ratingComparison: {
            original: report.conditions?.rating || 0,
            ml: ml.rating,
            personalized,
            difference: Math.abs((report.conditions?.rating || 0) - personalized)
          }
        },
        features: { extracted: feats, confidence: 0.8 },
        recommendations: recs,
        enhancedAt: new Date().toISOString()
      }
    };
  });

  const summary = {
    totalLocations: enhanced.length,
    mlEnhanced: enhanced.filter(r => r.mlEnhancement.success).length,
    topRecommendations: enhanced.filter(r => r.mlEnhancement.success)
      .sort((a, b) => b.mlEnhancement.prediction.rating - a.mlEnhancement.prediction.rating)
      .slice(0, 3)
      .map(r => ({ id: r.id, name: r.name, mlRating: r.mlEnhancement.prediction.rating }))
  };
  const insights = generateIntelligentInsights(enhanced, preferences);
  const recommendations = generatePersonalizedRecommendations(enhanced, preferences);
  const metadata = { enhancementVersion: '1.0.0', timestamp: new Date().toISOString() };

  return { summary, reports: enhanced, insights, recommendations, metadata };
}

module.exports = { enhanceReports };
