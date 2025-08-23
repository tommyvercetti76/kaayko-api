// testing/api-tests/fastforecast_comprehensive.js
//
// 🧪 COMPREHENSIVE FASTFORECAST API TEST SUITE
//
// Tests all fastForecast API functionality including:
// - Current-only requests (heatmap optimization)
// - Full 3-day forecasts (detail view)  
// - All 17 paddling locations
// - ML service integration
// - Performance benchmarks

const axios = require('axios');

// Test configuration
const config = {
  baseUrl: process.env.BASE_URL || 'http://127.0.0.1:5001/kaaykostore/us-central1/api',
  timeout: 10000,
  paddlingSpots: [
    'ambazari', 'antero', 'colorado', 'cottonwood', 'crescent', 'diablo',
    'jackson', 'jenny', 'kens', 'lewisville', 'mcdonald', 'merrimack',
    'powell', 'taylorpark', 'trinity', 'union', 'whiterock'
  ]
};

// Test results tracking
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: [],
  performance: {}
};

/**
 * Test runner utility
 */
async function runTest(name, testFn, category = 'general') {
  results.total++;
  const startTime = Date.now();
  
  try {
    console.log(`🧪 Testing: ${name}`);
    const result = await testFn();
    const duration = Date.now() - startTime;
    
    if (result.success) {
      results.passed++;
      console.log(`✅ ${name} - ${duration}ms`);
    } else {
      results.failed++;
      console.log(`❌ ${name} - ${result.error}`);
      results.errors.push({ test: name, error: result.error, category });
    }
    
    // Track performance metrics
    if (!results.performance[category]) {
      results.performance[category] = [];
    }
    results.performance[category].push({ test: name, duration, success: result.success });
    
    return result;
  } catch (error) {
    results.failed++;
    const duration = Date.now() - startTime;
    console.log(`❌ ${name} - ${error.message}`);
    results.errors.push({ test: name, error: error.message, category });
    return { success: false, error: error.message };
  }
}

/**
 * HTTP request helper
 */
async function makeRequest(endpoint, params = {}) {
  const url = `${config.baseUrl}${endpoint}`;
  const queryString = Object.keys(params).length > 0 ? 
    '?' + new URLSearchParams(params).toString() : '';
  
  const response = await axios.get(url + queryString, {
    timeout: config.timeout,
    validateStatus: () => true // Accept all status codes
  });
  
  return {
    statusCode: response.status,
    data: response.data,
    headers: response.headers
  };
}

/**
 * 1. BASIC ENDPOINT TESTS
 */
async function testHealthEndpoint() {
  const response = await makeRequest('/fastForecast/health');
  return {
    success: response.statusCode === 200 && response.data.success === true,
    error: response.statusCode !== 200 ? `Status ${response.statusCode}` : null
  };
}

async function testSpotsEndpoint() {
  const response = await makeRequest('/fastForecast/spots');
  return {
    success: response.statusCode === 200 && 
             response.data.success === true && 
             response.data.spots && 
             response.data.spots.length >= 17,
    error: response.statusCode !== 200 ? 
           `Status ${response.statusCode}` : 
           !response.data.spots ? 'No spots data' :
           response.data.spots.length < 17 ? `Only ${response.data.spots.length} spots found` : null
  };
}

/**
 * 2. HEATMAP OPTIMIZATION TESTS (days=current)
 */
async function testCurrentOnlyRequest() {
  const response = await makeRequest('/fastForecast', {
    spotId: 'jackson',
    days: 'current'
  });
  
  const isValid = response.statusCode === 200 &&
                  response.data.success === true &&
                  response.data.forecast &&
                  response.data.forecast.length === 1 && // Only 1 day
                  response.data.metadata &&
                  response.data.metadata.forecastDays === 1;
  
  return {
    success: isValid,
    error: !isValid ? 'Current-only format validation failed' : null,
    responseTime: response.data.response_time_ms
  };
}

async function testHeatmapPerformance() {
  const spotTests = [];
  const startTime = Date.now();
  
  // Test first 5 spots for performance (representative sample)
  for (const spotId of config.paddlingSpots.slice(0, 5)) {
    const spotStart = Date.now();
    const response = await makeRequest('/fastForecast', {
      spotId,
      days: 'current'
    });
    const spotDuration = Date.now() - spotStart;
    
    spotTests.push({
      spotId,
      duration: spotDuration,
      success: response.statusCode === 200,
      responseTime: response.data.response_time_ms
    });
  }
  
  const totalDuration = Date.now() - startTime;
  const avgDuration = totalDuration / spotTests.length;
  const successRate = spotTests.filter(t => t.success).length / spotTests.length;
  
  return {
    success: successRate >= 0.8 && avgDuration < 3000, // 80% success, <3s avg
    error: successRate < 0.8 ? `Only ${(successRate * 100).toFixed(1)}% success rate` :
           avgDuration >= 3000 ? `Average ${avgDuration}ms too slow` : null,
    performance: { totalDuration, avgDuration, successRate, spotTests }
  };
}

