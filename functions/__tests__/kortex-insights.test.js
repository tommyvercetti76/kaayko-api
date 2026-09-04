/**
 * The plain-language layer: every one of the twenty findings over synthetic events.
 */
const { computeInsights, computeWorkspaceInsights } = require('../api/kortex/linkInsights');
const { windowDaysFor, timeZoneFrom } = require('../api/kortex/analyticsPolicy');
const { normalizePlacement, normalizeEconomics, normalizeCampaignWindow } = require('../api/kortex/linkFields');

const DAY = 86400000;
const now = Date.now();
function ev(daysAgo, hour, extra = {}) {
  const base = new Date(now - daysAgo * DAY); base.setUTCHours(hour, 15, 0, 0);
  const ms = base.getTime();
  return { ms, hour, dow: new Date(ms).getUTCDay(), platform: 'ios', deviceType: 'mobile', country: 'IN', ip: 'v' + Math.floor(Math.random() * 1e9).toString(16).padStart(16, '0').slice(0, 16), referrer: null, source: 'qr', window: null, outcome: null, reason: null, redirectedTo: 'https://kaayko.com/store', ...extra };
}

describe('linkInsights', () => {
  const link = { destinations: { web: 'https://kaayko.com/store?utm_source=poster' }, utm: { utm_source: 'Poster', utm_campaign: 'spring fest' }, status: 'active', limits: { maxClicks: 100, fallbackUrl: 'https://kaayko.com/' }, placement: 'poster', economics: { printCost: 50, valuePerVisit: 2, currency: 'USD' }, campaignWindow: { startAt: new Date(now - 4 * DAY).toISOString(), endAt: new Date(now + DAY).toISOString() } };

  test('every finding has a key, title, status and headline; the mix reads correctly', () => {
    const events = [];
    for (let d = 6; d >= 0; d--) for (let i = 0; i < 4 + (6 - d) * 2; i++) events.push(ev(d, 19, { ip: i % 3 === 0 ? 'repeat0000000000' : undefined }));
    events.push(ev(1, 12, { source: 'link', referrer: 'https://www.instagram.com/', platform: 'android', country: 'US' }));
    events.push(ev(0, 20, { outcome: 'fallback', reason: 'capped', redirectedTo: 'https://kaayko.com/' }));
    // the most recent decision is a miss on an expired code, so the replay must show it
    const undelivered = [{ ms: Math.max(...events.map(e => e.ms)) + 1000, hour: 9, dow: 1, outcome: 'expired', platform: 'ios', country: 'IN' }, { ms: now - 2 * DAY, hour: 9, dow: 1, outcome: 'held', platform: 'web', country: 'IN' }];
    const out = computeInsights({ link, events, undelivered, windowDays: 7, timeZone: 'UTC', unique: { distinctVisitors: 30, clicksPerVisitor: 1.6 } });
    const keys = ['qrSplit', 'placement', 'trend', 'bestWindow', 'rhythm', 'missed', 'fallbackUsage', 'deviceMatch', 'replay', 'qualityScore', 'repeatPattern', 'newVsReturning', 'campaignLift', 'roi', 'geoDrift', 'channelMix', 'utmHealth', 'safetyImpact', 'anomalies'];
    keys.forEach(k => { expect(out[k]).toBeDefined(); expect(typeof out[k].headline).toBe('string'); expect(['good', 'warn', 'info', 'none']).toContain(out[k].status); });
    expect(out.qrSplit.detail.qrShare).toBeGreaterThan(90);
    expect(out.trend.detail.label).toBe('gaining');
    expect(out.bestWindow.headline).toMatch(/evenings perform best/);
    expect(out.rhythm.detail.dominant).toBe('evening');
    expect(out.missed.detail.total).toBe(2);
    expect(out.missed.headline).toMatch(/expired/);
    expect(out.fallbackUsage.detail.fallbacks).toBe(1);
    expect(out.deviceMatch.status).toBe('warn'); // iPhone share high, no iPhone destination
    expect(out.replay.detail.lines.length).toBeGreaterThan(3);
    expect(out.replay.detail.lines.some(l => /past its end date/.test(l))).toBe(true);
    expect(out.repeatPattern.detail.more).toBeGreaterThan(0);
    expect(out.newVsReturning.detail.returning).toBeGreaterThan(0);
    expect(out.campaignLift.detail.during).toBeGreaterThan(0);
    expect(out.roi.detail.costPerScan).toBeGreaterThan(0);
    expect(out.roi.detail.breakevenScans).toBe(25);
    expect(out.geoDrift.detail.top.country).toBe('IN');
    expect(out.channelMix.detail.channels[0].channel).toBe('qr (offline)');
    expect(out.channelMix.detail.channels.some(c => c.channel === 'instagram')).toBe(true);
    expect(out.utmHealth.status).toBe('warn');
    expect(out.utmHealth.detail.issues.join(' ')).toMatch(/mixes case|spaces|already carries/);
    expect(out.safetyImpact.detail.scansAffected).toBe(1);
    expect(out.anomalies.detail.items.some(a => a.kind === 'expiredScanned')).toBe(true);
    expect(out.qualityScore.detail.score).toBeGreaterThan(0);
    expect(out.qualityScore.detail.score).toBeLessThanOrEqual(100);
  });

  test('empty windows degrade to "none" without throwing; the zone drives hours', () => {
    const out = computeInsights({ link: {}, events: [], undelivered: [], windowDays: 7, timeZone: 'Asia/Kolkata' });
    expect(out.qrSplit.status).toBe('none');
    expect(out.bestWindow.status).toBe('none');
    expect(out.campaignLift.status).toBe('none');
    expect(out.roi.status).toBe('none');
    expect(out.qualityScore.status).toBe('none');
    expect(out.anomalies.status).toBe('good');
  });

  test('workspace findings: placement leader, safety counts, messy campaigns, standouts', () => {
    const links = [
      { code: 'a', title: 'Poster A', placement: 'poster', events: 90, lifetime: 200, status: 'active', enabled: true, utm: { utm_campaign: 'Spring' }, scansAffected: 0 },
      { code: 'b', title: 'Menu', placement: 'menu', events: 10, lifetime: 30, status: 'held', enabled: true, utm: { utm_campaign: 'spring' }, scansAffected: 3 },
      { code: 'c', title: 'Badge', placement: null, events: 8, lifetime: 20, status: 'active', enabled: false, utm: {}, scansAffected: 0 }
    ];
    const out = computeWorkspaceInsights({ links, reports: 1, appeals: 0 });
    expect(out.placementPerformance.detail.rows[0].placement).toBe('poster');
    expect(out.safetyImpact.detail.held).toBe(1);
    expect(out.safetyImpact.detail.paused).toBe(1);
    expect(out.safetyImpact.detail.scansAffected).toBe(3);
    expect(out.utmHealth.status).toBe('warn');
    expect(out.anomalies.detail.standouts).toEqual(['a']);
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
    expect(normalizePlacement('  Table   Tent ')).toBe('table tent');
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
