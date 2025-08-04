#!/usr/bin/env node

/**
 * 🗺️ Kaayko Multi-Location Forecast Heatmap Generator
 * 
 * This tool:
 * - 📍 Fetches all locations from /paddlingOut API
 * - 🌊 Gets forecast data for each location
 * - 📊 Generates comparative heatmaps
 * - 🎯 Creates location-specific analysis
 * - 📈 Plots geographical forecast patterns
 */

const https = require('https');
const fs = require('fs');

// 🎯 Configuration
const CONFIG = {
    BASE_URL: 'https://api-vwcc5j4qda-uc.a.run.app',
    ENDPOINTS: {
        locations: '/paddlingOut',
        forecast: '/paddlePredict/forecast'
    },
    OUTPUT: {
        generateHTML: true,
        saveJSON: true,
        consoleOutput: true
    },
    PERFORMANCE: {
        maxLocations: process.argv.includes('--all') ? 50 : 10,
        concurrent: 3,
        timeout: 10000
    }
};

// 🎨 Visual Elements
const ICONS = {
    location: '📍',
    heatmap: '🗺️',
    forecast: '🌊',
    rating: '⭐',
    temperature: '🌡️',
    wind: '💨',
    analysis: '📊',
    warning: '⚠️',
    excellent: '🟢',
    good: '🟡',
    fair: '🟠',
    poor: '🔴'
};

// 📊 Global Statistics
let GLOBAL_STATS = {
    locations: [],
    totalLocations: 0,
    analyzedLocations: 0,
    failedLocations: 0,
    bestLocation: null,
    worstLocation: null,
    averageRating: 0,
    processingTime: 0
};

/**
 * 🔄 Make HTTP Request with error handling
 */
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

/**
 * 📍 Fetch All Paddling Locations
 */
async function fetchLocations() {
    console.log(`${ICONS.location} Fetching paddling locations...`);
    
    try {
        const url = `${CONFIG.BASE_URL}${CONFIG.ENDPOINTS.locations}`;
        const response = await makeRequest(url, 'locations');
        
        if (response.statusCode !== 200) {
            throw new Error(`Location API returned ${response.statusCode}`);
        }
        
        // The API returns a direct array, not wrapped in a success object
        const locations = Array.isArray(response.data) ? response.data : [];
        console.log(`${ICONS.location} Found ${locations.length} paddling locations`);
        
        if (locations.length === 0) {
            throw new Error('No locations found in API response');
        }
        
        // Take first N locations based on config
        const selectedLocations = locations.slice(0, CONFIG.PERFORMANCE.maxLocations);
        
        return selectedLocations.map(location => ({
            id: location.id,
            name: location.title || location.name || `Location ${location.id}`,
            description: location.text || location.description || '',
            coordinates: {
                lat: location.location?.latitude || location.latitude || location.lat,
                lng: location.location?.longitude || location.longitude || location.lng || location.lon
            },
            image: location.imgSrc?.[0] || location.image,
            originalData: location
        }));
        
    } catch (error) {
        console.error(`${ICONS.warning} Error fetching locations: ${error.message}`);
        throw error;
    }
}

/**
 * 🌊 Fetch Forecast for Single Location
 */
async function fetchLocationForecast(location) {
    if (!location.coordinates.lat || !location.coordinates.lng) {
        console.log(`${ICONS.warning} Skipping ${location.name} - no coordinates`);
        return null;
    }
    
    try {
        const url = `${CONFIG.BASE_URL}${CONFIG.ENDPOINTS.forecast}?lat=${location.coordinates.lat}&lng=${location.coordinates.lng}`;
        const response = await makeRequest(url, location.name);
        
        if (response.statusCode !== 200 || !response.data.success) {
            console.log(`${ICONS.warning} Failed to get forecast for ${location.name}`);
            return null;
        }
        
        return {
            location: location,
            forecast: response.data.forecast,
            metadata: response.data.metadata || {},
            responseTime: response.responseTime
        };
        
    } catch (error) {
        console.log(`${ICONS.warning} Error getting forecast for ${location.name}: ${error.message}`);
        return null;
    }
}

