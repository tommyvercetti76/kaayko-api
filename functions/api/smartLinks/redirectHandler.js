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
const ALUMNI_POLL_TITLE = 'What would bring you back to your school?';
const ALUMNI_POLL_DESCRIPTION_FALLBACK = 'One tap. Anonymous. No signup. Closes in 6 days.';
const ALUMNI_POLL_OG_IMAGE = 'https://kaayko.com/og/diya.png?v=20260420c';

function isSocialCrawler(userAgent = '') {
  const ua = String(userAgent).toLowerCase();
  return (
    ua.includes('facebookexternalhit') ||
    ua.includes('facebot') ||
    ua.includes('twitterbot') ||
    ua.includes('whatsapp') ||
    ua.includes('telegrambot') ||
    ua.includes('discordbot') ||
    ua.includes('slackbot') ||
    ua.includes('linkedinbot') ||
    ua.includes('applebot') ||
    ua.includes('skypeuripreview')
  );
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAlumniPollDescription(votingDeadline) {
  if (!votingDeadline) {
    // TODO: remove fallback when all alumni links store a normalized deadline.
    return ALUMNI_POLL_DESCRIPTION_FALLBACK;
  }

  const deadlineDate = votingDeadline.toDate ? votingDeadline.toDate() : new Date(votingDeadline);
  if (Number.isNaN(deadlineDate.getTime())) {
    return ALUMNI_POLL_DESCRIPTION_FALLBACK;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((deadlineDate.getTime() - Date.now()) / dayMs);
  if (daysLeft <= 0) {
    return 'One tap. Anonymous. No signup. Poll closes today.';
  }

  const dayLabel = daysLeft === 1 ? 'day' : 'days';
  return `One tap. Anonymous. No signup. Closes in ${daysLeft} ${dayLabel}.`;
}

function renderSocialPreviewPage({ code, title, description, imageUrl }) {
  const canonicalUrl = `https://kaayko.com/l/${encodeURIComponent(code)}`;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeImageUrl = escapeHtml(imageUrl);
  const safeCanonicalUrl = escapeHtml(canonicalUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${safeTitle}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${safeDescription}">
  <link rel="canonical" href="${safeCanonicalUrl}">

  <meta property="og:type" content="website">
  <meta property="og:url" content="${safeCanonicalUrl}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:image" content="${safeImageUrl}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDescription}">
  <meta name="twitter:image" content="${safeImageUrl}">
</head>
<body></body>
</html>`;
}

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
          flex-direction: column;
          background: #080808;
          color: #f0f0f0;
        }
        nav {
          position: sticky; top: 0; z-index: 50;
          background: rgba(8,8,8,0.92); backdrop-filter: blur(14px);
          border-bottom: 1px solid #1e1e1e;
          padding: 14px 20px; display: flex; align-items: center; justify-content: center;
        }
        .nav-logo { font-size: 1rem; font-weight: 700; color: #D4A84B; letter-spacing: 0.14em; }
        .container {
          max-width: 420px;
          width: 100%;
          margin: 0 auto;
          padding: 20px;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .inner { text-align: center; width: 100%; }
        .icon {
          font-size: 48px;
          margin-bottom: 16px;
        }
        h1 {
          font-size: 24px;
          font-weight: 700;
          color: #f0f0f0;
          margin-bottom: 8px;
        }
        p {
          font-size: 15px;
          color: #666;
          line-height: 1.6;
          margin-bottom: 24px;
        }
        .contact {
          font-size: 13px;
          color: #555;
          margin-bottom: 28px;
        }
        .contact a {
          color: #D4A84B;
          text-decoration: none;
        }
        .contact a:hover { text-decoration: underline; }
        .btn {
          display: inline-block;
          background: #D4A84B;
          color: #080808;
          font-family: inherit;
          font-size: 14px;
          font-weight: 700;
          padding: 12px 28px;
          border-radius: 10px;
          text-decoration: none;
          transition: all 0.2s ease;
        }
        .btn:hover {
          background: #e0b757;
          transform: translateY(-1px);
          box-shadow: 0 6px 24px rgba(212,168,75,0.3);
        }
        .site-footer {
          border-top: 1px solid #1e1e1e;
          padding: 18px 20px;
          display: flex; align-items: center; justify-content: center; gap: 10px;
        }
        .footer-brand { font-size: 0.85rem; font-weight: 700; color: #D4A84B; letter-spacing: 0.12em; }
        .footer-sep { color: #1e1e1e; }
        .footer-link { font-size: 0.72rem; color: #666; text-decoration: none; }
        .footer-link:hover { color: #D4A84B; }
      </style>
    </head>
    <body>
      <nav><span class="nav-logo">KAAYKO</span></nav>
      <div class="container">
        <div class="inner">
          <div class="icon">${icon}</div>
          <h1>${title}</h1>
          <p>${message}</p>
          <p class="contact">Questions? <a href="mailto:rohan@kaayko.com">rohan@kaayko.com</a></p>
          ${appButton}
        </div>
      </div>
      <footer class="site-footer">
        <span class="footer-brand">KAAYKO</span>
        <span class="footer-sep">&middot;</span>
        <a href="mailto:rohan@kaayko.com" class="footer-link">rohan@kaayko.com</a>
      </footer>
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

    // Case 4: Alumni campaign — maxUses cap + single-use visit token
    if (linkData.metadata?.campaign === 'alumni') {

      // Admin link — look up the report key and redirect to the report page
      if (linkData.metadata?.isAdmin) {
        try {
          const rkSnap = await db.collection('alumni_report_keys')
            .where('linkCode', '==', code)
            .limit(1)
            .get();
          if (!rkSnap.empty) {
            const rk = rkSnap.docs[0].data().key;
            return res.redirect(302, `https://kaayko.com/alumni-report?rk=${encodeURIComponent(rk)}`);
          }
          // No report key yet — generate one on the fly
          const { generateReportKey } = require('../alumni/reportKeyService');
          const { key } = await generateReportKey({
            linkCode:    code,
            sourceGroup: linkData.metadata.sourceGroup || null,
            sourceBatch: String(linkData.metadata.sourceBatch || ''),
            label:       linkData.title || 'Alumni Campaign',
            expiresAt:   null,
          });
          return res.redirect(302, `https://kaayko.com/alumni-report?rk=${encodeURIComponent(key)}`);
        } catch (adminErr) {
          console.error('[Alumni] Admin redirect failed:', adminErr);
          return res.redirect(302, 'https://kaayko.com/admin/alumni');
        }
      }

      const maxUses          = linkData.metadata.maxUses || 50;
      const uniqueVisitCount = linkData.uniqueVisitCount || 0;

      if (uniqueVisitCount >= maxUses) {
        return res.status(410).send(errorPage(
          410,
          'Link Limit Reached',
          'This link has been used the maximum number of times. Please ask the sender for a fresh link.'
        ));
      }

      if (isSocialCrawler(userAgent)) {
        const socialDescription = buildAlumniPollDescription(linkData.metadata?.votingDeadline);
        return res
          .status(200)
          .set('Content-Type', 'text/html; charset=utf-8')
          .set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
          .set('Pragma', 'no-cache')
          .set('Expires', '0')
          .set('Vary', 'User-Agent')
          .send(renderSocialPreviewPage({
            code,
            title: ALUMNI_POLL_TITLE,
            description: socialDescription,
            imageUrl: ALUMNI_POLL_OG_IMAGE,
          }));
      }

      // Track full click analytics (non-blocking)
      if (options.trackAnalytics) {
        trackClick({
          linkCode: code,
          tenantId: linkData.tenantId || 'kaayko-default',
          platform,
          userAgent,
          ip: req.ip || req.connection.remoteAddress,
          referrer: req.get('referer') || null,
          utm: extractUTMParams(req.query),
          metadata: { linkTitle: linkData.title, linkMetadata: linkData.metadata }
        }).catch(err => console.error('[Alumni] click tracking failed:', err));
      }

      // Issue (or reuse) a single-use visit token and redirect to the landing page
      try {
        const { issueVisitToken } = require('../alumni/visitTokenService');
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                   req.headers['x-real-ip'] ||
                   req.socket?.remoteAddress || 'unknown';

        const { token: visitToken, reused } = await issueVisitToken(code, ip, {
          sourceGroup: linkData.metadata.sourceGroup,
          sourceBatch: linkData.metadata.sourceBatch,
          campaign:    'alumni',
          sender:      linkData.metadata.sender,
        });

        // Only count a new unique visit when we minted a fresh token
        if (!reused) {
          db.collection('short_links').doc(code).update({
            uniqueVisitCount: FieldValue.increment(1),
            clickCount: FieldValue.increment(1),
            lastClickedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          }).catch(err => console.error('[Alumni] uniqueVisitCount update failed:', err));
        }

        const landingUrl = new URL('https://kaayko.com/alumni');
        landingUrl.searchParams.set('vtok', visitToken);
        landingUrl.searchParams.set('src',  code);
        if (linkData.metadata.schoolName) {
          landingUrl.searchParams.set('school', linkData.metadata.schoolName);
        }
        return res.redirect(302, landingUrl.toString());
      } catch (alumniErr) {
        console.error('[Alumni] Visit token issuance failed:', alumniErr);
        return res.status(500).send(errorPage(500, 'Something Went Wrong', 'Please try the link again.'));
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
