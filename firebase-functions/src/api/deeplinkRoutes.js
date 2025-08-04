//  functions/src/api/deeplinkRoutes.js
//
//  Universal Link & Deep Link Management for Kaayko
//  Handles app-to-web redirection, context preservation, and smart routing
//
//  • GET  /l/:id                    → Short link redirect with context
//  • GET  /resolve                  → Context restoration after app install
//  • GET  /health                   → Health check

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// Import shared utilities for consistency
const {
  createRateLimitMiddleware,
  securityHeadersMiddleware,
  fetchPaddlingLocations,
  createAPIErrorHandler
} = require('../utils/sharedWeatherUtils');

const db = admin.firestore();

// Security configuration
const SECURITY_CONFIG = {
  MAX_REQUESTS_PER_MINUTE: 30,
  CACHE_DURATION: 300, // 5 minutes
  COOKIE_MAX_AGE: 30 * 60 * 1000, // 30 minutes
  REQUEST_TIMEOUT: 10000
};

// Apply shared middleware
router.use(createRateLimitMiddleware(SECURITY_CONFIG.MAX_REQUESTS_PER_MINUTE));
router.use(securityHeadersMiddleware);
router.use(createAPIErrorHandler('DeepLink'));

/**
 * Get location data from Firestore (replaces in-memory map)
 */
async function getLocationContext(locationId) {
  try {
    // First check if it's a direct lake ID from our database
    const locations = await fetchPaddlingLocations(db);
    const directMatch = locations.find(loc => 
      loc.id === locationId || 
      loc.name.toLowerCase().replace(/\s+/g, '') === locationId.toLowerCase()
    );
    
    if (directMatch) {
      return {
        id: directMatch.id,
        name: directMatch.name,
        lat: directMatch.coordinates.latitude,
        lon: directMatch.coordinates.longitude,
        type: 'paddling_location',
        source: 'database'
      };
    }
    
    // Fallback to predefined mappings for legacy URLs
    const legacyMap = {
      torch789: { lake: "Torch Lake", lat: 44.0, lon: -85.0 },
      tahoe123: { lake: "Lake Tahoe", lat: 39.0968, lon: -120.0324 },
      antero456: { lake: "Antero Reservoir", lat: 38.9, lon: -106.2 },
      antero: { lake: "Antero Reservoir", lat: 38.9, lon: -106.2 }
    };
    
    const legacyContext = legacyMap[locationId];
    if (legacyContext) {
      return {
        id: locationId,
        name: legacyContext.lake,
        lat: legacyContext.lat,
        lon: legacyContext.lon,
        type: 'legacy_location',
        source: 'legacy_map'
      };
    }
    
    return null;
    
  } catch (error) {
    console.error('Error fetching location context:', error);
    return null;
  }
}

/**
 * Generate app store URL with fallback
 */
function getAppStoreURL(platform = 'ios') {
  // Replace with your actual App Store ID
  const APP_STORE_ID = 'YOUR_APP_ID';
  const PLAY_STORE_ID = 'com.kaayko.app';
  
  if (platform === 'android') {
    return `https://play.google.com/store/apps/details?id=${PLAY_STORE_ID}`;
  }
  
  return `https://apps.apple.com/app/id${APP_STORE_ID}`;
}

/**
 * Generate app store URL with fallback
 */

/**
 * Detect user platform from User-Agent
 */
function detectPlatform(userAgent) {
  if (!userAgent) return 'ios';
  
  const ua = userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
  
  return 'ios'; // Default to iOS
}

/**
 * Log deeplink analytics
 */
async function logDeeplinkEvent(eventType, data) {
  try {
    await db.collection('deeplink_analytics').add({
      event: eventType,
      data: data,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userAgent: data.userAgent || 'unknown'
    });
  } catch (error) {
    console.error('Error logging deeplink event:', error);
  }
}

/**
 * 🔗 GET /l/:id → Short link redirect with context preservation
 * Usage: kaayko.com/l/antero456
 */
