#!/usr/bin/env node

/**
 * COMPREHENSIVE DALLAS LAKES API SYNC TEST
 * 
 * Tests the 3 ACTIVE APIs for Dallas-area lakes t    if (data.forecast && data.forecast.length > 0) {
      const today = data.forecast[0];
      const currentHour = today.hourly ? to    console.log(`   ${colors.green}✅ SUCCESS${colors.reset}`);
    console.log(`   📍 Location: ${data.location?.name || 'N/A'}`);
    console.log(`   📅 Forecast Days: ${data.forecast?.length || 0}`);
    
    // Get today's data (first day)
    const today = data.forecast?.[0];
    if (today?.hourly) {
      const currentHour = new Date().getHours().toString();
      const nearestHour = Object.keys(today.hourly).find(h => parseInt(h) >= parseInt(currentHour)) || 
                         Object.keys(today.hourly)[0];
      const hourData = today.hourly[nearestHour];
      
      console.log(`   🌡️  Current Temp: ${hourData?.temperature || 'N/A'}°F`);
      console.log(`   💨 Current Wind: ${hourData?.windSpeed || 'N/A'} mph`);
      console.log(`   🏄 Current Rating: ${hourData?.rating || hourData?.prediction?.rating || 'N/A'}/5`);
    }: today;
      console.log(`   🌡️  Today's Temp: ${currentHour?.temperature || 'N/A'}°F`);
      console.log(`   💨 Today's Wind: ${currentHour?.windSpeed || 'N/A'} mph`);
      console.log(`   🏄 Today's Rating: ${currentHour?.rating || 'N/A'}/5`);
    }fy they're in sync:
 * 1. paddleScore API (unified ML scoring) 
 * 2. fastforecast API (3-day forecast)
 * 3. forecast API (detailed forecast)
 * 
 * Dallas Lakes:
 * - Lewisville Lake 
 * - Trinity River
 * - White Rock Lake
 */

const https = require('https');
const http = require('http');

// Configuration
const CONFIG = {
  BASE_URL: 'https://us-central1-kaaykostore.cloudfunctions.net/api',
  LOCAL_URL: 'http://localhost:5001/kaaykostore/us-central1/api',
  USE_LOCAL: false, // Set to true for local testing
  DALLAS_LAKES: [
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
  ]
};

const BASE_URL = CONFIG.USE_LOCAL ? CONFIG.LOCAL_URL : CONFIG.BASE_URL;

// Colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

/**
 * Make HTTP/HTTPS request
 */
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;
    
    const req = client.get(url, { 
      timeout: 15000,
      headers: { 'User-Agent': 'Kaayko-DallasTest/1.0' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve({
            statusCode: res.statusCode,
            data: result,
            responseTime: Date.now() - startTime
          });
        } catch (e) {
          reject(new Error(`Invalid JSON: ${e.message}`));
        }
      });
    });
    
    const startTime = Date.now();
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Request timeout')));
    req.setTimeout(15000);
  });
}

