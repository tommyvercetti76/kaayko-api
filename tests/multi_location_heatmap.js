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
        consoleOutput: true,
        generateCharts: true,
        generatePredictions: true
    },
    PERFORMANCE: {
        maxLocations: process.argv.includes('--all') ? 50 : 17,
        concurrent: 2, // Reduced for rate limiting
        timeout: 15000, // Increased timeout
        delayBetweenRequests: 500, // Add delay between requests
        retryAttempts: 3,
        batchSize: 5 // Process in smaller batches
    },
    PREDICTIONS: {
        forecastDays: 7, // Extend predictions
        trendAnalysis: true,
        seasonalPatterns: true,
        riskAssessment: true
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
 * 🔄 Make HTTP Request with retry logic and rate limiting
 */
function makeRequest(url, description = '') {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        const attemptRequest = (attempt = 1) => {
            https.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    const responseTime = Date.now() - startTime;
                    
                    // Handle rate limiting
                    if (res.statusCode === 429) {
                        console.log(`${ICONS.warning} Rate limited for ${description}, attempt ${attempt}/${CONFIG.PERFORMANCE.retryAttempts}`);
                        if (attempt < CONFIG.PERFORMANCE.retryAttempts) {
                            const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
                            setTimeout(() => attemptRequest(attempt + 1), delay);
                            return;
                        } else {
                            reject(new Error(`Rate limit exceeded for ${description} after ${CONFIG.PERFORMANCE.retryAttempts} attempts`));
                            return;
                        }
                    }
                    
                    try {
                        const jsonData = JSON.parse(data);
                        resolve({
                            statusCode: res.statusCode,
                            data: jsonData,
                            responseTime,
                            size: data.length,
                            attempt
                        });
                    } catch (error) {
                        if (attempt < CONFIG.PERFORMANCE.retryAttempts) {
                            console.log(`${ICONS.warning} Parse error for ${description}, retrying... (${attempt}/${CONFIG.PERFORMANCE.retryAttempts})`);
                            setTimeout(() => attemptRequest(attempt + 1), 1000);
                        } else {
                            reject(new Error(`Parse Error for ${description}: ${error.message}`));
                        }
                    }
                });
            }).on('error', (error) => {
                if (attempt < CONFIG.PERFORMANCE.retryAttempts) {
                    console.log(`${ICONS.warning} Request error for ${description}, retrying... (${attempt}/${CONFIG.PERFORMANCE.retryAttempts})`);
                    setTimeout(() => attemptRequest(attempt + 1), 1000);
                } else {
                    reject(new Error(`Request Error for ${description}: ${error.message}`));
                }
            }).setTimeout(CONFIG.PERFORMANCE.timeout, () => {
                if (attempt < CONFIG.PERFORMANCE.retryAttempts) {
                    console.log(`${ICONS.warning} Timeout for ${description}, retrying... (${attempt}/${CONFIG.PERFORMANCE.retryAttempts})`);
                    setTimeout(() => attemptRequest(attempt + 1), 2000);
                } else {
                    reject(new Error(`Timeout for ${description} after ${CONFIG.PERFORMANCE.retryAttempts} attempts`));
                }
            });
        };
        
        attemptRequest();
    });
}

/**
 * ⏱️ Sleep function for rate limiting
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
 * 🌊 Fetch Forecast for Single Location with rate limiting
 */
async function fetchLocationForecast(location, batchIndex = 0) {
    if (!location.coordinates.lat || !location.coordinates.lng) {
        console.log(`${ICONS.warning} Skipping ${location.name} - no coordinates`);
        return null;
    }
    
    // Add delay based on batch index to prevent rate limiting
    if (batchIndex > 0) {
        await sleep(CONFIG.PERFORMANCE.delayBetweenRequests * batchIndex);
    }
    
    try {
        const url = `${CONFIG.BASE_URL}${CONFIG.ENDPOINTS.forecast}?lat=${location.coordinates.lat}&lng=${location.coordinates.lng}`;
        console.log(`🔄 Fetching forecast for ${location.name}... (batch ${batchIndex + 1})`);
        
        const response = await makeRequest(url, location.name);
        
        if (response.statusCode !== 200 || !response.data.success) {
            console.log(`${ICONS.warning} Failed to get forecast for ${location.name} (status: ${response.statusCode})`);
            return null;
        }
        
        console.log(`✅ Got forecast for ${location.name} in ${response.responseTime}ms`);
        
        return {
            location: location,
            forecast: response.data.forecast,
            metadata: response.data.metadata || {},
            responseTime: response.responseTime,
            attempt: response.attempt || 1
        };
        
    } catch (error) {
        console.log(`${ICONS.warning} Error getting forecast for ${location.name}: ${error.message}`);
        return null;
    }
}

