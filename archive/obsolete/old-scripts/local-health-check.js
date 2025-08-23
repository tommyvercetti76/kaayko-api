#!/usr/bin/env node

/**
 * 🏥 Local API Health Check
 * 
 * Tests local Firebase functions emulator + production paddlingOut & ML service
 * This gives us the real picture of what's working locally vs production
 */

const https = require('https');
const http = require('http');
const { performance } = require('perf_hooks');

// Local emulator endpoints
const LOCAL_BASE = 'http://127.0.0.1:5001/kaaykostore/us-central1/api';

// Production endpoints (only for paddlingOut and ML service)  
const PRODUCTION_BASE = 'https://us-central1-kaaykostore.cloudfunctions.net/api';

// Test location
const TEST_LOCATION = {
  lat: 33.156487,
  lng: -96.949953,
  name: "Lewisville Lake, TX"
};

/**
 * Make HTTP request (handles both http and https)
 */
function makeRequest(url, timeout = 10000) {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const isHttps = url.startsWith('https://');
    const requestLib = isHttps ? https : http;
    
    const req = requestLib.get(url, { timeout }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const responseTime = Math.round(performance.now() - startTime);
        
        try {
          const parsedData = JSON.parse(data);
          resolve({
            success: true,
            status: res.statusCode,
            responseTime,
            data: parsedData,
            size: data.length
          });
        } catch (error) {
          resolve({
            success: false,
            status: res.statusCode,
            responseTime,
            error: 'Invalid JSON response',
            rawData: data.substring(0, 300) + '...'
          });
        }
      });
    });
    
    req.on('error', (error) => {
      const responseTime = Math.round(performance.now() - startTime);
      resolve({
        success: false,
        status: 0,
        responseTime,
        error: error.message
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      const responseTime = Math.round(performance.now() - startTime);
      resolve({
        success: false,
        status: 0,
        responseTime,
        error: 'Request timeout'
      });
    });
  });
}

/**
 * Test local fastForecast API
 */
async function testLocalFastForecast() {
  console.log('\n🔍 Testing LOCAL FastForecast API...');
  console.log('─'.repeat(50));
  
  const url = `${LOCAL_BASE}/fastForecast?lat=${TEST_LOCATION.lat}&lng=${TEST_LOCATION.lng}`;
  const result = await makeRequest(url);
  
  if (result.success) {
    const data = result.data;
    console.log(`✅ Status: ${result.status} | Time: ${result.responseTime}ms`);
    
    if (data.forecast && Array.isArray(data.forecast)) {
      console.log(`📅 Forecast days: ${data.forecast.length}`);
      
      // Check first day's hourly data
      const firstDay = data.forecast[0];
      if (firstDay && firstDay.hourly) {
        const hourlyKeys = Object.keys(firstDay.hourly);
        console.log(`⏰ Hours available: ${hourlyKeys.length}`);
        
        // Check ML predictions
        const sampleHour = firstDay.hourly[hourlyKeys[0]];
        if (sampleHour && sampleHour.prediction) {
          console.log(`🤖 ML predictions: ✅ Available`);
          console.log(`🎯 Sample rating: ${sampleHour.prediction.rating}`);
        } else {
          console.log(`🤖 ML predictions: ❌ Missing`);
        }
      }
    }
    
    console.log(`📍 Location: ${data.location?.name || 'Unknown'}`);
    console.log(`💾 Cached: ${data.metadata?.cached ? '✅' : '❌'}`);
    
    return { endpoint: 'fastForecast', ...result, healthy: true };
  } else {
    console.log(`❌ Failed: ${result.error} | Time: ${result.responseTime}ms`);
    if (result.rawData) {
      console.log(`📄 Response sample: ${result.rawData.substring(0, 100)}...`);
    }
    return { endpoint: 'fastForecast', ...result, healthy: false };
  }
}

/**
 * Test local paddleScore API
 */
