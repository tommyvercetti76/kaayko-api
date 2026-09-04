/**
 * Portfolio analytics — aggregated across every link from the real click_events
 * stream, not the shallow per-link clickCount counters the dashboard used to sum.
 *
 * Why this exists: the dashboard and analytics views computed totals as
 * `links.reduce((s,l) => s + l.clickCount)` and grouped by weak client-side
 * fields. clickCount is a lifetime counter that drifts from the retained event
 * stream (the per-link drift reconciliation already exposed this), and it
 * carries none of the device / time / destination signal the 206 events hold.
 * This reads the events directly and applies the same honesty rules as the
 * per-link view: uncertainty is reported, unreliable uniques are a range, and
 * the counter-vs-events drift is stated rather than hidden.
 *
 * @module api/kortex/portfolioAnalytics
 */

const admin = require('firebase-admin');
const { referrerHostOfEvent, normalizeDestination } = require('./clickTracking');

const db = admin.firestore();

// Kept in step with linkAnalytics.js (the source of truth for these rules).
// Readers accept both event schemas: v2 `visitorKey`/`referrerHost` and v1 `ip`/`referrer`.
const RETENTION_DAYS = 30;
const CLIENT_IP_FIX_AT = Date.parse('2026-08-17T23:00:00Z');
const VISITOR_KEY = /^[0-9a-f]{16}$/;
const canAttribute = (e) => e.ms >= CLIENT_IP_FIX_AT && typeof e.visitorKey === 'string' && VISITOR_KEY.test(e.visitorKey);
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

