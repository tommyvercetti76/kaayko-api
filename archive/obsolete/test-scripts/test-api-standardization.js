// File: test-api-standardization.js
//
// 🧪 API STANDARDIZATION TEST
//
// Tests that paddleScore and fastForecast APIs produce consistent ratings
// for the same location and conditions after standardization fixes.

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

const BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'https://us-central1-kaaykostore.cloudfunctions.net/api'
  : 'http://localhost:5001/kaaykostore/us-central1/api';

// Test locations with known conditions
const TEST_LOCATIONS = [
  {
    name: 'Nagpur, India',
    lat: 21.15,
    lng: 79.1,
    description: 'Inland location - good for testing wind/temperature consistency'
  },
  {
    name: 'Boston, MA',
    lat: 42.3601,
    lng: -71.0589,
    description: 'Coastal location - good for testing marine data integration'
  },
  {
    name: 'Dallas, TX',
    lat: 32.7767,
    lng: -96.7970,
    description: 'Central US - baseline conditions'
  }
];

/**
 * Test both APIs for a location and compare ratings
 */
async function testLocationConsistency(location) {
  console.log(`\n${colors.cyan}🧪 Testing API Consistency for ${location.name}${colors.reset}`);
  console.log(`📍 Coordinates: ${location.lat}, ${location.lng}`);
  console.log(`ℹ️  ${location.description}\n`);

  try {
    // Test paddleScore API (current conditions)
    const paddleScoreUrl = `${BASE_URL}/paddleScore?location=${location.lat},${location.lng}`;
    console.log(`📡 Testing paddleScore: ${paddleScoreUrl}`);
    
    const paddleScoreResponse = await fetch(paddleScoreUrl);
    const paddleScoreData = await paddleScoreResponse.json();
    
    if (!paddleScoreData.success) {
      console.log(`${colors.red}❌ paddleScore failed: ${paddleScoreData.error}${colors.reset}`);
      return false;
    }

    // Test fastForecast API (current hour in forecast)
    const fastForecastUrl = `${BASE_URL}/fastForecast?lat=${location.lat}&lng=${location.lng}`;
    console.log(`📡 Testing fastForecast: ${fastForecastUrl}`);
    
    const fastForecastResponse = await fetch(fastForecastUrl);
    const fastForecastData = await fastForecastResponse.json();
    
    if (!fastForecastData.success) {
      console.log(`${colors.red}❌ fastForecast failed: ${fastForecastData.error}${colors.reset}`);
      return false;
    }

    // Get current hour from forecast (hour 0 or closest)
    const todayForecast = fastForecastData.forecast[0];
    const currentHour = new Date().getHours();
    const currentHourData = todayForecast.hourly[currentHour] || todayForecast.hourly[0] || Object.values(todayForecast.hourly)[0];

    if (!currentHourData) {
      console.log(`${colors.red}❌ No current hour data in forecast${colors.reset}`);
      return false;
    }

    // Compare ratings
    const paddleRating = paddleScoreData.paddleScore.rating;
    const forecastRating = currentHourData.rating;
    const ratingDiff = Math.abs(paddleRating - forecastRating);

    console.log(`\n${colors.blue}📊 RATING COMPARISON${colors.reset}`);
    console.log(`🎯 paddleScore API: ${paddleRating}`);
    console.log(`📈 fastForecast API: ${forecastRating}`);
    console.log(`📏 Difference: ${ratingDiff.toFixed(2)}`);

    // Compare underlying data
    console.log(`\n${colors.blue}🌡️ DATA COMPARISON${colors.reset}`);
    const paddleConditions = paddleScoreData.conditions;
    
    console.log(`Temperature:`);
    console.log(`  paddleScore: ${paddleConditions.temperature}°C`);
    console.log(`  fastForecast: ${currentHourData.temperature}°C`);
    
    console.log(`Wind Speed:`);
    console.log(`  paddleScore: ${paddleConditions.windSpeed} mph`);
    console.log(`  fastForecast: ${currentHourData.windSpeed} kph (${(currentHourData.windSpeed * 0.621371).toFixed(1)} mph)`);
    
    console.log(`Beaufort Scale:`);
    console.log(`  paddleScore: B${paddleConditions.beaufortScale}`);
    console.log(`  fastForecast: B${currentHourData.beaufortScale}`);

    // Compare penalties
    console.log(`\n${colors.blue}⚖️ PENALTY COMPARISON${colors.reset}`);
    console.log(`paddleScore penalties: ${paddleScoreData.paddleScore.penalties.length}`);
    paddleScoreData.paddleScore.penalties.forEach(penalty => console.log(`  - ${penalty}`));
    
    console.log(`fastForecast penalties: ${currentHourData.penaltiesApplied.length}`);
    currentHourData.penaltiesApplied.forEach(penalty => console.log(`  - ${penalty}`));

    // Determine consistency
    const isConsistent = ratingDiff <= 0.5; // Allow 0.5 rating difference
    
    if (isConsistent) {
      console.log(`\n${colors.green}✅ APIs are CONSISTENT (difference: ${ratingDiff.toFixed(2)})${colors.reset}`);
    } else {
      console.log(`\n${colors.red}❌ APIs are INCONSISTENT (difference: ${ratingDiff.toFixed(2)})${colors.reset}`);
    }

    return {
      location: location.name,
      consistent: isConsistent,
      paddleRating,
      forecastRating,
      difference: ratingDiff,
      paddlePenalties: paddleScoreData.paddleScore.penalties.length,
      forecastPenalties: currentHourData.penaltiesApplied.length
    };

  } catch (error) {
    console.log(`${colors.red}❌ Test failed with error: ${error.message}${colors.reset}`);
    return false;
  }
}

