#!/usr/bin/env node
/**
 * 🚀 KAAYKO INTERACTIVE TEST SUITE
 * 
 * Comprehensive testing tool with:
 * - ASCII table results
 * - Interactive menu system
 * - Local vs Production testing
 * - Intelligent error handling
 * - Retry mechanisms
 * - Service status detection
 * - JSON formatting
 * 
 * Usage: node interactive_test_suite.js
 */

const readline = require('readline');
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load configuration
let testConfig;
try {
  testConfig = JSON.parse(fs.readFileSync('./test_config.json', 'utf8'));
} catch (error) {
  console.error('Error loading test_config.json:', error.message);
  process.exit(1);
}

// Configuration
const CONFIG = {
  LOCAL: {
    FIREBASE_FUNCTIONS: testConfig.environments.local.firebaseFunctions,
    ML_SERVICE: testConfig.environments.local.mlService,
    ML_SERVICE_PROD: testConfig.environments.local.mlServiceProd
  },
  PRODUCTION: {
    FIREBASE_FUNCTIONS: testConfig.environments.production.firebaseFunctions,
    ML_SERVICE: testConfig.environments.production.mlService
  },
  TIMEOUT: testConfig.settings.timeout,
  RETRY_ATTEMPTS: testConfig.settings.retryAttempts,
  RETRY_DELAY: testConfig.settings.retryDelay
};

// Colors for console output
const COLORS = {
  RESET: '\x1b[0m',
  BRIGHT: '\x1b[1m',
  DIM: '\x1b[2m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m'
};

// Test results storage and logging
let testResults = [];
let currentEnvironment = 'LOCAL';
let logFile = null;

// Initialize logging
function initializeLogging() {
  if (testConfig.settings.logging.enabled) {
    const logFileName = testConfig.settings.logging.logFile || 'test_results.log';
    logFile = fs.createWriteStream(logFileName, { flags: 'a' });
    
    const startMessage = {
      timestamp: new Date().toISOString(),
      event: 'TEST_SESSION_START',
      environment: currentEnvironment,
      config: CONFIG[currentEnvironment]
    };
    
    logFile.write(JSON.stringify(startMessage) + '\n');
  }
}

function logToFile(data) {
  if (logFile && testConfig.settings.logging.enabled) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...data
    };
    logFile.write(JSON.stringify(logEntry) + '\n');
  }
}

// Initialize readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Utility Functions
function colorize(text, color) {
  return `${COLORS[color]}${text}${COLORS.RESET}`;
}

function log(message, color = 'WHITE') {
  console.log(colorize(message, color));
}

function logError(message) {
  console.error(colorize(`❌ ${message}`, 'RED'));
}

function drawBox(title, content = [], width = 80) {
  const horizontal = '─'.repeat(width - 2);
  const top = `┌${horizontal}┐`;
  const bottom = `└${horizontal}┘`;
  
  console.log(colorize(top, 'CYAN'));
  console.log(colorize(`│${title.padStart((width + title.length) / 2).padEnd(width - 1)}│`, 'CYAN'));
  console.log(colorize(`├${horizontal}┤`, 'CYAN'));
  
  if (content.length === 0) {
    console.log(colorize(`│${' '.repeat(width - 2)}│`, 'CYAN'));
  } else {
    content.forEach(line => {
      console.log(colorize(`│ ${line.padEnd(width - 3)}│`, 'WHITE'));
    });
  }
  
  console.log(colorize(bottom, 'CYAN'));
}

function drawTable(headers, rows, title = '') {
  if (title) {
    log(`\n${title}`, 'BRIGHT');
    log('='.repeat(title.length), 'BRIGHT');
  }
  
  // Calculate column widths based on config
  const tableWidth = testConfig.settings.formatting?.tableWidth || 120;
  const availableWidth = tableWidth - (headers.length * 3) - 4;
  const avgWidth = Math.floor(availableWidth / headers.length);
  
  const widths = headers.map((header, i) => {
    const maxDataWidth = Math.max(...rows.map(row => String(row[i] || '').length));
    return Math.max(header.length, maxDataWidth, Math.min(avgWidth, 15));
  });
  
  const totalWidth = widths.reduce((sum, width) => sum + width + 3, 1);
  
  // Draw table
  const horizontal = '─'.repeat(totalWidth - 2);
  console.log(colorize(`┌${horizontal}┐`, 'CYAN'));
  
  // Headers
  const headerRow = headers.map((header, i) => header.padEnd(widths[i])).join(' │ ');
  console.log(colorize(`│ ${headerRow} │`, 'BRIGHT'));
  console.log(colorize(`├${horizontal}┤`, 'CYAN'));
  
  // Data rows
  rows.forEach(row => {
    const dataRow = row.map((cell, i) => {
      const str = String(cell || '').substring(0, widths[i]);
      const color = str.includes('✅') ? 'GREEN' : 
                   str.includes('❌') ? 'RED' : 
                   str.includes('⚠️') ? 'YELLOW' : 'WHITE';
      return colorize(str.padEnd(widths[i]), color);
    }).join(' │ ');
    console.log(`│ ${dataRow} │`);
  });
  
  console.log(colorize(`└${horizontal}┘`, 'CYAN'));
}