function tally(items, top = 8) {
  const m = new Map();
  for (const raw of items) {
    const k = raw == null || raw === '' ? null : String(raw);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()]
    .map(([value, clicks]) => ({ value, clicks }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, top);
}

/**
 * @param {object} opts
 * @param {string|null} opts.tenantId  scope to one tenant, or null for all (super-admin)
 * @returns {Promise<object>}
 */
async function getPortfolioAnalytics({ tenantId = null } = {}) {
  // --- link + campaign context (for joins and drift) ----------------------
  let linkQ = db.collection('short_links');
  if (tenantId) linkQ = linkQ.where('tenantId', '==', tenantId);
  const linkSnap = await linkQ.get();

  const links = new Map();          // code -> meta
  let counterSum = 0;
  linkSnap.forEach((d) => {
    const v = d.data();
    const code = v.code || d.id;
    counterSum += v.clickCount || 0;
    links.set(code, {
      code,
      title: v.title || code,
      campaignId: v.campaignId || null,
      tenantId: v.tenantId || null,
      tenantName: v.tenantName || null,
      enabled: v.enabled !== false,
      createdBy: v.createdBy || null,
      clickCount: v.clickCount || 0,
    });
  });

  const campSnap = await (tenantId
    ? db.collection('campaigns').where('tenantId', '==', tenantId).get()
    : db.collection('campaigns').get());
  const campaigns = new Map();       // id -> name
  campSnap.forEach((d) => campaigns.set(d.data().campaignId || d.id, d.data().name || d.id));

  // --- events -------------------------------------------------------------
  let evQ = db.collection('click_events');
  if (tenantId) evQ = evQ.where('tenantId', '==', tenantId);
  const evSnap = await evQ.get();

  const events = evSnap.docs.map((d) => {
    const e = d.data();
    return {
      ms: e.timestampMs || (e.timestamp?.toMillis ? e.timestamp.toMillis() : null),
      linkCode: e.linkCode || null,
      platform: e.platform || null,
      deviceType: e.deviceInfo?.deviceType || null,
      os: e.deviceInfo?.os || null,
      browser: e.deviceInfo?.browser || null,
      visitorKey: e.visitorKey || e.ip || null,
      referrerHost: referrerHostOfEvent(e),
      redirectedTo: normalizeDestination(e.redirectedTo),
      country: e.geo?.country || null,       // present once redirect-time geo lands
      tenantId: e.tenantId || null,
      installAttributed: e.installAttributed === true,
    };
  }).filter((e) => e.ms).sort((a, b) => a.ms - b.ms);

  const total = events.length;
  const unavailable = [];

  if (!total) {
    return {
      scope: tenantId || 'all',
      totals: { events: 0, links: links.size, counterSum, drift: counterSum },
      window: { retentionDays: RETENTION_DAYS, firstEvent: null, lastEvent: null },
      timeline: [], topLinks: [], campaigns: [], breakdowns: {}, unique: null,
      unavailable: [{ metric: 'all', reason: `No click_events retained${tenantId ? ' for this tenant' : ''} in the ${RETENTION_DAYS}-day window.` }],
    };
  }

  // --- timeline (all links combined, zero days kept) ----------------------
  const perDay = new Map();
  for (const e of events) {
    const k = dayKey(e.ms);
    if (!perDay.has(k)) perDay.set(k, { clicks: 0, keys: new Set() });
    const b = perDay.get(k);
    b.clicks += 1;
    if (canAttribute(e)) b.keys.add(e.visitorKey);
  }
  const timeline = [];
  for (let d = new Date(dayKey(events[0].ms) + 'T00:00:00Z');
       d <= new Date(dayKey(events[total - 1].ms) + 'T00:00:00Z');
       d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    const b = perDay.get(k);
    timeline.push({ date: k, clicks: b ? b.clicks : 0, uniqueVisitors: b ? b.keys.size : 0 });
  }

  // --- top links by REAL event count (not the counter) --------------------
  const perLink = new Map();
  for (const e of events) {
    if (!e.linkCode) continue;
    perLink.set(e.linkCode, (perLink.get(e.linkCode) || 0) + 1);
  }
  const topLinks = [...perLink.entries()]
    .map(([code, clicks]) => {
      const meta = links.get(code);
      return {
        code, clicks,
        title: meta?.title || code,
        enabled: meta?.enabled ?? true,
        campaign: meta?.campaignId ? (campaigns.get(meta.campaignId) || meta.campaignId) : null,
        counter: meta?.clickCount ?? null,
      };
    })
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);

  // Active = links that STILL EXIST and have events. Orphan codes = events that
  // reference a link no longer in short_links (deleted after it was clicked) —
  // a real data-quality signal, not "active links".
  const activeLinks = [...links.keys()].filter((c) => perLink.has(c)).length;
  const dormant = links.size - activeLinks;
  const orphanCodes = [...perLink.keys()].filter((c) => !links.has(c)).length;

  // --- campaign rollup from real events via link.campaignId ---------------
  const campAgg = new Map();
  for (const e of events) {
    const meta = links.get(e.linkCode);
    const cid = meta?.campaignId || '__unassigned';
    if (!campAgg.has(cid)) campAgg.set(cid, { clicks: 0, links: new Set() });
    const c = campAgg.get(cid);
    c.clicks += 1;
    if (e.linkCode) c.links.add(e.linkCode);
  }
  const campaignRollup = [...campAgg.entries()]
    .map(([cid, v]) => ({
      campaignId: cid === '__unassigned' ? null : cid,
      name: cid === '__unassigned' ? 'Unassigned' : (campaigns.get(cid) || cid),
      clicks: v.clicks,
      links: v.links.size,
    }))
    .sort((a, b) => b.clicks - a.clicks);

  // --- breakdowns ---------------------------------------------------------
  const breakdowns = {
    deviceType: tally(events.map((e) => e.deviceType)),
    os: tally(events.map((e) => e.os)),
    browser: tally(events.map((e) => e.browser)),
    platform: tally(events.map((e) => e.platform)),
    destination: tally(events.map((e) => e.redirectedTo), 6),
    referrer: tally(events.map((e) => e.referrerHost)),
    hourOfDayUtc: (() => { const h = new Array(24).fill(0); for (const e of events) h[new Date(e.ms).getUTCHours()]++; return h.map((clicks, hour) => ({ hour, clicks })); })(),
    dayOfWeekUtc: (() => { const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; const d = new Array(7).fill(0); for (const e of events) d[new Date(e.ms).getUTCDay()]++; return d.map((clicks, i) => ({ value: names[i], clicks })); })(),
  };

  // geography: only real once redirect-time capture lands; until then, void.
  const geoRows = tally(events.map((e) => e.country));
  const hasGeo = geoRows.some((r) => r.value !== null);
  if (hasGeo) breakdowns.country = geoRows;
  else unavailable.push({ metric: 'geography', reason: 'Country is not yet captured at redirect time, so no location breakdown exists across the portfolio.' });

  if (breakdowns.referrer.every((r) => r.value === null)) {
    unavailable.push({ metric: 'referrer', reason: 'No event carries a referrer — expected for QR scans and direct entry.' });
  }

  // --- unique visitors (honest, post-boundary) ----------------------------
  const attributable = events.filter(canAttribute);
  const distinct = new Set(attributable.map((e) => e.visitorKey));
  const cov = Math.round((attributable.length / total) * 100);
  const unattributed = total - attributable.length;
  const unique = {
    distinctVisitors: distinct.size,
    coveragePct: cov,
    reliable: cov === 100,
    lowerBound: distinct.size,
    upperBound: distinct.size + unattributed,
    caveat: cov === 100 ? null
      : `${unattributed} of ${total} events predate the 2026-08-17 client-IP fix and can't be attributed, so portfolio-wide distinct visitors is between ${distinct.size} and ${distinct.size + unattributed}.`,
  };

  // --- drift: lifetime counters vs retained events ------------------------
  const drift = counterSum - total;

  return {
    scope: tenantId || 'all',
    totals: {
      events: total,
      links: links.size,
      activeLinks,
      dormantLinks: dormant,
      orphanCodes,
      counterSum,
      drift,
      driftNote: drift > 0
        ? `Lifetime scan counters total ${counterSum}, but only ${total} events remain within the ${RETENTION_DAYS}-day retention window. The ${drift}-scan gap is expired history, not missing data.`
        : drift < 0
          ? `There are ${total} retained events but the lifetime counters total only ${counterSum}${orphanCodes ? ` — ${orphanCodes} link code${orphanCodes === 1 ? '' : 's'} in the events no longer exist in short_links (deleted after being scanned)` : ', so some counters lag their events'}.`
          : null,
    },
    window: {
      retentionDays: RETENTION_DAYS,
      firstEvent: new Date(events[0].ms).toISOString(),
      lastEvent: new Date(events[total - 1].ms).toISOString(),
      daysWithTraffic: perDay.size,
      daysSpanned: timeline.length,
    },
    timeline,
    topLinks,
    campaigns: campaignRollup,
    breakdowns,
    unique,
    installs: { attributed: events.filter((e) => e.installAttributed).length },
    unavailable,
  };
}

module.exports = { getPortfolioAnalytics, RETENTION_DAYS };
