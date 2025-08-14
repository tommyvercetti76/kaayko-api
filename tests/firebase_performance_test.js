const https = require('https');

// Test configuration
const FIREBASE_PROJECT = 'kaaykostore';
const CURRENT_API = 'https://api-vwcc5j4qda-uc.a.run.app';
const FIREBASE_FUNCTIONS_BASE = `https://us-central1-${FIREBASE_PROJECT}.cloudfunctions.net`;

// Test locations
const TEST_LOCATIONS = [
    { id: 'merrimack', lat: 42.88141, lng: -71.47342, name: 'Merrimack River' },
    { id: 'cottonwood', lat: 38.781063, lng: -106.277812, name: 'Cottonwood Lake' },
    { id: 'union', lat: 47.627413, lng: -122.338984, name: 'Lake Union' }
];

/**
 * Make HTTP request and measure response time
 */
function makeRequest(url, description) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        const req = https.request(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const responseTime = Date.now() - startTime;
                try {
                    const json = JSON.parse(data);
                    resolve({
                        url,
                        description,
                        responseTime,
                        statusCode: res.statusCode,
                        success: json.success || res.statusCode === 200,
                        cached: json.metadata?.cached || false,
                        source: json.metadata?.source || 'unknown',
                        forecastDays: json.forecast ? json.forecast.length : 0
                    });
                } catch (error) {
                    resolve({
                        url,
                        description,
                        responseTime,
                        statusCode: res.statusCode,
                        success: false,
                        error: 'Invalid JSON response',
                        rawResponse: data.substring(0, 200)
                    });
                }
            });
        });

        req.on('error', (error) => {
            const responseTime = Date.now() - startTime;
            resolve({
                url,
                description,
                responseTime,
                statusCode: 0,
                success: false,
                error: error.message
            });
        });

        req.setTimeout(15000, () => {
            req.destroy();
            const responseTime = Date.now() - startTime;
            resolve({
                url,
                description,
                responseTime,
                statusCode: 0,
                success: false,
                error: 'Request timeout (15s)'
            });
        });
        
        req.end();
    });
}

/**
 * Performance comparison test
 */