function question(prompt) {
  return new Promise(resolve => {
    rl.question(colorize(prompt, 'CYAN'), resolve);
  });
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Service Management Functions
async function checkServiceStatus(url, serviceName) {
  try {
    const response = await axios.get(`${url}/health`, { timeout: 5000 });
    return {
      status: '✅ Online',
      version: response.data.version || 'Unknown',
      details: response.data
    };
  } catch (error) {
    return {
      status: '❌ Offline',
      version: 'N/A',
      details: error.message
    };
  }
}

async function startLocalServices() {
  log('\n🚀 Starting Local Services...', 'YELLOW');
  
  const services = [
    {
      name: 'ML Service',
      command: 'python3',
      args: ['main.py'],
      cwd: './ml-service',
      port: 8080
    },
    {
      name: 'Firebase Functions',
      command: 'firebase',
      args: ['emulators:start', '--only', 'functions'],
      cwd: './',
      port: 5001
    }
  ];
  
  for (const service of services) {
    log(`Starting ${service.name}...`, 'YELLOW');
    
    try {
      const process = spawn(service.command, service.args, {
        cwd: service.cwd,
        detached: true,
        stdio: 'ignore'
      });
      
      process.unref();
      
      // Wait for service to start
      await delay(3000);
      
      // Check if service is running
      const status = await checkServiceStatus(
        service.name === 'ML Service' ? CONFIG.LOCAL.ML_SERVICE : CONFIG.LOCAL.FIREBASE_FUNCTIONS,
        service.name
      );
      
      if (status.status.includes('✅')) {
        log(`${service.name} started successfully on port ${service.port}`, 'GREEN');
      } else {
        log(`Failed to start ${service.name}`, 'RED');
      }
    } catch (error) {
      log(`Error starting ${service.name}: ${error.message}`, 'RED');
    }
  }
}

// Test Functions
async function makeRequest(url, options = {}) {
  const maxRetries = options.retries || CONFIG.RETRY_ATTEMPTS;
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios({
        url,
        method: options.method || 'GET',
        data: options.data,
        headers: options.headers,
        timeout: CONFIG.TIMEOUT,
        ...options.axiosOptions
      });
      
      return {
        success: true,
        status: response.status,
        data: response.data,
        responseTime: Date.now() - (options.startTime || Date.now())
      };
    } catch (error) {
      lastError = error;
      
      // Handle rate limiting with longer delays
      if (error.response?.status === 429) {
        const retryDelay = currentEnvironment === 'PRODUCTION' ? 2000 : CONFIG.RETRY_DELAY;
        if (attempt < maxRetries) {
          log(`Rate limited (429), retrying in ${retryDelay}ms...`, 'YELLOW');
          await delay(retryDelay);
        }
      } else if (attempt < maxRetries) {
        log(`Attempt ${attempt} failed, retrying in ${CONFIG.RETRY_DELAY}ms...`, 'YELLOW');
        await delay(CONFIG.RETRY_DELAY);
      }
    }
  }
  
  return {
    success: false,
    error: lastError.message,
    status: lastError.response?.status || 'TIMEOUT',
    responseTime: CONFIG.TIMEOUT
  };
}

async function testEndpoint(name, url, options = {}) {
  const startTime = Date.now();
  log(`Testing ${name}...`, 'BLUE');
  
  const result = await makeRequest(url, { ...options, startTime });
  
  const testResult = {
    name,
    url,
    status: result.success ? '✅ PASS' : '❌ FAIL',
    responseTime: `${result.responseTime}ms`,
    httpStatus: result.status,
    error: result.error || '',
    data: result.data,
    timestamp: new Date().toISOString(),
    environment: currentEnvironment
  };
  
  testResults.push(testResult);
  
  // Log to file
  logToFile({
    event: 'TEST_RESULT',
    ...testResult,
    responseData: testConfig.settings.logging.includeResponseData && result.data ? 
      JSON.stringify(result.data || {}).substring(0, testConfig.settings.logging.maxResponseDataSize || 10000) : 
      undefined
  });
  
  return result;
}

