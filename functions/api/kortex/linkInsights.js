/**
 * The plain-language layer over a link's scans, computed once on the server
 * so every surface (wanderer dashboard, admin app, samples, shared reports,
 * digests) says the same thing. Pure: takes the events the analytics module
 * already read, never touches the database.
 *
 * Each finding is an insight v2 object:
 *   { key, version: 2, title, status: 'good'|'warn'|'info'|'none',
 *     severity, confidence, sampleSize, window: { days, timeZone },
 *     headline, detail, metrics, reasonCodes, action, shareClass,
 *     provenance, insufficient }
 * `none` means "cannot be computed yet": `insufficient` says what is needed.
 * Thresholds are enforced here, never in the browser. `metrics.affected` is
 * the number of scans a finding concerns; the Action Center ranks by it.
 *
 * Vocabulary: `events` are useful visits (delivered + rescued, a rescued visit
 * has outcome 'fallback'); `undelivered` are lost scans; observed = both.
 * Copy never says click, buyer, revenue, sales, profit or ROI.
 *
 * @module api/kortex/linkInsights
 */

'use strict';

const { placementKey, placementDisplay } = require('./linkFields');

const VERSION = 2;
const DAY = 86400000;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PARTS = [
  { key: 'night', label: 'nights', from: 22, to: 6 },
  { key: 'morning', label: 'mornings', from: 6, to: 11 },
  { key: 'midday', label: 'middays', from: 11, to: 14 },
  { key: 'afternoon', label: 'afternoons', from: 14, to: 18 },
  { key: 'evening', label: 'evenings', from: 18, to: 22 }
];
const CHANNELS = [
  ['instagram', /instagram\.com|l\.instagram/], ['facebook', /facebook\.com|l\.facebook|fb\.com/], ['x', /twitter\.com|t\.co$|x\.com/],
  ['whatsapp', /whatsapp\.com|wa\.me/], ['linkedin', /linkedin\.com|lnkd\.in/], ['youtube', /youtube\.com|youtu\.be/],
  ['pinterest', /pinterest\./], ['email', /mail\.google|outlook\.|yahoo\.|mail\.|proton\./], ['google', /google\./],
  ['kaayko', /kaayko\.com/]
];
const STORE_HOSTS = /(^|\.)(apps\.apple\.com|itunes\.apple\.com|play\.google\.com)$/;

/** Every action an owner can accept from a finding; the checkpoint routes validate against this list. */
const ACTION_TYPES = Object.freeze([
  'ADD_FALLBACK', 'RAISE_CAP', 'REMOVE_CAP', 'EXTEND_END_DATE', 'REMOVE_END_DATE', 'ADD_IOS_DESTINATION',
  'ADD_ANDROID_DESTINATION', 'FIX_SCHEDULE', 'ADD_UTM', 'ADD_PLACEMENT', 'PAUSE_LINK', 'REQUEST_REVIEW'
]);

/** Findings a shared report may carry; everything else is owner-only. */
const PUBLIC_KEYS = new Set(['qrSplit', 'trend', 'bestWindow', 'placement', 'campaignLift', 'qualityScore', 'missed']);

const EXPLORE_GROUPS = Object.freeze({
  placement: ['qrSplit', 'placement', 'trend', 'bestWindow', 'rhythm', 'roi', 'campaignLift'],
  routing: ['deviceMatch', 'missed', 'fallbackUsage', 'replay'],
  audience: ['repeatPattern', 'newVsReturning', 'geoDrift'],
  campaign: ['utmHealth', 'channelMix', 'anomalies'],
  trust: ['safetyImpact', 'qualityScore']
});

const MIN = {
  early: 5, adequate: 10, timing: 30, timingDays: 3, period: 10, campaign: 10,
  identity: 10, geo: 10, geoCountry: 5, baseline: 30, baselineDays: 2, bucket: 10, quality: 10
};
const CONFIDENCE_WEIGHT = { high: 1, medium: 0.6, early: 0 };
/** Every finding is computed inside the current window, so nothing is stale. */
const RECENCY_IN_WINDOW = 1;
const NEEDS_ATTENTION_MAX = 3;
const WORKING_MAX = 2;
const CHANGE_THRESHOLD = 0.05;
const REMIND_LATER_DAYS = 7;
const EXTENSION_DAYS = 30;
const LOST_REASON_CODES = { capped: 'CAP_REACHED', expired: 'EXPIRED', paused: 'PAUSED', held: 'HELD', blocked: 'BLOCKED', workspace_off: 'WORKSPACE_OFF', churned: 'CHURNED' };
const LIMIT_WORDS = { clicks: 'the scan cap', expired: 'the end date', limit: 'the limit' };
const RHYTHM_LABELS = { lunch: 'Lunch scanners', commuter: 'Commuter traffic', evening: 'Evening browsers', lateNight: 'Late-night scanners', weekend: 'Weekend planners' };

function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
function rate(n, d) { return d ? +(n / d).toFixed(4) : null; }
function sum(xs) { return xs.reduce((a, b) => a + b, 0); }
function mean(xs) { return xs.length ? sum(xs) / xs.length : 0; }
function std(xs) { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); }
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
function partOf(hour) { return PARTS.find(p => (p.from < p.to ? hour >= p.from && hour < p.to : hour >= p.from || hour < p.to)); }
function partRange(p) { const h = x => `${String(x).padStart(2, '0')}:00`; return `${h(p.from)}–${h(p.to)}`; }
/** Host of a destination URL, without a leading www.; null when there is none or it will not parse. */
function destinationHostOf(url) { try { return url ? new URL(url).hostname.replace(/^www\./, '') : null; } catch (_) { return null; } }
function channelOf(host) { if (!host) return 'direct'; for (const [name, re] of CHANNELS) if (re.test(host)) return name; return 'other sites'; }
function tallyBy(list, keyOf) { const m = new Map(); list.forEach(e => { const k = keyOf(e); if (k) m.set(k, (m.get(k) || 0) + 1); }); return m; }
function topEntry(map) { return [...map.entries()].sort((a, b) => b[1] - a[1])[0] || null; }
function isoDaysFromNow(days, now) { return new Date(now + days * DAY).toISOString(); }
function cleanTag(value) { return value ? String(value).trim().toLowerCase().replace(/\s+/g, '-') : ''; }

/** Readers accept both event schemas: v2 `visitorKey`/`referrerHost` and v1 `ip`/`referrer`. */
function visitorOf(e) { return e.visitorKey || e.ip || null; }
function isRescued(e) { return e.outcome === 'fallback'; }

/** Time-bucketed wording for one decision: weekday and hour, never the minute. */
function fmtBucket(ms, timeZone) {
  try { return new Date(ms).toLocaleString('en-US', { timeZone, weekday: 'short', hour: 'numeric' }); } catch (_) { return new Date(ms).toISOString().slice(0, 13); }
}

/** YYYY-MM-DD of an instant in the viewer's zone, so periods are local days. */
function localDayKey(ms, timeZone) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); } catch (_) { return new Date(ms).toISOString().slice(0, 10); }
}

