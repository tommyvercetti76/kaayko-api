// COMPLETE LOCAL OPENWEATHERMAP INTEGRATION
// Testing the full migration with your API key locally

const https = require('https');

// Your OpenWeatherMap API Key
const OPENWEATHER_API_KEY = '926db8f6c26724f47d0635ce235baf67';

// Your exact failing coordinates from paddlingOut
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
 * COMPLETE OpenWeatherMap Service Implementation
 * This replicates the full UnifiedWeatherService functionality
 */
class OpenWeatherMapService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.openweathermap.org/data/2.5';
    }

    /**
     * Get current weather data (equivalent to WeatherAPI current.json)
     */
    async getCurrentWeather(lat, lon) {
        const url = `${this.baseUrl}/weather?lat=${lat}&lon=${lon}&appid=${this.apiKey}&units=metric`;
        
        return new Promise((resolve, reject) => {
            const req = https.get(url, { timeout: 8000 }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.cod === 200) {
                            resolve(parsed);
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
                reject(new Error('Request timeout'));
            });
        });
    }

    /**
     * Get UV Index data (separate API call needed)
     */
    async getUVIndex(lat, lon) {
        const url = `${this.baseUrl}/uvi?lat=${lat}&lon=${lon}&appid=${this.apiKey}`;
        
        return new Promise((resolve, reject) => {
            const req = https.get(url, { timeout: 8000 }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed.value || 0); // UV index value
                    } catch (error) {
                        console.warn('UV Index fetch failed, using default 0');
                        resolve(0); // Default UV index
                    }
                });
            });
            
            req.on('error', () => resolve(0)); // Fallback to 0
            req.on('timeout', () => {
                req.destroy();
                resolve(0); // Fallback to 0
            });
        });
    }

    /**
     * Get complete weather data (combines current + UV)
     */
    async getCompleteWeatherData(lat, lon, locationName) {
        try {
            console.log(`🌤️ Fetching complete weather for: ${locationName}`);
            
            // Get current weather and UV index in parallel
            const [currentWeather, uvIndex] = await Promise.all([
                this.getCurrentWeather(lat, lon),
                this.getUVIndex(lat, lon)
            ]);
            
            // Transform to standardized format (like WeatherAPI structure)
            const standardized = this.standardizeResponse(currentWeather, uvIndex, locationName);
            
            console.log(`✅ Weather data fetched for: ${standardized.location.name}`);
            return standardized;
            
        } catch (error) {
            console.error(`❌ Failed to get weather for ${locationName}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Transform OpenWeatherMap response to match WeatherAPI structure
     * This ensures our ML model gets data in the expected format
     */
    standardizeResponse(openWeatherData, uvIndex, locationName) {
        const current = openWeatherData;
        
        return {
            location: {
                name: current.name || locationName,
                region: current.sys.country === 'US' ? this.getUSState(current.coord.lat, current.coord.lon) : '',
                country: this.getCountryName(current.sys.country),
                coordinates: {
                    latitude: current.coord.lat,
                    longitude: current.coord.lon
                },
                timeZone: 'America/Denver', // Default for US mountain locations
                localTime: new Date().toISOString()
            },
            
            current: {
                temperature: {
                    celsius: current.main.temp,
                    fahrenheit: (current.main.temp * 9/5) + 32,
                    feelsLikeC: current.main.feels_like,
                    feelsLikeF: (current.main.feels_like * 9/5) + 32
                },
                wind: {
                    speedKPH: current.wind?.speed ? current.wind.speed * 3.6 : 0, // m/s to kph
                    speedMPH: current.wind?.speed ? current.wind.speed * 2.237 : 0, // m/s to mph
                    direction: this.getWindDirection(current.wind?.deg || 0),
                    degree: current.wind?.deg || 0,
                    gustKPH: current.wind?.gust ? current.wind.gust * 3.6 : (current.wind?.speed * 3.6 * 1.5) || 0,
                    gustMPH: current.wind?.gust ? current.wind.gust * 2.237 : (current.wind?.speed * 2.237 * 1.5) || 0
                },
                atmospheric: {
                    humidity: current.main.humidity,
                    pressure: current.main.pressure,
                    visibility: (current.visibility || 10000) / 1000, // meters to km
                    cloudCover: current.clouds?.all || 0
                },
                conditions: {
                    text: current.weather[0]?.description || 'Clear',
                    code: current.weather[0]?.id || 800,
                    icon: current.weather[0]?.icon || '01d'
                },
                solar: {
                    uvIndex: uvIndex,
                    isDay: current.weather[0]?.icon?.includes('d') || true
                },
                precipitation: {
                    amountMM: current.rain?.['1h'] || current.snow?.['1h'] || 0
                }
            }
        };
    }

    /**
     * Convert wind degree to direction
     */
    getWindDirection(degree) {
        const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        return directions[Math.round(degree / 22.5) % 16];
    }

    /**
     * Get US state from coordinates (approximate)
     */
    getUSState(lat, lng) {
        if (lat >= 37 && lat <= 41 && lng >= -109 && lng <= -102) return "Colorado";
        if (lat >= 37 && lat <= 42 && lng >= -114 && lng <= -109) return "Utah";
        if (lat >= 41 && lat <= 45 && lng >= -111 && lng <= -104) return "Wyoming";
        return "Unknown";
    }

    /**
     * Get full country name
     */
    getCountryName(countryCode) {
        const countryMap = {
            'US': 'United States of America',
            'CA': 'Canada',
            'MX': 'Mexico'
        };
        return countryMap[countryCode] || countryCode;
    }

    /**
     * Extract ML features (exact same as current WeatherAPI extraction)
     */
    extractMLFeatures(weatherData, coordinates) {
        const current = weatherData.current;
        
        return {
            // Core ML model features (exact same format as WeatherAPI)
            temperature: current.temperature.celsius,
            windSpeed: current.wind.speedMPH,
            hasWarnings: current.conditions.text.toLowerCase().includes('storm') || 
                        current.conditions.text.toLowerCase().includes('warning') ||
                        current.conditions.text.toLowerCase().includes('thunder'),
            beaufortScale: Math.min(Math.floor((current.wind.speedMPH) / 3.0), 12),
            uvIndex: current.solar.uvIndex,
            visibility: current.atmospheric.visibility,
            humidity: current.atmospheric.humidity,
            cloudCover: current.atmospheric.cloudCover,
            latitude: coordinates.lat,
            longitude: coordinates.lon,
            // Marine estimation (since OpenWeather doesn't have marine API)
            waveHeight: current.wind.speedMPH > 10 ? (current.wind.speedMPH * 0.02) : 0.1,
            waterTemp: Math.max(2, current.temperature.celsius - 8) // Estimate water temp
        };
    }
}

/**
 * Test ML prediction with OpenWeatherMap data
 * This simulates the exact same process as your production API
 */
async function testMLPredictionWithOpenWeather(lat, lon, locationName) {
    const openWeatherService = new OpenWeatherMapService(OPENWEATHER_API_KEY);
    
    try {
        // Get weather data
        const weatherData = await openWeatherService.getCompleteWeatherData(lat, lon, locationName);
        
        // Extract ML features
        const mlFeatures = openWeatherService.extractMLFeatures(weatherData, { lat, lon });
        
        console.log(`📊 ML Features for ${locationName}:`);
        console.log(`   Temperature: ${mlFeatures.temperature}°C`);
        console.log(`   Wind Speed: ${mlFeatures.windSpeed} mph`);
        console.log(`   UV Index: ${mlFeatures.uvIndex}`);
        console.log(`   Visibility: ${mlFeatures.visibility} km`);
        console.log(`   Humidity: ${mlFeatures.humidity}%`);
        console.log(`   Cloud Cover: ${mlFeatures.cloudCover}%`);
        console.log(`   Beaufort Scale: ${mlFeatures.beaufortScale}`);
        console.log(`   Has Warnings: ${mlFeatures.hasWarnings}`);
        
        // This is where your ML service would be called:
        // const prediction = await mlService.getPrediction(mlFeatures);
        console.log(`✅ ML features ready for model prediction\n`);
        
        return {
            success: true,
            location: weatherData.location,
            mlFeatures: mlFeatures,
            weatherData: weatherData
        };
        
    } catch (error) {
        console.error(`❌ ${locationName}: ${error.message}\n`);
        return {
            success: false,
            error: error.message,
            location: locationName
        };
    }
}

/**
 * Test all your failing locations with complete OpenWeatherMap integration
 */
async function testAllLocationsComplete() {
    console.log('🚀 COMPLETE LOCAL OPENWEATHERMAP INTEGRATION TEST\n');
    console.log('Testing all your exact paddling locations...\n');
    
    const results = [];
    let successCount = 0;
    
    for (const location of FAILING_LOCATIONS) {
        const result = await testMLPredictionWithOpenWeather(
            location.lat, 
            location.lon, 
            location.name
        );
        
        results.push(result);
        if (result.success) successCount++;
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log('📊 FINAL RESULTS:');
    console.log(`✅ Successful: ${successCount}/${FAILING_LOCATIONS.length}`);
    console.log(`❌ Failed: ${FAILING_LOCATIONS.length - successCount}/${FAILING_LOCATIONS.length}`);
    
    if (successCount === FAILING_LOCATIONS.length) {
        console.log('\n🎉 PERFECT! All your paddling locations work with OpenWeatherMap!');
        console.log('Ready to implement in production UnifiedWeatherService.');
    } else {
        console.log('\n⚠️ Some locations failed - need to debug API key activation');
    }
    
    return results;
}

// Run the complete test
testAllLocationsComplete().catch(console.error);
