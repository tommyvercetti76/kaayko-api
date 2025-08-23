#!/usr/bin/env node

console.log('🔍 VALIDATING FRONTEND API FIXES...\n');

const fs = require('fs');
const path = require('path');

// Path to frontend API client
const apiClientPath = '/Users/Rohan/Desktop/kaayko-stable/kaayko-frontend/src/js/services/apiClient.js';

try {
  const content = fs.readFileSync(apiClientPath, 'utf8');
  
  let fixes = 0;
  let issues = 0;
  
  console.log('📋 CHECKING FRONTEND API ENDPOINTS:\n');
  
  // Check 1: getForecastData should use /forecast (not /paddlePredict/forecast)
  if (content.includes('/forecast?lat=${lat}&lng=${lng}') && 
      !content.includes('/paddlePredict/forecast?lat=${lat}&lng=${lng}')) {
    console.log('✅ Fix 1: getForecastData() uses correct /forecast endpoint');
    fixes++;
  } else {
    console.log('❌ Fix 1: getForecastData() still uses OLD /paddlePredict/forecast');
    issues++;
  }
  
  // Check 2: getCurrentData should use /paddleScore (not /paddlePredict)
  if (content.includes('/paddleScore?location=${lat},${lng}') && 
      !content.includes('/paddlePredict?lat=${lat}&lng=${lng}')) {
    console.log('✅ Fix 2: getCurrentData() uses correct /paddleScore endpoint');
    fixes++;
  } else {
    console.log('❌ Fix 2: getCurrentData() still uses OLD /paddlePredict');
    issues++;
  }
  
  // Check 3: Emulator port should be 5001 (not 5002)
  const port5001Count = (content.match(/5001/g) || []).length;
  const port5002Count = (content.match(/5002/g) || []).length;
  
  if (port5001Count >= 2 && port5002Count === 0) {
    console.log('✅ Fix 3: All emulator URLs use correct port 5001');
    fixes++;
  } else {
    console.log(`❌ Fix 3: Port issues - Found ${port5001Count}x port 5001, ${port5002Count}x port 5002`);
    issues++;
  }
  
  // Check 4: FastForecast should use 5001 emulator port
  if (content.includes("'http://127.0.0.1:5001/kaaykostore/us-central1'") &&
      !content.includes("'http://127.0.0.1:5002/kaaykostore/us-central1'")) {
    console.log('✅ Fix 4: getFastForecast() uses correct emulator port 5001');
    fixes++;
  } else {
    console.log('❌ Fix 4: getFastForecast() still uses wrong emulator port');
    issues++;
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 FRONTEND VALIDATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Fixes Applied: ${fixes}/4`);
  console.log(`❌ Issues Found: ${issues}/4`);
  console.log(`📈 Success Rate: ${(fixes/4*100).toFixed(1)}%`);
  
  if (fixes === 4) {
    console.log('\n🎉 ALL FRONTEND API FIXES SUCCESSFULLY APPLIED!');
    console.log('🚀 Frontend is now compatible with your new API endpoints');
    
    console.log('\n📋 WHAT WAS FIXED:');
    console.log('• getForecastData(): /paddlePredict/forecast → /forecast');
    console.log('• getCurrentData(): /paddlePredict → /paddleScore');
    console.log('• Emulator URLs: port 5002 → port 5001');
    console.log('• All API calls now match your backend endpoints');
    
    console.log('\n🎯 READY FOR DEPLOYMENT!');
    process.exit(0);
  } else {
    console.log('\n🚨 SOME FIXES STILL NEEDED - CHECK ISSUES ABOVE');
    process.exit(1);
  }

} catch (error) {
  console.error('❌ Error reading frontend API client:', error.message);
  process.exit(1);
}
