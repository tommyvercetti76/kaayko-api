//  functions/src/api/paddlingReport.js
//
//  Paddling condition reports for all locations using paddleConditions API
//  Simple, focused, and efficient
//
//  • GET  /paddlingReport         → paddling reports for all locations
//  • GET  /paddlingReport/summary → basic location list
//  • GET  /paddlingReport/best    → locations with good paddling conditions
//  • GET  /paddlingReport/health  → health check

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const https = require('https');

// Import shared utilities for consistency and reuse
const {
  createRateLimitMiddleware,
  securityHeadersMiddleware,
  fetchPaddlingLocations,
  createAPIErrorHandler
} = require('../utils/sharedWeatherUtils');

const db = admin.firestore();

// Security configuration
const SECURITY_CONFIG = {
  MAX_REQUESTS_PER_MINUTE: 15,
  CACHE_DURATION: 600, // 10 minutes
  REQUEST_TIMEOUT: 20000, // 20 seconds
  MAX_CONCURRENT: 5
};

// Apply shared middleware
router.use(createRateLimitMiddleware(SECURITY_CONFIG.MAX_REQUESTS_PER_MINUTE));
router.use(securityHeadersMiddleware);

// Apply centralized error handling
router.use(createAPIErrorHandler('PaddlingReport'));

/**
 * Get all paddling locations using shared utility
 */
async function getPaddlingLocations() {
  return await fetchPaddlingLocations(db);
}

/**
 * Get paddling conditions for a location using our paddleConditions API
 */
async function getPaddlingConditions(latitude, longitude) {
    // Use production URL when deployed, localhost for development
  const API_BASE = process.env.NODE_ENV === 'development' 
    ? 'http://localhost:5001/kaayko-api-dev/us-central1/api'
    : 'https://api-vwcc5j4qda-uc.a.run.app';
  const url = `${API_BASE}/paddleConditions?lat=${latitude}&lng=${longitude}`;
  
  return new Promise((resolve, reject) => {
    // Use https for production, http for localhost
    const httpModule = url.startsWith('https:') ? require('https') : require('http');
    
    const req = httpModule.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'Kaayko-PaddlingReport/1.0' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result);
          }
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Request timeout')));
  });
}

/**
 * Generate paddling reports for all locations
 */
async function generatePaddlingReports() {
  const locations = await getPaddlingLocations();
  const reports = [];
  
  // Process in batches to avoid overwhelming the paddleConditions API
  const batchSize = 3;
  for (let i = 0; i < locations.length; i += batchSize) {
    const batch = locations.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (location) => {
      try {
        const conditions = await Promise.race([
          getPaddlingConditions(location.coordinates.latitude, location.coordinates.longitude),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 6000)
          )
        ]);
        
        // Create concise report structure matching comprehensive API
        return {
          id: location.id,
          name: location.name,
          coordinates: location.coordinates,
          conditions: {
            rating: conditions.paddleAnalysis?.rating || 0,
            conditions: conditions.paddleAnalysis?.conditions || 'Unknown',
            temperature: Math.round(conditions.weather?.temperature?.celsius || 0),
            windSpeed: Math.round(conditions.weather?.wind?.speedKPH || 0),
            windDirection: conditions.weather?.wind?.direction || 'Unknown',
            warnings: conditions.paddleAnalysis?.warnings || [],
            recommendations: conditions.paddleAnalysis?.recommendations || [],
            location: conditions.location?.name || 'Unknown',
            beaufortScale: conditions.paddleAnalysis?.beaufortScale || 0,
            hasMarineData: !!conditions.waterConditions,
            waterBodyType: conditions.location?.waterBodyType || 'unknown',
            isCoastal: conditions.waterConditions?.isCoastal || false,
            uvIndex: conditions.weather?.solar?.uvIndex || 0,
            humidity: conditions.weather?.atmospheric?.humidity || 0,
            visibility: conditions.weather?.atmospheric?.visibilityKM || 0,
            updated: conditions.metadata?.lastUpdated || new Date().toISOString()
          },
          lastUpdated: conditions.metadata?.lastUpdated || new Date().toISOString(),
          status: 'success'
        };
        
      } catch (error) {
        return {
          id: location.id,
          name: location.name,
          coordinates: location.coordinates,
          conditions: null,
          lastUpdated: new Date().toISOString(),
          status: 'error',
          error: error.message
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    reports.push(...batchResults);
    
    // Brief delay between batches
    if (i + batchSize < locations.length) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  const successful = reports.filter(r => r.status === 'success');
  const goodConditions = successful.filter(r => r.conditions.rating >= 4);
  
  return {
    summary: {
      total: locations.length,
      successful: successful.length,
      failed: reports.filter(r => r.status === 'error').length,
      goodConditions: goodConditions.length,
      timestamp: new Date().toISOString()
    },
    reports: reports,
    bestLocations: goodConditions.sort((a, b) => b.conditions.rating - a.conditions.rating)
  };
}

/**
 * GET /paddlingReport - Full paddling condition reports
 */
router.get('/', async (req, res) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        error: 'Request timeout'
      });
    }
  }, SECURITY_CONFIG.REQUEST_TIMEOUT);

  try {
    const reportData = await generatePaddlingReports();
    clearTimeout(timeout);
    
    if (res.headersSent) return;
    
    res.set('Cache-Control', `public, max-age=${SECURITY_CONFIG.CACHE_DURATION}`);
    res.json({
      success: true,
      data: reportData,
      message: `Generated paddling reports for ${reportData.summary.total} locations`
    });
    
  } catch (error) {
    clearTimeout(timeout);
    if (res.headersSent) return;
    
    console.error('Error generating paddling reports:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate paddling reports',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal error'
    });
  }
});