async function runPerformanceTest() {
    console.log('🚀 Firebase vs Current API Performance Test\n');
    console.log('=' * 60);
    
    const results = {
        currentAPI: [],
        firebaseAPI: [],
        comparison: {}
    };

    // Test current API (slow)
    console.log('\n📊 Testing Current API (External + ML Service)...');
    console.log('-'.repeat(50));
    
    for (const location of TEST_LOCATIONS) {
        const url = `${CURRENT_API}/paddlePredict/forecast?lat=${location.lat}&lng=${location.lng}`;
        const result = await makeRequest(url, `Current API - ${location.name}`);
        results.currentAPI.push(result);
        
        const status = result.success ? '✅' : '❌';
        const time = result.responseTime;
        console.log(`${status} ${location.name}: ${time}ms${result.cached ? ' (cached)' : ''}`);
        
        if (!result.success) {
            console.log(`   Error: ${result.error || 'Unknown error'}`);
        }
        
        // Add delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Test Firebase cached API (fast)
    console.log('\n⚡ Testing Firebase Cached API...');
    console.log('-'.repeat(50));
    
    for (const location of TEST_LOCATIONS) {
        // Test with location ID (if cache exists)
        const urlById = `${FIREBASE_FUNCTIONS_BASE}/fastForecast/${location.id}`;
        const resultById = await makeRequest(urlById, `Firebase API (ID) - ${location.name}`);
        
        const status = resultById.success ? '✅' : '❌';
        const time = resultById.responseTime;
        console.log(`${status} ${location.name} (by ID): ${time}ms${resultById.cached ? ' (cached)' : ''}`);
        
        if (!resultById.success) {
            // Fallback to coordinates
            const urlByCoords = `${FIREBASE_FUNCTIONS_BASE}/fastForecast?lat=${location.lat}&lng=${location.lng}`;
            const resultByCoords = await makeRequest(urlByCoords, `Firebase API (coords) - ${location.name}`);
            
            const statusCoords = resultByCoords.success ? '✅' : '❌';
            const timeCoords = resultByCoords.responseTime;
            console.log(`${statusCoords} ${location.name} (by coords): ${timeCoords}ms${resultByCoords.cached ? ' (cached)' : ''}`);
            
            results.firebaseAPI.push(resultByCoords);
        } else {
            results.firebaseAPI.push(resultById);
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Calculate performance comparison
    console.log('\n📈 Performance Analysis');
    console.log('=' * 60);
    
    const currentAPITimes = results.currentAPI.filter(r => r.success).map(r => r.responseTime);
    const firebaseAPITimes = results.firebaseAPI.filter(r => r.success).map(r => r.responseTime);
    
    if (currentAPITimes.length > 0 && firebaseAPITimes.length > 0) {
        const currentAvg = currentAPITimes.reduce((a, b) => a + b, 0) / currentAPITimes.length;
        const firebaseAvg = firebaseAPITimes.reduce((a, b) => a + b, 0) / firebaseAPITimes.length;
        const improvement = ((currentAvg - firebaseAvg) / currentAvg * 100);
        const speedup = currentAvg / firebaseAvg;
        
        results.comparison = {
            currentAPIAvg: Math.round(currentAvg),
            firebaseAPIAvg: Math.round(firebaseAvg),
            improvement: Math.round(improvement * 100) / 100,
            speedup: Math.round(speedup * 100) / 100
        };
        
        console.log(`Current API Average:  ${results.comparison.currentAPIAvg}ms`);
        console.log(`Firebase API Average: ${results.comparison.firebaseAPIAvg}ms`);
        console.log(`Performance Improvement: ${results.comparison.improvement}%`);
        console.log(`Speed-up Factor: ${results.comparison.speedup}x faster`);
        
        if (improvement > 50) {
            console.log('\n🎉 EXCELLENT! Firebase API is significantly faster!');
        } else if (improvement > 0) {
            console.log('\n✅ Good! Firebase API shows improvement.');
        } else {
            console.log('\n⚠️  Firebase API needs optimization.');
        }
    } else {
        console.log('❌ Unable to calculate comparison - insufficient successful responses');
    }

    // Cache status
    console.log('\n💾 Cache Analysis');
    console.log('-'.repeat(30));
    const cachedCount = results.firebaseAPI.filter(r => r.cached).length;
    const totalFirebase = results.firebaseAPI.length;
    const cacheHitRate = totalFirebase > 0 ? (cachedCount / totalFirebase * 100) : 0;
    
    console.log(`Cache hit rate: ${cachedCount}/${totalFirebase} (${Math.round(cacheHitRate)}%)`);
    
    if (cacheHitRate < 50) {
        console.log('💡 Suggestion: Run precompute function to populate cache');
        console.log('   gcloud functions call triggerPrecompute --project kaaykostore');
    }

    // Error analysis
    const currentErrors = results.currentAPI.filter(r => !r.success);
    const firebaseErrors = results.firebaseAPI.filter(r => !r.success);
    
    if (currentErrors.length > 0) {
        console.log('\n❌ Current API Errors:');
        currentErrors.forEach(error => {
            console.log(`   ${error.description}: ${error.error || 'Unknown error'}`);
        });
    }
    
    if (firebaseErrors.length > 0) {
        console.log('\n❌ Firebase API Errors:');
        firebaseErrors.forEach(error => {
            console.log(`   ${error.description}: ${error.error || 'Unknown error'}`);
        });
    }

    console.log('\n✅ Performance test completed!');
    return results;
}

/**
 * Test cache management endpoints
 */
async function testCacheManagement() {
    console.log('\n🔧 Testing Cache Management API...');
    console.log('-'.repeat(40));
    
    const cacheBaseUrl = `${FIREBASE_FUNCTIONS_BASE}/cacheManager`;
    
    // Test cache stats
    const statsResult = await makeRequest(`${cacheBaseUrl}/stats`, 'Cache Statistics');
    console.log(`📊 Cache Stats: ${statsResult.success ? '✅' : '❌'} (${statsResult.responseTime}ms)`);
    
    if (statsResult.success) {
        console.log('   Cache details available in response');
    }
    
    return statsResult;
}

// Run the tests
async function main() {
    console.log('🏁 Starting comprehensive API performance analysis...\n');
    
    try {
        // Main performance test
        const performanceResults = await runPerformanceTest();
        
        // Cache management test
        const cacheResults = await testCacheManagement();
        
        console.log('\n🎯 Test Summary:');
        console.log('=' * 40);
        console.log('✅ Performance comparison completed');
        console.log('✅ Cache management tested');
        
        if (performanceResults.comparison.improvement > 0) {
            console.log(`🚀 Firebase API is ${performanceResults.comparison.speedup}x faster!`);
        }
        
        console.log('\n💡 Next Steps:');
        console.log('1. Deploy Firebase functions: npm run deploy');
        console.log('2. Set up scheduled precompute: Enable Cloud Scheduler');
        console.log('3. Update frontend to use Firebase fast API');
        console.log('4. Monitor cache hit rates and performance');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { runPerformanceTest, testCacheManagement };