// Test Suites
async function runHealthCheckTests() {
  log('\n🏥 RUNNING HEALTH CHECK TESTS', 'BRIGHT');
  
  const baseUrl = currentEnvironment === 'LOCAL' ? CONFIG.LOCAL.FIREBASE_FUNCTIONS : CONFIG.PRODUCTION.FIREBASE_FUNCTIONS;
  const mlUrl = currentEnvironment === 'LOCAL' ? CONFIG.LOCAL.ML_SERVICE : CONFIG.PRODUCTION.ML_SERVICE;
  
  const tests = [
    { name: 'Firebase Functions Health', url: `${baseUrl}/health` },
    { name: 'ML Service Health', url: `${mlUrl}/health` },
    { name: 'Paddle Conditions Health', url: `${baseUrl}/paddleConditions/health` }
  ];
  
  for (const test of tests) {
    await testEndpoint(test.name, test.url);
    // Add delay between requests to avoid rate limiting in production
    if (currentEnvironment === 'PRODUCTION') {
      await delay(300);
    }
  }
}

async function runPaddleConditionsTests() {
  log('\n🌊 RUNNING PADDLE CONDITIONS TESTS', 'BRIGHT');
  
  const baseUrl = currentEnvironment === 'LOCAL' ? CONFIG.LOCAL.FIREBASE_FUNCTIONS : CONFIG.PRODUCTION.FIREBASE_FUNCTIONS;
  
  const tests = [
    {
      name: 'Paddle Conditions (Coordinates)',
      url: `${baseUrl}/paddleConditions?lat=30.5&lng=-97.8`
    },
    {
      name: 'Paddle Conditions (Location)',
      url: `${baseUrl}/paddleConditions?location=Lake Tahoe`
    },
    {
      name: 'Paddle Conditions Summary',
      url: `${baseUrl}/paddleConditions/summary?lat=40.7&lng=-74.0`
    },
    {
      name: 'Invalid Coordinates',
      url: `${baseUrl}/paddleConditions?lat=999&lng=999`,
      expectError: true
    },
    {
      name: 'Missing Parameters',
      url: `${baseUrl}/paddleConditions`,
      expectError: true
    }
  ];
  
  for (const test of tests) {
    await testEndpoint(test.name, test.url);
    // Add delay between requests to avoid rate limiting in production
    if (currentEnvironment === 'PRODUCTION') {
      await delay(500);
    }
  }
}

async function runMLServiceTests() {
  log('\n🤖 RUNNING ML SERVICE TESTS', 'BRIGHT');
  
  const mlUrl = currentEnvironment === 'LOCAL' ? CONFIG.LOCAL.ML_SERVICE : CONFIG.PRODUCTION.ML_SERVICE;
  
  const tests = [
    {
      name: 'ML Prediction (Perfect Conditions)',
      url: `${mlUrl}/predict`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        temp_c: 25,
        wind_kph: 5,
        humidity: 40,
        vis_km: 15,
        pressure_mb: 1013,
        precip_mm: 0,
        cloud: 10,
        uv: 5,
        gust_kph: 8
      }
    },
    {
      name: 'ML Prediction (Poor Conditions)',
      url: `${mlUrl}/predict`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        temp_c: 0,
        wind_kph: 50,
        humidity: 95,
        vis_km: 1,
        pressure_mb: 950,
        precip_mm: 25,
        cloud: 100,
        uv: 0,
        gust_kph: 70
      }
    },
    {
      name: 'ML Invalid Input',
      url: `${mlUrl}/predict`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { invalid: 'data' },
      expectError: true
    }
  ];
  
  for (const test of tests) {
    await testEndpoint(test.name, test.url, {
      method: test.method,
      headers: test.headers,
      data: test.data
    });
  }
}

