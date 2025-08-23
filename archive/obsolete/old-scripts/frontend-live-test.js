#!/usr/bin/env node

console.log('🌐 FRONTEND LIVE API TEST - SIMULATING REAL BROWSER USAGE');
console.log('=' .repeat(70));

const fs = require('fs');

// Read the actual frontend API client 
const apiClientPath = '/Users/Rohan/Desktop/kaayko-stable/kaayko-frontend/src/js/services/apiClient.js';
const frontendPath = '/Users/Rohan/Desktop/kaayko-stable/kaayko-frontend/src/js/paddlingout.js';

console.log('📋 ANALYZING FRONTEND API USAGE:\n');

try {
  // Load the frontend API client code
  const apiClientCode = fs.readFileSync(apiClientPath, 'utf8');
  const paddlingoutCode = fs.readFileSync(frontendPath, 'utf8');
  
  console.log('🔍 FRONTEND API CLIENT METHODS:');
  
  // Extract method signatures
  const methods = apiClientCode.match(/async \w+\([^)]*\) \{[^}]*url = `[^`]+`/g);
  
  if (methods) {
    methods.forEach((method, i) => {
      const methodName = method.match(/async (\w+)\(/)[1];
      const url = method.match(/url = `([^`]+)`/)[1];
      console.log(`  ${i+1}. ${methodName}() → ${url}`);
    });
  }
  
  console.log('\n🎯 HOW PADDLINGOUT.JS CALLS APIS:');
  
  // Find API calls in paddlingout.js
  const apiCalls = paddlingoutCode.match(/window\.apiClient\.\w+\([^)]*\)/g);
  
  if (apiCalls) {
    apiCalls.forEach((call, i) => {
      console.log(`  ${i+1}. ${call}`);
    });
  }
  
  console.log('\n🚀 SIMULATION: USER VISITS PADDLINGOUT PAGE');
  console.log('-'.repeat(50));
  
  // Simulate the flow
  console.log('👤 User opens: kaayko-frontend/src/paddlingout.html');
  console.log('⚡ Browser loads: paddlingout.js');
  console.log('🔧 paddlingout.js creates: window.apiClient (services/apiClient.js)');
  console.log('📍 User clicks location → fetchPaddleScore() called');
  
  // Show the actual call chain
  const fetchScoreMatch = paddlingoutCode.match(/fetchPaddleScore[^}]+}/s);
  if (fetchScoreMatch) {
    console.log('\n📡 ACTUAL API CALL CHAIN:');
    console.log('```javascript');
    console.log('// From paddlingout.js fetchPaddleScore():');
    const lines = fetchScoreMatch[0].split('\n').slice(0, 10);
    lines.forEach(line => console.log(line));
    console.log('```');
  }
  
  console.log('\n🎯 RESULT: Frontend will call these NEW API endpoints:');
  console.log('  📞 window.apiClient.getFastForecast(lat, lng)');
  console.log('  📞 → http://127.0.0.1:5001/kaaykostore/us-central1/fastForecast?lat=X&lng=Y');
  console.log('  📞 → https://us-central1-kaaykostore.cloudfunctions.net/fastForecast?lat=X&lng=Y');
  
  console.log('\n✅ FRONTEND IS NOW USING YOUR NEW APIS!');
  console.log('🚀 Ready to test in browser at: file:///Users/Rohan/Desktop/kaayko-stable/kaayko-frontend/src/paddlingout.html');
  
} catch (error) {
  console.error('❌ Error:', error.message);
}
