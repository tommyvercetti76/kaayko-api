#!/usr/bin/env node

console.log('🎯 FRONTEND API FLOW VALIDATION');
console.log('=' .repeat(50));

const fs = require('fs');

// Read frontend files
const paddlingoutPath = '/Users/Rohan/Desktop/kaayko-stable/kaayko-frontend/src/js/paddlingout.js';
const advancedModalPath = '/Users/Rohan/Desktop/kaayko-stable/kaayko-frontend/src/js/advancedModal.js';

try {
  const paddlingout = fs.readFileSync(paddlingoutPath, 'utf8');
  const advancedModal = fs.readFileSync(advancedModalPath, 'utf8');
  
  let correct = 0;
  let total = 2;
  
  console.log('📋 CHECKING FRONTEND API USAGE:\n');
  
  // Check 1: Main page should use getCurrentData for score icons
  if (paddlingout.includes('window.apiClient.getCurrentData(lat, lng)')) {
    console.log('✅ Main page score icons: Uses getCurrentData() → /paddleScore');
    correct++;
  } else if (paddlingout.includes('window.apiClient.getFastForecast(lat, lng)')) {
    console.log('❌ Main page score icons: Still uses getFastForecast() (should use getCurrentData)');
  } else {
    console.log('❌ Main page score icons: No API call found');
  }
  
  // Check 2: Modal should use getFastForecast for detailed data
  if (advancedModal.includes('window.apiClient.getFastForecast(')) {
    console.log('✅ Detailed modal: Uses getFastForecast() → /fastForecast');
    correct++;
  } else {
    console.log('❌ Detailed modal: Doesn\'t use getFastForecast()');
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 API FLOW VALIDATION SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Correct API Usage: ${correct}/${total}`);
  console.log(`📈 Success Rate: ${(correct/total*100).toFixed(1)}%`);
  
  if (correct === total) {
    console.log('\n🎉 PERFECT! Frontend now uses optimal API flow:');
    console.log('   📍 Main page → /paddleScore (quick scores)');
    console.log('   📊 Modal → /fastForecast (full forecast)');
    
    console.log('\n🚀 EXPECTED NETWORK CALLS:');
    console.log('   1. User opens paddlingout.html');
    console.log('   2. Page loads locations: /paddlingOut');
    console.log('   3. Score icons load: /paddleScore?location=X,Y (for each spot)');
    console.log('   4. User clicks modal: /fastForecast?lat=X&lng=Y');
    
    console.log('\n✅ READY FOR TESTING!');
    console.log('   Open: http://localhost:5002/paddlingout.html');
    console.log('   Check Network tab to see API calls');
    
    process.exit(0);
  } else {
    console.log('\n🚨 API FLOW NEEDS ATTENTION - SEE ISSUES ABOVE');
    process.exit(1);
  }

} catch (error) {
  console.error('❌ Error reading frontend files:', error.message);
  process.exit(1);
}