async function testLocalPaddleScore() {
  console.log('\n🔍 Testing LOCAL PaddleScore API...');
  console.log('─'.repeat(50));
  
  const url = `${LOCAL_BASE}/paddleScore?location=${TEST_LOCATION.lat},${TEST_LOCATION.lng}`;
  const result = await makeRequest(url);
  
  if (result.success) {
    const data = result.data;
    console.log(`✅ Status: ${result.status} | Time: ${result.responseTime}ms`);
    
    if (data.paddleScore) {
      console.log(`🎯 Paddle Rating: ${data.paddleScore.rating}/5.0`);
      console.log(`💭 Interpretation: ${data.paddleScore.interpretation}`);
      console.log(`🤖 ML Model Used: ${data.paddleScore.mlModelUsed ? '✅' : '❌'}`);
      
      if (data.paddleScore.penaltiesApplied && data.paddleScore.penaltiesApplied.length > 0) {
        console.log(`⚠️ Penalties: ${data.paddleScore.penaltiesApplied.length}`);
        data.paddleScore.penaltiesApplied.forEach(penalty => {
          console.log(`   - ${penalty}`);
        });
      }
    }
    
    if (data.conditions) {
      console.log(`🌡️ Temperature: ${data.conditions.temperature}°F`);
      console.log(`💨 Wind: ${data.conditions.windSpeed} mph`);
    }
    
    return { endpoint: 'paddleScore', ...result, healthy: true };
  } else {
    console.log(`❌ Failed: ${result.error} | Time: ${result.responseTime}ms`);
    if (result.rawData) {
      console.log(`📄 Response sample: ${result.rawData.substring(0, 100)}...`);
    }
    return { endpoint: 'paddleScore', ...result, healthy: false };
  }
}

/**
 * Test local forecast API
 */
async function testLocalForecast() {
  console.log('\n🔍 Testing LOCAL Forecast API (Internal)...');
  console.log('─'.repeat(50));
  
  const url = `${LOCAL_BASE}/forecast?lat=${TEST_LOCATION.lat}&lng=${TEST_LOCATION.lng}`;
  const result = await makeRequest(url, 15000); // Longer timeout for ML processing
  
  if (result.success) {
    const data = result.data;
    console.log(`✅ Status: ${result.status} | Time: ${result.responseTime}ms`);
    
    if (data.forecast && Array.isArray(data.forecast)) {
      console.log(`📅 Forecast days: ${data.forecast.length}`);
      
      // Check ML integration
      const firstDay = data.forecast[0];
      if (firstDay && firstDay.hourly) {
        const hourlyKeys = Object.keys(firstDay.hourly);
        const sampleHour = firstDay.hourly[hourlyKeys[0]];
        
        if (sampleHour && sampleHour.prediction) {
          console.log(`🤖 ML Integration: ✅ Working`);
          console.log(`🎯 Sample rating: ${sampleHour.prediction.rating}`);
          console.log(`📊 ML Model: ${sampleHour.prediction.mlModelUsed || 'Unknown'}`);
        } else {
          console.log(`🤖 ML Integration: ❌ Missing`);
        }
      }
    }
    
    return { endpoint: 'forecast', ...result, healthy: true };
  } else {
    console.log(`❌ Failed: ${result.error} | Time: ${result.responseTime}ms`);
    if (result.responseTime > 10000) {
      console.log(`⚠️ Slow response - may indicate ML service issues`);
    }
    if (result.rawData) {
      console.log(`📄 Response sample: ${result.rawData.substring(0, 100)}...`);
    }
    return { endpoint: 'forecast', ...result, healthy: false };
  }
}

/**
 * Test production paddlingOut API
 */
async function testProductionPaddlingOut() {
  console.log('\n🔍 Testing PRODUCTION PaddlingOut API...');
  console.log('─'.repeat(50));
  
  const url = `${PRODUCTION_BASE}/paddlingOut`;
  const result = await makeRequest(url);
  
  if (result.success) {
    const data = result.data;
    console.log(`✅ Status: ${result.status} | Time: ${result.responseTime}ms`);
    
    if (data.locations && Array.isArray(data.locations)) {
      console.log(`📍 Total locations: ${data.locations.length}`);
      
      // Check data structure
      const sampleLocation = data.locations[0];
      if (sampleLocation) {
        console.log(`📋 Sample location: ${sampleLocation.title}`);
        console.log(`🗺️ Has coordinates: ${sampleLocation.location?.latitude ? '✅' : '❌'}`);
        console.log(`🚗 Has amenities: ${sampleLocation.parkingAvl !== undefined ? '✅' : '❌'}`);
      }
    }
    
    return { endpoint: 'paddlingOut', ...result, healthy: true };
  } else {
    console.log(`❌ Failed: ${result.error} | Time: ${result.responseTime}ms`);
    return { endpoint: 'paddlingOut', ...result, healthy: false };
  }
}

/**
 * Test ML service directly
 */
