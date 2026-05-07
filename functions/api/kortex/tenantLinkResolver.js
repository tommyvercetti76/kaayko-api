/**
 * Tenant Link Resolver — alumni.kaayko.com/<tenant-slug>/<code>
 *
 * Provides tenant-namespaced short URLs with hardened security:
 *  - Cryptographic link codes (non-sequential, non-guessable)
 *  - Tenant-bound resolution (code only resolves within its tenant)
 *  - Click deduplication (fingerprint-based)
 *  - Enumeration protection (constant-time 404, no info leakage)
 *  - Abuse detection (spike alerts, velocity limits)
 *  - Rate limiting per IP on resolve
 */

const express = require('express');
const crypto = require('crypto');
const admin = require('firebase-admin');
const db = admin.firestore();
const router = express.Router();
const { runSecurityChecks, isCanaryCode } = require('./linkSecurityService');

// ============================================================================
// CONSTANTS
// ============================================================================

const ALUMNI_HOSTS = [
  'alumni.kaayko.com',
  'alumni.kaaykostore.web.app',
  'alumni.kaaykostore.firebaseapp.com'
];

const RESOLVE_RATE_LIMIT = 60; // max resolves per IP per minute
const CLICK_DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 min dedup window
const ABUSE_SPIKE_THRESHOLD = 100; // clicks in 5 min triggers alert
const CODE_CHARSET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no ambiguous chars (no 0,o,1,l,i)

// ============================================================================
// CRYPTOGRAPHIC CODE GENERATION
// ============================================================================

/**
 * Generate a cryptographically secure, tenant-namespaced link code.
 * Format: <3-char tenant prefix>-<6-char random>
 * Non-sequential, non-guessable, collision-resistant.
 */
function generateSecureCode(tenantSlug) {
  const prefix = tenantSlug.substring(0, 3).toLowerCase();
  const randomBytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARSET[randomBytes[i] % CODE_CHARSET.length];
  }
  return `${prefix}-${code}`;
}

/**
 * Validate code format (prevents path traversal and injection)
 */
function isValidCode(code) {
  return /^[a-z0-9][a-z0-9_-]{2,48}[a-z0-9]$/.test(code);
}

/**
 * Validate tenant slug format
 */
function isValidTenantSlug(slug) {
  return /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(slug);
}

// ============================================================================
// CLICK FINGERPRINTING & DEDUPLICATION
// ============================================================================

function generateClickFingerprint(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const ua = req.headers['user-agent'] || '';
  const accept = req.headers['accept-language'] || '';
  const raw = `${ip}|${ua}|${accept}`;
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16);
}

async function isDuplicateClick(code, fingerprint) {
  const cutoff = new Date(Date.now() - CLICK_DEDUP_WINDOW_MS);
  const existing = await db.collection('smartLinkClicks')
    .where('code', '==', code)
    .where('fingerprint', '==', fingerprint)
    .where('timestamp', '>=', cutoff)
    .limit(1)
    .get();
  return !existing.empty;
}

// ============================================================================
// ENUMERATION PROTECTION
// ============================================================================

const IP_RESOLVE_COUNTS = new Map();

function checkResolveRateLimit(ip) {
  const now = Date.now();
  const entry = IP_RESOLVE_COUNTS.get(ip);

  if (!entry || now - entry.windowStart > 60000) {
    IP_RESOLVE_COUNTS.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RESOLVE_RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of IP_RESOLVE_COUNTS) {
    if (now - entry.windowStart > 120000) IP_RESOLVE_COUNTS.delete(ip);
  }
}, 300000);

// ============================================================================
// ABUSE DETECTION
// ============================================================================

