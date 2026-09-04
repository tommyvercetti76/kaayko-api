/**
 * Click tracking and install attribution for Kortex links.
 *
 * Every scan or tap becomes one click_events document built by
 * buildEventRecord() — the same builder whether the visitor was delivered,
 * rescued by a fallback, or lost — so the two paths cannot drift.
 *
 * The record is minimised (schemaVersion 2): a keyed visitor hash instead of
 * an address, a referrer host instead of a URL, a destination without query
 * or fragment, and parsed device fields without the user-agent string.
 *
 * @module api/kortex/clickTracking
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { hashClientIp, isPublic } = require('./clientIp');
const { DEFAULT_TENANT_ID } = require('./tenantContext');

const db = admin.firestore();

const EVENT_SCHEMA_VERSION = 2;
const VISITOR_KEY_VERSION = 1;
const UA_PARSER_VERSION = 1;
const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const UTM_VALUE_MAX = 200;
const DIRECT = 'direct';

// Webhook service is loaded lazily to avoid a circular dependency.
let webhookService = null;
function getWebhookService() {
  if (!webhookService) {
    webhookService = require('./webhookService');
  }
  return webhookService;
}

/** Fire-and-forget webhook delivery; a webhook failure never fails tracking. */
function notifyWebhooks(tenantId, type, payload) {
  Promise.resolve()
    .then(() => {
      const webhooks = getWebhookService();
      return webhooks.triggerWebhooks({ tenantId, eventType: webhooks.EVENT_TYPES[type], payload });
    })
    .catch(err => console.error('[ClickTracking] Webhook trigger failed:', err));
}

/** Unique click ID: c_<16 random hex chars>. */
function generateClickId() {
  return `c_${crypto.randomBytes(8).toString('hex')}`;
}

// Country resolution from the raw IP, offline. The lookup happens here, on the
// non-blocking tracking path, and the raw IP is discarded immediately after —
// only the resolved country code and the keyed hash are ever stored. Using a
// bundled database (not a third-party API) keeps the visitor IP inside our own
// infrastructure, consistent with never storing it raw.
let geoip = null;
function resolveGeo(ip) {
  if (!ip || !isPublic(ip)) return null;
  try {
    if (!geoip) geoip = require('geoip-country');
    const r = geoip.lookup(ip);
    return r && r.country ? { country: r.country } : null;
  } catch (_) {
    return null; // geo is best-effort; a failure must never break tracking
  }
}

/** Host of a referrer URL, lowercase without a leading www., or 'direct' when there is none. */
function referrerHostOf(referrer) {
  if (!referrer) return DIRECT;
  try {
    return new URL(String(referrer)).hostname.toLowerCase().replace(/^www\./, '') || DIRECT;
  } catch (_) {
    return DIRECT;
  }
}

/** Referrer host of a stored event under either schema; null for direct traffic. */
function referrerHostOfEvent(event) {
  const host = event.referrerHost || referrerHostOf(event.referrer || event.referer);
  return host === DIRECT ? null : host;
}

/** Which configured destination a delivered scan took: the schedule window when one applied, else the platform route. */
function destinationKeyOf({ platform, destinations, scheduleWindow }) {
  if (scheduleWindow) return `schedule:${scheduleWindow}`;
  if (platform === 'ios' && destinations.ios) return 'ios';
  if (platform === 'android' && destinations.android) return 'android';
  return 'web';
}

/** A destination reduced to scheme, host and path: no query, fragment or userinfo. Null when unparseable. */
function normalizeDestination(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch (_) {
    return null;
  }
}

/** The stored outcome, or 'delivered' for events written before outcomes existed. */
function outcomeOf(event) {
  return event.outcome || (event.delivered === false ? null : 'delivered');
}

/** Canonical class of an event: delivered, rescued (a fallback) or lost. */
function outcomeClassOf(event) {
  const outcome = outcomeOf(event);
  if (outcome === 'delivered') return 'delivered';
  if (outcome === 'fallback') return 'rescued';
  return 'lost';
}

/** Only the five standard campaign keys, each bounded in length. */
function boundedUtm(utm) {
  const out = {};
  for (const key of UTM_KEYS) {
    const value = utm && utm[key];
    if (value !== undefined && value !== null && value !== '') out[key] = String(value).slice(0, UTM_VALUE_MAX);
  }
  return out;
}