/**
 * 📊 Analyze Location Forecast Data with Advanced Predictions
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
    let hourlyRatings = [];
    let hourlyTemps = [];
    let hourlyWinds = [];
    let bestHour = null;
    let worstHour = null;
    let bestRating = 0;
    let worstRating = 5;
    let timeSeriesData = [];
    
    locationData.forecast.forEach((day, dayIndex) => {
        Object.entries(day.hourly).forEach(([hour, hourData]) => {
            totalHours++;
            
            const rating = hourData.rating || hourData.apiRating || 0;
            const temp = hourData.temperature || 0;
            const wind = hourData.windSpeed || 0;
            
            totalRating += rating;
            hourlyRatings.push(rating);
            hourlyTemps.push(temp);
            hourlyWinds.push(wind);
            
            // Create time series entry
            timeSeriesData.push({
                timestamp: `${day.date} ${hour}:00`,
                hour: parseInt(hour),
                day: dayIndex,
                rating: rating,
                temperature: temp,
                windSpeed: wind,
                warnings: hourData.warnings || []
            });
            
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
    
    // Advanced Analytics
    const predictions = generatePredictions(timeSeriesData, hourlyRatings, hourlyTemps, hourlyWinds);
    const patterns = analyzePatterns(timeSeriesData);
    const riskAssessment = calculateRiskMetrics(timeSeriesData);
    
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
        responseTime: locationData.responseTime,
        timeSeries: timeSeriesData,
        predictions: predictions,
        patterns: patterns,
        riskAssessment: riskAssessment
    };
}

/**
 * 🔮 Generate Advanced Predictions
 */
function generatePredictions(timeSeriesData, ratings, temps, winds) {
    // Trend Analysis
    const ratingTrend = calculateTrend(ratings);
    const tempTrend = calculateTrend(temps);
    const windTrend = calculateTrend(winds);
    
    // Moving averages
    const movingAvg6h = calculateMovingAverage(ratings, 6);
    const movingAvg12h = calculateMovingAverage(ratings, 12);
    
    // Predict next 24 hours based on patterns
    const nextDayPrediction = predictNextPeriod(timeSeriesData, 24);
    
    // Optimal time windows
    const optimalWindows = findOptimalTimeWindows(timeSeriesData);
    
    return {
        trends: {
            rating: ratingTrend,
            temperature: tempTrend,
            windSpeed: windTrend
        },
        movingAverages: {
            sixHour: movingAvg6h,
            twelveHour: movingAvg12h
        },
        nextDayForecast: nextDayPrediction,
        optimalWindows: optimalWindows,
        confidence: calculatePredictionConfidence(timeSeriesData)
    };
}

/**
 * 📈 Calculate Trend (linear regression slope)
 */
function calculateTrend(values) {
    if (values.length < 2) return 0;
    
    const n = values.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((sum, y, x) => sum + x * y, 0);
    const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return slope;
}

/**
 * 📊 Calculate Moving Average
 */
function calculateMovingAverage(values, window) {
    const averages = [];
    for (let i = window - 1; i < values.length; i++) {
        const slice = values.slice(i - window + 1, i + 1);
        averages.push(slice.reduce((a, b) => a + b, 0) / window);
    }
    return averages;
}

/**
 * 🔮 Predict Next Period
 */
