/**
 * The plain-language layer: insight v2 objects, server-enforced thresholds,
 * share classes, actions with their prefills, the Action Center ranking and
 * the result-since-last-change states.
 */
const { computeInsights, computeWorkspaceInsights, rankFindings, ACTION_TYPES, EXPLORE_GROUPS } = require('../api/kortex/linkInsights');
const { windowDaysFor, timeZoneFrom } = require('../api/kortex/analyticsPolicy');
const { normalizePlacement, normalizeEconomics, normalizeCampaignWindow } = require('../api/kortex/linkFields');

const DAY = 86400000;
const now = Date.now();
const KEYS = ['qrSplit', 'placement', 'trend', 'bestWindow', 'rhythm', 'missed', 'fallbackUsage', 'deviceMatch', 'replay', 'qualityScore', 'repeatPattern', 'newVsReturning', 'campaignLift', 'roi', 'geoDrift', 'channelMix', 'utmHealth', 'safetyImpact', 'anomalies'];
const V2_FIELDS = ['key', 'version', 'title', 'status', 'severity', 'confidence', 'sampleSize', 'window', 'headline', 'detail', 'metrics', 'reasonCodes', 'action', 'shareClass', 'provenance', 'insufficient'];
const PUBLIC_KEYS = ['qrSplit', 'trend', 'bestWindow', 'placement', 'campaignLift', 'qualityScore', 'missed'];
const PROVENANCE = ['measured', 'derived', 'estimated', 'assumption', 'heuristic'];
const FORBIDDEN_WORDS = /\b(clicks?|buyers?|revenue|sales|profit|ROI)\b/i;

function ev(daysAgo, hour, extra = {}) {
  const base = new Date(now - daysAgo * DAY); base.setUTCHours(hour, 15, 0, 0);
  const ms = base.getTime();
  return { ms, hour, dow: new Date(ms).getUTCDay(), platform: 'ios', deviceType: 'mobile', country: 'IN', visitorKey: `v${daysAgo}-${Math.random().toString(16).slice(2, 12)}`, referrerHost: null, source: 'qr', window: null, outcome: 'delivered', reason: null, redirectedTo: 'https://kaayko.com/store', ...extra };
}
/** Every sentence a person reads from a finding. */
function copyOf(f) {
  return [f.title, f.headline, f.action && f.action.label, f.insufficient && f.insufficient.note, ...((f.detail && f.detail.lines) || [])].filter(Boolean).join(' ');
}
/** Seven rising days of iPhone scans, one repeat visitor, an Instagram tap and one rescued visit. */
function heavyEvents() {
  const events = [];
  for (let d = 6; d >= 0; d--) for (let i = 0; i < 4 + (6 - d) * 2; i++) events.push(ev(d, 19, { visitorKey: i % 3 === 0 ? 'repeat0000000000' : `v${d}-${i}` }));
  events.push(ev(1, 12, { source: 'link', referrerHost: 'instagram.com', platform: 'android', country: 'US' }));
  events.push(ev(0, 20, { outcome: 'fallback', reason: 'clicks', redirectedTo: 'https://kaayko.com/' }));
  return events;
}
const compute = (over = {}) => computeInsights({ link: {}, events: [], undelivered: [], windowDays: 7, timeZone: 'UTC', ...over });

