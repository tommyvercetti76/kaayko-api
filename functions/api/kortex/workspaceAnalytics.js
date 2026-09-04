/**
 * Workspace-level analytics: every link in a workspace inside its window,
 * one merged point list for the overview charts, the workspace findings and
 * a work queue — rows ordered by the lost scans an owner can still recover.
 * One implementation for the guest router and the admin router.
 *
 * Cost bound: the whole response is cached per tenant for a minute, at most
 * 25 links are read (`droppedLinks` says how many were not), and each link's
 * event read is capped by linkAnalytics. When daily rollups cover every
 * complete day of the window, a row's outcome totals and timeline come from
 * them plus today's live scans; otherwise from the live analytics alone.
 *
 * @module api/kortex/workspaceAnalytics
 */

'use strict';

const admin = require('firebase-admin');
const LinkService = require('./smartLinkService');
const { getLinkAnalytics } = require('./linkAnalytics');
const { computeWorkspaceInsights } = require('./linkInsights');
const { placementDisplay } = require('./linkFields');
const rollups = require('./rollups');

const MAX_LINKS = 25;
const LIST_LIMIT = 100;
const CACHE_TTL_MS = 60000;
const MERGED_POINTS_CAP = 3000;
const TIMELINE_DAYS = 7;
const MIN_PERIOD_USEFUL = 10;
const UNIQUE_NOTE = 'one person may scan several links; per-link people are not summed';
const RECOVERABLE_VIA_FALLBACK = ['capped', 'expired'];
// Lead warning for a row the Action Center ranked nothing for. needsAttention keeps
// only warn findings with high|medium confidence, so a low-sample warn (confidence
// null) never ranks; this order picks the lead warning for those rows.
const ISSUE_ORDER = ['missed', 'deviceMatch', 'anomalies', 'trend', 'safetyImpact', 'fallbackUsage', 'utmHealth', 'campaignLift', 'repeatPattern', 'geoDrift', 'qualityScore'];

const cache = new Map();

async function countWhere(collection, field, value) {
  try {
    const snap = await admin.firestore().collection(collection).where(field, '==', value).limit(500).get();
    return snap.size;
  } catch (_) { return 0; }
}

function cacheKey(tenantId, windowDays, timeZone) { return `${tenantId}|${windowDays}|${timeZone}`; }

function cachedResponse(key, nowMs) {
  const hit = cache.get(key);
  return hit && nowMs - hit.atMs < CACHE_TTL_MS ? hit.data : null;
}

function rememberResponse(key, data, nowMs) {
  for (const [k, v] of cache) if (nowMs - v.atMs >= CACHE_TTL_MS) cache.delete(k);
  cache.set(key, { atMs: nowMs, data });
}

/** Forget every cached workspace response. */
function resetWorkspaceCache() { cache.clear(); }

function bump(map, key, by = 1) { map[key] = (map[key] || 0) + by; }
function round3(x) { return Math.round(x * 1000) / 1000; }
function rateOf(part, whole) { return whole ? round3(part / whole) : null; }
function usefulOf(counts) { return counts.delivered + counts.rescued; }

/** Outcome counts of a live analytics response. */
function liveCounts(a) {
  const { observed, delivered, rescued, lost } = a.totals;
  return { observed, delivered, rescued, lost };
}

function liveLostByReason(a) {
  const byReason = {};
  for (const r of a.outcomes.byOutcome) bump(byReason, r.value || 'unknown', r.clicks);
  return byReason;
}

function emptyBucket() { return { delivered: 0, rescued: 0, lost: 0, lostByReason: {} }; }

function bucketOfRollup(rollup) {
  const bucket = { delivered: rollup.delivered || 0, rescued: rollup.rescued || 0, lost: rollup.lost || 0, lostByReason: {} };
  for (const [outcome, n] of Object.entries(rollup.byOutcome || {})) {
    if (outcome !== 'delivered' && outcome !== 'fallback') bump(bucket.lostByReason, outcome, n);
  }
  return bucket;
}