/**
 * Run standardization tests for all locations
 */
async function runStandardizationTests() {
  console.log(`${colors.magenta}🚀 API STANDARDIZATION TEST SUITE${colors.reset}`);
  console.log(`${colors.yellow}Testing rating consistency between paddleScore and fastForecast APIs${colors.reset}\n`);

  const results = [];
  
  for (const location of TEST_LOCATIONS) {
    const result = await testLocationConsistency(location);
    if (result) {
      results.push(result);
    }
    
    // Wait between tests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Summary
  console.log(`\n${colors.magenta}📋 TEST SUMMARY${colors.reset}`);
  console.log(`Total locations tested: ${results.length}`);
  
  const consistentCount = results.filter(r => r.consistent).length;
  const inconsistentCount = results.length - consistentCount;
  
  console.log(`${colors.green}✅ Consistent APIs: ${consistentCount}${colors.reset}`);
  console.log(`${colors.red}❌ Inconsistent APIs: ${inconsistentCount}${colors.reset}`);
  
  if (inconsistentCount > 0) {
    console.log(`\n${colors.red}🚨 INCONSISTENT LOCATIONS:${colors.reset}`);
    results.filter(r => !r.consistent).forEach(r => {
      console.log(`  - ${r.location}: paddleScore=${r.paddleRating}, forecast=${r.forecastRating} (diff: ${r.difference.toFixed(2)})`);
    });
  }

  const avgDifference = results.reduce((sum, r) => sum + r.difference, 0) / results.length;
  console.log(`\n📊 Average rating difference: ${avgDifference.toFixed(3)}`);
  
  const allConsistent = inconsistentCount === 0;
  if (allConsistent) {
    console.log(`\n${colors.green}🎉 ALL APIS ARE NOW CONSISTENT!${colors.reset}`);
    console.log(`${colors.green}✅ Standardization successful - ratings aligned across both APIs${colors.reset}`);
  } else {
    console.log(`\n${colors.yellow}⚠️ Some inconsistencies remain - may need additional standardization${colors.reset}`);
  }

  return allConsistent;
}

// Run tests if script is executed directly
if (require.main === module) {
  runStandardizationTests().catch(console.error);
}

module.exports = { runStandardizationTests, testLocationConsistency };
