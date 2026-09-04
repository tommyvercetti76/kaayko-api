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
 * Vocabulary (shared with the client): an event is `delivered` (reached the
 * configured destination), `rescued` (reached the fallback) or `lost` (reached
 * nothing); observed = all three, useful = delivered + rescued.
 *
 * Readers accept both event schemas: v1 (`ip`, full `referrer`, no `outcome`)
 * and v2 (`visitorKey`, `referrerHost`, explicit `outcome`).
 *
 * @module api/kortex/linkAnalytics
 */

const admin = require('firebase-admin');
const linkInsights = require('./linkInsights');
const { referrerHostOfEvent, normalizeDestination, outcomeOf, outcomeClassOf } = require('./clickTracking');

const db = admin.firestore();

// click_events carry a 30-day expiresAt TTL, so aggregates are a rolling window.
const RETENTION_DAYS = 30;
/** Newest events read per link; a read that fills the cap sets `truncated`. */
const EVENT_READ_CAP = 10000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Client-IP resolution was fixed on 2026-08-17. Before that, redirectHandler
// passed Express's `req.ip`, which behind Hosting → Cloud Run is infrastructure,
// not the visitor: older events hold either the GCP link-local address
// (::ffff:169.254.169.126) or a hash of a shared Google frontend address. Both
// are identical across unrelated visitors — a real iPhone scan and a desktop
// request from a different network hashed to the same value.
//
// So a well-formed key is necessary but NOT sufficient. Events predating the
// fix cannot identify anyone and are excluded from visitor counting entirely.
// Reliable unique-visitor data therefore begins at this timestamp.
const CLIENT_IP_FIX_AT = Date.parse('2026-08-17T23:00:00Z');
const VISITOR_KEY = /^[0-9a-f]{16}$/;

/** An event can identify a visitor only if it was written after the fix with a well-formed key. */
function canAttribute(event) {
  return event.ms >= CLIENT_IP_FIX_AT && typeof event.visitorKey === 'string' && VISITOR_KEY.test(event.visitorKey);
}

const formatters = new Map();
function partsFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false, weekday: 'short' }));
  }
  return formatters.get(timeZone);
}

/** Hour and weekday of an instant in a zone (Intl, DST-safe); UTC when the zone is unknown. */
function localParts(ms, timeZone) {
  try {
    const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
    const hour = Number(parts.find(p => p.type === 'hour').value) % 24;
    const dow = DAY_NAMES.indexOf(parts.find(p => p.type === 'weekday').value);
    return { hour, dow: dow < 0 ? new Date(ms).getUTCDay() : dow };
  } catch (_) {
    const d = new Date(ms);
    return { hour: d.getUTCHours(), dow: d.getUTCDay() };
  }
}

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function clampWindowDays(wanted) {
  const n = Number(wanted);
  return Number.isFinite(n) && n > 0 ? Math.min(n, RETENTION_DAYS) : RETENTION_DAYS;
}