/** Today's scans from the live analytics: its points are the newest events, so the current day is exact under the point caps. */
function liveTodayBucket(a, todayStartMs) {
  const bucket = emptyBucket();
  for (const p of a.points) if (p[0] >= todayStartMs) bucket[p[7] === 'fallback' ? 'rescued' : 'delivered'] += 1;
  for (const p of a.outcomes.points) {
    if (p[0] >= todayStartMs) { bucket.lost += 1; bump(bucket.lostByReason, p[1] || 'unknown'); }
  }
  return bucket;
}

function sumBuckets(buckets) {
  const total = emptyBucket();
  for (const b of buckets) {
    total.delivered += b.delivered;
    total.rescued += b.rescued;
    total.lost += b.lost;
    for (const [reason, n] of Object.entries(b.lostByReason)) bump(total.lostByReason, reason, n);
  }
  return { ...total, observed: total.delivered + total.rescued + total.lost };
}

/** Delta of the useful rate between two complete periods; null until both have enough useful scans. */
function deltaUsefulRate(current, previous) {
  if (usefulOf(current) < MIN_PERIOD_USEFUL || usefulOf(previous) < MIN_PERIOD_USEFUL) return null;
  return round3(usefulOf(current) / current.observed - usefulOf(previous) / previous.observed);
}

function sampleConfidence(observed) { return observed >= 30 ? 'high' : observed >= 10 ? 'medium' : observed >= 5 ? 'early' : null; }

/** Lost scans a setting change would still recover: capped/expired while no fallback is set, paused while the link stays off. */
function recoverableLostOf(link, lostByReason) {
  const viaFallback = link.limits && link.limits.fallbackUrl ? 0 : RECOVERABLE_VIA_FALLBACK.reduce((s, k) => s + (lostByReason[k] || 0), 0);
  const viaResume = link.enabled === false ? lostByReason.paused || 0 : 0;
  return viaFallback + viaResume;
}

/** The finding an owner should look at first: the Action Center's top pick, else, when nothing ranked, the first low-confidence warning that carries a fix. */
function topFindingOf(a) {
  const insights = a.insights || {};
  const ranked = (a.actionCenter && Array.isArray(a.actionCenter.needsAttention) ? a.actionCenter.needsAttention : []).filter(k => insights[k]);
  const warnings = ISSUE_ORDER.filter(k => insights[k] && insights[k].status === 'warn' && insights[k].confidence !== 'early');
  const key = ranked[0] || warnings.find(k => insights[k].action) || warnings[0] || null;
  return key ? { key, finding: insights[key] } : null;
}

function detailOf(a, key) {
  const finding = a.insights && a.insights[key];
  return finding && finding.detail ? finding.detail : {};
}

function rowOf(link, a, counts, lostByReason, timeline, changeVsPrevious) {
  const src = Object.fromEntries((a.breakdowns.source || []).map(r => [r.value, r.clicks]));
  const topCountry = (a.breakdowns.country || []).find(r => r.value) || null;
  const top = topFindingOf(a);
  const useful = usefulOf(counts);
  return {
    code: link.code, title: link.title || link.code, status: link.status || 'active', enabled: link.enabled !== false,
    placement: link.placement || null, placementLabel: placementDisplay(link), utm: link.utm || {},
    lifetime: link.clickCount || 0, events: a.totals.events, qr: src.qr || 0, taps: src.link || 0,
    unique: a.unique ? a.unique.distinctVisitors : 0, topCountry: topCountry ? topCountry.value : null,
    missed: a.outcomes ? a.outcomes.undelivered : 0,
    scansAffected: detailOf(a, 'safetyImpact').scansAffected || 0,
    quality: detailOf(a, 'qualityScore').score ?? null,
    trend: detailOf(a, 'trend').label || null,
    observed: counts.observed, useful, rescued: counts.rescued, lost: counts.lost,
    usefulRate: rateOf(useful, counts.observed),
    recoverableLost: recoverableLostOf(link, lostByReason),
    topIssue: top ? { key: top.key, headline: top.finding.headline, action: top.finding.action || null } : null,
    confidence: top && top.finding.confidence ? top.finding.confidence : sampleConfidence(counts.observed),
    changeVsPrevious,
    timeline
  };
}

