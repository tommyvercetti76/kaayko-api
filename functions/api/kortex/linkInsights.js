/**
 * The plain-language layer over a link's scans, computed once on the server
 * so every surface (wanderer dashboard, admin app, samples, shared reports,
 * digests) says the same thing. Pure: takes the events the analytics module
 * already read, never touches the database.
 *
 * Each finding: { key, title, status: 'good'|'warn'|'info'|'none', headline, detail }.
 * `none` means "cannot be computed yet" with the reason in `headline`.
 *
 * @module api/kortex/linkInsights
 */

'use strict';

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

function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
function partOf(hour) { return PARTS.find(p => (p.from < p.to ? hour >= p.from && hour < p.to : hour >= p.from || hour < p.to)); }
function fmtTime(ms, tz) { try { return new Date(ms).toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }); } catch (_) { return new Date(ms).toISOString(); } }
function hostOf(r) { try { return r ? new URL(r).hostname.replace(/^www\./, '') : null; } catch (_) { return null; } }
function channelOf(host) { if (!host) return 'direct'; for (const [name, re] of CHANNELS) if (re.test(host)) return name; return 'other sites'; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs) { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); }

/**
 * @param {object} p
 * @param {object} p.link         short_links document (destinations, schedule, limits, expiresAt, utm, placement, economics, campaignWindow, status, clickCount)
 * @param {Array}  p.events       delivered events: { ms, platform, deviceType, country, ip, referrer, source, window, outcome, redirectedTo, hour, dow }
 * @param {Array}  p.undelivered  undelivered events: { ms, outcome, platform, country, hour, dow }
 * @param {number} p.windowDays
 * @param {string} p.timeZone
 * @param {object} [p.unique]     { distinctVisitors, clicksPerVisitor } from the analytics module
 */
