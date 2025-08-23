#!/usr/bin/env node

/**
 * 🔍 COMPREHENSIVE FRONTEND API TEST
 * 
 * Tests ALL endpoints that your frontend uses:
 * 1. paddlingOut - List all locations (used in paddlingout.js)
 * 2. paddleScore - Current scores for each location (called for all spots)
 * 3. fastForecast - Full forecast when circle is clicked (modal)
 * 
 * This simulates exactly what happens in your frontend.
 */

const https = require('https');
const { performance } = require('perf_hooks');

// Configuration - matches your frontend API endpoints
const LOCAL_API_BASE = 'http://127.0.0.1:5001/kaaykostore/us-central1/api';
const PROD_PADDLINGOUT = 'https://us-central1-kaaykostore.cloudfunctions.net/api/paddlingOut';

/**
 * Make HTTP request (handles both http and https)
 */
function makeRequest(url, timeout = 10000) {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const isHttps = url.startsWith('https://');
    const requestLib = isHttps ? https : require('http');
    
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
 * Step 1: Get all paddling locations (like frontend does on page load)
 */
async function testStep1_GetAllLocations() {
  console.log('🏞️ STEP 1: Get All Paddling Locations');
  console.log('━'.repeat(60));
  console.log('📍 This simulates: paddlingout.js -> fetchAll() function');
  console.log('🌐 URL: Production paddlingOut (as configured in frontend)');
  
  const result = await makeRequest(PROD_PADDLINGOUT);
  
  if (result.success) {
    const locations = result.data.locations || result.data;
    console.log(`✅ Success: ${result.status} | Time: ${result.responseTime}ms`);
    console.log(`📊 Found ${Array.isArray(locations) ? locations.length : 0} locations`);
    
    if (Array.isArray(locations) && locations.length > 0) {
      console.log('📋 Sample locations:');
      locations.slice(0, 3).forEach(loc => {
        console.log(`   • ${loc.title} (${loc.location?.latitude}, ${loc.location?.longitude})`);
      });
      
      return { success: true, locations: locations };
    } else {
      console.log('⚠️ No locations found in response');
      return { success: false, error: 'No locations data' };
    }
  } else {
    console.log(`❌ Failed: ${result.error} | Time: ${result.responseTime}ms`);
    return { success: false, error: result.error };
  }
}

/**
 * Step 2: Get paddle scores for all locations (like frontend does for icons)
 */
async function testStep2_GetPaddleScores(locations) {
  console.log('\\n🎯 STEP 2: Get Paddle Scores for All Locations');
  console.log('━'.repeat(60));
  console.log('📍 This simulates: paddlingout.js -> createPaddleScoreIcon() function');
  console.log('🌐 URL: Local paddleScore API');
  console.log(`📊 Testing with first ${Math.min(locations.length, 5)} locations (to avoid overwhelming)\\n`);
  
  const testLocations = locations.slice(0, 5); // Test first 5 to avoid spam
  const results = [];
  
  for (const location of testLocations) {
    if (!location.location?.latitude || !location.location?.longitude) {
      console.log(`⚠️ Skipping ${location.title} - missing coordinates`);
      continue;
    }
    
    const lat = location.location.latitude;
    const lng = location.location.longitude;
    const url = `${LOCAL_API_BASE}/paddleScore?location=${lat},${lng}`;
    
    console.log(`🏄 Testing: ${location.title}`);
    
    const result = await makeRequest(url);
    
    if (result.success) {
      const data = result.data;
      console.log(`   ✅ ${result.responseTime}ms | Score: ${data.paddleScore?.rating}/5.0 | ${data.paddleScore?.interpretation}`);
      
      results.push({
        location: location.title,
        success: true,
        responseTime: result.responseTime,
        score: data.paddleScore?.rating,
        interpretation: data.paddleScore?.interpretation
      });
    } else {
      console.log(`   ❌ ${result.responseTime}ms | Error: ${result.error}`);
      results.push({
        location: location.title,
        success: false,
        responseTime: result.responseTime,
        error: result.error
      });
    }
    
    // Small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return results;
}

/**
 * Step 3: Get detailed forecast when user clicks (like modal does)
 */
async function testStep3_GetDetailedForecast(locations) {
  console.log('\\n⚡ STEP 3: Get Detailed Forecast (Modal Data)');
  console.log('━'.repeat(60));
  console.log('📍 This simulates: advancedModal.js -> loadSpotData() function');
  console.log('🌐 URL: Local fastForecast API');
  console.log('📊 Testing with first location only (full 3-day forecast)\\n');
  
  const testLocation = locations[0];
  if (!testLocation?.location?.latitude || !testLocation?.location?.longitude) {
    console.log('❌ No valid location to test detailed forecast');
    return { success: false };
  }
  
  const lat = testLocation.location.latitude;
  const lng = testLocation.location.longitude;
  const url = `${LOCAL_API_BASE}/fastForecast?lat=${lat}&lng=${lng}`;
  
  console.log(`🔮 Testing detailed forecast for: ${testLocation.title}`);
  console.log(`📡 URL: ${url}`);
  
  const result = await makeRequest(url, 15000); // Longer timeout for forecast
  
  if (result.success) {
    const data = result.data;
    console.log(`✅ Success: ${result.status} | Time: ${result.responseTime}ms`);
    console.log(`📅 Forecast days: ${data.forecast?.length || 0}`);
    console.log(`💾 Cached: ${data.metadata?.cached ? '✅ Yes' : '❌ No'}`);
    console.log(`🔄 Source: ${data.metadata?.source || 'Unknown'}`);
    
    if (data.forecast && data.forecast.length > 0) {
      const firstDay = data.forecast[0];
      if (firstDay.hourly) {
        const hours = Object.keys(firstDay.hourly);
        console.log(`⏰ Hours available: ${hours.length}`);
        
        // Show sample hour data
        const sampleHour = firstDay.hourly[hours[0]];
        if (sampleHour) {
          console.log(`🌡️ Sample conditions (hour ${hours[0]}):`);
          console.log(`   Temperature: ${sampleHour.temperature}°C`);
          console.log(`   Wind: ${sampleHour.windSpeed} km/h`);
          console.log(`   Rating: ${sampleHour.prediction?.rating || 'N/A'}/5.0`);
          console.log(`   ML Model: ${sampleHour.prediction?.mlModelUsed ? '✅' : '❌'}`);
        }
      }
    }
    
    return { success: true, responseTime: result.responseTime, data: data };
  } else {
    console.log(`❌ Failed: ${result.error} | Time: ${result.responseTime}ms`);
    if (result.rawData) {
      console.log(`📄 Raw response: ${result.rawData}`);
    }
    return { success: false, error: result.error };
  }
}

/**
 * Run complete frontend simulation test
 */
async function runFrontendSimulationTest() {
  console.log('🏄‍♂️ KAAYKO FRONTEND API SIMULATION TEST');
  console.log('═'.repeat(80));
  console.log('🎯 Simulating EXACT API calls your frontend makes:');
  console.log('   1. Load all paddling locations');
  console.log('   2. Get paddle scores for location icons');  
  console.log('   3. Get detailed forecast when user clicks circle');
  console.log(`🕐 Started: ${new Date().toISOString()}\\n`);
  
  const testResults = {
    step1: null,
    step2: [],
    step3: null,
    summary: {}
  };
  
  // Step 1: Get locations
  const step1Result = await testStep1_GetAllLocations();
  testResults.step1 = step1Result;
  
  if (!step1Result.success) {
    console.log('\\n🚨 CRITICAL: Cannot proceed without location data');
    console.log('❌ This means your frontend will not work - no paddling spots will load');
    return testResults;
  }
  
  // Step 2: Get paddle scores for all locations
  const step2Results = await testStep2_GetPaddleScores(step1Result.locations);
  testResults.step2 = step2Results;
  
  // Step 3: Get detailed forecast
  const step3Result = await testStep3_GetDetailedForecast(step1Result.locations);
  testResults.step3 = step3Result;
  
  // Summary
  console.log('\\n📋 FRONTEND SIMULATION TEST SUMMARY');
  console.log('═'.repeat(80));
  
  const step1Success = step1Result.success;
  const step2Success = step2Results.filter(r => r.success).length;
  const step2Total = step2Results.length;
  const step3Success = step3Result?.success;
  
  console.log(`1️⃣ Load Locations: ${step1Success ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`2️⃣ Paddle Scores: ${step2Success}/${step2Total} successful (${Math.round((step2Success/step2Total)*100)}%)`);
  console.log(`3️⃣ Detailed Forecast: ${step3Success ? '✅ SUCCESS' : '❌ FAILED'}`);
  
  // Performance summary
  if (step2Success > 0) {
    const avgScoreTime = step2Results
      .filter(r => r.success)
      .reduce((sum, r) => sum + r.responseTime, 0) / step2Success;
    console.log(`⚡ Avg paddle score time: ${Math.round(avgScoreTime)}ms`);
  }
  
  if (step3Success) {
    console.log(`⚡ Detailed forecast time: ${step3Result.responseTime}ms`);
  }
  
  // Overall health assessment
  const overallSuccess = step1Success && step2Success > 0 && step3Success;
  const healthScore = Math.round(((step1Success ? 1 : 0) + (step2Success/step2Total) + (step3Success ? 1 : 0)) / 3 * 100);
  
  console.log(`\\n🏥 Frontend Compatibility: ${healthScore}%`);
  
  if (healthScore >= 90) {
    console.log('🎉 EXCELLENT - Your frontend will work perfectly!');
  } else if (healthScore >= 75) {
    console.log('✅ GOOD - Your frontend will work well with minor issues');
  } else if (healthScore >= 50) {
    console.log('⚠️ NEEDS ATTENTION - Some frontend features may not work');
  } else {
    console.log('🚨 CRITICAL - Major frontend functionality will be broken');
  }
  
  console.log(`\\n🕐 Completed: ${new Date().toISOString()}`);
  
  // Recommendations
  console.log('\\n💡 RECOMMENDATIONS:');
  if (!step1Success) {
    console.log('❌ CRITICAL: Fix paddlingOut API - frontend cannot load without location data');
  }
  if (step2Success < step2Total) {
    console.log(`⚠️ IMPORTANT: ${step2Total - step2Success} paddle score API calls failed - some icons will show "?" in frontend`);
  }
  if (!step3Success) {
    console.log('❌ IMPORTANT: Fix fastForecast API - modal will not show detailed forecast data');
  }
  if (overallSuccess) {
    console.log('✅ All APIs working - ready for frontend integration!');
  }
  
  return testResults;
}

// Run the comprehensive test
runFrontendSimulationTest().catch(console.error);