/**
 * 3. FULL FORECAST TESTS (days=3)
 */
async function testFullForecastRequest() {
  const response = await makeRequest('/fastForecast', {
    spotId: 'jackson',
    days: '3'
  });
  
  const isValid = response.statusCode === 200 &&
                  response.data.success === true &&
                  response.data.forecast &&
                  response.data.forecast.length === 3 && // 3 days
                  response.data.metadata &&
                  response.data.metadata.forecastDays === 3;
  
  // Verify hourly data structure
  let hasHourlyData = true;
  if (isValid && response.data.forecast[0].hourly) {
    const hourKeys = Object.keys(response.data.forecast[0].hourly);
    hasHourlyData = hourKeys.length > 0;
  }
  
  return {
    success: isValid && hasHourlyData,
    error: !isValid ? 'Full forecast format validation failed' :
           !hasHourlyData ? 'Missing hourly data' : null,
    responseTime: response.data.response_time_ms
  };
}

async function testPerformanceComparison() {
  const currentStart = Date.now();
  const currentResponse = await makeRequest('/fastForecast', {
    spotId: 'jackson',
    days: 'current'
  });
  const currentDuration = Date.now() - currentStart;
  
  const fullStart = Date.now();
  const fullResponse = await makeRequest('/fastForecast', {
    spotId: 'jackson',
    days: '3'
  });
  const fullDuration = Date.now() - fullStart;
  
  const speedImprovement = ((fullDuration - currentDuration) / fullDuration * 100).toFixed(1);
  const isOptimized = currentDuration < fullDuration;
  
  return {
    success: isOptimized,
    error: !isOptimized ? 'Current request not faster than full forecast' : null,
    performance: {
      currentDuration,
      fullDuration,
      speedImprovement: `${speedImprovement}%`,
      optimization: `${(fullDuration / currentDuration).toFixed(1)}x faster`
    }
  };
}

/**
 * 4. ML SERVICE INTEGRATION TESTS
 */
async function testMLServiceIntegration() {
  const response = await makeRequest('/fastForecast', {
    spotId: 'jackson',
    days: 'current'
  });
  
  if (response.statusCode !== 200 || !response.data.forecast) {
    return { success: false, error: 'Failed to get forecast data' };
  }
  
  const hourlyData = Object.values(response.data.forecast[0].hourly)[0];
  const hasMLData = hourlyData &&
                    hourlyData.prediction &&
                    hourlyData.prediction.mlModelUsed === true &&
                    hourlyData.prediction.predictionSource === 'ml-model' &&
                    typeof hourlyData.prediction.rating === 'number';
  
  return {
    success: hasMLData,
    error: !hasMLData ? 'ML service integration not working' : null,
    mlData: hasMLData ? {
      rating: hourlyData.prediction.rating,
      source: hourlyData.prediction.predictionSource,
      modelUsed: hourlyData.prediction.mlModelUsed
    } : null
  };
}

/**
 * 5. PRODUCTION FORMAT VALIDATION
 */
async function testProductionFormat() {
  const response = await makeRequest('/fastForecast', {
    spotId: 'jackson',
    days: '3'
  });
  
  if (response.statusCode !== 200) {
    return { success: false, error: `Status ${response.statusCode}` };
  }
  
  const data = response.data;
  const requiredFields = {
    success: 'boolean',
    location: 'object',
    forecast: 'array',
    metadata: 'object'
  };
  
  // Check top-level structure
  for (const [field, type] of Object.entries(requiredFields)) {
    if (!(field in data)) {
      return { success: false, error: `Missing field: ${field}` };
    }
    if (typeof data[field] !== type) {
      return { success: false, error: `Invalid type for ${field}: expected ${type}` };
    }
  }
  
  // Check location structure
  const location = data.location;
  const locationFields = ['name', 'region', 'country', 'coordinates'];
  for (const field of locationFields) {
    if (!(field in location)) {
      return { success: false, error: `Missing location.${field}` };
    }
  }
  
  // Check forecast structure
  if (data.forecast.length === 0) {
    return { success: false, error: 'Empty forecast array' };
  }
  
  const firstDay = data.forecast[0];
  if (!firstDay.date || !firstDay.hourly) {
    return { success: false, error: 'Invalid forecast day structure' };
  }
  
  // Check hourly structure
  const hourKeys = Object.keys(firstDay.hourly);
  if (hourKeys.length === 0) {
    return { success: false, error: 'No hourly data' };
  }
  
  const firstHour = firstDay.hourly[hourKeys[0]];
  const hourlyFields = ['temperature', 'windSpeed', 'humidity', 'rating', 'prediction'];
  for (const field of hourlyFields) {
    if (!(field in firstHour)) {
      return { success: false, error: `Missing hourly.${field}` };
    }
  }
  
  return { success: true, error: null };
}