/**
 * 📊 Analyze Location Forecast Data
 */
function analyzeLocationForecast(locationData) {
    if (!locationData || !locationData.forecast) return null;
    
    let totalRating = 0;
    let totalHours = 0;
    let peakHours = 0;
    let safeHours = 0;
    let dangerHours = 0;
    let temperatures = [];
    let windSpeeds = [];
    let bestHour = null;
    let worstHour = null;
    let bestRating = 0;
    let worstRating = 5;
    
    locationData.forecast.forEach((day, dayIndex) => {
        Object.entries(day.hourly).forEach(([hour, hourData]) => {
            totalHours++;
            
            const rating = hourData.rating || hourData.apiRating || 0;
            totalRating += rating;
            
            // Track best/worst
            if (rating > bestRating) {
                bestRating = rating;
                bestHour = `${day.date} ${hour}:00`;
            }
            if (rating < worstRating) {
                worstRating = rating;
                worstHour = `${day.date} ${hour}:00`;
            }
            
            // Categories
            if (rating >= 4.5) peakHours++;
            if (!hourData.warnings || hourData.warnings.length === 0) {
                safeHours++;
            } else if (hourData.warnings.some(w => w.includes('DANGER'))) {
                dangerHours++;
            }
            
            // Weather data
            if (hourData.temperature) temperatures.push(hourData.temperature);
            if (hourData.windSpeed) windSpeeds.push(hourData.windSpeed);
        });
    });
    
    return {
        location: locationData.location,
        stats: {
            totalHours,
            averageRating: (totalRating / totalHours).toFixed(2),
            peakHours,
            safeHours,
            dangerHours,
            peakPercentage: ((peakHours / totalHours) * 100).toFixed(1),
            safePercentage: ((safeHours / totalHours) * 100).toFixed(1),
            bestHour,
            worstHour,
            bestRating: bestRating.toFixed(1),
            worstRating: worstRating.toFixed(1),
            avgTemperature: temperatures.length > 0 ? (temperatures.reduce((a, b) => a + b, 0) / temperatures.length).toFixed(1) : 'N/A',
            avgWindSpeed: windSpeeds.length > 0 ? (windSpeeds.reduce((a, b) => a + b, 0) / windSpeeds.length).toFixed(1) : 'N/A',
            tempRange: temperatures.length > 0 ? `${Math.min(...temperatures).toFixed(1)} - ${Math.max(...temperatures).toFixed(1)}°C` : 'N/A',
            windRange: windSpeeds.length > 0 ? `${Math.min(...windSpeeds).toFixed(1)} - ${Math.max(...windSpeeds).toFixed(1)} km/h` : 'N/A'
        },
        forecast: locationData.forecast,
        responseTime: locationData.responseTime
    };
}

/**
 * 🗺️ Generate Location Heatmap Visual
 */