/**
 * Normalised device fields from a user-agent string. The string itself is
 * never stored; parserVersion says which rules produced these values.
 */
function parseUserAgent(userAgent = '') {
  const ua = String(userAgent).toLowerCase();
  let os = 'Unknown';
  let browser = 'Unknown';
  let deviceType = 'desktop';

  if (ua.includes('iphone') || ua.includes('ipad')) {
    os = 'iOS';
    deviceType = ua.includes('ipad') ? 'tablet' : 'mobile';
  } else if (ua.includes('android')) {
    os = 'Android';
    deviceType = ua.includes('mobile') ? 'mobile' : 'tablet';
  } else if (ua.includes('windows')) {
    os = 'Windows';
  } else if (ua.includes('mac')) {
    os = 'macOS';
  } else if (ua.includes('linux')) {
    os = 'Linux';
  }

  if (ua.includes('safari') && !ua.includes('chrome')) {
    browser = 'Safari';
  } else if (ua.includes('chrome')) {
    browser = 'Chrome';
  } else if (ua.includes('firefox')) {
    browser = 'Firefox';
  } else if (ua.includes('edge')) {
    browser = 'Edge';
  }

  return { deviceType, os, browser, parserVersion: UA_PARSER_VERSION };
}

/**
 * One record shape for every scan outcome (event record v2).
 *
 * @param {object} p
 * @param {string} p.linkCode
 * @param {string} [p.tenantId]
 * @param {number} p.timestampMs
 * @param {boolean} p.delivered
 * @param {string} p.outcome              'delivered' | 'fallback' | a lost reason
 * @param {string|null} p.fallbackReason
 * @param {string|null} p.platform        ios | android | web
 * @param {string} p.userAgent            parsed into deviceInfo, never stored
 * @param {string|null} p.ip              hashed into visitorKey and resolved to a country, never stored
 * @param {string|null} p.referrer        reduced to its host
 * @param {object} p.utm
 * @param {string} p.source               'qr' | 'link'
 * @param {string|null} p.scheduleWindow
 * @param {string|null} p.destinationKey  'web' | 'ios' | 'android' | 'schedule:<label>' | 'fallback'
 * @param {string|null} p.redirectedTo    normalised to scheme, host and path
 */
function buildEventRecord(p) {
  return {
    clickId: generateClickId(),
    schemaVersion: EVENT_SCHEMA_VERSION,
    linkCode: p.linkCode,
    tenantId: p.tenantId || DEFAULT_TENANT_ID,
    timestamp: FieldValue.serverTimestamp(),
    timestampMs: p.timestampMs,
    delivered: p.delivered,
    outcome: p.outcome,
    fallbackReason: p.fallbackReason || null,
    platform: p.platform || null,
    deviceInfo: parseUserAgent(p.userAgent),
    geo: resolveGeo(p.ip),
    visitorKey: hashClientIp(p.ip),
    visitorKeyVersion: VISITOR_KEY_VERSION,
    referrerHost: referrerHostOf(p.referrer),
    destinationKey: p.destinationKey || null,
    redirectedTo: normalizeDestination(p.redirectedTo),
    utm: boundedUtm(p.utm),
    metadata: { source: p.source === 'qr' ? 'qr' : 'link', scheduleWindow: p.scheduleWindow || null },
    installAttributed: false,
    expiresAt: admin.firestore.Timestamp.fromMillis(p.timestampMs + EVENT_TTL_MS)
  };
}

function writeEvent(record) {
  return db.collection('click_events').doc(record.clickId).set(record);
}

/**
 * Record a delivered scan or tap and return its clickId for attribution.
 *
 * @param {object} params
 * @param {string} params.linkCode
 * @param {string} params.tenantId
 * @param {string} params.platform          ios | android | web
 * @param {string} params.userAgent
 * @param {string|null} params.ip
 * @param {string|null} params.referrer
 * @param {object} [params.utm]
 * @param {object} [params.metadata]        { source: 'qr'|'link', scheduleWindow }
 * @param {string} [params.destinationKey]  which configured destination was chosen
 * @returns {Promise<{clickId: string, timestamp: Date}>}
 */
