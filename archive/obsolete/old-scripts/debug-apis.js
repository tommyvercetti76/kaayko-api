#!/usr/bin/env node

/**
 * 🔍 Debug Production API Responses
 * 
 * Investigates the actual responses from failing endpoints
 * to understand what's being returned instead of JSON.
 */

const https = require('https');

const ENDPOINTS = {
  fastForecast: 'https://us-central1-kaaykostore.cloudfunctions.net/api/fastForecast',
  paddleScore: 'https://us-central1-kaaykostore.cloudfunctions.net/api/paddleScore',
  forecast: 'https://us-central1-kaaykostore.cloudfunctions.net/api/forecast'
};

const TEST_LOCATION = {
  lat: 33.156487,
  lng: -96.949953
};

function debugRequest(name, url) {
  return new Promise((resolve) => {
    console.log(`\n🔍 Testing ${name}:`);
    console.log(`🌐 URL: ${url}`);
    console.log('─'.repeat(80));
    
    const req = https.get(url, (res) => {
      let data = '';
      
      console.log(`📊 Status Code: ${res.statusCode}`);
      console.log(`📋 Headers:`, JSON.stringify(res.headers, null, 2));
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`📦 Response Length: ${data.length} bytes`);
        console.log(`📄 Raw Response (first 500 chars):`);
        console.log('─'.repeat(50));
        console.log(data.substring(0, 500));
        console.log('─'.repeat(50));
        
        // Try to parse as JSON
        try {
          const parsed = JSON.parse(data);
          console.log('✅ Valid JSON - parsed successfully');
          console.log('🎯 Sample keys:', Object.keys(parsed).slice(0, 5));
        } catch (error) {
          console.log('❌ Invalid JSON:', error.message);
          
          // Check if it's HTML error page
          if (data.includes('<!DOCTYPE html>') || data.includes('<html>')) {
            console.log('🚨 Response appears to be HTML error page');
          } else if (data.includes('Error:') || data.includes('error')) {
            console.log('🚨 Response appears to be plain text error');
          }
        }
        
        resolve();
      });
    });
    
    req.on('error', (error) => {
      console.log(`❌ Request Error: ${error.message}`);
      resolve();
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      console.log('⏰ Request timed out');
      resolve();
    });
  });
}

async function debugApis() {
  console.log('🔍 DEBUGGING PRODUCTION API RESPONSES');
  console.log('═'.repeat(80));
  
  // Test each failing endpoint
  await debugRequest('FastForecast', `${ENDPOINTS.fastForecast}?lat=${TEST_LOCATION.lat}&lng=${TEST_LOCATION.lng}`);
  await debugRequest('PaddleScore', `${ENDPOINTS.paddleScore}?location=${TEST_LOCATION.lat},${TEST_LOCATION.lng}`);
  await debugRequest('Forecast', `${ENDPOINTS.forecast}?lat=${TEST_LOCATION.lat}&lng=${TEST_LOCATION.lng}`);
  
  console.log('\n🔍 ALSO TESTING BASE ENDPOINTS (no params):');
  await debugRequest('FastForecast Base', ENDPOINTS.fastForecast);
  await debugRequest('PaddleScore Base', ENDPOINTS.paddleScore);
}

debugApis().catch(console.error);
