#!/usr/bin/env node
// Manual Cache Warmer for All Paddling Locations

const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
  console.log('✅ Firebase Admin initialized');
}

const { db } = require('../functions/src/config/apiConfig');
const unifiedWeatherService = require('../functions/src/services/unifiedWeatherService');
const { mlService } = require('../functions/src/services/mlService');

async function getAllPaddlingLocations() {
  console.log('📍 Fetching all paddling locations...');
  
  try {
    const snapshot = await db.collection('paddlingSpots').get();
    const locations = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.location && data.location.coordinates) {
        locations.push({
          id: doc.id,
          name: data.lakeName || data.title || doc.id,
          coordinates: data.location.coordinates
        });
      }
    });
    
    console.log(`✅ Found ${locations.length} paddling locations`);
    return locations;
  } catch (error) {
    console.error('❌ Error fetching locations:', error);
    return [];
  }
}

async function warmCacheForLocation(location) {
  const startTime = Date.now();
  
  try {
    console.log(`🔥 Warming cache for ${location.name}...`);
    
    // Generate current forecast (what heatmap needs)
    const weatherData = await unifiedWeatherService.getCurrentWeather(
      location.coordinates.latitude,
      location.coordinates.longitude
    );
    
    if (!weatherData.success) {
      throw new Error(weatherData.error);
    }
    
    // Get ML prediction
    const mlPrediction = await mlService.getPrediction(weatherData.data);
    
    // Cache the forecast result
    const cacheKey = `current_${location.id}`;
    const forecastData = {
      success: true,
      location: {
        name: location.name,
        coordinates: location.coordinates
      },
      forecast: [{
        date: new Date().toISOString().split('T')[0],
        hourly: {
          [new Date().getHours()]: {
            ...weatherData.data,
            prediction: mlPrediction,
            rating: mlPrediction.rating,
            mlModelUsed: mlPrediction.mlModelUsed || true
          }
        }
      }],
      metadata: {
        cached: true,
        cacheTime: new Date().toISOString(),
        source: 'scheduled_cache_warming',
        forecastDays: 1
      }
    };
    
    // Store in Firestore cache
    await db.collection('forecastCache').doc(cacheKey).set({
      data: forecastData,
      cachedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
      location: location.id,
      type: 'current'
    });
    
    const duration = Date.now() - startTime;
    console.log(`  ✅ ${location.name}: ${duration}ms`);
    
    return { success: true, location: location.name, duration };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`  ❌ ${location.name}: ${error.message} (${duration}ms)`);
    return { success: false, location: location.name, error: error.message, duration };
  }
}

async function warmAllCaches() {
  console.log('🚀 Starting Manual Cache Warming');
  console.log('================================');
  
  const startTime = Date.now();
  const locations = await getAllPaddlingLocations();
  
  if (locations.length === 0) {
    console.log('❌ No locations found to warm');
    return;
  }
  
  console.log(`⏰ Warming cache for ${locations.length} locations...`);
  console.log('');
  
  const results = [];
  
  // Process locations in parallel (but limit concurrency)
  const BATCH_SIZE = 3;
  for (let i = 0; i < locations.length; i += BATCH_SIZE) {
    const batch = locations.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(location => warmCacheForLocation(location))
    );
    results.push(...batchResults);
  }
  
  const totalDuration = Date.now() - startTime;
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success);
  
  console.log('\n📊 CACHE WARMING COMPLETE');
  console.log('========================');
  console.log(`✅ Successful: ${successful}/${locations.length} locations`);
  console.log(`❌ Failed: ${failed.length} locations`);
  console.log(`⏱️ Total Duration: ${totalDuration}ms (${(totalDuration/1000).toFixed(1)}s)`);
  console.log(`📈 Average per location: ${Math.round(totalDuration/locations.length)}ms`);
  
  if (failed.length > 0) {
    console.log('\n❌ Failed Locations:');
    failed.forEach(f => console.log(`  - ${f.location}: ${f.error}`));
  }
  
  console.log('\n🎯 Cache is now warmed! Heatmap requests should be ~50-100ms');
  console.log('');
  console.log('🧪 Test with:');
  console.log('curl -w "\\n⚡ Time: %{time_total}s\\n" "http://127.0.0.1:5001/kaaykostore/us-central1/api/fastForecast?spotId=jackson&days=current"');
}

// Run the cache warming
warmAllCaches().catch(console.error);