async function checkAbuseSpike(code, tenantId) {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const recentClicks = await db.collection('smartLinkClicks')
    .where('code', '==', code)
    .where('timestamp', '>=', fiveMinAgo)
    .count()
    .get();

  const count = recentClicks.data().count;
  if (count >= ABUSE_SPIKE_THRESHOLD) {
    // Log abuse alert (don't block — just flag)
    await db.collection('security_alerts').add({
      type: 'click_spike',
      code,
      tenantId,
      clicksIn5min: count,
      threshold: ABUSE_SPIKE_THRESHOLD,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    console.warn(`[Security] Click spike detected: ${code} (${count} in 5min)`);
    return true;
  }
  return false;
}

// ============================================================================
// SOCIAL CRAWLER DETECTION
// ============================================================================

function isSocialCrawler(ua) {
  if (!ua) return false;
  return /facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|Slackbot|Discordbot|TelegramBot|Pinterest|Googlebot/i.test(ua);
}

// ============================================================================
// MAIN RESOLVER: alumni.kaayko.com/<tenant-slug>/<code>
// ============================================================================

router.get('/:tenantSlug/:code', async (req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '');

  // Only handle requests to alumni.kaayko.com (or local dev)
  if (!ALUMNI_HOSTS.includes(host) && host !== 'localhost' && !host.includes('127.0.0.1')) {
    return next();
  }

  const { tenantSlug, code } = req.params;

  // Input validation (constant-time-ish — don't reveal which param failed)
  if (!isValidTenantSlug(tenantSlug) || !isValidCode(code)) {
    // Deliberate delay to prevent timing-based enumeration
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
    return res.status(404).send(notFoundPage());
  }

  // Rate limit per IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  if (!checkResolveRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  }

  try {
    // Resolve tenant by slug
    const tenantSnap = await db.collection('tenants')
      .where('slug', '==', tenantSlug)
      .where('enabled', '==', true)
      .limit(1)
      .get();

    if (tenantSnap.empty) {
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      return res.status(404).send(notFoundPage());
    }

    const tenantDoc = tenantSnap.docs[0];
    const tenantId = tenantDoc.id;
    const tenant = tenantDoc.data();

    // Resolve link — MUST belong to this tenant (tenant-bound)
    const linkDoc = await db.collection('short_links').doc(code).get();

    if (!linkDoc.exists || linkDoc.data().tenantId !== tenantId) {
      // Constant-time response — don't reveal if code exists on another tenant
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      return res.status(404).send(notFoundPage());
    }

    const link = linkDoc.data();

    // Check if link is enabled
    if (link.enabled === false) {
      return res.status(410).send(gonePage('Link Disabled', 'This link has been deactivated by the administrator.'));
    }

    // Check expiry
    if (link.expiresAt) {
      const expiryDate = link.expiresAt.toDate ? link.expiresAt.toDate() : new Date(link.expiresAt);
      if (new Date() > expiryDate) {
        return res.status(410).send(gonePage('Link Expired', 'This link has expired and is no longer active.'));
      }
    }

    // Check max uses
    if (link.maxUses && link.clickCount >= link.maxUses) {
      return res.status(410).send(gonePage('Link Limit Reached', 'This link has reached its maximum number of uses.'));
    }

    // Advanced security checks (bot detection, velocity, canary, geo, referer)
    const securityResult = await runSecurityChecks(code, tenantId, req);
    if (securityResult.blocked) {
      await new Promise(r => setTimeout(r, 50 + Math.random() * 150));
      return res.status(404).send(notFoundPage());
    }

    // Determine destination
    const userAgent = req.headers['user-agent'] || '';
    let destination = link.webDestination || link.destinations?.web;

    // Platform-aware routing
    if (link.destinations?.ios && /iPhone|iPad|iPod/i.test(userAgent)) {
      destination = link.destinations.ios;
    } else if (link.destinations?.android && /Android/i.test(userAgent)) {
      destination = link.destinations.android;
    }

    if (!destination) {
      return res.status(404).send(notFoundPage());
    }

    // Social crawler — serve OG metadata without counting click
    if (isSocialCrawler(userAgent)) {
      return res.status(200).send(ogMetadataPage(link, destination, tenant));
    }

    // Click tracking (deduplicated)
    const fingerprint = generateClickFingerprint(req);
    const isDupe = await isDuplicateClick(code, fingerprint);

    if (!isDupe) {
      // Record click
      const clickData = {
        code,
        tenantId,
        fingerprint,
        ipHash: crypto.createHash('sha256').update(ip).digest('hex').substring(0, 12),
        userAgent: userAgent.substring(0, 200),
        referer: (req.headers.referer || '').substring(0, 500),
        utm: {
          source: req.query.utm_source || link.utm?.utm_source || null,
          medium: req.query.utm_medium || link.utm?.utm_medium || null,
          campaign: req.query.utm_campaign || link.utm?.utm_campaign || null
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        resolvedVia: 'alumni_namespace'
      };

      // Fire-and-forget (don't block redirect)
      db.collection('smartLinkClicks').add(clickData).catch(() => {});
      db.collection('short_links').doc(code).update({
        clickCount: admin.firestore.FieldValue.increment(1),
        lastClickAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});

      // Async abuse check
      checkAbuseSpike(code, tenantId).catch(() => {});
    }

    // Append UTM passthrough from query params
    const destUrl = new URL(destination);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(param => {
      if (req.query[param]) destUrl.searchParams.set(param, req.query[param]);
    });

    // Security headers on redirect
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-store, private'
    });

    return res.redirect(302, destUrl.toString());

  } catch (error) {
    console.error('[TenantResolver] Error:', error);
    return res.status(500).send(notFoundPage());
  }
});

// ============================================================================
// HEALTH / ROOT
// ============================================================================

router.get('/', (req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (!ALUMNI_HOSTS.includes(host)) return next();

  res.json({ platform: 'Kortex Alumni Links', status: 'active', version: '1.0' });
});

// ============================================================================
// ERROR PAGES (minimal, no info leakage)
// ============================================================================

function notFoundPage() {
  return `<!DOCTYPE html><html><head><title>Not Found</title><meta name="robots" content="noindex">
<style>body{font-family:-apple-system,sans-serif;background:#080808;color:#f0f0f0;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.c{text-align:center;max-width:400px;padding:32px}.h{font-size:48px;margin-bottom:16px;opacity:.3}h1{font-size:20px;margin:0 0 8px}p{color:#666;font-size:14px}</style>
</head><body><div class="c"><div class="h">404</div><h1>Link not found</h1><p>This link doesn't exist or has been removed.</p></div></body></html>`;
}

function gonePage(title, message) {
  return `<!DOCTYPE html><html><head><title>${title}</title><meta name="robots" content="noindex">
<style>body{font-family:-apple-system,sans-serif;background:#080808;color:#f0f0f0;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.c{text-align:center;max-width:400px;padding:32px}.h{font-size:48px;margin-bottom:16px;opacity:.3}h1{font-size:20px;margin:0 0 8px}p{color:#666;font-size:14px}</style>
</head><body><div class="c"><div class="h">410</div><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

function ogMetadataPage(link, destination, tenant) {
  const title = link.title || 'Shared Link';
  const desc = link.description || `Shared by ${tenant.name}`;
  return `<!DOCTYPE html><html><head>
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${destination}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta http-equiv="refresh" content="0;url=${destination}">
</head><body></body></html>`;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = router;
module.exports.generateSecureCode = generateSecureCode;
module.exports.ALUMNI_HOSTS = ALUMNI_HOSTS;
