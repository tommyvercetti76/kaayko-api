#!/usr/bin/env node

/**
 * 🚨 FRONTEND API FIX VERIFICATION TEST
 * Tests all the fixed API endpoints to ensure frontend integration works
 */

const fetch = require('node-fetch');
const fs = require('fs');

// Test configuration
const CONFIG = {
  emulatorBase: 'http://127.0.0.1:5001/kaaykostore/us-central1',
  testLocation: { lat: 37.7749, lng: -122.4194 }, // San Francisco
  timeout: 10000
};

class FrontendFixTester {
  constructor() {
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async runTest(testName, testFunction) {
    this.results.total++;
    console.log(`\n🧪 Testing: ${testName}`);
    
    try {
      const startTime = Date.now();
      const result = await Promise.race([
        testFunction(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), CONFIG.timeout)
        )
      ]);
      
      const duration = Date.now() - startTime;
      console.log(`✅ ${testName} - PASSED (${duration}ms)`);
      
      this.results.passed++;
      this.results.tests.push({
        name: testName,
        status: 'PASSED',
        duration,
        result
      });
      
      return result;
    } catch (error) {
      console.log(`❌ ${testName} - FAILED: ${error.message}`);
      
      this.results.failed++;
      this.results.tests.push({
        name: testName,
        status: 'FAILED',
        error: error.message
      });
      
      return null;
    }
  }

  // Test 1: Fixed /forecast endpoint (was /paddlePredict/forecast)
  async testForecastEndpoint() {
    const url = `${CONFIG.emulatorBase}/api/forecast?lat=${CONFIG.testLocation.lat}&lng=${CONFIG.testLocation.lng}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Validate response structure
    if (!data || !data.forecast || !Array.isArray(data.forecast)) {
      throw new Error('Invalid forecast response structure');
    }
    
    console.log(`   📊 Forecast data: ${data.forecast.length} days`);
    return data;
  }

  // Test 2: Fixed /paddleScore endpoint (was /paddlePredict)
  async testPaddleScoreEndpoint() {
    const url = `${CONFIG.emulatorBase}/api/paddleScore?location=${CONFIG.testLocation.lat},${CONFIG.testLocation.lng}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Validate response structure
    if (!data || typeof data.score === 'undefined') {
      throw new Error('Invalid paddle score response structure');
    }
    
    console.log(`   🏄 Paddle score: ${data.score}/5.0`);
    return data;
  }

  // Test 3: FastForecast with correct port (was 5002, now 5001)
  async testFastForecastEndpoint() {
    const url = `${CONFIG.emulatorBase}/fastForecast?lat=${CONFIG.testLocation.lat}&lng=${CONFIG.testLocation.lng}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Validate response structure
    if (!data || !data.current) {
      throw new Error('Invalid fast forecast response structure');
    }
    
    console.log(`   ⚡ Fast forecast: Current conditions + ${data.forecast ? data.forecast.length : 0} days`);
    return data;
  }

  // Test 4: Verify frontend API client file has correct URLs
  async testFrontendApiClientFile() {
    const filePath = '/Users/Rohan/Desktop/kaayko-stable/kaayko-frontend/src/js/services/apiClient.js';
    
    if (!fs.existsSync(filePath)) {
      throw new Error('Frontend API client file not found');
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for fixed endpoints
    const checks = [
      { pattern: '/forecast?lat=', description: 'Fixed forecast endpoint' },
      { pattern: '/paddleScore?location=', description: 'Fixed paddle score endpoint' },
      { pattern: '127.0.0.1:5001', description: 'Correct emulator port' },
      { pattern: 'paddlePredict/forecast', description: 'Old forecast endpoint (should NOT exist)', shouldNotExist: true },
      { pattern: '/paddlePredict?lat=', description: 'Old paddle predict endpoint (should NOT exist)', shouldNotExist: true }
    ];
    
    const results = [];
    for (const check of checks) {
      const found = content.includes(check.pattern);
      const passed = check.shouldNotExist ? !found : found;
      
      if (passed) {
        console.log(`   ✅ ${check.description}`);
      } else {
        console.log(`   ❌ ${check.description}`);
        throw new Error(`Frontend API client validation failed: ${check.description}`);
      }
      
      results.push({ check: check.description, passed });
    }
    
    return { checks: results.length, passed: results.filter(r => r.passed).length };
  }

  // Test 5: End-to-end simulation of frontend API calls
  async testFrontendSimulation() {
    console.log('   🎭 Simulating frontend API call sequence...');
    
    // Simulate the typical frontend flow:
    // 1. Try fastForecast (main call)
    const fastForecast = await this.testFastForecastEndpoint();
    
    // 2. If that worked, try fallback methods too
    const forecast = await this.testForecastEndpoint();
    const paddleScore = await this.testPaddleScoreEndpoint();
    
    return {
      fastForecast: !!fastForecast,
      forecast: !!forecast,
      paddleScore: !!paddleScore,
      allWorking: !!(fastForecast && forecast && paddleScore)
    };
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 FRONTEND API FIX TEST SUMMARY');
    console.log('='.repeat(60));
    
    console.log(`📊 Total Tests: ${this.results.total}`);
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`📈 Success Rate: ${((this.results.passed / this.results.total) * 100).toFixed(1)}%`);
    
    if (this.results.failed === 0) {
      console.log('\n🎉 ALL FRONTEND API FIXES WORKING CORRECTLY!');
      console.log('✅ Frontend is now compatible with backend APIs');
      console.log('🚀 Ready for deployment!');
    } else {
      console.log('\n🚨 SOME TESTS FAILED - NEEDS ATTENTION');
      console.log('❌ Frontend may have remaining compatibility issues');
    }
    
    console.log('\n📋 DETAILED RESULTS:');
    this.results.tests.forEach(test => {
      const icon = test.status === 'PASSED' ? '✅' : '❌';
      const duration = test.duration ? ` (${test.duration}ms)` : '';
      const error = test.error ? ` - ${test.error}` : '';
      console.log(`${icon} ${test.name}${duration}${error}`);
    });
  }
}

// Run the comprehensive test
async function main() {
  console.log('🚨 FRONTEND API FIX VERIFICATION TEST');
  console.log('Testing all fixed API endpoints and frontend integration...\n');
  
  const tester = new FrontendFixTester();
  
  // Run all tests
  await tester.runTest('Fixed Forecast API (/forecast)', () => tester.testForecastEndpoint());
  await tester.runTest('Fixed Paddle Score API (/paddleScore)', () => tester.testPaddleScoreEndpoint());
  await tester.runTest('FastForecast with Correct Port (5001)', () => tester.testFastForecastEndpoint());
  await tester.runTest('Frontend API Client File Validation', () => tester.testFrontendApiClientFile());
  await tester.runTest('End-to-End Frontend Simulation', () => tester.testFrontendSimulation());
  
  tester.printSummary();
  
  // Exit with appropriate code
  process.exit(tester.results.failed === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Test runner failed:', error.message);
    process.exit(1);
  });
}

module.exports = FrontendFixTester;