/**
 * GET /paddlingReport/summary - Paddling condition summary with weather data
 */
router.get('/summary', async (req, res) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        error: 'Request timeout'
      });
    }
  }, SECURITY_CONFIG.REQUEST_TIMEOUT);

  try {
    const reportData = await generatePaddlingReports();
    clearTimeout(timeout);
    
    if (res.headersSent) return;
    
    // Create concise summary with paddle conditions
    const summary = {
      overview: {
        totalLocations: reportData.summary.total,
        successfulReports: reportData.summary.successful,
        failedReports: reportData.summary.failed,
        excellentConditions: reportData.reports.filter(r => r.status === 'success' && r.conditions.rating === 5).length,
        goodConditions: reportData.reports.filter(r => r.status === 'success' && r.conditions.rating === 4).length,
        averageRating: Math.round((reportData.reports
          .filter(r => r.status === 'success')
          .reduce((sum, r) => sum + r.conditions.rating, 0) / reportData.summary.successful) * 10) / 10,
        timestamp: reportData.summary.timestamp
      },
      locationSummaries: reportData.reports.map(report => ({
        id: report.id,
        name: report.name,
        status: report.status,
        lastUpdated: report.lastUpdated,
        ...(report.status === 'success' ? {
          rating: report.conditions.rating,
          conditions: report.conditions.conditions,
          temperature: report.conditions.temperature,
          windSpeed: report.conditions.windSpeed,
          hasWarnings: report.conditions.warnings.length > 0,
          beaufortScale: report.conditions.beaufortScale,
          waterBodyType: report.conditions.waterBodyType,
          isCoastal: report.conditions.isCoastal,
          uvIndex: report.conditions.uvIndex,
          visibility: report.conditions.visibility
        } : {
          error: report.error
        })
      }))
    };
    
    res.set('Cache-Control', `public, max-age=${SECURITY_CONFIG.CACHE_DURATION}`);
    res.json({
      success: true,
      data: summary,
      message: `Paddling condition summary: ${summary.overview.excellentConditions + summary.overview.goodConditions}/${summary.overview.totalLocations} locations have good conditions`
    });
    
  } catch (error) {
    clearTimeout(timeout);
    if (res.headersSent) return;
    
    console.error('Error generating paddling summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate paddling condition summary',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal error'
    });
  }
});

/**
 * GET /paddlingReport/best - Locations with good paddling conditions
 */
router.get('/best', async (req, res) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        error: 'Request timeout'
      });
    }
  }, SECURITY_CONFIG.REQUEST_TIMEOUT);

  try {
    const reportData = await generatePaddlingReports();
    clearTimeout(timeout);
    
    if (res.headersSent) return;
    
    const bestConditions = reportData.reports
      .filter(report => 
        report.status === 'success' && 
        report.conditions.rating >= 4
      )
      .sort((a, b) => b.conditions.rating - a.conditions.rating);
    
    res.set('Cache-Control', `public, max-age=${SECURITY_CONFIG.CACHE_DURATION}`);
    res.json({
      success: true,
      data: {
        total: reportData.summary.total,
        goodConditions: bestConditions.length,
        locations: bestConditions,
        timestamp: new Date().toISOString()
      },
      message: `Found ${bestConditions.length} locations with good paddling conditions`
    });
    
  } catch (error) {
    clearTimeout(timeout);
    if (res.headersSent) return;
    
    console.error('Error finding best conditions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to find best paddling conditions'
    });
  }
});

/**
 * GET /paddlingReport/demo - Demo with mock data (for development)
 */
router.get('/demo', async (req, res) => {
  try {
    const locations = await getPaddlingLocations();
    
    // Create demo reports with mock paddle conditions
    const demoReports = locations.slice(0, 3).map((location, index) => ({
      id: location.id,
      name: location.name,
      coordinates: location.coordinates,
      conditions: {
        rating: 4 + index % 2, // Mock ratings 4-5
        conditions: index % 2 === 0 ? 'Excellent' : 'Good',
        temperature: 22 + index,
        windSpeed: 8 + index * 2,
        windDirection: 'SW',
        warnings: index === 2 ? ['Light winds changing'] : [],
        recommendations: ['Perfect for paddling', 'Light winds ideal'],
        location: `Mock Location ${index + 1}`,
        skillLevel: index === 0 ? 'Beginner' : 'Intermediate',
        beaufortScale: 2 + index,
        updated: new Date().toISOString()
      },
      lastUpdated: new Date().toISOString(),
      status: 'success'
    }));
    
    const summary = {
      total: locations.length,
      successful: demoReports.length,
      failed: 0,
      goodConditions: demoReports.filter(r => r.conditions.rating >= 4).length,
      timestamp: new Date().toISOString()
    };
    
    res.json({
      success: true,
      data: {
        summary,
        reports: demoReports,
        bestLocations: demoReports.filter(r => r.conditions.rating >= 4)
      },
      message: `Demo: Generated paddling reports for ${demoReports.length} locations`
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate demo reports',
      details: error.message
    });
  }
});

/**
 * GET /paddlingReport/health - Health check
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'Paddling Reports',
    description: 'Generates paddling condition reports using paddleConditions API',
    security: {
      rateLimitEnabled: true,
      maxRequestsPerMinute: SECURITY_CONFIG.MAX_REQUESTS_PER_MINUTE,
      cacheSeconds: SECURITY_CONFIG.CACHE_DURATION
    },
    endpoints: [
      'GET /paddlingReport - Full paddling condition reports',
      'GET /paddlingReport/summary - Basic location list',
      'GET /paddlingReport/best - Locations with good conditions',
      'GET /paddlingReport/demo - Demo reports with mock data',
      'GET /paddlingReport/health - This health check'
    ]
  });
});

module.exports = router;