describe('linkInsights v2', () => {
  // The Android store destination exists, so the missing iPhone destination is a real routing gap.
  const link = { code: 'lkfix1', destinations: { web: 'https://kaayko.com/store?utm_source=poster', android: 'https://play.google.com/store/apps/details?id=com.kaayko' }, utm: { utm_source: 'Poster', utm_campaign: 'spring fest' }, status: 'active', limits: { maxClicks: 100 }, placement: 'poster', economics: { printCost: 50, valuePerVisit: 2, currency: 'USD' }, campaignWindow: { startAt: new Date(now - 4 * DAY).toISOString(), endAt: new Date(now + DAY).toISOString() } };

  test('every finding is a v2 object with the contract fields, and the mix reads correctly', () => {
    const events = heavyEvents();
    // the most recent decision is a miss on an expired code, so the replay must show it
    const undelivered = [
      { ms: Math.max(...events.map(e => e.ms)) + 1000, hour: 9, dow: 1, outcome: 'expired', platform: 'ios', country: 'IN' },
      { ms: now - 2 * DAY, hour: 9, dow: 1, outcome: 'held', platform: 'web', country: 'IN' },
      { ms: now - DAY, hour: 9, dow: 1, outcome: 'capped', platform: 'ios', country: 'IN' }
    ];
    const out = compute({ link, events, undelivered, unique: { distinctVisitors: 30, clicksPerVisitor: 1.6, coveragePct: 100 } });
    expect(Object.keys(out).sort()).toEqual([...KEYS].sort());
    for (const f of Object.values(out)) {
      expect(Object.keys(f).sort()).toEqual([...V2_FIELDS].sort());
      expect(f.version).toBe(2);
      expect(f.window).toEqual({ days: 7, timeZone: 'UTC' });
      expect(['good', 'warn', 'info', 'none']).toContain(f.status);
      expect(typeof f.headline).toBe('string');
      expect(Number.isInteger(f.sampleSize)).toBe(true);
      expect(Array.isArray(f.reasonCodes)).toBe(true);
      expect(PROVENANCE).toContain(f.provenance);
      if (f.status !== 'warn') expect(f.severity).toBeNull();
      if (f.status === 'none') expect(f.confidence).toBeNull();
      expect(f.shareClass).toBe(PUBLIC_KEYS.includes(f.key) && f.confidence !== 'early' ? 'public' : 'owner_only');
      expect(copyOf(f)).not.toMatch(FORBIDDEN_WORDS);
      if (f.action) { expect(ACTION_TYPES).toContain(f.action.type); expect(typeof f.action.label).toBe('string'); expect(typeof f.action.prefill).toBe('object'); }
    }
    expect(out.qrSplit.detail.qrShare).toBeGreaterThan(90);
    expect(out.qrSplit.confidence).toBe('high');
    expect(out.placement.headline).toMatch(/Placement: Poster/);
    expect(out.trend.detail.label).toBe('gaining');
    expect(out.trend.status).toBe('good');
    expect(out.trend.metrics.periodDays).toBe(3);
    expect(out.bestWindow.headline).toMatch(/evenings \(18:00–22:00\) perform best/);
    expect(out.bestWindow.confidence).toBe('high');
    expect(out.rhythm.detail.dominant).toBe('evening');
    expect(out.missed.detail.total).toBe(3);
    expect(out.missed.status).toBe('warn');
    expect(out.missed.headline).toMatch(/expired/);
    expect(out.missed.reasonCodes).toEqual(expect.arrayContaining(['EXPIRED', 'HELD', 'CAP_REACHED', 'NO_FALLBACK']));
    expect(out.missed.action).toEqual({ type: 'ADD_FALLBACK', label: 'Add a fallback', prefill: { limits: { fallbackUrl: '' } } });
    expect(out.missed.metrics).toMatchObject({ lost: 3, observed: 75, recoverable: 2, affected: 3 });
    expect(out.fallbackUsage.detail.fallbacks).toBe(1);
    expect(out.fallbackUsage.status).toBe('good');
    expect(out.fallbackUsage.action).toEqual({ type: 'REMOVE_CAP', label: 'Remove the cap', prefill: { limits: null } });
    expect(out.deviceMatch.status).toBe('warn');
    expect(out.deviceMatch.reasonCodes).toEqual(['NO_IOS_DESTINATION']);
    expect(out.deviceMatch.action).toEqual({ type: 'ADD_IOS_DESTINATION', label: 'Add an iPhone destination', prefill: { iosDestination: '' } });
    expect(out.replay.detail.lines.length).toBeGreaterThan(3);
    expect(out.replay.detail.lines.some(l => /past its end date/.test(l))).toBe(true);
    expect(out.replay.detail.lines.join(' ')).not.toMatch(/\d:\d\d/); // hour buckets, never minutes
    expect(out.repeatPattern.detail.more).toBeGreaterThan(0);
    expect(out.repeatPattern.confidence).toBe('medium');
    expect(out.repeatPattern.provenance).toBe('estimated');
    expect(out.newVsReturning.detail.returning).toBeGreaterThan(0);
    expect(out.campaignLift.detail.during).toBeGreaterThan(0);
    expect(out.campaignLift.confidence).toBe('high');
    expect(out.roi.title).toBe('Estimated print payback');
    expect(out.roi.detail.costPerScan).toBeGreaterThan(0);
    expect(out.roi.detail.breakevenScans).toBe(25);
    expect(out.roi.metrics.paybackVisits).toBe(25);
    expect(out.roi.headline).toMatch(/estimated visit value/);
    expect(out.roi.provenance).toBe('assumption');
    expect(out.geoDrift.detail.top.country).toBe('IN');
    expect(out.channelMix.detail.channels[0].channel).toBe('qr (offline)');
    expect(out.channelMix.detail.channels.some(c => c.channel === 'instagram')).toBe(true);
    expect(out.utmHealth.status).toBe('warn');
    expect(out.utmHealth.reasonCodes).toEqual(['TAGS_MESSY']);
    expect(out.utmHealth.action).toEqual({ type: 'ADD_UTM', label: 'Clean up the tags', prefill: { utm: { utm_source: 'poster', utm_medium: 'qr', utm_campaign: 'spring-fest' } } });
    expect(out.utmHealth.detail.issues.join(' ')).toMatch(/mixes case|spaces|already carries/);
    expect(out.safetyImpact.detail.scansAffected).toBe(1);
    expect(out.anomalies.detail.items.map(a => a.kind)).toEqual(expect.arrayContaining(['expiredScanned', 'cappedScanned']));
    expect(out.anomalies.action).toEqual({ type: 'RAISE_CAP', label: 'Raise the cap', prefill: { limits: { maxClicks: 200 } } });
    expect(out.anomalies.severity).toBe('medium');
    expect(out.qualityScore.detail.score).toBeGreaterThan(0);
    expect(out.qualityScore.detail.score).toBeLessThanOrEqual(100);
    expect(out.qualityScore.provenance).toBe('heuristic');
    expect(out.qualityScore.metrics.usefulRate).toBeCloseTo(72 / 75, 3);
  });

  test('below a threshold a finding is none, with null confidence and what is needed; 5–9 observations are an early signal that stays with the owner', () => {
    const events = [];
    for (let i = 0; i < 4; i++) events.push(ev(1, 10 + i), ev(0, 10 + i));
    const undelivered = [{ ms: now - DAY, hour: 9, dow: 1, outcome: 'capped', platform: 'ios', country: 'IN' }];
    const out = compute({ link: { destinations: { web: 'https://kaayko.com/' }, limits: { maxClicks: 8 } }, events, undelivered });
    expect(out.bestWindow).toMatchObject({ status: 'none', confidence: null, insufficient: { needed: 30, have: 8 } });
    expect(out.bestWindow.headline).toMatch(/30 useful visits/);
    expect(out.rhythm.insufficient).toEqual(expect.objectContaining({ needed: 30, have: 8 }));
    expect(out.trend).toMatchObject({ status: 'none', insufficient: { needed: 10, have: 0 } });
    expect(out.repeatPattern).toMatchObject({ status: 'none', insufficient: { needed: 10, have: 8 } });
    expect(out.newVsReturning.status).toBe('none');
    expect(out.geoDrift).toMatchObject({ status: 'none', insufficient: { needed: 10, have: 8 } });
    expect(out.qualityScore).toMatchObject({ status: 'none', insufficient: { needed: 10, have: 9 } });
    expect(out.anomalies.status).toBe('warn'); // a capped scan is a direct observation, not a statistic
    expect(out.anomalies.metrics.spikeDetection).toBe(false);
    expect(out.qrSplit).toMatchObject({ status: 'info', confidence: 'early', shareClass: 'owner_only' });
    expect(out.missed).toMatchObject({ status: 'warn', confidence: 'early' });
    expect(out.deviceMatch.status).toBe('info'); // a plain web page needs no store destination
    expect(rankFindings(out).needsAttention).toEqual([]);
  });

  test('a thirty-scan link with enough days unlocks timing and spike detection; a clean day is good', () => {
    const events = [];
    for (let d = 6; d >= 1; d--) for (let i = 0; i < 5; i++) events.push(ev(d, 19));
    for (let i = 0; i < 10; i++) events.push(ev(0, 19));
    const out = compute({ link: { destinations: { web: 'https://kaayko.com/' } }, events });
    expect(out.bestWindow.status).toBe('good');
    expect(out.rhythm.status).toBe('info');
    expect(out.anomalies.metrics.spikeDetection).toBe(true);
    expect(out.anomalies.status).toBe('good');
  });

  test('empty windows degrade to none without throwing; the zone drives hours', () => {
    const out = compute({ timeZone: 'Asia/Kolkata' });
    expect(out.qrSplit.status).toBe('none');
    expect(out.bestWindow.status).toBe('none');
    expect(out.campaignLift.status).toBe('none');
    expect(out.roi.status).toBe('none');
    expect(out.qualityScore.status).toBe('none');
    expect(out.missed.status).toBe('none');
    expect(out.anomalies).toMatchObject({ status: 'none', insufficient: { needed: 30, have: 0 } });
    expect(out.safetyImpact.status).toBe('good');
    expect(out.placement.action).toEqual({ type: 'ADD_PLACEMENT', label: 'Add a placement', prefill: { placement: 'poster' } });
    expect(out.utmHealth.action).toEqual({ type: 'ADD_UTM', label: 'Add campaign tags', prefill: { utm: { utm_source: 'qr', utm_medium: 'qr', utm_campaign: '' } } });
    Object.values(out).forEach(f => expect(f.window.timeZone).toBe('Asia/Kolkata'));
  });

  test('geo drift shows only countries with five or more scans and folds the rest into other', () => {
    const events = [];
    for (let i = 0; i < 8; i++) events.push(ev(i % 3, 12, { country: 'IN' }));
    for (let i = 0; i < 4; i++) events.push(ev(i % 3, 13, { country: 'US' }));
    const out = compute({ events });
    expect(out.geoDrift.status).toBe('info');
    expect(out.geoDrift.detail.top.country).toBe('IN');
    expect(out.geoDrift.detail.movers.map(m => m.country)).not.toContain('US');
    expect(out.geoDrift.metrics.shownCountries).toBe(1);
  });

  test('the remaining action types carry the prefill their PATCH body needs', () => {
    const events = [];
    for (let i = 0; i < 12; i++) events.push(ev(i % 4, 10, { platform: 'android', visitorKey: i < 10 ? 'same0000000000ab' : `k${i}` }));
    const held = compute({ link: { code: 'lkheld', status: 'held', destinations: { web: 'https://kaayko.com/', ios: 'https://apps.apple.com/app/id1' }, schedule: { windows: [{ label: 'night' }] } }, events, undelivered: [{ ms: now - DAY, hour: 9, dow: 1, outcome: 'expired', platform: 'ios', country: 'IN' }] });
    expect(held.safetyImpact.action).toEqual({ type: 'REQUEST_REVIEW', label: 'Request a review', prefill: {}, href: '/kortex/appeal?code=lkheld' });
    expect(held.deviceMatch.action).toEqual({ type: 'ADD_ANDROID_DESTINATION', label: 'Add an Android destination', prefill: { androidDestination: '' } });
    expect(held.fallbackUsage.action).toEqual({ type: 'FIX_SCHEDULE', label: 'Check the schedule', prefill: { schedule: { windows: [{ label: 'night' }] } } });
    expect(held.anomalies.action.type).toBe('EXTEND_END_DATE');
    const extendedTo = Date.parse(held.anomalies.action.prefill.expiresAt);
    expect(extendedTo).toBeGreaterThan(now + 29 * DAY);
    expect(extendedTo).toBeLessThan(now + 31 * DAY);
    const repeats = compute({ link: { destinations: { web: 'https://kaayko.com/' } }, events });
    expect(repeats.anomalies.action).toEqual({ type: 'PAUSE_LINK', label: 'Pause the link', prefill: { enabled: false } });
    const rescuedAfterExpiry = compute({ link: { destinations: { web: 'https://kaayko.com/' }, limits: { fallbackUrl: 'https://kaayko.com/' } }, events: events.map(e => ({ ...e, outcome: 'fallback', reason: 'expired' })) });
    expect(rescuedAfterExpiry.fallbackUsage.action).toEqual({ type: 'REMOVE_END_DATE', label: 'Remove the end date', prefill: { expiresAt: null } });
    expect(rescuedAfterExpiry.fallbackUsage.headline).toMatch(/after the end date/);
  });

  test('a dismissed recommendation stops alerting; remind_later wears off after a week', () => {
    const undelivered = [];
    for (let i = 0; i < 12; i++) undelivered.push({ ms: now - i * 3600000, hour: 9, dow: 1, outcome: 'capped', platform: 'ios', country: 'IN' });
    const base = { link: { destinations: { web: 'https://kaayko.com/' }, limits: { maxClicks: 5 } }, undelivered };
    expect(compute(base).missed.status).toBe('warn');
    const dismissed = compute({ ...base, checkpoint: { type: 'ADD_FALLBACK', applied: false, dismissed: 'not_relevant', atMs: now - DAY } });
    expect(dismissed.missed.status).toBe('info');
    expect(dismissed.missed.reasonCodes).toContain('DISMISSED');
    expect(dismissed.anomalies.status).toBe('warn'); // a different action, still alerting
    expect(compute({ ...base, checkpoint: { type: 'ADD_FALLBACK', applied: false, dismissed: 'remind_later', atMs: now - 8 * DAY } }).missed.status).toBe('warn');
    expect(compute({ ...base, checkpoint: { type: 'ADD_FALLBACK', applied: true, atMs: now - DAY } }).missed.status).toBe('warn');
  });
});

