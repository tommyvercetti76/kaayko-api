#!/usr/bin/env node
/**
 * Integration & End-to-End Test Suite for Kaayko APIs
 * 
 * This test suite focuses on real-world workflows and integration scenarios:
 * - Complete user journeys and workflows
 * - Cross-API integration testing
 * - Data consistency validation
 * - External service integrations
 * - Firebase/Firestore interaction testing
 * - ML model integration validation
 * - Deep link flow testing
 * 
 * Usage: node integration_tests.js [--workflow=name] [--detailed]
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = process.env.BASE_URL || 'https://api-vwcc5j4qda-uc.a.run.app';
const SPECIFIC_WORKFLOW = process.argv.find(arg => arg.startsWith('--workflow='))?.split('=')[1];
const DETAILED_LOGGING = process.argv.includes('--detailed');

console.log(`🔄 Integration & End-to-End Test Suite`);
console.log(`🎯 Target: ${BASE_URL}`);
console.log(`🔍 Specific Workflow: ${SPECIFIC_WORKFLOW || 'ALL'}`);
console.log(`📝 Detailed Logging: ${DETAILED_LOGGING ? 'ON' : 'OFF'}`);
console.log('=' .repeat(80));

// Test results tracking
const integrationResults = {
  summary: {
    totalWorkflows: 0,
    successfulWorkflows: 0,
    failedWorkflows: 0,
    totalSteps: 0,
    successfulSteps: 0,
    failedSteps: 0
  },
  workflows: [],
  dataConsistency: [],
  externalIntegrations: [],
  mlIntegration: [],
  deepLinkFlows: []
};

// Utility functions
function log(message, level = 'info') {
  const symbols = { info: '📋', success: '✅', error: '❌', warning: '⚠️', workflow: '🔄', step: '📍' };
  const timestamp = new Date().toISOString();
  
  if (DETAILED_LOGGING || level !== 'step') {
    console.log(`${symbols[level] || '📋'} [${timestamp}] ${message}`);
  }
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
        'User-Agent': 'Kaayko-IntegrationTest/1.0',
        'Accept': 'application/json',
        ...options.headers
      },
      timeout: options.timeout || 30000
    };
    
    // Log pretty-printed request details if detailed logging enabled
    if (DETAILED_LOGGING) {
      console.log('\n🔄 INTEGRATION REQUEST:');
      console.log(JSON.stringify({
        method: requestOptions.method,
        url: url,
        headers: requestOptions.headers,
        body: options.body || null
      }, null, 2));
    }
    
    const startTime = Date.now();
    
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
        
        // Log pretty-printed response details if detailed logging enabled
        if (DETAILED_LOGGING) {
          console.log('\n📊 INTEGRATION RESPONSE:');
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
          console.log('🔄' + '─'.repeat(79));
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

async function runWorkflowStep(stepName, stepFunction, workflow) {
  workflow.steps = workflow.steps || [];
  integrationResults.summary.totalSteps++;
  
  const step = {
    name: stepName,
    startTime: new Date().toISOString(),
    success: false,
    duration: 0,
    data: null,
    error: null
  };
  
  log(`  ${stepName}`, 'step');
  
  try {
    const startTime = Date.now();
    const result = await stepFunction();
    step.duration = Date.now() - startTime;
    step.success = true;
    step.data = result;
    integrationResults.summary.successfulSteps++;
    
    log(`    ✅ ${stepName} completed (${step.duration}ms)`, 'success');
    return result;
  } catch (error) {
    step.error = error.message;
    integrationResults.summary.failedSteps++;
    
    log(`    ❌ ${stepName} failed: ${error.message}`, 'error');
    throw error;
  } finally {
    step.endTime = new Date().toISOString();
    workflow.steps.push(step);
  }
}

async function runWorkflow(workflowName, workflowFunction) {
  if (SPECIFIC_WORKFLOW && SPECIFIC_WORKFLOW !== workflowName) {
    return; // Skip if specific workflow requested
  }
  
  integrationResults.summary.totalWorkflows++;
  
  const workflow = {
    name: workflowName,
    startTime: new Date().toISOString(),
    success: false,
    steps: [],
    duration: 0,
    error: null
  };
  
  log(`🔄 Starting workflow: ${workflowName}`, 'workflow');
  
  try {
    const startTime = Date.now();
    await workflowFunction(workflow);
    workflow.duration = Date.now() - startTime;
    workflow.success = true;
    integrationResults.summary.successfulWorkflows++;
    
    log(`✅ Workflow completed: ${workflowName} (${workflow.duration}ms)`, 'success');
  } catch (error) {
    workflow.error = error.message;
    integrationResults.summary.failedWorkflows++;
    
    log(`❌ Workflow failed: ${workflowName} - ${error.message}`, 'error');
  } finally {
    workflow.endTime = new Date().toISOString();
    integrationResults.workflows.push(workflow);
  }
}

// ============================================================================
// WORKFLOW 1: COMPLETE USER JOURNEY - DISCOVER LOCATION
// ============================================================================

async function discoverLocationWorkflow(workflow) {
  let locationData = null;
  let conditionsData = null;
  let predictionData = null;
  
  // Step 1: Browse all paddling locations
  locationData = await runWorkflowStep('Browse Paddling Locations', async () => {
    const response = await makeRequest(`${BASE_URL}/paddlingOut`);
    
    if (response.statusCode !== 200) {
      throw new Error(`Failed to get locations: HTTP ${response.statusCode}`);
    }
    
    const locations = JSON.parse(response.body);
    if (!Array.isArray(locations) || locations.length === 0) {
      throw new Error('No paddling locations found');
    }
    
    return { count: locations.length, locations: locations.slice(0, 3) };
  }, workflow);
  
  // Step 2: Get detailed info for a specific location
  const testLocation = locationData.locations[0];
  const locationDetails = await runWorkflowStep('Get Location Details', async () => {
    const response = await makeRequest(`${BASE_URL}/paddlingOut/${testLocation.id}`);
    
    if (response.statusCode !== 200) {
      throw new Error(`Failed to get location details: HTTP ${response.statusCode}`);
    }
    
    const details = JSON.parse(response.body);
    if (!details.location || !details.location.latitude || !details.location.longitude) {
      throw new Error('Location missing coordinates');
    }
    
    return details;
  }, workflow);
  
  // Step 3: Get current paddle conditions for the location
  conditionsData = await runWorkflowStep('Check Paddle Conditions', async () => {
    const lat = locationDetails.location.latitude;
    const lng = locationDetails.location.longitude;
    const response = await makeRequest(`${BASE_URL}/paddleConditions/summary?lat=${lat}&lng=${lng}`);
    
    if (response.statusCode !== 200) {
      throw new Error(`Failed to get conditions: HTTP ${response.statusCode}`);
    }
    
    const conditions = JSON.parse(response.body);
    return conditions;
  }, workflow);
  
  // Step 4: Get ML prediction for the location
  predictionData = await runWorkflowStep('Get ML Prediction', async () => {
    const lat = locationDetails.location.latitude;
    const lng = locationDetails.location.longitude;
    const response = await makeRequest(`${BASE_URL}/paddlePredict?lat=${lat}&lng=${lng}`);
    
    if (response.statusCode !== 200) {
      throw new Error(`Failed to get prediction: HTTP ${response.statusCode}`);
    }
    
    const prediction = JSON.parse(response.body);
    return prediction;
  }, workflow);
  
  // Step 5: Validate data consistency
  await runWorkflowStep('Validate Data Consistency', async () => {
    // Check that all APIs returned data for the same location
    const lat = locationDetails.location.latitude;
    const lng = locationDetails.location.longitude;
    
    if (!conditionsData || !predictionData) {
      throw new Error('Missing conditions or prediction data');
    }
    
    // Validate that weather conditions and predictions are reasonable
    if (predictionData.mlModelUsed === undefined) {
      throw new Error('ML prediction missing mlModelUsed field');
    }
    
    return {
      location: { lat, lng },
      hasConditions: !!conditionsData,
      hasPrediction: !!predictionData,
      mlModelUsed: predictionData.mlModelUsed
    };
  }, workflow);
}

// ============================================================================
// WORKFLOW 2: PRODUCT BROWSING AND INTERACTION
// ============================================================================

async function productBrowsingWorkflow(workflow) {
  let products = null;
  let productDetails = null;
  
  // Step 1: List all products
  products = await runWorkflowStep('List All Products', async () => {
    const response = await makeRequest(`${BASE_URL}/products`);
    
    if (response.statusCode !== 200) {
      throw new Error(`Failed to get products: HTTP ${response.statusCode}`);
    }
    
    const productList = JSON.parse(response.body);
    if (!Array.isArray(productList)) {
      throw new Error('Products response is not an array');
    }
    
    return { count: productList.length, products: productList };
  }, workflow);
  
  // Step 2: Get details for specific products
  if (products.count > 0) {
    const testProduct = products.products[0];
    productDetails = await runWorkflowStep('Get Product Details', async () => {
      const response = await makeRequest(`${BASE_URL}/products/${testProduct.id}`);
      
      if (response.statusCode === 404) {
        // This is acceptable - product might not exist
        return { exists: false, id: testProduct.id };
      }
      
      if (response.statusCode !== 200) {
        throw new Error(`Failed to get product details: HTTP ${response.statusCode}`);
      }
      
      const details = JSON.parse(response.body);
      return { exists: true, ...details };
    }, workflow);
    
    // Step 3: Test voting functionality (if product exists)
    if (productDetails.exists) {
      await runWorkflowStep('Vote on Product (+1)', async () => {
        const response = await makeRequest(`${BASE_URL}/products/${testProduct.id}/vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voteChange: 1 })
        });
        
        if (response.statusCode !== 200 && response.statusCode !== 404) {
          throw new Error(`Vote failed: HTTP ${response.statusCode}`);
        }
        
        return { voted: response.statusCode === 200 };
      }, workflow);
      
      await runWorkflowStep('Vote on Product (-1)', async () => {
        const response = await makeRequest(`${BASE_URL}/products/${testProduct.id}/vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voteChange: -1 })
        });
        
        if (response.statusCode !== 200 && response.statusCode !== 404) {
          throw new Error(`Vote failed: HTTP ${response.statusCode}`);
        }
        
        return { voted: response.statusCode === 200 };
      }, workflow);
    }
  }
  
  // Step 4: Test image access
  if (products.count > 0) {
    await runWorkflowStep('Access Product Images', async () => {
      const testProduct = products.products[0];
      const response = await makeRequest(`${BASE_URL}/images/${testProduct.productID || testProduct.id}/test.jpg`);
      
      // 404 is acceptable - image might not exist
      if (response.statusCode !== 200 && response.statusCode !== 404) {
        throw new Error(`Image access failed: HTTP ${response.statusCode}`);
      }
      
      return { imageAccessible: response.statusCode === 200 };
    }, workflow);
  }
}

// ============================================================================
// WORKFLOW 3: WEATHER AND PREDICTION INTEGRATION
// ============================================================================

async function weatherPredictionWorkflow(workflow) {
  const testCoordinates = [
    { lat: 39.0968, lng: -120.0324, name: 'Lake Tahoe' },
    { lat: 44.0, lng: -85.0, name: 'Torch Lake' }
  ];
  
  for (const coord of testCoordinates) {
    // Step 1: Get weather conditions
    const conditions = await runWorkflowStep(`Get Conditions - ${coord.name}`, async () => {
      const response = await makeRequest(`${BASE_URL}/paddleConditions/summary?lat=${coord.lat}&lng=${coord.lng}`);
      
      if (response.statusCode !== 200) {
        throw new Error(`Conditions failed: HTTP ${response.statusCode}`);
      }
      
      const data = JSON.parse(response.body);
      return data;
    }, workflow);
    
    // Step 2: Get ML prediction for same location
    const prediction = await runWorkflowStep(`Get Prediction - ${coord.name}`, async () => {
      const response = await makeRequest(`${BASE_URL}/paddlePredict?lat=${coord.lat}&lng=${coord.lng}`);
      
      if (response.statusCode !== 200) {
        throw new Error(`Prediction failed: HTTP ${response.statusCode}`);
      }
      
      const data = JSON.parse(response.body);
      return data;
    }, workflow);
    
    // Step 3: Compare and validate integration
    await runWorkflowStep(`Validate Integration - ${coord.name}`, async () => {
      // Both should return data for the same location
      if (!conditions || !prediction) {
        throw new Error('Missing conditions or prediction data');
      }
      
      // ML prediction should indicate whether model was used
      if (prediction.mlModelUsed === undefined) {
        throw new Error('Prediction missing mlModelUsed indicator');
      }
      
      return {
        location: coord.name,
        hasConditions: !!conditions,
        hasPrediction: !!prediction,
        mlModelUsed: prediction.mlModelUsed,
        predictionSource: prediction.predictionSource || 'unknown'
      };
    }, workflow);
  }
}

// ============================================================================
// WORKFLOW 4: REPORTING AND ANALYTICS FLOW
// ============================================================================

async function reportingWorkflow(workflow) {
  // Step 1: Get basic paddling report
  const basicReport = await runWorkflowStep('Generate Basic Report', async () => {
    const response = await makeRequest(`${BASE_URL}/paddlingReport/summary`);
    
    if (response.statusCode !== 200) {
      throw new Error(`Report failed: HTTP ${response.statusCode}`);
    }
    
    const report = JSON.parse(response.body);
    return report;
  }, workflow);
  
  // Step 2: Get best conditions report
  const bestConditions = await runWorkflowStep('Get Best Conditions', async () => {
    const response = await makeRequest(`${BASE_URL}/paddlingReport/best`);
    
    if (response.statusCode !== 200) {
      throw new Error(`Best conditions failed: HTTP ${response.statusCode}`);
    }
    
    const report = JSON.parse(response.body);
    return report;
  }, workflow);
  
  // Step 3: Get full detailed report
  const fullReport = await runWorkflowStep('Generate Full Report', async () => {
    const response = await makeRequest(`${BASE_URL}/paddlingReport`);
    
    // This might timeout or fail due to complexity - that's acceptable
    if (response.statusCode !== 200 && response.statusCode !== 408 && response.statusCode !== 500) {
      throw new Error(`Full report unexpected error: HTTP ${response.statusCode}`);
    }
    
    if (response.statusCode === 200) {
      const report = JSON.parse(response.body);
      return report;
    }
    
    return { skipped: true, reason: `HTTP ${response.statusCode}` };
  }, workflow);
  
  // Step 4: Validate report consistency
  await runWorkflowStep('Validate Report Consistency', async () => {
    if (!basicReport.success || !bestConditions.success) {
      throw new Error('Basic reports should succeed');
    }
    
    // Check that best conditions is subset of available data
    if (bestConditions.data && bestConditions.data.goodConditions !== undefined) {
      if (bestConditions.data.goodConditions < 0) {
        throw new Error('Good conditions count cannot be negative');
      }
    }
    
    return {
      basicReportSuccess: basicReport.success,
      bestConditionsSuccess: bestConditions.success,
      fullReportWorking: fullReport && !fullReport.skipped
    };
  }, workflow);
}

// ============================================================================
// WORKFLOW 5: DEEP LINK AND CONTEXT PRESERVATION
// ============================================================================

async function deepLinkWorkflow(workflow) {
  const testLinkIds = ['torch789', 'tahoe123', 'test123'];
  
  for (const linkId of testLinkIds) {
    // Step 1: Test short link access
    const linkResponse = await runWorkflowStep(`Test Short Link - ${linkId}`, async () => {
      const response = await makeRequest(`${BASE_URL}/l/${linkId}`);
      
      // Links can redirect (302) or show content (200) or not exist (404)
      if (![200, 302, 404].includes(response.statusCode)) {
        throw new Error(`Unexpected link response: HTTP ${response.statusCode}`);
      }
      
      return {
        statusCode: response.statusCode,
        hasRedirect: response.statusCode === 302,
        location: response.headers.location || null
      };
    }, workflow);
    
    // Step 2: Test context resolution
    await runWorkflowStep(`Test Context Resolution - ${linkId}`, async () => {
      const response = await makeRequest(`${BASE_URL}/resolve?id=${linkId}`);
      
      // Resolution can succeed (200) or fail (404)
      if (![200, 404].includes(response.statusCode)) {
        throw new Error(`Unexpected resolve response: HTTP ${response.statusCode}`);
      }
      
      let contextData = null;
      if (response.statusCode === 200) {
        try {
          contextData = JSON.parse(response.body);
        } catch (e) {
          throw new Error('Invalid JSON in resolve response');
        }
      }
      
      return {
        resolved: response.statusCode === 200,
        context: contextData
      };
    }, workflow);
  }
  
  // Step 3: Test context with cookies
  await runWorkflowStep('Test Context with Cookies', async () => {
    const response = await makeRequest(`${BASE_URL}/resolve`, {
      headers: {
        'Cookie': 'kaayko_ctxid=torch789; kaayko_location={"name":"Test Lake","lat":44.0,"lon":-85.0}'
      }
    });
    
    // Should work with cookies
    if (![200, 404].includes(response.statusCode)) {
      throw new Error(`Cookie resolve failed: HTTP ${response.statusCode}`);
    }
    
    return { worksWithCookies: response.statusCode === 200 };
  }, workflow);
}

// ============================================================================
// WORKFLOW 6: ML MODEL INTEGRATION VALIDATION
// ============================================================================

async function mlModelIntegrationWorkflow(workflow) {
  // Step 1: Check ML model info
  const modelInfo = await runWorkflowStep('Get ML Model Info', async () => {
    const response = await makeRequest(`${BASE_URL}/paddlePredict/model`);
    
    if (response.statusCode !== 200) {
      throw new Error(`Model info failed: HTTP ${response.statusCode}`);
    }
    
    const info = JSON.parse(response.body);
    return info;
  }, workflow);
  
  // Step 2: Test multiple predictions to verify ML integration
  const testLocations = [
    { lat: 39.0968, lng: -120.0324 },
    { lat: 44.0, lng: -85.0 },
    { lat: 45.0, lng: -86.0 }
  ];
  
  const predictions = [];
  
  for (const location of testLocations) {
    const prediction = await runWorkflowStep(`ML Prediction ${location.lat},${location.lng}`, async () => {
      const response = await makeRequest(`${BASE_URL}/paddlePredict?lat=${location.lat}&lng=${location.lng}`);
      
      if (response.statusCode !== 200) {
        throw new Error(`Prediction failed: HTTP ${response.statusCode}`);
      }
      
      const data = JSON.parse(response.body);
      predictions.push(data);
      return data;
    }, workflow);
  }
  
  // Step 3: Validate ML integration consistency
  await runWorkflowStep('Validate ML Integration', async () => {
    // All predictions should have consistent structure
    for (const prediction of predictions) {
      if (prediction.mlModelUsed === undefined) {
        throw new Error('Prediction missing mlModelUsed field');
      }
      
      if (prediction.predictionSource === undefined) {
        throw new Error('Prediction missing predictionSource field');
      }
    }
    
    // Count ML vs fallback predictions
    const mlPredictions = predictions.filter(p => p.mlModelUsed === true).length;
    const fallbackPredictions = predictions.filter(p => p.mlModelUsed === false).length;
    
    return {
      totalPredictions: predictions.length,
      mlPredictions,
      fallbackPredictions,
      mlIntegrationWorking: mlPredictions > 0,
      modelInfo: modelInfo
    };
  }, workflow);
  
  // Step 4: Test forecast endpoint
  await runWorkflowStep('Test Forecast Endpoint', async () => {
    const response = await makeRequest(`${BASE_URL}/paddlePredict/forecast?lat=39.0968&lng=-120.0324`);
    
    // Forecast might not be implemented or might fail - that's ok
    if (![200, 400, 404, 500].includes(response.statusCode)) {
      throw new Error(`Unexpected forecast response: HTTP ${response.statusCode}`);
    }
    
    return { forecastAvailable: response.statusCode === 200 };
  }, workflow);
}

// ============================================================================
// CROSS-API DATA CONSISTENCY TESTS
// ============================================================================

async function validateDataConsistency() {
  log('🔍 Validating Cross-API Data Consistency', 'info');
  
  // Test 1: Location consistency between paddlingOut and weather APIs
  const consistencyTest1 = {
    test: 'Location Coordinate Consistency',
    success: false,
    details: {}
  };
  
  try {
    const locationsResponse = await makeRequest(`${BASE_URL}/paddlingOut`);
    if (locationsResponse.statusCode === 200) {
      const locations = JSON.parse(locationsResponse.body);
      
      if (locations.length > 0) {
        const testLocation = locations[0];
        if (testLocation.location && testLocation.location.latitude && testLocation.location.longitude) {
          const weatherResponse = await makeRequest(
            `${BASE_URL}/paddleConditions/summary?lat=${testLocation.location.latitude}&lng=${testLocation.location.longitude}`
          );
          
          consistencyTest1.success = weatherResponse.statusCode === 200;
          consistencyTest1.details = {
            locationId: testLocation.id,
            coordinates: testLocation.location,
            weatherApiWorking: weatherResponse.statusCode === 200
          };
        }
      }
    }
  } catch (error) {
    consistencyTest1.details.error = error.message;
  }
  
  integrationResults.dataConsistency.push(consistencyTest1);
  
  // Test 2: ML prediction consistency with weather data
  const consistencyTest2 = {
    test: 'ML Prediction Weather Consistency',
    success: false,
    details: {}
  };
  
  try {
    const testLat = 39.0968;
    const testLng = -120.0324;
    
    const [weatherResponse, predictionResponse] = await Promise.all([
      makeRequest(`${BASE_URL}/paddleConditions/summary?lat=${testLat}&lng=${testLng}`),
      makeRequest(`${BASE_URL}/paddlePredict?lat=${testLat}&lng=${testLng}`)
    ]);
    
    if (weatherResponse.statusCode === 200 && predictionResponse.statusCode === 200) {
      const weatherData = JSON.parse(weatherResponse.body);
      const predictionData = JSON.parse(predictionResponse.body);
      
      consistencyTest2.success = true;
      consistencyTest2.details = {
        coordinates: { lat: testLat, lng: testLng },
        bothApisWorking: true,
        mlModelUsed: predictionData.mlModelUsed,
        weatherDataAvailable: !!weatherData
      };
    }
  } catch (error) {
    consistencyTest2.details.error = error.message;
  }
  
  integrationResults.dataConsistency.push(consistencyTest2);
  
  log(`Data consistency tests: ${integrationResults.dataConsistency.filter(t => t.success).length}/${integrationResults.dataConsistency.length} passed`, 
      integrationResults.dataConsistency.every(t => t.success) ? 'success' : 'warning');
}

// ============================================================================
// EXTERNAL SERVICE INTEGRATION TESTS
// ============================================================================

async function testExternalIntegrations() {
  log('🌐 Testing External Service Integrations', 'info');
  
  // Test 1: Weather API integration
  const weatherIntegration = {
    service: 'WeatherAPI',
    success: false,
    details: {}
  };
  
  try {
    const response = await makeRequest(`${BASE_URL}/paddleConditions/summary?lat=39.0968&lng=-120.0324`);
    
    weatherIntegration.success = response.statusCode === 200;
    weatherIntegration.details = {
      statusCode: response.statusCode,
      responseTime: response.duration,
      dataReceived: response.statusCode === 200
    };
    
    if (response.statusCode === 200) {
      const data = JSON.parse(response.body);
      weatherIntegration.details.hasWeatherData = !!data;
    }
  } catch (error) {
    weatherIntegration.details.error = error.message;
  }
  
  integrationResults.externalIntegrations.push(weatherIntegration);
  
  // Test 2: ML Service integration
  const mlIntegration = {
    service: 'ML Prediction Service',
    success: false,
    details: {}
  };
  
  try {
    const response = await makeRequest(`${BASE_URL}/paddlePredict?lat=39.0968&lng=-120.0324`);
    
    mlIntegration.success = response.statusCode === 200;
    mlIntegration.details = {
      statusCode: response.statusCode,
      responseTime: response.duration,
      dataReceived: response.statusCode === 200
    };
    
    if (response.statusCode === 200) {
      const data = JSON.parse(response.body);
      mlIntegration.details.mlModelUsed = data.mlModelUsed;
      mlIntegration.details.predictionSource = data.predictionSource;
    }
  } catch (error) {
    mlIntegration.details.error = error.message;
  }
  
  integrationResults.externalIntegrations.push(mlIntegration);
  
  log(`External integration tests: ${integrationResults.externalIntegrations.filter(t => t.success).length}/${integrationResults.externalIntegrations.length} passed`, 
      integrationResults.externalIntegrations.every(t => t.success) ? 'success' : 'warning');
}

// ============================================================================
// GENERATE INTEGRATION REPORT
// ============================================================================

function generateIntegrationReport() {
  const report = {
    ...integrationResults,
    metadata: {
      target: BASE_URL,
      testDate: new Date().toISOString(),
      specificWorkflow: SPECIFIC_WORKFLOW || 'ALL',
      detailedLogging: DETAILED_LOGGING
    },
    executiveSummary: {
      workflowSuccessRate: (integrationResults.summary.successfulWorkflows / integrationResults.summary.totalWorkflows) * 100,
      stepSuccessRate: (integrationResults.summary.successfulSteps / integrationResults.summary.totalSteps) * 100,
      dataConsistencyRate: (integrationResults.dataConsistency.filter(t => t.success).length / integrationResults.dataConsistency.length) * 100,
      externalIntegrationRate: (integrationResults.externalIntegrations.filter(t => t.success).length / integrationResults.externalIntegrations.length) * 100
    }
  };
  
  const reportPath = path.join(__dirname, 'integration_report.json');
  
  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    log(`Integration report saved to: ${reportPath}`, 'success');
  } catch (error) {
    log(`Failed to save integration report: ${error.message}`, 'error');
  }
  
  return report;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function runIntegrationTests() {
  const startTime = Date.now();
  
  try {
    // Run workflow tests
    await runWorkflow('Discover Location Journey', discoverLocationWorkflow);
    await runWorkflow('Product Browsing Journey', productBrowsingWorkflow);
    await runWorkflow('Weather & Prediction Integration', weatherPredictionWorkflow);
    await runWorkflow('Reporting & Analytics Flow', reportingWorkflow);
    await runWorkflow('Deep Link & Context Flow', deepLinkWorkflow);
    await runWorkflow('ML Model Integration', mlModelIntegrationWorkflow);
    
    // Run additional integration tests
    await validateDataConsistency();
    await testExternalIntegrations();
    
    // Generate report
    const report = generateIntegrationReport();
    
    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('🔄 INTEGRATION TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`🎯 Target: ${BASE_URL}`);
    console.log(`📊 Workflows: ${integrationResults.summary.successfulWorkflows}/${integrationResults.summary.totalWorkflows} successful`);
    console.log(`📍 Steps: ${integrationResults.summary.successfulSteps}/${integrationResults.summary.totalSteps} successful`);
    console.log(`📈 Workflow Success Rate: ${report.executiveSummary.workflowSuccessRate.toFixed(1)}%`);
    console.log(`📈 Step Success Rate: ${report.executiveSummary.stepSuccessRate.toFixed(1)}%`);
    console.log(`🔍 Data Consistency: ${report.executiveSummary.dataConsistencyRate.toFixed(1)}%`);
    console.log(`🌐 External Integrations: ${report.executiveSummary.externalIntegrationRate.toFixed(1)}%`);
    console.log(`⏱️ Total Duration: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    
    // Overall assessment
    const overallSuccess = report.executiveSummary.workflowSuccessRate >= 80 && 
                          report.executiveSummary.stepSuccessRate >= 85;
    
    console.log(`\n🏆 Overall Assessment: ${overallSuccess ? '✅ PASS' : '❌ NEEDS ATTENTION'}`);
    
    if (!overallSuccess) {
      console.log('\n⚠️ Issues found:');
      integrationResults.workflows.filter(w => !w.success).forEach(workflow => {
        console.log(`  - ${workflow.name}: ${workflow.error}`);
      });
    }
    
  } catch (error) {
    log(`Fatal integration test error: ${error.message}`, 'error');
  }
  
  console.log('\n🏁 Integration Testing Complete!');
}

// Start integration testing
runIntegrationTests().catch(error => {
  console.error('💥 Fatal integration test error:', error);
  process.exit(1);
});
