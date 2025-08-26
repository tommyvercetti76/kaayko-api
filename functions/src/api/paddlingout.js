//  functions/src/api/paddlingSpots.js
//
//  Express router for the "Paddling Out" spots API.
//
//  • GET  /paddlingSpots         → list all paddling spots
//  • GET  /paddlingSpots/:id     → details (and images) for one spot

const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const UnifiedWeatherService = require('../services/unifiedWeatherService');
const { getPrediction } = require('../services/mlService');
const { applyEnhancedPenalties } = require('../utils/paddlePenalties');
const { standardizeForMLModel, standardizeForPenalties } = require('../utils/dataStandardization');

const db     = admin.firestore();
const bucket = admin.storage().bucket();

// functions/src/api/paddlingSpots.js

/**
 * Get paddle score for a specific location
 * @param {object} location - Location object with coordinates
 * @returns {Promise<object>} Paddle score data or null if failed
 */
async function getPaddleScoreForLocation(location) {
  try {
    if (!location.latitude || !location.longitude) {
      return null;
    }

    // Use the real ML model - not test mode
    const isTestMode = false; // Using real weather data and ML predictions
    if (isTestMode) {
      console.log(`🧪 Test mode enabled - returning mock paddle score for location ${location.latitude},${location.longitude}`);
      const mockScore = Math.floor(Math.random() * 41) + 60; // Random score between 60-100
      const interpretation = getScoreInterpretation(mockScore);
      return {
        rating: mockScore,
        interpretation: interpretation,
        confidence: 'high',
        mlModelUsed: 'mock-model-v1',
        predictionSource: 'test-mode',
        conditions: {
          temperature: 72 + Math.random() * 10, // Mock temp 72-82F
          windSpeed: Math.random() * 15, // Mock wind 0-15mph
          hasWarnings: false
        },
        isTestData: true
      };
    }

    const locationQuery = `${location.latitude},${location.longitude}`;

    // Get current weather data
    const weatherService = new UnifiedWeatherService();
    const weatherData = await weatherService.getWeatherData(locationQuery, {
      includeForecast: false,
      useCache: true
    });

    // Get marine data if available
    let marineData = null;
    try {
      marineData = await weatherService.getMarineData(locationQuery);
    } catch (error) {
      // Marine data not available - that's okay for inland locations
      console.log(`ℹ️ Marine data not available for location ${locationQuery}`);
    }

    if (!weatherData?.current) {
      return null;
    }

    const current = weatherData.current;
    
    // Standardize features for ML model
    const mlFeatures = standardizeForMLModel({
      temperature: current.temperature?.celsius,
      windSpeed: current.wind?.speedMPH || current.windSpeed,
      gustSpeed: current.wind?.gustMPH || (current.wind?.speedMPH * 1.3),
      windDirection: current.wind?.direction || current.windDirection,
      humidity: current.atmospheric?.humidity || current.humidity,
      cloudCover: current.atmospheric?.cloudCover || current.cloudCover,
      uvIndex: current.solar?.uvIndex || current.uvIndex,
      visibility: current.atmospheric?.visibility || current.visibility,
      hasWarnings: current.hasWarnings,
      latitude: location.latitude,
      longitude: location.longitude
    }, marineData);

    // Get ML prediction
    let prediction = await getPrediction(mlFeatures);

    if (!prediction.success) {
      return null;
    }

    // Apply penalties using standardized features
    const penaltyFeatures = standardizeForPenalties({
      temperature: current.temperature?.celsius,
      windSpeed: current.wind?.speedMPH || current.windSpeed,
      gustSpeed: current.wind?.gustMPH || (current.wind?.speedMPH * 1.3),
      windDirection: current.wind?.direction || current.windDirection,
      humidity: current.atmospheric?.humidity || current.humidity,
      cloudCover: current.atmospheric?.cloudCover || current.cloudCover,
      uvIndex: current.solar?.uvIndex || current.uvIndex,
      visibility: current.atmospheric?.visibility || current.visibility,
      hasWarnings: current.hasWarnings,
      latitude: location.latitude,
      longitude: location.longitude
    }, marineData);

    prediction = applyEnhancedPenalties(prediction, penaltyFeatures, marineData);

    // Return simplified paddle score data
    return {
      rating: prediction.rating,
      interpretation: getScoreInterpretation(prediction.rating),
      confidence: prediction.confidence || 'high',
      mlModelUsed: prediction.mlModelUsed,
      predictionSource: prediction.predictionSource,
      conditions: {
        temperature: mlFeatures.temperature,
        windSpeed: mlFeatures.windSpeed,
        hasWarnings: mlFeatures.hasWarnings
      }
    };

  } catch (error) {
    console.error(`❌ Paddle score failed for location ${location.latitude},${location.longitude}:`, error);
    return null;
  }
}