function computeInsights({ link = {}, events = [], undelivered = [], windowDays = 7, timeZone = 'UTC', unique = null }) {
  const n = events.length;
  const out = {};
  const d = link.destinations || {};

  // 1. QR vs link
  const qr = events.filter(e => e.source === 'qr').length;
  out.qrSplit = { key: 'qrSplit', title: 'QR scans vs link taps', status: n ? 'info' : 'none',
    headline: n ? `${pct(qr, n)}% of visits were scans of the printed code; ${pct(n - qr, n)}% were taps on the link.` : 'No visits in this window yet.',
    detail: { qr, taps: n - qr, qrShare: pct(qr, n) } };

  // 2. Placement
  out.placement = { key: 'placement', title: 'Placement', status: link.placement ? 'info' : 'none',
    headline: link.placement ? `This code lives on a ${link.placement}. Compare placements in the workspace overview.` : 'Give this link a placement label (poster, menu, badge…) to compare surfaces across links.',
    detail: { placement: link.placement || null } };

  // 3. Trend / fatigue
  const days = new Map();
  events.forEach(e => { const k = new Date(e.ms).toISOString().slice(0, 10); days.set(k, (days.get(k) || 0) + 1); });
  const dayKeys = [...days.keys()].sort();
  let trend = { key: 'trend', title: 'Placement fatigue', status: 'none', headline: 'Needs at least six days of scans to read a trend.', detail: null };
  if (dayKeys.length >= 6) {
    const third = Math.floor(dayKeys.length / 3);
    const early = mean(dayKeys.slice(0, third).map(k => days.get(k)));
    const late = mean(dayKeys.slice(-third).map(k => days.get(k)));
    const change = early ? Math.round(((late - early) / early) * 100) : (late ? 100 : 0);
    const label = change >= 15 ? 'gaining' : change <= -15 ? 'declining' : 'flat';
    trend = { key: 'trend', title: 'Placement fatigue', status: label === 'declining' ? 'warn' : label === 'gaining' ? 'good' : 'info',
      headline: label === 'gaining' ? `Gaining: recent days average ${late.toFixed(1)} scans against ${early.toFixed(1)} at the start (+${change}%).`
        : label === 'declining' ? `Fading: recent days average ${late.toFixed(1)} scans against ${early.toFixed(1)} at the start (${change}%). Time to move or refresh this placement.`
        : `Steady: about ${late.toFixed(1)} scans a day, unchanged across the window.`,
      detail: { label, change, early: +early.toFixed(2), late: +late.toFixed(2) } };
  }
  out.trend = trend;

  // 4. Best window (weekday × daypart, in the viewer's zone)
  const cells = new Map();
  events.forEach(e => { const k = `${e.dow}|${partOf(e.hour).key}`; cells.set(k, (cells.get(k) || 0) + 1); });
  const best = [...cells.entries()].sort((a, b) => b[1] - a[1])[0];
  out.bestWindow = { key: 'bestWindow', title: 'Best time to place or share', status: n >= 10 ? 'good' : 'none',
    headline: n >= 10 ? (() => { const [dow, part] = best[0].split('|'); const p = PARTS.find(x => x.key === part); return `${DAYS[Number(dow)]} ${p.label} perform best: ${pct(best[1], n)}% of all scans (${timeZone}).`; })() : 'Needs about ten scans to name a best window.',
    detail: best ? { dow: Number(best[0].split('|')[0]), part: best[0].split('|')[1], scans: best[1], share: pct(best[1], n), timeZone } : null };

  // 5. Audience rhythm
  const weekday = events.filter(e => e.dow >= 1 && e.dow <= 5);
  const rhythmShares = {
    lunch: pct(weekday.filter(e => e.hour >= 11 && e.hour < 14).length, weekday.length),
    commuter: pct(weekday.filter(e => (e.hour >= 7 && e.hour < 9) || (e.hour >= 17 && e.hour < 19)).length, weekday.length),
    evening: pct(events.filter(e => e.hour >= 18 && e.hour < 23).length, n),
    lateNight: pct(events.filter(e => e.hour >= 23 || e.hour < 5).length, n),
    weekend: pct(events.filter(e => e.dow === 0 || e.dow === 6).length, n)
  };
  const rhythmLabels = { lunch: 'Lunch scanners', commuter: 'Commuter traffic', evening: 'Evening browsers', lateNight: 'Late-night buyers', weekend: 'Weekend planners' };
  const dominant = Object.entries(rhythmShares).sort((a, b) => b[1] - a[1])[0];
  out.rhythm = { key: 'rhythm', title: 'Audience rhythm', status: n >= 10 ? 'info' : 'none',
    headline: n >= 10 ? `${rhythmLabels[dominant[0]]}: ${dominant[1]}% of scans fit that pattern (weekend ${rhythmShares.weekend}%, evenings ${rhythmShares.evening}%, late nights ${rhythmShares.lateNight}%).` : 'Needs about ten scans to describe a rhythm.',
    detail: { dominant: dominant[0], shares: rhythmShares } };

  // 6. Missed opportunities
  const missedBy = {};
  undelivered.forEach(e => { missedBy[e.outcome] = (missedBy[e.outcome] || 0) + 1; });
  const missed = undelivered.length;
  const noFallback = (missedBy.expired || 0) + (missedBy.capped || 0);
  out.missed = { key: 'missed', title: 'Missed opportunities', status: missed ? (noFallback ? 'warn' : 'info') : 'good',
    headline: missed ? `${missed} scan${missed === 1 ? '' : 's'} produced nothing: ${Object.entries(missedBy).map(([k, v]) => `${v} ${k}`).join(', ')}.${noFallback ? ' Add a fallback address so a finished campaign still sends people somewhere.' : ''}` : 'Every scan in this window reached a page.',
    detail: { total: missed, byOutcome: missedBy, withoutFallback: noFallback } };

  // 7. Fallback usage
  const fallbacks = events.filter(e => e.outcome === 'fallback');
  const fbBy = {}; fallbacks.forEach(e => { fbBy[e.reason || 'limit'] = (fbBy[e.reason || 'limit'] || 0) + 1; });
  const night = events.filter(e => e.window).length;
  out.fallbackUsage = { key: 'fallbackUsage', title: 'Fallback usage', status: fallbacks.length || night ? 'info' : 'none',
    headline: fallbacks.length || night ? `${fallbacks.length} visit${fallbacks.length === 1 ? '' : 's'} went to the fallback address${Object.keys(fbBy).length ? ` (${Object.entries(fbBy).map(([k, v]) => `${v} after ${k}`).join(', ')})` : ''}; ${night} took the night window.` : 'No fallback or night-window redirects in this window.',
    detail: { fallbacks: fallbacks.length, byReason: fbBy, nightWindow: night, nightShare: pct(night, n) } };

  // 8. Device match quality
  const plat = { ios: 0, android: 0, web: 0 }; events.forEach(e => { plat[e.platform] = (plat[e.platform] || 0) + 1; });
  const flags = [];
  if (n && pct(plat.ios, n) >= 20 && !d.ios) flags.push(`${pct(plat.ios, n)}% of visitors are on iPhone but there is no iPhone destination; they land on the web address.`);
  if (n && pct(plat.android, n) >= 20 && !d.android) flags.push(`${pct(plat.android, n)}% are on Android with no Android destination.`);
  const fit = n ? Math.round(100 - flags.length * 30) : null;
  out.deviceMatch = { key: 'deviceMatch', title: 'Device match quality', status: !n ? 'none' : flags.length ? 'warn' : 'good',
    headline: !n ? 'No visits yet.' : flags.length ? flags.join(' ') : (d.ios || d.android) ? `Every platform has its own destination: iPhone ${pct(plat.ios, n)}%, Android ${pct(plat.android, n)}%, web ${pct(plat.web, n)}%.` : `Everyone lands on the web address (iPhone ${pct(plat.ios, n)}%, Android ${pct(plat.android, n)}%). Add store links if the destination is an app.`,
    detail: { shares: { ios: pct(plat.ios, n), android: pct(plat.android, n), web: pct(plat.web, n) }, hasIos: !!d.ios, hasAndroid: !!d.android, fit } };

  // 9. Routing decision replay
  const all = [...events.map(e => ({ ...e, delivered: true })), ...undelivered.map(e => ({ ...e, delivered: false }))].sort((a, b) => b.ms - a.ms).slice(0, 8);
  const sentence = e => {
    const who = `${e.platform === 'ios' ? 'iPhone' : e.platform === 'android' ? 'Android' : 'Desktop'} ${e.source === 'qr' ? 'scan' : 'tap'} at ${fmtTime(e.ms, timeZone)}${e.country ? ` from ${e.country}` : ''}`;
    if (!e.delivered) return `${who} found the link ${e.outcome === 'capped' ? 'over its scan cap' : e.outcome === 'expired' ? 'past its end date' : e.outcome}: nothing was shown.`;
    if (e.outcome === 'fallback') return `${who} arrived after the ${e.reason || 'limit'} and went to the fallback address.`;
    if (e.window) return `${who} matched the ${e.window} window and went to ${hostOf(e.redirectedTo) || 'the night address'}.`;
    if (e.platform === 'ios' && d.ios) return `${who} went to the iPhone destination.`;
    if (e.platform === 'android' && d.android) return `${who} went to the Android destination.`;
    return `${who} went to ${hostOf(e.redirectedTo) || 'the main address'}.`;
  };
  out.replay = { key: 'replay', title: 'Routing decision replay', status: all.length ? 'info' : 'none', headline: all.length ? `${all.length} most recent decisions, in plain words.` : 'No visits yet.', detail: { lines: all.map(sentence) } };

  // 11. Repeat pattern & 12. new vs returning
  const perVisitor = new Map(); const firstSeen = new Map();
  events.filter(e => e.ip).sort((a, b) => a.ms - b.ms).forEach(e => { perVisitor.set(e.ip, (perVisitor.get(e.ip) || 0) + 1); if (!firstSeen.has(e.ip)) firstSeen.set(e.ip, e.ms); });
  const counts = [...perVisitor.values()];
  const hist = { once: counts.filter(c => c === 1).length, twice: counts.filter(c => c === 2).length, more: counts.filter(c => c >= 3).length };
  const topVisitor = counts.length ? Math.max(...counts) : 0;
  out.repeatPattern = { key: 'repeatPattern', title: 'Repeat scanner pattern', status: counts.length ? (hist.more > counts.length * 0.3 ? 'warn' : 'info') : 'none',
    headline: counts.length ? `${hist.once} people scanned once, ${hist.twice} twice, ${hist.more} three or more times.${hist.more > counts.length * 0.3 ? ' Many repeats can mean interest, or a destination that did not answer the question.' : ''}` : 'No attributable visitors yet.',
    detail: { ...hist, people: counts.length, topVisitorScans: topVisitor } };
  let returning = 0; events.filter(e => e.ip).forEach(e => { if (firstSeen.get(e.ip) < e.ms) returning++; });
  const attributable = events.filter(e => e.ip).length;
  out.newVsReturning = { key: 'newVsReturning', title: 'First-time vs returning', status: attributable ? 'info' : 'none',
    headline: attributable ? `${pct(attributable - returning, attributable)}% of visits were someone's first in this window; ${pct(returning, attributable)}% were people coming back.` : 'No attributable visitors yet.',
    detail: { firstTime: attributable - returning, returning, share: pct(returning, attributable) } };

  // 13. Campaign lift
  const cw = link.campaignWindow;
  if (cw && (cw.startAt || cw.endAt)) {
    const s = cw.startAt ? new Date(cw.startAt).getTime() : -Infinity, t = cw.endAt ? new Date(cw.endAt).getTime() : Infinity;
    const rate = (from, to) => { const evs = events.filter(e => e.ms >= from && e.ms < to); const spanDays = Math.max(1, Math.min(to, Date.now()) - Math.max(from, Date.now() - windowDays * 86400000)) / 86400000; return spanDays > 0 ? +(evs.length / spanDays).toFixed(2) : 0; };
    const before = rate(-Infinity, s), during = rate(s, t), after = t < Date.now() ? rate(t, Infinity) : null;
    const lift = before ? Math.round(((during - before) / before) * 100) : null;
    out.campaignLift = { key: 'campaignLift', title: 'Campaign lift', status: lift === null ? 'info' : lift > 0 ? 'good' : 'warn',
      headline: `${during} scans a day during the campaign${before ? ` against ${before} before (${lift > 0 ? '+' : ''}${lift}%)` : ''}${after !== null ? `, ${after} a day since it ended` : ''}.`,
      detail: { before, during, after, lift } };
  } else {
    out.campaignLift = { key: 'campaignLift', title: 'Campaign lift', status: 'none', headline: 'Set a campaign window on this link to compare before, during and after.', detail: null };
  }

  // 14. Print ROI
  const eco = link.economics;
  const useful = n - fallbacks.length;
  if (eco && (eco.printCost !== null || eco.valuePerVisit !== null)) {
    const costPerScan = eco.printCost !== null && n ? +(eco.printCost / n).toFixed(2) : null;
    const costPerUseful = eco.printCost !== null && useful ? +(eco.printCost / useful).toFixed(2) : null;
    const value = eco.valuePerVisit !== null ? +(useful * eco.valuePerVisit).toFixed(2) : null;
    const breakeven = eco.printCost !== null && eco.valuePerVisit ? Math.ceil(eco.printCost / eco.valuePerVisit) : null;
    out.roi = { key: 'roi', title: 'Print ROI', status: value !== null && eco.printCost !== null ? (value >= eco.printCost ? 'good' : 'info') : 'info',
      headline: `${costPerScan !== null ? `${eco.currency} ${costPerScan} per scan, ${costPerUseful !== null ? `${eco.currency} ${costPerUseful} per useful visit` : ''}` : ''}${value !== null ? `; ${useful} useful visits worth ${eco.currency} ${value}` : ''}${breakeven !== null ? `; breaks even at ${breakeven} scans${n >= breakeven ? ' (reached)' : ''}` : ''}.`,
      detail: { costPerScan, costPerUsefulVisit: costPerUseful, value, breakevenScans: breakeven, usefulVisits: useful, currency: eco.currency } };
  } else {
    out.roi = { key: 'roi', title: 'Print ROI', status: 'none', headline: 'Add the print cost and a value per visit to see cost per scan and the break-even point.', detail: { usefulVisits: useful } };
  }

  // 16. Geo drift
  const half = n ? events[Math.floor(n / 2)].ms : 0;
  const tallyC = list => { const m = new Map(); list.forEach(e => { if (e.country) m.set(e.country, (m.get(e.country) || 0) + 1); }); return m; };
  const c1 = tallyC(events.filter(e => e.ms < half)), c2 = tallyC(events.filter(e => e.ms >= half));
  const countries = new Set([...c1.keys(), ...c2.keys()]);
  const movers = [...countries].map(c => ({ country: c, before: pct(c1.get(c) || 0, [...c1.values()].reduce((a, b) => a + b, 0)), after: pct(c2.get(c) || 0, [...c2.values()].reduce((a, b) => a + b, 0)) })).map(m => ({ ...m, change: m.after - m.before })).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const topC = [...tallyC(events).entries()].sort((a, b) => b[1] - a[1])[0];
  out.geoDrift = { key: 'geoDrift', title: 'Geo heat and drift', status: topC ? (movers[0] && Math.abs(movers[0].change) >= 15 ? 'warn' : 'info') : 'none',
    headline: topC ? `${topC[0]} leads with ${pct(topC[1], n)}% of scans.${movers[0] && Math.abs(movers[0].change) >= 15 ? ` ${movers[0].country} moved from ${movers[0].before}% to ${movers[0].after}% across the window.` : ' The mix is steady across the window.'}` : 'No country data yet.',
    detail: { top: topC ? { country: topC[0], share: pct(topC[1], n) } : null, movers: movers.slice(0, 5) } };

  // 17. Channel mix
  const ch = new Map(); events.forEach(e => { const c = e.source === 'qr' ? 'qr (offline)' : channelOf(hostOf(e.referrer)); ch.set(c, (ch.get(c) || 0) + 1); });
  const channels = [...ch.entries()].map(([channel, count]) => ({ channel, count, share: pct(count, n) })).sort((a, b) => b.count - a.count);
  out.channelMix = { key: 'channelMix', title: 'Referrer and channel mix', status: n ? 'info' : 'none',
    headline: n ? channels.slice(0, 3).map(c => `${c.channel} ${c.share}%`).join(' · ') + '.' : 'No visits yet.', detail: { channels } };

  // 18. UTM health
  const utm = link.utm || {}; const issues = [];
  const keys = Object.keys(utm);
  if (!keys.length) issues.push('No campaign tags on this link; the destination will not know these visits came from it.');
  keys.forEach(k => { const v = String(utm[k]); if (/[A-Z]/.test(v)) issues.push(`${k.replace('utm_', '')} "${v}" mixes case; analytics tools treat "Poster" and "poster" as different sources.`); if (/\s/.test(v)) issues.push(`${k.replace('utm_', '')} "${v}" contains spaces.`); });
  try { const dest = new URL(d.web || ''); ['utm_source', 'utm_medium', 'utm_campaign'].forEach(k => { const dv = dest.searchParams.get(k); if (dv && utm[k] && dv !== utm[k]) issues.push(`The address already carries ${k.replace('utm_', '')}="${dv}", which wins over the link's "${utm[k]}".`); }); } catch (_) {}
  out.utmHealth = { key: 'utmHealth', title: 'UTM health', status: !keys.length ? 'info' : issues.length ? 'warn' : 'good',
    headline: issues.length ? issues.join(' ') : `Tags are present and clean: ${keys.map(k => `${k.replace('utm_', '')}=${utm[k]}`).join(', ')}.`, detail: { tags: utm, issues } };

  // 19. Safety impact (this link)
  const heldBlocked = (missedBy.held || 0) + (missedBy.blocked || 0);
  out.safetyImpact = { key: 'safetyImpact', title: 'Safety and trust', status: link.status === 'blocked' ? 'warn' : link.status === 'held' ? 'warn' : 'good',
    headline: link.status === 'active' || !link.status ? `Live and checked${link.safety && link.safety.review ? ', released by a reviewer after a hold' : ''}.${heldBlocked ? ` ${heldBlocked} scan${heldBlocked === 1 ? '' : 's'} hit it while it was held or blocked.` : ''}` : `${link.status === 'held' ? 'Held for review' : 'Blocked'}: ${heldBlocked} scan${heldBlocked === 1 ? '' : 's'} saw the ${link.status} page.`,
    detail: { status: link.status || 'active', scansAffected: heldBlocked, reviewed: !!(link.safety && link.safety.review) } };

  // 20. Anomalies
  const anomalies = [];
  const dailyCounts = dayKeys.map(k => days.get(k));
  if (dailyCounts.length >= 4) { const m = mean(dailyCounts.slice(0, -1)), s = std(dailyCounts.slice(0, -1)); const last = dailyCounts[dailyCounts.length - 1]; if (last >= 10 && last > m + 3 * s && last > m * 2) anomalies.push({ kind: 'spike', text: `Scan spike: ${last} today against a typical ${m.toFixed(1)}.` }); }
  const recent = events.filter(e => e.ms > Date.now() - 2 * 86400000); const lateRecent = recent.filter(e => e.hour >= 23 || e.hour < 5).length;
  if (recent.length >= 10 && pct(lateRecent, recent.length) > Math.max(25, rhythmShares.lateNight * 2)) anomalies.push({ kind: 'afterHours', text: `After-hours surge: ${pct(lateRecent, recent.length)}% of the last two days' scans came between 23:00 and 05:00.` });
  if (topVisitor >= 10) anomalies.push({ kind: 'repeats', text: `One visitor scanned ${topVisitor} times; check whether the destination is failing for them.` });
  if (missedBy.expired) anomalies.push({ kind: 'expiredScanned', text: `A printed code past its end date is still being scanned (${missedBy.expired} times). Extend the date or add a fallback.` });
  if (missedBy.capped) anomalies.push({ kind: 'cappedScanned', text: `${missedBy.capped} scans arrived after the cap. Raise it or add a fallback.` });
  out.anomalies = { key: 'anomalies', title: 'Anomaly alerts', status: anomalies.length ? 'warn' : 'good', headline: anomalies.length ? anomalies.map(a => a.text).join(' ') : 'Nothing unusual in this window.', detail: { items: anomalies } };

  // 10. Quality score (uses the above)
  const total = n + undelivered.length;
  const usefulShare = total ? (n - fallbacks.length) / total : 0;
  let score = 0; const reasons = [];
  score += Math.round(usefulShare * 40); if (usefulShare < 0.9 && total) reasons.push(`${pct(total - (n - fallbacks.length), total)}% of scans did not reach the intended page`);
  score += fit === null ? 20 : Math.round((fit / 100) * 20); if (flags.length) reasons.push('device destinations are missing');
  const cpv = unique && unique.clicksPerVisitor ? unique.clicksPerVisitor : null;
  score += cpv === null ? 12 : cpv <= 2 ? 15 : cpv <= 3 ? 10 : 5; if (cpv !== null && cpv > 3) reasons.push('people scan many times each');
  score += link.status === 'blocked' ? 0 : link.status === 'held' ? 5 : 15; if (link.status && link.status !== 'active') reasons.push(`the link is ${link.status}`);
  score += fallbacks.length && n ? Math.round((1 - fallbacks.length / n) * 10) : 10;
  score = Math.max(0, Math.min(100, score));
  out.qualityScore = { key: 'qualityScore', title: 'Scan quality score', status: !total ? 'none' : score >= 75 ? 'good' : score >= 50 ? 'info' : 'warn',
    headline: !total ? 'No scans to score yet.' : `${score} / 100: ${score >= 75 ? 'this is working' : score >= 50 ? 'working, with something to fix' : 'not working as intended'}${reasons.length ? ` (${reasons.join('; ')})` : ''}.`,
    detail: { score, reasons } };

  return out;
}