/**
 * 6. ERROR HANDLING TESTS
 */
async function testInvalidSpotId() {
  const response = await makeRequest('/fastForecast', {
    spotId: 'nonexistent_spot',
    days: 'current'
  });
  
  return {
    success: response.statusCode === 404 && response.data.success === false,
    error: response.statusCode !== 404 ? `Expected 404, got ${response.statusCode}` : null
  };
}

async function testMissingParameters() {
  const response = await makeRequest('/fastForecast');
  
  return {
    success: response.statusCode === 400 && response.data.success === false,
    error: response.statusCode !== 400 ? `Expected 400, got ${response.statusCode}` : null
  };
}

/**
 * 7. ALL LOCATIONS TEST
 */
async function testAllPaddlingLocations() {
  const locationResults = [];
  
  for (const spotId of config.paddlingSpots) {
    const startTime = Date.now();
    const response = await makeRequest('/fastForecast', {
      spotId,
      days: 'current'
    });
    const duration = Date.now() - startTime;
    
    locationResults.push({
      spotId,
      success: response.statusCode === 200 && response.data.success === true,
      duration,
      temperature: response.data.forecast?.[0]?.hourly ? 
        Object.values(response.data.forecast[0].hourly)[0]?.temperature : null,
      rating: response.data.forecast?.[0]?.hourly ? 
        Object.values(response.data.forecast[0].hourly)[0]?.rating : null
    });
  }
  
  const successCount = locationResults.filter(r => r.success).length;
  const successRate = (successCount / config.paddlingSpots.length * 100).toFixed(1);
  
  return {
    success: successCount === config.paddlingSpots.length,
    error: successCount !== config.paddlingSpots.length ? 
           `Only ${successCount}/${config.paddlingSpots.length} locations working (${successRate}%)` : null,
    results: locationResults
  };
}

/**
 * MAIN TEST EXECUTION
 */
async function runAllTests() {
  console.log('🚀 Starting FastForecast Comprehensive Test Suite\n');
  
  // 1. Basic endpoint tests
  await runTest('Health Endpoint', testHealthEndpoint, 'basic');
  await runTest('Spots Endpoint', testSpotsEndpoint, 'basic');
  
  // 2. Heatmap optimization tests
  await runTest('Current-Only Request', testCurrentOnlyRequest, 'optimization');
  await runTest('Heatmap Performance', testHeatmapPerformance, 'performance');
  
  // 3. Full forecast tests
  await runTest('Full Forecast Request', testFullForecastRequest, 'forecast');
  await runTest('Performance Comparison', testPerformanceComparison, 'performance');
  
  // 4. ML service integration
  await runTest('ML Service Integration', testMLServiceIntegration, 'ml');
  
  // 5. Production format validation
  await runTest('Production Format', testProductionFormat, 'format');
  
  // 6. Error handling
  await runTest('Invalid Spot ID', testInvalidSpotId, 'error');
  await runTest('Missing Parameters', testMissingParameters, 'error');
  
  // 7. All locations test
  await runTest('All Paddling Locations', testAllPaddlingLocations, 'integration');
  
  // Print final results
  console.log('\n📊 TEST RESULTS SUMMARY:');
  console.log('='.repeat(50));
  console.log(`Total Tests: ${results.total}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`🎯 Success Rate: ${(results.passed / results.total * 100).toFixed(1)}%`);
  
  if (results.errors.length > 0) {
    console.log('\n❌ FAILED TESTS:');
    results.errors.forEach(error => {
      console.log(`   • ${error.test}: ${error.error}`);
    });
  }
  
  // Performance summary
  console.log('\n⚡ PERFORMANCE SUMMARY:');
  Object.keys(results.performance).forEach(category => {
    const tests = results.performance[category];
    const avgDuration = tests.reduce((sum, t) => sum + t.duration, 0) / tests.length;
    console.log(`   ${category}: ${avgDuration.toFixed(0)}ms average`);
  });
  
  return results;
}

// Export for use in other test suites
module.exports = {
  runAllTests,
  makeRequest,
  config
};

// Run tests if called directly
if (require.main === module) {
  runAllTests().catch(console.error);
}