describe('rankFindings', () => {
  const f = (key, over) => ({ key, version: 2, status: 'info', severity: null, confidence: null, sampleSize: 0, metrics: {}, action: null, ...over });
  const fix = { type: 'ADD_FALLBACK', label: 'Add a fallback', prefill: {} };

  test('needs attention is warn + high|medium confidence, top three by impact × confidence × recoverability; working is good, top two by sample', () => {
    const insights = {
      missed: f('missed', { status: 'warn', confidence: 'high', sampleSize: 40, metrics: { affected: 5 }, action: fix }),
      deviceMatch: f('deviceMatch', { status: 'warn', confidence: 'medium', sampleSize: 40, metrics: { affected: 20 } }),
      anomalies: f('anomalies', { status: 'warn', confidence: 'early', sampleSize: 9, metrics: { affected: 100 }, action: fix }),
      safetyImpact: f('safetyImpact', { status: 'warn', confidence: 'high', sampleSize: 40, metrics: { affected: 50 }, action: fix }),
      utmHealth: f('utmHealth', { status: 'warn', confidence: 'high', sampleSize: 40, metrics: { affected: 0 }, action: fix }),
      qualityScore: f('qualityScore', { status: 'good', sampleSize: 30 }),
      trend: f('trend', { status: 'good', sampleSize: 40 }),
      bestWindow: f('bestWindow', { status: 'good', sampleSize: 5 }),
      replay: f('replay', { status: 'info', sampleSize: 8 })
    };
    const ranked = rankFindings(insights, { totals: { observed: 40 } });
    expect(ranked.needsAttention).toEqual(['safetyImpact', 'deviceMatch', 'missed']);
    expect(ranked.working).toEqual(['trend', 'qualityScore']);
    expect(ranked.explore).toEqual({ placement: ['trend', 'bestWindow'], routing: ['deviceMatch', 'missed', 'replay'], audience: [], campaign: ['utmHealth', 'anomalies'], trust: ['safetyImpact', 'qualityScore'] });
    expect(Object.keys(EXPLORE_GROUPS)).toEqual(['placement', 'routing', 'audience', 'campaign', 'trust']);
    expect(ranked.sinceLastChange).toBeNull();
  });

  test('since last change: pending until 24h and ten scans, then improved / unchanged / regressed by five points of useful rate', () => {
    const baseline = { usefulRate: 0.5, observed: 40, windowDays: 7 };
    const applied = (atMs) => ({ type: 'ADD_FALLBACK', applied: true, dismissed: null, atMs, baseline });
    const scans = (useful, lost, since) => ({
      events: Array.from({ length: useful }, (_, i) => ({ ms: since + i + 1 })),
      undelivered: Array.from({ length: lost }, (_, i) => ({ ms: since + i + 1 }))
    });
    const at = now - 2 * DAY;
    expect(rankFindings({}, { checkpoint: { ...applied(at), applied: false, dismissed: 'bad_data' } }).sinceLastChange).toBeNull();
    expect(rankFindings({}, { checkpoint: applied(now - 3600000), ...scans(30, 0, now - 3600000) }).sinceLastChange.state).toBe('pending');
    expect(rankFindings({}, { checkpoint: applied(at), ...scans(6, 3, at) }).sinceLastChange).toMatchObject({ state: 'pending', after: { observed: 9 } });
    const improved = rankFindings({}, { checkpoint: applied(at), ...scans(18, 2, at) }).sinceLastChange;
    expect(improved).toEqual({ state: 'improved', type: 'ADD_FALLBACK', atMs: at, before: { usefulRate: 0.5, observed: 40 }, after: { observed: 20, usefulRate: 0.9 } });
    expect(rankFindings({}, { checkpoint: applied(at), ...scans(10, 10, at) }).sinceLastChange.state).toBe('unchanged');
    expect(rankFindings({}, { checkpoint: applied(at), ...scans(4, 16, at) }).sinceLastChange.state).toBe('regressed');
    // Older events than the checkpoint do not count towards `after`.
    const mixed = scans(18, 2, at);
    mixed.undelivered.push(...Array.from({ length: 30 }, (_, i) => ({ ms: at - DAY - i })));
    expect(rankFindings({}, { checkpoint: applied(at), ...mixed }).sinceLastChange.after).toEqual({ observed: 20, usefulRate: 0.9 });
    // Without events, the window totals stand in once the whole window post-dates the change.
    expect(rankFindings({}, { checkpoint: applied(now - 8 * DAY), totals: { observed: 50, usefulRate: 0.42 } }).sinceLastChange).toMatchObject({ state: 'regressed', after: { observed: 50, usefulRate: 0.42 } });
    expect(rankFindings({}, { checkpoint: applied(now - 2 * DAY), totals: { observed: 50, usefulRate: 0.42 } }).sinceLastChange.state).toBe('pending');
  });
});