function liveRow(link, a) {
  return rowOf(link, a, liveCounts(a), liveLostByReason(a), a.timeline.slice(-TIMELINE_DAYS).map(d => d.clicks), null);
}

function rolledRow(link, a, coverage) {
  const bucketOn = date => { const rollup = coverage.byKey.get(`${link.code}|${date}`); return rollup ? bucketOfRollup(rollup) : emptyBucket(); };
  const current = coverage.current.map(bucketOn);
  const series = current.concat([liveTodayBucket(a, coverage.todayStartMs)]);
  const totals = sumBuckets(series);
  const changeVsPrevious = coverage.previous ? deltaUsefulRate(sumBuckets(current), sumBuckets(coverage.previous.map(bucketOn))) : null;
  return rowOf(link, a, totals, totals.lostByReason, series.slice(-TIMELINE_DAYS).map(usefulOf), changeVsPrevious);
}

/**
 * The rollup view of the window when every complete day in it was rolled:
 * the current period's dates, the previous period's when it is covered too,
 * and the tenant's rollups keyed `${code}|${date}`. Null means live analytics.
 */
async function rollupCoverage(tenantId, windowDays, nowMs) {
  const today = rollups.utcDateKey(nowMs);
  const current = rollups.dateKeysBefore(today, windowDays);
  const previous = rollups.dateKeysBefore(current[0], windowDays);
  const lastComplete = current[current.length - 1];
  const complete = await rollups.completeRollupDays(previous[0], lastComplete);
  if (!current.every(d => complete.has(d))) return null;
  const byKey = await rollups.readTenantRollups(tenantId, previous[0], lastComplete);
  if (!byKey) return null;
  return { todayStartMs: rollups.dayStartMs(today), current, previous: previous.every(d => complete.has(d)) ? previous : null, byKey };
}

/** The work queue order: most recoverable lost scans first, then most lost. */
function sortRows(rows) { return rows.slice().sort((x, y) => y.recoverableLost - x.recoverableLost || y.lost - x.lost); }

/**
 * @param {string} tenantId
 * @param {{ windowDays: number, timeZone?: string, nowMs?: number }} opts
 */
async function buildWorkspaceAnalytics(tenantId, { windowDays, timeZone = 'UTC', nowMs = Date.now() } = {}) {
  const key = cacheKey(tenantId, windowDays, timeZone);
  const hit = cachedResponse(key, nowMs);
  if (hit) return hit;
  const { links } = await LinkService.listLinks({ tenantId, limit: LIST_LIMIT });
  const kept = links.slice(0, MAX_LINKS);
  const coverage = await rollupCoverage(tenantId, windowDays, nowMs);
  const rows = [];
  let merged = [];
  for (const link of kept) {
    const a = await getLinkAnalytics(link.code, link, { windowDays, timeZone });
    rows.push(coverage ? rolledRow(link, a, coverage) : liveRow(link, a));
    merged = merged.concat((a.points || []).map(p => [link.code].concat(p)));
  }
  merged.sort((x, y) => x[1] - y[1]);
  const [reports, appeals] = await Promise.all([
    countWhere('kortex_abuse_reports', 'tenantId', tenantId),
    countWhere('kortex_appeals', 'tenantId', tenantId)
  ]);
  const sorted = sortRows(rows);
  const data = {
    window: { days: windowDays, timeZone, source: coverage ? 'rollups' : 'events' },
    links: sorted,
    points: merged.slice(-MERGED_POINTS_CAP),
    insights: computeWorkspaceInsights({ links: sorted, reports, appeals, windowDays, timeZone }),
    queue: sorted.map(r => r.code),
    droppedLinks: links.length - kept.length,
    uniquePeople: null,
    uniqueNote: UNIQUE_NOTE
  };
  rememberResponse(key, data, nowMs);
  return data;
}

module.exports = { buildWorkspaceAnalytics, resetWorkspaceCache };
