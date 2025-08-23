// WEATHER API ALTERNATIVES COMPARISON
// Testing different weather services for the EXACT failing coordinates

const https = require('https');

const FAILING_COORD = "38.982687,-105.896563"; // Antero Reservoir, CO

console.log('🌤️ COMPARING WEATHER API ALTERNATIVES\n');

// 1. WeatherAPI.com (current - BROKEN)
async function testWeatherAPI() {
    console.log('1️⃣ CURRENT: WeatherAPI.com');
    const url = `https://api.weatherapi.com/v1/current.json?key=26fbd83a03c945c9b34190954253107&q=${FAILING_COORD}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.error) {
            console.log(`   ❌ FAILED: ${data.error.message}`);
        } else {
            console.log(`   ✅ SUCCESS: ${data.location.name}, ${data.location.region}`);
        }
    } catch (error) {
        console.log(`   ❌ ERROR: ${error.message}`);
    }
}

// 2. OpenWeatherMap (FREE 1000 calls/day)
async function testOpenWeatherMap() {
    console.log('\n2️⃣ ALTERNATIVE: OpenWeatherMap (FREE)');
    const [lat, lon] = FAILING_COORD.split(',');
    // Free API key - 1000 calls/day
    const apiKey = 'demo'; // You need to get free key at openweathermap.org
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    
    console.log(`   🔗 URL: ${url}`);
    console.log(`   ℹ️ Need FREE API key from openweathermap.org`);
    console.log(`   ℹ️ 1000 calls/day FREE, then $1.50/1000 calls`);
}

// 3. AccuWeather (50 calls/day FREE)
async function testAccuWeather() {
    console.log('\n3️⃣ ALTERNATIVE: AccuWeather (LIMITED FREE)');
    console.log(`   ℹ️ Need FREE API key from developer.accuweather.com`);
    console.log(`   ℹ️ 50 calls/day FREE, then paid plans`);
    console.log(`   ℹ️ Very reliable for US locations`);
}

// 4. National Weather Service (FREE - US ONLY)
async function testNWS() {
    console.log('\n4️⃣ ALTERNATIVE: National Weather Service (FREE US ONLY)');
    const [lat, lon] = FAILING_COORD.split(',');
    const url = `https://api.weather.gov/points/${lat},${lon}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.properties) {
            console.log(`   ✅ SUCCESS: US Government API - FREE forever`);
            console.log(`   📍 Grid: ${data.properties.gridId} (${data.properties.gridX},${data.properties.gridY})`);
            console.log(`   🏢 Office: ${data.properties.cwa}`);
        } else {
            console.log(`   ❌ FAILED: ${JSON.stringify(data)}`);
        }
    } catch (error) {
        console.log(`   ❌ ERROR: ${error.message}`);
    }
}

// 5. Visual Crossing (1000 free/day)
async function testVisualCrossing() {
    console.log('\n5️⃣ ALTERNATIVE: Visual Crossing Weather (FREE)');
    console.log(`   ℹ️ 1000 calls/day FREE with signup`);
    console.log(`   ℹ️ Very reliable coordinate matching`);
    console.log(`   ℹ️ Good for historical data too`);
}

// Run comparison
async function compareAPIs() {
    await testWeatherAPI();
    await testOpenWeatherMap();
    await testAccuWeather();
    await testNWS();
    await testVisualCrossing();
    
    console.log('\n📊 RECOMMENDATION:');
    console.log('   🥇 BEST: National Weather Service (FREE, US-only, government data)');
    console.log('   🥈 BACKUP: OpenWeatherMap (FREE 1000/day, global)');
    console.log('   🥉 CURRENT: WeatherAPI.com (BROKEN location matching!)');
}

compareAPIs().catch(console.error);