/** high = adequate direct sample; medium = adequate but estimated; early = 5–9 observations; null below. */
function confidenceFor(sample, { estimated = false } = {}) {
  if (sample >= MIN.adequate) return estimated ? 'medium' : 'high';
  if (sample >= MIN.early) return 'early';
  return null;
}

function action(type, label, prefill, extra = {}) { return { type, label, prefill, ...extra }; }

/** One finding with every v2 field present; the key decides its share class, early signals never leave the owner. */
function finding(key, title, window, fields) {
  const f = {
    key, version: VERSION, title, status: 'none', severity: null, confidence: null, sampleSize: 0, window,
    headline: '', detail: null, metrics: {}, reasonCodes: [], action: null, shareClass: 'owner_only',
    provenance: 'measured', insufficient: null, ...fields
  };
  if (f.status === 'none') f.confidence = null;
  if (f.status !== 'warn') f.severity = null;
  f.shareClass = PUBLIC_KEYS.has(key) && f.confidence !== 'early' ? 'public' : 'owner_only';
  return f;
}

/** A finding below its threshold: status none, the headline says what is needed. */
function notYet(key, title, window, { needed, have, note, ...fields }) {
  return finding(key, title, window, { status: 'none', sampleSize: have, headline: note, insufficient: { needed, have, note }, ...fields });
}

function severityForLoss(lost, observed) {
  if (lost >= MIN.adequate || (observed && lost / observed >= 0.25)) return 'high';
  return lost >= 3 ? 'medium' : 'low';
}

/** Local day keys of the complete days inside the window, oldest first (today is partial and excluded). */
function completeDayKeys(now, windowDays, timeZone) {
  const keys = [];
  for (let i = windowDays - 1; i >= 1; i--) keys.push(localDayKey(now - i * DAY, timeZone));
  return keys;
}

/** Scans per day inside [from, to) clipped to the window; null when the period has no length. */
function periodRate(events, from, to, windowStart, now) {
  const start = Math.max(from, windowStart), end = Math.min(to, now);
  if (end <= start) return null;
  const count = events.filter(e => e.ms >= start && e.ms < end).length;
  const span = (end - start) / DAY;
  return { count, span: +span.toFixed(2), perDay: +(count / span).toFixed(2) };
}

// ─── per-finding builders ─────────────────────────────────────────────────────

function qrSplitFinding(ctx) {
  const { events, n, window } = ctx;
  const qr = events.filter(e => e.source === 'qr').length;
  const title = 'QR scans vs link taps';
  if (!n) return notYet('qrSplit', title, window, { needed: 1, have: 0, note: 'No visits in this window yet.', detail: { qr: 0, taps: 0, qrShare: 0 } });
  return finding('qrSplit', title, window, {
    status: 'info', confidence: confidenceFor(n), sampleSize: n,
    headline: `${pct(qr, n)}% of visits were scans of the printed code; ${pct(n - qr, n)}% were taps on the link.`,
    detail: { qr, taps: n - qr, qrShare: pct(qr, n) }, metrics: { qr, taps: n - qr, qrShare: pct(qr, n) }
  });
}

function placementFinding(ctx) {
  const { link, n, window } = ctx;
  const key = placementKey(link), label = placementDisplay(link);
  return finding('placement', 'Placement', window, {
    status: key ? 'info' : 'none', sampleSize: n, provenance: 'assumption',
    headline: key ? `Placement: ${label}. Compare placements in the workspace overview.` : 'Give this link a placement (poster, menu, badge…) to compare surfaces across links.',
    detail: { placement: key, label }, metrics: { placement: key, label },
    reasonCodes: key ? [] : ['NO_PLACEMENT'],
    action: key ? null : action('ADD_PLACEMENT', 'Add a placement', { placement: 'poster' })
  });
}

function trendFinding(ctx) {
  const { dayCounts, completeDays, window } = ctx;
  const title = 'Placement fatigue';
  const series = completeDays.map(k => dayCounts.get(k) || 0);
  const half = Math.floor(series.length / 2);
  const earlyCount = sum(series.slice(0, half)), lateCount = sum(series.slice(series.length - half));
  if (!half || earlyCount < MIN.period || lateCount < MIN.period) {
    return notYet('trend', title, window, { needed: MIN.period, have: Math.min(earlyCount, lateCount), note: `Needs two complete ${half || 1}-day periods with at least ${MIN.period} useful visits each to read a trend.`, metrics: { earlyCount, lateCount, periodDays: half } });
  }
  const early = earlyCount / half, late = lateCount / half;
  const change = Math.round(((late - early) / early) * 100);
  const label = change >= 15 ? 'gaining' : change <= -15 ? 'declining' : 'flat';
  const headline = label === 'gaining' ? `Gaining: recent days average ${late.toFixed(1)} scans against ${early.toFixed(1)} at the start (+${change}%).`
    : label === 'declining' ? `Fading: recent days average ${late.toFixed(1)} scans against ${early.toFixed(1)} at the start (${change}%). Time to move or refresh this placement.`
      : `Steady: about ${late.toFixed(1)} scans a day, unchanged across the window.`;
  return finding('trend', title, window, {
    status: label === 'declining' ? 'warn' : label === 'gaining' ? 'good' : 'info', severity: 'medium', confidence: 'high', sampleSize: earlyCount + lateCount, provenance: 'derived', headline,
    detail: { label, change, early: +early.toFixed(2), late: +late.toFixed(2), periodDays: half },
    metrics: { early: +early.toFixed(2), late: +late.toFixed(2), change, earlyCount, lateCount, periodDays: half, affected: label === 'declining' ? earlyCount - lateCount : 0 },
    reasonCodes: label === 'declining' ? ['PLACEMENT_FADING'] : []
  });
}

function timingGate(key, title, ctx) {
  const { n, activeDays, window } = ctx;
  if (n < MIN.timing) return notYet(key, title, window, { needed: MIN.timing, have: n, note: `Needs ${MIN.timing} useful visits across at least ${MIN.timingDays} active days; ${n} so far.` });
  if (activeDays < MIN.timingDays) return notYet(key, title, window, { needed: MIN.timingDays, have: activeDays, note: `Needs scans on at least ${MIN.timingDays} different days; ${plural(activeDays, 'day')} so far.` });
  return null;
}

function bestWindowFinding(ctx) {
  const { events, n, activeDays, timeZone, window } = ctx;
  const title = 'Best time to place or share';
  const gated = timingGate('bestWindow', title, ctx);
  if (gated) return gated;
  const cells = tallyBy(events, e => `${e.dow}|${partOf(e.hour).key}`);
  const [cell, scans] = topEntry(cells);
  const [dow, partKey] = cell.split('|');
  const part = PARTS.find(p => p.key === partKey);
  return finding('bestWindow', title, window, {
    status: 'good', confidence: 'high', sampleSize: n, provenance: 'derived',
    headline: `${DAYS[Number(dow)]} ${part.label} (${partRange(part)}) perform best: ${pct(scans, n)}% of all scans (${timeZone}).`,
    detail: { dow: Number(dow), part: partKey, scans, share: pct(scans, n), timeZone },
    metrics: { dow: Number(dow), part: partKey, from: part.from, to: part.to, scans, share: pct(scans, n), activeDays }
  });
}

