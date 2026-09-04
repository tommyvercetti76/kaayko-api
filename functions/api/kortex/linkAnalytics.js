/**
 * Per-link analytics — derived entirely from stored click_events.
 *
 * Design rules, because the dashboard this replaces reported configuration as
 * if it were behaviour:
 *
 *  1. Every figure traces to a persisted event. Nothing is modelled, estimated
 *     or back-filled.
 *  2. A metric that cannot be computed is reported in `unavailable` with the
 *     reason. It is never rendered as 0 — an absent measurement and a measured
 *     zero are different facts and must not look alike.
 *  3. Coverage is reported alongside any figure derived from a field that is
 *     not always present, so a number computed from a third of the data is not
 *     presented with the confidence of one computed from all of it.
 *
 * @module api/kortex/linkAnalytics
 */

const admin = require('firebase-admin');

const db = admin.firestore();

// click_events carry a 30-day expiresAt TTL, so aggregates are a rolling window.
const RETENTION_DAYS = 30;

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Client-IP resolution was fixed on 2026-08-17. Before that, redirectHandler
// passed Express's `req.ip`, which behind Hosting → Cloud Run is infrastructure,
// not the visitor: older events hold either the GCP link-local address
// (::ffff:169.254.169.126) or a hash of a shared Google frontend address. Both
// are identical across unrelated visitors — a real iPhone scan and a desktop
// request from a different network hashed to the same value.
//
// So a well-formed hash is necessary but NOT sufficient. Events predating the
// fix cannot identify anyone and are excluded from visitor counting entirely.
// Reliable unique-visitor data therefore begins at this timestamp.
const CLIENT_IP_FIX_AT = Date.parse('2026-08-17T23:00:00Z');
const IP_HASH = /^[0-9a-f]{16}$/;

function isUsableIpHash(ip) {
  return typeof ip === 'string' && IP_HASH.test(ip);
}

/** An event can identify a visitor only if it was written after the fix. */
function canAttribute(event) {
  return event.ms >= CLIENT_IP_FIX_AT && isUsableIpHash(event.ip);
}

function tally(items) {
  const counts = new Map();
  for (const raw of items) {
    const key = raw == null || raw === '' ? null : String(raw);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, clicks]) => ({ value, clicks }))
    .sort((a, b) => b.clicks - a.clicks);
}

/**
 * @param {string} code       Link code (click_events.linkCode)
 * @param {object} linkData   The short_links document data, or null if missing
 * @returns {Promise<object>} Aggregate report
 */
