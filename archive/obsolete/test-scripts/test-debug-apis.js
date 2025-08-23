#!/usr/bin/env node

const https = require('https');

const BASE_URL = 'https://us-central1-kaaykostore.cloudfunctions.net/api';

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

async function debugAPI() {
  console.log('🔍 DEBUG: Testing API Response Structures');
  console.log('===========================================');
  
  // Test fastforecast
  console.log('\n📊 Testing fastforecast API:');
  try {
    const url = `${BASE_URL}/fastforecast?lat=33.156487&lng=-96.949953`;
    console.log(`URL: ${url}`);
    
    const response = await makeRequest(url);
    console.log(`Status: ${response.statusCode}`);
    console.log('Data structure:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.log('Error:', error.message);
  }

  // Test forecast  
  console.log('\n🌅 Testing forecast API:');
  try {
    const url = `${BASE_URL}/forecast?location=33.156487,-96.949953`;
    console.log(`URL: ${url}`);
    
    const response = await makeRequest(url);
    console.log(`Status: ${response.statusCode}`);
    console.log('Data structure:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.log('Error:', error.message);
  }
}

debugAPI().catch(console.error);
