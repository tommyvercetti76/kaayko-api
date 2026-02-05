/**
 * Smart Link Redirect Handler - SHORT CODES ONLY
 * 
 * SIMPLIFIED: Only handles short codes (lkXXXX)
 * Single route: kaayko.com/l/lkXXXX
 * 
 * Features:
 * - Short code links (e.g., lk1ngp, lk9xrf)
 * - Platform-specific destinations (iOS/Android/Web)
 * - Click analytics tracking
 * - Expiration checking
 * - Enable/disable functionality
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { trackClick, updateClickRedirect } = require('./clickTracking');

const db = admin.firestore();

/**
 * Detect user's platform from User-Agent string
 * @param {string} userAgent - Request User-Agent header
 * @returns {'ios'|'android'|'web'} Platform identifier
 */
function detectPlatform(userAgent = '') {
  const ua = userAgent.toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
  if (ua.includes('android')) return 'android';
  return 'web';
}

/**
 * Generate branded error page with Kaayko dark theme styling
 * @param {number} code - HTTP status code
 * @param {string} title - Error title
 * @param {string} message - User-friendly error message
 * @param {boolean} showAppButton - Whether to show "Go to Kaayko" button
 * @returns {string} HTML error page
 */
function errorPage(code, title, message, showAppButton = true) {
  const appButton = showAppButton 
    ? `<a href="https://kaayko.com" class="btn">Go to Kaayko</a>`
    : '';
  
  // Icon based on error type
  const icon = code === 404 ? '🔍' : code === 410 ? '⏰' : '⚠️';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title} | Kaayko</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="icon" type="image/png" sizes="32x32" href="https://kaayko.com/favicon-32x32.png">
      <link href="https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Josefin Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0a0a0a;
          color: #fff;
          padding: 20px;
        }
        .container {
          max-width: 420px;
          width: 100%;
          text-align: center;
        }
        .logo {
          width: 60px;
          height: 60px;
          margin: 0 auto 24px;
          background: linear-gradient(135deg, #D4A84B 0%, #C4983B 100%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          font-weight: 700;
          color: #0a0a0a;
          box-shadow: 0 4px 20px rgba(212, 168, 75, 0.3);
        }
        .card {
          background: #141414;
          border: 1px solid #2a2a2a;
          border-radius: 16px;
          padding: 40px 32px;
        }
        .icon {
          font-size: 48px;
          margin-bottom: 16px;
        }
        h1 {
          font-size: 24px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 8px;
        }
        p {
          font-size: 15px;
          color: #888;
          line-height: 1.5;
          margin-bottom: 24px;
        }
        .btn {
          display: inline-block;
          background: linear-gradient(135deg, #D4A84B 0%, #C4983B 100%);
          color: #0a0a0a;
          font-family: inherit;
          font-size: 14px;
          font-weight: 600;
          padding: 12px 28px;
          border-radius: 8px;
          text-decoration: none;
          transition: all 0.2s ease;
          box-shadow: 0 2px 12px rgba(212, 168, 75, 0.25);
        }
        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(212, 168, 75, 0.4);
        }
        .footer {
          margin-top: 32px;
          font-size: 13px;
          color: #555;
        }
        .footer a {
          color: #D4A84B;
          text-decoration: none;
        }
        .footer a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">K</div>
        <div class="card">
          <div class="icon">${icon}</div>
          <h1>${title}</h1>
          <p>${message}</p>
          ${appButton}
        </div>
        <div class="footer">
          <a href="https://kaayko.com">kaayko.com</a> · Know Before You Go
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Main redirect handler for short code links
 * 
 * SIMPLIFIED: Only looks up short_links collection
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object  
 * @param {string} code - Short code (e.g., lk1ngp)
 * @param {Object} options - Optional configuration
 * @param {boolean} options.trackAnalytics - Enable detailed analytics tracking
 * @returns {Promise<void>} Redirects or sends error page
 */
async function handleRedirect(req, res, code, options = {}) {
  try {
    const userAgent = req.get('user-agent') || '';
    const platform = detectPlatform(userAgent);
    
    // Look up short code in short_links collection
    const linkDoc = await db.collection('short_links').doc(code).get();

    // Case 1: Link not found in database
    if (!linkDoc.exists) {
      return res.status(404).send(errorPage(
        404,
        'Link Not Found',
        `The link "${code}" doesn't exist or has been removed.`
      ));
    }

    const linkData = linkDoc.data();

    // Case 2: Link disabled by creator
    if (linkData.enabled === false) {
      return res.status(410).send(errorPage(
        410,
        'Link Disabled',
        'This link has been disabled by its creator.'
      ));
    }

    // Case 3: Link expired
    if (linkData.expiresAt) {
      const expirationDate = linkData.expiresAt.toDate ? linkData.expiresAt.toDate() : new Date(linkData.expiresAt);
      if (expirationDate < new Date()) {
        return res.status(410).send(errorPage(
          410,
          'Link Expired',
          'This link has expired and is no longer available.'
        ));
      }
    }

    // Determine destination URL based on user's platform
    const destinations = linkData.destinations || {};
    let destination = destinations.web || 'https://kaayko.com';
    
    // Handle A/B routing if destinations are arrays
    if (platform === 'ios' && destinations.ios) {
      destination = selectDestinationVariant(destinations.ios);
    } else if (platform === 'android' && destinations.android) {
      destination = selectDestinationVariant(destinations.android);
    } else if (destinations.web) {
      destination = selectDestinationVariant(destinations.web);
    }

    // Track click with full context (generates clickId for attribution)
    let clickId = null;
    if (options.trackAnalytics) {
      try {
        const clickData = await trackClick({
          linkCode: code,
          tenantId: linkData.tenantId || 'kaayko-default',
          platform,
          userAgent,
          ip: req.ip || req.connection.remoteAddress,
          referrer: req.get('referer') || null,
          utm: extractUTMParams(req.query),
          metadata: {
            linkTitle: linkData.title,
            linkMetadata: linkData.metadata
          }
        });
        clickId = clickData.clickId;

        // Update click with redirect destination
        await updateClickRedirect(clickId, destination);
      } catch (trackError) {
        console.error('[Redirect] Click tracking failed:', trackError);
      }
    }

    // Track basic click metrics (async, non-blocking)
    db.collection('short_links')
      .doc(code)
      .update({
        clickCount: FieldValue.increment(1),
        lastClickedAt: FieldValue.serverTimestamp()
      })
      .catch(err => console.error('[Redirect] Click count update failed:', err));

    // Append clickId to destination for attribution (if mobile deep link)
    if (clickId && (platform === 'ios' || platform === 'android')) {
      destination = appendClickIdToDestination(destination, clickId, req.query);
    }
    
    // KORTEX BYPASS: Add bypass parameter for internal Kaayko pages (store, etc.)
    // This allows smart links to bypass authentication on protected pages
    if (destination.includes('kaayko.com/store') || destination.includes('/store.html')) {
      const separator = destination.includes('?') ? '&' : '?';
      destination = `${destination}${separator}bypass=kortex&ref=${code}`;
      console.log('[Kortex] Added auth bypass for store link:', code);
    }

    // Perform redirect (302 = temporary, preserves POST data if needed)
    return res.redirect(302, destination);

  } catch (error) {
    // Log error with context for debugging
    console.error('[Redirect] Handler error:', {
      code,
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).send(errorPage(
      500,
      'Something Went Wrong',
      'We encountered an error processing your link. Please try again.'
    ));
  }
}

/**
 * Select destination variant for A/B routing
 * If destination is a string, return it as-is.
 * If it's an array of variants, select based on weighted random.
 * 
 * @param {string|Array<{url: string, weight: number, label: string}>} destination
 * @returns {string} Selected destination URL
 */
function selectDestinationVariant(destination) {
  // Simple string destination
  if (typeof destination === 'string') {
    return destination;
  }

  // Array of variants for A/B testing
  if (Array.isArray(destination) && destination.length > 0) {
    // Calculate total weight
    const totalWeight = destination.reduce((sum, variant) => sum + (variant.weight || 1), 0);
    
    // Random selection based on weights
    let random = Math.random() * totalWeight;
    for (const variant of destination) {
      random -= (variant.weight || 1);
      if (random <= 0) {
        console.log('[Redirect] A/B variant selected:', variant.label || variant.url);
        return variant.url;
      }
    }
    
    // Fallback to first variant
    return destination[0].url;
  }

  // Fallback
  return 'https://kaayko.com';
}

/**
 * Extract UTM parameters from query string
 * @param {Object} query - Request query object
 * @returns {Object} UTM parameters
 */
function extractUTMParams(query) {
  const utmParams = {};
  const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  
  for (const key of utmKeys) {
    if (query[key]) {
      utmParams[key] = query[key];
    }
  }
  
  return utmParams;
}

/**
 * Append clickId and context to destination URL for attribution
 * @param {string} destination - Original destination URL
 * @param {string} clickId - Click ID
 * @param {Object} query - Query parameters (for UTM passthrough)
 * @returns {string} Modified destination with clickId
 */
function appendClickIdToDestination(destination, clickId, query = {}) {
  try {
    const url = new URL(destination);
    url.searchParams.set('clickId', clickId);
    
    // Pass through UTM parameters
    const utmParams = extractUTMParams(query);
    for (const [key, value] of Object.entries(utmParams)) {
      url.searchParams.set(key, value);
    }
    
    return url.toString();
  } catch (error) {
    // If URL parsing fails, append manually
    const separator = destination.includes('?') ? '&' : '?';
    return `${destination}${separator}clickId=${clickId}`;
  }
}

/**
 * Check if a short link exists (useful for pre-flight checks)
 * @param {string} code - Short code
 * @returns {Promise<{exists: boolean, enabled?: boolean}>}
 */
async function checkLinkExists(code) {
  try {
    const linkDoc = await db.collection('short_links').doc(code).get();
    if (linkDoc.exists) {
      const data = linkDoc.data();
      return { exists: true, enabled: data.enabled !== false };
    }
    
    return { exists: false };
  } catch (error) {
    console.error('[Redirect] Link existence check failed:', error);
    return { exists: false };
  }
}

// Export functions
module.exports = { 
  handleRedirect, 
  detectPlatform,
  checkLinkExists,
  selectDestinationVariant,
  extractUTMParams,
  appendClickIdToDestination
};