async function getLinkAnalytics(code, linkData, options = {}) {
  const snap = await db.collection('click_events').where('linkCode', '==', code).get();

  // Plan window: the free tier sees the last `windowDays` of events, paid
  // tiers the full retained history. Lifetime totals stay on the link doc.
  const windowDays = Number.isFinite(Number(options.windowDays)) && Number(options.windowDays) > 0
    ? Math.min(Number(options.windowDays), RETENTION_DAYS)
    : RETENTION_DAYS;
  const windowStartMs = Date.now() - windowDays * 86400000;

  const events = snap.docs
    .map(d => d.data())
    .map(e => ({
      ms: e.timestampMs || (e.timestamp?.toMillis ? e.timestamp.toMillis() : null),
      platform: e.platform || null,
      deviceType: e.deviceInfo?.deviceType || null,
      os: e.deviceInfo?.os || null,
      browser: e.deviceInfo?.browser || null,
      ip: e.ip || null,
      referrer: e.referrer || null,
      redirectedTo: e.redirectedTo || null,
      country: e.geo?.country || null,
      installAttributed: e.installAttributed === true,
      source: e.metadata?.source === 'qr' ? 'qr' : 'link',
      // redirectTimestamp - timestamp is the time the visitor spent waiting on
      // the resolver. It is stored on every event but has never been surfaced.
      redirectMs: (e.redirectTimestamp?.toMillis ? e.redirectTimestamp.toMillis() : null),
    }))
    .filter(e => e.ms && e.ms >= windowStartMs)
    .sort((a, b) => a.ms - b.ms);

  const unavailable = [];
  const total = events.length;

  if (!total) {
    return {
      code,
      totals: { events: 0, storedClickCount: linkData?.clickCount ?? null, drift: null },
      window: { retentionDays: windowDays, firstEvent: null, lastEvent: null },
      timeline: [],
      unique: null,
      breakdowns: {},
      unavailable: [{
        metric: 'all',
        reason: total === 0 && (linkData?.clickCount || 0) > 0
          ? `The link records ${linkData.clickCount} lifetime clicks, but no click_events remain. ` +
            `Events expire after ${RETENTION_DAYS} days, so this link has had no traffic within the retention window.`
          : 'This link has never been clicked.',
      }],
    };
  }

  // --- unique visitors -----------------------------------------------------
  // Only events carrying a resolved IP hash can contribute. Events written
  // before the client-IP fix stored a proxy address (or nothing), so coverage
  // is reported rather than silently treating absent IPs as distinct people.
  const withIp = events.filter(canAttribute);
  const unattributed = total - withIp.length;
  const distinct = new Set(withIp.map(e => e.ip));
  const coveragePct = Math.round((withIp.length / total) * 100);

  const unique = {
    distinctVisitors: distinct.size,
    basedOnEvents: withIp.length,
    ofTotalEvents: total,
    coveragePct,
    reliable: coveragePct === 100,
    // Bounds, not a point estimate: each unattributed event is either one of
    // the visitors already counted or a new one, and the data cannot say which.
    lowerBound: distinct.size,
    upperBound: distinct.size + unattributed,
    caveat: coveragePct === 100
      ? null
      : `${unattributed} of ${total} events predate the 2026-08-17 client-IP fix, when every ` +
        `visitor resolved to the same infrastructure address. They cannot identify anyone, so ` +
        `distinct visitors is between ${distinct.size} and ${distinct.size + unattributed}. ` +
        `Reliable visitor counts begin 2026-08-17.`,
  };

  const clicksPerVisitor = distinct.size ? +(withIp.length / distinct.size).toFixed(2) : null;

  // --- timeline ------------------------------------------------------------
  // Every day between first and last event, including zero days: gaps are a
  // finding for a physical QR code, not something to compress away.
  const perDay = new Map();
  for (const e of events) {
    const k = dayKey(e.ms);
    if (!perDay.has(k)) perDay.set(k, { date: k, clicks: 0, ips: new Set() });
    const bucket = perDay.get(k);
    bucket.clicks += 1;
    if (canAttribute(e)) bucket.ips.add(e.ip);
  }
  const timeline = [];
  const startDay = new Date(dayKey(events[0].ms) + 'T00:00:00Z');
  const endDay = new Date(dayKey(events[total - 1].ms) + 'T00:00:00Z');
  for (let d = new Date(startDay); d <= endDay; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    const b = perDay.get(k);
    timeline.push({ date: k, clicks: b ? b.clicks : 0, uniqueVisitors: b ? b.ips.size : 0 });
  }

  // --- breakdowns ----------------------------------------------------------
  const breakdowns = {
    platform: tally(events.map(e => e.platform)),
    source: tally(events.map(e => e.source)),
    deviceType: tally(events.map(e => e.deviceType)),
    os: tally(events.map(e => e.os)),
    browser: tally(events.map(e => e.browser)),
    referrer: tally(events.map(e => e.referrer)),
    destination: tally(events.map(e => e.redirectedTo)),
    dayOfWeekUtc: (() => {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const d = new Array(7).fill(0);
      for (const e of events) d[new Date(e.ms).getUTCDay()] += 1;
      return d.map((clicks, i) => ({ value: names[i], clicks }));
    })(),
    hourOfDayUtc: (() => {
      const h = new Array(24).fill(0);
      for (const e of events) h[new Date(e.ms).getUTCHours()] += 1;
      return h.map((clicks, hour) => ({ hour, clicks }));
    })(),
  };

  if (breakdowns.referrer.every(r => r.value === null)) {
    unavailable.push({
      metric: 'referrer',
      reason: 'No event carries a referrer. Expected for QR scans and direct entry — ' +
              'the camera app sends no Referer header. Not a tracking fault.',
    });
  }

  // Country is captured at redirect time (offline lookup) as of 2026-08-18.
  // Show it when present; only report it unavailable when no event carries it
  // (older events, or clients whose IP couldn't be resolved to a country).
  const countryRows = tally(events.map(e => e.country));
  if (countryRows.some(r => r.value !== null)) {
    breakdowns.country = countryRows;
  } else {
    unavailable.push({
      metric: 'geography',
      reason: 'No retained event carries a resolved country yet — country capture began ' +
              '2026-08-18, so links with only older clicks show no location.',
    });
  }

  // Resolver latency: what the visitor actually waited before being redirected.
  const latencies = events.map(e => (e.redirectMs && e.ms ? e.redirectMs - e.ms : null))
                          .filter(v => v !== null && v >= 0);
  const latency = latencies.length ? {
    samples: latencies.length,
    medianMs: latencies.slice().sort((a, b) => a - b)[Math.floor(latencies.length / 2)],
    slowestMs: Math.max(...latencies),
  } : null;
  if (!latency) {
    unavailable.push({
      metric: 'redirect latency',
      reason: 'No event recorded a redirect timestamp, so time-to-redirect cannot be measured.',
    });
  }

  // Gaps between consecutive clicks say more about a physical QR code than a
  // total does: a sticker that is working produces a rhythm, not a burst.
  const gapsHours = [];
  for (let i = 1; i < events.length; i++) {
    gapsHours.push((events[i].ms - events[i - 1].ms) / 3600000);
  }
  const cadence = gapsHours.length ? {
    longestQuietHours: Math.round(Math.max(...gapsHours)),
    medianGapHours: Math.round(gapsHours.slice().sort((a, b) => a - b)[Math.floor(gapsHours.length / 2)]),
    hoursSinceLastClick: Math.round((Date.now() - events[total - 1].ms) / 3600000),
    hoursToFirstClick: linkData?.createdAt?.toMillis
      ? Math.round((events[0].ms - linkData.createdAt.toMillis()) / 3600000)
      : null,
  } : null;

  // Individual scans, newest first. For a low-volume physical QR the exact
  // moments (and device/country) are the real story — an hour-of-day histogram
  // over a handful of points is noise. The client shows this scan log at low
  // volume and the distribution ramps only once there are enough events.
  const recentScans = events.slice(-25).reverse().map(e => ({
    at: new Date(e.ms).toISOString(),
    deviceType: e.deviceType,
    os: e.os,
    browser: e.browser,
    country: e.country,
  }));

  const storedClickCount = linkData?.clickCount ?? null;
  const drift = storedClickCount == null ? null : storedClickCount - total;

  return {
    code,
    totals: {
      events: total,
      storedClickCount,
      // The link's counter is lifetime; events expire. A positive drift is
      // expected on links older than the retention window, not a bug.
      drift,
      driftNote: drift && drift > 0
        ? `The link's lifetime counter is ${drift} higher than the events retained. ` +
          `Events older than ${windowDays} days are outside this window.`
        : null,
    },
    window: {
      retentionDays: windowDays,
      firstEvent: new Date(events[0].ms).toISOString(),
      lastEvent: new Date(events[total - 1].ms).toISOString(),
      daysWithTraffic: perDay.size,
      daysSpanned: timeline.length,
    },
    unique: { ...unique, clicksPerVisitor },
    installs: {
      attributed: events.filter(e => e.installAttributed).length,
    },
    latency,
    cadence,
    recentScans,
    timeline,
    breakdowns,
    unavailable,
  };
}

module.exports = { getLinkAnalytics, RETENTION_DAYS };
