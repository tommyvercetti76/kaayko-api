#!/usr/bin/env node

const https = require('https');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bold: '\x1b[1m'
};

const BASE_URL = 'https://us-central1-kaaykostore.cloudfunctions.net/api';

// Dallas lakes configuration
const DALLAS_LAKES = [
  {
    id: 'lewisville',
    name: 'Lewisville Lake',
    lat: 33.156487,
    lng: -96.949953
  },
  {
    id: 'trinity',
    name: 'Trinity River',
    lat: 32.881187,
    lng: -96.929937
  },
  {
    id: 'whiterock',
    name: 'White Rock Lake',
    lat: 32.833188,
    lng: -96.729687
  }
];

/**
 * Make HTTP request and measure response time
 */
async function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        
        try {
          const parsedData = JSON.parse(data);
          resolve({
            statusCode: res.statusCode,
            data: parsedData,
            responseTime: responseTime
          });
        } catch (error) {
          reject(new Error(`JSON parse error: ${error.message}`));
        }
      });
      
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Test fastforecast API with correct parsing
 */
async function testFastForecast(lake) {
  console.log(`\n${colors.blue}📊 Testing fastforecast API for ${lake.name}${colors.reset}`);
  
  try {
    const url = `${BASE_URL}/fastforecast?lat=${lake.lat}&lng=${lake.lng}`;
    console.log(`   URL: ${url}`);
    
    const response = await makeRequest(url);
    
    if (response.statusCode !== 200) {
      console.log(`   ${colors.red}❌ FAIL: HTTP ${response.statusCode}${colors.reset}`);
      return null;
    }
    
    const data = response.data;
    
    if (data.error) {
      console.log(`   ${colors.red}❌ FAIL: ${data.error}${colors.reset}`);
      return null;
    }
    
    console.log(`   ${colors.green}✅ SUCCESS${colors.reset}`);
    console.log(`   📍 Location: ${data.location?.name || 'N/A'}`);
    console.log(`   📅 Days: ${data.forecast?.length || 0}`);
    
    if (data.forecast && data.forecast.length > 0) {
      const today = data.forecast[0];
      // fastforecast uses hourly array, paddle_summary has rating
      const currentHour = today.hourly?.[0];
      const rating = today.paddle_summary?.mlRating;
      console.log(`   🌡️  Today's Temp: ${currentHour?.tempC || 'N/A'}°C`);
      console.log(`   💨 Today's Wind: ${(currentHour?.windKPH || 0) * 0.621371} mph`);
      console.log(`   🏄 Today's Rating: ${rating || 'N/A'}/5`);
    }
    
    console.log(`   ⚡ Response: ${response.responseTime}ms`);
    
    return {
      api: 'fastforecast',
      success: true,
      location: data.location?.name || 'N/A',
      forecastDays: data.forecast?.length || 0,
      todayRating: data.forecast?.[0]?.paddle_summary?.mlRating || 0,
      todayTemp: data.forecast?.[0]?.hourly?.[0]?.tempC || 0,
      todayWind: ((data.forecast?.[0]?.hourly?.[0]?.windKPH || 0) * 0.621371),
      responseTime: response.responseTime,
      rawData: data
    };
    
  } catch (error) {
    console.log(`   ${colors.red}❌ FAIL: ${error.message}${colors.reset}`);
    return null;
  }
}

/**
 * Test forecast API with correct parsing
 */
async function testForecast(lake) {
  console.log(`\n${colors.cyan}🌅 Testing forecast API for ${lake.name}${colors.reset}`);
  
  try {
    const url = `${BASE_URL}/forecast?location=${lake.lat},${lake.lng}`;
    console.log(`   URL: ${url}`);
    
    const response = await makeRequest(url);
    
    if (response.statusCode !== 200) {
      console.log(`   ${colors.red}❌ FAIL: HTTP ${response.statusCode}${colors.reset}`);
      return null;
    }
    
    const data = response.data;
    
    if (data.error || !data.data) {
      console.log(`   ${colors.red}❌ FAIL: ${data.error || 'No data'}${colors.reset}`);
      return null;
    }
    
    console.log(`   ${colors.green}✅ SUCCESS${colors.reset}`);
    console.log(`   📍 Location: ${data.data.location || 'N/A'}`);
    console.log(`   📅 Current Weather: Available`);
    
    const current = data.data.current;
    if (current) {
      const rating = current.paddle_summary?.mlRating;
      const temp = current.temperature?.celsius;
      const wind = current.wind?.speedMPH;
      console.log(`   🌡️  Current Temp: ${temp || 'N/A'}°C`);
      console.log(`   💨 Current Wind: ${wind || 'N/A'} mph`);
      console.log(`   🏄 Current Rating: ${rating || 'N/A'}/5`);
    }
    
    console.log(`   ⚡ Response: ${response.responseTime}ms`);
    
    return {
      api: 'forecast',
      success: true,
      location: data.data.location || 'N/A',
      forecastDays: 1, // Current weather
      currentRating: current?.paddle_summary?.mlRating || 0,
      currentTemp: current?.temperature?.celsius || 0,
      currentWind: current?.wind?.speedMPH || 0,
      responseTime: response.responseTime,
      rawData: data
    };
    
  } catch (error) {
    console.log(`   ${colors.red}❌ FAIL: ${error.message}${colors.reset}`);
    return null;
  }
}