router.get("/l/:id", async (req, res) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).send("Request timeout");
    }
  }, SECURITY_CONFIG.REQUEST_TIMEOUT);

  try {
    const ctxId = req.params.id;
    const context = await getLocationContext(ctxId);
    const platform = detectPlatform(req.get('User-Agent'));
    const userAgent = req.get('User-Agent');
    
    clearTimeout(timeout);
    if (res.headersSent) return;

    if (!context) {
      await logDeeplinkEvent('short_link_not_found', { ctxId, platform });
      return res.status(404).send(`
        <html>
          <head><title>Kaayko - Link Not Found</title></head>
          <body style="font-family: Arial; text-align: center; margin-top: 50px;">
            <h2>🏞️ Kaayko</h2>
            <p>This location link is not available.</p>
            <a href="${getAppStoreURL(platform)}" style="background: #007AFF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">Download Kaayko App</a>
          </body>
        </html>
      `);
    }

    // Save context ID in multiple cookies for redundancy
    res.cookie("kaayko_ctxid", ctxId, { 
      maxAge: SECURITY_CONFIG.COOKIE_MAX_AGE,
      httpOnly: false, // Allow JS access for app integration
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    
    res.cookie("kaayko_location", JSON.stringify({
      id: context.id,
      name: context.name,
      lat: context.lat,
      lon: context.lon
    }), { 
      maxAge: SECURITY_CONFIG.COOKIE_MAX_AGE,
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    // Log successful redirect
    await logDeeplinkEvent('short_link_success', { 
      ctxId, 
      locationName: context.name,
      platform,
      userAgent: req.get('User-Agent')
    });

    // 🆕 PARAMETERIZED ROUTING CONTROL (Extra feature)
    const src = req.query.src;
    const appStore = req.query.appStore;
    
    // If src=ul AND appStore=Y, show page that redirects to app store
    if (src === 'ul' && appStore === 'Y') {
      const appStoreURL = getAppStoreURL(platform);
      await logDeeplinkEvent('short_link_appstore_redirect', { 
        ctxId, 
        locationName: context.name,
        platform,
        src,
        appStore,
        userAgent: req.get('User-Agent')
      });
      
      return res.send(`
        <html>
          <head>
            <title>Kaayko - ${context.name}</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; margin: 0; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; min-height: 100vh; }
              .container { max-width: 400px; margin: 50px auto; }
              .logo { font-size: 2em; margin-bottom: 20px; }
              .location { background: rgba(255,255,255,0.1); padding: 20px; border-radius: 12px; margin: 20px 0; }
              .btn { display: inline-block; background: #007AFF; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; margin: 10px; font-weight: bold; }
              .btn:hover { background: #0056CC; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="logo">🏞️ Kaayko</div>
              <div class="location">
                <h2>${context.name}</h2>
                <p>Get the Kaayko app for the best paddling experience!</p>
              </div>
              <a href="${appStoreURL}" class="btn">Download Kaayko App</a>
              <p style="margin-top: 30px; opacity: 0.8; font-size: 0.9em;">
                Redirecting to App Store...<br>
                <small>Your location context will be preserved</small>
              </p>
            </div>
            <script>
              // Redirect to app store after 2 seconds
              setTimeout(() => {
                window.location.href = "${appStoreURL}";
              }, 2000);
            </script>
          </body>
        </html>
      `);
    }
    
    // If src=ul (without appStore=Y), try Universal Link first, fallback to web
    if (src === 'ul') {
      await logDeeplinkEvent('short_link_universal_link', { 
        ctxId, 
        locationName: context.name,
        platform,
        src,
        userAgent: req.get('User-Agent')
      });
      
      // For Universal Links, we send a page that attempts app launch first
      const appStoreURL = getAppStoreURL(platform);
      const universalLink = `kaayko://location/${ctxId}`;
      
      return res.send(`
        <html>
          <head>
            <title>Kaayko - ${context.name}</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; margin: 0; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; min-height: 100vh; }
              .container { max-width: 400px; margin: 50px auto; }
              .logo { font-size: 2em; margin-bottom: 20px; }
              .location { background: rgba(255,255,255,0.1); padding: 20px; border-radius: 12px; margin: 20px 0; }
              .btn { display: inline-block; background: #007AFF; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; margin: 10px; font-weight: bold; }
              .btn:hover { background: #0056CC; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="logo">🏞️ Kaayko</div>
              <div class="location">
                <h2>${context.name}</h2>
                <p>Opening in Kaayko app...</p>
              </div>
              <a href="${appStoreURL}" class="btn">Download Kaayko App</a>
              <p style="margin-top: 30px; opacity: 0.8; font-size: 0.9em;">
                If app doesn't open, you'll be redirected to the App Store
              </p>
            </div>
            <script>
              // Attempt Universal Link first
              setTimeout(() => {
                window.location.href = "${universalLink}";
              }, 100);
              
              // Fallback to app store after 3 seconds
              setTimeout(() => {
                window.location.href = "${appStoreURL}";
              }, 3000);
            </script>
          </body>
        </html>
      `);
    }

    // 🔄 DEFAULT BEHAVIOR (unchanged) - Redirect to web paddlingout page
    const paddlingoutURL = `/paddlingout?id=${ctxId}`;
    
    res.redirect(302, paddlingoutURL);

  } catch (error) {
    clearTimeout(timeout);
    if (res.headersSent) return;
    
    console.error('Error in short link handler:', error);
    const platform = detectPlatform(req.get('User-Agent'));
    
    res.status(500).send(`
      <html>
        <head><title>Kaayko - Error</title></head>
        <body style="font-family: Arial; text-align: center; margin-top: 50px;">
          <h2>🏞️ Kaayko</h2>
          <p>Something went wrong. Let's get you to the app!</p>
          <a href="${getAppStoreURL(platform)}" style="background: #007AFF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">Download Kaayko App</a>
        </body>
      </html>
    `);
  }
});

/**
 * 🔄 GET /resolve → Context restoration after app install
 * Usage: App calls this after install to restore deferred context
 */
router.get("/resolve", async (req, res) => {
  try {
    const ctxId = req.query.id || (req.cookies && req.cookies.kaayko_ctxid) || (req.cookies && req.cookies.kaayko_lake_id);
    const cachedLocation = req.cookies && req.cookies.kaayko_location;
    
    // Try cached location first
    if (cachedLocation) {
      try {
        const locationData = JSON.parse(cachedLocation);
        await logDeeplinkEvent('resolve_from_cache', { ctxId, locationName: locationData.name });
        
        return res.json({
          success: true,
          source: 'cache',
          context: locationData,
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        console.error('Error parsing cached location:', e);
        // Continue to database lookup
      }
    }
    
    // Fallback to database lookup
    if (ctxId) {
      try {
        const context = await getLocationContext(ctxId);
        
        if (context) {
          await logDeeplinkEvent('resolve_from_database', { ctxId, locationName: context.name });
          
          return res.json({
            success: true,
            source: 'database',
            context: {
              id: context.id,
              name: context.name,
              lat: context.lat,
              lon: context.lon,
              type: context.type
            },
            timestamp: new Date().toISOString()
          });
        }
      } catch (dbError) {
        console.error('Error in database lookup:', dbError);
        // Continue to not found response
      }
    }
    
    await logDeeplinkEvent('resolve_not_found', { ctxId });
    
    res.status(404).json({
      success: false,
      error: 'Context not found',
      ctxId: ctxId || 'none',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error in resolve handler:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 🏥 GET /health → Health check
 */
router.get("/health", (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    service: 'Kaayko Deep Link Router',
    description: 'Universal link management with context preservation',
    security: {
      rateLimitEnabled: true,
      maxRequestsPerMinute: SECURITY_CONFIG.MAX_REQUESTS_PER_MINUTE,
      cookieMaxAge: SECURITY_CONFIG.COOKIE_MAX_AGE
    },
    endpoints: [
      'GET /l/:id - Short link redirect with context',
      'GET /resolve - Context restoration after app install',
      'GET /health - This health check'
    ]
  });
});

module.exports = router;