/**
 * Test fastforecast API
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
    console.log(`   📍 Location: ${data.location?.name || data.spotId}`);
    console.log(`   � Days: ${data.forecast?.length || 0}`);
    
    if (data.forecast && data.forecast.length > 0) {
      const today = data.forecast[0];
      console.log(`   �️  Today's Temp: ${today.temperature}°F`);
      console.log(`   � Today's Wind: ${today.windSpeed} mph`);
      console.log(`   🏄 Today's Rating: ${today.rating}/5`);
    }
    
    console.log(`   ⚡ Response: ${response.responseTime}ms`);
    
    return {
      api: 'fastforecast',
      success: true,
      location: data.location?.name || data.spotId,
      forecastDays: data.forecast?.length || 0,
      todayRating: data.forecast?.[0]?.hourly?.["0"]?.rating || data.forecast?.[0]?.rating || 0,
      todayTemp: data.forecast?.[0]?.hourly?.["0"]?.temperature || data.forecast?.[0]?.temperature || 0,
      todayWind: data.forecast?.[0]?.hourly?.["0"]?.windSpeed || data.forecast?.[0]?.windSpeed || 0,
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
    // Test both by spotId and by coordinates
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
      
      try {
        const response = await makeRequest(test.url);
        
        if (response.statusCode !== 200) {
          console.log(`   ${colors.red}❌ FAIL: HTTP ${response.statusCode}${colors.reset}`);
          continue;
        }
        
        const data = response.data;
        
        if (!data.success) {
          console.log(`   ${colors.red}❌ FAIL: ${data.error}${colors.reset}`);
          continue;
        }
        
        console.log(`   ${colors.green}✅ SUCCESS${colors.reset}`);
        console.log(`   📍 Location: ${data.location?.name}`);
        console.log(`   🌡️  Temperature: ${data.conditions?.temperature}°F`);
        console.log(`   💨 Wind: ${data.conditions?.windSpeed} mph`);
        console.log(`   🏄 Paddle Score: ${data.paddleScore?.rating}/5`);
        console.log(`   📊 Interpretation: ${data.paddleScore?.interpretation}`);
        console.log(`   🤖 Model: ${data.paddleScore?.modelUsed}`);
        console.log(`   ⚡ Response: ${response.responseTime}ms`);
        
        results.push({
          testType: test.name,
          success: true,
          rating: data.paddleScore?.rating || 0,
          temperature: data.conditions?.temperature || 0,
          windSpeed: data.conditions?.windSpeed || 0,
          interpretation: data.paddleScore?.interpretation || 'Unknown',
          modelUsed: data.paddleScore?.modelUsed || 'Unknown',
          responseTime: response.responseTime,
          rawData: data
        });
        
      } catch (error) {
        console.log(`   ${colors.red}❌ FAIL: ${error.message}${colors.reset}`);
      }
    }
    
    return {
      api: 'paddleScore',
      results: results
    };
    
  } catch (error) {
    console.log(`   ${colors.red}❌ FAIL: ${error.message}${colors.reset}`);
    return null;
  }
}

/**
 * Test forecast API
 */
async function testForecast(lake) {
  console.log(`\n${colors.cyan}�️  Testing forecast API for ${lake.name}${colors.reset}`);
  
  try {
    const url = `${BASE_URL}/forecast?location=${lake.lat},${lake.lng}`;
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
    console.log(`   📍 Location: ${data.location?.name || data.spotId}`);
    console.log(`   📅 Forecast Days: ${Object.keys(data.forecast || {}).length}`);
    
    // Get today's data (day 0)
    const today = data.forecast?.['0'];
    if (today?.hourly) {
      const currentHour = new Date().getHours();
      const nearestHour = Object.keys(today.hourly).find(h => parseInt(h) >= currentHour) || 
                         Object.keys(today.hourly)[0];
      const hourData = today.hourly[nearestHour];
      
      console.log(`   �️  Current Temp: ${hourData?.temperature || 'N/A'}°F`);
      console.log(`   � Current Wind: ${hourData?.windSpeed || 'N/A'} mph`);
      console.log(`   🏄 Current Rating: ${hourData?.rating || hourData?.mlPrediction?.rating || 'N/A'}/5`);
    }
    
    console.log(`   ⚡ Response: ${response.responseTime}ms`);
    
    return {
      api: 'forecast',
      success: true,
      location: data.location?.name || 'N/A',
      forecastDays: data.forecast?.length || 0,
      currentRating: data.forecast?.[0]?.hourly?.[Object.keys(data.forecast?.[0]?.hourly || {})[0]]?.rating || 
                    data.forecast?.[0]?.hourly?.[Object.keys(data.forecast?.[0]?.hourly || {})[0]]?.prediction?.rating || 0,
      currentTemp: data.forecast?.[0]?.hourly?.[Object.keys(data.forecast?.[0]?.hourly || {})[0]]?.temperature || 0,
      currentWind: data.forecast?.[0]?.hourly?.[Object.keys(data.forecast?.[0]?.hourly || {})[0]]?.windSpeed || 0,
      responseTime: response.responseTime,
      rawData: data
    };
    
  } catch (error) {
    console.log(`   ${colors.red}❌ FAIL: ${error.message}${colors.reset}`);
    return null;
  }
}

/**
 * Compare API results for sync analysis
 */
