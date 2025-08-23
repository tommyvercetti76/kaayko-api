// COMPLETE LOCAL WEATHERAPI FALLBACK SYSTEM
// This implements the exact coordinate fallback that will fix your failing locations

const https = require('https');

const WEATHER_API_KEY = '26fbd83a03c945c9b34190954253107';
const FAILING_LOCATIONS = [
    { name: "Antero Reservoir, CO", lat: 38.982687, lon: -105.896563 },
    { name: "Colorado River, UT", lat: 38.604813, lon: -109.573563 },
    { name: "Cottonwood Lake, CO", lat: 38.781063, lon: -106.277812 },
    { name: "Jackson Lake, WY", lat: 43.845863, lon: -110.600359 },
    { name: "Jenny Lake, WY", lat: 43.749638, lon: -110.729578 },
    { name: "Kens Lake, UT", lat: 38.479188, lon: -109.428062 },
    { name: "Lake Powell, UT", lat: 37.01513, lon: -111.536362 },
    { name: "Taylor Park Reservoir, CO", lat: 38.823442, lon: -106.579883 }
];

/**
 * COMPLETE WeatherAPI Fallback Service
 * This exactly matches what we'll implement in UnifiedWeatherService
 */
class WeatherAPIFallbackService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.weatherapi.com/v1';
    }

    /**
     * Make HTTP request to WeatherAPI
     */
    async makeRequest(url) {
        return new Promise((resolve, reject) => {
            const req = https.get(url, { timeout: 8000 }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.error) {
                            reject(new Error(`WeatherAPI Error: ${parsed.error.message}`));
                        } else {
                            resolve(parsed);
                        }
                    } catch (error) {
                        reject(new Error(`JSON Parse Error: ${error.message}`));
                    }
                });
            });
            
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }

    /**
     * Try specific coordinate query
     */
    async tryCoordinateQuery(lat, lon) {
        const query = `${lat},${lon}`;
        const url = `${this.baseUrl}/current.json?key=${this.apiKey}&q=${encodeURIComponent(query)}&aqi=yes`;
        return this.makeRequest(url);
    }

    /**
     * COMPLETE COORDINATE FALLBACK SYSTEM
     * This is the exact implementation for UnifiedWeatherService
     */
    async getWeatherWithFallback(originalLat, originalLon, locationName) {
        console.log(`🔄 Starting fallback system for: ${locationName} (${originalLat},${originalLon})`);
        
        // Strategy 1: Try original coordinates
        try {
            console.log(`  1️⃣ Trying original: ${originalLat},${originalLon}`);
            const result = await this.tryCoordinateQuery(originalLat, originalLon);
            console.log(`  ✅ SUCCESS with original coordinates!`);
            return { ...result, fallbackUsed: 'none', searchAttempts: 1 };
        } catch (error1) {
            console.log(`  ❌ Original failed: ${error1.message}`);
        }
        
        // Strategy 2: Try reduced precision (4 decimal places)
        try {
            const roundedLat = Math.round(originalLat * 10000) / 10000;
            const roundedLon = Math.round(originalLon * 10000) / 10000;
            console.log(`  2️⃣ Trying 4-decimal precision: ${roundedLat},${roundedLon}`);
            const result = await this.tryCoordinateQuery(roundedLat, roundedLon);
            console.log(`  ✅ SUCCESS with reduced precision!`);
            return { ...result, fallbackUsed: 'precision', searchAttempts: 2 };
        } catch (error2) {
            console.log(`  ❌ Reduced precision failed: ${error2.message}`);
        }
        
        // Strategy 3: Try 3 decimal places
        try {
            const rounded3Lat = Math.round(originalLat * 1000) / 1000;
            const rounded3Lon = Math.round(originalLon * 1000) / 1000;
            console.log(`  3️⃣ Trying 3-decimal precision: ${rounded3Lat},${rounded3Lon}`);
            const result = await this.tryCoordinateQuery(rounded3Lat, rounded3Lon);
            console.log(`  ✅ SUCCESS with 3-decimal precision!`);
            return { ...result, fallbackUsed: 'precision-3', searchAttempts: 3 };
        } catch (error3) {
            console.log(`  ❌ 3-decimal precision failed: ${error3.message}`);
        }
        
        // Strategy 4: Nearby coordinate search (±0.05 degree increments)
        const offsets = [
            [0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05],
            [0.05, 0.05], [-0.05, -0.05], [0.05, -0.05], [-0.05, 0.05],
            [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]
        ];
        
        for (let i = 0; i < offsets.length; i++) {
            try {
                const [latOffset, lonOffset] = offsets[i];
                const nearbyLat = originalLat + latOffset;
                const nearbyLon = originalLon + lonOffset;
                console.log(`  4️⃣.${i+1} Trying nearby: ${nearbyLat},${nearbyLon} (offset: ${latOffset},${lonOffset})`);
                const result = await this.tryCoordinateQuery(nearbyLat, nearbyLon);
                console.log(`  ✅ SUCCESS with nearby coordinates!`);
                return { ...result, fallbackUsed: 'nearby', offsetUsed: [latOffset, lonOffset], searchAttempts: 4 + i };
            } catch (error) {
                // Continue to next offset
            }
        }
        
        // Strategy 5: City/region fallback based on coordinates
        try {
            const cityQuery = this.getCityFromCoordinates(originalLat, originalLon);
            console.log(`  5️⃣ Final fallback - trying city: ${cityQuery}`);
            const url = `${this.baseUrl}/current.json?key=${this.apiKey}&q=${encodeURIComponent(cityQuery)}&aqi=yes`;
            const result = await this.makeRequest(url);
            console.log(`  ✅ SUCCESS with city fallback!`);
            return { ...result, fallbackUsed: 'city', cityUsed: cityQuery, searchAttempts: 15 };
        } catch (finalError) {
            console.log(`  ❌ All fallback strategies failed!`);
            throw new Error(`No weather data available for ${locationName} - all fallback strategies exhausted`);
        }
    }

    /**
     * Get nearest major city for coordinates
     */
    getCityFromCoordinates(lat, lon) {
        // Specific cities near your paddling locations
        if (lat >= 38.9 && lat <= 39.1 && lon >= -106.0 && lon <= -105.8) return "Fairplay,Colorado,United States";
        if (lat >= 38.5 && lat <= 38.7 && lon >= -109.7 && lon <= -109.4) return "Moab,Utah,United States";
        if (lat >= 38.7 && lat <= 38.9 && lon >= -106.4 && lon <= -106.1) return "Gunnison,Colorado,United States";
        if (lat >= 43.8 && lat <= 44.0 && lon >= -110.8 && lon <= -110.5) return "Jackson,Wyoming,United States";
        if (lat >= 43.7 && lat <= 43.8 && lon >= -110.8 && lon <= -110.6) return "Jackson,Wyoming,United States";
        if (lat >= 38.4 && lat <= 38.5 && lon >= -109.5 && lon <= -109.3) return "Moab,Utah,United States";
        if (lat >= 36.9 && lat <= 37.1 && lon >= -111.7 && lon <= -111.3) return "Kanab,Utah,United States";
        if (lat >= 38.7 && lat <= 38.9 && lon >= -106.7 && lon <= -106.4) return "Crested Butte,Colorado,United States";
        
        // State-level fallbacks
        if (lat >= 37 && lat <= 41 && lon >= -109 && lon <= -102) return "Denver,Colorado,United States";
        if (lat >= 37 && lat <= 42 && lon >= -114 && lon <= -109) return "Salt Lake City,Utah,United States";
        if (lat >= 41 && lat <= 45 && lon >= -111 && lon <= -104) return "Cheyenne,Wyoming,United States";
        
        return "Denver,Colorado,United States"; // Final default
    }

    /**
     * Extract ML features from WeatherAPI response
     */
    extractMLFeatures(weatherData, originalCoordinates) {
        const current = weatherData.current;
        
        return {
            temperature: current.temp_c,
            windSpeed: current.wind_mph,
            hasWarnings: current.condition.text.toLowerCase().includes('storm') || 
                        current.condition.text.toLowerCase().includes('warning') ||
                        current.condition.text.toLowerCase().includes('thunder'),
            beaufortScale: Math.min(Math.floor(current.wind_mph / 3.0), 12),
            uvIndex: current.uv,
            visibility: current.vis_km,
            humidity: current.humidity,
            cloudCover: current.cloud,
            latitude: originalCoordinates.lat,
            longitude: originalCoordinates.lon,
            // Marine estimation
            waveHeight: current.wind_mph > 10 ? (current.wind_mph * 0.02) : 0.1,
            waterTemp: Math.max(2, current.temp_c - 8)
        };
    }
}