function generateLocationHeatmap(analysisData) {
    const location = analysisData.location;
    const stats = analysisData.stats;
    
    console.log(`\n${ICONS.heatmap} ========================================`);
    console.log(`${ICONS.location} ${location.name.toUpperCase()}`);
    console.log(`${ICONS.heatmap} ========================================`);
    console.log(`📍 Coordinates: ${location.coordinates.lat}, ${location.coordinates.lng}`);
    console.log(`${ICONS.rating} Average Rating: ${stats.averageRating}/5.0`);
    console.log(`⚡ Peak Hours: ${stats.peakHours}/${stats.totalHours} (${stats.peakPercentage}%)`);
    console.log(`🛡️ Safe Hours: ${stats.safeHours}/${stats.totalHours} (${stats.safePercentage}%)`);
    console.log(`${ICONS.temperature} Temperature: ${stats.tempRange}, avg ${stats.avgTemperature}°C`);
    console.log(`${ICONS.wind} Wind Speed: ${stats.windRange}, avg ${stats.avgWindSpeed} km/h`);
    
    // Mini heatmap for each day
    analysisData.forecast.forEach((day, dayIndex) => {
        console.log(`\n📅 ${day.date}`);
        console.log('Hour │' + '0123456789012345678901234'.split('').map(h => h.padStart(3)).join('│'));
        console.log('─────┼' + '─'.repeat(73));
        
        let ratingLine = 'Rate │';
        let iconLine = 'Cond │';
        
        for (let h = 0; h < 24; h++) {
            const hourData = day.hourly[h.toString()];
            if (hourData) {
                const rating = hourData.rating || hourData.apiRating || 0;
                let icon = '';
                if (rating >= 4.5) icon = '🟢';
                else if (rating >= 3.5) icon = '🟡';
                else if (rating >= 2.5) icon = '🟠';
                else icon = '🔴';
                
                ratingLine += rating.toFixed(1).padStart(3);
                iconLine += ` ${icon} `;
            } else {
                ratingLine += ' - ';
                iconLine += ' ⚫ ';
            }
            if (h < 23) {
                ratingLine += '│';
                iconLine += '│';
            }
        }
        
        console.log(ratingLine);
        console.log(iconLine);
    });
    
    console.log(`\n🏆 Best Conditions: ${stats.bestHour} (${stats.bestRating}/5.0)`);
    console.log(`⚠️ Worst Conditions: ${stats.worstHour} (${stats.worstRating}/5.0)`);
}

/**
 * 📊 Generate Comparative Analysis
 */
function generateComparativeAnalysis(allAnalysis) {
    console.log(`\n${ICONS.analysis} ==========================================`);
    console.log(`${ICONS.heatmap} MULTI-LOCATION COMPARATIVE ANALYSIS`);
    console.log(`${ICONS.analysis} ==========================================`);
    
    // Sort by average rating
    const sortedByRating = [...allAnalysis].sort((a, b) => 
        parseFloat(b.stats.averageRating) - parseFloat(a.stats.averageRating)
    );
    
    console.log(`\n${ICONS.rating} TOP LOCATIONS BY AVERAGE RATING:`);
    console.log('─'.repeat(80));
    console.log('Rank │ Location                    │ Rating │ Peak% │ Safe% │ Temp   │');
    console.log('─'.repeat(80));
    
    sortedByRating.forEach((analysis, index) => {
        const loc = analysis.location;
        const stats = analysis.stats;
        const rank = (index + 1).toString().padStart(2);
        const name = loc.name.substring(0, 25).padEnd(25);
        const rating = stats.averageRating.padStart(4);
        const peak = (stats.peakPercentage + '%').padStart(5);
        const safe = (stats.safePercentage + '%').padStart(5);
        const temp = stats.avgTemperature.padStart(5);
        
        let emoji = '';
        if (index === 0) emoji = '🥇';
        else if (index === 1) emoji = '🥈';
        else if (index === 2) emoji = '🥉';
        else emoji = `${index + 1}.`;
        
        console.log(`${emoji.padStart(4)} │ ${name} │ ${rating} │ ${peak} │ ${safe} │ ${temp}°C │`);
    });
    
    // Peak conditions analysis
    console.log(`\n${ICONS.excellent} LOCATIONS WITH MOST PEAK CONDITIONS (4.5+ rating):`);
    const sortedByPeak = [...allAnalysis].sort((a, b) => 
        parseInt(b.stats.peakHours) - parseInt(a.stats.peakHours)
    );
    
    sortedByPeak.slice(0, 5).forEach((analysis, index) => {
        const loc = analysis.location;
        const stats = analysis.stats;
        console.log(`   ${index + 1}. ${loc.name}: ${stats.peakHours} hours (${stats.peakPercentage}%)`);
    });
    
    // Safety analysis
    console.log(`\n${ICONS.warning} SAFEST LOCATIONS (fewest warnings):`);
    const sortedBySafety = [...allAnalysis].sort((a, b) => 
        parseInt(b.stats.safeHours) - parseInt(a.stats.safeHours)
    );
    
    sortedBySafety.slice(0, 5).forEach((analysis, index) => {
        const loc = analysis.location;
        const stats = analysis.stats;
        console.log(`   ${index + 1}. ${loc.name}: ${stats.safeHours} safe hours (${stats.safePercentage}%)`);
    });
    
    // Update global stats
    GLOBAL_STATS.bestLocation = sortedByRating[0];
    GLOBAL_STATS.worstLocation = sortedByRating[sortedByRating.length - 1];
    GLOBAL_STATS.averageRating = (allAnalysis.reduce((sum, a) => 
        sum + parseFloat(a.stats.averageRating), 0) / allAnalysis.length).toFixed(2);
}

