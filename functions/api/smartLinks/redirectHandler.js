/**
 * Shared Smart Link Redirect Handler
 * 
 * Single source of truth for all smart link redirects across:
 * - /api/smartlinks/r/:code  (explicit API route)
 * - /l/:code                  (short URL route)
 * 
 * Supports:
 * - Short code links (e.g., lk1ngp)
 * - Structured links (e.g., lake/trinity)
 * - Platform-specific destinations (iOS/Android/Web)
 * - Click analytics tracking
 * - Enable/disable functionality
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

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
 * Generate branded error page with consistent styling
 * @param {number} code - HTTP status code
 * @param {string} title - Error title
 * @param {string} message - User-friendly error message
 * @param {boolean} showAppButton - Whether to show "Go to Kaayko" button
 * @returns {string} HTML error page
 */
function errorPage(code, title, message, showAppButton = true) {
  const appButton = showAppButton 
    ? `<a href="https://kaayko.com" style="background: #007AFF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; margin-top: 20px;">Go to Kaayko</a>`
    : '';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-align: center; padding: 50px; background: #f5f5f5;">
      <div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <h1 style="font-size: 3em; margin: 0;">🏞️</h1>
        <h2 style="color: #333; margin: 20px 0 10px;">${title}</h2>
        <p style="color: #666; margin: 0;">${message}</p>
        ${appButton}
      </div>
    </body>
    </html>
  `;
}

/**
 * Main redirect handler for smart links
 * 
 * Lookup priority:
 * 1. Short code links (short_links collection)
 * 2. Structured links (smart_links collection, space/id format)
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object  
 * @param {string} linkId - Link identifier (code or space/id)
 * @param {Object} options - Optional configuration
 * @param {boolean} options.trackAnalytics - Enable detailed analytics tracking
 * @returns {Promise<void>} Redirects or sends error page
 */
async function handleRedirect(req, res, linkId, options = {}) {
  try {
    const userAgent = req.get('user-agent') || '';
    const platform = detectPlatform(userAgent);
    
    let linkData = null;
    let linkType = null;
    let docId = null;

    // Priority 1: Check short_links collection (e.g., lk1ngp, test123)
    const shortDoc = await db.collection('short_links').doc(linkId).get();
    if (shortDoc.exists) {
      linkData = shortDoc.data();
      linkType = 'short';
      docId = linkId;
    } else {
      // Priority 2: Check smart_links collection (e.g., lake/trinity, product/kayak-123)
      const parts = linkId.split('/');
      if (parts.length === 2) {
        const [space, id] = parts;
        const structuredDoc = await db.collection('smart_links').doc(`${space}_${id}`).get();
        if (structuredDoc.exists) {
          linkData = structuredDoc.data();
          linkType = 'structured';
          docId = `${space}_${id}`;
        }
      }
    }

    // Case 1: Link not found in database
    if (!linkData) {
      return res.status(404).send(errorPage(
        404,
        'Link Not Found',
        `The link "${linkId}" doesn't exist or has been removed.`
      ));
    }

    // Case 2: Link disabled by creator
    if (linkData.enabled === false) {
      return res.status(410).send(errorPage(
        410,
        'Link Disabled',
        'This link has been disabled by its creator.'
      ));
    }

    // Determine destination URL based on user's platform
    const destinations = linkData.destinations || {};
    let destination = destinations.web || 'https://kaayko.com';
    
    if (platform === 'ios' && destinations.ios) {
      destination = destinations.ios;
    } else if (platform === 'android' && destinations.android) {
      destination = destinations.android;
    }

    // Track click metrics (async, non-blocking - don't wait for completion)
    const collection = linkType === 'short' ? 'short_links' : 'smart_links';
    db.collection(collection)
      .doc(docId)
      .update({
        clickCount: FieldValue.increment(1),
        lastClickedAt: FieldValue.serverTimestamp()
      })
      .catch(err => console.error('[Redirect] Click tracking failed:', err));

    // Optional: Detailed analytics (when enabled via options)
    if (options.trackAnalytics) {
      db.collection('link_analytics').add({
        linkId,
        linkType,
        platform,
        userAgent,
        timestamp: FieldValue.serverTimestamp(),
        destination,
        referrer: req.get('referer') || null
      }).catch(err => console.error('[Redirect] Analytics tracking failed:', err));
    }

    // Perform redirect (302 = temporary, preserves POST data if needed)
    return res.redirect(302, destination);

  } catch (error) {
    // Log error with context for debugging
    console.error('[Redirect] Handler error:', {
      linkId,
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
 * Check if a smart link exists (useful for pre-flight checks)
 * @param {string} linkId - Link identifier
 * @returns {Promise<{exists: boolean, type?: string, enabled?: boolean}>}
 */
async function checkLinkExists(linkId) {
  try {
    // Check short link
    const shortDoc = await db.collection('short_links').doc(linkId).get();
    if (shortDoc.exists) {
      const data = shortDoc.data();
      return { exists: true, type: 'short', enabled: data.enabled !== false };
    }
    
    // Check structured link
    const parts = linkId.split('/');
    if (parts.length === 2) {
      const [space, id] = parts;
      const structuredDoc = await db.collection('smart_links').doc(`${space}_${id}`).get();
      if (structuredDoc.exists) {
        const data = structuredDoc.data();
        return { exists: true, type: 'structured', enabled: data.enabled !== false };
      }
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
  checkLinkExists 
};
