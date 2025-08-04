#!/usr/bin/env node

/**
 * 🌊 Kaayko Forecast API - HEATMAP Analytics & Statistics Generator
 * 
 * This specialized test analyzes the Forecast API response and generates:
 * - 📊 Statistical analysis of all weather metrics
 * - 🗺️ Visual heatmaps for ratings, conditions, and warnings
 * - 📈 Trend analysis across time periods
 * - ⚠️ Safety analysis and warning patterns
 * - 🤖 ML Model usage statistics
 */

const https = require('https');
const fs = require('fs');

// 🎯 Configuration
const CONFIG = {
    BASE_URL: 'https://api-vwcc5j4qda-uc.a.run.app',
    ENDPOINT: '/paddlePredict/forecast',
    TEST_LOCATION: {
        lat: 21.129713,
        lng: 79.045547,
        name: 'Nagpur, Maharashtra, India'
    },
    ENABLE_DETAILED_LOGGING: true,
    GENERATE_HTML_REPORT: true
};

// 🎨 Visual Elements for Output
const ICONS = {
    analysis: '📊',
    heatmap: '🗺️',
    trend: '📈',
    warning: '⚠️',
    safety: '🛡️',
    ml: '🤖',
    time: '⏰',
    rating: '⭐',
    temperature: '🌡️',
    wind: '💨',
    visibility: '👁️',
    uv: '☀️',
    humidity: '💧',
    cloud: '☁️'
};

// 📊 Statistics Tracking
let STATS = {
    total_hours: 0,
    total_days: 0,
    ratings: {
        distribution: {},
        avg: 0,
        min: 5,
        max: 0,
        peak_hours: [],
        worst_hours: []
    },
    weather: {
        temperature: { min: 50, max: 0, avg: 0, values: [] },
        windSpeed: { min: 100, max: 0, avg: 0, values: [] },
        humidity: { min: 100, max: 0, avg: 0, values: [] },
        uvIndex: { min: 20, max: 0, avg: 0, values: [] },
        visibility: { min: 20, max: 0, avg: 0, values: [] },
        cloudCover: { min: 100, max: 0, avg: 0, values: [] }
    },
    warnings: {
        total: 0,
        by_type: {},
        danger_hours: 0,
        warning_hours: 0,
        caution_hours: 0,
        safe_hours: 0
    },
    ml_model: {
        used: 0,
        fallback: 0,
        usage_percentage: 0
    },
    beaufort_scale: {},
    safety_deductions: {
        total: 0,
        avg: 0,
        max: 0,
        affected_hours: 0
    }
};

/**
 * 🔄 Make HTTP Request with detailed logging
 */