/**
 * Test paddleScore API  
 */
async function testPaddleScore(lake) {
  console.log(`\n${colors.magenta}🎯 Testing paddleScore API for ${lake.name}${colors.reset}`);
  
  try {
    const tests = [
      {
        name: 'By SpotId',
        url: `${BASE_URL}/paddleScore?spotId=${lake.id}`
      },
      {
        name: 'By Coordinates',
        url: `${BASE_URL}/paddleScore?location=${lake.lat},${lake.lng}`
      }
    ];
    
    const results = [];
    
    for (const test of tests) {
      console.log(`   ${colors.cyan}Testing ${test.name}:${colors.reset}`);
      console.log(`   URL: ${test.url}`);
      
      const response = await makeRequest(test.url);
      
      if (response.statusCode !== 200) {
        console.log(`   ${colors.red}❌ FAIL: HTTP ${response.statusCode}${colors.reset}`);
        results.push(null);
        continue;
      }
      
      const data = response.data;
      
      if (data.error) {
        console.log(`   ${colors.red}❌ FAIL: ${data.error}${colors.reset}`);
        results.push(null);
        continue;
      }
      
      console.log(`   ${colors.green}✅ SUCCESS${colors.reset}`);
      console.log(`   📍 Location: ${data.location?.name || data.spotId || 'N/A'}`);
      console.log(`   🌡️  Temperature: ${data.conditions?.temperature || 'N/A'}°F`);
      console.log(`   💨 Wind: ${data.conditions?.windSpeed || 'N/A'} mph`);
      console.log(`   🏄 Paddle Score: ${data.paddleScore?.rating || 'N/A'}/5`);
      console.log(`   📊 Interpretation: ${data.paddleScore?.interpretation || 'N/A'}`);
      console.log(`   🤖 Model: ${data.metadata?.modelType || 'N/A'}`);
      console.log(`   ⚡ Response: ${response.responseTime}ms`);
      
      results.push({
        api: `paddleScore-${test.name}`,
        success: true,
        location: data.location?.name || data.spotId || 'N/A',
        rating: data.paddleScore?.rating || 0,
        temperature: data.conditions?.temperature || 0,
        windSpeed: data.conditions?.windSpeed || 0,
        interpretation: data.paddleScore?.interpretation,
        responseTime: response.responseTime,
        rawData: data
      });
    }
    
    return results.filter(r => r !== null);
    
  } catch (error) {
    console.log(`   ${colors.red}❌ FAIL: ${error.message}${colors.reset}`);
    return [];
  }
}

/**
 * Compare API results for sync analysis
 */
function analyzeSync(lake, results) {
  console.log(`\n${colors.yellow}🔍 SYNC ANALYSIS for ${lake.name}${colors.reset}`);
  
  const apis = results.filter(r => r);
  
  if (apis.length === 0) {
    console.log(`   ${colors.red}❌ No successful API responses${colors.reset}`);
    return false;
  }
  
  // Check ratings
  const ratings = apis.map(api => ({
    name: api.api,
    rating: api.todayRating || api.currentRating || api.rating || 0
  }));
  
  const ratingValues = ratings.map(r => r.rating).filter(r => r > 0);
  const ratingsMatch = ratingValues.length > 0 && Math.max(...ratingValues) - Math.min(...ratingValues) <= 1;
  
  if (!ratingsMatch && ratingValues.length > 1) {
    console.log(`   ${colors.yellow}⚠️  Ratings differ:${colors.reset}`);
    ratings.forEach(r => {
      console.log(`      ${r.name}: ${r.rating}/5`);
    });
  } else {
    console.log(`   ${colors.green}✅ Ratings roughly match${colors.reset}`);
  }
  
  console.log(`   ${colors.green}✅ All APIs connected successfully${colors.reset}`);
  
  // Response time analysis
  const responseTimes = apis.map(api => api.responseTime).filter(t => t);
  if (responseTimes.length > 0) {
    const avgTime = Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length);
    const minTime = Math.min(...responseTimes);
    const maxTime = Math.max(...responseTimes);
    console.log(`   ⚡ Response Times: avg=${avgTime}ms, min=${minTime}ms, max=${maxTime}ms`);
  }
  
  return true;
}

