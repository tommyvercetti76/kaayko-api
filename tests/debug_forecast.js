#!/usr/bin/env node

/**
 * 🔍 Debug Forecast API - Quick Test
 */

const https = require('https');

const CONFIG = {
    BASE_URL: 'https://api-vwcc5j4qda-uc.a.run.app',
    ENDPOINTS: {
        locations: '/paddlingOut',
        forecast: '/paddlePredict/forecast'
    }
};

function makeRequest(url, description = '') {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                const responseTime = Date.now() - startTime;
                try {
                    const jsonData = JSON.parse(data);
                    resolve({
                        statusCode: res.statusCode,
                        data: jsonData,
                        responseTime,
                        size: data.length
                    });
                } catch (error) {
                    reject(new Error(`Parse Error for ${description}: ${error.message}`));
                }
            });
        }).on('error', (error) => {
            reject(new Error(`Request Error for ${description}: ${error.message}`));
        });
    });
}

async function testForecast() {
    console.log('🔍 Testing forecast API...');
    
    try {
        // Test with known coordinates (Ambazari Lake)
        const lat = 21.129713;
        const lng = 79.045547;
        const url = `${CONFIG.BASE_URL}${CONFIG.ENDPOINTS.forecast}?lat=${lat}&lng=${lng}`;
        
        console.log(`📍 Testing forecast for coordinates: ${lat}, ${lng}`);
        console.log(`🌐 URL: ${url}`);
        
        const response = await makeRequest(url, 'Test Location');
        
        console.log(`📊 Status Code: ${response.statusCode}`);
        console.log(`⏱️ Response Time: ${response.responseTime}ms`);
        console.log(`📦 Data Size: ${response.size} bytes`);
        
        if (response.data.success) {
            console.log('✅ SUCCESS: Forecast API is working!');
            console.log(`📅 Forecast Days: ${response.data.forecast.length}`);
            
            // Check first day structure
            if (response.data.forecast.length > 0) {
                const firstDay = response.data.forecast[0];
                console.log(`📅 First Day: ${firstDay.date}`);
                console.log(`⏰ Hours Available: ${Object.keys(firstDay.hourly).length}`);
                
                // Check first hour
                const firstHour = Object.keys(firstDay.hourly)[0];
                const hourData = firstDay.hourly[firstHour];
                console.log(`🕐 First Hour (${firstHour}):`, {
                    rating: hourData.rating || hourData.apiRating,
                    temperature: hourData.temperature,
                    windSpeed: hourData.windSpeed,
                    warnings: hourData.warnings?.length || 0
                });
            }
        } else {
            console.log('❌ FAILED: Forecast API returned success:false');
            console.log('Response:', JSON.stringify(response.data, null, 2));
        }
        
    } catch (error) {
        console.error('❌ ERROR:', error.message);
    }
}

testForecast();