function predictNextPeriod(timeSeriesData, hours) {
    const predictions = [];
    const recentData = timeSeriesData.slice(-24); // Use last 24 hours for prediction
    
    for (let h = 0; h < hours; h++) {
        // Simple pattern-based prediction
        const hourOfDay = (recentData[recentData.length - 1].hour + h + 1) % 24;
        const similarHours = timeSeriesData.filter(d => d.hour === hourOfDay);
        
        if (similarHours.length > 0) {
            const avgRating = similarHours.reduce((sum, d) => sum + d.rating, 0) / similarHours.length;
            const avgTemp = similarHours.reduce((sum, d) => sum + d.temperature, 0) / similarHours.length;
            const avgWind = similarHours.reduce((sum, d) => sum + d.windSpeed, 0) / similarHours.length;
            
            predictions.push({
                hour: hourOfDay,
                predictedRating: avgRating.toFixed(2),
                predictedTemp: avgTemp.toFixed(1),
                predictedWind: avgWind.toFixed(1),
                confidence: Math.min(similarHours.length / 3, 1) // Higher confidence with more data points
            });
        }
    }
    
    return predictions;
}

/**
 * ⏰ Find Optimal Time Windows
 */
function findOptimalTimeWindows(timeSeriesData) {
    const windows = [];
    
    // Find 4-hour windows with consistently high ratings
    for (let i = 0; i <= timeSeriesData.length - 4; i++) {
        const window = timeSeriesData.slice(i, i + 4);
        const avgRating = window.reduce((sum, d) => sum + d.rating, 0) / window.length;
        const hasWarnings = window.some(d => d.warnings.length > 0);
        
        if (avgRating >= 3.5 && !hasWarnings) {
            windows.push({
                start: window[0].timestamp,
                end: window[3].timestamp,
                avgRating: avgRating.toFixed(2),
                safe: !hasWarnings,
                duration: '4 hours'
            });
        }
    }
    
    return windows.sort((a, b) => parseFloat(b.avgRating) - parseFloat(a.avgRating)).slice(0, 5);
}

/**
 * 🎯 Analyze Patterns
 */
function analyzePatterns(timeSeriesData) {
    const hourlyPatterns = {};
    const dailyPatterns = {};
    
    // Analyze by hour of day
    timeSeriesData.forEach(data => {
        if (!hourlyPatterns[data.hour]) {
            hourlyPatterns[data.hour] = [];
        }
        hourlyPatterns[data.hour].push(data.rating);
    });
    
    // Calculate hourly averages
    const hourlyAvg = {};
    Object.keys(hourlyPatterns).forEach(hour => {
        const ratings = hourlyPatterns[hour];
        hourlyAvg[hour] = (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2);
    });
    
    // Find peak hours
    const bestHours = Object.entries(hourlyAvg)
        .sort(([,a], [,b]) => parseFloat(b) - parseFloat(a))
        .slice(0, 6)
        .map(([hour, avg]) => ({ hour: parseInt(hour), avgRating: avg }));
    
    return {
        hourlyAverages: hourlyAvg,
        bestHours: bestHours,
        peakPeriod: identifyPeakPeriod(bestHours)
    };
}

/**
 * 🏔️ Identify Peak Period
 */
function identifyPeakPeriod(bestHours) {
    if (bestHours.length === 0) return 'Unknown';
    
    const avgHour = bestHours.reduce((sum, h) => sum + h.hour, 0) / bestHours.length;
    
    if (avgHour >= 6 && avgHour < 12) return 'Morning (6-12)';
    if (avgHour >= 12 && avgHour < 18) return 'Afternoon (12-18)';
    if (avgHour >= 18 && avgHour < 24) return 'Evening (18-24)';
    return 'Night/Early Morning (0-6)';
}

/**
 * ⚠️ Calculate Risk Assessment
 */
function calculateRiskMetrics(timeSeriesData) {
    const totalHours = timeSeriesData.length;
    const dangerousHours = timeSeriesData.filter(d => 
        d.warnings.some(w => w.toLowerCase().includes('danger')) || d.rating < 2
    ).length;
    
    const moderateRiskHours = timeSeriesData.filter(d => 
        d.rating >= 2 && d.rating < 3.5 && d.warnings.length > 0
    ).length;
    
    const lowRiskHours = timeSeriesData.filter(d => 
        d.rating >= 3.5 && d.warnings.length === 0
    ).length;
    
    return {
        riskLevel: dangerousHours > totalHours * 0.3 ? 'HIGH' : 
                  moderateRiskHours > totalHours * 0.4 ? 'MODERATE' : 'LOW',
        dangerousHours,
        moderateRiskHours,
        lowRiskHours,
        saftyScore: ((lowRiskHours / totalHours) * 100).toFixed(1),
        riskPercentage: ((dangerousHours / totalHours) * 100).toFixed(1)
    };
}