/**
 * 📄 Generate HTML Report
 */
function generateHTMLReport(allAnalysis) {
    if (!CONFIG.OUTPUT.generateHTML) return;
    
    const timestamp = new Date().toISOString();
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kaayko Multi-Location Forecast Heatmap</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 20px; margin-bottom: 30px; }
        .location-card { background: #ffffff; border: 1px solid #ddd; border-radius: 8px; margin: 20px 0; padding: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .location-header { background: linear-gradient(135deg, #3498db, #2980b9); color: white; padding: 15px; border-radius: 8px 8px 0 0; margin: -20px -20px 20px -20px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
        .stat-box { background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; border-left: 4px solid #3498db; }
        .heatmap-grid { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; margin: 15px 0; }
        .hour-cell { aspect-ratio: 1; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: white; font-weight: bold; }
        .rating-5 { background: #27ae60; } .rating-4 { background: #f39c12; } .rating-3 { background: #e67e22; } .rating-2 { background: #e74c3c; }
        .comparison-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .comparison-table th, .comparison-table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        .comparison-table th { background: #3498db; color: white; }
        .timestamp { text-align: center; color: #7f8c8d; font-size: 12px; margin-top: 30px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🗺️ Kaayko Multi-Location Forecast Heatmap</h1>
            <p>Comprehensive paddling conditions analysis across ${allAnalysis.length} locations</p>
        </div>
        
        <div class="summary">
            <h2>📊 Summary</h2>
            <div class="stats-grid">
                <div class="stat-box">
                    <h3>🏆 Best Location</h3>
                    <p>${GLOBAL_STATS.bestLocation.location.name}<br>Rating: ${GLOBAL_STATS.bestLocation.stats.averageRating}/5.0</p>
                </div>
                <div class="stat-box">
                    <h3>📍 Locations Analyzed</h3>
                    <p>${allAnalysis.length} locations<br>Average: ${GLOBAL_STATS.averageRating}/5.0</p>
                </div>
                <div class="stat-box">
                    <h3>⏱️ Processing Time</h3>
                    <p>${GLOBAL_STATS.processingTime}ms<br>Multi-location analysis</p>
                </div>
            </div>
        </div>

        ${allAnalysis.map(analysis => {
            const loc = analysis.location;
            const stats = analysis.stats;
            let heatmapCells = '';
            
            analysis.forecast.forEach(day => {
                for (let h = 0; h < 24; h++) {
                    const hourData = day.hourly[h.toString()];
                    if (hourData) {
                        const rating = hourData.rating || hourData.apiRating || 0;
                        let cssClass = 'rating-2';
                        if (rating >= 4.5) cssClass = 'rating-5';
                        else if (rating >= 3.5) cssClass = 'rating-4';
                        else if (rating >= 2.5) cssClass = 'rating-3';
                        
                        heatmapCells += `<div class="hour-cell ${cssClass}">${rating.toFixed(1)}</div>`;
                    } else {
                        heatmapCells += `<div class="hour-cell" style="background:#ccc">-</div>`;
                    }
                }
            });
            
            return `
                <div class="location-card">
                    <div class="location-header">
                        <h2>📍 ${loc.name}</h2>
                        <p>Coordinates: ${loc.coordinates.lat}, ${loc.coordinates.lng}</p>
                    </div>
                    
                    <div class="stats-grid">
                        <div class="stat-box">
                            <h4>⭐ Average Rating</h4>
                            <p>${stats.averageRating}/5.0</p>
                        </div>
                        <div class="stat-box">
                            <h4>⚡ Peak Hours</h4>
                            <p>${stats.peakHours} (${stats.peakPercentage}%)</p>
                        </div>
                        <div class="stat-box">
                            <h4>🛡️ Safe Hours</h4>
                            <p>${stats.safeHours} (${stats.safePercentage}%)</p>
                        </div>
                        <div class="stat-box">
                            <h4>🌡️ Temperature</h4>
                            <p>${stats.avgTemperature}°C avg</p>
                        </div>
                    </div>
                    
                    <h4>📊 72-Hour Forecast Heatmap</h4>
                    <div class="heatmap-grid">
                        ${heatmapCells}
                    </div>
                    
                    <p><strong>🏆 Best:</strong> ${stats.bestHour} (${stats.bestRating}/5.0)</p>
                    <p><strong>⚠️ Worst:</strong> ${stats.worstHour} (${stats.worstRating}/5.0)</p>
                </div>
            `;
        }).join('')}
        
        <div class="timestamp">
            Generated: ${timestamp}<br>
            Data source: Kaayko API (${CONFIG.BASE_URL})
        </div>
    </div>
</body>
</html>`;
    
    const filename = `multi_location_heatmap_${Date.now()}.html`;
    fs.writeFileSync(filename, html);
    console.log(`\n📄 HTML report saved: ${filename}`);
}

/**
 * 🚀 Main Multi-Location Analysis
 */
async function runMultiLocationAnalysis() {
    const startTime = Date.now();
    
    try {
        console.log(`${ICONS.heatmap} Starting Multi-Location Forecast Analysis...`);
        console.log(`⚙️ Max Locations: ${CONFIG.PERFORMANCE.maxLocations}`);
        console.log(`🔄 Concurrency: ${CONFIG.PERFORMANCE.concurrent}`);
        
        // 1. Fetch all locations
        const locations = await fetchLocations();
        GLOBAL_STATS.totalLocations = locations.length;
        
        if (locations.length === 0) {
            throw new Error('No locations found');
        }
        
        console.log(`\n${ICONS.forecast} Fetching forecasts for ${locations.length} locations...`);
        
        // 2. Fetch forecasts (with concurrency control)
        const allForecasts = [];
        const batches = [];
        for (let i = 0; i < locations.length; i += CONFIG.PERFORMANCE.concurrent) {
            batches.push(locations.slice(i, i + CONFIG.PERFORMANCE.concurrent));
        }
        
        for (const batch of batches) {
            const batchPromises = batch.map(location => fetchLocationForecast(location));
            const batchResults = await Promise.all(batchPromises);
            allForecasts.push(...batchResults);
            
            // Progress update
            console.log(`📊 Progress: ${allForecasts.length}/${locations.length} locations processed`);
        }
        
        // 3. Filter successful forecasts and analyze
        const validForecasts = allForecasts.filter(f => f !== null);
        GLOBAL_STATS.analyzedLocations = validForecasts.length;
        GLOBAL_STATS.failedLocations = locations.length - validForecasts.length;
        
        if (validForecasts.length === 0) {
            throw new Error('No valid forecasts obtained from any location');
        }
        
        console.log(`\n${ICONS.analysis} Analyzing ${validForecasts.length} successful forecasts...`);
        
        const allAnalysis = validForecasts
            .map(forecast => analyzeLocationForecast(forecast))
            .filter(analysis => analysis !== null); // Filter out null analysis results
        
        // 4. Generate reports
        if (CONFIG.OUTPUT.consoleOutput) {
            // Individual location heatmaps
            allAnalysis.forEach(analysis => generateLocationHeatmap(analysis));
            
            // Comparative analysis
            generateComparativeAnalysis(allAnalysis);
        }
        
        // 5. Generate HTML report
        GLOBAL_STATS.processingTime = Date.now() - startTime;
        generateHTMLReport(allAnalysis);
        
        // 6. Save JSON data
        if (CONFIG.OUTPUT.saveJSON) {
            const jsonData = {
                metadata: {
                    timestamp: new Date().toISOString(),
                    processingTime: GLOBAL_STATS.processingTime,
                    totalLocations: GLOBAL_STATS.totalLocations,
                    analyzedLocations: GLOBAL_STATS.analyzedLocations,
                    failedLocations: GLOBAL_STATS.failedLocations
                },
                globalStats: GLOBAL_STATS,
                locationAnalysis: allAnalysis
            };
            
            const jsonFilename = `multi_location_data_${Date.now()}.json`;
            fs.writeFileSync(jsonFilename, JSON.stringify(jsonData, null, 2));
            console.log(`💾 JSON data saved: ${jsonFilename}`);
        }
        
        // Final summary
        console.log(`\n${ICONS.heatmap} ==========================================`);
        console.log(`${ICONS.analysis} MULTI-LOCATION ANALYSIS COMPLETE`);
        console.log(`${ICONS.heatmap} ==========================================`);
        console.log(`✅ Successfully analyzed: ${GLOBAL_STATS.analyzedLocations} locations`);
        console.log(`❌ Failed forecasts: ${GLOBAL_STATS.failedLocations} locations`);
        console.log(`🏆 Best location: ${GLOBAL_STATS.bestLocation?.location.name} (${GLOBAL_STATS.bestLocation?.stats.averageRating}/5.0)`);
        console.log(`📊 Overall average: ${GLOBAL_STATS.averageRating}/5.0`);
        console.log(`⏱️ Total processing time: ${GLOBAL_STATS.processingTime}ms`);
        
        return {
            success: true,
            stats: GLOBAL_STATS,
            analysis: allAnalysis,
            processingTime: GLOBAL_STATS.processingTime
        };
        
    } catch (error) {
        console.error(`\n${ICONS.warning} ==========================================`);
        console.error(`${ICONS.warning} MULTI-LOCATION ANALYSIS ERROR`);
        console.error(`${ICONS.warning} ==========================================`);
        console.error(`❌ Error: ${error.message}`);
        
        return {
            success: false,
            error: error.message,
            stats: GLOBAL_STATS
        };
    }
}

// 🚀 Usage Examples
function showUsage() {
    console.log(`\n${ICONS.heatmap} USAGE OPTIONS:`);
    console.log(`🗺️ Standard:    node multi_location_heatmap.js`);
    console.log(`🌍 All locs:    node multi_location_heatmap.js --all`);
    console.log(`📊 Quiet:       node multi_location_heatmap.js --quiet`);
    console.log(`💾 JSON only:   node multi_location_heatmap.js --json-only`);
    console.log(`\nFeatures:`);
    console.log(`- Fetches all locations from /paddlingOut`);
    console.log(`- Gets 72-hour forecast for each location`);
    console.log(`- Generates comparative heatmaps`);
    console.log(`- Creates interactive HTML report`);
    console.log(`- Saves raw data as JSON`);
}

// Handle quiet mode
if (process.argv.includes('--quiet')) {
    CONFIG.OUTPUT.consoleOutput = false;
}

if (process.argv.includes('--json-only')) {
    CONFIG.OUTPUT.consoleOutput = false;
    CONFIG.OUTPUT.generateHTML = false;
}

// 🚀 Execute
if (require.main === module) {
    if (process.argv.includes('--help')) {
        showUsage();
        process.exit(0);
    }
    
    runMultiLocationAnalysis().then(result => {
        if (result.success) {
            console.log(`\n${ICONS.heatmap} Multi-location heatmap analysis completed successfully! 🎉`);
            process.exit(0);
        } else {
            console.error(`\n${ICONS.warning} Multi-location analysis failed: ${result.error}`);
            process.exit(1);
        }
    });
}

module.exports = { runMultiLocationAnalysis, CONFIG };
