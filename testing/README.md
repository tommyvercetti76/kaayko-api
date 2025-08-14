# 🧪 Kaayko API Comprehensive Test Suite

This directory contains a complete test suite for the Kaayko Firebase Functions API, covering all possible scenarios and edge cases with maximum coverage.

## 📁 Test Files Overview

### 🎯 **Essential Test Scripts**

| File | Purpose | Coverage | Lines |
|------|---------|----------|-------|
| `integration_tests.js` | **End-to-end workflow testing** | User journeys, cross-API integration | 600+ |
| `security_tests.js` | **Security vulnerability testing** | SQL injection, XSS, auth bypass | 600+ |
| `performance_tests.js` | **Load and performance testing** | Response times, throughput, scalability | 700+ |
| `forecast_heatmap_analyzer.js` | **🆕 Forecast API Analytics** | Deep forecast analysis, heatmaps, statistics | 500+ |
| `multi_location_heatmap.js` | **🆕 Multi-Location Heatmaps** | Comparative analysis across all paddling locations | 600+ |

### 🚀 **Execution Scripts**

| File | Purpose | Usage |
|------|---------|-------|
| `run-tests.sh` | **Master test orchestrator** | Runs all test suites with reporting |
| `forecast_heatmap_analyzer.js` | **🆕 Forecast Analytics** | Deep dive analysis with visual heatmaps |

## 🚀 **Quick Start**

### **🏆 Recommended: Master Test Runner**

#### Quick Testing (5 minutes)
```bash
cd tests
./run-tests.sh --quick
```

#### Standard Testing (15 minutes)
```bash
cd tests
./run-tests.sh
```

#### **🆕 Forecast API Deep Analysis**
```bash
cd tests
# Full detailed analysis (2-3 seconds)
node forecast_heatmap_analyzer.js

# Quick analysis (1.7 seconds)
node forecast_heatmap_optimizer.js --fast

# Ultra-fast summary (1 line, 1.8 seconds)
node forecast_heatmap_optimizer.js --minimal --quiet
```

### **🆕 Multi-Location Analysis**
```bash
# Analyze all paddling locations with forecasts
node multi_location_heatmap.js

# Quick analysis with fewer locations (recommended)
node multi_location_heatmap.js --limit 10

# Minimal analysis for fast results
node multi_location_heatmap.js --minimal
```

### **🔧 Individual Test Suites**

#### Integration Testing
```bash
node integration_tests.js --verbose
```

#### Security Assessment
```bash
node security_tests.js --aggressive --report
```

#### Performance Analysis
```bash
node performance_tests.js --users=50 --duration=120000
```

#### **🆕 Forecast Heatmap Analysis**
```bash
# Comprehensive analysis with full heatmap
node forecast_heatmap_analyzer.js

# Quick optimized analysis
node forecast_heatmap_optimizer.js --fast

# Performance modes available:
# --minimal --quiet  (1 line summary)
# --fast            (quick summary)  
# --verbose         (detailed output)
```

## 🎯 **Test Coverage**

### **✅ API Endpoints Tested (8 Total)**

#### 🛍️ **Products API** (`/products`)
- List all products with pagination
- Get specific product by ID
- Vote on products (+1/-1)
- Invalid product ID handling
- Product image access validation
- Large payload handling

#### 🖼️ **Images API** (`/images`)
- Image proxy functionality
- Invalid image request handling
- Path traversal attack prevention
- Access control validation
- Image format support

#### 🏄 **Paddling Out API** (`/paddlingOut`)
- List all paddling spots
- Get specific spot details by ID
- Invalid spot ID handling
- Image fetching integration
- Location data validation

#### 🌊 **Paddle Conditions API** (`/paddleConditions`)
- Weather condition analysis
- Coordinate validation
- Location name queries
- Summary endpoint functionality
- Invalid input handling

#### 🤖 **Paddle Predict API** (`/paddlePredict`)
- ML model predictions
- Model information retrieval
- Forecast endpoint testing
- Report enhancement functionality
- Coordinate validation

#### 📊 **Paddling Report API** (`/paddlingReport`)
- Full condition reports
- Summary report generation
- Best conditions filtering
- Demo report functionality
- Timeout handling

#### 🔗 **Deep Link API** (`/l/:id`, `/resolve`)
- Short link redirection
- Context preservation
- Cookie handling
- Platform detection
- Invalid link handling

#### ❤️ **Health Checks**
- All service health endpoints
- Response time validation
- Service availability monitoring

### **🔒 Security Testing Coverage**

- **SQL Injection**: 15+ payload variations
- **XSS**: 20+ script injection attempts  
- **Path Traversal**: System file access attempts
- **Authentication**: Admin endpoint discovery
- **CORS**: Origin validation testing
- **Rate Limiting**: Effectiveness validation
- **Security Headers**: Required header presence
- **Input Validation**: Malformed data handling

