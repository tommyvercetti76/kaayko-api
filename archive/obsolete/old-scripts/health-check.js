#!/usr/bin/env node

/**
 * 🏥 Kaayko API Production Health Check
 * 
 * Tests all production endpoints to assess current deployment state
 * and identify any issues that need immediate attention.
 */

const https = require('https');
const { performance } = require('perf_hooks');

// Production API endpoints
const ENDPOINTS = {
  fastForecast: 'https://us-central1-kaaykostore.cloudfunctions.net/api/fastForecast',
  paddleScore: 'https://us-central1-kaaykostore.cloudfunctions.net/api/paddleScore', 
  paddlingOut: 'https://us-central1-kaaykostore.cloudfunctions.net/api/paddlingOut',
  forecast: 'https://us-central1-kaaykostore.cloudfunctions.net/api/forecast',
  products: 'https://us-central1-kaaykostore.cloudfunctions.net/api/products',
  images: 'https://us-central1-kaaykostore.cloudfunctions.net/api/images'
};

// Test location (Lewisville Lake, TX)
const TEST_LOCATION = {
  lat: 33.156487,
  lng: -96.949953,
  name: "Lewisville Lake, TX"
};

/**
 * Make HTTP request and measure response time
 */
function makeRequest(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const startTime = performance.now();
    
    const req = https.get(url, { timeout }, (res) => {
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
            rawData: data.substring(0, 200) + '...'
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
 * Test fastForecast endpoint
 */
async function testFastForecast() {
  console.log('\n🔍 Testing FastForecast API...');
  console.log('─'.repeat(50));
  
  const url = `${ENDPOINTS.fastForecast}?lat=${TEST_LOCATION.lat}&lng=${TEST_LOCATION.lng}`;
  const result = await makeRequest(url);
  
  if (result.success) {
    const data = result.data;
    console.log(`✅ Status: ${result.status} | Time: ${result.responseTime}ms`);
    console.log(`📊 Response size: ${result.size} bytes`);
    
    if (data.forecast && Array.isArray(data.forecast)) {
      console.log(`📅 Forecast days: ${data.forecast.length}`);
      
      // Check first day's hourly data
      const firstDay = data.forecast[0];
      if (firstDay && firstDay.hourly) {
        const hourlyKeys = Object.keys(firstDay.hourly);
        console.log(`⏰ Hours available: ${hourlyKeys.length}`);
        
        // Check if we have ML predictions
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
    return { endpoint: 'fastForecast', ...result, healthy: false };
  }
}

/**
 * Test paddleScore endpoint  
 */
async function testPaddleScore() {
  console.log('\n🔍 Testing PaddleScore API...');
  console.log('─'.repeat(50));
  
  const url = `${ENDPOINTS.paddleScore}?location=${TEST_LOCATION.lat},${TEST_LOCATION.lng}`;
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
      }
    }
    
    if (data.conditions) {
      console.log(`🌡️ Temperature: ${data.conditions.temperature}°F`);
      console.log(`💨 Wind: ${data.conditions.windSpeed} mph`);
    }
    
    return { endpoint: 'paddleScore', ...result, healthy: true };
  } else {
    console.log(`❌ Failed: ${result.error} | Time: ${result.responseTime}ms`);
    return { endpoint: 'paddleScore', ...result, healthy: false };
  }
}

/**
 * Test paddlingOut endpoint
 */
async function testPaddlingOut() {
  console.log('\n🔍 Testing PaddlingOut API...');
  console.log('─'.repeat(50));
  
  const result = await makeRequest(ENDPOINTS.paddlingOut);
  
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
 * Test forecast endpoint (internal/premium)
 */
async function testForecast() {
  console.log('\n🔍 Testing Forecast API (Internal)...');
  console.log('─'.repeat(50));
  
  const url = `${ENDPOINTS.forecast}?lat=${TEST_LOCATION.lat}&lng=${TEST_LOCATION.lng}`;
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
    return { endpoint: 'forecast', ...result, healthy: false };
  }
}

/**
 * Run complete health check
 */
async function runHealthCheck() {
  console.log('🏥 KAAYKO API PRODUCTION HEALTH CHECK');
  console.log('═'.repeat(70));
  console.log(`📍 Test Location: ${TEST_LOCATION.name}`);
  console.log(`🕐 Started: ${new Date().toISOString()}`);
  
  const results = [];
  
  // Test core APIs
  results.push(await testFastForecast());
  results.push(await testPaddleScore());
  results.push(await testPaddlingOut());
  results.push(await testForecast());
  
  // Summary
  console.log('\n📋 HEALTH CHECK SUMMARY');
  console.log('═'.repeat(70));
  
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

// Run the health check
runHealthCheck().catch(console.error);