async function testMLService() {
  console.log('\n🔍 Testing ML Service (Production)...');
  console.log('─'.repeat(50));
  
  const mlUrl = 'https://kaayko-ml-service-87383373015.us-central1.run.app/predict';
  
  // Sample features for ML prediction
  const features = {
    temperature: 75,
    windSpeed: 8,
    hasWarnings: false,
    uvIndex: 5,
    visibility: 10,
    humidity: 60,
    cloudCover: 30,
    latitude: TEST_LOCATION.lat,
    longitude: TEST_LOCATION.lng
  };
  
  const postData = JSON.stringify({ features });
  
  return new Promise((resolve) => {
    const startTime = performance.now();
    
    const req = https.request(mlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const responseTime = Math.round(performance.now() - startTime);
        
        try {
          const parsedData = JSON.parse(data);
          console.log(`✅ Status: ${res.statusCode} | Time: ${responseTime}ms`);
          console.log(`🎯 ML Rating: ${parsedData.rating}/5.0`);
          console.log(`🤖 Model Used: ${parsedData.mlModelUsed ? '✅' : '❌'}`);
          console.log(`📊 Source: ${parsedData.predictionSource}`);
          
          resolve({ 
            endpoint: 'mlService', 
            success: true, 
            status: res.statusCode, 
            responseTime,
            healthy: true 
          });
        } catch (error) {
          console.log(`❌ Invalid JSON: ${error.message}`);
          resolve({ 
            endpoint: 'mlService', 
            success: false, 
            responseTime,
            error: 'Invalid JSON response',
            healthy: false 
          });
        }
      });
    });
    
    req.on('error', (error) => {
      const responseTime = Math.round(performance.now() - startTime);
      console.log(`❌ Failed: ${error.message} | Time: ${responseTime}ms`);
      resolve({ 
        endpoint: 'mlService', 
        success: false, 
        responseTime,
        error: error.message,
        healthy: false 
      });
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * Run complete local + production health check
 */
async function runMixedHealthCheck() {
  console.log('🏥 KAAYKO API MIXED HEALTH CHECK (Local + Production)');
  console.log('═'.repeat(80));
  console.log(`📍 Test Location: ${TEST_LOCATION.name}`);
  console.log(`🕐 Started: ${new Date().toISOString()}`);
  console.log(`🖥️ Local APIs: fastForecast, paddleScore, forecast`);
  console.log(`☁️ Production APIs: paddlingOut, ML service`);
  
  const results = [];
  
  // Test local APIs
  results.push(await testLocalFastForecast());
  results.push(await testLocalPaddleScore());
  results.push(await testLocalForecast());
  
  // Test production APIs
  results.push(await testProductionPaddlingOut());
  results.push(await testMLService());
  
  // Summary
  console.log('\n📋 MIXED HEALTH CHECK SUMMARY');
  console.log('═'.repeat(80));
  
  const healthyApis = results.filter(r => r.healthy);
  const unhealthyApis = results.filter(r => !r.healthy);
  
  console.log(`✅ Healthy APIs: ${healthyApis.length}/${results.length}`);
  console.log(`❌ Unhealthy APIs: ${unhealthyApis.length}/${results.length}`);
  
  // Performance summary
  const responseTimes = healthyApis.map(r => r.responseTime);
  if (responseTimes.length > 0) {
    const avgTime = Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length);
    const maxTime = Math.max(...responseTimes);
    console.log(`⚡ Average response time: ${avgTime}ms`);
    console.log(`🐌 Slowest response time: ${maxTime}ms`);
  }
  
  // Detailed results
  if (unhealthyApis.length > 0) {
    console.log('\n❌ FAILED ENDPOINTS:');
    unhealthyApis.forEach(api => {
      console.log(`   ${api.endpoint}: ${api.error} (${api.responseTime}ms)`);
    });
  }
  
  if (healthyApis.length > 0) {
    console.log('\n✅ HEALTHY ENDPOINTS:');
    healthyApis.forEach(api => {
      console.log(`   ${api.endpoint}: ${api.responseTime}ms`);
    });
  }
  
  console.log(`\n🕐 Completed: ${new Date().toISOString()}`);
  
  // Overall health score
  const healthScore = Math.round((healthyApis.length / results.length) * 100);
  console.log(`🏥 Overall Health Score: ${healthScore}%`);
  
  if (healthScore >= 90) {
    console.log('🎉 System Status: EXCELLENT');
  } else if (healthScore >= 75) {
    console.log('✅ System Status: GOOD');
  } else if (healthScore >= 50) {
    console.log('⚠️ System Status: NEEDS ATTENTION');
  } else {
    console.log('🚨 System Status: CRITICAL');
  }
  
  return {
    totalApis: results.length,
    healthyApis: healthyApis.length,
    healthScore,
    results
  };
}

// Run the mixed health check
runMixedHealthCheck().catch(console.error);