async function runPaddlePredictTests() {
  log('\n🎯 RUNNING PADDLE PREDICT TESTS', 'BRIGHT');
  
  const baseUrl = currentEnvironment === 'LOCAL' ? CONFIG.LOCAL.FIREBASE_FUNCTIONS : CONFIG.PRODUCTION.FIREBASE_FUNCTIONS;
  
  const tests = [
    {
      name: 'Paddle Predict (Coordinates)',
      url: `${baseUrl}/paddlePredict?lat=30.5&lng=-97.8`
    },
    {
      name: 'Paddle Predict (Location)',
      url: `${baseUrl}/paddlePredict?location=Antero Reservoir`
    },
    {
      name: 'Paddle Predict Forecast',
      url: `${baseUrl}/paddlePredict/forecast?lat=40.7&lng=-74.0&days=3`
    }
  ];
  
  for (const test of tests) {
    await testEndpoint(test.name, test.url, {
      method: test.method,
      headers: test.headers,
      data: test.data
    });
  }
}

async function runPaddlingOutTests() {
  log('\n�️ RUNNING PADDLING OUT TESTS', 'BRIGHT');
  
  const baseUrl = currentEnvironment === 'LOCAL' ? CONFIG.LOCAL.FIREBASE_FUNCTIONS : CONFIG.PRODUCTION.FIREBASE_FUNCTIONS;
  
  const tests = [
    {
      name: 'Paddling Out List',
      url: `${baseUrl}/paddlingOut`
    },
    {
      name: 'Paddling Out Details (Valid)',
      url: `${baseUrl}/paddlingOut/${testConfig.testCases.paddlingSpotIds.valid[0]}`
    },
    {
      name: 'Paddling Out Details (Invalid)',
      url: `${baseUrl}/paddlingOut/${testConfig.testCases.paddlingSpotIds.invalid[0]}`,
      expectError: true
    }
  ];
  
  for (const test of tests) {
    await testEndpoint(test.name, test.url);
  }
}

async function runProductsTests() {
  log('\n🛍️ RUNNING PRODUCTS TESTS', 'BRIGHT');
  
  const baseUrl = currentEnvironment === 'LOCAL' ? CONFIG.LOCAL.FIREBASE_FUNCTIONS : CONFIG.PRODUCTION.FIREBASE_FUNCTIONS;
  
  const tests = [
    {
      name: 'Products List',
      url: `${baseUrl}/products`
    },
    {
      name: 'Product Details (Valid)',
      url: `${baseUrl}/products/${testConfig.testCases.productIds.valid[0]}`
    },
    {
      name: 'Product Details (Invalid)',
      url: `${baseUrl}/products/${testConfig.testCases.productIds.invalid[0]}`,
      expectError: true
    }
  ];
  
  for (const test of tests) {
    await testEndpoint(test.name, test.url);
  }
}

async function runImagesTests() {
  log('\n🖼️ RUNNING IMAGES TESTS', 'BRIGHT');
  
  const baseUrl = currentEnvironment === 'LOCAL' ? CONFIG.LOCAL.FIREBASE_FUNCTIONS : CONFIG.PRODUCTION.FIREBASE_FUNCTIONS;
  
  const tests = [
    {
      name: 'Image Proxy (Valid)',
      url: `${baseUrl}/images/${testConfig.testCases.productIds.valid[0]}/image1.jpg`
    },
    {
      name: 'Image Proxy (Invalid Product)',
      url: `${baseUrl}/images/${testConfig.testCases.productIds.invalid[0]}/image1.jpg`,
      expectError: true
    },
    {
      name: 'Image Proxy (Invalid File)',
      url: `${baseUrl}/images/${testConfig.testCases.productIds.valid[0]}/nonexistent.jpg`,
      expectError: true
    }
  ];
  
  for (const test of tests) {
    await testEndpoint(test.name, test.url);
  }
}

async function runDeepLinksTests() {
  log('\n🔗 RUNNING DEEP LINKS TESTS', 'BRIGHT');
  
  const baseUrl = currentEnvironment === 'LOCAL' ? CONFIG.LOCAL.FIREBASE_FUNCTIONS : CONFIG.PRODUCTION.FIREBASE_FUNCTIONS;
  
  const tests = [
    {
      name: 'Deep Link Redirect (Valid)',
      url: `${baseUrl}/l/${testConfig.testCases.deepLinkIds.valid[0]}`
    },
    {
      name: 'Deep Link Redirect (Invalid)',
      url: `${baseUrl}/l/${testConfig.testCases.deepLinkIds.invalid[0]}`,
      expectError: true
    },
    {
      name: 'Deep Link Resolve',
      url: `${baseUrl}/resolve?context=test`
    }
  ];
  
  for (const test of tests) {
    await testEndpoint(test.name, test.url);
  }
}

