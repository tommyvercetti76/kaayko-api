// File: functions/src/api/gptActions.js
//
// 🤖 GPT ACTIONS API - Simplified endpoints for ChatGPT Custom GPT
//
// These endpoints are specifically formatted for OpenAI's GPT Actions
// They wrap our existing APIs in a GPT-friendly format

const express = require('express');
const router = express.Router();
const axios = require('axios');

const BASE_URL = 'https://us-central1-kaaykostore.cloudfunctions.net/api';

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'GPT Actions API',
    status: 'running',
    endpoints: ['/paddleScore', '/forecast', '/locations', '/findNearby'],
    version: '2.0.0'
  });
});

/**
 * GET /gptActions/paddleScore
 * Get current paddle conditions for a location
 * 
 * Query params:
 * - latitude: number (required)
 * - longitude: number (required)
 * 
 * Returns: Simplified response for GPT consumption
 */
router.get('/paddleScore', async (req, res) => {
  try {
    const { latitude, longitude } = req.query;
    
    if (!latitude || !longitude) {
      return res.status(400).json({
        error: 'Missing required parameters: latitude and longitude'
      });
    }

    // Call our existing paddleScore API
    const response = await axios.get(`${BASE_URL}/paddleScore`, {
      params: { lat: latitude, lng: longitude }
    });

    const data = response.data;

    // Format for GPT (simplified, conversational structure)
    const gptResponse = {
      location: {
        name: data.location?.name || `${latitude}, ${longitude}`,
        coordinates: `${latitude}, ${longitude}`
      },
      paddleScore: {
        rating: data.paddleScore?.rating,
        interpretation: data.paddleScore?.interpretation,
        outOf: 5.0
      },
      currentConditions: {
        temperature: `${data.conditions?.temperature}°F`,
        windSpeed: `${data.conditions?.windSpeed} mph`,
        waterTemperature: data.conditions?.marine?.waterTemp ? `${data.conditions.marine.waterTemp}°F` : 'Unknown',
        humidity: `${data.conditions?.humidity}%`,
        cloudCover: `${data.conditions?.cloudCover}%`,
        uvIndex: data.conditions?.uvIndex,
        visibility: `${data.conditions?.visibility} miles`
      },
      safetyWarnings: data.warnings?.messages || [],
      modelDetails: {
        mlModelUsed: data.paddleScore?.mlModelUsed,
        accuracy: '99.98%',
        source: data.paddleScore?.predictionSource
      }
    };

    res.json(gptResponse);

  } catch (error) {
    console.error('GPT Actions paddleScore error:', error.message);
    res.status(500).json({
      error: 'Failed to get paddle score',
      message: error.message
    });
  }
});

/**
 * GET /gptActions/forecast
 * Get 3-day hourly forecast for a location
 * 
 * Query params:
 * - latitude: number (required)
 * - longitude: number (required)
 * 
 * Returns: Simplified hourly forecast for GPT
 */
router.get('/forecast', async (req, res) => {
  try {
    const { latitude, longitude } = req.query;
    
    if (!latitude || !longitude) {
      return res.status(400).json({
        error: 'Missing required parameters: latitude and longitude'
      });
    }

    // Call our existing fastForecast API
    const response = await axios.get(`${BASE_URL}/fastForecast`, {
      params: { lat: latitude, lng: longitude }
    });

    const data = response.data;

    // Simplify forecast data for GPT
    const hourlyForecast = [];
    
    if (data.forecast && Array.isArray(data.forecast)) {
      data.forecast.forEach(day => {
        if (day.hourly) {
          Object.entries(day.hourly).forEach(([hour, hourData]) => {
            hourlyForecast.push({
              time: `${day.date} ${hour}:00`,
              paddleScore: hourData.prediction?.rating || hourData.paddleScore,
              temperature: `${hourData.temperature}°F`,
              windSpeed: `${hourData.windSpeed} mph`,
              conditions: hourData.conditions || 'Unknown'
            });
          });
        }
      });
    }

    // Find best time to paddle
    const bestTime = hourlyForecast.reduce((best, current) => 
      (current.paddleScore > best.paddleScore) ? current : best
    , hourlyForecast[0] || {});

    const gptResponse = {
      location: `${latitude}, ${longitude}`,
      bestTimeToday: {
        time: bestTime.time,
        score: bestTime.paddleScore,
        conditions: `${bestTime.temperature}, ${bestTime.windSpeed} wind`
      },
      hourlyForecast: hourlyForecast.slice(0, 24) // Next 24 hours
    };

    res.json(gptResponse);

  } catch (error) {
    console.error('GPT Actions forecast error:', error.message);
    res.status(500).json({
      error: 'Failed to get forecast',
      message: error.message
    });
  }
});

/**
 * GET /gptActions/locations
 * Get list of popular paddling locations
 * 
 * Query params:
 * - state: string (optional) - filter by state
 * 
 * Returns: List of locations with coordinates
 */
router.get('/locations', async (req, res) => {
  try {
    const { state } = req.query;

    // Call our existing paddlingOut API
    const url = state 
      ? `${BASE_URL}/paddlingOut?state=${state}`
      : `${BASE_URL}/paddlingOut`;
    
    const response = await axios.get(url);
    const data = response.data;

    // Simplify location data for GPT
    const locations = (data.locations || []).map(loc => ({
      name: loc.name,
      state: loc.state,
      coordinates: {
        latitude: loc.coordinates?.latitude,
        longitude: loc.coordinates?.longitude
      },
      description: loc.description,
      amenities: loc.amenities
    }));

    res.json({
      count: locations.length,
      locations: locations
    });

  } catch (error) {
    console.error('GPT Actions locations error:', error.message);
    res.status(500).json({
      error: 'Failed to get locations',
      message: error.message
    });
  }
});

/**
 * POST /gptActions/findNearby
 * Find water bodies near a location
 * 
 * Body params:
 * - latitude: number (required)
 * - longitude: number (required)
 * - radius: number (optional, default 5 miles)
 * 
 * Returns: Nearby lakes and rivers
 */
router.post('/findNearby', async (req, res) => {
  try {
    const { latitude, longitude, radius = 5 } = req.body;
    
    if (!latitude || !longitude) {
      return res.status(400).json({
        error: 'Missing required parameters: latitude and longitude'
      });
    }

    // Call our existing nearbyWater API
    const response = await axios.get(`${BASE_URL}/nearbyWater`, {
      params: { lat: latitude, lng: longitude, radius }
    });

    const data = response.data;

    // Simplify for GPT
    const nearbyWater = (data.water || []).map(w => ({
      name: w.name,
      type: w.type, // lake, river, reservoir
      distance: `${w.distance?.toFixed(1)} miles`,
      coordinates: {
        latitude: w.latitude,
        longitude: w.longitude
      }
    }));

    res.json({
      searchLocation: `${latitude}, ${longitude}`,
      searchRadius: `${radius} miles`,
      found: nearbyWater.length,
      waterBodies: nearbyWater.slice(0, 10) // Top 10 closest
    });

  } catch (error) {
    console.error('GPT Actions findNearby error:', error.message);
    res.status(500).json({
      error: 'Failed to find nearby water',
      message: error.message
    });
  }
});

module.exports = router;
