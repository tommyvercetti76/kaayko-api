// OpenWeatherMap API Test with Your Key: 926db8f6c26724f47d0635ce235baf67
const https = require('https');

const OPENWEATHER_API_KEY = '926db8f6c26724f47d0635ce235baf67';
const FAILING_COORDINATES = [
    { name: "Antero Reservoir, CO", lat: 38.982687, lon: -105.896563 },
    { name: "Colorado River, UT", lat: 38.604813, lon: -109.573563 },
    { name: "Cottonwood Lake, CO", lat: 38.781063, lon: -106.277812 },
    { name: "Jackson Lake, WY", lat: 43.845863, lon: -110.600359 },
    { name: "Jenny Lake, WY", lat: 43.749638, lon: -110.729578 },
    { name: "Kens Lake, UT", lat: 38.479188, lon: -109.428062 },
    { name: "Lake Powell, UT", lat: 37.01513, lon: -111.536362 },
    { name: "Taylor Park Reservoir, CO", lat: 38.823442, lon: -106.579883 }
];

async function testOpenWeatherMap(lat, lon, locationName) {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`;
    
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 8000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.cod === 200) {
                        // Success - extract the data we need for ML model
                        resolve({
                            success: true,
                            location: locationName,
                            actualLocation: parsed.name,
                            country: parsed.sys.country,
                            coordinates: { lat: parsed.coord.lat, lon: parsed.coord.lon },
                            // ML Model Features (same as WeatherAPI format)
                            temperature: parsed.main.temp, // Celsius
                            windSpeed: parsed.wind.speed * 2.237, // Convert m/s to mph for consistency
                            humidity: parsed.main.humidity,
                            visibility: (parsed.visibility || 10000) / 1000, // Convert meters to km
                            cloudCover: parsed.clouds.all,
                            uvIndex: 0, // OpenWeather needs separate UV call
                            pressure: parsed.main.pressure
                        });
                    } else {
                        reject(new Error(`OpenWeather Error (${parsed.cod}): ${parsed.message}`));
                    }
                } catch (error) {
                    reject(new Error(`JSON Parse Error: ${error.message}`));
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}

async function testAllLocations() {
    console.log('🌤️ TESTING OpenWeatherMap with YOUR API KEY\n');
    console.log(`API Key: ${OPENWEATHER_API_KEY}\n`);
    
    // First test with a known working location (NYC)
    console.log('🏙️ Testing API key with New York City (known working location):');
    try {
        const nycTest = await testOpenWeatherMap(40.7128, -74.0060, 'New York City');
        console.log(`✅ API KEY WORKS! Found: ${nycTest.actualLocation}, ${nycTest.country}`);
        console.log(`   Temperature: ${nycTest.temperature}°C, Wind: ${nycTest.windSpeed.toFixed(1)}mph\n`);
    } catch (error) {
        console.log(`❌ API KEY ISSUE: ${error.message}`);
        console.log('ℹ️ Possible causes:');
        console.log('   • API key not activated yet (can take up to 2 hours)');
        console.log('   • API key incorrect');
        console.log('   • Account suspended\n');
        return;
    }
    
    // Now test all your failing locations
    console.log('🏔️ Testing YOUR EXACT paddling locations:\n');
    
    let successCount = 0;
    let failCount = 0;
    
    for (const location of FAILING_COORDINATES) {
        try {
            console.log(`Testing: ${location.name}`);
            const result = await testOpenWeatherMap(location.lat, location.lon, location.name);
            
            console.log(`✅ SUCCESS: ${result.actualLocation || 'Remote Location'}, ${result.country}`);
            console.log(`   📊 ML Features: ${result.temperature}°C, ${result.windSpeed.toFixed(1)}mph, ${result.humidity}% humidity, ${result.visibility}km visibility`);
            console.log(`   📍 Coordinates: ${result.coordinates.lat}, ${result.coordinates.lon}\n`);
            
            successCount++;
            
        } catch (error) {
            console.log(`❌ FAILED: ${error.message}\n`);
            failCount++;
        }
        
        // Rate limiting - wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`📊 RESULTS SUMMARY:`);
    console.log(`   ✅ Successful: ${successCount}/${FAILING_COORDINATES.length}`);
    console.log(`   ❌ Failed: ${failCount}/${FAILING_COORDINATES.length}`);
    
    if (successCount === FAILING_COORDINATES.length) {
        console.log('\n🎉 PERFECT! OpenWeatherMap works for ALL your locations!');
        console.log('   Ready to replace WeatherAPI with OpenWeatherMap');
    } else if (successCount > 0) {
        console.log('\n👍 PARTIAL SUCCESS - OpenWeatherMap is better than WeatherAPI');
        console.log('   Can proceed with integration');
    } else {
        console.log('\n😞 All locations failed - need to debug API key');
    }
}

testAllLocations().catch(console.error);