/**
 * Test complete fallback system with ML feature extraction
 */
async function testCompleteWeatherAPIFallback() {
    console.log('🚀 COMPLETE WEATHERAPI FALLBACK SYSTEM TEST\n');
    console.log('Testing coordinate fallback for all your exact paddling locations...\n');
    
    const weatherService = new WeatherAPIFallbackService(WEATHER_API_KEY);
    const results = [];
    let successCount = 0;
    
    for (const location of FAILING_LOCATIONS) {
        try {
            const weatherData = await weatherService.getWeatherWithFallback(
                location.lat,
                location.lon,
                location.name
            );
            
            // Extract ML features
            const mlFeatures = weatherService.extractMLFeatures(weatherData, location);
            
            console.log(`📊 ${location.name} - WEATHER DATA FOUND:`);
            console.log(`   📍 Location: ${weatherData.location.name}, ${weatherData.location.region}`);
            console.log(`   🔄 Fallback: ${weatherData.fallbackUsed} (${weatherData.searchAttempts} attempts)`);
            console.log(`   📊 ML Features:`);
            console.log(`      Temperature: ${mlFeatures.temperature}°C`);
            console.log(`      Wind Speed: ${mlFeatures.windSpeed} mph`);
            console.log(`      UV Index: ${mlFeatures.uvIndex}`);
            console.log(`      Visibility: ${mlFeatures.visibility} km`);
            console.log(`      Humidity: ${mlFeatures.humidity}%`);
            console.log(`      Cloud Cover: ${mlFeatures.cloudCover}%`);
            console.log(`   ✅ Ready for ML prediction!\n`);
            
            results.push({
                success: true,
                location: location.name,
                weatherData: weatherData,
                mlFeatures: mlFeatures
            });
            successCount++;
            
        } catch (error) {
            console.log(`❌ ${location.name}: ${error.message}\n`);
            results.push({
                success: false,
                location: location.name,
                error: error.message
            });
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('📊 FINAL FALLBACK TEST RESULTS:');
    console.log(`✅ Successful: ${successCount}/${FAILING_LOCATIONS.length}`);
    console.log(`❌ Failed: ${FAILING_LOCATIONS.length - successCount}/${FAILING_LOCATIONS.length}`);
    
    if (successCount === FAILING_LOCATIONS.length) {
        console.log('\n🎉 PERFECT! Coordinate fallback works for ALL your paddling locations!');
        console.log('🚀 Ready to implement in UnifiedWeatherService and deploy!');
        console.log('\n📋 NEXT STEPS:');
        console.log('   1. Implement this fallback logic in UnifiedWeatherService.js');
        console.log('   2. Deploy to Firebase Functions');
        console.log('   3. Test production paddleScore API');
        console.log('   4. All your locations will work again!');
    } else {
        console.log('\n⚠️ Some locations still failed - may need additional fallback strategies');
    }
    
    // Show fallback strategy breakdown
    const fallbackStats = results.filter(r => r.success).reduce((stats, result) => {
        const fallback = result.weatherData.fallbackUsed;
        stats[fallback] = (stats[fallback] || 0) + 1;
        return stats;
    }, {});
    
    console.log('\n📊 FALLBACK STRATEGY EFFECTIVENESS:');
    Object.entries(fallbackStats).forEach(([strategy, count]) => {
        console.log(`   ${strategy}: ${count} locations`);
    });
    
    return results;
}

// Run the complete fallback test
testCompleteWeatherAPIFallback().catch(console.error);