function rhythmFinding(ctx) {
  const { events, n, window } = ctx;
  const title = 'Audience rhythm';
  const gated = timingGate('rhythm', title, ctx);
  if (gated) return gated;
  const weekday = events.filter(e => e.dow >= 1 && e.dow <= 5);
  const shares = {
    lunch: pct(weekday.filter(e => e.hour >= 11 && e.hour < 14).length, weekday.length),
    commuter: pct(weekday.filter(e => (e.hour >= 7 && e.hour < 9) || (e.hour >= 17 && e.hour < 19)).length, weekday.length),
    evening: pct(events.filter(e => e.hour >= 18 && e.hour < 23).length, n),
    lateNight: pct(events.filter(e => e.hour >= 23 || e.hour < 5).length, n),
    weekend: pct(events.filter(e => e.dow === 0 || e.dow === 6).length, n)
  };
  const [dominant, share] = topEntry(new Map(Object.entries(shares)));
  return finding('rhythm', title, window, {
    status: 'info', confidence: 'high', sampleSize: n, provenance: 'derived',
    headline: `${RHYTHM_LABELS[dominant]}: ${share}% of scans fit that pattern (weekend ${shares.weekend}%, evenings ${shares.evening}%, late nights ${shares.lateNight}%).`,
    detail: { dominant, shares }, metrics: { dominant, share, ...shares }
  });
}

function missedFinding(ctx) {
  const { missedBy, lost, observed, hasFallback, windowDays, link, window } = ctx;
  const title = 'Missed opportunities';
  if (!observed) return notYet('missed', title, window, { needed: 1, have: 0, note: 'No scans in this window yet.', detail: { total: 0, byOutcome: {}, withoutFallback: 0 } });
  const withoutFallback = hasFallback ? 0 : (missedBy.expired || 0) + (missedBy.capped || 0);
  const heldBlocked = (missedBy.held || 0) + (missedBy.blocked || 0);
  const recoverable = withoutFallback + (missedBy.paused || 0);
  const reasonCodes = Object.keys(missedBy).map(o => LOST_REASON_CODES[o] || o.toUpperCase());
  if (withoutFallback) reasonCodes.push('NO_FALLBACK');
  const fix = withoutFallback ? action('ADD_FALLBACK', 'Add a fallback', { limits: { fallbackUrl: '' } })
    : heldBlocked ? action('REQUEST_REVIEW', 'Request a review', {}, { href: `/kortex/appeal?code=${link.code || ''}` }) : null;
  const list = Object.entries(missedBy).map(([k, v]) => `${v} ${k}`).join(', ');
  return finding('missed', title, window, {
    status: !lost ? 'good' : recoverable || heldBlocked ? 'warn' : 'info', severity: severityForLoss(lost, observed), confidence: confidenceFor(observed), sampleSize: observed,
    headline: lost ? `${plural(lost, 'scan')} reached nothing in the last ${windowDays} days: ${list}.${withoutFallback ? ' Add a fallback address so a finished campaign still sends people somewhere.' : ''}` : 'Every scan in this window reached a page.',
    detail: { total: lost, byOutcome: missedBy, withoutFallback },
    metrics: { lost, observed, lostRate: rate(lost, observed), recoverable, affected: lost, byOutcome: missedBy },
    reasonCodes, action: fix
  });
}

function fallbackUsageFinding(ctx) {
  const { events, rescued, n, link, window } = ctx;
  const title = 'Fallback usage';
  const byReason = Object.fromEntries(tallyBy(rescued, e => e.reason || 'limit'));
  const night = events.filter(e => e.window).length;
  const reasonWords = Object.entries(byReason).map(([k, v]) => `${v} after ${LIMIT_WORDS[k] || k}`).join(', ');
  const dominant = topEntry(tallyBy(rescued, e => e.reason || 'limit'));
  const lift = dominant && dominant[0] === 'expired' ? action('REMOVE_END_DATE', 'Remove the end date', { expiresAt: null })
    : dominant ? action('REMOVE_CAP', 'Remove the cap', { limits: null }) : null;
  const scheduleIdle = !!link.schedule && !night && n >= MIN.adequate;
  const base = { confidence: confidenceFor(n), sampleSize: n, detail: { fallbacks: rescued.length, byReason, nightWindow: night, nightShare: pct(night, n) }, metrics: { rescued: rescued.length, byReason, nightWindow: night, nightShare: pct(night, n), affected: rescued.length } };
  if (rescued.length) {
    return finding('fallbackUsage', title, window, { ...base, status: 'good', headline: `${plural(rescued.length, 'visit')} went to the fallback address (${reasonWords}); ${night} took the night window. If the campaign is still running, lift the limit.`, reasonCodes: ['FALLBACK_RESCUED'], action: lift });
  }
  if (night) return finding('fallbackUsage', title, window, { ...base, status: 'info', headline: `${plural(night, 'visit')} took the night window; nothing needed the fallback address.` });
  if (scheduleIdle) return finding('fallbackUsage', title, window, { ...base, status: 'info', headline: `The schedule window never matched in ${n} visits; check its hours.`, reasonCodes: ['SCHEDULE_IDLE'], action: action('FIX_SCHEDULE', 'Check the schedule', { schedule: link.schedule }) });
  return finding('fallbackUsage', title, window, { ...base, status: 'none', headline: 'No fallback or night-window redirects in this window.' });
}

function deviceMatchFinding(ctx) {
  const { events, n, destinations: d, window } = ctx;
  const title = 'Device match quality';
  const plat = { ios: 0, android: 0, web: 0 };
  events.forEach(e => { plat[e.platform] = (plat[e.platform] || 0) + 1; });
  const shares = { ios: pct(plat.ios, n), android: pct(plat.android, n), web: pct(plat.web, n) };
  const appLike = !!(d.ios || d.android) || STORE_HOSTS.test(destinationHostOf(d.web) || '');
  const flags = [];
  if (n && appLike && shares.ios >= 20 && !d.ios) flags.push({ code: 'NO_IOS_DESTINATION', count: plat.ios, text: `${shares.ios}% of visitors are on iPhone but there is no iPhone destination; they land on the web address.`, fix: action('ADD_IOS_DESTINATION', 'Add an iPhone destination', { iosDestination: '' }) });
  if (n && appLike && shares.android >= 20 && !d.android) flags.push({ code: 'NO_ANDROID_DESTINATION', count: plat.android, text: `${shares.android}% are on Android with no Android destination.`, fix: action('ADD_ANDROID_DESTINATION', 'Add an Android destination', { androidDestination: '' }) });
  flags.sort((a, b) => b.count - a.count);
  const fit = n ? Math.round(100 - flags.length * 30) : null;
  const base = { sampleSize: n, provenance: 'heuristic', detail: { shares, hasIos: !!d.ios, hasAndroid: !!d.android, fit }, metrics: { ...shares, fit, affected: sum(flags.map(f => f.count)) } };
  if (!n) return finding('deviceMatch', title, window, { ...base, status: 'none', headline: 'No visits yet.', insufficient: { needed: 1, have: 0, note: 'No visits yet.' } });
  if (flags.length) return finding('deviceMatch', title, window, { ...base, status: 'warn', severity: 'medium', confidence: confidenceFor(n), headline: flags.map(f => f.text).join(' '), reasonCodes: flags.map(f => f.code), action: flags[0].fix });
  if (d.ios || d.android) return finding('deviceMatch', title, window, { ...base, status: 'good', confidence: confidenceFor(n), headline: `Every platform has its own destination: iPhone ${shares.ios}%, Android ${shares.android}%, web ${shares.web}%.` });
  return finding('deviceMatch', title, window, { ...base, status: 'info', confidence: confidenceFor(n), headline: `Everyone lands on the web address (iPhone ${shares.ios}%, Android ${shares.android}%). Add store links if the destination is an app.` });
}

