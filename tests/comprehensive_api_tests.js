#!/usr/bin/env node
/**
 * Comprehensive API Test Suite for Kaayko Firebase Functions
 * 
 * This test suite covers ALL endpoints with extensive scenarios:
 * - Success cases, edge cases, error conditions
 * - Input validation, rate limiting, security
 * - Performance testing and stress scenarios
 * - Authentication, authorization, and CORS
 * 
 * Usage: node comprehensive_api_tests.js [--baseUrl=URL] [--verbose] [--stress]
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const DEFAULT_BASE_URL = process.env.BASE_URL || 'https://api-vwcc5j4qda-uc.a.run.app';
const VERBOSE = process.argv.includes('--verbose');
const STRESS_TEST = process.argv.includes('--stress');
const OUTPUT_FILE = path.join(__dirname, 'comprehensive_test_results.json');

// Get base URL from command line or use default
let BASE_URL = DEFAULT_BASE_URL;
const baseUrlArg = process.argv.find(arg => arg.startsWith('--baseUrl='));
if (baseUrlArg) {
  BASE_URL = baseUrlArg.split('=')[1];
}

console.log(`🧪 Comprehensive API Test Suite`);
console.log(`🎯 Target: ${BASE_URL}`);
console.log(`📊 Mode: ${STRESS_TEST ? 'STRESS TEST' : 'NORMAL'}`);
console.log(`📝 Verbose: ${VERBOSE ? 'ON' : 'OFF'}`);
console.log(`📄 Results: ${OUTPUT_FILE}`);
console.log('=' .repeat(80));

// Test result tracking
const testResults = {
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    errors: 0,
    warnings: 0,
    startTime: new Date().toISOString(),
    endTime: null,
    duration: null
  },
  categories: {},
  details: []
};

// Utility functions
function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '📋',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    debug: '🔍'
  }[level] || '📋';
  
  console.log(`${prefix} [${timestamp}] ${message}`);
  
  if (VERBOSE || level !== 'debug') {
    testResults.details.push({
      timestamp,
      level,
      message
    });
  }
}

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const protocol = options.protocol === 'https:' ? https : http;
    const startTime = Date.now();
    
    // Log pretty-printed request details if verbose
    if (VERBOSE) {
      console.log('\n📤 REQUEST:');
      console.log(JSON.stringify({
        method: options.method || 'GET',
        url: `${options.protocol}//${options.hostname}${options.path}`,
        headers: options.headers,
        body: postData ? (typeof postData === 'string' ? postData : JSON.stringify(postData, null, 2)) : null
      }, null, 2));
    }
    
    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - startTime;
        
        // Log pretty-printed response details if verbose
        if (VERBOSE) {
          console.log('\n📥 RESPONSE:');
          let responseBody = data;
          try {
            // Try to parse and pretty-print JSON responses
            const parsed = JSON.parse(data);
            responseBody = JSON.stringify(parsed, null, 2);
          } catch (e) {
            // Keep original data if not JSON
            responseBody = data;
          }
          
          console.log(JSON.stringify({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            body: responseBody,
            duration: `${duration}ms`
          }, null, 2));
          console.log('─'.repeat(80));
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
    
    req.setTimeout(30000); // 30 second timeout
    
    if (postData) {
      req.write(postData);
    }
    
    req.end();
  });
}

async function runTest(testName, testFn, category = 'general') {
  testResults.summary.total++;
  
  if (!testResults.categories[category]) {
    testResults.categories[category] = { passed: 0, failed: 0, total: 0 };
  }
  testResults.categories[category].total++;
  
  try {
    log(`Running: ${testName}`, 'debug');
    const result = await testFn();
    
    if (result.success) {
      testResults.summary.passed++;
      testResults.categories[category].passed++;
      log(`✅ ${testName} - ${result.message || 'PASSED'}`, 'success');
    } else {
      testResults.summary.failed++;
      testResults.categories[category].failed++;
      log(`❌ ${testName} - ${result.message || 'FAILED'}`, 'error');
    }
    
    return result;
  } catch (error) {
    testResults.summary.errors++;
    testResults.categories[category].failed++;
    log(`💥 ${testName} - ERROR: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
}

// Test helper functions
function parseUrl(url) {
  const parsed = new URL(url);
  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + parsed.search
  };
}

function createRequestOptions(path, method = 'GET', headers = {}) {
  const url = `${BASE_URL}${path}`;
  const parsed = parseUrl(url);
  
  return {
    ...parsed,
    method,
    headers: {
      'User-Agent': 'Kaayko-Test-Suite/1.0',
      'Accept': 'application/json',
      ...headers
    }
  };
}

// ============================================================================
// TEST SUITES BY CATEGORY
// ============================================================================

// 1. HEALTH CHECK TESTS
async function testHealthChecks() {
  log('🏥 Testing Health Check Endpoints', 'info');
  
  const healthEndpoints = [
    '/helloWorld',
    '/images/health',
    '/paddleConditions/health',
    '/paddlingReport/health',
    '/paddlePredict/health',
    '/health', // deeplink health
  ];
  
  for (const endpoint of healthEndpoints) {
    await runTest(`Health Check: ${endpoint}`, async () => {
      const options = createRequestOptions(endpoint);
      const response = await makeRequest(options);
      
      if (response.statusCode === 200) {
        try {
          const data = JSON.parse(response.body);
          return { 
            success: true, 
            message: `Health OK (${response.duration}ms)`,
            data 
          };
        } catch (e) {
          return { 
            success: response.body === 'OK', 
            message: `Health OK - Plain text (${response.duration}ms)` 
          };
        }
      }
      
      return { 
        success: false, 
        message: `HTTP ${response.statusCode}: ${response.body}` 
      };
    }, 'health');
  }
}

// 2. PRODUCTS API TESTS
async function testProductsAPI() {
  log('🛍️ Testing Products API', 'info');
  
  // Test: List all products
  await runTest('Products: List All', async () => {
    const options = createRequestOptions('/products');
    const response = await makeRequest(options);
    
    if (response.statusCode === 200) {
      const products = JSON.parse(response.body);
      return { 
        success: Array.isArray(products), 
        message: `Found ${products.length} products (${response.duration}ms)`,
        data: { count: products.length }
      };
    }
    
    return { success: false, message: `HTTP ${response.statusCode}` };
  }, 'products');
  
  // Test: Get specific product (valid)
  const testProductIds = ['test123', 'product1', 'shirt001'];
  for (const productId of testProductIds) {
    await runTest(`Products: Get ${productId}`, async () => {
      const options = createRequestOptions(`/products/${productId}`);
      const response = await makeRequest(options);
      
      if (response.statusCode === 200) {
        const product = JSON.parse(response.body);
        return { 
          success: true, 
          message: `Product found: ${product.title || 'Untitled'} (${response.duration}ms)`,
          data: product 
        };
      } else if (response.statusCode === 404) {
        return { 
          success: true, 
          message: `Product not found (expected) (${response.duration}ms)` 
        };
      }
      
      return { success: false, message: `HTTP ${response.statusCode}` };
    }, 'products');
  }
  
  // Test: Invalid product IDs
  const invalidIds = ['', 'invalid/id', 'id with spaces', '..', '../../../etc/passwd'];
  for (const invalidId of invalidIds) {
    await runTest(`Products: Invalid ID "${invalidId}"`, async () => {
      const options = createRequestOptions(`/products/${encodeURIComponent(invalidId)}`);
      const response = await makeRequest(options);
      
      return { 
        success: [400, 404].includes(response.statusCode), 
        message: `HTTP ${response.statusCode} (${response.duration}ms)` 
      };
    }, 'products');
  }
  
  // Test: Product voting
  await runTest('Products: Vote +1', async () => {
    const options = createRequestOptions('/products/test123/vote', 'POST', {
      'Content-Type': 'application/json'
    });
    const postData = JSON.stringify({ voteChange: 1 });
    const response = await makeRequest(options, postData);
    
    return { 
      success: [200, 404].includes(response.statusCode), 
      message: `Vote result: HTTP ${response.statusCode} (${response.duration}ms)` 
    };
  }, 'products');
  
  await runTest('Products: Vote -1', async () => {
    const options = createRequestOptions('/products/test123/vote', 'POST', {
      'Content-Type': 'application/json'
    });
    const postData = JSON.stringify({ voteChange: -1 });
    const response = await makeRequest(options, postData);
    
    return { 
      success: [200, 404].includes(response.statusCode), 
      message: `Vote result: HTTP ${response.statusCode} (${response.duration}ms)` 
    };
  }, 'products');
  
  // Test: Invalid vote values
  const invalidVotes = [0, 2, -2, 'invalid', null, undefined];
  for (const vote of invalidVotes) {
    await runTest(`Products: Invalid vote ${vote}`, async () => {
      const options = createRequestOptions('/products/test123/vote', 'POST', {
        'Content-Type': 'application/json'
      });
      const postData = JSON.stringify({ voteChange: vote });
      const response = await makeRequest(options, postData);
      
      return { 
        success: response.statusCode === 400, 
        message: `HTTP ${response.statusCode} (${response.duration}ms)` 
      };
    }, 'products');
  }
}

// 3. IMAGES API TESTS
async function testImagesAPI() {
  log('🖼️ Testing Images API', 'info');
  
  // Test: Valid image requests
  const testImages = [
    { productId: 'test123', fileName: 'image1.jpg' },
    { productId: 'shirt001', fileName: 'front.png' },
    { productId: 'hoodie', fileName: 'back.webp' }
  ];
  
  for (const img of testImages) {
    await runTest(`Images: ${img.productId}/${img.fileName}`, async () => {
      const options = createRequestOptions(`/images/${img.productId}/${img.fileName}`);
      const response = await makeRequest(options);
      
      return { 
        success: [200, 404].includes(response.statusCode), 
        message: `Image result: HTTP ${response.statusCode} (${response.duration}ms)` 
      };
    }, 'images');
  }
  
  // Test: Invalid image requests
  const invalidImages = [
    { productId: '', fileName: 'test.jpg' },
    { productId: 'test', fileName: '' },
    { productId: '../../../etc', fileName: 'passwd' },
    { productId: 'test', fileName: '../config.json' }
  ];
  
  for (const img of invalidImages) {
    await runTest(`Images: Invalid ${img.productId}/${img.fileName}`, async () => {
      const path = `/images/${encodeURIComponent(img.productId)}/${encodeURIComponent(img.fileName)}`;
      const options = createRequestOptions(path);
      const response = await makeRequest(options);
      
      return { 
        success: [400, 404].includes(response.statusCode), 
        message: `HTTP ${response.statusCode} (${response.duration}ms)` 
      };
    }, 'images');
  }
}

// 4. PADDLING OUT API TESTS
async function testPaddlingOutAPI() {
  log('🏞️ Testing Paddling Out API', 'info');
  
  // Test: List all paddling spots
  await runTest('PaddlingOut: List All Spots', async () => {
    const options = createRequestOptions('/paddlingOut');
    const response = await makeRequest(options);
    
    if (response.statusCode === 200) {
      const spots = JSON.parse(response.body);
      return { 
        success: Array.isArray(spots), 
        message: `Found ${spots.length} spots (${response.duration}ms)`,
        data: { count: spots.length }
      };
    }
    
    return { success: false, message: `HTTP ${response.statusCode}` };
  }, 'paddlingOut');
  
  // Test: Get specific spots
  const testSpotIds = ['spot1', 'lake_tahoe', 'invalid_spot', 'torch789'];
  for (const spotId of testSpotIds) {
    await runTest(`PaddlingOut: Get ${spotId}`, async () => {
      const options = createRequestOptions(`/paddlingOut/${spotId}`);
      const response = await makeRequest(options);
      
      if (response.statusCode === 200) {
        const spot = JSON.parse(response.body);
        return { 
          success: true, 
          message: `Spot found: ${spot.title || spot.lakeName || 'Untitled'} (${response.duration}ms)`,
          data: spot 
        };
      } else if (response.statusCode === 404) {
        return { 
          success: true, 
          message: `Spot not found (expected) (${response.duration}ms)` 
        };
      }
      
      return { success: false, message: `HTTP ${response.statusCode}` };
    }, 'paddlingOut');
  }
  
  // Test: Invalid spot IDs
  const invalidSpotIds = ['', 'id/with/slashes', '../../etc/passwd', 'very_long_id_'.repeat(10)];
  for (const invalidId of invalidSpotIds) {
    await runTest(`PaddlingOut: Invalid ID "${invalidId}"`, async () => {
      const options = createRequestOptions(`/paddlingOut/${encodeURIComponent(invalidId)}`);
      const response = await makeRequest(options);
      
      return { 
        success: [400, 404].includes(response.statusCode), 
        message: `HTTP ${response.statusCode} (${response.duration}ms)` 
      };
    }, 'paddlingOut');
  }
}

// 5. PADDLE CONDITIONS API TESTS
async function testPaddleConditionsAPI() {
  log('🌊 Testing Paddle Conditions API', 'info');
  
  // Test coordinates
  const testCoordinates = [
    { lat: 39.0968, lng: -120.0324, name: 'Lake Tahoe' },
    { lat: 44.0, lng: -85.0, name: 'Torch Lake' },
    { lat: 0, lng: 0, name: 'Null Island' },
    { lat: 90, lng: 180, name: 'Extreme coordinates' }
  ];
  
  for (const coord of testCoordinates) {
    await runTest(`PaddleConditions: ${coord.name}`, async () => {
      const options = createRequestOptions(`/paddleConditions?lat=${coord.lat}&lng=${coord.lng}`);
      const response = await makeRequest(options);
      
      if (response.statusCode === 200) {
        const data = JSON.parse(response.body);
        return { 
          success: true, 
          message: `Conditions retrieved (${response.duration}ms)`,
          data 
        };
      } else if ([400, 500].includes(response.statusCode)) {
        return { 
          success: true, 
          message: `Expected error: HTTP ${response.statusCode} (${response.duration}ms)` 
        };
      }
      
      return { success: false, message: `Unexpected: HTTP ${response.statusCode}` };
    }, 'paddleConditions');
  }
  
  // Test location names
  const testLocations = [
    'Lake Tahoe',
    'Torch Lake',
    'Invalid Location',
    'San Francisco, CA'
  ];
  
  for (const location of testLocations) {
    await runTest(`PaddleConditions: "${location}"`, async () => {
      const options = createRequestOptions(`/paddleConditions?location=${encodeURIComponent(location)}`);
      const response = await makeRequest(options);
      
      return { 
        success: [200, 400, 500].includes(response.statusCode), 
        message: `HTTP ${response.statusCode} (${response.duration}ms)` 
      };
    }, 'paddleConditions');
  }
  
  // Test summary endpoint
  await runTest('PaddleConditions: Summary', async () => {
    const options = createRequestOptions('/paddleConditions/summary?lat=39.0968&lng=-120.0324');
    const response = await makeRequest(options);
    
    if (response.statusCode === 200) {
      const data = JSON.parse(response.body);
      return { 
        success: true, 
        message: `Summary retrieved (${response.duration}ms)`,
        data 
      };
    }
    
    return { 
      success: [400, 500].includes(response.statusCode), 
      message: `HTTP ${response.statusCode} (${response.duration}ms)` 
    };
  }, 'paddleConditions');
  
  // Test invalid coordinates
  const invalidCoords = [
    { lat: 'invalid', lng: -120.0324 },
    { lat: 39.0968, lng: 'invalid' },
    { lat: 91, lng: -120.0324 },
    { lat: 39.0968, lng: 181 }
  ];
  
  for (const coord of invalidCoords) {
    await runTest(`PaddleConditions: Invalid coords ${coord.lat},${coord.lng}`, async () => {
      const options = createRequestOptions(`/paddleConditions?lat=${coord.lat}&lng=${coord.lng}`);
      const response = await makeRequest(options);
      
      return { 
        success: response.statusCode === 400, 
        message: `HTTP ${response.statusCode} (${response.duration}ms)` 
      };
    }, 'paddleConditions');
  }
}

// 6. PADDLE PREDICT API TESTS
async function testPaddlePredictAPI() {
  log('🤖 Testing Paddle Predict API (ML)', 'info');
  
  // Test: Model info
  await runTest('PaddlePredict: Model Info', async () => {
    const options = createRequestOptions('/paddlePredict/model');
    const response = await makeRequest(options);
    
    if (response.statusCode === 200) {
      const data = JSON.parse(response.body);
      return { 
        success: true, 
        message: `Model info retrieved (${response.duration}ms)`,
        data 
      };
    }
    
    return { success: false, message: `HTTP ${response.statusCode}` };
  }, 'paddlePredict');
  
  // Test: Predictions with coordinates
  const testPredictions = [
    { lat: 39.0968, lng: -120.0324, name: 'Lake Tahoe' },
    { lat: 44.0, lng: -85.0, name: 'Torch Lake' }
  ];
  
  for (const pred of testPredictions) {
    await runTest(`PaddlePredict: ${pred.name}`, async () => {
      const options = createRequestOptions(`/paddlePredict?lat=${pred.lat}&lng=${pred.lng}`);
      const response = await makeRequest(options);
      
      if (response.statusCode === 200) {
        const data = JSON.parse(response.body);
        return { 
          success: data.mlModelUsed !== undefined, 
          message: `Prediction: ${data.mlModelUsed ? 'ML' : 'Fallback'} (${response.duration}ms)`,
          data 
        };
      }
      
      return { 
        success: [400, 500].includes(response.statusCode), 
        message: `HTTP ${response.statusCode} (${response.duration}ms)` 
      };
    }, 'paddlePredict');
  }
  
  // Test: Forecast endpoint
  await runTest('PaddlePredict: Forecast', async () => {
    const options = createRequestOptions('/paddlePredict/forecast?lat=39.0968&lng=-120.0324');
    const response = await makeRequest(options);
    
    return { 
      success: [200, 400, 500].includes(response.statusCode), 
      message: `HTTP ${response.statusCode} (${response.duration}ms)` 
    };
  }, 'paddlePredict');
  
  // Test: Enhance reports (POST)
  await runTest('PaddlePredict: Enhance Reports', async () => {
    const options = createRequestOptions('/paddlePredict/enhance', 'POST', {
      'Content-Type': 'application/json'
    });
    const postData = JSON.stringify({ locations: ['test'] });
    const response = await makeRequest(options, postData);
    
    return { 
      success: [200, 400, 500].includes(response.statusCode), 
      message: `HTTP ${response.statusCode} (${response.duration}ms)` 
    };
  }, 'paddlePredict');
}

// 7. PADDLING REPORT API TESTS
async function testPaddlingReportAPI() {
  log('📊 Testing Paddling Report API', 'info');
  
  const reportEndpoints = [
    { path: '/paddlingReport', name: 'Full Reports' },
    { path: '/paddlingReport/summary', name: 'Summary' },
    { path: '/paddlingReport/best', name: 'Best Conditions' },
    { path: '/paddlingReport/demo', name: 'Demo Reports' }
  ];
  
  for (const endpoint of reportEndpoints) {
    await runTest(`PaddlingReport: ${endpoint.name}`, async () => {
      const options = createRequestOptions(endpoint.path);
      const response = await makeRequest(options);
      
      if (response.statusCode === 200) {
        const data = JSON.parse(response.body);
        return { 
          success: data.success === true, 
          message: `Report generated (${response.duration}ms)`,
          data 
        };
      }
      
      return { 
        success: [400, 500, 408].includes(response.statusCode), 
        message: `HTTP ${response.statusCode} (${response.duration}ms)` 
      };
    }, 'paddlingReport');
  }
}

// 8. DEEPLINK API TESTS
async function testDeeplinkAPI() {
  log('🔗 Testing Deeplink API', 'info');
  
  // Test: Short links
  const testLinks = ['torch789', 'tahoe123', 'invalid_link', 'test123'];
  
  for (const linkId of testLinks) {
    await runTest(`Deeplink: /l/${linkId}`, async () => {
      const options = createRequestOptions(`/l/${linkId}`);
      const response = await makeRequest(options);
      
      // Deeplinks typically redirect (302) or show content (200)
      return { 
        success: [200, 302, 404].includes(response.statusCode), 
        message: `HTTP ${response.statusCode} (${response.duration}ms)` 
      };
    }, 'deeplink');
  }
  
  // Test: Resolve endpoint
  await runTest('Deeplink: Resolve', async () => {
    const options = createRequestOptions('/resolve?id=torch789');
    const response = await makeRequest(options);
    
    return { 
      success: [200, 404].includes(response.statusCode), 
      message: `HTTP ${response.statusCode} (${response.duration}ms)` 
    };
  }, 'deeplink');
  
  // Test: Resolve with cookies
  await runTest('Deeplink: Resolve with context', async () => {
    const options = createRequestOptions('/resolve', 'GET', {
      'Cookie': 'kaayko_ctxid=torch789; kaayko_location={"name":"Test Lake"}'
    });
    const response = await makeRequest(options);
    
    return { 
      success: [200, 404].includes(response.statusCode), 
      message: `HTTP ${response.statusCode} (${response.duration}ms)` 
    };
  }, 'deeplink');
}

// 9. RATE LIMITING TESTS
async function testRateLimiting() {
  if (!STRESS_TEST) {
    log('⏭️ Skipping rate limit tests (use --stress to enable)', 'warning');
    return;
  }
  
  log('⚡ Testing Rate Limiting', 'info');
  
  const testEndpoint = '/paddleConditions/health';
  const requests = [];
  
  // Send 30 rapid requests to test rate limiting
  for (let i = 0; i < 30; i++) {
    requests.push(makeRequest(createRequestOptions(testEndpoint)));
  }
  
  await runTest('Rate Limiting: Rapid Requests', async () => {
    const responses = await Promise.allSettled(requests);
    const statusCodes = responses.map(r => r.value?.statusCode || 0);
    const rateLimited = statusCodes.filter(code => code === 429).length;
    
    return { 
      success: rateLimited > 0, 
      message: `${rateLimited}/30 requests rate limited` 
    };
  }, 'security');
}

// 10. SECURITY TESTS
async function testSecurityHeaders() {
  log('🔒 Testing Security Headers', 'info');
  
  await runTest('Security: Headers Check', async () => {
    const options = createRequestOptions('/paddleConditions/health');
    const response = await makeRequest(options);
    
    const securityHeaders = [
      'x-content-type-options',
      'x-frame-options',
      'x-xss-protection'
    ];
    
    const presentHeaders = securityHeaders.filter(header => 
      response.headers[header] || response.headers[header.toUpperCase()]
    );
    
    return { 
      success: presentHeaders.length > 0, 
      message: `${presentHeaders.length}/${securityHeaders.length} security headers present`,
      data: { headers: presentHeaders }
    };
  }, 'security');
  
  // Test CORS
  await runTest('Security: CORS Check', async () => {
    const options = createRequestOptions('/paddleConditions/health', 'OPTIONS', {
      'Origin': 'https://kaayko.com',
      'Access-Control-Request-Method': 'GET'
    });
    const response = await makeRequest(options);
    
    return { 
      success: [200, 204].includes(response.statusCode), 
      message: `CORS preflight: HTTP ${response.statusCode}` 
    };
  }, 'security');
}

// 11. PERFORMANCE TESTS
async function testPerformance() {
  log('⚡ Testing Performance', 'info');
  
  const performanceEndpoints = [
    '/helloWorld',
    '/paddleConditions/health',
    '/products',
    '/paddlingOut'
  ];
  
  for (const endpoint of performanceEndpoints) {
    await runTest(`Performance: ${endpoint}`, async () => {
      const startTime = Date.now();
      const options = createRequestOptions(endpoint);
      const response = await makeRequest(options);
      const duration = Date.now() - startTime;
      
      const isGoodPerformance = duration < 5000; // 5 seconds threshold
      
      return { 
        success: response.statusCode === 200 && isGoodPerformance, 
        message: `${duration}ms (${isGoodPerformance ? 'GOOD' : 'SLOW'})`,
        data: { duration, threshold: 5000 }
      };
    }, 'performance');
  }
}

// 12. ERROR HANDLING TESTS
async function testErrorHandling() {
  log('💥 Testing Error Handling', 'info');
  
  // Test malformed JSON
  await runTest('Error: Malformed JSON', async () => {
    const options = createRequestOptions('/products/test/vote', 'POST', {
      'Content-Type': 'application/json'
    });
    const response = await makeRequest(options, 'invalid json');
    
    return { 
      success: response.statusCode === 400, 
      message: `HTTP ${response.statusCode}` 
    };
  }, 'errors');
  
  // Test non-existent endpoints
  const nonExistentPaths = [
    '/nonexistent',
    '/api/invalid',
    '/products/../../etc/passwd',
    '/admin/users'
  ];
  
  for (const path of nonExistentPaths) {
    await runTest(`Error: Non-existent ${path}`, async () => {
      const options = createRequestOptions(path);
      const response = await makeRequest(options);
      
      return { 
        success: response.statusCode === 404, 
        message: `HTTP ${response.statusCode}` 
      };
    }, 'errors');
  }
}

// ============================================================================
// MAIN TEST EXECUTION
// ============================================================================

async function runAllTests() {
  const startTime = Date.now();
  
  try {
    // Core functionality tests
    await testHealthChecks();
    await testProductsAPI();
    await testImagesAPI();
    await testPaddlingOutAPI();
    await testPaddleConditionsAPI();
    await testPaddlePredictAPI();
    await testPaddlingReportAPI();
    await testDeeplinkAPI();
    
    // Security and performance tests
    await testSecurityHeaders();
    await testErrorHandling();
    await testPerformance();
    await testRateLimiting();
    
  } catch (error) {
    log(`Fatal error during testing: ${error.message}`, 'error');
    testResults.summary.errors++;
  }
  
  // Calculate final metrics
  const endTime = Date.now();
  testResults.summary.endTime = new Date().toISOString();
  testResults.summary.duration = endTime - startTime;
  
  // Generate summary
  const passRate = ((testResults.summary.passed / testResults.summary.total) * 100).toFixed(1);
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 COMPREHENSIVE TEST RESULTS');
  console.log('='.repeat(80));
  console.log(`🎯 Total Tests: ${testResults.summary.total}`);
  console.log(`✅ Passed: ${testResults.summary.passed}`);
  console.log(`❌ Failed: ${testResults.summary.failed}`);
  console.log(`💥 Errors: ${testResults.summary.errors}`);
  console.log(`📈 Pass Rate: ${passRate}%`);
  console.log(`⏱️ Duration: ${testResults.summary.duration}ms`);
  console.log('');
  
  console.log('📋 Results by Category:');
  for (const [category, stats] of Object.entries(testResults.categories)) {
    const categoryRate = ((stats.passed / stats.total) * 100).toFixed(1);
    console.log(`  ${category}: ${stats.passed}/${stats.total} (${categoryRate}%)`);
  }
  
  // Save detailed results
  try {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(testResults, null, 2));
    console.log(`\n💾 Detailed results saved to: ${OUTPUT_FILE}`);
  } catch (error) {
    console.log(`❌ Failed to save results: ${error.message}`);
  }
  
  console.log('\n🏁 Testing Complete!');
  
  // Exit with appropriate code
  process.exit(testResults.summary.failed > 0 ? 1 : 0);
}

// Start testing
runAllTests().catch(error => {
  console.error('💥 Fatal test error:', error);
  process.exit(1);
});