function analyzeSync(lake, results) {
  console.log(`\n${colors.yellow}🔍 SYNC ANALYSIS for ${lake.name}${colors.reset}`);
  
  const fastforecast = results.fastforecast;
  const forecast = results.forecast;
  const paddleScore = results.paddleScore?.results || [];
  
  // Rating comparison - collect all ratings
  const ratings = [];
  
  if (fastforecast?.success) {
    ratings.push({ source: 'fastforecast', rating: fastforecast.todayRating });
  }
  
  if (forecast?.success) {
    ratings.push({ source: 'forecast', rating: forecast.currentRating });
  }
  
  paddleScore.forEach(result => {
    if (result.success) {
      ratings.push({ source: `paddleScore-${result.testType}`, rating: result.rating });
    }
  });
  
  if (ratings.length > 1) {
    const uniqueRatings = [...new Set(ratings.map(r => r.rating))];
    if (uniqueRatings.length === 1) {
      console.log(`   ${colors.green}✅ All ratings match: ${uniqueRatings[0]}/5${colors.reset}`);
    } else {
      console.log(`   ${colors.yellow}⚠️  Ratings differ:${colors.reset}`);
      ratings.forEach(r => {
        console.log(`      ${r.source}: ${r.rating}/5`);
      });
    }
  }
  
  // Temperature comparison (all should be in Fahrenheit)
  const temps = [];
  if (fastforecast?.todayTemp) {
    temps.push({ source: 'fastforecast', temp: fastforecast.todayTemp });
  }
  
  if (forecast?.currentTemp) {
    temps.push({ source: 'forecast', temp: forecast.currentTemp });
  }
  
  paddleScore.forEach(result => {
    if (result.success && result.temperature) {
      temps.push({ source: `paddleScore-${result.testType}`, temp: result.temperature });
    }
  });
  
  if (temps.length > 1) {
    const tempDiffs = temps.map(t => t.temp);
    const maxDiff = Math.max(...tempDiffs) - Math.min(...tempDiffs);
    
    if (maxDiff < 3) { // Allow 3°F difference
      console.log(`   ${colors.green}✅ Temperatures roughly match${colors.reset}`);
    } else {
      console.log(`   ${colors.yellow}⚠️  Temperatures differ significantly:${colors.reset}`);
      temps.forEach(t => {
        console.log(`      ${t.source}: ${t.temp}°F`);
      });
    }
  }
  
  // Wind speed comparison
  const winds = [];
  if (fastforecast?.todayWind) {
    winds.push({ source: 'fastforecast', wind: fastforecast.todayWind });
  }
  
  if (forecast?.currentWind) {
    winds.push({ source: 'forecast', wind: forecast.currentWind });
  }
  
  paddleScore.forEach(result => {
    if (result.success && result.windSpeed) {
      winds.push({ source: `paddleScore-${result.testType}`, wind: result.windSpeed });
    }
  });
  
  if (winds.length > 1) {
    const windDiffs = winds.map(w => w.wind);
    const maxDiff = Math.max(...windDiffs) - Math.min(...windDiffs);
    
    if (maxDiff < 2) { // Allow 2 mph difference
      console.log(`   ${colors.green}✅ Wind speeds roughly match${colors.reset}`);
    } else {
      console.log(`   ${colors.yellow}⚠️  Wind speeds differ:${colors.reset}`);
      winds.forEach(w => {
        console.log(`      ${w.source}: ${w.wind} mph`);
      });
    }
  }
  
  // Data structure validation
  if (fastforecast?.success && forecast?.success) {
    if (fastforecast.forecastDays >= 3 && forecast.forecastDays >= 3) {
      console.log(`   ${colors.green}✅ Both forecasts have 3+ days of data${colors.reset}`);
    } else {
      console.log(`   ${colors.yellow}⚠️  Forecast data incomplete:${colors.reset}`);
      console.log(`      fastforecast: ${fastforecast.forecastDays} days`);
      console.log(`      forecast: ${forecast.forecastDays} days`);
    }
  }
  
  // Response time analysis
  const responseTimes = [];
  if (fastforecast?.responseTime) responseTimes.push(fastforecast.responseTime);
  if (forecast?.responseTime) responseTimes.push(forecast.responseTime);
  paddleScore.forEach(result => {
    if (result.responseTime) responseTimes.push(result.responseTime);
  });
  
  if (responseTimes.length > 0) {
    const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const maxTime = Math.max(...responseTimes);
    const minTime = Math.min(...responseTimes);
    
    console.log(`   ⚡ Response Times: avg=${avgTime.toFixed(0)}ms, min=${minTime}ms, max=${maxTime}ms`);
    
    if (maxTime > 5000) {
      console.log(`   ${colors.yellow}⚠️  Slow response detected (>${maxTime}ms)${colors.reset}`);
    }
  }
}