function replayFinding(ctx) {
  const { events, undelivered, destinations: d, timeZone, window } = ctx;
  const all = [...events.map(e => ({ ...e, delivered: true })), ...undelivered.map(e => ({ ...e, delivered: false }))].sort((a, b) => b.ms - a.ms).slice(0, 8);
  const sentence = e => {
    const who = `${e.platform === 'ios' ? 'iPhone' : e.platform === 'android' ? 'Android' : 'Desktop'} ${e.source === 'qr' ? 'scan' : 'tap'} around ${fmtBucket(e.ms, timeZone)}${e.country ? ` from ${e.country}` : ''}`;
    if (!e.delivered) return `${who} found the link ${e.outcome === 'capped' ? 'over its scan cap' : e.outcome === 'expired' ? 'past its end date' : e.outcome}: nothing was shown.`;
    if (isRescued(e)) return `${who} arrived after ${LIMIT_WORDS[e.reason] || LIMIT_WORDS.limit} and went to the fallback address.`;
    if (e.window) return `${who} matched the ${e.window} window and went to ${destinationHostOf(e.redirectedTo) || 'the night address'}.`;
    if (e.platform === 'ios' && d.ios) return `${who} went to the iPhone destination.`;
    if (e.platform === 'android' && d.android) return `${who} went to the Android destination.`;
    return `${who} went to ${destinationHostOf(e.redirectedTo) || 'the main address'}.`;
  };
  return finding('replay', 'Routing decision replay', window, {
    status: all.length ? 'info' : 'none', sampleSize: all.length,
    headline: all.length ? `${all.length} most recent decisions, in plain words.` : 'No visits yet.',
    detail: { lines: all.map(sentence) }, metrics: { decisions: all.length }
  });
}

function identityFindings(ctx) {
  const { events, unique, window } = ctx;
  const keyed = events.filter(visitorOf).sort((a, b) => a.ms - b.ms);
  const perVisitor = new Map(), firstSeen = new Map();
  keyed.forEach(e => { const k = visitorOf(e); perVisitor.set(k, (perVisitor.get(k) || 0) + 1); if (!firstSeen.has(k)) firstSeen.set(k, e.ms); });
  const counts = [...perVisitor.values()];
  const people = counts.length;
  const topVisitor = people ? Math.max(...counts) : 0;
  const coveragePct = unique && Number.isFinite(unique.coveragePct) ? unique.coveragePct : null;
  const gate = (key, title) => notYet(key, title, window, { needed: MIN.identity, have: people, note: `Needs ${MIN.identity} covered visitors to describe who comes back; ${people} so far.`, provenance: 'estimated', metrics: { people, coveragePct } });
  if (people < MIN.identity) return { repeatPattern: gate('repeatPattern', 'Repeat scanner pattern'), newVsReturning: gate('newVsReturning', 'First-time vs returning'), topVisitor };
  const hist = { once: counts.filter(c => c === 1).length, twice: counts.filter(c => c === 2).length, more: counts.filter(c => c >= 3).length };
  const heavy = hist.more > people * 0.3;
  const repeatPattern = finding('repeatPattern', 'Repeat scanner pattern', window, {
    status: heavy ? 'warn' : 'info', severity: 'low', confidence: 'medium', sampleSize: people, provenance: 'estimated',
    headline: `${hist.once} people scanned once, ${hist.twice} twice, ${hist.more} three or more times.${heavy ? ' Many repeats can mean interest, or a destination that did not answer the question.' : ''}`,
    detail: { ...hist, people, topVisitorScans: topVisitor }, metrics: { ...hist, people, topVisitorScans: topVisitor, coveragePct, affected: heavy ? hist.more : 0 },
    reasonCodes: heavy ? ['HEAVY_REPEATS'] : []
  });
  const returning = keyed.filter(e => firstSeen.get(visitorOf(e)) < e.ms).length;
  const newVsReturning = finding('newVsReturning', 'First-time vs returning', window, {
    status: 'info', confidence: 'medium', sampleSize: keyed.length, provenance: 'estimated',
    headline: `${pct(keyed.length - returning, keyed.length)}% of visits were someone's first in this window; ${pct(returning, keyed.length)}% were people coming back.`,
    detail: { firstTime: keyed.length - returning, returning, share: pct(returning, keyed.length) },
    metrics: { firstTime: keyed.length - returning, returning, returningShare: pct(returning, keyed.length), people, coveragePct }
  });
  return { repeatPattern, newVsReturning, topVisitor };
}

function campaignLiftFinding(ctx) {
  const { events, link, windowStart, now, window } = ctx;
  const title = 'Campaign lift';
  const cw = link.campaignWindow;
  if (!cw || !(cw.startAt || cw.endAt)) return finding('campaignLift', title, window, { status: 'none', headline: 'Set a campaign window on this link to compare before, during and after.', reasonCodes: ['NO_CAMPAIGN_WINDOW'], provenance: 'derived' });
  const s = cw.startAt ? new Date(cw.startAt).getTime() : windowStart, t = cw.endAt ? new Date(cw.endAt).getTime() : now;
  const before = periodRate(events, windowStart, s, windowStart, now), during = periodRate(events, s, t, windowStart, now), after = t < now ? periodRate(events, t, now, windowStart, now) : null;
  const detail = { before: before ? before.perDay : null, during: during ? during.perDay : null, after: after ? after.perDay : null, lift: null };
  const metrics = { beforePerDay: detail.before, duringPerDay: detail.during, afterPerDay: detail.after, beforeCount: before ? before.count : 0, duringCount: during ? during.count : 0, afterCount: after ? after.count : 0, lift: null };
  if (!before) return notYet('campaignLift', title, window, { needed: MIN.campaign, have: 0, note: 'The campaign started before this window, so there is no before period to compare against yet.', detail, metrics, provenance: 'derived' });
  if (!during || before.count < MIN.campaign || during.count < MIN.campaign) return notYet('campaignLift', title, window, { needed: MIN.campaign, have: Math.min(before.count, during ? during.count : 0), note: `Needs at least ${MIN.campaign} scans before the campaign and ${MIN.campaign} during it to measure lift.`, detail, metrics, provenance: 'derived' });
  const lift = Math.round(((during.perDay - before.perDay) / before.perDay) * 100);
  return finding('campaignLift', title, window, {
    status: lift > 0 ? 'good' : 'warn', severity: 'low', confidence: 'high', sampleSize: before.count + during.count, provenance: 'derived',
    headline: `${during.perDay} scans a day during the campaign against ${before.perDay} before (${lift > 0 ? '+' : ''}${lift}%)${after ? `, ${after.perDay} a day since it ended` : ''}.`,
    detail: { ...detail, lift }, metrics: { ...metrics, lift, affected: lift > 0 ? 0 : during.count }, reasonCodes: lift > 0 ? [] : ['NO_LIFT']
  });
}

