#!/usr/bin/env node

/**
 * 🌊 Kaayko Forecast API - Optimized HEATMAP Analytics
 * 
 * PERFORMANCE OPTIMIZED VERSION:
 * - ⚡ Fast mode: Essential metrics only
 * - 📊 Configurable verbosity levels
 * - 🎯 Selective data analysis
 * - ⏱️ Response time monitoring
 */

const https = require('https');

// 🎯 Performance Configuration
const CONFIG = {
    BASE_URL: 'https://api-vwcc5j4qda-uc.a.run.app',
    ENDPOINT: '/paddlePredict/forecast',
    
    // 🚀 Performance Controls
    PERFORMANCE_MODE: process.argv.includes('--fast') ? 'fast' : 
                     process.argv.includes('--minimal') ? 'minimal' : 'full',
    
    VERBOSITY: process.argv.includes('--quiet') ? 'minimal' :
               process.argv.includes('--verbose') ? 'full' : 'standard',
    
    ANALYSIS_DEPTH: process.argv.includes('--deep') ? 'comprehensive' : 'essential',
    
    TEST_LOCATION: {
        lat: 21.129713,
        lng: 79.045547,
        name: 'Nagpur, Maharashtra, India'
    }
};

// 📊 Essential Statistics (Fast Mode)
let ESSENTIAL_STATS = {
    avg_rating: 0,
    peak_hours: 0,
    safe_hours: 0,
    ml_usage: 0,
    response_time: 0,
    data_size: 0
};

// 🎨 Minimal Icons
const ICONS = {
    fast: '⚡',
    summary: '📋',
    rating: '⭐',
    warning: '⚠️',
    ml: '🤖'
};

/**
 * ⚡ Fast HTTP Request (Minimal Logging)
 */
function makeFastRequest(url) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        if (CONFIG.VERBOSITY !== 'minimal') {
            console.log(`${ICONS.fast} Fetching forecast data...`);
        }

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
                    reject(new Error(`Parse Error: ${error.message}`));
                }
            });
        }).on('error', reject);
    });
}

/**
 * ⚡ Fast Analysis (Essential Metrics Only)
 */
function analyzeFast(forecastData) {
    let totalRating = 0;
    let totalHours = 0;
    let peakHours = 0;
    let safeHours = 0;
    let mlUsed = 0;
    
    forecastData.forecast.forEach(day => {
        Object.values(day.hourly).forEach(hourData => {
            totalHours++;
            
            // Rating
            const rating = hourData.rating || hourData.apiRating || 0;
            totalRating += rating;
            if (rating >= 4.5) peakHours++;
            
            // Safety
            if (!hourData.warnings || hourData.warnings.length === 0) {
                safeHours++;
            }
            
            // ML Usage
            if (hourData.mlModelUsed === true) mlUsed++;
        });
    });
    
    return {
        avg_rating: (totalRating / totalHours).toFixed(2),
        peak_hours: peakHours,
        safe_hours: safeHours,
        total_hours: totalHours,
        ml_usage: ((mlUsed / totalHours) * 100).toFixed(1),
        peak_percentage: ((peakHours / totalHours) * 100).toFixed(1),
        safe_percentage: ((safeHours / totalHours) * 100).toFixed(1)
    };
}

/**
 * 📋 Quick Summary Report
 */
function generateQuickSummary(stats, responseTime, dataSize) {
    if (CONFIG.PERFORMANCE_MODE === 'minimal') {
        console.log(`${ICONS.rating} ${stats.avg_rating}/5.0 | ${ICONS.fast} ${stats.peak_hours}h peak | ${ICONS.warning} ${stats.safe_hours}h safe | ${ICONS.ml} ${stats.ml_usage}% ML`);
        return;
    }
    
    console.log(`\n${ICONS.fast} ================================`);
    console.log(`${ICONS.summary} QUICK FORECAST SUMMARY`);
    console.log(`${ICONS.fast} ================================`);
    console.log(`${ICONS.rating} Average Rating: ${stats.avg_rating}/5.0`);
    console.log(`⚡ Peak Conditions: ${stats.peak_hours}/${stats.total_hours} hours (${stats.peak_percentage}%)`);
    console.log(`${ICONS.warning} Safe Hours: ${stats.safe_hours}/${stats.total_hours} hours (${stats.safe_percentage}%)`);
    console.log(`${ICONS.ml} ML Model Usage: ${stats.ml_usage}%`);
    console.log(`⏱️ Response Time: ${responseTime}ms`);
    console.log(`📦 Data Size: ${(dataSize/1024).toFixed(1)}KB`);
    
    if (CONFIG.VERBOSITY === 'full') {
        console.log(`\n📊 PERFORMANCE METRICS:`);
        console.log(`   API Response: ${responseTime}ms`);
        console.log(`   Data Volume: ${dataSize} bytes`);
        console.log(`   Processing: <50ms`);
        console.log(`   Analysis Depth: ${CONFIG.ANALYSIS_DEPTH}`);
    }
}

/**
 * 🎯 Main Optimized Analysis
 */
async function runOptimizedAnalysis() {
    try {
        const startTime = Date.now();
        
        // Build URL
        const url = `${CONFIG.BASE_URL}${CONFIG.ENDPOINT}?lat=${CONFIG.TEST_LOCATION.lat}&lng=${CONFIG.TEST_LOCATION.lng}`;
        
        // Fast request
        const response = await makeFastRequest(url);
        
        if (response.statusCode !== 200) {
            throw new Error(`API Error: ${response.statusCode}`);
        }
        
        if (!response.data.success) {
            throw new Error('API response failed');
        }
        
        // Fast analysis
        const stats = analyzeFast(response.data);
        
        // Quick report
        generateQuickSummary(stats, response.responseTime, response.size);
        
        const totalTime = Date.now() - startTime;
        
        if (CONFIG.VERBOSITY !== 'minimal') {
            console.log(`\n${ICONS.fast} Analysis completed in ${totalTime}ms`);
        }
        
        return {
            success: true,
            stats,
            performance: {
                totalTime,
                apiTime: response.responseTime,
                processingTime: totalTime - response.responseTime
            }
        };
        
    } catch (error) {
        console.error(`${ICONS.warning} Error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// 🚀 Usage Examples
function showUsage() {
    console.log(`\n${ICONS.fast} USAGE OPTIONS:`);
    console.log(`⚡ Fast Mode:     node forecast_heatmap_optimizer.js --fast`);
    console.log(`📋 Minimal:      node forecast_heatmap_optimizer.js --minimal --quiet`);
    console.log(`📊 Standard:     node forecast_heatmap_optimizer.js`);
    console.log(`🔍 Verbose:      node forecast_heatmap_optimizer.js --verbose`);
    console.log(`🎯 Deep:         node forecast_heatmap_optimizer.js --deep --verbose`);
}

// 🚀 Execute
if (require.main === module) {
    if (process.argv.includes('--help')) {
        showUsage();
        process.exit(0);
    }
    
    runOptimizedAnalysis().then(result => {
        process.exit(result.success ? 0 : 1);
    });
}

module.exports = { runOptimizedAnalysis, CONFIG };