describe('computeWorkspaceInsights', () => {
  test('placement leader by key with the owner label shown, safety counts, messy campaigns, standouts; every finding is v2', () => {
    const links = [
      { code: 'a', title: 'Poster A', placement: 'poster', events: 90, useful: 90, lost: 10, lifetime: 200, status: 'active', enabled: true, utm: { utm_campaign: 'Spring' }, scansAffected: 0 },
      { code: 'b', title: 'Menu', placement: 'menu', placementLabel: 'Bar menu', events: 10, useful: 10, lost: 0, lifetime: 30, status: 'held', enabled: true, utm: { utm_campaign: 'spring' }, scansAffected: 3 },
      { code: 'c', title: 'Badge', placement: null, events: 8, lifetime: 20, status: 'active', enabled: false, utm: {}, scansAffected: 0 },
      { code: 'd', title: 'Legacy tent', placement: 'table tent', events: 2, lifetime: 2, status: 'active', enabled: true, utm: {}, scansAffected: 0 }
    ];
    const out = computeWorkspaceInsights({ links, reports: 1, appeals: 0, windowDays: 7, timeZone: 'Asia/Kolkata' });
    for (const f of Object.values(out)) {
      expect(Object.keys(f).sort()).toEqual([...V2_FIELDS].sort());
      expect(f.version).toBe(2);
      expect(f.window).toEqual({ days: 7, timeZone: 'Asia/Kolkata' });
      expect(f.shareClass).toBe('owner_only');
    }
    const rows = out.placementPerformance.detail.rows;
    expect(rows[0]).toMatchObject({ placement: 'poster', label: 'Poster', useful: 90, lost: 10, usefulRate: 0.9 });
    expect(rows.find(r => r.placement === 'menu').label).toBe('Bar menu');
    expect(rows.find(r => r.placement === 'table_tent').label).toBe('Table tent');
    expect(rows.find(r => r.placement === 'unlabelled').links).toBe(1);
    expect(out.placementPerformance.headline).toMatch(/^Poster leads with 82% of useful visits/);
    expect(out.placementPerformance.metrics).toMatchObject({ best: 'menu', worst: 'poster' });
    expect(out.safetyImpact.detail.held).toBe(1);
    expect(out.safetyImpact.detail.paused).toBe(1);
    expect(out.safetyImpact.detail.scansAffected).toBe(3);
    expect(out.safetyImpact).toMatchObject({ status: 'warn', severity: 'high', reasonCodes: ['HELD'] });
    expect(out.utmHealth.status).toBe('warn');
    expect(out.utmHealth.reasonCodes).toEqual(['TAGS_MESSY', 'NO_TAGS']);
    expect(out.anomalies.detail.standouts).toEqual(['a']);
    expect(out.anomalies.status).toBe('info');
  });
});