function paybackFinding(ctx) {
  const { link, n, observed, window } = ctx;
  const title = 'Estimated print payback';
  const eco = link.economics;
  const has = v => v !== null && v !== undefined;
  if (!eco || (!has(eco.printCost) && !has(eco.valuePerVisit))) {
    return finding('roi', title, window, { status: 'none', headline: 'Add the print cost and a value per useful visit to see cost per scan and the estimated print payback.', detail: { usefulVisits: n }, metrics: { usefulVisits: n }, reasonCodes: ['NO_ECONOMICS'], provenance: 'assumption' });
  }
  const cur = eco.currency || 'USD';
  const costPerScan = has(eco.printCost) && observed ? +(eco.printCost / observed).toFixed(2) : null;
  const costPerUseful = has(eco.printCost) && n ? +(eco.printCost / n).toFixed(2) : null;
  const value = has(eco.valuePerVisit) ? +(n * eco.valuePerVisit).toFixed(2) : null;
  const payback = has(eco.printCost) && eco.valuePerVisit ? Math.ceil(eco.printCost / eco.valuePerVisit) : null;
  const parts = [];
  if (costPerScan !== null) parts.push(`${cur} ${costPerScan} per scan, ${cur} ${costPerUseful} per useful visit`);
  if (value !== null) parts.push(`${plural(n, 'useful visit')} carry an estimated visit value of ${cur} ${value}`);
  if (payback !== null) parts.push(`estimated print payback at ${plural(payback, 'useful visit')}${n >= payback ? ' (reached)' : ''}`);
  return finding('roi', title, window, {
    status: value !== null && has(eco.printCost) && value >= eco.printCost ? 'good' : 'info', confidence: confidenceFor(n, { estimated: true }), sampleSize: n, provenance: 'assumption',
    headline: `${parts.join('; ')}.`,
    detail: { costPerScan, costPerUsefulVisit: costPerUseful, value, breakevenScans: payback, usefulVisits: n, currency: cur },
    metrics: { costPerScan, costPerUsefulVisit: costPerUseful, estimatedVisitValue: value, paybackVisits: payback, usefulVisits: n, printCost: has(eco.printCost) ? eco.printCost : null, valuePerVisit: has(eco.valuePerVisit) ? eco.valuePerVisit : null, currency: cur }
  });
}

function geoDriftFinding(ctx) {
  const { events, window } = ctx;
  const title = 'Geo heat and drift';
  const located = events.filter(e => e.country);
  const total = located.length;
  if (total < MIN.geo) return notYet('geoDrift', title, window, { needed: MIN.geo, have: total, note: `Needs ${MIN.geo} located scans to map countries; ${total} so far.` });
  const shown = new Set([...tallyBy(located, e => e.country).entries()].filter(([, c]) => c >= MIN.geoCountry).map(([c]) => c));
  const bucket = e => (shown.has(e.country) ? e.country : 'other');
  const half = located[Math.floor(total / 2)].ms;
  const first = tallyBy(located.filter(e => e.ms < half), bucket), second = tallyBy(located.filter(e => e.ms >= half), bucket);
  const firstTotal = sum([...first.values()]), secondTotal = sum([...second.values()]);
  const movers = [...shown].map(c => ({ country: c, before: pct(first.get(c) || 0, firstTotal), after: pct(second.get(c) || 0, secondTotal) }))
    .map(m => ({ ...m, change: m.after - m.before })).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const top = topEntry(tallyBy(located, bucket));
  const mover = movers[0] && Math.abs(movers[0].change) >= 15 ? movers[0] : null;
  return finding('geoDrift', title, window, {
    status: mover ? 'warn' : 'info', severity: 'low', confidence: confidenceFor(total), sampleSize: total,
    headline: `${top[0]} leads with ${pct(top[1], total)}% of scans.${mover ? ` ${mover.country} moved from ${mover.before}% to ${mover.after}% across the window.` : ' The mix is steady across the window.'}`,
    detail: { top: { country: top[0], share: pct(top[1], total) }, movers: movers.slice(0, 5) },
    metrics: { top: top[0], topShare: pct(top[1], total), located: total, shownCountries: shown.size, affected: mover ? second.get(mover.country) || 0 : 0 },
    reasonCodes: mover ? ['GEO_SHIFT'] : []
  });
}

function channelMixFinding(ctx) {
  const { events, n, window } = ctx;
  const title = 'Referrer and channel mix';
  if (!n) return notYet('channelMix', title, window, { needed: 1, have: 0, note: 'No visits yet.', detail: { channels: [] } });
  const mix = tallyBy(events, e => (e.source === 'qr' ? 'qr (offline)' : channelOf(e.referrerHost)));
  const channels = [...mix.entries()].map(([channel, count]) => ({ channel, count, share: pct(count, n) })).sort((a, b) => b.count - a.count);
  return finding('channelMix', title, window, {
    status: 'info', confidence: confidenceFor(n), sampleSize: n,
    headline: channels.slice(0, 3).map(c => `${c.channel} ${c.share}%`).join(' · ') + '.',
    detail: { channels }, metrics: { channels: channels.length, top: channels[0].channel, topShare: channels[0].share }
  });
}

function utmHealthFinding(ctx) {
  const { link, destinations: d, n, window } = ctx;
  const utm = link.utm || {};
  const keys = Object.keys(utm);
  const issues = [];
  keys.forEach(k => { const v = String(utm[k]); if (/[A-Z]/.test(v)) issues.push(`${k.replace('utm_', '')} "${v}" mixes case; analytics tools treat "Poster" and "poster" as different sources.`); if (/\s/.test(v)) issues.push(`${k.replace('utm_', '')} "${v}" contains spaces.`); });
  try { const dest = new URL(d.web || ''); ['utm_source', 'utm_medium', 'utm_campaign'].forEach(k => { const dv = dest.searchParams.get(k); if (dv && utm[k] && dv !== utm[k]) issues.push(`The address already carries ${k.replace('utm_', '')}="${dv}", which wins over the link's "${utm[k]}".`); }); } catch (_) { /* no web address: nothing to cross-check */ }
  const prefill = { utm: { utm_source: cleanTag(utm.utm_source) || placementKey(link) || 'qr', utm_medium: cleanTag(utm.utm_medium) || 'qr', utm_campaign: cleanTag(utm.utm_campaign) } };
  // Tags are configuration, read directly: confidence does not depend on how many visits arrived.
  const base = { sampleSize: n, confidence: 'high', detail: { tags: utm, issues }, metrics: { tags: keys.length, issues: issues.length, affected: 0 } };
  if (!keys.length) return finding('utmHealth', 'UTM health', window, { ...base, status: 'info', headline: 'No campaign tags on this link; the destination will not know these visits came from it.', reasonCodes: ['NO_TAGS'], action: action('ADD_UTM', 'Add campaign tags', prefill) });
  if (issues.length) return finding('utmHealth', 'UTM health', window, { ...base, status: 'warn', severity: 'low', headline: issues.join(' '), reasonCodes: ['TAGS_MESSY'], action: action('ADD_UTM', 'Clean up the tags', prefill) });
  return finding('utmHealth', 'UTM health', window, { ...base, status: 'good', headline: `Tags are present and clean: ${keys.map(k => `${k.replace('utm_', '')}=${utm[k]}`).join(', ')}.` });
}

