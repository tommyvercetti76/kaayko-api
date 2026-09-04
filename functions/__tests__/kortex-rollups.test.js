/**
 * Daily rollups and the workspace work queue: counts from mixed-schema
 * events, rows ordered by recoverable loss, the per-tenant cache, the 25-link
 * bound, and the rollup path against the live fallback.
 */
require('./helpers/mockSetup');
const admin = require('firebase-admin');
const { rollupDay, dailyRollupDates } = require('../api/kortex/rollups');
const { buildWorkspaceAnalytics, resetWorkspaceCache } = require('../api/kortex/workspaceAnalytics');

const DAY = 86400000;
const TENANT = 'g_rollup1';
const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);
const dayKey = (daysAgo) => new Date(Date.parse(`${today}T00:00:00Z`) - daysAgo * DAY).toISOString().slice(0, 10);
const atUtc = (dateKey, hour) => Date.parse(`${dateKey}T${String(hour).padStart(2, '0')}:30:00Z`);
const lost = (outcome) => ({ delivered: false, outcome });
let seq = 0;

function seedLink(code, extra = {}) {
  admin._mocks.docData[`short_links/${code}`] = { code, tenantId: TENANT, title: code, enabled: true, status: 'active', destinations: { web: 'https://kaayko.com/' }, clickCount: 0, utm: {}, createdAt: new Date(now - seq++ * 1000), ...extra };
}
function seedEvent(code, ms, extra = {}) {
  const id = `c_${code}_${seq++}`;
  admin._mocks.docData[`click_events/${id}`] = { clickId: id, linkCode: code, tenantId: TENANT, timestampMs: ms, platform: 'ios', deviceInfo: { deviceType: 'mobile' }, geo: { country: 'IN' }, metadata: { source: 'qr' }, ...extra };
}
function seedRollup(code, date, counts) {
  admin._mocks.docData[`kortex_rollups/${TENANT}__${code}__${date}`] = { tenantId: TENANT, code, date, qr: 0, tap: 0, byDevice: {}, byCountry: {}, byHourUtc: new Array(24).fill(0), updatedAtMs: now, logicVersion: 1, ...counts };
}
function seedDayMarkers(daysAgoFrom, daysAgoTo, complete = true) {
  for (let d = daysAgoFrom; d >= daysAgoTo; d--) admin._mocks.docData[`kortex_rollup_days/${dayKey(d)}`] = { date: dayKey(d), complete, links: 1, written: 1, updatedAtMs: now, logicVersion: 1 };
}
const build = (nowMs = now, windowDays = 7) => buildWorkspaceAnalytics(TENANT, { windowDays, timeZone: 'UTC', nowMs });

beforeEach(() => { admin._mocks.resetAll(); resetWorkspaceCache(); });

