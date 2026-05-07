/**
 * Link Security Service — Advanced anti-gamification layer
 *
 * Layers:
 *  1. HMAC-signed URLs — optional ?sig= param proves link authenticity
 *  2. Click velocity profiling — detects gradual ramp-ups (bot farms)
 *  3. Honeypot canary links — codes that should never be clicked by real users
 *  4. Bot/automation detection — headless browser fingerprinting
 *  5. Geographic anomaly flagging — unlikely geo patterns
 *  6. Referer chain validation — catches injected traffic sources
 */

const crypto = require('crypto');
const admin = require('firebase-admin');
const db = admin.firestore();

// ============================================================================
// 1. HMAC-SIGNED URLS
// ============================================================================

const SIGNING_SECRET = process.env.KORTEX_LINK_SIGNING_SECRET || 'kx-default-signing-key-replace-in-prod';

function signCode(code, tenantId) {
  const payload = `${tenantId}:${code}`;
  return crypto.createHmac('sha256', SIGNING_SECRET)
    .update(payload)
    .digest('base64url')
    .substring(0, 12);
}

function verifySignature(code, tenantId, sig) {
  if (!sig) return null; // no sig = not enforced (backwards compat)
  const expected = signCode(code, tenantId);
  return crypto.timingSafeEqual(
    Buffer.from(sig, 'utf8'),
    Buffer.from(expected, 'utf8')
  );
}

// ============================================================================
// 2. CLICK VELOCITY PROFILING
// ============================================================================

const VELOCITY_WINDOWS = new Map(); // code -> { buckets: [], lastReset }
const VELOCITY_BUCKET_MS = 60000; // 1-minute buckets
const VELOCITY_HISTORY = 30; // track last 30 minutes
const RAMP_THRESHOLD = 3; // 3x increase over 5 consecutive buckets = suspicious

function recordClickVelocity(code) {
  const now = Date.now();
  let entry = VELOCITY_WINDOWS.get(code);

  if (!entry || now - entry.lastReset > VELOCITY_BUCKET_MS * VELOCITY_HISTORY) {
    entry = { buckets: new Array(VELOCITY_HISTORY).fill(0), lastReset: now, currentBucket: 0 };
    VELOCITY_WINDOWS.set(code, entry);
  }

  const bucketIndex = Math.floor((now - entry.lastReset) / VELOCITY_BUCKET_MS) % VELOCITY_HISTORY;
  if (bucketIndex !== entry.currentBucket) {
    // Moved to new bucket, zero it out
    entry.buckets[bucketIndex] = 0;
    entry.currentBucket = bucketIndex;
  }
  entry.buckets[bucketIndex]++;
  VELOCITY_WINDOWS.set(code, entry);
}

function detectVelocityAnomaly(code) {
  const entry = VELOCITY_WINDOWS.get(code);
  if (!entry) return { suspicious: false };

  const { buckets, currentBucket } = entry;
  const recentBuckets = [];
  for (let i = 0; i < 5; i++) {
    const idx = (currentBucket - i + VELOCITY_HISTORY) % VELOCITY_HISTORY;
    recentBuckets.unshift(buckets[idx]);
  }

  // Detect ramp: each bucket significantly higher than previous
  let rampCount = 0;
  for (let i = 1; i < recentBuckets.length; i++) {
    if (recentBuckets[i] > 0 && recentBuckets[i - 1] > 0) {
      if (recentBuckets[i] / recentBuckets[i - 1] >= 1.5) {
        rampCount++;
      }
    }
  }

  // Detect sustained high volume (potential bot farm)
  const avgRecent = recentBuckets.reduce((s, v) => s + v, 0) / recentBuckets.length;
  const olderBuckets = [];
  for (let i = 10; i < 20; i++) {
    const idx = (currentBucket - i + VELOCITY_HISTORY) % VELOCITY_HISTORY;
    olderBuckets.push(buckets[idx]);
  }
  const avgOlder = olderBuckets.reduce((s, v) => s + v, 0) / (olderBuckets.length || 1);

  const suspicious = rampCount >= RAMP_THRESHOLD || (avgOlder > 0 && avgRecent / avgOlder > 5);

  return {
    suspicious,
    reason: rampCount >= RAMP_THRESHOLD ? 'velocity_ramp' : (suspicious ? 'sustained_spike' : null),
    recentRate: avgRecent,
    baselineRate: avgOlder
  };
}

// Cleanup stale velocity data every 10 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = VELOCITY_BUCKET_MS * VELOCITY_HISTORY * 2;
  for (const [code, entry] of VELOCITY_WINDOWS) {
    if (now - entry.lastReset > maxAge) VELOCITY_WINDOWS.delete(code);
  }
}, 600000);

// ============================================================================
// 3. HONEYPOT / CANARY LINKS
// ============================================================================