function safetyImpactFinding(ctx) {
  const { link, missedBy, observed, window } = ctx;
  const heldBlocked = (missedBy.held || 0) + (missedBy.blocked || 0);
  const status = link.status === 'held' || link.status === 'blocked' ? link.status : 'active';
  const reviewed = !!(link.safety && link.safety.review);
  const base = { sampleSize: observed, confidence: 'high', detail: { status: link.status || 'active', scansAffected: heldBlocked, reviewed }, metrics: { status: link.status || 'active', scansAffected: heldBlocked, reviewed, affected: heldBlocked } };
  if (status === 'active') return finding('safetyImpact', 'Safety and trust', window, { ...base, status: 'good', headline: `Live and checked${reviewed ? ', released by a reviewer after a hold' : ''}.${heldBlocked ? ` ${plural(heldBlocked, 'scan')} hit it while it was held or blocked.` : ''}` });
  return finding('safetyImpact', 'Safety and trust', window, {
    ...base, status: 'warn', severity: 'high',
    headline: `${status === 'held' ? 'Held for review' : 'Blocked'}: ${plural(heldBlocked, 'scan')} saw the ${status} page.`,
    reasonCodes: [status.toUpperCase()], action: action('REQUEST_REVIEW', 'Request a review', {}, { href: `/kortex/appeal?code=${link.code || ''}` })
  });
}

function anomaliesFinding(ctx, { topVisitor, lateNightShare }) {
  const { events, dayCounts, completeDays, todayKey, missedBy, link, observed, now, window } = ctx;
  const title = 'Anomaly alerts';
  const series = completeDays.map(k => dayCounts.get(k) || 0);
  const baseline = sum(series), baselineDays = series.filter(c => c > 0).length;
  const today = dayCounts.get(todayKey) || 0;
  const spikeReady = baseline >= MIN.baseline && baselineDays >= MIN.baselineDays && today >= MIN.bucket;
  const items = [];
  if (spikeReady) {
    const m = mean(series), s = std(series);
    if (today > m + 3 * s && today > m * 2) items.push({ kind: 'spike', count: today, text: `Scan spike: ${today} today against a typical ${m.toFixed(1)}.` });
    const recent = events.filter(e => e.ms > now - 2 * DAY), lateRecent = recent.filter(e => e.hour >= 23 || e.hour < 5).length;
    if (recent.length >= MIN.bucket && pct(lateRecent, recent.length) > Math.max(25, lateNightShare * 2)) items.push({ kind: 'afterHours', count: lateRecent, text: `After-hours surge: ${pct(lateRecent, recent.length)}% of the last two days' scans came between 23:00 and 05:00.` });
  }
  if (topVisitor >= MIN.adequate) items.push({ kind: 'repeats', count: topVisitor, text: `One visitor scanned ${topVisitor} times; check whether the destination is failing for them.` });
  if (missedBy.expired) items.push({ kind: 'expiredScanned', count: missedBy.expired, text: `A printed code past its end date is still being scanned (${missedBy.expired} times). Extend the date or add a fallback.` });
  if (missedBy.capped) items.push({ kind: 'cappedScanned', count: missedBy.capped, text: `${missedBy.capped} scans arrived after the cap. Raise it or add a fallback.` });
  const kinds = new Set(items.map(i => i.kind));
  const maxClicks = link.limits && Number(link.limits.maxClicks);
  const fix = kinds.has('cappedScanned') ? (maxClicks ? action('RAISE_CAP', 'Raise the cap', { limits: { maxClicks: maxClicks * 2 } }) : action('REMOVE_CAP', 'Remove the cap', { limits: null }))
    : kinds.has('expiredScanned') ? action('EXTEND_END_DATE', 'Extend the end date', { expiresAt: isoDaysFromNow(EXTENSION_DAYS, now) })
      : items.length ? action('PAUSE_LINK', 'Pause the link', { enabled: false }) : null;
  const reasonCodes = items.map(i => (i.kind === 'cappedScanned' ? 'CAP_REACHED' : i.kind === 'expiredScanned' ? 'EXPIRED' : i.kind.replace(/([A-Z])/g, '_$1').toUpperCase()));
  const base = { sampleSize: observed, detail: { items, spikeDetection: spikeReady }, metrics: { baseline, baselineDays, today, spikeDetection: spikeReady, affected: sum(items.map(i => i.count)) }, provenance: 'heuristic' };
  if (items.length) return finding('anomalies', title, window, { ...base, status: 'warn', severity: kinds.has('cappedScanned') || kinds.has('expiredScanned') ? 'medium' : 'low', confidence: confidenceFor(observed), headline: items.map(i => i.text).join(' '), reasonCodes, action: fix });
  if (spikeReady) return finding('anomalies', title, window, { ...base, status: 'good', confidence: 'high', headline: 'Nothing unusual in this window.' });
  return notYet('anomalies', title, window, { needed: MIN.baseline, have: baseline, note: `Spike detection needs ${MIN.baseline} scans over several complete days and ${MIN.bucket} today; ${baseline} so far.`, ...base });
}

function qualityScoreFinding(ctx, { fit, flags, rescuedCount }) {
  const { n, observed, link, unique, window } = ctx;
  const title = 'Scan quality score';
  if (observed < MIN.quality) return notYet('qualityScore', title, window, { needed: MIN.quality, have: observed, note: `Needs ${MIN.quality} scans to score; ${observed} so far.`, provenance: 'heuristic' });
  const usefulShare = n / observed;
  const reasons = [];
  const components = {};
  components.useful = Math.round(usefulShare * 40); if (usefulShare < 0.9) reasons.push(`${pct(observed - n, observed)}% of scans did not reach the intended page`);
  components.devices = fit === null ? 20 : Math.round((fit / 100) * 20); if (flags) reasons.push('device destinations are missing');
  const cpv = unique && unique.clicksPerVisitor ? unique.clicksPerVisitor : null;
  components.repeats = cpv === null ? 12 : cpv <= 2 ? 15 : cpv <= 3 ? 10 : 5; if (cpv !== null && cpv > 3) reasons.push('people scan many times each');
  components.trust = link.status === 'blocked' ? 0 : link.status === 'held' ? 5 : 15; if (link.status && link.status !== 'active') reasons.push(`the link is ${link.status}`);
  components.rescue = rescuedCount && n ? Math.round((1 - rescuedCount / n) * 10) : 10;
  const score = Math.max(0, Math.min(100, sum(Object.values(components))));
  return finding('qualityScore', title, window, {
    status: score >= 75 ? 'good' : score >= 50 ? 'info' : 'warn', severity: 'high', confidence: 'medium', sampleSize: observed, provenance: 'heuristic',
    headline: `${score} / 100: ${score >= 75 ? 'this is working' : score >= 50 ? 'working, with something to fix' : 'not working as intended'}${reasons.length ? ` (${reasons.join('; ')})` : ''}.`,
    detail: { score, reasons }, metrics: { score, usefulRate: rate(n, observed), components, affected: observed - n }
  });
}

