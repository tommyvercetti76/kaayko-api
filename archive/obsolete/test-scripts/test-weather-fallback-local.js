// Test WeatherAPI fallback logic locally - EXACT same as production API
const https = require('https');

const WEATHER_API_KEY = '26fbd83a03c945c9b34190954253107';
const FAILING_COORDINATES = [
    { name: "Antero Reservoir, CO", coords: "38.982687,-105.896563" },
    { name: "Colorado River, UT", coords: "38.604813,-109.573563" },
    { name: "Jackson Lake, WY", coords: "43.845863,-110.600359" },
    { name: "Jenny Lake, WY", coords: "43.749638,-110.729578" }
];

async function makeWeatherRequest(query, type = 'current') {
    const url = `https://api.weatherapi.com/v1/${type}.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(query)}&aqi=yes`;
    
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
                    reject(new Error(`Invalid JSON: ${error.message}`));
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

// EXACT FALLBACK LOGIC FROM OUR API
async function testCoordinateFallback(originalCoords, locationName) {
    console.log(`\n🏔️ TESTING: ${locationName} (${originalCoords})`);
    
    const [lat, lng] = originalCoords.split(',').map(Number);
    
    // Strategy 1: Original coordinates (what used to work)
    try {
        console.log(`  1️⃣ Trying original: ${originalCoords}`);
        const result = await makeWeatherRequest(originalCoords);
        console.log(`  ✅ SUCCESS: ${result.location.name}, ${result.location.region}`);
        return result;
    } catch (error1) {
        console.log(`  ❌ Original failed: ${error1.message}`);
    }
    
    // Strategy 2: Reduced precision (2 decimal places)
    try {
        const roundedLat = Math.round(lat * 100) / 100;
        const roundedLng = Math.round(lng * 100) / 100;
        const rounded = `${roundedLat},${roundedLng}`;
        console.log(`  2️⃣ Trying reduced precision: ${rounded}`);
        const result = await makeWeatherRequest(rounded);
        console.log(`  ✅ SUCCESS: ${result.location.name}, ${result.location.region}`);
        return result;
    } catch (error2) {
        console.log(`  ❌ Reduced precision failed: ${error2.message}`);
    }
    
    // Strategy 3: Nearby coordinates search
    const offsets = [[0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1], [0.1, 0.1], [-0.1, -0.1]];
    
    for (const [latOffset, lngOffset] of offsets) {
        try {
            const nearbyLat = lat + latOffset;
            const nearbyLng = lng + lngOffset;
            const nearby = `${nearbyLat},${nearbyLng}`;
            console.log(`  3️⃣ Trying nearby: ${nearby}`);
            const result = await makeWeatherRequest(nearby);
            console.log(`  ✅ SUCCESS: ${result.location.name}, ${result.location.region}`);
            return result;
        } catch (error) {
            // Continue to next offset
        }
    }
    
    // Strategy 4: State/region fallback
    try {
        const stateQuery = getStateFromCoords(lat, lng);
        console.log(`  4️⃣ Final fallback - trying state: ${stateQuery}`);
        const result = await makeWeatherRequest(stateQuery);
        console.log(`  ✅ SUCCESS: ${result.location.name}, ${result.location.region}`);
        return result;
    } catch (finalError) {
        console.log(`  ❌ ALL STRATEGIES FAILED for ${locationName}`);
        throw new Error(`No weather data available for ${locationName}`);
    }
}

function getStateFromCoords(lat, lng) {
    if (lat >= 37 && lat <= 41 && lng >= -109 && lng <= -102) return "Colorado,US";
    if (lat >= 37 && lat <= 42 && lng >= -114 && lng <= -109) return "Utah,US";
    if (lat >= 41 && lat <= 45 && lng >= -111 && lng <= -104) return "Wyoming,US";
    return "Denver,CO,US"; // Default
}

// EXACT TEST AS PRODUCTION API
async function testAllFailingLocations() {
    console.log('🧪 TESTING COORDINATE FALLBACK - EXACT API LOGIC\n');
    
    for (const location of FAILING_COORDINATES) {
        try {
            const weatherData = await testCoordinateFallback(location.coords, location.name);
            
            // Extract EXACT same features as production API
            const current = weatherData.current;
            const mlFeatures = {
                temperature: current.temp_c || 20,
                windSpeed: current.wind_mph || 0,
                beaufortScale: Math.min(Math.floor((current.wind_mph || 0) / 3.0), 12),
                uvIndex: current.uv || 0,
                visibility: current.vis_km || 10,
                humidity: current.humidity || 50,
                cloudCover: current.cloud || 0,
            };
            
            console.log(`  📊 ML FEATURES: temp=${mlFeatures.temperature}°C, wind=${mlFeatures.windSpeed}mph, visibility=${mlFeatures.visibility}km`);
            
        } catch (error) {
            console.log(`  💀 COMPLETE FAILURE: ${error.message}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
    }
}

// RUN TEST
testAllFailingLocations().catch(console.error);
