// INDIAN WEATHER APIs - Global Coverage Research

console.log('🇮🇳 INDIAN WEATHER APIs WITH GLOBAL COVERAGE\n');

// 1. India Meteorological Department (IMD) - India Only
console.log('1️⃣ IMD (India Meteorological Department)');
console.log('   ❌ Coverage: India only');
console.log('   ℹ️ Not suitable for US locations');

// 2. WeatherStack (Indian company, global coverage)
console.log('\n2️⃣ WeatherStack (Indian-owned, Global)');
console.log('   ✅ Coverage: Worldwide');
console.log('   💰 Pricing: 1000 calls/month FREE, then $9.99/month');
console.log('   🌐 URL: https://weatherstack.com/');
console.log('   📍 Coordinate support: YES');
console.log('   🏢 Company: Apilayer (Indian)');

// 3. Weatherbit (Global, has Indian operations)
console.log('\n3️⃣ Weatherbit');
console.log('   ✅ Coverage: Worldwide');
console.log('   💰 Pricing: 1000 calls/day FREE, then $1-5/month');
console.log('   🌐 URL: https://www.weatherbit.io/');
console.log('   📍 Coordinate support: YES');

// 4. ClimaCell/Tomorrow.io (Global, Indian team)
console.log('\n4️⃣ Tomorrow.io (formerly ClimaCell)');
console.log('   ✅ Coverage: Worldwide');
console.log('   💰 Pricing: 500 calls/day FREE');
console.log('   🌐 URL: https://www.tomorrow.io/');
console.log('   📍 Coordinate support: EXCELLENT');
console.log('   🏢 Large Indian development team');

// Test URLs for your failing coordinate
const testCoord = '38.982687,-105.896563';
console.log(`\n🧪 TEST URLS for your coordinate (${testCoord}):`);

console.log('\n📡 WeatherStack:');
console.log(`   curl "http://api.weatherstack.com/current?access_key=YOUR_KEY&query=${testCoord}"`);

console.log('\n📡 Weatherbit:');
console.log(`   curl "https://api.weatherbit.io/v2.0/current?lat=38.982687&lon=-105.896563&key=YOUR_KEY"`);

console.log('\n📡 Tomorrow.io:');
console.log(`   curl "https://api.tomorrow.io/v4/weather/realtime?location=${testCoord}&apikey=YOUR_KEY"`);

console.log('\n📊 RECOMMENDATION FOR YOU:');
console.log('   🥇 WeatherStack: Indian company, reliable, good free tier');
console.log('   🥈 Tomorrow.io: Excellent coordinate precision');
console.log('   🥉 Weatherbit: Good backup option');
console.log('\n   💡 All are better than current WeatherAPI for coordinates!');

async function testWeatherStack() {
    console.log('\n🧪 TESTING WeatherStack (needs API key):');
    console.log('   Sign up at: https://weatherstack.com/');
    console.log('   Free tier: 1000 calls/month');
    console.log('   Indian company with global data');
}