/**
 * A dismissed recommendation stops alerting: the finding carrying that action
 * drops from warn to info (for `remind_later`, only for a week).
 */
function applyCheckpoint(out, checkpoint, now) {
  if (!checkpoint || !checkpoint.dismissed) return out;
  if (checkpoint.dismissed === 'remind_later' && now - (checkpoint.atMs || 0) > REMIND_LATER_DAYS * DAY) return out;
  Object.values(out).forEach(f => {
    if (f.status === 'warn' && f.action && f.action.type === checkpoint.type) {
      f.status = 'info'; f.severity = null; f.reasonCodes = [...f.reasonCodes, 'DISMISSED'];
    }
  });
  return out;
}

/**
 * @param {object} p
 * @param {object} p.link         short_links document (destinations, schedule, limits, expiresAt, utm, placement, economics, campaignWindow, status, code)
 * @param {Array}  p.events       useful visits, already normalised by linkAnalytics: { ms, platform, country, visitorKey|ip, referrerHost, source, window, outcome, reason, redirectedTo, hour, dow }
 * @param {Array}  p.undelivered  lost scans: { ms, outcome, platform, country, hour, dow }
 * @param {number} p.windowDays
 * @param {string} p.timeZone
 * @param {object} [p.unique]     { distinctVisitors, clicksPerVisitor, coveragePct } from the analytics module
 * @param {object} [p.checkpoint] the link's last recorded action, see actionRoutes
 */
function computeInsights({ link = {}, events = [], undelivered = [], windowDays = 7, timeZone = 'UTC', unique = null, checkpoint = null }) {
  const now = Date.now();
  const n = events.length;
  const rescued = events.filter(isRescued);
  const missedBy = Object.fromEntries(tallyBy(undelivered, e => e.outcome));
  const dayCounts = tallyBy(events, e => localDayKey(e.ms, timeZone));
  const ctx = {
    link, events, undelivered, unique, windowDays, timeZone, now, n, rescued, missedBy,
    lost: undelivered.length, observed: n + undelivered.length,
    destinations: link.destinations || {}, hasFallback: !!(link.limits && link.limits.fallbackUrl),
    dayCounts, activeDays: dayCounts.size, completeDays: completeDayKeys(now, windowDays, timeZone), todayKey: localDayKey(now, timeZone),
    windowStart: now - windowDays * DAY, window: { days: windowDays, timeZone }
  };
  const out = {};
  out.qrSplit = qrSplitFinding(ctx);
  out.placement = placementFinding(ctx);
  out.trend = trendFinding(ctx);
  out.bestWindow = bestWindowFinding(ctx);
  out.rhythm = rhythmFinding(ctx);
  out.missed = missedFinding(ctx);
  out.fallbackUsage = fallbackUsageFinding(ctx);
  out.deviceMatch = deviceMatchFinding(ctx);
  out.replay = replayFinding(ctx);
  const identity = identityFindings(ctx);
  out.repeatPattern = identity.repeatPattern;
  out.newVsReturning = identity.newVsReturning;
  out.campaignLift = campaignLiftFinding(ctx);
  out.roi = paybackFinding(ctx);
  out.geoDrift = geoDriftFinding(ctx);
  out.channelMix = channelMixFinding(ctx);
  out.utmHealth = utmHealthFinding(ctx);
  out.safetyImpact = safetyImpactFinding(ctx);
  out.anomalies = anomaliesFinding(ctx, { topVisitor: identity.topVisitor, lateNightShare: out.rhythm.metrics.lateNight || 0 });
  out.qualityScore = qualityScoreFinding(ctx, { fit: out.deviceMatch.metrics.fit, flags: out.deviceMatch.reasonCodes.length, rescuedCount: rescued.length });
  return applyCheckpoint(out, checkpoint, now);
}

// ─── Action Center ranking ────────────────────────────────────────────────────

/** priority = impact × confidence weight × recoverability × recency; impact is the scans the finding concerns. */
function priorityOf(f) {
  const impact = f.metrics && Number.isFinite(f.metrics.affected) ? f.metrics.affected : f.sampleSize;
  const recoverability = f.action ? 1 : 0.5;
  return impact * (CONFIDENCE_WEIGHT[f.confidence] || 0) * recoverability * RECENCY_IN_WINDOW;
}

function bySampleSize(a, b) { return b.sampleSize - a.sampleSize || a.key.localeCompare(b.key); }
function byPriority(a, b) { return priorityOf(b) - priorityOf(a) || bySampleSize(a, b); }

function totalsSince(atMs, events, undelivered) {
  const useful = events.filter(e => e.ms >= atMs).length, lost = undelivered.filter(e => e.ms >= atMs).length;
  return { observed: useful + lost, usefulRate: rate(useful, useful + lost) };
}

/**
 * Outcomes since the checkpoint: from the events when the caller passes them,
 * else from the window totals when the whole window post-dates the change.
 */
function afterTotals(checkpoint, { totals, events, undelivered }, now) {
  if (events.length || undelivered.length) return totalsSince(checkpoint.atMs, events, undelivered);
  const windowDays = checkpoint.baseline && Number(checkpoint.baseline.windowDays);
  if (totals && windowDays && now - checkpoint.atMs >= windowDays * DAY) return { observed: totals.observed || 0, usefulRate: totals.usefulRate ?? null };
  return { observed: 0, usefulRate: null };
}

/** { state: pending|improved|unchanged|regressed, type, atMs, before, after } for an applied checkpoint; null otherwise. */
function sinceLastChange(checkpoint, sources, now) {
  if (!checkpoint || checkpoint.applied !== true || !Number.isFinite(checkpoint.atMs)) return null;
  const baseline = checkpoint.baseline || {};
  const before = { usefulRate: baseline.usefulRate ?? null, observed: baseline.observed || 0 };
  const after = afterTotals(checkpoint, sources, now);
  let state = 'pending';
  if (after.observed >= MIN.adequate && now - checkpoint.atMs >= DAY && after.usefulRate !== null) {
    const delta = after.usefulRate - (before.usefulRate || 0);
    state = delta >= CHANGE_THRESHOLD ? 'improved' : delta <= -CHANGE_THRESHOLD ? 'regressed' : 'unchanged';
  }
  return { state, type: checkpoint.type, atMs: checkpoint.atMs, before, after };
}

