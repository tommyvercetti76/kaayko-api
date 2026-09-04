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
const { getClientIp, ipSalt } = require('./clientIp');
const { respondForStatus, escapeHtml, effectiveStatus } = require('./safetyPages');
const { trackClick, trackOutcome, updateClickRedirect, referrerHostOf, destinationKeyOf } = require('./clickTracking');
const { pickScheduledDestination } = require('./linkSchedule');
const { evaluateLimits, OVER_LIMIT_COPY } = require('./linkRules');
const { isQrScan, mergeTrackingIntoDestination, UTM_KEYS } = require('./utmTools');

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
const LEGACY_CLICK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // smartLinkClicks retention, mirrors click_events
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
  // Hardened resolver (right-to-left forwarded chain); the old leftmost read was caller-controlled.
  const ip = getClientIp(req) || 'unknown';
  const ua = req.headers['user-agent'] || '';
  const accept = req.headers['accept-language'] || '';
  const raw = `${ip}|${ua}|${accept}`;
  // Keyed under the IP salt so the stored value is not a pre-image-enumerable
  // digest of an address; falls back to a plain digest when no salt exists so
  // dedup keeps working rather than collapsing every visitor onto one key.
  const salt = ipSalt();
  const digest = salt ? crypto.createHmac('sha256', salt).update(raw) : crypto.createHash('sha256').update(raw);
  return digest.digest('hex').substring(0, 16);
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
}, 300000).unref();

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
  // Hardened resolver (right-to-left forwarded chain); the old leftmost read was caller-controlled.
  const ip = getClientIp(req) || 'unknown';
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
    const miss = (outcome, extra = {}) => {
      const ua0 = req.headers['user-agent'] || '';
      if (isSocialCrawler(ua0)) return;
      trackOutcome({ linkCode: code, tenantId, outcome, ...extra, platform: /iphone|ipad/i.test(ua0) ? 'ios' : /android/i.test(ua0) ? 'android' : 'web', userAgent: ua0, ip: getClientIp(req), referrer: req.headers.referer || null, scanned: isQrScan(req.query) }).catch(() => {});
    };

    // Check if link is enabled
    if (link.enabled === false) {
      miss('paused');
      return res.status(410).send(gonePage('Link Disabled', 'This link has been deactivated by the administrator.'));
    }

    // Safety / review state (held → review page, blocked → 410)
    if (effectiveStatus(link) !== 'active') miss(effectiveStatus(link));
    if (respondForStatus(res, link, code)) return;

    // Past expiry or over its cap (the legacy maxUses field still counts).
    // A creator-set fallback URL gets a redirect; otherwise a 410 page.
    const withLegacyCap = link.maxUses && !(link.limits && link.limits.maxClicks)
      ? { ...link, limits: { ...(link.limits || {}), maxClicks: Number(link.maxUses) } }
      : link;
    const overLimit = evaluateLimits(withLegacyCap);
    if (overLimit.over) {
      if (overLimit.fallbackUrl) {
        miss('fallback', { delivered: true, reason: overLimit.reason, redirectedTo: overLimit.fallbackUrl });
        return res.redirect(302, overLimit.fallbackUrl);
      }
      miss(overLimit.reason === 'expired' ? 'expired' : 'capped');
      const copy = OVER_LIMIT_COPY[overLimit.reason];
      return res.status(410).send(gonePage(copy.title, copy.message));
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

    // Time-of-day routing (server clock, link timezone) wins for every platform.
    let scheduleWindow = null;
    if (link.schedule) {
      const pick = pickScheduledDestination(link.schedule);
      if (pick) { destination = pick.url; scheduleWindow = pick.label; }
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
      const clickUTM = {
        utm_source: req.query.utm_source || link.utm?.utm_source || null,
        utm_medium: req.query.utm_medium || link.utm?.utm_medium || null,
        utm_campaign: req.query.utm_campaign || link.utm?.utm_campaign || null
      };
      // Write to BOTH collections for backwards compat + unified analytics.
      // The legacy record carries only what its readers use: no address hash,
      // no user-agent string and a referrer host rather than a full URL.
      const clickBase = {
        code,
        tenantId,
        fingerprint,
        utm: clickUTM,
        referrerHost: referrerHostOf(req.headers.referer),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + LEGACY_CLICK_TTL_MS),
        resolvedVia: 'alumni_namespace'
      };

      // click_events — the shared event record (v2), then where the visitor was sent
      const platform = /iphone|ipad/i.test(userAgent) ? 'ios' : /android/i.test(userAgent) ? 'android' : 'web';
      const destinationKey = destinationKeyOf({ platform, destinations: link.destinations || {}, scheduleWindow });
      trackClick({ linkCode: code, tenantId, platform, userAgent, ip, referrer: req.headers.referer || null, utm: clickUTM, metadata: { source: isQrScan(req.query) ? 'qr' : 'link', scheduleWindow }, destinationKey })
        .then(({ clickId }) => updateClickRedirect(clickId, destination))
        .catch(() => {});

      // smartLinkClicks — legacy collection
      db.collection('smartLinkClicks').add(clickBase).catch(() => {});
      db.collection('short_links').doc(code).update({
        clickCount: admin.firestore.FieldValue.increment(1),
        lastClickAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});

      // Async abuse check
      checkAbuseSpike(code, tenantId).catch(() => {});
    }

    // Campaign tags: what the destination already carries stays; tags on the
    // scanning URL, then the link's own tags, fill the gaps.
    const queryUtm = {};
    for (const key of UTM_KEYS) if (typeof req.query[key] === 'string' && req.query[key]) queryUtm[key] = req.query[key];
    const finalDestination = mergeTrackingIntoDestination(destination, {
      utm: { ...(link.utm || {}), ...queryUtm },
      scanned: isQrScan(req.query)
    });

    // Security headers on redirect
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-store, private'
    });

    return res.redirect(302, finalDestination);

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
  return `<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title><meta name="robots" content="noindex">
<style>body{font-family:-apple-system,sans-serif;background:#080808;color:#f0f0f0;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.c{text-align:center;max-width:400px;padding:32px}.h{font-size:48px;margin-bottom:16px;opacity:.3}h1{font-size:20px;margin:0 0 8px}p{color:#666;font-size:14px}</style>
</head><body><div class="c"><div class="h">410</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}

function ogMetadataPage(link, destination, tenant) {
  const title = escapeHtml(link.title || 'Shared Link');
  const desc = escapeHtml(link.description || `Shared by ${tenant.name || 'Kortex'}`);
  const safeDest = escapeHtml(destination);
  return `<!DOCTYPE html><html><head>
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${safeDest}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta http-equiv="refresh" content="0;url=${safeDest}">
</head><body></body></html>`;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = router;
module.exports.generateSecureCode = generateSecureCode;
module.exports.ALUMNI_HOSTS = ALUMNI_HOSTS;