function makeRequest(url) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        if (CONFIG.ENABLE_DETAILED_LOGGING) {
            console.log(`\n${ICONS.analysis} ===============================================`);
            console.log(`${ICONS.heatmap} FORECAST API HEATMAP ANALYSIS REQUEST`);
            console.log(`${ICONS.analysis} ===============================================`);
            console.log(`🔗 URL: ${url}`);
            console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
            console.log(`📍 Location: ${CONFIG.TEST_LOCATION.name}`);
            console.log(`📊 Coordinates: ${CONFIG.TEST_LOCATION.lat}, ${CONFIG.TEST_LOCATION.lng}`);
        }

        https.get(url, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                const responseTime = Date.now() - startTime;
                
                if (CONFIG.ENABLE_DETAILED_LOGGING) {
                    console.log(`\n${ICONS.analysis} ===============================================`);
                    console.log(`${ICONS.heatmap} FORECAST API RESPONSE RECEIVED`);
                    console.log(`${ICONS.analysis} ===============================================`);
                    console.log(`📊 Status Code: ${res.statusCode}`);
                    console.log(`⚡ Response Time: ${responseTime}ms`);
                    console.log(`📦 Data Size: ${data.length} bytes`);
                }

                try {
                    const jsonData = JSON.parse(data);
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: jsonData,
                        responseTime,
                        size: data.length
                    });
                } catch (error) {
                    reject(new Error(`JSON Parse Error: ${error.message}`));
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * 📊 Analyze Single Hour Data
 */
function analyzeHourData(hour, hourData, date) {
    STATS.total_hours++;
    
    // Rating Analysis
    const rating = hourData.rating || hourData.apiRating;
    if (rating) {
        STATS.ratings.distribution[rating] = (STATS.ratings.distribution[rating] || 0) + 1;
        STATS.ratings.min = Math.min(STATS.ratings.min, rating);
        STATS.ratings.max = Math.max(STATS.ratings.max, rating);
        
        if (rating >= 4.5) {
            STATS.ratings.peak_hours.push(`${date} ${hour}:00`);
        }
        if (rating <= 2.5) {
            STATS.ratings.worst_hours.push(`${date} ${hour}:00`);
        }
    }
    
    // Weather Metrics Analysis
    const metrics = ['temperature', 'windSpeed', 'humidity', 'uvIndex', 'visibility', 'cloudCover'];
    metrics.forEach(metric => {
        if (hourData[metric] !== undefined) {
            const value = hourData[metric];
            STATS.weather[metric].values.push(value);
            STATS.weather[metric].min = Math.min(STATS.weather[metric].min, value);
            STATS.weather[metric].max = Math.max(STATS.weather[metric].max, value);
        }
    });
    
    // Warning Analysis
    if (hourData.warnings && hourData.warnings.length > 0) {
        STATS.warnings.total += hourData.warnings.length;
        
        hourData.warnings.forEach(warning => {
            if (warning.includes('DANGER')) {
                STATS.warnings.danger_hours++;
                STATS.warnings.by_type['DANGER'] = (STATS.warnings.by_type['DANGER'] || 0) + 1;
            } else if (warning.includes('WARNING')) {
                STATS.warnings.warning_hours++;
                STATS.warnings.by_type['WARNING'] = (STATS.warnings.by_type['WARNING'] || 0) + 1;
            } else if (warning.includes('CAUTION')) {
                STATS.warnings.caution_hours++;
                STATS.warnings.by_type['CAUTION'] = (STATS.warnings.by_type['CAUTION'] || 0) + 1;
            }
        });
    } else {
        STATS.warnings.safe_hours++;
    }
    
    // ML Model Usage
    if (hourData.mlModelUsed === true) {
        STATS.ml_model.used++;
    } else {
        STATS.ml_model.fallback++;
    }
    
    // Beaufort Scale Distribution
    if (hourData.beaufortScale !== undefined) {
        STATS.beaufort_scale[hourData.beaufortScale] = (STATS.beaufort_scale[hourData.beaufortScale] || 0) + 1;
    }
    
    // Safety Deduction Analysis
    if (hourData.safetyDeduction && hourData.safetyDeduction > 0) {
        STATS.safety_deductions.total += hourData.safetyDeduction;
        STATS.safety_deductions.max = Math.max(STATS.safety_deductions.max, hourData.safetyDeduction);
        STATS.safety_deductions.affected_hours++;
    }
}

/**
 * 📊 Calculate Final Statistics
 */
function calculateFinalStats() {
    // Rating averages
    let totalRating = 0;
    let ratingCount = 0;
    Object.entries(STATS.ratings.distribution).forEach(([rating, count]) => {
        totalRating += parseFloat(rating) * count;
        ratingCount += count;
    });
    STATS.ratings.avg = ratingCount > 0 ? (totalRating / ratingCount) : 0;
    
    // Weather averages
    Object.keys(STATS.weather).forEach(metric => {
        const values = STATS.weather[metric].values;
        if (values.length > 0) {
            STATS.weather[metric].avg = values.reduce((a, b) => a + b, 0) / values.length;
        }
    });
    
    // ML Model percentage
    const totalPredictions = STATS.ml_model.used + STATS.ml_model.fallback;
    STATS.ml_model.usage_percentage = totalPredictions > 0 ? (STATS.ml_model.used / totalPredictions * 100) : 0;
    
    // Safety deduction average
    STATS.safety_deductions.avg = STATS.safety_deductions.affected_hours > 0 ? 
        (STATS.safety_deductions.total / STATS.safety_deductions.affected_hours) : 0;
}

/**
 * 🗺️ Generate Visual Heatmap
 */
function generateHeatmap(forecastData) {
    console.log(`\n${ICONS.heatmap} ===============================================`);
    console.log(`${ICONS.heatmap} FORECAST DATA HEATMAP VISUALIZATION`);
    console.log(`${ICONS.heatmap} ===============================================`);
    
    forecastData.forecast.forEach((day, dayIndex) => {
        console.log(`\n📅 DAY ${dayIndex + 1}: ${day.date}`);
        console.log('═'.repeat(50));
        
        // Header
        console.log('Hour │ Rating │ Temp │ Wind │ UV │ Warnings');
        console.log('─'.repeat(50));
        
        // Hourly data
        Object.entries(day.hourly).forEach(([hour, data]) => {
            const rating = data.rating || data.apiRating || 0;
            const temp = data.temperature || 0;
            const wind = data.windSpeed || 0;
            const uv = data.uvIndex || 0;
            const warnings = data.warnings ? data.warnings.length : 0;
            
            // Color coding for rating
            let ratingColor = '';
            if (rating >= 4.5) ratingColor = '🟢'; // Excellent
            else if (rating >= 3.5) ratingColor = '🟡'; // Good
            else if (rating >= 2.5) ratingColor = '🟠'; // Fair
            else ratingColor = '🔴'; // Poor
            
            console.log(`${hour.padStart(2)}h  │ ${ratingColor} ${rating.toFixed(1)} │ ${temp.toFixed(1)}°C │ ${wind.toFixed(1)}km/h │ ${uv.toFixed(1)} │ ${warnings} warn`);
        });
    });
}

/**
 * 📈 Generate Detailed Statistics Report
 */
function generateStatsReport() {
    console.log(`\n${ICONS.analysis} ===============================================`);
    console.log(`${ICONS.analysis} COMPREHENSIVE FORECAST STATISTICS`);
    console.log(`${ICONS.analysis} ===============================================`);
    
    // Overview
    console.log(`\n${ICONS.time} OVERVIEW:`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 Total Hours Analyzed: ${STATS.total_hours}`);
    console.log(`📅 Total Days: ${STATS.total_days}`);
    console.log(`📍 Location: ${CONFIG.TEST_LOCATION.name}`);
    
    // Rating Analysis
    console.log(`\n${ICONS.rating} RATING ANALYSIS:`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`⭐ Average Rating: ${STATS.ratings.avg.toFixed(2)}/5.0`);
    console.log(`🏆 Peak Rating: ${STATS.ratings.max}/5.0`);
    console.log(`⚠️ Lowest Rating: ${STATS.ratings.min}/5.0`);
    console.log(`\n📊 Rating Distribution:`);
    Object.entries(STATS.ratings.distribution)
        .sort(([a], [b]) => parseFloat(b) - parseFloat(a))
        .forEach(([rating, count]) => {
            const percentage = (count / STATS.total_hours * 100).toFixed(1);
            const bar = '█'.repeat(Math.floor(percentage / 2));
            console.log(`   ${rating}/5.0: ${count.toString().padStart(3)} hours (${percentage.padStart(5)}%) ${bar}`);
        });
    
    if (STATS.ratings.peak_hours.length > 0) {
        console.log(`\n🏆 PEAK CONDITIONS (4.5+ rating):`);
        STATS.ratings.peak_hours.slice(0, 10).forEach(time => {
            console.log(`   🟢 ${time}`);
        });
        if (STATS.ratings.peak_hours.length > 10) {
            console.log(`   ... and ${STATS.ratings.peak_hours.length - 10} more peak periods`);
        }
    }
    
    // Weather Analysis
    console.log(`\n${ICONS.temperature} WEATHER METRICS ANALYSIS:`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    const weatherMetrics = [
        { key: 'temperature', icon: '🌡️', unit: '°C', name: 'Temperature' },
        { key: 'windSpeed', icon: '💨', unit: 'km/h', name: 'Wind Speed' },
        { key: 'humidity', icon: '💧', unit: '%', name: 'Humidity' },
        { key: 'uvIndex', icon: '☀️', unit: '', name: 'UV Index' },
        { key: 'visibility', icon: '👁️', unit: 'km', name: 'Visibility' },
        { key: 'cloudCover', icon: '☁️', unit: '%', name: 'Cloud Cover' }
    ];
    
    weatherMetrics.forEach(metric => {
        const data = STATS.weather[metric.key];
        if (data.values.length > 0) {
            console.log(`\n${metric.icon} ${metric.name}:`);
            console.log(`   Range: ${data.min.toFixed(1)} - ${data.max.toFixed(1)} ${metric.unit}`);
            console.log(`   Average: ${data.avg.toFixed(1)} ${metric.unit}`);
            
            // Simple trend indicator
            const firstHalf = data.values.slice(0, Math.floor(data.values.length / 2));
            const secondHalf = data.values.slice(Math.floor(data.values.length / 2));
            const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
            const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
            const trend = secondAvg > firstAvg ? '📈 Increasing' : secondAvg < firstAvg ? '📉 Decreasing' : '➡️ Stable';
            console.log(`   Trend: ${trend}`);
        }
    });
    
    // Warning Analysis
    console.log(`\n${ICONS.warning} SAFETY & WARNING ANALYSIS:`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`⚠️ Total Warnings: ${STATS.warnings.total}`);
    console.log(`🛡️ Safe Hours: ${STATS.warnings.safe_hours} (${(STATS.warnings.safe_hours/STATS.total_hours*100).toFixed(1)}%)`);
    console.log(`🔴 Danger Hours: ${STATS.warnings.danger_hours} (${(STATS.warnings.danger_hours/STATS.total_hours*100).toFixed(1)}%)`);
    console.log(`🟡 Warning Hours: ${STATS.warnings.warning_hours} (${(STATS.warnings.warning_hours/STATS.total_hours*100).toFixed(1)}%)`);
    console.log(`🟠 Caution Hours: ${STATS.warnings.caution_hours} (${(STATS.warnings.caution_hours/STATS.total_hours*100).toFixed(1)}%)`);
    
    if (Object.keys(STATS.warnings.by_type).length > 0) {
        console.log(`\n📊 Warning Types Distribution:`);
        Object.entries(STATS.warnings.by_type)
            .sort(([,a], [,b]) => b - a)
            .forEach(([type, count]) => {
                const percentage = (count / STATS.warnings.total * 100).toFixed(1);
                console.log(`   ${type}: ${count} occurrences (${percentage}%)`);
            });
    }
    
    // ML Model Analysis
    console.log(`\n${ICONS.ml} ML MODEL USAGE ANALYSIS:`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🤖 ML Model Used: ${STATS.ml_model.used} predictions (${STATS.ml_model.usage_percentage.toFixed(1)}%)`);
    console.log(`🔄 Fallback Rules: ${STATS.ml_model.fallback} predictions (${(100-STATS.ml_model.usage_percentage).toFixed(1)}%)`);
    
    // Beaufort Scale Analysis
    if (Object.keys(STATS.beaufort_scale).length > 0) {
        console.log(`\n${ICONS.wind} BEAUFORT SCALE DISTRIBUTION:`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        Object.entries(STATS.beaufort_scale)
            .sort(([a], [b]) => parseInt(a) - parseInt(b))
            .forEach(([scale, count]) => {
                const percentage = (count / STATS.total_hours * 100).toFixed(1);
                const description = getBeaufortDescription(parseInt(scale));
                console.log(`   Scale ${scale}: ${count} hours (${percentage}%) - ${description}`);
            });
    }
    
    // Safety Deduction Analysis
    if (STATS.safety_deductions.affected_hours > 0) {
        console.log(`\n${ICONS.safety} SAFETY DEDUCTION ANALYSIS:`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`🛡️ Hours with Safety Deductions: ${STATS.safety_deductions.affected_hours}`);
        console.log(`📉 Average Deduction: ${STATS.safety_deductions.avg.toFixed(2)} points`);
        console.log(`⚠️ Maximum Deduction: ${STATS.safety_deductions.max} points`);
        console.log(`📊 Total Deductions: ${STATS.safety_deductions.total.toFixed(1)} points`);
    }
}

/**
 * 💨 Get Beaufort Scale Description
 */
function getBeaufortDescription(scale) {
    const descriptions = {
        0: 'Calm',
        1: 'Light air',
        2: 'Light breeze',
        3: 'Gentle breeze',
        4: 'Moderate breeze',
        5: 'Fresh breeze',
        6: 'Strong breeze',
        7: 'High wind',
        8: 'Gale',
        9: 'Strong gale',
        10: 'Storm',
        11: 'Violent storm',
        12: 'Hurricane'
    };
    return descriptions[scale] || 'Unknown';
}

/**
 * 🎯 Main Analysis Function
 */
async function runForecastAnalysis() {
    try {
        console.log(`${ICONS.heatmap} Starting Forecast API Heatmap Analysis...`);
        
        // Build URL
        const url = `${CONFIG.BASE_URL}${CONFIG.ENDPOINT}?lat=${CONFIG.TEST_LOCATION.lat}&lng=${CONFIG.TEST_LOCATION.lng}`;
        
        // Make request
        const response = await makeRequest(url);
        
        if (response.statusCode !== 200) {
            throw new Error(`API returned status ${response.statusCode}`);
        }
        
        if (!response.data.success) {
            throw new Error('API response indicates failure');
        }
        
        const forecastData = response.data;
        
        // Initialize stats
        STATS.total_days = forecastData.forecast.length;
        
        // Analyze each day and hour
        forecastData.forecast.forEach(day => {
            Object.entries(day.hourly).forEach(([hour, hourData]) => {
                analyzeHourData(hour, hourData, day.date);
            });
        });
        
        // Calculate final statistics
        calculateFinalStats();
        
        // Generate reports
        generateHeatmap(forecastData);
        generateStatsReport();
        
        // Summary
        console.log(`\n${ICONS.analysis} ===============================================`);
        console.log(`${ICONS.heatmap} FORECAST ANALYSIS COMPLETE`);
        console.log(`${ICONS.analysis} ===============================================`);
        console.log(`✅ Successfully analyzed ${STATS.total_hours} hours across ${STATS.total_days} days`);
        console.log(`📊 Average Rating: ${STATS.ratings.avg.toFixed(2)}/5.0`);
        console.log(`🤖 ML Model Usage: ${STATS.ml_model.usage_percentage.toFixed(1)}%`);
        console.log(`🛡️ Safe Hours: ${STATS.warnings.safe_hours}/${STATS.total_hours} (${(STATS.warnings.safe_hours/STATS.total_hours*100).toFixed(1)}%)`);
        console.log(`⚡ API Response Time: ${response.responseTime}ms`);
        
        return {
            success: true,
            stats: STATS,
            responseTime: response.responseTime,
            dataSize: response.size
        };
        
    } catch (error) {
        console.error(`\n${ICONS.warning} ===============================================`);
        console.error(`${ICONS.warning} FORECAST ANALYSIS ERROR`);
        console.error(`${ICONS.warning} ===============================================`);
        console.error(`❌ Error: ${error.message}`);
        
        return {
            success: false,
            error: error.message
        };
    }
}

// 🚀 Execute if run directly
if (require.main === module) {
    runForecastAnalysis().then(result => {
        if (result.success) {
            console.log(`\n${ICONS.heatmap} Forecast heatmap analysis completed successfully! 🎉`);
            process.exit(0);
        } else {
            console.error(`\n${ICONS.warning} Forecast analysis failed: ${result.error}`);
            process.exit(1);
        }
    });
}

module.exports = { runForecastAnalysis, CONFIG, STATS };