/**
 * 📊 Calculate Prediction Confidence
 */
function calculatePredictionConfidence(timeSeriesData) {
    const variance = calculateVariance(timeSeriesData.map(d => d.rating));
    const dataPoints = timeSeriesData.length;
    
    // Higher confidence with more data points and lower variance
    const confidenceScore = Math.min((dataPoints / 72) * (1 - variance / 5), 1);
    
    return {
        score: (confidenceScore * 100).toFixed(1),
        level: confidenceScore > 0.8 ? 'HIGH' : confidenceScore > 0.6 ? 'MEDIUM' : 'LOW',
        dataPoints: dataPoints
    };
}

/**
 * 📈 Calculate Variance
 */
function calculateVariance(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
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
 * 📄 Generate Advanced HTML Report with Charts and Predictions
 */
function generateHTMLReport(allAnalysis) {
    if (!CONFIG.OUTPUT.generateHTML) return;
    
    const timestamp = new Date().toISOString();
    
    // Generate chart data for each location
    const chartData = allAnalysis.map(analysis => {
        const ratingData = analysis.timeSeries.map(d => d.rating);
        const tempData = analysis.timeSeries.map(d => d.temperature);
        const windData = analysis.timeSeries.map(d => d.windSpeed);
        const labels = analysis.timeSeries.map(d => d.timestamp.split(' ')[1]);
        
        return {
            locationName: analysis.location.name,
            ratingData: ratingData,
            tempData: tempData,
            windData: windData,
            labels: labels,
            predictions: analysis.predictions,
            patterns: analysis.patterns,
            riskAssessment: analysis.riskAssessment
        };
    });
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kaayko Advanced Multi-Location Forecast Analysis</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #333; }
        .container { max-width: 1400px; margin: 0 auto; background: white; min-height: 100vh; }
        .header { background: linear-gradient(135deg, #2c3e50, #3498db); color: white; padding: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 2.5em; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; padding: 30px; }
        .summary-card { background: linear-gradient(135deg, #f8f9fa, #e9ecef); border-radius: 15px; padding: 25px; box-shadow: 0 8px 25px rgba(0,0,0,0.1); border-left: 5px solid #3498db; }
        .location-section { margin: 30px; background: #fff; border-radius: 15px; box-shadow: 0 8px 25px rgba(0,0,0,0.1); overflow: hidden; }
        .location-header { background: linear-gradient(135deg, #2980b9, #27ae60); color: white; padding: 25px; }
        .location-content { padding: 30px; }
        .chart-container { width: 100%; height: 400px; margin: 30px 0; position: relative; }
        .prediction-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin: 30px 0; }
        .prediction-card { background: #f8f9fa; border-radius: 10px; padding: 20px; border-left: 4px solid #e74c3c; }
        .risk-indicator { display: inline-block; padding: 8px 15px; border-radius: 20px; font-weight: bold; color: white; }
        .risk-high { background: #e74c3c; } .risk-moderate { background: #f39c12; } .risk-low { background: #27ae60; }
        .trend-indicator { font-size: 1.2em; font-weight: bold; }
        .trend-up { color: #27ae60; } .trend-down { color: #e74c3c; } .trend-stable { color: #f39c12; }
        .stats-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .stats-table th { background: #3498db; color: white; padding: 12px; text-align: left; }
        .stats-table td { padding: 12px; border-bottom: 1px solid #ddd; }
        .optimal-window { background: #d5f4e6; border-left: 4px solid #27ae60; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .heatmap-grid { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; margin: 20px 0; }
        .hour-cell { aspect-ratio: 1; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: white; font-weight: bold; }
        .rating-5 { background: #27ae60; } .rating-4 { background: #f39c12; } .rating-3 { background: #e67e22; } .rating-2 { background: #e74c3c; }
        .nav-tabs { display: flex; background: #ecf0f1; border-radius: 10px 10px 0 0; }
        .nav-tab { padding: 15px 25px; cursor: pointer; background: none; border: none; font-size: 16px; color: #7f8c8d; }
        .nav-tab.active { background: #3498db; color: white; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🗺️ Kaayko Advanced Multi-Location Forecast Analysis</h1>
            <p>AI-Powered Predictions & Risk Assessment across ${allAnalysis.length} Paddling Locations</p>
            <p>Generated: ${new Date().toLocaleDateString()} | Processing Time: ${GLOBAL_STATS.processingTime}ms</p>
        </div>
        
        <div class="summary-grid">
            <div class="summary-card">
                <h3>🏆 Best Location</h3>
                <h2>${GLOBAL_STATS.bestLocation.location.name}</h2>
                <p><strong>Rating:</strong> ${GLOBAL_STATS.bestLocation.stats.averageRating}/5.0</p>
                <p><strong>Peak Hours:</strong> ${GLOBAL_STATS.bestLocation.stats.peakHours} (${GLOBAL_STATS.bestLocation.stats.peakPercentage}%)</p>
                <div class="risk-indicator risk-${GLOBAL_STATS.bestLocation.riskAssessment.riskLevel.toLowerCase()}">
                    Risk: ${GLOBAL_STATS.bestLocation.riskAssessment.riskLevel}
                </div>
            </div>
            
            <div class="summary-card">
                <h3>📊 Analysis Overview</h3>
                <p><strong>Locations Analyzed:</strong> ${allAnalysis.length}</p>
                <p><strong>Failed Requests:</strong> ${GLOBAL_STATS.failedLocations}</p>
                <p><strong>Overall Average:</strong> ${GLOBAL_STATS.averageRating}/5.0</p>
                <p><strong>Total Data Points:</strong> ${allAnalysis.reduce((sum, a) => sum + a.timeSeries.length, 0)}</p>
            </div>
            
            <div class="summary-card">
                <h3>🔮 Prediction Summary</h3>
                <p><strong>High Confidence:</strong> ${allAnalysis.filter(a => a.predictions.confidence.level === 'HIGH').length} locations</p>
                <p><strong>Low Risk:</strong> ${allAnalysis.filter(a => a.riskAssessment.riskLevel === 'LOW').length} locations</p>
                <p><strong>Optimal Windows:</strong> ${allAnalysis.reduce((sum, a) => sum + a.predictions.optimalWindows.length, 0)} identified</p>
            </div>
        </div>

        ${allAnalysis.map((analysis, index) => {
            const charts = chartData[index];
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
            
            const trendIcon = analysis.predictions.trends.rating > 0.1 ? '📈' : 
                            analysis.predictions.trends.rating < -0.1 ? '📉' : '➡️';
            const trendClass = analysis.predictions.trends.rating > 0.1 ? 'trend-up' : 
                             analysis.predictions.trends.rating < -0.1 ? 'trend-down' : 'trend-stable';
            
            return `
                <div class="location-section">
                    <div class="location-header">
                        <h2>📍 ${analysis.location.name}</h2>
                        <p>Coordinates: ${analysis.location.coordinates.lat}, ${analysis.location.coordinates.lng}</p>
                        <div class="risk-indicator risk-${analysis.riskAssessment.riskLevel.toLowerCase()}">
                            Risk Level: ${analysis.riskAssessment.riskLevel} (${analysis.riskAssessment.riskPercentage}%)
                        </div>
                    </div>
                    
                    <div class="location-content">
                        <div class="nav-tabs">
                            <button class="nav-tab active" onclick="showTab('overview-${index}')">📊 Overview</button>
                            <button class="nav-tab" onclick="showTab('charts-${index}')">📈 Charts</button>
                            <button class="nav-tab" onclick="showTab('predictions-${index}')">🔮 Predictions</button>
                            <button class="nav-tab" onclick="showTab('patterns-${index}')">🎯 Patterns</button>
                        </div>
                        
                        <div id="overview-${index}" class="tab-content active">
                            <div class="prediction-grid">
                                <div class="prediction-card">
                                    <h4>⭐ Current Rating</h4>
                                    <h2>${analysis.stats.averageRating}/5.0</h2>
                                    <p class="trend-indicator ${trendClass}">${trendIcon} Trend: ${analysis.predictions.trends.rating > 0 ? '+' : ''}${analysis.predictions.trends.rating.toFixed(3)}</p>
                                </div>
                                
                                <div class="prediction-card">
                                    <h4>⚡ Peak Conditions</h4>
                                    <h2>${analysis.stats.peakHours} hours (${analysis.stats.peakPercentage}%)</h2>
                                    <p><strong>Best:</strong> ${analysis.stats.bestHour} (${analysis.stats.bestRating}/5.0)</p>
                                </div>
                                
                                <div class="prediction-card">
                                    <h4>🛡️ Safety Score</h4>
                                    <h2>${analysis.riskAssessment.saftyScore}%</h2>
                                    <p><strong>Safe Hours:</strong> ${analysis.stats.safeHours}/${analysis.stats.totalHours}</p>
                                </div>
                                
                                <div class="prediction-card">
                                    <h4>🔮 Prediction Confidence</h4>
                                    <h2>${analysis.predictions.confidence.score}%</h2>
                                    <p><strong>Level:</strong> ${analysis.predictions.confidence.level}</p>
                                </div>
                            </div>
                            
                            <h4>📊 72-Hour Forecast Heatmap</h4>
                            <div class="heatmap-grid">
                                ${heatmapCells}
                            </div>
                        </div>
                        
                        <div id="charts-${index}" class="tab-content">
                            <div class="chart-container">
                                <canvas id="ratingChart-${index}"></canvas>
                            </div>
                            <div class="chart-container">
                                <canvas id="weatherChart-${index}"></canvas>
                            </div>
                        </div>
                        
                        <div id="predictions-${index}" class="tab-content">
                            <h4>🔮 Next 24-Hour Predictions</h4>
                            <table class="stats-table">
                                <thead>
                                    <tr><th>Hour</th><th>Predicted Rating</th><th>Temperature</th><th>Wind Speed</th><th>Confidence</th></tr>
                                </thead>
                                <tbody>
                                    ${analysis.predictions.nextDayForecast.slice(0, 12).map(pred => `
                                        <tr>
                                            <td>${pred.hour}:00</td>
                                            <td>${pred.predictedRating}/5.0</td>
                                            <td>${pred.predictedTemp}°C</td>
                                            <td>${pred.predictedWind} km/h</td>
                                            <td>${(pred.confidence * 100).toFixed(0)}%</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                            
                            <h4>⏰ Optimal Time Windows</h4>
                            ${analysis.predictions.optimalWindows.map(window => `
                                <div class="optimal-window">
                                    <strong>${window.start} - ${window.end}</strong><br>
                                    Average Rating: ${window.avgRating}/5.0 | Duration: ${window.duration}
                                </div>
                            `).join('')}
                        </div>
                        
                        <div id="patterns-${index}" class="tab-content">
                            <h4>🎯 Daily Patterns</h4>
                            <p><strong>Peak Period:</strong> ${analysis.patterns.peakPeriod}</p>
                            
                            <h4>🏆 Best Hours of Day</h4>
                            <table class="stats-table">
                                <thead>
                                    <tr><th>Hour</th><th>Average Rating</th></tr>
                                </thead>
                                <tbody>
                                    ${analysis.patterns.bestHours.map(hour => `
                                        <tr>
                                            <td>${hour.hour}:00</td>
                                            <td>${hour.avgRating}/5.0</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
        }).join('')}
        
        <div style="text-align: center; padding: 30px; color: #7f8c8d;">
            <p>Generated by Kaayko Advanced Forecast Analyzer | Data: ${CONFIG.BASE_URL}</p>
            <p>Locations processed: ${GLOBAL_STATS.analyzedLocations} | Failed: ${GLOBAL_STATS.failedLocations} | Processing time: ${GLOBAL_STATS.processingTime}ms</p>
        </div>
    </div>

    <script>
        // Tab switching functionality
        function showTab(tabId) {
            const allTabs = document.querySelectorAll('.tab-content');
            const allButtons = document.querySelectorAll('.nav-tab');
            
            allTabs.forEach(tab => tab.classList.remove('active'));
            allButtons.forEach(btn => btn.classList.remove('active'));
            
            document.getElementById(tabId).classList.add('active');
            event.target.classList.add('active');
        }

        // Initialize charts after page load
        window.addEventListener('load', function() {
            const chartData = ${JSON.stringify(chartData)};
            
            chartData.forEach((data, index) => {
                // Rating trend chart
                const ratingCtx = document.getElementById('ratingChart-' + index).getContext('2d');
                new Chart(ratingCtx, {
                    type: 'line',
                    data: {
                        labels: data.labels,
                        datasets: [{
                            label: 'Paddling Conditions Rating',
                            data: data.ratingData,
                            borderColor: '#3498db',
                            backgroundColor: 'rgba(52, 152, 219, 0.1)',
                            borderWidth: 3,
                            fill: true,
                            tension: 0.4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            title: {
                                display: true,
                                text: '72-Hour Paddling Conditions Forecast',
                                font: { size: 16 }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                max: 5,
                                title: { display: true, text: 'Rating (0-5)' }
                            },
                            x: {
                                title: { display: true, text: 'Time (Hours)' }
                            }
                        }
                    }
                });

                // Weather parameters chart
                const weatherCtx = document.getElementById('weatherChart-' + index).getContext('2d');
                new Chart(weatherCtx, {
                    type: 'line',
                    data: {
                        labels: data.labels,
                        datasets: [{
                            label: 'Temperature (°C)',
                            data: data.tempData,
                            borderColor: '#e74c3c',
                            backgroundColor: 'rgba(231, 76, 60, 0.1)',
                            yAxisID: 'y'
                        }, {
                            label: 'Wind Speed (km/h)',
                            data: data.windData,
                            borderColor: '#f39c12',
                            backgroundColor: 'rgba(243, 156, 18, 0.1)',
                            yAxisID: 'y1'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            title: {
                                display: true,
                                text: 'Weather Parameters Forecast',
                                font: { size: 16 }
                            }
                        },
                        scales: {
                            y: {
                                type: 'linear',
                                display: true,
                                position: 'left',
                                title: { display: true, text: 'Temperature (°C)' }
                            },
                            y1: {
                                type: 'linear',
                                display: true,
                                position: 'right',
                                title: { display: true, text: 'Wind Speed (km/h)' },
                                grid: { drawOnChartArea: false }
                            }
                        }
                    }
                });
            });
        });
    </script>
</body>
</html>`;
    
    const filename = `advanced_multi_location_analysis_${Date.now()}.html`;
    fs.writeFileSync(filename, html);
    console.log(`\n📄 Advanced HTML report with charts and predictions saved: ${filename}`);
    console.log(`📊 Report includes: Interactive charts, AI predictions, risk assessment, pattern analysis`);
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
        console.log(`⚙️ Using batched processing with ${CONFIG.PERFORMANCE.batchSize} locations per batch`);
        console.log(`⏱️ Delay between requests: ${CONFIG.PERFORMANCE.delayBetweenRequests}ms`);
        
        // 2. Fetch forecasts with improved threading and rate limiting
        const allForecasts = [];
        const batches = [];
        
        // Create smaller batches to handle rate limiting better
        for (let i = 0; i < locations.length; i += CONFIG.PERFORMANCE.batchSize) {
            batches.push(locations.slice(i, i + CONFIG.PERFORMANCE.batchSize));
        }
        
        console.log(`📦 Processing ${batches.length} batches...`);
        
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            console.log(`\n📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} locations)`);
            
            // Process batch with staggered requests
            const batchPromises = batch.map((location, locationIndex) => 
                fetchLocationForecast(location, batchIndex * CONFIG.PERFORMANCE.batchSize + locationIndex)
            );
            
            const batchResults = await Promise.all(batchPromises);
            allForecasts.push(...batchResults);
            
            // Progress update
            const processed = allForecasts.length;
            const successCount = allForecasts.filter(f => f !== null).length;
            console.log(`📊 Progress: ${processed}/${locations.length} processed (${successCount} successful)`);
            
            // Add delay between batches to prevent overwhelming the API
            if (batchIndex < batches.length - 1) {
                console.log(`⏳ Waiting ${CONFIG.PERFORMANCE.delayBetweenRequests * 2}ms before next batch...`);
                await sleep(CONFIG.PERFORMANCE.delayBetweenRequests * 2);
            }
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