async function fetchSpotImages(spotId) {
    const prefix = `images/paddling_out/`;
    try {
      // List all files in the paddling_out folder
      const [files] = await bucket.getFiles({ prefix });
      // Filter only images for this spotId
      const matching = files.filter((file) => {
        const fileName = file.name.split('/').pop() || '';
        return fileName.toLowerCase().startsWith(spotId.toLowerCase());
      });
      const urls = matching.map((file) => {
        const encodedPath = encodeURIComponent(file.name);
        return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media`;
      });
      console.log(`Found ${urls.length} images for spot ${spotId}:`, urls);
      return urls;
    } catch (err) {
      console.error(`Error fetching images for spot ${spotId}:`, err);
      return [];
    }
  }

/**
 * Get interpretation for paddle score rating
 * @param {number} rating
 * @returns {string} interpretation
 */
function getScoreInterpretation(rating) {
  if (rating >= 4.5) return 'Excellent';
  if (rating >= 4.0) return 'Great';
  if (rating >= 3.5) return 'Good';
  if (rating >= 3.0) return 'Fair';
  if (rating >= 2.5) return 'Below Average';
  if (rating >= 2.0) return 'Poor';
  return 'Very Poor';
}
async function fetchSpotImages(spotId) {
    const prefix = `images/paddling_out/`;
    try {
      // List all files in the paddling_out folder
      const [files] = await bucket.getFiles({ prefix });
      // Filter only images for this spotId
      const matching = files.filter((file) => {
        const fileName = file.name.split('/').pop() || '';
        return fileName.toLowerCase().startsWith(spotId.toLowerCase());
      });
      const urls = matching.map((file) => {
        const encodedPath = encodeURIComponent(file.name);
        return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media`;
      });
      console.log(`Found ${urls.length} images for spot ${spotId}:`, urls);
      return urls;
    } catch (err) {
      console.error(`Error fetching images for spot ${spotId}:`, err);
      return [];
    }
  }

/**
 * GET /paddlingSpots
 *
 * Returns an array of all paddling spot documents,
 * each including images AND current paddle scores from ML model.
 */
router.get('/', async (req, res) => {
  console.log('🏄 paddlingOut GET / route hit!');
  const startTime = Date.now();
  
  try {
    console.log('Attempting to fetch paddlingSpots collection...');
    const snapshot = await db.collection('paddlingSpots').get();
    console.log(`Found ${snapshot.docs.length} documents in paddlingSpots collection`);
    
    if (snapshot.empty) {
      console.log('No documents found in paddlingSpots collection');
      return res.json([]);
    }
    
    const spots = await Promise.all(
      snapshot.docs.map(async docSnap => {
        const data = docSnap.data();
        const spot = {
          id:           docSnap.id,
          lakeName:     data.lakeName   || '',
          title:        data.title      || '',
          subtitle:     data.subtitle   || '',
          text:         data.text       || '',
          youtubeURL:   data.youtubeURL || '',
          location:     data.location   || {},
          parkingAvl:   data.parkingAvl || 'N',
          restroomsAvl: data.restroomsAvl || 'N'
        };
        
        // Always fetch images from Storage to ensure we get the latest
        spot.imgSrc = await fetchSpotImages(docSnap.id);

        // 🎯 NEW: Get current paddle score for this location
        const paddleScore = await getPaddleScoreForLocation(spot.location);
        spot.paddleScore = paddleScore; // Will be null if failed
        
        return spot;
      })
    );

    const spotsWithScores = spots.filter(s => s.paddleScore).length;
    console.log(`✅ Successfully added paddle scores to ${spotsWithScores}/${spots.length} locations`);

    // Cache JSON for 60 seconds
    res.set('Cache-Control', 'public, max-age=60');
    
    const responseTime = Date.now() - startTime;
    console.log(`⏱️  paddlingOut response time: ${responseTime}ms`);
    
    return res.json(spots);
  } catch (err) {
    console.error('Error listing paddling spots:', err);
    console.error('Error details:', err.message);
    console.error('Error stack:', err.stack);
    return res.status(500).json({ 
      error: 'Server error',
      details: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /paddlingSpots/:id
 *
 * Returns a single paddling spot by document ID,
 * including its array of signed image URLs and current paddle score.
 */
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: 'Missing spot ID' });
  }

  try {
    const docSnap = await db.collection('paddlingSpots').doc(id).get();
    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Not found' });
    }

    const data = docSnap.data();
    const spot = {
      id:           docSnap.id,
      lakeName:     data.lakeName   || '',
      title:        data.title      || '',
      subtitle:     data.subtitle   || '',
      text:         data.text       || '',
      youtubeURL:   data.youtubeURL || '',
      location:     data.location   || {},
      parkingAvl:   data.parkingAvl || 'N',
      restroomsAvl: data.restroomsAvl || 'N'
    };
    
    // Always fetch images from Storage to ensure we get the latest
    spot.imgSrc = await fetchSpotImages(id);

    // 🎯 NEW: Get current paddle score for this location
    const paddleScore = await getPaddleScoreForLocation(spot.location);
    spot.paddleScore = paddleScore; // Will be null if failed

    // Cache JSON for 60 seconds
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(spot);
  } catch (err) {
    console.error(`Error fetching paddling spot ${id}:`, err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;