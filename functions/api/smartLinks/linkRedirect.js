/**
 * functions/src/utils/linkRedirect.js
 * 
 * Shared redirect logic for smart links
 * Handles both short codes and structured links with proper analytics
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

/**
 * Detect user platform from User-Agent
 */
function detectPlatform(userAgent) {
  if (!userAgent) return 'web';
  
  const ua = userAgent.toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios';
  if (ua.includes('android')) return 'android';
  
  return 'web';
}

/**
 * Get destination URL based on platform
 */
function getDestinationForPlatform(destinations, platform) {
  if (!destinations) return 'https://kaayko.com';
  
  // Try platform-specific destination first
  if (platform === 'ios' && destinations.ios) return destinations.ios;
  if (platform === 'android' && destinations.android) return destinations.android;
  
  // Fall back to web destination
  return destinations.web || 'https://kaayko.com';
}

/**
 * Track click analytics (async, non-blocking)
 */
async function trackClick(db, collection, docId) {
  try {
    await db.collection(collection).doc(docId).update({
      clickCount: FieldValue.increment(1),
      lastClickedAt: FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error(`Error tracking click for ${collection}/${docId}:`, error);
  }
}

/**
 * Render error page HTML
 */
function renderErrorPage(type, code, message) {
  const titles = {
    'not-found': 'Link Not Found',
    'disabled': 'Link Disabled',
    'error': 'Error'
  };
  
  const icons = {
    'not-found': '🔗',
    'disabled': '⚠️',
    'error': '❌'
  };
  
  const statusCodes = {
    'not-found': 404,
    'disabled': 410,
    'error': 500
  };
  
  return {
    status: statusCodes[type] || 500,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${titles[type]}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
            padding: 20px;
          }
          .container {
            max-width: 500px;
            background: rgba(255, 255, 255, 0.1);
            padding: 40px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
          }
          .icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
          h1 {
            font-size: 32px;
            margin: 0 0 10px;
          }
          p {
            font-size: 18px;
            opacity: 0.9;
            margin: 0 0 30px;
          }
          .code {
            background: rgba(0, 0, 0, 0.2);
            padding: 8px 12px;
            border-radius: 6px;
            font-family: monospace;
            display: inline-block;
            margin: 10px 0;
          }
          a {
            display: inline-block;
            background: white;
            color: #667eea;
            padding: 15px 30px;
            text-decoration: none;
            border-radius: 25px;
            font-weight: bold;
            transition: transform 0.2s;
          }
          a:hover {
            transform: scale(1.05);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">${icons[type]}</div>
          <h1>${titles[type]}</h1>
          ${code ? `<div class="code">${code}</div>` : ''}
          <p>${message}</p>
          <a href="https://kaayko.com">Go to Kaayko</a>
        </div>
      </body>
      </html>
    `
  };
}

/**
 * Main redirect handler for smart links
 * 
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {string} code - Link code (short code or space/id)
 * @param {string} userAgent - User-Agent header
 * @returns {Promise<{status: number, redirect?: string, html?: string}>}
 */
async function handleSmartLinkRedirect(db, code, userAgent) {
  try {
    const platform = detectPlatform(userAgent);
    
    // Step 1: Try short_links collection (most common case)
    let linkDoc = await db.collection('short_links').doc(code).get();
    
    if (linkDoc.exists) {
      const linkData = linkDoc.data();
      
      // Check if link is disabled
      if (linkData.enabled === false) {
        const error = renderErrorPage('disabled', code, 'This link has been disabled by its creator.');
        return { status: error.status, html: error.html };
      }
      
      // Get destination for platform
      const destination = getDestinationForPlatform(linkData.destinations, platform);
      
      // Track click (async, don't wait)
      trackClick(db, 'short_links', code);
      
      return { status: 302, redirect: destination };
    }
    
    // Step 2: Try structured link (space/id format)
    const parts = code.split('/');
    if (parts.length === 2) {
      const [space, id] = parts;
      linkDoc = await db.collection('smart_links').doc(`${space}_${id}`).get();
      
      if (linkDoc.exists) {
        const linkData = linkDoc.data();
        
        // Check if link is disabled
        if (linkData.enabled === false) {
          const error = renderErrorPage('disabled', code, 'This link has been disabled by its creator.');
          return { status: error.status, html: error.html };
        }
        
        // Get destination for platform
        const destination = getDestinationForPlatform(linkData.destinations, platform);
        
        // Track click (async, don't wait)
        trackClick(db, 'smart_links', `${space}_${id}`);
        
        return { status: 302, redirect: destination };
      }
    }
    
    // Step 3: Link not found
    const error = renderErrorPage('not-found', code, 'This link doesn\'t exist or has been removed.');
    return { status: error.status, html: error.html };
    
  } catch (error) {
    console.error('Error in handleSmartLinkRedirect:', error);
    const errorPage = renderErrorPage('error', null, 'Something went wrong. Please try again later.');
    return { status: errorPage.status, html: errorPage.html };
  }
}

module.exports = {
  detectPlatform,
  getDestinationForPlatform,
  trackClick,
  renderErrorPage,
  handleSmartLinkRedirect
};
