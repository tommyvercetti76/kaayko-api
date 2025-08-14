#!/usr/bin/env node
/**
 * API Security & Penetration Test Suite
 * 
 * This specialized test suite focuses on security vulnerabilities:
 * - SQL Injection attempts
 * - XSS (Cross-Site Scripting) tests
 * - Path traversal attacks
 * - Authentication bypass attempts
 * - CORS security validation
 * - Rate limiting effectiveness
 * - Input sanitization testing
 * 
 * Usage: node security_tests.js [--aggressive] [--report]
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const BASE_URL = process.env.BASE_URL || 'https://api-vwcc5j4qda-uc.a.run.app';
const AGGRESSIVE_MODE = process.argv.includes('--aggressive');
const GENERATE_REPORT = process.argv.includes('--report');

console.log(`🔒 API Security & Penetration Test Suite`);
console.log(`🎯 Target: ${BASE_URL}`);
console.log(`⚔️ Aggressive Mode: ${AGGRESSIVE_MODE ? 'ON' : 'OFF'}`);
console.log(`📄 Generate Report: ${GENERATE_REPORT ? 'ON' : 'OFF'}`);
console.log('=' .repeat(80));

// Security test results
const securityResults = {
  summary: {
    totalTests: 0,
    vulnerabilitiesFound: 0,
    securityIssues: [],
    recommendations: []
  },
  injectionTests: [],
  xssTests: [],
  pathTraversalTests: [],
  authTests: [],
  corsTests: [],
  rateLimitTests: [],
  inputValidationTests: [],
  headerSecurityTests: []
};

// Utility functions
function log(message, level = 'info') {
  const symbols = { 
    info: '📋', 
    success: '✅', 
    error: '❌', 
    warning: '⚠️', 
    critical: '🚨',
    vulnerability: '🔓'
  };
  console.log(`${symbols[level] || '📋'} ${message}`);
}

function makeSecureRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Kaayko-SecurityTest/1.0',
        'Accept': 'application/json',
        ...options.headers
      },
      timeout: options.timeout || 10000
    };
    
    // Log pretty-printed request details if aggressive mode
    if (AGGRESSIVE_MODE) {
      console.log('\n🔒 SECURITY REQUEST:');
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
          url,
          request: requestOptions
        };
        
        // Log pretty-printed response details if aggressive mode
        if (AGGRESSIVE_MODE) {
          console.log('\n🛡️ SECURITY RESPONSE:');
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
          console.log('🔒' + '─'.repeat(79));
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

function addSecurityIssue(severity, category, description, details) {
  securityResults.summary.securityIssues.push({
    severity,
    category,
    description,
    details,
    timestamp: new Date().toISOString()
  });
  
  if (severity === 'HIGH' || severity === 'CRITICAL') {
    securityResults.summary.vulnerabilitiesFound++;
    log(`🚨 ${severity} SECURITY ISSUE: ${description}`, 'critical');
  } else {
    log(`⚠️ ${severity} Security concern: ${description}`, 'warning');
  }
}

function addRecommendation(recommendation) {
  securityResults.summary.recommendations.push(recommendation);
  log(`💡 Recommendation: ${recommendation}`, 'info');
}

// ============================================================================
// SQL INJECTION TESTS
// ============================================================================

async function testSQLInjection() {
  log('💉 Testing SQL Injection Vulnerabilities', 'info');
  
  const sqlPayloads = [
    "' OR '1'='1",
    "' OR 1=1--",
    "' UNION SELECT * FROM users--",
    "'; DROP TABLE users;--",
    "' OR 1=1#",
    "admin'--",
    "admin' /*",
    "' or 1=1 limit 1 --",
    "1' AND SUBSTRING(@@version,1,1)='5",
    "' WAITFOR DELAY '00:00:05'--",
    // NoSQL injection attempts
    "{'$ne': null}",
    "{'$gt': ''}",
    "true, $where: '1 == 1'",
    // Boolean-based blind
    "' AND (SELECT COUNT(*) FROM information_schema.tables)>0--"
  ];
  
  const testEndpoints = [
    '/products/{PAYLOAD}',
    '/paddlingOut/{PAYLOAD}',
    '/paddleConditions?location={PAYLOAD}',
    '/paddleConditions?lat={PAYLOAD}&lng=-120',
    '/images/{PAYLOAD}/test.jpg'
  ];
  
  for (const payload of sqlPayloads) {
    for (const endpoint of testEndpoints) {
      securityResults.summary.totalTests++;
      
      try {
        const testUrl = `${BASE_URL}${endpoint.replace('{PAYLOAD}', encodeURIComponent(payload))}`;
        const response = await makeSecureRequest(testUrl);
        
        const result = {
          payload,
          endpoint,
          statusCode: response.statusCode,
          duration: response.duration,
          vulnerable: false,
          details: {}
        };
        
        // Check for potential SQL injection indicators
        const responseBody = response.body.toLowerCase();
        const sqlErrorIndicators = [
          'sql syntax',
          'mysql_fetch',
          'ora-01756',
          'microsoft ole db',
          'odbc sql server driver',
          'postgresql error',
          'warning: mysql',
          'valid mysql result',
          'mysqlclient.constants.er',
          'syntax error in query',
          'firestore',
          'mongodb',
          'collection'
        ];
        
        const foundIndicators = sqlErrorIndicators.filter(indicator => 
          responseBody.includes(indicator)
        );
        
        if (foundIndicators.length > 0) {
          result.vulnerable = true;
          result.details.indicators = foundIndicators;
          addSecurityIssue(
            'HIGH',
            'SQL Injection',
            `Potential SQL injection vulnerability in ${endpoint}`,
            { payload, indicators: foundIndicators, response: response.body.substring(0, 500) }
          );
        }
        
        // Check for unusual response times (potential time-based injection)
        if (response.duration > 5000) {
          result.details.suspiciousDelay = true;
          addSecurityIssue(
            'MEDIUM',
            'SQL Injection',
            `Unusual response delay (${response.duration}ms) for payload in ${endpoint}`,
            { payload, duration: response.duration }
          );
        }
        
        // Check for information disclosure
        if (response.statusCode === 200 && responseBody.includes('error')) {
          result.details.possibleInfoDisclosure = true;
        }
        
        securityResults.injectionTests.push(result);
        
      } catch (error) {
        securityResults.injectionTests.push({
          payload,
          endpoint,
          error: error.message,
          vulnerable: false
        });
      }
    }
  }
  
  const vulnerableInjections = securityResults.injectionTests.filter(t => t.vulnerable);
  log(`SQL Injection Tests: ${vulnerableInjections.length} potential vulnerabilities found`, 
      vulnerableInjections.length > 0 ? 'critical' : 'success');
}

// ============================================================================
// XSS (CROSS-SITE SCRIPTING) TESTS
// ============================================================================

async function testXSS() {
  log('🕸️ Testing XSS Vulnerabilities', 'info');
  
  const xssPayloads = [
    '<script>alert("XSS")</script>',
    '<img src=x onerror=alert("XSS")>',
    '<svg onload=alert("XSS")>',
    'javascript:alert("XSS")',
    '<iframe src="javascript:alert(\'XSS\')"></iframe>',
    '<body onload=alert("XSS")>',
    '<input onfocus=alert("XSS") autofocus>',
    '<select onfocus=alert("XSS") autofocus>',
    '<textarea onfocus=alert("XSS") autofocus>',
    '<keygen onfocus=alert("XSS") autofocus>',
    '<video><source onerror="alert(\'XSS\')">',
    '<audio src=x onerror=alert("XSS")>',
    '"><script>alert("XSS")</script>',
    "'><script>alert('XSS')</script>",
    '<script>alert(String.fromCharCode(88,83,83))</script>',
    '<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgiWFNTIik8L3NjcmlwdD4=">',
    // React/JSX specific
    'javascript:alert`XSS`',
    '${alert("XSS")}',
    '{alert("XSS")}',
    // URL-based XSS
    'data:text/html,<script>alert("XSS")</script>',
    'vbscript:msgbox("XSS")'
  ];
  
  const xssEndpoints = [
    '/paddleConditions?location={PAYLOAD}',
    '/products/{PAYLOAD}',
    '/paddlingOut/{PAYLOAD}',
    '/l/{PAYLOAD}', // Deep link endpoint
    '/resolve?id={PAYLOAD}'
  ];
  
  for (const payload of xssPayloads) {
    for (const endpoint of xssEndpoints) {
      securityResults.summary.totalTests++;
      
      try {
        const testUrl = `${BASE_URL}${endpoint.replace('{PAYLOAD}', encodeURIComponent(payload))}`;
        const response = await makeSecureRequest(testUrl);
        
        const result = {
          payload,
          endpoint,
          statusCode: response.statusCode,
          vulnerable: false,
          details: {}
        };
        
        // Check if payload is reflected in response without proper encoding
        const unescapedPayload = payload.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
        
        if (response.body.includes(unescapedPayload) || response.body.includes(payload)) {
          result.vulnerable = true;
          result.details.reflection = true;
          addSecurityIssue(
            'HIGH',
            'XSS',
            `Potential XSS vulnerability - unescaped payload reflection in ${endpoint}`,
            { payload, response: response.body.substring(0, 500) }
          );
        }
        
        // Check for unsafe content-type
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html') && !contentType.includes('charset')) {
          result.details.unsafeContentType = true;
          addSecurityIssue(
            'MEDIUM',
            'XSS',
            `Missing charset in HTML content-type for ${endpoint}`,
            { contentType }
          );
        }
        
        securityResults.xssTests.push(result);
        
      } catch (error) {
        securityResults.xssTests.push({
          payload,
          endpoint,
          error: error.message,
          vulnerable: false
        });
      }
    }
  }
  
  const vulnerableXSS = securityResults.xssTests.filter(t => t.vulnerable);
  log(`XSS Tests: ${vulnerableXSS.length} potential vulnerabilities found`, 
      vulnerableXSS.length > 0 ? 'critical' : 'success');
}

// ============================================================================
// PATH TRAVERSAL TESTS
// ============================================================================

async function testPathTraversal() {
  log('📁 Testing Path Traversal Vulnerabilities', 'info');
  
  const pathPayloads = [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\system32\\drivers\\etc\\hosts',
    '../../../proc/version',
    '../../../etc/shadow',
    '../../../../etc/passwd',
    '..%2F..%2F..%2Fetc%2Fpasswd',
    '..%252F..%252F..%252Fetc%252Fpasswd',
    '....//....//....//etc/passwd',
    '..\\..\\..\\..\\.\\etc\\passwd',
    '/etc/passwd',
    '\\etc\\passwd',
    'file:///etc/passwd',
    // Firebase/GCP specific
    '../../../app.yaml',
    '../../../package.json',
    '../../../.env',
    '../../../config/database.yml',
    // Node.js specific
    '../../../node_modules/express/package.json',
    '../../../src/config/secrets.js'
  ];
  
  const pathEndpoints = [
    '/images/{PAYLOAD}/test.jpg',
    '/products/{PAYLOAD}',
    '/paddlingOut/{PAYLOAD}',
    '/l/{PAYLOAD}'
  ];
  
  for (const payload of pathPayloads) {
    for (const endpoint of pathEndpoints) {
      securityResults.summary.totalTests++;
      
      try {
        const testUrl = `${BASE_URL}${endpoint.replace('{PAYLOAD}', encodeURIComponent(payload))}`;
        const response = await makeSecureRequest(testUrl);
        
        const result = {
          payload,
          endpoint,
          statusCode: response.statusCode,
          vulnerable: false,
          details: {}
        };
        
        // Check for system file indicators
        const systemFileIndicators = [
          'root:x:0:0:',  // /etc/passwd
          '127.0.0.1',    // hosts file
          'Linux version', // /proc/version
          'Microsoft Windows', // Windows system files
          '"name": "express"', // Node.js package.json
          'runtime: nodejs', // app.yaml
          'DATABASE_URL' // .env files
        ];
        
        const foundIndicators = systemFileIndicators.filter(indicator => 
          response.body.includes(indicator)
        );
        
        if (foundIndicators.length > 0) {
          result.vulnerable = true;
          result.details.indicators = foundIndicators;
          addSecurityIssue(
            'CRITICAL',
            'Path Traversal',
            `Path traversal vulnerability - system file access in ${endpoint}`,
            { payload, indicators: foundIndicators, response: response.body.substring(0, 500) }
          );
        }
        
        // Check for directory listing
        if (response.body.includes('Index of') || response.body.includes('<directory>')) {
          result.vulnerable = true;
          result.details.directoryListing = true;
          addSecurityIssue(
            'HIGH',
            'Path Traversal',
            `Directory listing exposed in ${endpoint}`,
            { payload }
          );
        }
        
        securityResults.pathTraversalTests.push(result);
        
      } catch (error) {
        securityResults.pathTraversalTests.push({
          payload,
          endpoint,
          error: error.message,
          vulnerable: false
        });
      }
    }
  }
  
  const vulnerablePathTraversal = securityResults.pathTraversalTests.filter(t => t.vulnerable);
  log(`Path Traversal Tests: ${vulnerablePathTraversal.length} vulnerabilities found`, 
      vulnerablePathTraversal.length > 0 ? 'critical' : 'success');
}

// ============================================================================
// AUTHENTICATION AND AUTHORIZATION TESTS
// ============================================================================

async function testAuthentication() {
  log('🔐 Testing Authentication & Authorization', 'info');
  
  const authTests = [
    {
      name: 'Admin endpoint access',
      url: `${BASE_URL}/admin`,
      expectedStatus: 404
    },
    {
      name: 'Admin users endpoint',
      url: `${BASE_URL}/admin/users`,
      expectedStatus: 404
    },
    {
      name: 'Config endpoint',
      url: `${BASE_URL}/config`,
      expectedStatus: 404
    },
    {
      name: 'API key endpoint',
      url: `${BASE_URL}/api-keys`,
      expectedStatus: 404
    },
    {
      name: 'Internal endpoint',
      url: `${BASE_URL}/internal`,
      expectedStatus: 404
    },
    {
      name: 'Debug endpoint',
      url: `${BASE_URL}/debug`,
      expectedStatus: 404
    },
    {
      name: 'Test endpoint',
      url: `${BASE_URL}/test`,
      expectedStatus: 404
    }
  ];
  
  // Test for exposed admin/debug endpoints
  for (const test of authTests) {
    securityResults.summary.totalTests++;
    
    try {
      const response = await makeSecureRequest(test.url);
      
      const result = {
        test: test.name,
        url: test.url,
        statusCode: response.statusCode,
        expectedStatus: test.expectedStatus,
        vulnerable: false
      };
      
      if (response.statusCode === 200) {
        result.vulnerable = true;
        addSecurityIssue(
          'HIGH',
          'Authentication',
          `Exposed endpoint: ${test.name}`,
          { url: test.url, response: response.body.substring(0, 200) }
        );
      } else if (response.statusCode !== test.expectedStatus) {
        result.unexpectedStatus = true;
        addSecurityIssue(
          'MEDIUM',
          'Authentication',
          `Unexpected response for ${test.name}: ${response.statusCode}`,
          { url: test.url, expected: test.expectedStatus }
        );
      }
      
      securityResults.authTests.push(result);
      
    } catch (error) {
      securityResults.authTests.push({
        test: test.name,
        url: test.url,
        error: error.message,
        vulnerable: false
      });
    }
  }
  
  // Test for JWT token handling
  await testJWTSecurity();
  
  const vulnerableAuth = securityResults.authTests.filter(t => t.vulnerable);
  log(`Authentication Tests: ${vulnerableAuth.length} issues found`, 
      vulnerableAuth.length > 0 ? 'warning' : 'success');
}

async function testJWTSecurity() {
  const jwtTests = [
    {
      name: 'Invalid JWT token',
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature'
    },
    {
      name: 'None algorithm JWT',
      token: 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.'
    },
    {
      name: 'Expired JWT',
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjN9.invalid'
    }
  ];
  
  for (const jwtTest of jwtTests) {
    securityResults.summary.totalTests++;
    
    try {
      const response = await makeSecureRequest(`${BASE_URL}/products`, {
        headers: {
          'Authorization': `Bearer ${jwtTest.token}`
        }
      });
      
      // Check if invalid tokens are properly rejected
      if (response.statusCode === 200) {
        addSecurityIssue(
          'MEDIUM',
          'Authentication',
          `Invalid JWT token accepted: ${jwtTest.name}`,
          { token: jwtTest.token.substring(0, 50) + '...' }
        );
      }
      
    } catch (error) {
      // Expected behavior for invalid tokens
    }
  }
}

// ============================================================================
// CORS SECURITY TESTS
// ============================================================================

async function testCORSSecurity() {
  log('🌐 Testing CORS Security', 'info');
  
  const corsTests = [
    {
      name: 'Wildcard origin test',
      origin: '*'
    },
    {
      name: 'Malicious origin test',
      origin: 'https://evil.com'
    },
    {
      name: 'Null origin test',
      origin: 'null'
    },
    {
      name: 'Localhost origin test',
      origin: 'http://localhost:3000'
    },
    {
      name: 'Valid origin test',
      origin: 'https://kaayko.com'
    }
  ];
  
  for (const corsTest of corsTests) {
    securityResults.summary.totalTests++;
    
    try {
      const response = await makeSecureRequest(`${BASE_URL}/products`, {
        method: 'OPTIONS',
        headers: {
          'Origin': corsTest.origin,
          'Access-Control-Request-Method': 'GET'
        }
      });
      
      const result = {
        test: corsTest.name,
        origin: corsTest.origin,
        statusCode: response.statusCode,
        allowOrigin: response.headers['access-control-allow-origin'],
        vulnerable: false
      };
      
      // Check for dangerous CORS configurations
      if (response.headers['access-control-allow-origin'] === '*' && 
          response.headers['access-control-allow-credentials'] === 'true') {
        result.vulnerable = true;
        addSecurityIssue(
          'HIGH',
          'CORS',
          'Dangerous CORS configuration: wildcard origin with credentials',
          { allowOrigin: response.headers['access-control-allow-origin'] }
        );
      }
      
      if (corsTest.origin === 'https://evil.com' && 
          response.headers['access-control-allow-origin'] === corsTest.origin) {
        result.vulnerable = true;
        addSecurityIssue(
          'MEDIUM',
          'CORS',
          'CORS allows potentially malicious origin',
          { origin: corsTest.origin }
        );
      }
      
      securityResults.corsTests.push(result);
      
    } catch (error) {
      securityResults.corsTests.push({
        test: corsTest.name,
        origin: corsTest.origin,
        error: error.message,
        vulnerable: false
      });
    }
  }
  
  const vulnerableCORS = securityResults.corsTests.filter(t => t.vulnerable);
  log(`CORS Tests: ${vulnerableCORS.length} issues found`, 
      vulnerableCORS.length > 0 ? 'warning' : 'success');
}

// ============================================================================
// RATE LIMITING EFFECTIVENESS TESTS
// ============================================================================

async function testRateLimitingEffectiveness() {
  log('⚡ Testing Rate Limiting Effectiveness', 'info');
  
  if (!AGGRESSIVE_MODE) {
    log('Skipping aggressive rate limit tests (use --aggressive to enable)', 'info');
    return;
  }
  
  const rateLimitEndpoints = [
    '/paddleConditions/health',
    '/products',
    '/paddlingOut',
    '/paddlePredict/health'
  ];
  
  for (const endpoint of rateLimitEndpoints) {
    securityResults.summary.totalTests++;
    
    try {
      const requests = [];
      const testUrl = `${BASE_URL}${endpoint}`;
      
      // Send 50 rapid requests
      for (let i = 0; i < 50; i++) {
        requests.push(makeSecureRequest(testUrl));
      }
      
      const responses = await Promise.allSettled(requests);
      const statusCodes = responses.map(r => r.value?.statusCode || 0);
      const rateLimited = statusCodes.filter(code => code === 429).length;
      const successful = statusCodes.filter(code => code === 200).length;
      
      const result = {
        endpoint,
        totalRequests: 50,
        successful,
        rateLimited,
        rateLimitEffective: rateLimited > 0
      };
      
      if (rateLimited === 0 && successful > 40) {
        result.vulnerable = true;
        addSecurityIssue(
          'MEDIUM',
          'Rate Limiting',
          `Rate limiting may be ineffective for ${endpoint}`,
          { successful: successful, rateLimited: rateLimited }
        );
      }
      
      securityResults.rateLimitTests.push(result);
      
    } catch (error) {
      securityResults.rateLimitTests.push({
        endpoint,
        error: error.message,
        vulnerable: false
      });
    }
  }
  
  const ineffectiveRateLimit = securityResults.rateLimitTests.filter(t => t.vulnerable);
  log(`Rate Limiting Tests: ${ineffectiveRateLimit.length} potential issues found`, 
      ineffectiveRateLimit.length > 0 ? 'warning' : 'success');
}

// ============================================================================
// SECURITY HEADERS ANALYSIS
// ============================================================================

async function testSecurityHeaders() {
  log('🛡️ Testing Security Headers', 'info');
  
  const testEndpoints = [
    '/products',
    '/paddleConditions/health',
    '/paddlingOut'
  ];
  
  const requiredHeaders = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': ['DENY', 'SAMEORIGIN'],
    'x-xss-protection': '1; mode=block',
    'strict-transport-security': true, // Should be present
    'content-security-policy': true,
    'referrer-policy': true
  };
  
  for (const endpoint of testEndpoints) {
    securityResults.summary.totalTests++;
    
    try {
      const response = await makeSecureRequest(`${BASE_URL}${endpoint}`);
      
      const result = {
        endpoint,
        headers: response.headers,
        missingHeaders: [],
        weakHeaders: [],
        score: 0
      };
      
      // Check each required security header
      for (const [headerName, expectedValue] of Object.entries(requiredHeaders)) {
        const actualValue = response.headers[headerName.toLowerCase()];
        
        if (!actualValue) {
          result.missingHeaders.push(headerName);
          addSecurityIssue(
            'MEDIUM',
            'Security Headers',
            `Missing security header: ${headerName} in ${endpoint}`,
            { endpoint }
          );
        } else if (Array.isArray(expectedValue)) {
          if (!expectedValue.includes(actualValue)) {
            result.weakHeaders.push({
              header: headerName,
              actual: actualValue,
              expected: expectedValue
            });
          } else {
            result.score++;
          }
        } else if (typeof expectedValue === 'string') {
          if (actualValue !== expectedValue) {
            result.weakHeaders.push({
              header: headerName,
              actual: actualValue,
              expected: expectedValue
            });
          } else {
            result.score++;
          }
        } else if (expectedValue === true) {
          result.score++;
        }
      }
      
      securityResults.headerSecurityTests.push(result);
      
    } catch (error) {
      securityResults.headerSecurityTests.push({
        endpoint,
        error: error.message
      });
    }
  }
  
  const headerIssues = securityResults.headerSecurityTests.reduce(
    (sum, test) => sum + (test.missingHeaders?.length || 0) + (test.weakHeaders?.length || 0), 0
  );
  
  log(`Security Headers Tests: ${headerIssues} issues found`, 
      headerIssues > 0 ? 'warning' : 'success');
}

// ============================================================================
// GENERATE SECURITY REPORT
// ============================================================================

function generateSecurityReport() {
  if (!GENERATE_REPORT) return;
  
  log('📄 Generating Security Report', 'info');
  
  const report = {
    ...securityResults,
    metadata: {
      target: BASE_URL,
      testDate: new Date().toISOString(),
      aggressiveMode: AGGRESSIVE_MODE,
      testDuration: Date.now() - startTime
    },
    executiveSummary: generateExecutiveSummary()
  };
  
  const reportPath = path.join(__dirname, 'security_report.json');
  const htmlReportPath = path.join(__dirname, 'security_report.html');
  
  try {
    // Save JSON report
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    // Generate HTML report
    const htmlReport = generateHTMLReport(report);
    fs.writeFileSync(htmlReportPath, htmlReport);
    
    log(`Security report saved to: ${reportPath}`, 'success');
    log(`HTML report saved to: ${htmlReportPath}`, 'success');
  } catch (error) {
    log(`Failed to save security report: ${error.message}`, 'error');
  }
}

function generateExecutiveSummary() {
  const totalVulnerabilities = securityResults.summary.vulnerabilitiesFound;
  const totalTests = securityResults.summary.totalTests;
  const securityScore = Math.max(0, 100 - (totalVulnerabilities * 10));
  
  return {
    securityScore,
    totalTests,
    totalVulnerabilities,
    riskLevel: totalVulnerabilities === 0 ? 'LOW' : totalVulnerabilities < 3 ? 'MEDIUM' : 'HIGH',
    keyFindings: securityResults.summary.securityIssues.slice(0, 5),
    topRecommendations: securityResults.summary.recommendations.slice(0, 3)
  };
}

function generateHTMLReport(report) {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>Kaayko API Security Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #2c3e50; color: white; padding: 20px; border-radius: 5px; }
        .summary { background: #ecf0f1; padding: 15px; margin: 20px 0; border-radius: 5px; }
        .critical { color: #e74c3c; }
        .high { color: #f39c12; }
        .medium { color: #f1c40f; }
        .low { color: #27ae60; }
        .vulnerability { background: #f8f9fa; border-left: 4px solid #e74c3c; padding: 10px; margin: 10px 0; }
        .recommendation { background: #e8f5e8; border-left: 4px solid #27ae60; padding: 10px; margin: 10px 0; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔒 Kaayko API Security Assessment Report</h1>
        <p>Target: ${report.metadata.target}</p>
        <p>Test Date: ${report.metadata.testDate}</p>
    </div>
    
    <div class="summary">
        <h2>Executive Summary</h2>
        <p><strong>Security Score:</strong> ${report.executiveSummary.securityScore}/100</p>
        <p><strong>Risk Level:</strong> <span class="${report.executiveSummary.riskLevel.toLowerCase()}">${report.executiveSummary.riskLevel}</span></p>
        <p><strong>Total Tests:</strong> ${report.executiveSummary.totalTests}</p>
        <p><strong>Vulnerabilities Found:</strong> ${report.executiveSummary.totalVulnerabilities}</p>
    </div>
    
    <h2>🚨 Security Issues</h2>
    ${report.summary.securityIssues.map(issue => `
        <div class="vulnerability">
            <h3 class="${issue.severity.toLowerCase()}">${issue.severity}: ${issue.description}</h3>
            <p><strong>Category:</strong> ${issue.category}</p>
            <p><strong>Details:</strong> ${JSON.stringify(issue.details, null, 2)}</p>
        </div>
    `).join('')}
    
    <h2>💡 Recommendations</h2>
    ${report.summary.recommendations.map(rec => `
        <div class="recommendation">
            <p>${rec}</p>
        </div>
    `).join('')}
    
    <h2>📊 Test Results Summary</h2>
    <table>
        <tr><th>Test Category</th><th>Tests Run</th><th>Vulnerabilities</th></tr>
        <tr><td>SQL Injection</td><td>${report.injectionTests.length}</td><td>${report.injectionTests.filter(t => t.vulnerable).length}</td></tr>
        <tr><td>XSS</td><td>${report.xssTests.length}</td><td>${report.xssTests.filter(t => t.vulnerable).length}</td></tr>
        <tr><td>Path Traversal</td><td>${report.pathTraversalTests.length}</td><td>${report.pathTraversalTests.filter(t => t.vulnerable).length}</td></tr>
        <tr><td>Authentication</td><td>${report.authTests.length}</td><td>${report.authTests.filter(t => t.vulnerable).length}</td></tr>
        <tr><td>CORS</td><td>${report.corsTests.length}</td><td>${report.corsTests.filter(t => t.vulnerable).length}</td></tr>
    </table>
</body>
</html>`;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

const startTime = Date.now();

async function runSecurityTests() {
  try {
    // Add standard security recommendations
    addRecommendation('Implement input validation and sanitization for all user inputs');
    addRecommendation('Use parameterized queries to prevent SQL injection');
    addRecommendation('Implement proper output encoding to prevent XSS');
    addRecommendation('Add comprehensive security headers');
    addRecommendation('Implement rate limiting on all public endpoints');
    addRecommendation('Use HTTPS everywhere and implement HSTS');
    
    // Run security tests
    await testSQLInjection();
    await testXSS();
    await testPathTraversal();
    await testAuthentication();
    await testCORSSecurity();
    await testRateLimitingEffectiveness();
    await testSecurityHeaders();
    
    // Generate final report
    generateSecurityReport();
    
    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('🔒 SECURITY TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`🎯 Target: ${BASE_URL}`);
    console.log(`📊 Total Tests: ${securityResults.summary.totalTests}`);
    console.log(`🚨 Vulnerabilities: ${securityResults.summary.vulnerabilitiesFound}`);
    console.log(`⚠️ Security Issues: ${securityResults.summary.securityIssues.length}`);
    console.log(`💡 Recommendations: ${securityResults.summary.recommendations.length}`);
    
    const securityScore = Math.max(0, 100 - (securityResults.summary.vulnerabilitiesFound * 10));
    console.log(`🏆 Security Score: ${securityScore}/100`);
    
    if (securityResults.summary.vulnerabilitiesFound === 0) {
      console.log('✅ No critical vulnerabilities found!');
    } else {
      console.log(`❌ ${securityResults.summary.vulnerabilitiesFound} vulnerabilities need attention`);
    }
    
  } catch (error) {
    log(`Fatal security test error: ${error.message}`, 'critical');
  }
  
  console.log('\n🏁 Security Testing Complete!');
}

// Start security testing
runSecurityTests().catch(error => {
  console.error('💥 Fatal security test error:', error);
  process.exit(1);
});
