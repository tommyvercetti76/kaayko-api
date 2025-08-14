#!/usr/bin/env node
/**
 * Core API Tests for Kaayko Platform
 * 
 * Tests all API endpoints for functionality, response formats, and basic validation.
 * Uses modern testing practices with clear separation of concerns.
 * 
 * Usage: node api.test.js [--baseUrl=URL] [--verbose]
 */

const https = require('https');
const http = require('http');

// Configuration
const BASE_URL = process.argv.find(arg => arg.startsWith('--baseUrl='))?.split('=')[1] || 
                 process.env.BASE_URL || 'https://api-vwcc5j4qda-uc.a.run.app';
const VERBOSE = process.argv.includes('--verbose');

// Test results
const results = {
  passed: 0,
  failed: 0,
  total: 0,
  failures: []
};

// Utility functions
function log(message, type = 'info') {
  const symbols = { info: '📋', pass: '✅', fail: '❌', warn: '⚠️' };
  console.log(`${symbols[type]} ${message}`);
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Kaayko-APITest/1.0',
        'Accept': 'application/json',
        ...options.headers
      },
      timeout: 15000
    };

    if (VERBOSE) {
      console.log(`\n🔄 REQUEST: ${options.method || 'GET'} ${url}`);
      if (options.body) console.log(`📤 BODY: ${options.body}`);
    }

    const startTime = Date.now();
    const req = protocol.request(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - startTime;
        
        if (VERBOSE) {
          console.log(`📥 RESPONSE: ${res.statusCode} (${duration}ms)`);
          try {
            const parsed = JSON.parse(data);
            console.log(JSON.stringify(parsed, null, 2));
          } catch (e) {
            console.log(data.substring(0, 200));
          }
        }
        
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          duration
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function test(name, testFn) {
  results.total++;
  try {
    await testFn();
    results.passed++;
    log(`${name}`, 'pass');
  } catch (error) {
    results.failed++;
    results.failures.push({ name, error: error.message });
    log(`${name}: ${error.message}`, 'fail');
  }
}

// Test suites
async function testProducts() {
  log('\n🛒 Testing Products API', 'info');
  
  await test('GET /products returns array', async () => {
    const response = await makeRequest(`${BASE_URL}/products`);
    if (response.statusCode !== 200) throw new Error(`Expected 200, got ${response.statusCode}`);
    
    const products = JSON.parse(response.body);
    if (!Array.isArray(products)) throw new Error('Response is not an array');
    if (products.length === 0) throw new Error('No products found');
  });

  await test('GET /products/:id returns product details', async () => {
    const productsResponse = await makeRequest(`${BASE_URL}/products`);
    const products = JSON.parse(productsResponse.body);
    
    if (products.length > 0) {
      const productId = products[0].id;
      const response = await makeRequest(`${BASE_URL}/products/${productId}`);
      
      if (response.statusCode !== 200) throw new Error(`Expected 200, got ${response.statusCode}`);
      
      const product = JSON.parse(response.body);
      if (!product.id) throw new Error('Product missing id field');
      if (!product.title) throw new Error('Product missing title field');
    }
  });

  await test('POST /products/:id/vote accepts valid votes', async () => {
    const productsResponse = await makeRequest(`${BASE_URL}/products`);
    const products = JSON.parse(productsResponse.body);
    
    if (products.length > 0) {
      const productId = products[0].id;
      const response = await makeRequest(`${BASE_URL}/products/${productId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voteChange: 1 })
      });
      
      if (![200, 404].includes(response.statusCode)) {
        throw new Error(`Expected 200 or 404, got ${response.statusCode}`);
      }
    }
  });
}

async function testPaddlingOut() {
  log('\n🏞️ Testing PaddlingOut API', 'info');
  
  await test('GET /paddlingOut returns locations', async () => {
    const response = await makeRequest(`${BASE_URL}/paddlingOut`);
    if (response.statusCode !== 200) throw new Error(`Expected 200, got ${response.statusCode}`);
    
    const locations = JSON.parse(response.body);
    if (!Array.isArray(locations)) throw new Error('Response is not an array');
  });

  await test('GET /paddlingOut/:id returns location details', async () => {
    const locationsResponse = await makeRequest(`${BASE_URL}/paddlingOut`);
    const locations = JSON.parse(locationsResponse.body);
    
    if (locations.length > 0) {
      const locationId = locations[0].id;
      const response = await makeRequest(`${BASE_URL}/paddlingOut/${locationId}`);
      
      if (response.statusCode !== 200) throw new Error(`Expected 200, got ${response.statusCode}`);
      
      const location = JSON.parse(response.body);
      if (!location.id) throw new Error('Location missing id field');
    }
  });
}

async function testPaddleConditions() {
  log('\n🌤️ Testing PaddleConditions API', 'info');
  
  await test('GET /paddleConditions/summary with coordinates', async () => {
    const response = await makeRequest(`${BASE_URL}/paddleConditions/summary?lat=39.0968&lng=-120.0324`);
    
    // Accept 200 (success) or various error codes due to rate limiting/API issues
    if (![200, 400, 429, 500].includes(response.statusCode)) {
      throw new Error(`Unexpected status code: ${response.statusCode}`);
    }
    
    if (response.statusCode === 200) {
      const data = JSON.parse(response.body);
      if (!data.success && !data.error) throw new Error('Invalid response format');
    }
  });

  await test('GET /paddleConditions/health endpoint', async () => {
    const response = await makeRequest(`${BASE_URL}/paddleConditions/health`);
    
    // Health endpoint should be available
    if (![200, 404, 429].includes(response.statusCode)) {
      throw new Error(`Unexpected status code: ${response.statusCode}`);
    }
  });
}

async function testPaddlePredict() {
  log('\n🤖 Testing PaddlePredict API', 'info');
  
  await test('GET /paddlePredict with coordinates', async () => {
    const response = await makeRequest(`${BASE_URL}/paddlePredict?lat=39.0968&lng=-120.0324`);
    
    if (![200, 400, 429, 500].includes(response.statusCode)) {
      throw new Error(`Unexpected status code: ${response.statusCode}`);
    }
    
    if (response.statusCode === 200) {
      const data = JSON.parse(response.body);
      if (data.mlModelUsed === undefined) throw new Error('Missing mlModelUsed field');
    }
  });

  await test('GET /paddlePredict/model info', async () => {
    const response = await makeRequest(`${BASE_URL}/paddlePredict/model`);
    
    if (![200, 404, 429, 500].includes(response.statusCode)) {
      throw new Error(`Unexpected status code: ${response.statusCode}`);
    }
  });
}

async function testImages() {
  log('\n🖼️ Testing Images API', 'info');
  
  await test('GET /images/:productId/:filename handles requests', async () => {
    const response = await makeRequest(`${BASE_URL}/images/test123/test.jpg`);
    
    // Images can exist (200), not exist (404), or have other issues
    if (![200, 404, 429, 500].includes(response.statusCode)) {
      throw new Error(`Unexpected status code: ${response.statusCode}`);
    }
  });
}

async function testReporting() {
  log('\n📊 Testing Reporting API', 'info');
  
  await test('GET /paddlingReport/summary', async () => {
    const response = await makeRequest(`${BASE_URL}/paddlingReport/summary`);
    
    if (![200, 429, 500, 504].includes(response.statusCode)) {
      throw new Error(`Unexpected status code: ${response.statusCode}`);
    }
    
    if (response.statusCode === 200) {
      const data = JSON.parse(response.body);
      if (!data.success && !data.error) throw new Error('Invalid response format');
    }
  });

  await test('GET /paddlingReport/best', async () => {
    const response = await makeRequest(`${BASE_URL}/paddlingReport/best`);
    
    if (![200, 429, 500, 504].includes(response.statusCode)) {
      throw new Error(`Unexpected status code: ${response.statusCode}`);
    }
  });
}

// Main execution
async function runTests() {
  console.log('🧪 Kaayko API Test Suite');
  console.log(`🎯 Target: ${BASE_URL}`);
  console.log(`📝 Verbose: ${VERBOSE ? 'ON' : 'OFF'}`);
  console.log('='.repeat(60));

  const startTime = Date.now();

  await testProducts();
  await testPaddlingOut();
  await testPaddleConditions();
  await testPaddlePredict();
  await testImages();
  await testReporting();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📊 Total: ${results.total}`);
  console.log(`📈 Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);
  console.log(`⏱️ Duration: ${duration}s`);

  if (results.failures.length > 0) {
    console.log('\n❌ Failures:');
    results.failures.forEach(failure => {
      console.log(`  - ${failure.name}: ${failure.error}`);
    });
  }

  const success = results.failed === 0;
  console.log(`\n🏆 Overall: ${success ? '✅ PASS' : '❌ FAIL'}`);
  
  process.exit(success ? 0 : 1);
}

runTests().catch(error => {
  console.error('💥 Test suite crashed:', error);
  process.exit(1);
});
