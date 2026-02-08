/**
 * GPT Actions Handlers — ChatGPT Custom GPT endpoints
 * Extracted from gptActions.js for primer compliance.
 *
 * @module api/ai/gptActionHandlers
 */

const axios = require('axios');
const BASE_URL = 'https://us-central1-kaaykostore.cloudfunctions.net/api';

function health(req, res) {
  res.json({ success: true, service: 'GPT Actions API', status: 'running',
    endpoints: ['/paddleScore', '/forecast', '/locations', '/findNearby'], version: '2.0.0' });
}

async function paddleScore(req, res) {
  try {
    const { latitude, longitude } = req.query;
    if (!latitude || !longitude) return res.status(400).json({ error: 'Missing required parameters: latitude and longitude' });

    const response = await axios.get(`${BASE_URL}/paddleScore`, { params: { lat: latitude, lng: longitude } });
    const data = response.data;

    res.json({
      location: { name: data.location?.name || `${latitude}, ${longitude}`, coordinates: `${latitude}, ${longitude}` },
      paddleScore: { rating: data.paddleScore?.rating, interpretation: data.paddleScore?.interpretation, outOf: 5.0 },
      currentConditions: {
        temperature: `${data.conditions?.temperature}°F`, windSpeed: `${data.conditions?.windSpeed} mph`,
        waterTemperature: data.conditions?.marine?.waterTemp ? `${data.conditions.marine.waterTemp}°F` : 'Unknown',
        humidity: `${data.conditions?.humidity}%`, cloudCover: `${data.conditions?.cloudCover}%`,
        uvIndex: data.conditions?.uvIndex, visibility: `${data.conditions?.visibility} miles`
      },
      safetyWarnings: data.warnings?.messages || [],
      modelDetails: { mlModelUsed: data.paddleScore?.mlModelUsed, accuracy: '99.98%', source: data.paddleScore?.predictionSource }
    });
  } catch (error) {
    console.error('GPT Actions paddleScore error:', error.message);
    res.status(500).json({ error: 'Failed to get paddle score', message: error.message });
  }
}

async function forecast(req, res) {
  try {
    const { latitude, longitude } = req.query;
    if (!latitude || !longitude) return res.status(400).json({ error: 'Missing required parameters: latitude and longitude' });

    const response = await axios.get(`${BASE_URL}/fastForecast`, { params: { lat: latitude, lng: longitude } });
    const data = response.data;

    const hourlyForecast = [];
    if (data.forecast && Array.isArray(data.forecast)) {
      data.forecast.forEach(day => {
        if (day.hourly) {
          Object.entries(day.hourly).forEach(([hour, hourData]) => {
            hourlyForecast.push({ time: `${day.date} ${hour}:00`, paddleScore: hourData.prediction?.rating || hourData.paddleScore,
              temperature: `${hourData.temperature}°F`, windSpeed: `${hourData.windSpeed} mph`, conditions: hourData.conditions || 'Unknown' });
          });
        }
      });
    }

    const bestTime = hourlyForecast.reduce((best, cur) => (cur.paddleScore > best.paddleScore) ? cur : best, hourlyForecast[0] || {});
    res.json({ location: `${latitude}, ${longitude}`,
      bestTimeToday: { time: bestTime.time, score: bestTime.paddleScore, conditions: `${bestTime.temperature}, ${bestTime.windSpeed} wind` },
      hourlyForecast: hourlyForecast.slice(0, 24) });
  } catch (error) {
    console.error('GPT Actions forecast error:', error.message);
    res.status(500).json({ error: 'Failed to get forecast', message: error.message });
  }
}

async function locations(req, res) {
  try {
    const { state } = req.query;
    const url = state ? `${BASE_URL}/paddlingOut?state=${state}` : `${BASE_URL}/paddlingOut`;
    const response = await axios.get(url);
    const locs = (response.data.locations || []).map(loc => ({
      name: loc.name, state: loc.state,
      coordinates: { latitude: loc.coordinates?.latitude, longitude: loc.coordinates?.longitude },
      description: loc.description, amenities: loc.amenities
    }));
    res.json({ count: locs.length, locations: locs });
  } catch (error) {
    console.error('GPT Actions locations error:', error.message);
    res.status(500).json({ error: 'Failed to get locations', message: error.message });
  }
}

async function findNearby(req, res) {
  try {
    const { latitude, longitude, radius = 5 } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ error: 'Missing required parameters: latitude and longitude' });

    const response = await axios.get(`${BASE_URL}/nearbyWater`, { params: { lat: latitude, lng: longitude, radius } });
    const nearbyWater = (response.data.water || []).map(w => ({
      name: w.name, type: w.type, distance: `${w.distance?.toFixed(1)} miles`,
      coordinates: { latitude: w.latitude, longitude: w.longitude }
    }));
    res.json({ searchLocation: `${latitude}, ${longitude}`, searchRadius: `${radius} miles`, found: nearbyWater.length, waterBodies: nearbyWater.slice(0, 10) });
  } catch (error) {
    console.error('GPT Actions findNearby error:', error.message);
    res.status(500).json({ error: 'Failed to find nearby water', message: error.message });
  }
}

module.exports = { health, paddleScore, forecast, locations, findNearby };
