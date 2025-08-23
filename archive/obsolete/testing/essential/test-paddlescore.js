// Test: functions/testing/essential/test-paddlescore.js
//
// 🏄 PADDLESCORE API - Production ML Testing
//
// Verify the new paddleScore API works with real ML predictions

const https = require('https');

const BASE_URL = 'http://127.0.0.1:5001/kaaykostore/us-central1/api';

async function testPaddleScore() {
    console.log('🏄 Testing PaddleScore API with Production ML Service');
    console.log('=' .repeat(60));
    
    const tests = [
        {
            name: 'Known SpotId (Merrimack)',
            url: `${BASE_URL}/paddleScore?spotId=merrimack`,
            expect: 'fast cached response'
        },
        {
            name: 'Custom Location (Boston)',
            url: `${BASE_URL}/paddleScore?location=42.3601,-71.0589`,
            expect: 'real-time ML prediction'
        },
        {
            name: 'Custom Location (Miami)',
            url: `${BASE_URL}/paddleScore?location=25.7617,-80.1918`,
            expect: 'different conditions'
        },
        {
            name: 'Custom Location (Colorado)',
            url: `${BASE_URL}/paddleScore?location=39.7392,-104.9903`,
            expect: 'inland conditions'
        }
    ];
    
    for (const test of tests) {
        try {
            console.log(`\n🧪 ${test.name} (${test.expect})`);
            
            const response = await fetch(test.url);
            const data = await response.json();
            
            if (!data.success) {
                console.log(`❌ FAIL: ${data.error}`);
                continue;
            }
            
            console.log(`✅ Location: ${data.location.name}`);
            console.log(`🌡️  Temperature: ${data.conditions.temperature}°F`);
            console.log(`💨 Wind: ${data.conditions.windSpeed} mph (Beaufort ${data.conditions.beaufortScale})`);
            console.log(`🏄 Paddle Score: ${data.paddleScore.rating}/5 - ${data.paddleScore.interpretation}`);
            console.log(`🤖 Model: ${data.paddleScore.modelUsed} (${data.metadata.source})`);
            console.log(`⚡ Response: ${data.metadata.response_time_ms}ms`);
            
        } catch (error) {
            console.log(`❌ FAIL: ${error.message}`);
        }
    }
    
    // Test error cases
    console.log(`\n🚨 Testing Error Cases`);
    
    const errorTests = [
        {
            name: 'Missing Parameters',
            url: `${BASE_URL}/paddleScore`
        },
        {
            name: 'Invalid SpotId',
            url: `${BASE_URL}/paddleScore?spotId=nonexistent`
        },
        {
            name: 'Invalid Location Format',
            url: `${BASE_URL}/paddleScore?location=invalid`
        }
    ];
    
    for (const test of errorTests) {
        try {
            console.log(`\n❌ ${test.name}`);
            const response = await fetch(test.url);
            const data = await response.json();
            
            if (!data.success) {
                console.log(`✅ Correctly rejected: ${data.error}`);
            } else {
                console.log(`❌ Should have failed but succeeded`);
            }
            
        } catch (error) {
            console.log(`✅ Correctly errored: ${error.message}`);
        }
    }
    
    console.log('\n🏄 PaddleScore API Testing Complete!');
}

// Polyfill fetch for Node.js
if (typeof fetch === 'undefined') {
    global.fetch = async (url) => {
        return new Promise((resolve, reject) => {
            const req = https.request(url.replace('http:', 'https:'), (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    resolve({
                        json: () => Promise.resolve(JSON.parse(data))
                    });
                });
            });
            req.on('error', reject);
            req.end();
        });
    };
}

// Run if called directly
if (require.main === module) {
    testPaddleScore().catch(console.error);
}

module.exports = { testPaddleScore };