/**
 * @param {object} insights  computeInsights output
 * @param {object} [opts]    { checkpoint, totals, events, undelivered } — events/undelivered are the arrays given to computeInsights; with them `after` covers only the time since the change
 */
function rankFindings(insights, { checkpoint = null, totals = null, events = [], undelivered = [] } = {}) {
  const now = Date.now();
  const list = Object.values(insights || {}).filter(f => f && f.key);
  const present = new Set(list.map(f => f.key));
  return {
    needsAttention: list.filter(f => f.status === 'warn' && CONFIDENCE_WEIGHT[f.confidence]).sort(byPriority).slice(0, NEEDS_ATTENTION_MAX).map(f => f.key),
    working: list.filter(f => f.status === 'good').sort(bySampleSize).slice(0, WORKING_MAX).map(f => f.key),
    explore: Object.fromEntries(Object.entries(EXPLORE_GROUPS).map(([group, keys]) => [group, keys.filter(k => present.has(k))])),
    sinceLastChange: sinceLastChange(checkpoint, { totals, events, undelivered }, now)
  };
}

// ─── Workspace findings ───────────────────────────────────────────────────────

/**
 * Workspace-level findings over per-link rows produced by the analytics module.
 * Rows group by placement key and show the owner's label or the controlled name.
 * @param {object} p  { links, reports, appeals, windowDays?, timeZone? }
 */
function computeWorkspaceInsights({ links = [], reports = 0, appeals = 0, windowDays = null, timeZone = 'UTC' }) {
  const window = { days: windowDays, timeZone };
  const out = {};
  const usefulOf = l => (Number.isFinite(l.useful) ? l.useful : l.events || 0);
  const lostOf = l => (Number.isFinite(l.lost) ? l.lost : l.missed || 0);

  const byPlacement = new Map();
  links.forEach(l => {
    const key = placementKey(l) || 'unlabelled';
    const cur = byPlacement.get(key) || { placement: key, label: key === 'unlabelled' ? 'Unlabelled' : placementDisplay(l), links: 0, events: 0, useful: 0, lost: 0, lifetime: 0 };
    cur.links++; cur.events += l.events || 0; cur.useful += usefulOf(l); cur.lost += lostOf(l); cur.lifetime += l.lifetime || 0;
    byPlacement.set(key, cur);
  });
  const totalUseful = sum(links.map(usefulOf));
  const rows = [...byPlacement.values()].map(r => ({ ...r, observed: r.useful + r.lost, usefulRate: rate(r.useful, r.useful + r.lost), share: pct(r.useful, totalUseful) })).sort((a, b) => b.useful - a.useful);
  const labelled = rows.filter(r => r.placement !== 'unlabelled');
  const rated = labelled.filter(r => r.observed >= MIN.adequate).sort((a, b) => b.usefulRate - a.usefulRate);
  const lead = labelled[0];
  out.placementPerformance = finding('placementPerformance', 'Placement performance', window, {
    status: lead ? 'info' : 'none', confidence: confidenceFor(totalUseful), sampleSize: totalUseful, provenance: 'derived',
    headline: lead ? `${lead.label} leads with ${lead.share}% of useful visits across ${plural(lead.links, 'link')}${rated.length > 1 ? `; useful rate runs from ${pct(rated[rated.length - 1].usefulRate, 1)}% (${rated[rated.length - 1].label}) to ${pct(rated[0].usefulRate, 1)}% (${rated[0].label})` : ''}.` : 'Label links with a placement (poster, menu, badge…) to compare surfaces.',
    detail: { rows }, metrics: { placements: labelled.length, unlabelledLinks: (byPlacement.get('unlabelled') || { links: 0 }).links, totalUseful, best: rated[0] ? rated[0].placement : null, worst: rated.length > 1 ? rated[rated.length - 1].placement : null },
    reasonCodes: lead ? [] : ['NO_PLACEMENT']
  });

  const status = { active: 0, held: 0, blocked: 0, paused: 0 };
  links.forEach(l => { if (!l.enabled) status.paused++; else status[l.status === 'held' ? 'held' : l.status === 'blocked' ? 'blocked' : 'active']++; });
  const affected = sum(links.map(l => l.scansAffected || 0));
  const trouble = status.blocked || status.held;
  out.safetyImpact = finding('safetyImpact', 'Safety and trust', window, {
    status: trouble ? 'warn' : 'good', severity: 'high', confidence: 'high', sampleSize: links.length,
    headline: `${status.active} live, ${status.held} held, ${status.blocked} blocked, ${status.paused} paused; ${plural(reports, 'report')}, ${plural(appeals, 'appeal')}; ${plural(affected, 'scan')} met a safety page.`,
    detail: { ...status, reports, appeals, scansAffected: affected },
    metrics: { ...status, reports, appeals, scansAffected: affected, affected },
    reasonCodes: [status.held ? 'HELD' : null, status.blocked ? 'BLOCKED' : null].filter(Boolean)
  });

  const campaigns = new Map();
  links.forEach(l => { const c = l.utm && l.utm.utm_campaign; if (c) { const k = c.toLowerCase(); campaigns.set(k, (campaigns.get(k) || new Set()).add(c)); } });
  const messy = [...campaigns.values()].filter(set => set.size > 1).map(set => `"${[...set].join('" and "')}" are the same campaign spelled differently`);
  const untagged = links.filter(l => !(l.utm && Object.keys(l.utm).length)).length;
  out.utmHealth = finding('utmHealth', 'UTM health', window, {
    status: messy.length ? 'warn' : 'info', severity: 'low', confidence: 'high', sampleSize: links.length,
    headline: messy.length ? messy.join('; ') + '.' : `${links.length - untagged} of ${links.length} links carry campaign tags.`,
    detail: { messy, untagged }, metrics: { messy: messy.length, untagged, tagged: links.length - untagged, affected: 0 },
    reasonCodes: [messy.length ? 'TAGS_MESSY' : null, untagged ? 'NO_TAGS' : null].filter(Boolean)
  });

  const evs = links.map(usefulOf).sort((a, b) => a - b);
  const median = evs.length ? evs[Math.floor(evs.length / 2)] : 0;
  const stars = links.filter(l => median > 0 && usefulOf(l) >= 3 * median && usefulOf(l) >= 20);
  out.anomalies = finding('anomalies', 'Anomaly alerts', window, {
    status: stars.length ? 'info' : 'good', confidence: confidenceFor(totalUseful, { estimated: true }), sampleSize: totalUseful, provenance: 'heuristic',
    headline: stars.length ? stars.map(l => `${l.title} is doing ${Math.round(usefulOf(l) / median)}× the median link.`).join(' ') : 'No link stands out from the others this week.',
    detail: { standouts: stars.map(l => l.code), median }, metrics: { standouts: stars.length, median, affected: sum(stars.map(usefulOf)) },
    reasonCodes: stars.length ? ['STANDOUT_LINKS'] : []
  });
  return out;
}

module.exports = { computeInsights, computeWorkspaceInsights, rankFindings, ACTION_TYPES, EXPLORE_GROUPS };