async function trackClick(params) {
  const { linkCode, tenantId, platform, userAgent, ip, referrer, utm = {}, metadata = {}, destinationKey = null } = params;
  const timestamp = new Date();
  const scheduleWindow = metadata.scheduleWindow || null;

  const record = buildEventRecord({
    linkCode,
    tenantId,
    timestampMs: timestamp.getTime(),
    delivered: true,
    outcome: 'delivered',
    fallbackReason: null,
    platform,
    userAgent,
    ip,
    referrer,
    utm,
    source: metadata.source,
    scheduleWindow,
    destinationKey: destinationKey || (scheduleWindow ? `schedule:${scheduleWindow}` : null),
    redirectedTo: null
  });
  await writeEvent(record);

  notifyWebhooks(record.tenantId, 'CLICK', {
    event: 'link.clicked',
    clickId: record.clickId,
    linkCode,
    platform,
    timestamp: timestamp.toISOString(),
    deviceInfo: record.deviceInfo,
    utm: record.utm
  });

  return { clickId: record.clickId, timestamp };
}

/**
 * A scan that did not reach the intended page (expired, capped, held, blocked,
 * paused, workspace off) or that took a fallback. Same collection as clicks,
 * flagged `delivered:false` for misses so no count or webhook ever treats it
 * as a visit; a fallback is delivered, with its reason.
 */
async function trackOutcome(params) {
  const { linkCode, tenantId, outcome, reason = null, delivered = false, redirectedTo = null, platform = null, userAgent = '', ip = null, referrer = null, scanned = false } = params;
  if (!linkCode || !outcome) return null;

  const record = buildEventRecord({
    linkCode,
    tenantId,
    timestampMs: Date.now(),
    delivered: delivered === true,
    outcome,
    fallbackReason: reason,
    platform,
    userAgent,
    ip,
    referrer,
    utm: {},
    source: scanned ? 'qr' : 'link',
    scheduleWindow: null,
    destinationKey: outcome === 'fallback' ? 'fallback' : null,
    redirectedTo
  });
  await writeEvent(record);
  return { clickId: record.clickId };
}

/**
 * Record where a delivered click was sent, once the redirect decision is made.
 * The destination is stored normalised (no query, fragment or userinfo).
 */