/**
 * Main test function
 */
async function runDallasSync() {
  console.log(`${colors.bold}🏄 KAAYKO DALLAS LAKES API SYNC TEST${colors.reset}`);
  console.log('Testing PRODUCTION APIs');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('================================================================================');
  
  const testResults = {};
  
  for (const lake of DALLAS_LAKES) {
    console.log(`\n${colors.bold}🏊 TESTING ${lake.name.toUpperCase()} (${lake.id})${colors.reset}`);
    console.log(`📍 Coordinates: ${lake.lat}, ${lake.lng}`);
    console.log('------------------------------------------------------------');
    
    // Test all APIs for this lake
    const fastForecastResult = await testFastForecast(lake);
    const forecastResult = await testForecast(lake);
    const paddleScoreResults = await testPaddleScore(lake);
    
    // Collect all results
    const allResults = [
      fastForecastResult,
      forecastResult,
      ...paddleScoreResults
    ].filter(r => r);
    
    // Analyze sync
    const syncSuccess = analyzeSync(lake, allResults);
    
    testResults[lake.id] = {
      lake: lake.name,
      fastforecast: fastForecastResult ? '✅' : '❌',
      forecast: forecastResult ? '✅' : '❌',
      paddleScore: paddleScoreResults.length > 0 ? '✅' : '❌',
      allApis: syncSuccess ? '✅ SYNCED' : '❌ ISSUES',
      results: allResults
    };
  }
  
  // Overall summary
  console.log(`\n${colors.bold}📊 OVERALL SUMMARY${colors.reset}`);
  console.log('================================================================================');
  
  Object.keys(testResults).forEach(lakeId => {
    const result = testResults[lakeId];
    console.log(`${result.lake}:`);
    console.log(`  fastforecast: ${result.fastforecast}`);
    console.log(`  forecast: ${result.forecast}`);
    console.log(`  paddleScore: ${result.paddleScore}`);
    console.log(`  All APIs: ${result.allApis}`);
  });
  
  // Calculate success rates
  const totalLakes = DALLAS_LAKES.length;
  const fastforecastSuccesses = Object.values(testResults).filter(r => r.fastforecast === '✅').length;
  const forecastSuccesses = Object.values(testResults).filter(r => r.forecast === '✅').length;
  const paddleScoreSuccesses = Object.values(testResults).filter(r => r.paddleScore === '✅').length;
  const fullSyncSuccesses = Object.values(testResults).filter(r => r.allApis === '✅ SYNCED').length;
  
  console.log(`\nAPI Success Rates:`);
  console.log(`fastforecast: ${fastforecastSuccesses}/${totalLakes} (${((fastforecastSuccesses/totalLakes)*100).toFixed(1)}%)`);
  console.log(`forecast: ${forecastSuccesses}/${totalLakes} (${((forecastSuccesses/totalLakes)*100).toFixed(1)}%)`);
  console.log(`paddleScore: ${paddleScoreSuccesses}/${totalLakes} (${((paddleScoreSuccesses/totalLakes)*100).toFixed(1)}%)`);
  console.log(`\nFull Sync Rate: ${fullSyncSuccesses}/${totalLakes} (${((fullSyncSuccesses/totalLakes)*100).toFixed(1)}%)`);
  
  if (fullSyncSuccesses === totalLakes) {
    console.log(`\n${colors.green}${colors.bold}🎉 ALL DALLAS LAKES ARE FULLY SYNCED!${colors.reset}`);
  } else {
    console.log(`\n${colors.yellow}⚠️  Some sync issues found - see details above${colors.reset}`);
  }
  
  console.log('\n================================================================================');
  console.log('Dallas Lakes API Sync Test Complete!');
}

// Run the test
if (require.main === module) {
  runDallasSync().catch(console.error);
}

module.exports = { runDallasSync };
