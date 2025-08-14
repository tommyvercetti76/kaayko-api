#!/usr/bin/env node
/**
 * Edge Case & Stress Test Suite for Kaayko APIs
 * 
 * This specialized test suite focuses on:
 * - Boundary conditions and edge cases
 * - Stress testing with high loads
 * - Memory and performance analysis
 * - Concurrent request handling
 * - Timeout and resilience testing
 * 
 * Usage: node edge_case_tests.js [--concurrent=N] [--duration=Ms] [--memory]
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const BASE_URL = process.env.BASE_URL || 'https://api-vwcc5j4qda-uc.a.run.app';
const CONCURRENT_REQUESTS = parseInt(process.argv.find(arg => arg.startsWith('--concurrent='))?.split('=')[1]) || 10;
const TEST_DURATION = parseInt(process.argv.find(arg => arg.startsWith('--duration='))?.split('=')[1]) || 30000;
const MEMORY_MONITORING = process.argv.includes('--memory');

console.log(`🚀 Edge Case & Stress Test Suite`);
console.log(`🎯 Target: ${BASE_URL}`);
console.log(`⚡ Concurrent Requests: ${CONCURRENT_REQUESTS}`);
console.log(`⏱️ Test Duration: ${TEST_DURATION}ms`);
console.log(`🧠 Memory Monitoring: ${MEMORY_MONITORING ? 'ON' : 'OFF'}`);
console.log('=' .repeat(80));

// Test tracking
const results = {
  edgeCases: [],
  stressTests: [],
  memorySnapshots: [],
  startTime: new Date().toISOString(),
  endTime: null
};

// Utility functions
function log(message, level = 'info') {
  const symbols = { info: '📋', success: '✅', error: '❌', warning: '⚠️' };
  console.log(`${symbols[level] || '📋'} ${message}`);
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
        'User-Agent': 'Kaayko-EdgeTest/1.0',
        ...options.headers
      },
      timeout: options.timeout || 30000
    };
    
    const startTime = Date.now();
    
    // Log pretty-printed request details if stress testing enabled
    if (ENABLE_STRESS_TESTING) {
      console.log('\n💥 EDGE CASE REQUEST:');
      console.log(JSON.stringify({
        method: requestOptions.method,
        url: url,
        headers: requestOptions.headers,
        body: options.body || null
      }, null, 2));
    }
    
    const req = protocol.request(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const responseData = {
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          duration: Date.now() - startTime,
          url
        };
        
        // Log pretty-printed response details if stress testing enabled
        if (ENABLE_STRESS_TESTING) {
          console.log('\n🔬 EDGE CASE RESPONSE:');
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
            duration: `${responseData.duration}ms`
          }, null, 2));
          console.log('💥' + '─'.repeat(79));
        }
        
        resolve(responseData);
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

function getMemoryUsage() {
  return process.memoryUsage();
}

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

async function testBoundaryValues() {
  log('🔬 Testing Boundary Values', 'info');
  
  const boundaryTests = [
    // Coordinate boundaries
    { name: 'Max Latitude', url: `${BASE_URL}/paddleConditions?lat=90&lng=0` },
    { name: 'Min Latitude', url: `${BASE_URL}/paddleConditions?lat=-90&lng=0` },
    { name: 'Max Longitude', url: `${BASE_URL}/paddleConditions?lat=0&lng=180` },
    { name: 'Min Longitude', url: `${BASE_URL}/paddleConditions?lat=0&lng=-180` },
    { name: 'Beyond Max Latitude', url: `${BASE_URL}/paddleConditions?lat=91&lng=0` },
    { name: 'Beyond Min Latitude', url: `${BASE_URL}/paddleConditions?lat=-91&lng=0` },
    { name: 'Beyond Max Longitude', url: `${BASE_URL}/paddleConditions?lat=0&lng=181` },
    { name: 'Beyond Min Longitude', url: `${BASE_URL}/paddleConditions?lat=0&lng=-181` },
    
    // Precision edge cases
    { name: 'High Precision Coords', url: `${BASE_URL}/paddleConditions?lat=39.0968123456789&lng=-120.0324987654321` },
    { name: 'Zero Coordinates', url: `${BASE_URL}/paddleConditions?lat=0&lng=0` },
    
    // Extreme string lengths
    { name: 'Very Long Location', url: `${BASE_URL}/paddleConditions?location=${'A'.repeat(1000)}` },
    { name: 'Empty Location', url: `${BASE_URL}/paddleConditions?location=` },
    
    // Product ID edge cases
    { name: 'Very Long Product ID', url: `${BASE_URL}/products/${'x'.repeat(1000)}` },
    { name: 'Special Chars in Product ID', url: `${BASE_URL}/products/${encodeURIComponent('test@#$%^&*()[]{}|\\:";\'<>?,./`~')}` },
    
    // Unicode and special characters
    { name: 'Unicode Location', url: `${BASE_URL}/paddleConditions?location=${encodeURIComponent('北京市')}` },
    { name: 'Emoji in Location', url: `${BASE_URL}/paddleConditions?location=${encodeURIComponent('🏔️ Mountain Lake 🏞️')}` },
  ];
  
  for (const test of boundaryTests) {
    try {
      const response = await makeRequest(test.url);
      results.edgeCases.push({
        test: test.name,
        status: response.statusCode,
        duration: response.duration,
        success: [200, 400, 404].includes(response.statusCode), // Expected responses
        details: test.url
      });
      
      log(`${test.name}: HTTP ${response.statusCode} (${response.duration}ms)`, 
          [200, 400, 404].includes(response.statusCode) ? 'success' : 'warning');
    } catch (error) {
      results.edgeCases.push({
        test: test.name,
        status: 'ERROR',
        duration: 0,
        success: false,
        error: error.message
      });
      log(`${test.name}: ERROR - ${error.message}`, 'error');
    }
  }
}

async function testSpecialCharacters() {
  log('🔤 Testing Special Characters', 'info');
  
  const specialChars = [
    '%00', // Null byte
    '%0A', // Newline
    '%0D', // Carriage return
    '%09', // Tab
    '%20', // Space
    '%2E%2E%2F', // ../
    '%2F%2E%2E%2F', // /../
    '%5C', // Backslash
    '%22', // Quote
    '%27', // Single quote
    '%3C%3E', // <>
    '%7B%7D', // {}
    'SELECT%20*%20FROM%20users', // SQL injection attempt
    '%3Cscript%3Ealert%281%29%3C%2Fscript%3E', // XSS attempt
  ];
  
  for (const char of specialChars) {
    try {
      const response = await makeRequest(`${BASE_URL}/products/${char}`);
      results.edgeCases.push({
        test: `Special Char: ${char}`,
        status: response.statusCode,
        duration: response.duration,
        success: [400, 404].includes(response.statusCode), // Should reject or not find
        details: char
      });
      
      log(`Special Char ${char}: HTTP ${response.statusCode}`, 
          [400, 404].includes(response.statusCode) ? 'success' : 'warning');
    } catch (error) {
      log(`Special Char ${char}: ERROR - ${error.message}`, 'error');
    }
  }
}

async function testMalformedRequests() {
  log('🚫 Testing Malformed Requests', 'info');
  
  const malformedTests = [
    {
      name: 'Invalid JSON Body',
      url: `${BASE_URL}/products/test/vote`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"invalid": json}'
      }
    },
    {
      name: 'Missing Content-Type',
      url: `${BASE_URL}/products/test/vote`,
      options: {
        method: 'POST',
        body: '{"voteChange": 1}'
      }
    },
    {
      name: 'Wrong Content-Type',
      url: `${BASE_URL}/products/test/vote`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{"voteChange": 1}'
      }
    },
    {
      name: 'Empty Body with POST',
      url: `${BASE_URL}/products/test/vote`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: ''
      }
    },
    {
      name: 'Large JSON Body',
      url: `${BASE_URL}/paddlePredict/enhance`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locations: new Array(10000).fill('test') })
      }
    }
  ];
  
  for (const test of malformedTests) {
    try {
      const response = await makeRequest(test.url, test.options);
      results.edgeCases.push({
        test: test.name,
        status: response.statusCode,
        duration: response.duration,
        success: response.statusCode === 400, // Should return 400 Bad Request
        details: test.url
      });
      
      log(`${test.name}: HTTP ${response.statusCode}`, 
          response.statusCode === 400 ? 'success' : 'warning');
    } catch (error) {
      log(`${test.name}: ERROR - ${error.message}`, 'error');
    }
  }
}

// ============================================================================
// STRESS TESTS
// ============================================================================

async function concurrentRequestTest() {
  log(`⚡ Concurrent Request Test (${CONCURRENT_REQUESTS} requests)`, 'info');
  
  const testUrls = [
    `${BASE_URL}/helloWorld`,
    `${BASE_URL}/paddleConditions/health`,
    `${BASE_URL}/products`,
    `${BASE_URL}/paddlingOut`,
    `${BASE_URL}/paddlePredict/health`
  ];
  
  const startTime = Date.now();
  const promises = [];
  
  for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
    const url = testUrls[i % testUrls.length];
    promises.push(makeRequest(url).catch(error => ({ error: error.message, url })));
  }
  
  const responses = await Promise.all(promises);
  const endTime = Date.now();
  
  const successful = responses.filter(r => r.statusCode && r.statusCode < 400).length;
  const errors = responses.filter(r => r.error).length;
  const rateLimited = responses.filter(r => r.statusCode === 429).length;
  
  results.stressTests.push({
    test: 'Concurrent Requests',
    concurrent: CONCURRENT_REQUESTS,
    successful,
    errors,
    rateLimited,
    totalTime: endTime - startTime,
    avgResponseTime: responses
      .filter(r => r.duration)
      .reduce((sum, r) => sum + r.duration, 0) / responses.filter(r => r.duration).length
  });
  
  log(`Concurrent Test Results:`, 'info');
  log(`  Successful: ${successful}/${CONCURRENT_REQUESTS}`, 'success');
  log(`  Errors: ${errors}`, errors > 0 ? 'warning' : 'success');
  log(`  Rate Limited: ${rateLimited}`, 'info');
  log(`  Total Time: ${endTime - startTime}ms`, 'info');
}

async function sustainedLoadTest() {
  log(`🔄 Sustained Load Test (${TEST_DURATION}ms)`, 'info');
  
  const startTime = Date.now();
  const requests = [];
  let requestCount = 0;
  
  const testUrl = `${BASE_URL}/paddleConditions/health`;
  
  // Send requests continuously for the test duration
  while (Date.now() - startTime < TEST_DURATION) {
    const requestPromise = makeRequest(testUrl)
      .then(response => ({ success: true, ...response }))
      .catch(error => ({ success: false, error: error.message }));
    
    requests.push(requestPromise);
    requestCount++;
    
    // Small delay to prevent overwhelming the client
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  log(`Waiting for ${requestCount} requests to complete...`, 'info');
  const responses = await Promise.all(requests);
  const endTime = Date.now();
  
  const successful = responses.filter(r => r.success && r.statusCode < 400).length;
  const errors = responses.filter(r => !r.success || r.statusCode >= 500).length;
  const rateLimited = responses.filter(r => r.statusCode === 429).length;
  
  results.stressTests.push({
    test: 'Sustained Load',
    duration: endTime - startTime,
    totalRequests: requestCount,
    requestsPerSecond: requestCount / ((endTime - startTime) / 1000),
    successful,
    errors,
    rateLimited
  });
  
  log(`Sustained Load Results:`, 'info');
  log(`  Total Requests: ${requestCount}`, 'info');
  log(`  Requests/Second: ${(requestCount / ((endTime - startTime) / 1000)).toFixed(2)}`, 'info');
  log(`  Successful: ${successful}`, 'success');
  log(`  Errors: ${errors}`, errors > 0 ? 'warning' : 'success');
  log(`  Rate Limited: ${rateLimited}`, 'info');
}

async function memoryStressTest() {
  if (!MEMORY_MONITORING) {
    log('🧠 Memory monitoring disabled', 'info');
    return;
  }
  
  log('🧠 Memory Stress Test', 'info');
  
  const initialMemory = getMemoryUsage();
  results.memorySnapshots.push({ phase: 'initial', ...initialMemory });
  
  // Create large requests to test memory handling
  const largeRequests = [];
  for (let i = 0; i < 100; i++) {
    const largeData = 'x'.repeat(10000); // 10KB strings
    largeRequests.push(
      makeRequest(`${BASE_URL}/paddleConditions?location=${encodeURIComponent(largeData)}`)
        .catch(error => ({ error: error.message }))
    );
  }
  
  await Promise.all(largeRequests);
  
  const afterMemory = getMemoryUsage();
  results.memorySnapshots.push({ phase: 'after_stress', ...afterMemory });
  
  // Force garbage collection if possible
  if (global.gc) {
    global.gc();
    const afterGCMemory = getMemoryUsage();
    results.memorySnapshots.push({ phase: 'after_gc', ...afterGCMemory });
  }
  
  log(`Memory Usage:`, 'info');
  log(`  Initial: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`, 'info');
  log(`  After Stress: ${(afterMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`, 'info');
  log(`  Difference: ${((afterMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024).toFixed(2)} MB`, 'info');
}

// ============================================================================
// TIMEOUT AND RESILIENCE TESTS
// ============================================================================

async function timeoutTests() {
  log('⏰ Testing Timeout Handling', 'info');
  
  const timeoutTests = [
    {
      name: 'Short Timeout',
      url: `${BASE_URL}/paddlingReport`,
      timeout: 1000 // 1 second
    },
    {
      name: 'Very Short Timeout',
      url: `${BASE_URL}/paddlePredict?lat=39.0968&lng=-120.0324`,
      timeout: 100 // 100ms
    }
  ];
  
  for (const test of timeoutTests) {
    try {
      const response = await makeRequest(test.url, { timeout: test.timeout });
      log(`${test.name}: Completed in ${response.duration}ms`, 'success');
    } catch (error) {
      if (error.message.includes('timeout')) {
        log(`${test.name}: Timeout as expected`, 'success');
      } else {
        log(`${test.name}: Unexpected error - ${error.message}`, 'warning');
      }
    }
  }
}

async function connectionErrorTests() {
  log('🔌 Testing Connection Error Handling', 'info');
  
  // Test with invalid hostname
  try {
    await makeRequest('https://invalid-hostname-12345.com/test');
    log('Invalid hostname: Unexpected success', 'warning');
  } catch (error) {
    log('Invalid hostname: Failed as expected', 'success');
  }
  
  // Test with invalid port
  try {
    await makeRequest('https://api-vwcc5j4qda-uc.a.run.app:9999/test');
    log('Invalid port: Unexpected success', 'warning');
  } catch (error) {
    log('Invalid port: Failed as expected', 'success');
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function runAllEdgeTests() {
  const startTime = Date.now();
  
  try {
    // Edge case tests
    await testBoundaryValues();
    await testSpecialCharacters();
    await testMalformedRequests();
    
    // Stress tests
    await concurrentRequestTest();
    await sustainedLoadTest();
    await memoryStressTest();
    
    // Resilience tests
    await timeoutTests();
    await connectionErrorTests();
    
  } catch (error) {
    log(`Fatal error during testing: ${error.message}`, 'error');
  }
  
  results.endTime = new Date().toISOString();
  results.totalDuration = Date.now() - startTime;
  
  // Generate summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 EDGE CASE & STRESS TEST RESULTS');
  console.log('='.repeat(80));
  
  console.log(`🔬 Edge Cases: ${results.edgeCases.length} tests`);
  const edgeSuccesses = results.edgeCases.filter(t => t.success).length;
  console.log(`  ✅ Successful: ${edgeSuccesses}/${results.edgeCases.length}`);
  
  console.log(`⚡ Stress Tests: ${results.stressTests.length} tests`);
  results.stressTests.forEach(test => {
    console.log(`  ${test.test}:`);
    if (test.concurrent) {
      console.log(`    Concurrent: ${test.successful}/${test.concurrent} successful`);
    }
    if (test.requestsPerSecond) {
      console.log(`    Rate: ${test.requestsPerSecond.toFixed(2)} req/sec`);
    }
  });
  
  if (results.memorySnapshots.length > 0) {
    console.log(`🧠 Memory Snapshots: ${results.memorySnapshots.length}`);
    results.memorySnapshots.forEach(snap => {
      console.log(`  ${snap.phase}: ${(snap.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    });
  }
  
  console.log(`⏱️ Total Duration: ${results.totalDuration}ms`);
  
  // Save results
  const outputFile = path.join(__dirname, 'edge_case_results.json');
  try {
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
    console.log(`\n💾 Results saved to: ${outputFile}`);
  } catch (error) {
    console.log(`❌ Failed to save results: ${error.message}`);
  }
  
  console.log('\n🏁 Edge Case Testing Complete!');
}

// Start testing
runAllEdgeTests().catch(error => {
  console.error('💥 Fatal test error:', error);
  process.exit(1);
});