async function updateClickRedirect(clickId, destination) {
  try {
    await db.collection('click_events').doc(clickId).update({
      redirectedTo: normalizeDestination(destination),
      redirectTimestamp: FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('[ClickTracking] Failed to update redirect:', error);
  }
}

/**
 * Track an install event and attribute it to a click.
 * Called from /resolve after an app install.
 *
 * @param {object} params
 * @param {string} params.clickId     Click ID from the deep link
 * @param {string} params.deviceId    Stable device identifier
 * @param {string} params.platform    ios | android
 * @param {string} params.appVersion
 * @param {object} [params.metadata]
 * @returns {Promise<{success: boolean, attributed: boolean, context?: object}>}
 */
async function trackInstall(params) {
  const { clickId, deviceId, platform, appVersion, metadata = {} } = params;

  if (!clickId) {
    return { success: false, attributed: false, error: 'clickId required' };
  }

  try {
    const clickDoc = await db.collection('click_events').doc(clickId).get();

    if (!clickDoc.exists) {
      console.warn('[ClickTracking] Install without valid click:', clickId);
      return { success: true, attributed: false, error: 'Click not found' };
    }

    const clickData = clickDoc.data();

    // Idempotent: a second install report for the same click changes nothing.
    if (clickData.installAttributed) {
      return { success: true, attributed: true, isNewInstall: false, context: clickData };
    }

    await clickDoc.ref.update({
      installAttributed: true,
      installTimestamp: FieldValue.serverTimestamp(),
      installDeviceId: deviceId,
      installPlatform: platform,
      installAppVersion: appVersion,
      installMetadata: metadata
    });

    await db.collection('short_links').doc(clickData.linkCode).update({
      installCount: FieldValue.increment(1),
      lastInstallAt: FieldValue.serverTimestamp()
    });

    await db.collection('install_events').add({
      clickId,
      linkCode: clickData.linkCode,
      tenantId: clickData.tenantId,
      deviceId,
      platform,
      appVersion,
      timestamp: FieldValue.serverTimestamp(),
      clickTimestamp: clickData.timestamp,
      timeToConversion: calculateTimeToConversion(clickData.timestampMs),
      utm: clickData.utm,
      metadata
    });

    notifyWebhooks(clickData.tenantId, 'INSTALL', {
      event: 'app.installed',
      clickId,
      linkCode: clickData.linkCode,
      deviceId,
      platform,
      appVersion,
      timestamp: new Date().toISOString(),
      utm: clickData.utm
    });

    return {
      success: true,
      attributed: true,
      isNewInstall: true,
      context: {
        linkCode: clickData.linkCode,
        tenantId: clickData.tenantId,
        utm: clickData.utm,
        metadata: clickData.metadata
      }
    };
  } catch (error) {
    console.error('[ClickTracking] Install tracking error:', error);
    return { success: false, attributed: false, error: error.message };
  }
}

/** Seconds from click to conversion. */
function calculateTimeToConversion(clickTimestampMs) {
  return Math.floor((Date.now() - clickTimestampMs) / 1000);
}

/**
 * Click and install counts for the public API (clicks, installs, conversion rate).
 *
 * @param {string} linkCode
 * @param {object} options
 * @param {Date} [options.startDate]
 * @param {Date} [options.endDate]
 * @returns {Promise<object>}
 */
async function getLinkAnalytics(linkCode, options = {}) {
  const { startDate, endDate } = options;

  let clickQuery = db.collection('click_events').where('linkCode', '==', linkCode);
  let installQuery = db.collection('install_events').where('linkCode', '==', linkCode);

  if (startDate) {
    const startTimestamp = admin.firestore.Timestamp.fromDate(startDate);
    clickQuery = clickQuery.where('timestamp', '>=', startTimestamp);
    installQuery = installQuery.where('timestamp', '>=', startTimestamp);
  }

  if (endDate) {
    const endTimestamp = admin.firestore.Timestamp.fromDate(endDate);
    clickQuery = clickQuery.where('timestamp', '<=', endTimestamp);
    installQuery = installQuery.where('timestamp', '<=', endTimestamp);
  }

  const [clickSnapshot, installSnapshot] = await Promise.all([clickQuery.get(), installQuery.get()]);

  const clicks = clickSnapshot.docs.map(doc => doc.data());
  const installs = installSnapshot.docs.map(doc => doc.data());

  const totalClicks = clicks.length;
  const totalInstalls = installs.length;
  const conversionRate = totalClicks > 0 ? (totalInstalls / totalClicks) * 100 : 0;

  const platformBreakdown = clicks.reduce((acc, click) => {
    acc[click.platform] = (acc[click.platform] || 0) + 1;
    return acc;
  }, {});

  const utmSources = {};
  clicks.forEach(click => {
    const source = click.utm?.utm_source || 'direct';
    utmSources[source] = (utmSources[source] || 0) + 1;
  });

  return {
    totalClicks,
    totalInstalls,
    conversionRate: conversionRate.toFixed(2),
    platformBreakdown,
    utmSources,
    clicks: clicks.slice(0, 100),
    installs: installs.slice(0, 100)
  };
}

/**
 * Delete click_events older than 30 days, 500 at a time (scheduled job).
 *
 * @returns {Promise<{deleted: number}>}
 */
async function cleanupExpiredClicks() {
  const expiryTimestamp = admin.firestore.Timestamp.fromMillis(Date.now() - EVENT_TTL_MS);

  const expiredSnapshot = await db.collection('click_events')
    .where('timestamp', '<', expiryTimestamp)
    .limit(500)
    .get();

  const batch = db.batch();
  expiredSnapshot.docs.forEach(doc => batch.delete(doc.ref));

  if (expiredSnapshot.size > 0) {
    await batch.commit();
  }

  return { deleted: expiredSnapshot.size };
}

module.exports = {
  trackClick,
  trackOutcome,
  updateClickRedirect,
  trackInstall,
  getLinkAnalytics,
  cleanupExpiredClicks,
  referrerHostOf,
  referrerHostOfEvent,
  destinationKeyOf,
  normalizeDestination,
  outcomeOf,
  outcomeClassOf
};
