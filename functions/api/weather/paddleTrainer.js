const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const axios = require('axios');
const { WEATHER_CONFIG } = require('../../config/weatherConfig');

const db = admin.firestore();

// GET /paddle-trainer/tourist-lakes
router.get('/tourist-lakes', async (req, res) => {
  try {
    const snapshot = await db.collection('paddlingSpots').get();
    const lakes = snapshot.docs.map(doc => {
      const d = doc.data();
      const loc = d.location || {};
      return {
        id: doc.id,
        name: d.title || d.lakeName || doc.id,
        region: d.subtitle || '',
        lat: loc.latitude ?? loc._latitude ?? loc.lat,
        lng: loc.longitude ?? loc._longitude ?? loc.lng,
      };
    }).filter(l => l.lat && l.lng).sort((a, b) => a.name.localeCompare(b.name));

    res.set('Cache-Control', 'public, max-age=300');
    return res.json({ lakes });
  } catch (err) {
    console.error('paddle-trainer tourist-lakes error:', err.message);
    return res.status(500).json({ error: 'Failed to load lakes' });
  }
});

// GET /paddle-trainer/tourist-weather?lake=id&lat=X&lng=Y&date=YYYY-MM-DD
router.get('/tourist-weather', async (req, res) => {
  const { lake, lat, lng, date } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const apiKey = WEATHER_CONFIG.API_KEY_VALUE;
  const coords = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
  const today = new Date().toISOString().slice(0, 10);
  const isHistorical = date && date !== 'now' && date !== today;

  try {
    let weatherData;

    if (isHistorical) {
      const [histRes, marineRes] = await Promise.all([
        axios.get(`${WEATHER_CONFIG.BASE_URL}/history.json`, {
          params: { key: apiKey, q: coords, dt: date },
          timeout: WEATHER_CONFIG.TIMEOUT,
        }),
        axios.get(WEATHER_CONFIG.MARINE_URL, {
          params: { key: apiKey, q: coords, dt: date },
          timeout: WEATHER_CONFIG.TIMEOUT,
        }).catch(() => null),
      ]);

      const hours = histRes.data?.forecast?.forecastday?.[0]?.hour || [];
      const noon = hours.find(h => new Date(h.time).getHours() === 12) || hours[Math.floor(hours.length / 2)] || hours[0];
      if (!noon) return res.status(404).json({ error: 'No historical data for this date' });

      const marineHours = marineRes?.data?.forecast?.forecastday?.[0]?.hour || [];
      const marineNoon = marineHours.find(h => new Date(h.time).getHours() === 12) || marineHours[0];

      weatherData = mapHourlyToWeather(noon, marineNoon);
    } else {
      const [currentRes, marineRes] = await Promise.all([
        axios.get(WEATHER_CONFIG.CURRENT_URL, {
          params: { key: apiKey, q: coords, aqi: 'no' },
          timeout: WEATHER_CONFIG.TIMEOUT,
        }),
        axios.get(WEATHER_CONFIG.MARINE_URL, {
          params: { key: apiKey, q: coords, days: 1 },
          timeout: WEATHER_CONFIG.TIMEOUT,
        }).catch(() => null),
      ]);

      const c = currentRes.data.current;
      const marineHours = marineRes?.data?.forecast?.forecastday?.[0]?.hour || [];
      const currentHour = new Date().getHours();
      const marineNow = marineHours.find(h => new Date(h.time).getHours() === currentHour)
        || marineHours[marineHours.length - 1];

      weatherData = {
        datetime: new Date().toISOString().replace('T', ' ').slice(0, 16),
        temp_c: c.temp_c,
        wind_kph: c.wind_kph,
        wind_dir: c.wind_dir,
        gust_kph: c.gust_kph,
        humidity: c.humidity,
        cloud: c.cloud,
        feelslike_c: c.feelslike_c,
        vis_km: c.vis_km,
        uv: c.uv,
        precip_mm: c.precip_mm,
        pressure_mb: c.pressure_mb,
        is_day: c.is_day,
        condition: c.condition?.text || '',
        dewpoint_c: c.dewpoint_c,
        will_it_rain: c.precip_mm > 0.5 ? 1 : 0,
        will_it_snow: (c.temp_c < 2 && c.precip_mm > 0) ? 1 : 0,
        estimated_water_temp_c: marineNow?.water_temp_c ?? null,
        estimated_wave_height_m: marineNow?.sig_ht_mt ?? null,
      };
    }

    if (lake) {
      try {
        const spotDoc = await db.collection('paddlingSpots').doc(lake).get();
        if (spotDoc.exists) {
          const s = spotDoc.data();
          weatherData.lake_size_class = s.lakeSize || 'unknown';
          weatherData.waterbody_class = s.waterbodyClass || 'lake';
          weatherData.climate_zone = s.climateZone || '';
          weatherData.lake_area_km2 = s.lakeAreaKm2 || '';
        }
      } catch {}
    }

    res.set('Cache-Control', 'public, max-age=300');
    return res.json({ weather: weatherData, source: 'live', date: weatherData.datetime });
  } catch (err) {
    console.error('paddle-trainer tourist-weather error:', err.message);
    return res.status(500).json({ error: 'Weather fetch failed' });
  }
});

// POST /paddle-trainer/ratings
router.post('/ratings', async (req, res) => {
  const body = req.body;
  if (!body || !body.rating) return res.status(400).json({ error: 'rating required' });

  const record = {
    ...body,
    id: body.id || require('crypto').randomUUID(),
    createdAt: body.createdAt || new Date().toISOString(),
    source: body.ratingMode || 'tourist',
    savedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    await db.collection('paddle_trainer_ratings').doc(record.id).set(record);
    return res.json({ record });
  } catch (err) {
    console.error('paddle-trainer ratings POST error:', err.message);
    return res.status(500).json({ error: 'Failed to save rating' });
  }
});

function mapHourlyToWeather(hour, marineHour) {
  return {
    datetime: (hour.time || '').replace('T', ' '),
    temp_c: hour.temp_c,
    wind_kph: hour.wind_kph,
    wind_dir: hour.wind_dir,
    gust_kph: hour.gust_kph,
    humidity: hour.humidity,
    cloud: hour.cloud,
    feelslike_c: hour.feelslike_c,
    vis_km: hour.vis_km,
    uv: hour.uv,
    precip_mm: hour.precip_mm,
    pressure_mb: hour.pressure_mb,
    is_day: hour.is_day,
    condition: hour.condition?.text || '',
    dewpoint_c: hour.dewpoint_c,
    will_it_rain: hour.will_it_rain || 0,
    will_it_snow: hour.will_it_snow || 0,
    estimated_water_temp_c: marineHour?.water_temp_c ?? null,
    estimated_wave_height_m: marineHour?.sig_ht_mt ?? null,
  };
}

module.exports = router;