// Display Functions
function displayTestResults() {
  if (testResults.length === 0) {
    log('\nNo test results to display.', 'YELLOW');
    return;
  }
  
  const headers = ['Test Name', 'Status', 'Response Time', 'HTTP Status', 'Error'];
  const rows = testResults.map(result => [
    result.name,
    result.status,
    result.responseTime,
    result.httpStatus,
    (result.error || '').substring(0, 50) + ((result.error || '').length > 50 ? '...' : '')
  ]);
  
  drawTable(headers, rows, `📊 TEST RESULTS - ${currentEnvironment} ENVIRONMENT`);
  
  // Summary
  const passed = testResults.filter(r => r.status.includes('✅')).length;
  const failed = testResults.filter(r => r.status.includes('❌')).length;
  const successRate = ((passed / testResults.length) * 100).toFixed(1);
  
  log(`\n📈 SUMMARY:`, 'BRIGHT');
  log(`Total Tests: ${testResults.length}`, 'WHITE');
  log(`Passed: ${passed}`, 'GREEN');
  log(`Failed: ${failed}`, 'RED');
  log(`Success Rate: ${successRate}%`, successRate >= 80 ? 'GREEN' : successRate >= 60 ? 'YELLOW' : 'RED');
}

function displayServiceStatus() {
  drawBox('🔍 SERVICE STATUS CHECK', [
    'Checking all services in current environment...'
  ]);
}

async function checkAllServices() {
  displayServiceStatus();
  
  const services = currentEnvironment === 'LOCAL' ? [
    { name: 'Firebase Functions', url: CONFIG.LOCAL.FIREBASE_FUNCTIONS },
    { name: 'ML Service (Local)', url: CONFIG.LOCAL.ML_SERVICE },
    { name: 'ML Service (Prod)', url: CONFIG.LOCAL.ML_SERVICE_PROD }
  ] : [
    { name: 'Firebase Functions', url: CONFIG.PRODUCTION.FIREBASE_FUNCTIONS },
    { name: 'ML Service', url: CONFIG.PRODUCTION.ML_SERVICE }
  ];
  
  const results = [];
  
  for (const service of services) {
    const status = await checkServiceStatus(service.url, service.name);
    results.push([
      service.name,
      status.status,
      status.version,
      service.url
    ]);
  }
  
  drawTable(['Service', 'Status', 'Version', 'URL'], results, `🌐 ${currentEnvironment} ENVIRONMENT STATUS`);
}

function displayDetailedResult(index) {
  if (index < 0 || index >= testResults.length) {
    log('Invalid test index.', 'RED');
    return;
  }
  
  const result = testResults[index];
  
  drawBox(`📋 DETAILED RESULT: ${result.name}`, [
    `URL: ${result.url}`,
    `Status: ${result.status}`,
    `Response Time: ${result.responseTime}`,
    `HTTP Status: ${result.httpStatus}`,
    result.error ? `Error: ${result.error}` : '',
    ''
  ]);
  
  if (result.data) {
    log('📄 Response Data:', 'CYAN');
    console.log(JSON.stringify(result.data, null, 2));
  }
}

// Menu Functions
function displayMainMenu() {
  drawBox('🚀 KAAYKO INTERACTIVE TEST SUITE', [
    `Current Environment: ${colorize(currentEnvironment, 'BRIGHT')}`,
    '',
    '1. 🔄 Switch Environment (Local/Production)',
    '2. 🏥 Check Service Status',
    '3. ⚡ Start Local Services',
    '4. 🧪 Run All Tests',
    '5. 🏥 Health Check Tests',
    '6. 🌊 Paddle Conditions Tests',
    '7. 🤖 ML Service Tests',
    '8. 🎯 Paddle Predict Tests',
    '9. 🏞️ Paddling Out Tests',
    '10. 🛍️ Products Tests', 
    '11. �️ Images Tests',
    '12. 🔗 Deep Links Tests',
    '13. �📊 View Test Results',
    '14. 📋 View Detailed Result',
    '15. 🧹 Clear Results',
    '16. 💾 Export Results',
    '17. 🔧 Custom API Test',
    '0. 🚪 Exit',
    ''
  ]);
}