describe('rollupDay', () => {
  test('rolls a day of old- and new-schema events into counts, never a visitor key', async () => {
    const date = dayKey(1);
    seedLink('rlA'); seedLink('rlQuiet'); seedLink('rlOther', { tenantId: 'other-tenant' });
    seedEvent('rlA', atUtc(date, 9), { ip: 'a'.repeat(16) });
    seedEvent('rlA', atUtc(date, 9), { outcome: 'delivered', delivered: true, visitorKey: 'b'.repeat(16), referrerHost: 'instagram.com', metadata: { source: 'link' }, deviceInfo: { deviceType: 'desktop' }, geo: { country: 'US' } });
    seedEvent('rlA', atUtc(date, 18), { outcome: 'fallback', delivered: true, fallbackReason: 'clicks', redirectedTo: 'https://kaayko.com/store' });
    seedEvent('rlA', atUtc(date, 18), lost('capped'));
    seedEvent('rlA', atUtc(date, 23), { ...lost('expired'), geo: null, deviceInfo: {} });
    seedEvent('rlA', atUtc(dayKey(2), 12));
    seedEvent('rlA', atUtc(today, 1));
    seedEvent('rlOther', atUtc(date, 5), { tenantId: 'other-tenant' });

    const result = await rollupDay({ dateUtc: date, nowMs: now });
    expect(result).toEqual({ date, complete: true, links: 3, written: 2 });

    const doc = admin._mocks.docData[`kortex_rollups/${TENANT}__rlA__${date}`];
    expect(doc).toMatchObject({ tenantId: TENANT, code: 'rlA', date, observed: 5, delivered: 2, rescued: 1, lost: 2, qr: 4, tap: 1, updatedAtMs: now, logicVersion: 1 });
    expect(doc.byOutcome).toEqual({ delivered: 2, fallback: 1, capped: 1, expired: 1 });
    expect(doc.byDevice).toEqual({ mobile: 3, desktop: 1, unknown: 1 });
    expect(doc.byCountry).toEqual({ IN: 3, US: 1, unknown: 1 });
    expect(doc.byHourUtc).toHaveLength(24);
    expect([doc.byHourUtc[9], doc.byHourUtc[18], doc.byHourUtc[23]]).toEqual([2, 2, 1]);
    expect(JSON.stringify(doc)).not.toMatch(/"(ip|visitorKey|referrer|referrerHost|redirectedTo|userAgent)"/);
    expect(admin._mocks.docData[`kortex_rollups/${TENANT}__rlQuiet__${date}`]).toBeUndefined();
    expect(admin._mocks.docData[`kortex_rollups/other-tenant__rlOther__${date}`]).toMatchObject({ observed: 1, delivered: 1 });
    expect(admin._mocks.docData[`kortex_rollup_days/${date}`]).toMatchObject({ date, complete: true, links: 3, written: 2, logicVersion: 1 });
  });

  test('today rolls as a partial day; the nightly job names yesterday and today', async () => {
    seedLink('rlA'); seedEvent('rlA', atUtc(today, 0));
    const result = await rollupDay({ dateUtc: today, nowMs: now });
    expect(result.complete).toBe(false);
    expect(admin._mocks.docData[`kortex_rollup_days/${today}`].complete).toBe(false);
    expect(dailyRollupDates(now)).toEqual([dayKey(1), today]);
    await expect(rollupDay({ dateUtc: '2026/09/01' })).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe('buildWorkspaceAnalytics', () => {
  test('rows carry the outcome vocabulary and queue by recoverable lost scans, then lost', async () => {
    seedLink('wsA', { placement: 'poster' });
    seedLink('wsB', { placement: 'menu', placementLabel: 'Bar menu' });
    seedLink('wsC', { limits: { maxClicks: 5, fallbackUrl: 'https://kaayko.com/store', version: 1 } });
    seedLink('wsD', { enabled: false });
    seedEvent('wsA', now - DAY); seedEvent('wsA', now - DAY, lost('capped')); seedEvent('wsA', now - 2 * DAY, lost('capped'));
    seedEvent('wsB', now - DAY); seedEvent('wsB', now - DAY, { outcome: 'fallback', delivered: true, fallbackReason: 'clicks' });
    for (let i = 0; i < 3; i++) seedEvent('wsB', now - DAY, lost('held'));
    seedEvent('wsC', now - DAY, lost('expired'));
    seedEvent('wsD', now - DAY, lost('paused'));

    const data = await build();
    expect(data.queue).toEqual(['wsA', 'wsD', 'wsB', 'wsC']);
    expect(data.links.map(r => r.code)).toEqual(data.queue);
    const [a, d, b, c] = data.links;
    expect(a).toMatchObject({ observed: 3, useful: 1, rescued: 0, lost: 2, usefulRate: 0.333, recoverableLost: 2, placement: 'poster', changeVsPrevious: null, events: 1, missed: 2 });
    expect(a.topIssue).toEqual(expect.objectContaining({ key: expect.any(String), headline: expect.any(String) }));
    expect(a.topIssue).toHaveProperty('action');
    expect(['high', 'medium', 'early', null]).toContain(a.confidence);
    expect(d).toMatchObject({ observed: 1, useful: 0, lost: 1, recoverableLost: 1, enabled: false });
    expect(b).toMatchObject({ observed: 5, useful: 2, rescued: 1, lost: 3, usefulRate: 0.4, recoverableLost: 0, placementLabel: 'Bar menu' });
    expect(c).toMatchObject({ observed: 1, useful: 0, lost: 1, usefulRate: 0, recoverableLost: 0 });
    expect(data.uniquePeople).toBeNull();
    expect(data.uniqueNote).toMatch(/not summed/);
    expect(data.window).toEqual({ days: 7, timeZone: 'UTC', source: 'events' });
    expect(data.droppedLinks).toBe(0);
    expect(data.insights.placementPerformance).toBeDefined();
    expect(data.points).toHaveLength(3);
  });

  test('the whole response is cached per tenant and window for sixty seconds', async () => {
    seedLink('wsA'); seedEvent('wsA', now - DAY);
    const first = await build();
    seedLink('wsNew');
    const again = await build(now + 59000);
    expect(again).toBe(first);
    expect(again.links).toHaveLength(1);
    const otherWindow = await build(now + 59000, 30);
    expect(otherWindow.links).toHaveLength(2);
    const later = await build(now + 60000);
    expect(later).not.toBe(first);
    expect(later.links).toHaveLength(2);
  });

  test('reads at most 25 links and reports the rest as dropped', async () => {
    for (let i = 0; i < 30; i++) seedLink(`ws${String(i).padStart(2, '0')}`);
    const data = await build();
    expect(data.links).toHaveLength(25);
    expect(data.queue).toHaveLength(25);
    expect(data.droppedLinks).toBe(5);
  });

  test('uses rollups for totals, timeline and the change since the previous period once every complete day is rolled; today stays live', async () => {
    seedLink('wsA');
    seedDayMarkers(14, 1);
    for (const d of [1, 3, 7]) seedRollup('wsA', dayKey(d), { observed: 7, delivered: 4, rescued: 1, lost: 2, byOutcome: { delivered: 4, fallback: 1, capped: 2 } });
    for (const d of [8, 14]) seedRollup('wsA', dayKey(d), { observed: 10, delivered: 5, rescued: 0, lost: 5, byOutcome: { delivered: 5, expired: 5 } });
    seedEvent('wsA', now);
    seedEvent('wsA', now, lost('capped'));

    const data = await build();
    expect(data.window.source).toBe('rollups');
    const row = data.links[0];
    expect(row).toMatchObject({ observed: 23, useful: 16, rescued: 3, lost: 7, recoverableLost: 7, usefulRate: 0.696, events: 1, missed: 1 });
    expect(row.changeVsPrevious).toBe(0.214);
    expect(row.timeline).toEqual([0, 0, 0, 5, 0, 5, 1]);
    expect(data.points).toHaveLength(1);
  });

  test('the change since the previous period waits until that period is rolled too', async () => {
    seedLink('wsA');
    seedDayMarkers(7, 1);
    for (const d of [1, 2, 3]) seedRollup('wsA', dayKey(d), { observed: 10, delivered: 10, rescued: 0, lost: 0, byOutcome: { delivered: 10 } });
    const data = await build();
    expect(data.window.source).toBe('rollups');
    expect(data.links[0]).toMatchObject({ observed: 30, useful: 30, lost: 0, recoverableLost: 0, usefulRate: 1, changeVsPrevious: null, confidence: 'high' });
  });

  test('falls back to the live analytics when a complete day in the window was not rolled, or only rolled while still in progress', async () => {
    seedLink('wsA');
    seedDayMarkers(7, 2);
    seedDayMarkers(1, 1, false);
    seedRollup('wsA', dayKey(3), { observed: 50, delivered: 50, rescued: 0, lost: 0, byOutcome: { delivered: 50 } });
    seedEvent('wsA', now - DAY); seedEvent('wsA', now - DAY, lost('expired'));

    const data = await build();
    expect(data.window.source).toBe('events');
    expect(data.links[0]).toMatchObject({ observed: 2, useful: 1, lost: 1, recoverableLost: 1, changeVsPrevious: null });
    expect(data.links[0].timeline).toEqual([1]);
  });
});