/** Workspace-level findings over per-link rows produced by the analytics module. */
function computeWorkspaceInsights({ links = [], reports = 0, appeals = 0 }) {
  const out = {};
  // 2. Placement performance
  const byPlacement = new Map();
  links.forEach(l => { const k = l.placement || 'unlabelled'; const cur = byPlacement.get(k) || { placement: k, links: 0, events: 0, lifetime: 0 }; cur.links++; cur.events += l.events; cur.lifetime += l.lifetime; byPlacement.set(k, cur); });
  const totalEvents = links.reduce((s, l) => s + l.events, 0);
  const rows = [...byPlacement.values()].map(r => ({ ...r, share: pct(r.events, totalEvents) })).sort((a, b) => b.events - a.events);
  const labelled = rows.filter(r => r.placement !== 'unlabelled');
  out.placementPerformance = { key: 'placementPerformance', title: 'Placement performance', status: labelled.length ? 'info' : 'none',
    headline: labelled.length ? `${labelled[0].placement} leads with ${labelled[0].share}% of scans across ${labelled[0].links} link${labelled[0].links === 1 ? '' : 's'}.` : 'Label links with a placement (poster, menu, badge…) to compare surfaces.', detail: { rows } };
  // 19. Safety impact (workspace)
  const status = { active: 0, held: 0, blocked: 0, paused: 0 };
  links.forEach(l => { if (!l.enabled) status.paused++; else status[l.status === 'held' ? 'held' : l.status === 'blocked' ? 'blocked' : 'active']++; });
  const affected = links.reduce((s, l) => s + (l.scansAffected || 0), 0);
  out.safetyImpact = { key: 'safetyImpact', title: 'Safety and trust', status: status.blocked || status.held ? 'warn' : 'good',
    headline: `${status.active} live, ${status.held} held, ${status.blocked} blocked, ${status.paused} paused; ${reports} report${reports === 1 ? '' : 's'}, ${appeals} appeal${appeals === 1 ? '' : 's'}; ${affected} scan${affected === 1 ? '' : 's'} met a safety page.`, detail: { ...status, reports, appeals, scansAffected: affected } };
  // 18. UTM health across links
  const campaigns = new Map();
  links.forEach(l => { const c = l.utm && l.utm.utm_campaign; if (c) { const k = c.toLowerCase(); campaigns.set(k, (campaigns.get(k) || new Set()).add(c)); } });
  const messy = [...campaigns.entries()].filter(([, set]) => set.size > 1).map(([k, set]) => `"${[...set].join('" and "')}" are the same campaign spelled differently`);
  const untagged = links.filter(l => !(l.utm && Object.keys(l.utm).length)).length;
  out.utmHealth = { key: 'utmHealth', title: 'UTM health', status: messy.length ? 'warn' : 'info', headline: messy.length ? messy.join('; ') + '.' : `${links.length - untagged} of ${links.length} links carry campaign tags.`, detail: { messy, untagged } };
  // 20. Anomalies across links
  const evs = links.map(l => l.events).sort((a, b) => a - b);
  const median = evs.length ? evs[Math.floor(evs.length / 2)] : 0;
  const stars = links.filter(l => median > 0 && l.events >= 3 * median && l.events >= 20);
  out.anomalies = { key: 'anomalies', title: 'Anomaly alerts', status: stars.length ? 'info' : 'good',
    headline: stars.length ? stars.map(l => `${l.title} is doing ${Math.round(l.events / median)}× the median link.`).join(' ') : 'No link stands out from the others this week.', detail: { standouts: stars.map(l => l.code), median } };
  return out;
}

module.exports = { computeInsights, computeWorkspaceInsights, PARTS, channelOf };