/**
 * Main test execution
 */
async function main() {
  console.log(`${colors.bold}${colors.blue}🏄 KAAYKO DALLAS LAKES API SYNC TEST${colors.reset}`);
  console.log(`${colors.blue}Testing ${CONFIG.USE_LOCAL ? 'LOCAL' : 'PRODUCTION'} APIs${colors.reset}`);
  console.log(`${colors.blue}Base URL: ${BASE_URL}${colors.reset}`);
  console.log('='.repeat(80));
  
  const overallResults = {};
  
  for (const lake of CONFIG.DALLAS_LAKES) {
    console.log(`\n${colors.bold}${colors.magenta}🏊 TESTING ${lake.name.toUpperCase()} (${lake.id})${colors.reset}`);
    console.log(`📍 Coordinates: ${lake.lat}, ${lake.lng}`);
    console.log('-'.repeat(60));
    
    const results = {};
    
    // Test all 3 APIs
    results.fastforecast = await testFastForecast(lake);
    results.forecast = await testForecast(lake);
    results.paddleScore = await testPaddleScore(lake);
    
    // Analyze sync
    analyzeSync(lake, results);
    
    overallResults[lake.id] = results;
  }
  
  // Overall summary
  console.log(`\n${colors.bold}${colors.green}📊 OVERALL SUMMARY${colors.reset}`);
  console.log('='.repeat(80));
  
  const summary = {
    totalLakes: CONFIG.DALLAS_LAKES.length,
    fastforecastSuccess: 0,
    forecastSuccess: 0,
    paddleScoreSuccess: 0,
    allApisWorking: 0
  };
  
  Object.entries(overallResults).forEach(([lakeId, results]) => {
    const lake = CONFIG.DALLAS_LAKES.find(l => l.id === lakeId);
    
    if (results.fastforecast?.success) summary.fastforecastSuccess++;
    if (results.forecast?.success) summary.forecastSuccess++;
    if (results.paddleScore?.results?.some(r => r.success)) summary.paddleScoreSuccess++;
    
    const allWorking = results.fastforecast?.success && 
                      results.forecast?.success &&
                      results.paddleScore?.results?.some(r => r.success);
    
    if (allWorking) summary.allApisWorking++;
    
    console.log(`${lake.name}:`);
    console.log(`  fastforecast: ${results.fastforecast?.success ? '✅' : '❌'}`);
    console.log(`  forecast: ${results.forecast?.success ? '✅' : '❌'}`);
    console.log(`  paddleScore: ${results.paddleScore?.results?.some(r => r.success) ? '✅' : '❌'}`);
    console.log(`  All APIs: ${allWorking ? '✅ SYNCED' : '❌ ISSUES'}`);
  });
  
  console.log(`\n${colors.bold}API Success Rates:${colors.reset}`);
  console.log(`fastforecast: ${summary.fastforecastSuccess}/${summary.totalLakes} (${(summary.fastforecastSuccess/summary.totalLakes*100).toFixed(1)}%)`);
  console.log(`forecast: ${summary.forecastSuccess}/${summary.totalLakes} (${(summary.forecastSuccess/summary.totalLakes*100).toFixed(1)}%)`);
  console.log(`paddleScore: ${summary.paddleScoreSuccess}/${summary.totalLakes} (${(summary.paddleScoreSuccess/summary.totalLakes*100).toFixed(1)}%)`);
  console.log(`\n${colors.bold}Full Sync Rate: ${summary.allApisWorking}/${summary.totalLakes} (${(summary.allApisWorking/summary.totalLakes*100).toFixed(1)}%)${colors.reset}`);
  
  if (summary.allApisWorking === summary.totalLakes) {
    console.log(`\n${colors.green}${colors.bold}🎉 ALL DALLAS LAKES ARE FULLY SYNCED!${colors.reset}`);
  } else {
    console.log(`\n${colors.yellow}${colors.bold}⚠️  SOME SYNC ISSUES DETECTED - Review individual results above${colors.reset}`);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log(`${colors.blue}Dallas Lakes API Sync Test Complete!${colors.reset}`);
}

// Run the test
if (require.main === module) {
  main().catch(error => {
    console.error(`${colors.red}Test failed:${colors.reset}`, error);
    process.exit(1);
  });
}

module.exports = { main, testFastForecast, testForecast, testPaddleScore };
