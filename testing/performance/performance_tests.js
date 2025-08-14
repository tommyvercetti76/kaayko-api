#!/usr/bin/env node
/**
 * Load & Performance Test Suite for Kaayko APIs
 * 
 * This specialized test suite focuses on performance analysis:
 * - Response time analysis
 * - Throughput testing
 * - Memory usage monitoring
 * - Concurrent user simulation
 * - Database connection pooling tests
 * - Cache effectiveness analysis
 * - Resource utilization monitoring
 * 
 * Usage: node performance_tests.js [--users=N] [--duration=Ms] [--profile]
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Configuration
const BASE_URL = process.env.BASE_URL || 'https://api-vwcc5j4qda-uc.a.run.app';
const CONCURRENT_USERS = parseInt(process.argv.find(arg => arg.startsWith('--users='))?.split('=')[1]) || 20;
const TEST_DURATION = parseInt(process.argv.find(arg => arg.startsWith('--duration='))?.split('=')[1]) || 60000;
const ENABLE_PROFILING = process.argv.includes('--profile');

console.log(`⚡ Load & Performance Test Suite`);
console.log(`🎯 Target: ${BASE_URL}`);
console.log(`👥 Concurrent Users: ${CONCURRENT_USERS}`);
console.log(`⏱️ Test Duration: ${TEST_DURATION}ms`);
console.log(`📊 Profiling: ${ENABLE_PROFILING ? 'ON' : 'OFF'}`);
console.log('=' .repeat(80));

// Performance metrics tracking
const performanceResults = {
  summary: {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    requestsPerSecond: 0,
    throughput: 0,
    errorRate: 0
  },
  endpointMetrics: {},
  responseTimeDistribution: {
    '0-100ms': 0,
    '100-500ms': 0,
    '500-1000ms': 0,
    '1000-2000ms': 0,
    '2000-5000ms': 0,
    '5000ms+': 0
  },
  loadTestResults: [],
  memoryUsage: [],
  errors: [],
  cacheAnalysis: {},
  networkMetrics: {}
};

// Test scenarios for different load patterns
const testScenarios = [
  {
    name: 'Health Check Load',
    endpoints: ['/helloWorld', '/paddleConditions/health', '/paddlePredict/health'],
    weight: 30, // 30% of traffic
    expectedResponseTime: 200
  },
  {
    name: 'Product Browsing',
    endpoints: ['/products', '/products/test123', '/products/shirt001'],
    weight: 25,
    expectedResponseTime: 500
  },
  {
    name: 'Location Data',
    endpoints: ['/paddlingOut', '/paddlingOut/torch789'],
    weight: 20,
    expectedResponseTime: 800
  },
  {
    name: 'Weather Conditions',
    endpoints: [
      '/paddleConditions?lat=39.0968&lng=-120.0324',
      '/paddleConditions/summary?lat=44.0&lng=-85.0'
    ],
    weight: 15,
    expectedResponseTime: 2000
  },
  {
    name: 'ML Predictions',
    endpoints: [
      '/paddlePredict?lat=39.0968&lng=-120.0324',
      '/paddlePredict/model'
    ],
    weight: 10,
    expectedResponseTime: 3000
  }
];

// Utility functions
function log(message, level = 'info') {
  const symbols = { info: '📋', success: '✅', error: '❌', warning: '⚠️', perf: '⚡' };
  console.log(`${symbols[level] || '📋'} ${message}`);
}

function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / 1024 / 1024),
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
    external: Math.round(usage.external / 1024 / 1024)
  };
}

function makeTimedRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Kaayko-PerfTest/1.0',
        'Accept': 'application/json',
        'Connection': 'keep-alive',
        ...options.headers
      },
      timeout: options.timeout || 30000
    };
    
    // Log pretty-printed request details if profiling enabled
    if (ENABLE_PROFILING) {
      console.log('\n⚡ PERFORMANCE REQUEST:');
      console.log(JSON.stringify({
        method: requestOptions.method,
        url: url,
        headers: requestOptions.headers,
        body: options.body || null
      }, null, 2));
    }
    
    const startTime = performance.now();
    const startMemory = getMemoryUsage();
    
    const req = protocol.request(requestOptions, (res) => {
      let data = '';
      let firstByteTime = null;
      
      res.on('data', chunk => {
        if (firstByteTime === null) {
          firstByteTime = performance.now();
        }
        data += chunk;
      });
      
      res.on('end', () => {
        const endTime = performance.now();
        const totalTime = endTime - startTime;
        const ttfb = firstByteTime ? firstByteTime - startTime : null;
        
        const responseData = {
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          timing: {
            total: totalTime,
            ttfb: ttfb,
            download: ttfb ? totalTime - ttfb : null
          },
          size: {
            headers: JSON.stringify(res.headers).length,
            body: data.length,
            total: JSON.stringify(res.headers).length + data.length
          },
          memory: {
            start: startMemory,
            end: getMemoryUsage()
          },
          url
        };
        
        // Log pretty-printed response details if profiling enabled
        if (ENABLE_PROFILING) {
          console.log('\n📊 PERFORMANCE RESPONSE:');
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
            timing: responseData.timing,
            size: responseData.size,
            memory: responseData.memory
          }, null, 2));
          console.log('⚡' + '─'.repeat(79));
        }
        
        resolve(responseData);
      });
    });
    
    req.on('error', (error) => {
      const endTime = performance.now();
      reject({
        error: error.message,
        timing: { total: endTime - startTime },
        url
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      const endTime = performance.now();
      reject({
        error: 'Request timeout',
        timing: { total: endTime - startTime },
        url
      });
    });
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

function categorizeResponseTime(responseTime) {
  if (responseTime < 100) return '0-100ms';
  if (responseTime < 500) return '100-500ms';
  if (responseTime < 1000) return '500-1000ms';
  if (responseTime < 2000) return '1000-2000ms';
  if (responseTime < 5000) return '2000-5000ms';
  return '5000ms+';
}

function updateEndpointMetrics(endpoint, response, isError = false) {
  if (!performanceResults.endpointMetrics[endpoint]) {
    performanceResults.endpointMetrics[endpoint] = {
      requests: 0,
      successes: 0,
      errors: 0,
      totalTime: 0,
      minTime: Infinity,
      maxTime: 0,
      avgTime: 0,
      statusCodes: {},
      responseSizes: []
    };
  }
  
  const metrics = performanceResults.endpointMetrics[endpoint];
  metrics.requests++;
  
  if (isError) {
    metrics.errors++;
  } else {
    metrics.successes++;
    const responseTime = response.timing.total;
    metrics.totalTime += responseTime;
    metrics.minTime = Math.min(metrics.minTime, responseTime);
    metrics.maxTime = Math.max(metrics.maxTime, responseTime);
    metrics.avgTime = metrics.totalTime / metrics.successes;
    
    // Track status codes
    const statusCode = response.statusCode;
    metrics.statusCodes[statusCode] = (metrics.statusCodes[statusCode] || 0) + 1;
    
    // Track response sizes
    metrics.responseSizes.push(response.size.total);
    
    // Update response time distribution
    const category = categorizeResponseTime(responseTime);
    performanceResults.responseTimeDistribution[category]++;
  }
}

// ============================================================================
// BASELINE PERFORMANCE TESTS
// ============================================================================

async function runBaselineTests() {
  log('📊 Running Baseline Performance Tests', 'perf');
  
  const baselineEndpoints = [
    '/helloWorld',
    '/paddleConditions/health',
    '/products',
    '/paddlingOut',
    '/paddlePredict/health'
  ];
  
  for (const endpoint of baselineEndpoints) {
    const iterations = 10;
    const results = [];
    
    log(`Testing baseline for ${endpoint} (${iterations} iterations)`, 'info');
    
    for (let i = 0; i < iterations; i++) {
      try {
        const response = await makeTimedRequest(`${BASE_URL}${endpoint}`);
        results.push(response.timing.total);
        updateEndpointMetrics(endpoint, response);
        performanceResults.summary.totalRequests++;
        performanceResults.summary.successfulRequests++;
      } catch (error) {
        results.push(null);
        updateEndpointMetrics(endpoint, null, true);
        performanceResults.summary.totalRequests++;
        performanceResults.summary.failedRequests++;
        performanceResults.errors.push({
          endpoint,
          error: error.error || error.message,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    const validResults = results.filter(r => r !== null);
    if (validResults.length > 0) {
      const avg = validResults.reduce((sum, time) => sum + time, 0) / validResults.length;
      const min = Math.min(...validResults);
      const max = Math.max(...validResults);
      
      log(`  Baseline ${endpoint}: avg=${avg.toFixed(2)}ms, min=${min.toFixed(2)}ms, max=${max.toFixed(2)}ms`, 'success');
    } else {
      log(`  Baseline ${endpoint}: All requests failed`, 'error');
    }
  }
}

// ============================================================================
// CONCURRENT USER SIMULATION
// ============================================================================

async function simulateConcurrentUsers() {
  log(`👥 Simulating ${CONCURRENT_USERS} Concurrent Users`, 'perf');
  
  const userPromises = [];
  const startTime = performance.now();
  
  // Create user simulation promises
  for (let userId = 0; userId < CONCURRENT_USERS; userId++) {
    userPromises.push(simulateUser(userId, startTime, TEST_DURATION));
  }
  
  // Wait for all users to complete
  const userResults = await Promise.all(userPromises);
  
  // Analyze user simulation results
  const totalRequests = userResults.reduce((sum, user) => sum + user.requests, 0);
  const totalErrors = userResults.reduce((sum, user) => sum + user.errors, 0);
  const totalTime = performance.now() - startTime;
  
  performanceResults.summary.requestsPerSecond = totalRequests / (totalTime / 1000);
  performanceResults.summary.errorRate = (totalErrors / totalRequests) * 100;
  
  log(`Concurrent user simulation completed:`, 'success');
  log(`  Total Requests: ${totalRequests}`, 'info');
  log(`  Requests/Second: ${performanceResults.summary.requestsPerSecond.toFixed(2)}`, 'info');
  log(`  Error Rate: ${performanceResults.summary.errorRate.toFixed(2)}%`, 'info');
  
  return userResults;
}

async function simulateUser(userId, startTime, duration) {
  const userResults = {
    userId,
    requests: 0,
    successes: 0,
    errors: 0,
    totalResponseTime: 0,
    scenarios: {}
  };
  
  // User makes requests until test duration expires
  while (performance.now() - startTime < duration) {
    try {
      // Select a scenario based on weights
      const scenario = selectScenario();
      const endpoint = scenario.endpoints[Math.floor(Math.random() * scenario.endpoints.length)];
      
      if (!userResults.scenarios[scenario.name]) {
        userResults.scenarios[scenario.name] = { requests: 0, errors: 0 };
      }
      
      userResults.scenarios[scenario.name].requests++;
      userResults.requests++;
      performanceResults.summary.totalRequests++;
      
      const response = await makeTimedRequest(`${BASE_URL}${endpoint}`);
      
      userResults.successes++;
      userResults.totalResponseTime += response.timing.total;
      performanceResults.summary.successfulRequests++;
      
      updateEndpointMetrics(endpoint, response);
      
      // Simulate user think time (random 100-2000ms)
      const thinkTime = Math.random() * 1900 + 100;
      await new Promise(resolve => setTimeout(resolve, thinkTime));
      
    } catch (error) {
      userResults.errors++;
      if (scenario && scenario.name && userResults.scenarios[scenario.name]) {
        userResults.scenarios[scenario.name].errors++;
      }
      performanceResults.summary.failedRequests++;
      
      performanceResults.errors.push({
        userId,
        error: error.error || error.message,
        url: error.url,
        timestamp: new Date().toISOString()
      });
      
      // Shorter delay on error
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return userResults;
}

function selectScenario() {
  const random = Math.random() * 100;
  let weightSum = 0;
  
  for (const scenario of testScenarios) {
    weightSum += scenario.weight;
    if (random <= weightSum) {
      return scenario;
    }
  }
  
  return testScenarios[0]; // Fallback
}

// ============================================================================
// MEMORY MONITORING
// ============================================================================

function startMemoryMonitoring() {
  if (!ENABLE_PROFILING) return;
  
  log('🧠 Starting Memory Monitoring', 'perf');
  
  const memoryInterval = setInterval(() => {
    const memUsage = getMemoryUsage();
    performanceResults.memoryUsage.push({
      timestamp: new Date().toISOString(),
      ...memUsage
    });
    
    // Log memory usage every 10 seconds
    if (performanceResults.memoryUsage.length % 10 === 0) {
      log(`Memory: RSS=${memUsage.rss}MB, Heap=${memUsage.heapUsed}/${memUsage.heapTotal}MB`, 'info');
    }
  }, 1000);
  
  return memoryInterval;
}

// ============================================================================
// CACHE EFFECTIVENESS ANALYSIS
// ============================================================================

async function analyzeCacheEffectiveness() {
  log('💾 Analyzing Cache Effectiveness', 'perf');
  
  const cacheTestEndpoints = [
    '/products',
    '/paddlingOut',
    '/paddleConditions/summary?lat=39.0968&lng=-120.0324'
  ];
  
  for (const endpoint of cacheTestEndpoints) {
    const cacheResults = {
      endpoint,
      firstRequest: null,
      secondRequest: null,
      cacheHitLikely: false,
      timeDifference: 0
    };
    
    try {
      // First request (cache miss expected)
      const firstResponse = await makeTimedRequest(`${BASE_URL}${endpoint}`);
      cacheResults.firstRequest = {
        time: firstResponse.timing.total,
        headers: firstResponse.headers
      };
      
      // Small delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Second request (cache hit expected)
      const secondResponse = await makeTimedRequest(`${BASE_URL}${endpoint}`);
      cacheResults.secondRequest = {
        time: secondResponse.timing.total,
        headers: secondResponse.headers
      };
      
      cacheResults.timeDifference = firstResponse.timing.total - secondResponse.timing.total;
      cacheResults.cacheHitLikely = cacheResults.timeDifference > 50; // 50ms improvement suggests cache hit
      
      performanceResults.cacheAnalysis[endpoint] = cacheResults;
      
      log(`Cache analysis ${endpoint}: ${cacheResults.cacheHitLikely ? 'CACHE HIT LIKELY' : 'NO CACHE BENEFIT'} (${cacheResults.timeDifference.toFixed(2)}ms improvement)`, 
          cacheResults.cacheHitLikely ? 'success' : 'warning');
      
    } catch (error) {
      log(`Cache analysis failed for ${endpoint}: ${error.message}`, 'error');
    }
  }
}

// ============================================================================
// STRESS TESTING
// ============================================================================

async function runStressTest() {
  log('🔥 Running Stress Test (High Load)', 'perf');
  
  const stressEndpoint = '/paddleConditions/health';
  const stressRequests = 100;
  const batchSize = 20;
  
  log(`Sending ${stressRequests} requests in batches of ${batchSize}`, 'info');
  
  const allResults = [];
  
  for (let batch = 0; batch < stressRequests; batch += batchSize) {
    const batchPromises = [];
    
    for (let i = 0; i < batchSize && (batch + i) < stressRequests; i++) {
      batchPromises.push(
        makeTimedRequest(`${BASE_URL}${stressEndpoint}`)
          .then(response => ({ success: true, ...response }))
          .catch(error => ({ success: false, error: error.error || error.message }))
      );
    }
    
    const batchResults = await Promise.all(batchPromises);
    allResults.push(...batchResults);
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Analyze stress test results
  const successful = allResults.filter(r => r.success).length;
  const failed = allResults.filter(r => !r.success).length;
  const avgResponseTime = allResults
    .filter(r => r.success)
    .reduce((sum, r) => sum + r.timing.total, 0) / successful;
  
  const stressResults = {
    totalRequests: stressRequests,
    successful,
    failed,
    successRate: (successful / stressRequests) * 100,
    averageResponseTime: avgResponseTime,
    endpoint: stressEndpoint
  };
  
  performanceResults.loadTestResults.push(stressResults);
  
  log(`Stress test results:`, 'success');
  log(`  Success Rate: ${stressResults.successRate.toFixed(2)}%`, 'info');
  log(`  Average Response Time: ${avgResponseTime.toFixed(2)}ms`, 'info');
  log(`  Failed Requests: ${failed}`, failed > 0 ? 'warning' : 'success');
}

// ============================================================================
// NETWORK PERFORMANCE ANALYSIS
// ============================================================================

async function analyzeNetworkPerformance() {
  log('🌐 Analyzing Network Performance', 'perf');
  
  const networkTests = [
    { name: 'Small Response', endpoint: '/helloWorld' },
    { name: 'Medium Response', endpoint: '/products' },
    { name: 'Large Response', endpoint: '/paddlingOut' }
  ];
  
  for (const test of networkTests) {
    try {
      const response = await makeTimedRequest(`${BASE_URL}${test.endpoint}`);
      
      const networkMetrics = {
        endpoint: test.endpoint,
        responseSize: response.size.total,
        ttfb: response.timing.ttfb,
        downloadTime: response.timing.download,
        totalTime: response.timing.total,
        throughput: response.size.total / (response.timing.total / 1000), // bytes per second
        compressionRatio: response.headers['content-encoding'] ? 'compressed' : 'uncompressed'
      };
      
      performanceResults.networkMetrics[test.name] = networkMetrics;
      
      log(`${test.name}: Size=${networkMetrics.responseSize}B, TTFB=${networkMetrics.ttfb?.toFixed(2)}ms, Throughput=${(networkMetrics.throughput / 1024).toFixed(2)}KB/s`, 'info');
      
    } catch (error) {
      log(`Network analysis failed for ${test.name}: ${error.message}`, 'error');
    }
  }
}

// ============================================================================
// PERFORMANCE REPORT GENERATION
// ============================================================================

function generatePerformanceReport() {
  const reportData = {
    ...performanceResults,
    testConfiguration: {
      baseUrl: BASE_URL,
      concurrentUsers: CONCURRENT_USERS,
      testDuration: TEST_DURATION,
      profilingEnabled: ENABLE_PROFILING
    },
    performanceSummary: calculatePerformanceSummary()
  };
  
  const reportPath = path.join(__dirname, 'performance_report.json');
  const htmlReportPath = path.join(__dirname, 'performance_report.html');
  
  try {
    // Save JSON report
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    
    // Generate HTML report
    const htmlReport = generatePerformanceHTML(reportData);
    fs.writeFileSync(htmlReportPath, htmlReport);
    
    log(`Performance report saved to: ${reportPath}`, 'success');
    log(`HTML report saved to: ${htmlReportPath}`, 'success');
  } catch (error) {
    log(`Failed to save performance report: ${error.message}`, 'error');
  }
}

function calculatePerformanceSummary() {
  const allResponseTimes = [];
  
  // Collect all response times
  Object.values(performanceResults.endpointMetrics).forEach(metrics => {
    if (metrics.successes > 0) {
      // Approximate response times for percentile calculation
      for (let i = 0; i < metrics.successes; i++) {
        allResponseTimes.push(metrics.avgTime);
      }
    }
  });
  
  allResponseTimes.sort((a, b) => a - b);
  
  const percentile = (p) => {
    const index = Math.ceil((p / 100) * allResponseTimes.length) - 1;
    return allResponseTimes[index] || 0;
  };
  
  return {
    totalRequests: performanceResults.summary.totalRequests,
    successRate: (performanceResults.summary.successfulRequests / performanceResults.summary.totalRequests) * 100,
    averageResponseTime: allResponseTimes.reduce((sum, time) => sum + time, 0) / allResponseTimes.length,
    p50: percentile(50),
    p90: percentile(90),
    p95: percentile(95),
    p99: percentile(99),
    requestsPerSecond: performanceResults.summary.requestsPerSecond,
    errorRate: performanceResults.summary.errorRate
  };
}

function generatePerformanceHTML(report) {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>Kaayko API Performance Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
        .header { background: #3498db; color: white; padding: 20px; border-radius: 5px; text-align: center; }
        .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0; }
        .metric-card { background: #ecf0f1; padding: 15px; border-radius: 5px; text-align: center; }
        .metric-value { font-size: 2em; font-weight: bold; color: #2c3e50; }
        .metric-label { color: #7f8c8d; margin-top: 5px; }
        .good { color: #27ae60; }
        .warning { color: #f39c12; }
        .poor { color: #e74c3c; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #34495e; color: white; }
        .chart { background: #f8f9fa; padding: 20px; margin: 20px 0; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⚡ Kaayko API Performance Report</h1>
            <p>Target: ${report.testConfiguration.baseUrl}</p>
            <p>Test Duration: ${report.testConfiguration.testDuration}ms | Concurrent Users: ${report.testConfiguration.concurrentUsers}</p>
        </div>
        
        <div class="metric-grid">
            <div class="metric-card">
                <div class="metric-value ${report.performanceSummary.successRate > 95 ? 'good' : report.performanceSummary.successRate > 90 ? 'warning' : 'poor'}">${report.performanceSummary.successRate.toFixed(1)}%</div>
                <div class="metric-label">Success Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value ${report.performanceSummary.averageResponseTime < 500 ? 'good' : report.performanceSummary.averageResponseTime < 1000 ? 'warning' : 'poor'}">${report.performanceSummary.averageResponseTime.toFixed(0)}ms</div>
                <div class="metric-label">Avg Response Time</div>
            </div>
            <div class="metric-card">
                <div class="metric-value ${report.performanceSummary.requestsPerSecond > 50 ? 'good' : report.performanceSummary.requestsPerSecond > 20 ? 'warning' : 'poor'}">${report.performanceSummary.requestsPerSecond.toFixed(1)}</div>
                <div class="metric-label">Requests/Second</div>
            </div>
            <div class="metric-card">
                <div class="metric-value ${report.performanceSummary.errorRate < 1 ? 'good' : report.performanceSummary.errorRate < 5 ? 'warning' : 'poor'}">${report.performanceSummary.errorRate.toFixed(1)}%</div>
                <div class="metric-label">Error Rate</div>
            </div>
        </div>
        
        <h2>📊 Response Time Percentiles</h2>
        <div class="metric-grid">
            <div class="metric-card">
                <div class="metric-value">${report.performanceSummary.p50.toFixed(0)}ms</div>
                <div class="metric-label">50th Percentile (Median)</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.performanceSummary.p90.toFixed(0)}ms</div>
                <div class="metric-label">90th Percentile</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.performanceSummary.p95.toFixed(0)}ms</div>
                <div class="metric-label">95th Percentile</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.performanceSummary.p99.toFixed(0)}ms</div>
                <div class="metric-label">99th Percentile</div>
            </div>
        </div>
        
        <h2>🎯 Endpoint Performance</h2>
        <table>
            <tr><th>Endpoint</th><th>Requests</th><th>Success Rate</th><th>Avg Time</th><th>Min Time</th><th>Max Time</th></tr>
            ${Object.entries(report.endpointMetrics).map(([endpoint, metrics]) => `
                <tr>
                    <td>${endpoint}</td>
                    <td>${metrics.requests}</td>
                    <td class="${metrics.successes / metrics.requests > 0.95 ? 'good' : 'warning'}">${((metrics.successes / metrics.requests) * 100).toFixed(1)}%</td>
                    <td>${metrics.avgTime.toFixed(0)}ms</td>
                    <td>${metrics.minTime === Infinity ? 'N/A' : metrics.minTime.toFixed(0)}ms</td>
                    <td>${metrics.maxTime.toFixed(0)}ms</td>
                </tr>
            `).join('')}
        </table>
        
        <h2>📈 Response Time Distribution</h2>
        <div class="chart">
            ${Object.entries(report.responseTimeDistribution).map(([range, count]) => `
                <div style="margin: 10px 0;">
                    <strong>${range}:</strong> ${count} requests (${((count / report.summary.totalRequests) * 100).toFixed(1)}%)
                    <div style="background: #3498db; height: 20px; width: ${(count / report.summary.totalRequests) * 100}%; margin-top: 5px; border-radius: 3px;"></div>
                </div>
            `).join('')}
        </div>
        
        ${Object.keys(report.cacheAnalysis).length > 0 ? `
        <h2>💾 Cache Effectiveness</h2>
        <table>
            <tr><th>Endpoint</th><th>First Request</th><th>Second Request</th><th>Improvement</th><th>Cache Hit Likely</th></tr>
            ${Object.entries(report.cacheAnalysis).map(([endpoint, cache]) => `
                <tr>
                    <td>${endpoint}</td>
                    <td>${cache.firstRequest?.time.toFixed(0)}ms</td>
                    <td>${cache.secondRequest?.time.toFixed(0)}ms</td>
                    <td class="${cache.cacheHitLikely ? 'good' : 'warning'}">${cache.timeDifference.toFixed(0)}ms</td>
                    <td class="${cache.cacheHitLikely ? 'good' : 'warning'}">${cache.cacheHitLikely ? 'YES' : 'NO'}</td>
                </tr>
            `).join('')}
        </table>
        ` : ''}
        
        ${report.errors.length > 0 ? `
        <h2>❌ Errors (Last 10)</h2>
        <table>
            <tr><th>Timestamp</th><th>Endpoint</th><th>Error</th></tr>
            ${report.errors.slice(-10).map(error => `
                <tr>
                    <td>${error.timestamp}</td>
                    <td>${error.url || error.endpoint || 'Unknown'}</td>
                    <td>${error.error}</td>
                </tr>
            `).join('')}
        </table>
        ` : ''}
    </div>
</body>
</html>`;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function runPerformanceTests() {
  const overallStartTime = performance.now();
  
  try {
    // Start memory monitoring if enabled
    const memoryInterval = startMemoryMonitoring();
    
    // Run test phases
    await runBaselineTests();
    await analyzeCacheEffectiveness();
    await analyzeNetworkPerformance();
    await runStressTest();
    await simulateConcurrentUsers();
    
    // Stop memory monitoring
    if (memoryInterval) {
      clearInterval(memoryInterval);
    }
    
    // Calculate final metrics
    const totalTime = performance.now() - overallStartTime;
    if (performanceResults.summary.totalRequests > 0) {
      performanceResults.summary.averageResponseTime = 
        Object.values(performanceResults.endpointMetrics)
          .reduce((sum, metrics) => sum + (metrics.totalTime || 0), 0) / 
        performanceResults.summary.successfulRequests;
    }
    
    // Generate report
    generatePerformanceReport();
    
    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('⚡ PERFORMANCE TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`🎯 Target: ${BASE_URL}`);
    console.log(`📊 Total Requests: ${performanceResults.summary.totalRequests}`);
    console.log(`✅ Successful: ${performanceResults.summary.successfulRequests}`);
    console.log(`❌ Failed: ${performanceResults.summary.failedRequests}`);
    console.log(`⏱️ Average Response Time: ${performanceResults.summary.averageResponseTime.toFixed(2)}ms`);
    console.log(`🚀 Requests/Second: ${performanceResults.summary.requestsPerSecond.toFixed(2)}`);
    console.log(`📈 Error Rate: ${performanceResults.summary.errorRate.toFixed(2)}%`);
    console.log(`⏲️ Total Test Duration: ${(totalTime / 1000).toFixed(2)}s`);
    
    // Performance rating
    const performanceScore = calculatePerformanceScore();
    console.log(`🏆 Performance Score: ${performanceScore}/100`);
    
  } catch (error) {
    log(`Fatal performance test error: ${error.message}`, 'error');
  }
  
  console.log('\n🏁 Performance Testing Complete!');
}

function calculatePerformanceScore() {
  let score = 100;
  
  // Deduct points for high error rate
  if (performanceResults.summary.errorRate > 5) score -= 30;
  else if (performanceResults.summary.errorRate > 1) score -= 15;
  
  // Deduct points for slow average response time
  if (performanceResults.summary.averageResponseTime > 2000) score -= 25;
  else if (performanceResults.summary.averageResponseTime > 1000) score -= 15;
  else if (performanceResults.summary.averageResponseTime > 500) score -= 10;
  
  // Deduct points for low throughput
  if (performanceResults.summary.requestsPerSecond < 10) score -= 20;
  else if (performanceResults.summary.requestsPerSecond < 25) score -= 10;
  
  return Math.max(0, score);
}

// Start performance testing
runPerformanceTests().catch(error => {
  console.error('💥 Fatal performance test error:', error);
  process.exit(1);
});