const CANARY_PREFIX = 'trap-';

function isCanaryCode(code) {
  return code.startsWith(CANARY_PREFIX);
}

async function createCanaryLink(tenantId, tenantSlug) {
  const randomBytes = crypto.randomBytes(4);
  let suffix = '';
  const charset = 'abcdefghjkmnpqrstuvwxyz23456789';
  for (let i = 0; i < 4; i++) {
    suffix += charset[randomBytes[i] % charset.length];
  }
  const code = `${CANARY_PREFIX}${suffix}`;

  await db.collection('short_links').doc(code).set({
    code,
    tenantId,
    isCanary: true,
    enabled: true,
    destinations: { web: 'https://kaayko.com/404' },
    clickCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'security-system',
    metadata: { purpose: 'honeypot', visibility: 'hidden' }
  });

  return {
    code,
    url: `https://alumni.kaayko.com/${tenantSlug}/${code}`,
    purpose: 'Any access to this URL indicates enumeration or unauthorized sharing'
  };
}

async function triggerCanaryAlert(code, req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);

  await db.collection('security_alerts').add({
    type: 'canary_triggered',
    severity: 'high',
    code,
    ipHash,
    userAgent: (req.headers['user-agent'] || '').substring(0, 300),
    referer: (req.headers.referer || '').substring(0, 500),
    headers: sanitizeHeaders(req.headers),
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  console.error(`[SECURITY] Canary link triggered: ${code} from IP hash ${ipHash}`);
}

// ============================================================================
// 4. BOT / AUTOMATION DETECTION
// ============================================================================

const BOT_SIGNALS = {
  HEADLESS_CHROME: /HeadlessChrome|PhantomJS|Nightmare|puppeteer/i,
  AUTOMATION_TOOLS: /Selenium|WebDriver|webdriver|ChromeDriver/i,
  EMPTY_UA: /^$/,
  SUSPICIOUS_UA: /python-requests|axios|node-fetch|Go-http-client|Java\/|curl\/|wget\//i,
  KNOWN_BOTS: /Googlebot|bingbot|Baiduspider|YandexBot|DuckDuckBot|Sogou|Exabot|ia_archiver/i
};

function detectBot(req) {
  const ua = req.headers['user-agent'] || '';
  const signals = [];
  let score = 0;

  // UA-based detection
  if (BOT_SIGNALS.HEADLESS_CHROME.test(ua)) { signals.push('headless_chrome'); score += 90; }
  if (BOT_SIGNALS.AUTOMATION_TOOLS.test(ua)) { signals.push('automation_tool'); score += 95; }
  if (!ua || BOT_SIGNALS.EMPTY_UA.test(ua)) { signals.push('empty_ua'); score += 70; }
  if (BOT_SIGNALS.SUSPICIOUS_UA.test(ua)) { signals.push('http_library'); score += 60; }
  if (BOT_SIGNALS.KNOWN_BOTS.test(ua)) { signals.push('known_bot'); score += 50; }

  // Header anomalies
  if (!req.headers['accept-language']) { signals.push('no_accept_language'); score += 20; }
  if (!req.headers['accept']) { signals.push('no_accept_header'); score += 15; }
  if (req.headers['accept'] === '*/*' && !req.headers['accept-language']) {
    signals.push('generic_accept'); score += 30;
  }

  // Connection-level signals
  if (req.headers['x-forwarded-for']?.split(',').length > 5) {
    signals.push('proxy_chain'); score += 25;
  }

  // TLS fingerprint absence (Cloud Functions strips this, but check for direct access)
  if (req.headers['x-tls-version'] === 'TLSv1.0' || req.headers['x-tls-version'] === 'TLSv1.1') {
    signals.push('old_tls'); score += 40;
  }

  const isBot = score >= 70;
  return { isBot, score, signals };
}

// ============================================================================
// 5. GEOGRAPHIC ANOMALY DETECTION
// ============================================================================

const GEO_CLICK_HISTORY = new Map(); // code -> Set<country>

function recordGeoClick(code, countryCode) {
  if (!countryCode) return;
  let countries = GEO_CLICK_HISTORY.get(code);
  if (!countries) {
    countries = new Map(); // country -> count
    GEO_CLICK_HISTORY.set(code, countries);
  }
  countries.set(countryCode, (countries.get(countryCode) || 0) + 1);
}

function detectGeoAnomaly(code, countryCode) {
  if (!countryCode) return { anomalous: false };
  const countries = GEO_CLICK_HISTORY.get(code);
  if (!countries || countries.size < 5) return { anomalous: false };

  const total = Array.from(countries.values()).reduce((s, v) => s + v, 0);
  const countryCount = countries.get(countryCode) || 0;
  const countryPct = countryCount / total;

  // Flag if a single country suddenly dominates (>80%) with >20 clicks
  // OR if clicks come from >15 different countries (bot farm pattern)
  const anomalous = (countries.size > 15) || (countryPct > 0.8 && total > 20);

  return {
    anomalous,
    reason: countries.size > 15 ? 'too_many_countries' : (anomalous ? 'single_country_dominance' : null),
    uniqueCountries: countries.size,
    topCountryPct: countryPct
  };
}

// Cleanup geo data periodically
setInterval(() => {
  if (GEO_CLICK_HISTORY.size > 10000) {
    const entries = Array.from(GEO_CLICK_HISTORY.entries());
    entries.slice(0, entries.length - 5000).forEach(([k]) => GEO_CLICK_HISTORY.delete(k));
  }
}, 900000);

// ============================================================================
// 6. REFERER VALIDATION
// ============================================================================

const SUSPICIOUS_REFERERS = [
  /fiverr\.com/i,
  /freelancer\.com/i,
  /microworkers\.com/i,
  /clickworker\.com/i,
  /trafficbot/i,
  /hitsgenerator/i,
  /websitetrafficgenerator/i,
  /faketraffic/i,
  /buytraffic/i
];

function checkReferer(referer) {
  if (!referer) return { suspicious: false };

  for (const pattern of SUSPICIOUS_REFERERS) {
    if (pattern.test(referer)) {
      return { suspicious: true, reason: 'known_traffic_source', pattern: pattern.source };
    }
  }
  return { suspicious: false };
}

// ============================================================================
// UNIFIED SECURITY CHECK
// ============================================================================

async function runSecurityChecks(code, tenantId, req) {
  const results = {
    passed: true,
    blocked: false,
    alerts: [],
    botScore: 0
  };

  // 1. Canary check
  if (isCanaryCode(code)) {
    triggerCanaryAlert(code, req).catch(() => {});
    results.alerts.push({ type: 'canary_triggered', severity: 'high' });
    results.blocked = true;
    results.passed = false;
    return results;
  }

  // 2. Bot detection
  const botResult = detectBot(req);
  results.botScore = botResult.score;
  if (botResult.isBot) {
    results.alerts.push({ type: 'bot_detected', severity: 'medium', signals: botResult.signals });
    results.blocked = true;
    results.passed = false;
  }

  // 3. HMAC signature (if present)
  const sig = req.query.sig;
  if (sig) {
    const valid = verifySignature(code, tenantId, sig);
    if (valid === false) {
      results.alerts.push({ type: 'invalid_signature', severity: 'medium' });
      results.passed = false;
    }
  }

  // 4. Velocity check
  recordClickVelocity(code);
  const velocityResult = detectVelocityAnomaly(code);
  if (velocityResult.suspicious) {
    results.alerts.push({ type: 'velocity_anomaly', severity: 'medium', reason: velocityResult.reason });
  }

  // 5. Referer check
  const refererResult = checkReferer(req.headers.referer);
  if (refererResult.suspicious) {
    results.alerts.push({ type: 'suspicious_referer', severity: 'low', reason: refererResult.reason });
  }

  // 6. Geo check (using CF/Cloudflare country header if available)
  const country = req.headers['cf-ipcountry'] || req.headers['x-country-code'] || null;
  if (country) {
    recordGeoClick(code, country);
    const geoResult = detectGeoAnomaly(code, country);
    if (geoResult.anomalous) {
      results.alerts.push({ type: 'geo_anomaly', severity: 'low', reason: geoResult.reason });
    }
  }

  // Persist alerts if any
  if (results.alerts.length > 0) {
    const highSeverity = results.alerts.some(a => a.severity === 'high');
    const medSeverity = results.alerts.some(a => a.severity === 'medium');

    if (highSeverity || medSeverity) {
      db.collection('security_alerts').add({
        type: 'link_security_check',
        code,
        tenantId,
        alerts: results.alerts,
        botScore: results.botScore,
        ipHash: crypto.createHash('sha256')
          .update(req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '')
          .digest('hex').substring(0, 12),
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});
    }
  }

  return results;
}

// ============================================================================
// HELPERS
// ============================================================================

function sanitizeHeaders(headers) {
  const safe = {};
  const ALLOWED = ['accept', 'accept-language', 'accept-encoding', 'connection',
    'cache-control', 'x-forwarded-for', 'x-forwarded-proto', 'cf-ipcountry'];
  for (const key of ALLOWED) {
    if (headers[key]) safe[key] = String(headers[key]).substring(0, 200);
  }
  return safe;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  signCode,
  verifySignature,
  runSecurityChecks,
  detectBot,
  detectVelocityAnomaly,
  recordClickVelocity,
  isCanaryCode,
  createCanaryLink,
  triggerCanaryAlert,
  checkReferer,
  CANARY_PREFIX
};