function rate(n, d) {
  return d ? +(n / d).toFixed(4) : 0;
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

function weekdayHistogram(events, dowOf) {
  const d = new Array(7).fill(0);
  for (const e of events) d[dowOf(e)] += 1;
  return d.map((clicks, i) => ({ value: DAY_NAMES[i], clicks }));
}

function hourHistogram(events, hourOf) {
  const h = new Array(24).fill(0);
  for (const e of events) h[hourOf(e)] += 1;
  return h.map((clicks, hour) => ({ hour, clicks }));
}

function median(sorted) {
  return sorted[Math.floor(sorted.length / 2)];
}

/** One in-memory shape for v1 and v2 event documents. */
function normalizeEvent(e, timeZone) {
  const ms = e.timestampMs || (e.timestamp?.toMillis ? e.timestamp.toMillis() : null);
  return {
    ms,
    outcome: outcomeOf(e),
    outcomeClass: outcomeClassOf(e),
    reason: e.fallbackReason || null,
    platform: e.platform || null,
    deviceType: e.deviceInfo?.deviceType || null,
    os: e.deviceInfo?.os || null,
    browser: e.deviceInfo?.browser || null,
    visitorKey: e.visitorKey || e.ip || null,
    referrerHost: referrerHostOfEvent(e),
    redirectedTo: normalizeDestination(e.redirectedTo),
    country: e.geo?.country || null,
    installAttributed: e.installAttributed === true,
    source: e.metadata?.source === 'qr' ? 'qr' : 'link',
    window: e.metadata?.scheduleWindow || null,
    // redirectTimestamp - timestamp is the time the visitor spent waiting on
    // the resolver.
    redirectMs: e.redirectTimestamp?.toMillis ? e.redirectTimestamp.toMillis() : null,
    ...localParts(ms, timeZone)
  };
}

/** Newest events in the window, capped; served by the (linkCode, timestamp desc) index. */
async function readEvents(code, windowStartMs) {
  const snap = await db.collection('click_events')
    .where('linkCode', '==', code)
    .where('timestamp', '>=', admin.firestore.Timestamp.fromMillis(windowStartMs))
    .orderBy('timestamp', 'desc')
    .limit(EVENT_READ_CAP)
    .get();
  return { docs: snap.docs.map(d => d.data()), truncated: snap.size >= EVENT_READ_CAP };
}

function countClass(all, cls) {
  return all.filter(e => e.outcomeClass === cls).length;
}

/** observed / delivered / rescued / lost / useful and the two rates, from the class counts. */
function canonicalTotals(classes) {
  const observed = classes.delivered + classes.rescued + classes.lost;
  const useful = classes.delivered + classes.rescued;
  return {
    observed,
    delivered: classes.delivered,
    rescued: classes.rescued,
    lost: classes.lost,
    useful,
    usefulRate: rate(useful, observed),
    lostRate: rate(classes.lost, observed)
  };
}

/** Findings and their Action Center ranking; the event arrays let `sinceLastChange` cover only the time since the checkpoint. */
function findings({ link, events, undelivered, windowDays, timeZone, unique, checkpoint, totals }) {
  const insights = linkInsights.computeInsights({ link, events, undelivered, windowDays, timeZone, unique, checkpoint });
  return { insights, actionCenter: linkInsights.rankFindings(insights, { checkpoint, totals, events, undelivered }) };
}

/**
 * Unique visitors from events carrying a usable visitor key. Events written
 * before the client-IP fix stored a proxy address (or nothing), so coverage
 * is reported rather than silently treating absent keys as distinct people.
 */
function uniqueVisitors(events) {
  const total = events.length;
  const covered = events.filter(canAttribute);
  const unattributed = total - covered.length;
  const distinct = new Set(covered.map(e => e.visitorKey));
  const coveragePct = Math.round((covered.length / total) * 100);
  return {
    distinctVisitors: distinct.size,
    basedOnEvents: covered.length,
    ofTotalEvents: total,
    coveredEvents: covered.length,
    totalEvents: total,
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
    clicksPerVisitor: distinct.size ? +(covered.length / distinct.size).toFixed(2) : null
  };
}

/**
 * Every day between first and last event, including zero days: gaps are a
 * finding for a physical QR code, not something to compress away.
 */
function dailyTimeline(events) {
  const perDay = new Map();
  for (const e of events) {
    const k = dayKey(e.ms);
    if (!perDay.has(k)) perDay.set(k, { date: k, clicks: 0, visitors: new Set() });
    const bucket = perDay.get(k);
    bucket.clicks += 1;
    if (canAttribute(e)) bucket.visitors.add(e.visitorKey);
  }
  const timeline = [];
  const endDay = new Date(dayKey(events[events.length - 1].ms) + 'T00:00:00Z');
  for (let d = new Date(dayKey(events[0].ms) + 'T00:00:00Z'); d <= endDay; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    const b = perDay.get(k);
    timeline.push({ date: k, clicks: b ? b.clicks : 0, uniqueVisitors: b ? b.visitors.size : 0 });
  }
  return { timeline, daysWithTraffic: perDay.size };
}

/** Resolver latency: what the visitor actually waited before being redirected. */
function redirectLatency(events) {
  const latencies = events
    .map(e => (e.redirectMs && e.ms ? e.redirectMs - e.ms : null))
    .filter(v => v !== null && v >= 0)
    .sort((a, b) => a - b);
  return latencies.length
    ? { samples: latencies.length, medianMs: median(latencies), slowestMs: latencies[latencies.length - 1] }
    : null;
}

/**
 * Gaps between consecutive scans say more about a physical QR code than a
 * total does: a sticker that is working produces a rhythm, not a burst.
 */
function scanCadence(events, linkData) {
  const gapsHours = [];
  for (let i = 1; i < events.length; i++) {
    gapsHours.push((events[i].ms - events[i - 1].ms) / 3600000);
  }
  if (!gapsHours.length) return null;
  return {
    longestQuietHours: Math.round(Math.max(...gapsHours)),
    medianGapHours: Math.round(median(gapsHours.slice().sort((a, b) => a - b))),
    hoursSinceLastClick: Math.round((Date.now() - events[events.length - 1].ms) / 3600000),
    hoursToFirstClick: linkData.createdAt?.toMillis
      ? Math.round((events[0].ms - linkData.createdAt.toMillis()) / 3600000)
      : null
  };
}

/**
 * @param {string} code       Link code (click_events.linkCode)
 * @param {object} linkData   The short_links document data, or null if missing
 * @param {object} [options]  { windowDays, timeZone }
 * @returns {Promise<object>} Aggregate report
 */
async function getLinkAnalytics(code, linkData, options = {}) {
  // Plan window: the free tier sees the last `windowDays` of events, paid
  // tiers the full retained history. Lifetime totals stay on the link doc.
  const windowDays = clampWindowDays(options.windowDays);
  const windowStartMs = Date.now() - windowDays * 86400000;
  const timeZone = options.timeZone || 'UTC';
  const link = linkData || {};
  const checkpoint = link.checkpoint || null;

  const { docs, truncated } = await readEvents(code, windowStartMs);
  const all = docs
    .map(e => normalizeEvent(e, timeZone))
    .filter(e => e.ms && e.ms >= windowStartMs)
    .sort((a, b) => a.ms - b.ms);

  // Lost scans (expired, capped, held, blocked, paused, workspace off) are
  // kept apart: they are findings, never visits.
  const undelivered = all.filter(e => e.outcomeClass === 'lost');
  const events = all.filter(e => e.outcomeClass !== 'lost');
  const classes = { delivered: countClass(all, 'delivered'), rescued: countClass(all, 'rescued'), lost: undelivered.length };
  const canonical = canonicalTotals(classes);
  const fallbacks = events.filter(e => e.outcome === 'fallback');
  const outcomes = {
    undelivered: undelivered.length,
    classes,
    byOutcome: tally(undelivered.map(e => e.outcome)),
    fallbacks: fallbacks.length,
    fallbackByReason: tally(fallbacks.map(e => e.reason)),
    points: undelivered.slice(-500).map(e => [e.ms, e.outcome, e.platform, e.country])
  };

  const total = events.length;
  const storedClickCount = link.clickCount ?? null;

  if (!total) {
    const totals = { events: 0, storedClickCount, drift: null, ...canonical };
    return {
      code,
      totals,
      window: { retentionDays: windowDays, firstEvent: null, lastEvent: null },
      timeline: [],
      unique: null,
      breakdowns: {},
      points: [],
      timeZone,
      outcomes,
      truncated,
      checkpoint,
      ...findings({ link, events: [], undelivered, windowDays, timeZone, unique: null, checkpoint, totals }),
      unavailable: [{
        metric: 'all',
        reason: (storedClickCount || 0) > 0
          ? `The link's lifetime counter is ${storedClickCount}, but no events remain. ` +
            `Events expire after ${RETENTION_DAYS} days, so this link has had no traffic within the retention window.`
          : 'This link has never been scanned.'
      }]
    };
  }

  const unavailable = [];
  const unique = uniqueVisitors(events);
  const { timeline, daysWithTraffic } = dailyTimeline(events);

  const breakdowns = {
    platform: tally(events.map(e => e.platform)),
    source: tally(events.map(e => e.source)),
    deviceType: tally(events.map(e => e.deviceType)),
    os: tally(events.map(e => e.os)),
    browser: tally(events.map(e => e.browser)),
    referrer: tally(events.map(e => e.referrerHost)),
    destination: tally(events.map(e => e.redirectedTo)),
    dayOfWeekUtc: weekdayHistogram(events, e => new Date(e.ms).getUTCDay()),
    hourOfDayUtc: hourHistogram(events, e => new Date(e.ms).getUTCHours()),
    // The same two, in the viewer's zone (what the dashboards show).
    dayOfWeek: weekdayHistogram(events, e => e.dow),
    hourOfDay: hourHistogram(events, e => e.hour)
  };

  if (breakdowns.referrer.every(r => r.value === null)) {
    unavailable.push({
      metric: 'referrer',
      reason: 'No event carries a referrer. Expected for QR scans and direct entry — ' +
              'the camera app sends no Referer header. Not a tracking fault.'
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
              '2026-08-18, so links with only older scans show no location.'
    });
  }

  const latency = redirectLatency(events);
  if (!latency) {
    unavailable.push({
      metric: 'redirect latency',
      reason: 'No event recorded a redirect timestamp, so time-to-redirect cannot be measured.'
    });
  }

  // Individual scans, newest first. For a low-volume physical QR the exact
  // moments (and device/country) are the real story — an hour-of-day histogram
  // over a handful of points is noise. The client shows this scan log at low
  // volume and the distribution ramps only once there are enough events.
  const recentScans = events.slice(-25).reverse().map(e => ({
    at: new Date(e.ms).toISOString(),
    deviceType: e.deviceType,
    os: e.os,
    browser: e.browser,
    country: e.country
  }));

  // Compact per-event points for the client's clock, spider, sky and field-map
  // views: [ms, platform, deviceType, country, source, window, referrerHost, outcome].
  // Delivered and rescued only, newest 2000.
  const points = events.slice(-2000).map(e => [e.ms, e.platform, e.deviceType, e.country, e.source, e.window, e.referrerHost, e.outcome]);

  // The link's counter is lifetime; events expire. A positive drift is
  // expected on links older than the retention window, not a bug.
  const drift = storedClickCount == null ? null : storedClickCount - total;
  const totals = {
    events: total,
    storedClickCount,
    drift,
    driftNote: drift && drift > 0
      ? `The link's lifetime counter is ${drift} higher than the events retained. ` +
        `Events older than ${windowDays} days are outside this window.`
      : null,
    ...canonical
  };

  return {
    code,
    totals,
    window: {
      retentionDays: windowDays,
      firstEvent: new Date(events[0].ms).toISOString(),
      lastEvent: new Date(events[total - 1].ms).toISOString(),
      daysWithTraffic,
      daysSpanned: timeline.length
    },
    unique,
    timeZone,
    outcomes,
    truncated,
    checkpoint,
    ...findings({ link, events, undelivered, windowDays, timeZone, unique, checkpoint, totals }),
    installs: {
      attributed: events.filter(e => e.installAttributed).length
    },
    latency,
    cadence: scanCadence(events, link),
    recentScans,
    points,
    timeline,
    breakdowns,
    unavailable
  };
}

module.exports = { getLinkAnalytics, RETENTION_DAYS, EVENT_READ_CAP };