async function handleMenuChoice(choice) {
  switch (choice) {
    case '1':
      currentEnvironment = currentEnvironment === 'LOCAL' ? 'PRODUCTION' : 'LOCAL';
      log(`\n🔄 Switched to ${currentEnvironment} environment`, 'GREEN');
      break;
      
    case '2':
      await checkAllServices();
      break;
      
    case '3':
      if (currentEnvironment === 'LOCAL') {
        await startLocalServices();
      } else {
        log('\n⚠️ Local services can only be started in LOCAL environment', 'YELLOW');
      }
      break;
      
    case '4':
      testResults = [];
      await runHealthCheckTests();
      await runPaddleConditionsTests();
      await runMLServiceTests();
      await runPaddlePredictTests();
      await runPaddlingOutTests();
      await runProductsTests();
      await runImagesTests();
      await runDeepLinksTests();
      displayTestResults();
      break;
      
    case '5':
      await runHealthCheckTests();
      break;
      
    case '6':
      await runPaddleConditionsTests();
      break;
      
    case '7':
      await runMLServiceTests();
      break;
      
    case '8':
      await runPaddlePredictTests();
      break;
      
    case '9':
      await runPaddlingOutTests();
      break;
      
    case '10':
      await runProductsTests();
      break;
      
    case '11':
      await runImagesTests();
      break;
      
    case '12':
      await runDeepLinksTests();
      break;
      
    case '13':
      displayTestResults();
      break;
      
    case '14':
      if (testResults.length === 0) {
        log('\nNo test results available. Run some tests first.', 'YELLOW');
      } else {
        const index = await question('\nEnter test index (0-' + (testResults.length - 1) + '): ');
        displayDetailedResult(parseInt(index));
      }
      break;
      
    case '15':
      testResults = [];
      log('\n🧹 Test results cleared', 'GREEN');
      break;
      
    case '16':
      await exportResults();
      break;
      
    case '17':
      await customAPITest();
      break;
      
    case '0':
      log('\n👋 Goodbye!', 'GREEN');
      rl.close();
      process.exit(0);
      break;
      
    default:
      log('\n❌ Invalid choice. Please try again.', 'RED');
  }
}

async function exportResults() {
  if (testResults.length === 0) {
    log('\nNo test results to export. Run some tests first.', 'YELLOW');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `test_results_${currentEnvironment.toLowerCase()}_${timestamp}.json`;
  
  const exportData = {
    timestamp: new Date().toISOString(),
    environment: currentEnvironment,
    summary: {
      total: testResults.length,
      passed: testResults.filter(r => r.status === 'PASS').length,
      failed: testResults.filter(r => r.status === 'FAIL').length,
      skipped: testResults.filter(r => r.status === 'SKIP').length
    },
    results: testResults
  };

  try {
    await fs.writeFile(filename, JSON.stringify(exportData, null, 2));
    log(`\n📁 Results exported to: ${filename}`, 'GREEN');
  } catch (error) {
    logError(`Failed to export results: ${error.message}`);
  }
}

async function customAPITest() {
  log('\n🔧 CUSTOM API TEST', 'BRIGHT');
  
  const url = await question('Enter API URL: ');
  const method = await question('HTTP Method (GET/POST) [GET]: ') || 'GET';
  
  let data = null;
  if (method.toUpperCase() === 'POST') {
    const jsonData = await question('Enter JSON data (optional): ');
    if (jsonData.trim()) {
      try {
        data = JSON.parse(jsonData);
      } catch (error) {
        log('Invalid JSON format. Proceeding without data.', 'YELLOW');
      }
    }
  }
  
  const testName = await question('Test name: ') || 'Custom Test';
  
  const options = { method: method.toUpperCase() };
  if (data) {
    options.data = data;
    options.headers = { 'Content-Type': 'application/json' };
  }
  
  await testEndpoint(testName, url, options);
  
  // Display result immediately
  const lastResult = testResults[testResults.length - 1];
  displayDetailedResult(testResults.length - 1);
}

// Main Application Loop
async function main() {
  log(colorize('\n🚀 KAAYKO INTERACTIVE TEST SUITE STARTED', 'BRIGHT'));
  log(colorize('=====================================', 'BRIGHT'));
  
  while (true) {
    displayMainMenu();
    const choice = await question('\nEnter your choice: ');
    await handleMenuChoice(choice);
    await question('\nPress Enter to continue...');
    console.clear();
  }
}

// Error handling
process.on('uncaughtException', (error) => {
  log(`\n💥 Uncaught Exception: ${error.message}`, 'RED');
  console.error(error);
});

process.on('unhandledRejection', (reason, promise) => {
  log(`\n💥 Unhandled Rejection: ${reason}`, 'RED');
  console.error(reason);
});

// Start the application
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  CONFIG,
  testEndpoint,
  makeRequest,
  checkServiceStatus
};