### **⚡ Performance Testing Coverage**

- **Response Times**: Percentile analysis (P50, P90, P95, P99)
- **Throughput**: Requests per second measurement
- **Concurrent Users**: Simulated load testing
- **Memory Usage**: Resource consumption monitoring
- **Cache Effectiveness**: Cache hit ratio analysis
- **Network Performance**: TTFB and download times
- **Stress Testing**: High load scenarios

### **🔄 Integration Testing Coverage**

- **User Journeys**: Complete workflow validation
- **Cross-API**: Data consistency between services
- **External Services**: Weather API and ML service integration
- **Data Flow**: End-to-end data validation
- **Error Propagation**: Failure handling across services
- **Real-World Scenarios**: Actual user behavior simulation

## 📊 **Test Results & Reporting**

### **📋 Result Files Generated**

- `comprehensive_test_results.json` - Detailed API test results
- `security_report.json` - Security vulnerability assessment
- `performance_report.json` - Performance metrics and analysis
- `integration_report.json` - Integration test results
- `edge_case_results.json` - Edge case and stress test results

### **� HTML Reports**

- `security_report.html` - Interactive security assessment
- `performance_report.html` - Performance dashboard
- `comprehensive_test_report_TIMESTAMP.md` - Master summary report

### **🎯 Success Criteria**

#### **Overall API Health**
- ✅ 95%+ success rate across all endpoints
- ✅ Average response time < 2 seconds
- ✅ No critical security vulnerabilities
- ✅ All user workflows complete successfully

#### **Performance Benchmarks**
- ✅ Health checks: < 200ms average
- ✅ Product API: < 500ms average
- ✅ Location API: < 800ms average
- ✅ Weather API: < 2000ms average
- ✅ ML Predictions: < 3000ms average

## 🛠️ **Configuration Options**

### **Environment Variables**
```bash
export BASE_URL="https://api-vwcc5j4qda-uc.a.run.app"  # Target API URL
```

### **Command Line Arguments**

#### **Master Test Runner Options**
- `--quick` - Run essential tests only (5 min)
- `--full` - Run all tests including stress tests (30 min)
- `--report-only` - Generate reports without running tests
- `--baseUrl=URL` - Override target URL

#### **Individual Test Script Options**
- `--verbose` - Detailed logging
- `--baseUrl=URL` - Target URL override
- `--concurrent=N` - Number of concurrent requests
- `--duration=Ms` - Test duration in milliseconds
- `--aggressive` - Enable aggressive testing
- `--report` - Generate detailed reports
- `--memory` - Enable memory monitoring
- `--stress` - Enable stress testing

## 🔍 **Debugging & Troubleshooting**

### **Common Issues & Solutions**

1. **🔌 API Unavailable**
   ```bash
   # Check connectivity
   curl https://api-vwcc5j4qda-uc.a.run.app/health
   ```

2. **⚠️ High Error Rates**
   - Check server logs for errors
   - Verify external service dependencies
   - Review rate limiting configuration

3. **🛡️ Security Test Failures**
   - Review input validation logic
   - Check security header configuration
   - Verify authentication mechanisms

4. **🐌 Performance Issues**
   - Monitor server resources
   - Check database connection pooling
   - Review cache configuration

### **� Legacy Test Suites**

#### **Enhanced Testing**
```bash
node enhanced_test_suite.js
```

#### **Interactive Testing**
```bash
node interactive_test_suite.js
```

#### **Production Testing**
```bash
node production_test_suite.js
```

#### **Legacy Test Runner**
```bash
./run_all_tests.sh
```

## 🔧 **Extending the Test Suite**

### **Adding New Test Cases**
1. Add test functions to appropriate script
2. Update test configuration
3. Include in comprehensive test runner
4. Document new scenarios

### **Custom Test Example**
```javascript
// Add to comprehensive_api_tests.js
await runTest('New Endpoint Test', async () => {
  const response = await makeRequest('/new-endpoint');
  return { 
    success: response.statusCode === 200,
    message: `Response: ${response.statusCode}`
  };
}, 'custom');
```

## 🎯 **Test Philosophy**

This comprehensive test suite follows these principles:
- **Completeness**: Test every endpoint and scenario
- **Realism**: Simulate real user behavior
- **Security**: Probe for vulnerabilities systematically
- **Performance**: Validate under realistic load
- **Integration**: Test cross-service workflows
- **Reliability**: Provide consistent, repeatable results

## 📞 **Support**

For questions or issues with the test suite:
1. Check the logs in `tests/results/`
2. Review this documentation
3. Verify API endpoint availability  
4. Check configuration settings