describe('analyticsPolicy and linkFields', () => {
  test('one window policy', () => {
    expect(windowDaysFor({ kind: 'guest', plan: 'starter' })).toBe(7);
    expect(windowDaysFor({ plan: 'starter' })).toBe(7);
    expect(windowDaysFor({ plan: 'pro' })).toBe(30);
    expect(windowDaysFor({ plan: 'business' })).toBe(30);
    expect(windowDaysFor(null)).toBe(7);
    expect(windowDaysFor({ plan: 'starter' }, { superAdmin: true })).toBe(30);
    expect(timeZoneFrom('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(timeZoneFrom('Not/AZone')).toBe('UTC');
    expect(timeZoneFrom('')).toBe('UTC');
  });
  test('fields normalise and refuse junk', () => {
    expect(normalizePlacement('  Table   Tent ')).toEqual({ key: 'table_tent', label: null });
    expect(normalizePlacement(null)).toBeNull();
    expect(() => normalizePlacement(5)).toThrow();
    expect(normalizeEconomics({ printCost: '50', valuePerVisit: 2, currency: 'inr' })).toEqual({ printCost: 50, valuePerVisit: 2, currency: 'INR' });
    expect(normalizeEconomics({})).toBeNull();
    expect(() => normalizeEconomics({ printCost: -1 })).toThrow();
    expect(normalizeCampaignWindow({ startAt: '2026-09-01', endAt: '2026-09-10' }).startAt).toMatch(/^2026-09-01/);
    expect(() => normalizeCampaignWindow({ startAt: '2026-09-10', endAt: '2026-09-01' })).toThrow();
    expect(normalizeCampaignWindow(null)).toBeNull();
  });
});
