/**
 * Canonical analytics: delivered / rescued / lost totals, v1 and v2 event
 * compatibility, the read cap, the CSV column contract, and the one event
 * record shared by trackClick and trackOutcome.
 */
require('./helpers/mockSetup');
const admin = require('firebase-admin');
const { getLinkAnalytics, EVENT_READ_CAP } = require('../api/kortex/linkAnalytics');
const { linkEventsCsv, EVENT_COLUMNS } = require('../api/kortex/csvExport');
const { trackClick, trackOutcome, updateClickRedirect } = require('../api/kortex/clickTracking');

const CODE = 'kx-an1';
const LINK = { code: CODE, tenantId: 'kaayko-default', title: 'Poster', destinations: { web: 'https://kaayko.com/store' }, clickCount: 0 };
const HOUR = 3600000;
const KEY_A = 'a'.repeat(16);
const KEY_B = 'b'.repeat(16);

let seq = 0;
function seed(fields) {
  const id = `c_${String(++seq).padStart(6, '0')}`;
  admin._mocks.docData[`click_events/${id}`] = {
    clickId: id, linkCode: CODE, tenantId: 'kaayko-default', platform: 'ios',
    deviceInfo: { deviceType: 'mobile', os: 'iOS', browser: 'Safari' }, geo: { country: 'IN' },
    metadata: { source: 'qr' }, utm: {}, ...fields
  };
}
const v2 = (msAgo, extra = {}) => seed({ schemaVersion: 2, timestampMs: Date.now() - msAgo, delivered: true, outcome: 'delivered', visitorKey: KEY_A, referrerHost: 'direct', redirectedTo: 'https://kaayko.com/store', ...extra });
const rescued = (msAgo) => seed({ schemaVersion: 2, timestampMs: Date.now() - msAgo, delivered: true, outcome: 'fallback', fallbackReason: 'clicks', visitorKey: KEY_B, referrerHost: 'direct', redirectedTo: 'https://kaayko.com/fallback' });
const lost = (msAgo, outcome) => seed({ schemaVersion: 2, timestampMs: Date.now() - msAgo, delivered: false, outcome, visitorKey: KEY_B, referrerHost: 'direct', redirectedTo: null });
const v1 = (msAgo, extra = {}) => seed({ timestampMs: Date.now() - msAgo, ip: KEY_A, referrer: null, redirectedTo: 'https://kaayko.com/store', ...extra });

beforeEach(() => { admin._mocks.resetAll(); seq = 0; });

describe('Canonical totals', () => {
  test('observed = delivered + rescued + lost across a mixed set of v1 and v2 events', async () => {
    v2(HOUR); v2(2 * HOUR); v2(3 * HOUR); v1(4 * HOUR);
    rescued(5 * HOUR); rescued(6 * HOUR);
    lost(7 * HOUR, 'capped'); lost(8 * HOUR, 'expired');
    const a = await getLinkAnalytics(CODE, LINK, { windowDays: 7, timeZone: 'Asia/Kolkata' });
    expect(a.totals).toMatchObject({ observed: 8, delivered: 4, rescued: 2, lost: 2, useful: 6, usefulRate: 0.75, lostRate: 0.25, events: 6 });
    expect(a.outcomes.classes).toEqual({ delivered: 4, rescued: 2, lost: 2 });
    expect(a.outcomes.undelivered).toBe(2);
    expect(a.outcomes.fallbacks).toBe(2);
    expect(a.outcomes.fallbackByReason).toEqual([{ value: 'clicks', clicks: 2 }]);
    expect(a.points).toHaveLength(6);
    expect(a.points.every(p => p.length === 8)).toBe(true);
    expect(a.points.filter(p => p[7] === 'fallback')).toHaveLength(2);
    expect(a.points.filter(p => p[7] === 'delivered')).toHaveLength(4);
    expect(a.outcomes.points).toHaveLength(2);
    expect(a.outcomes.points.every(p => p.length === 5)).toBe(true);
    expect(a.outcomes.points.every(p => p[4] === 'qr' || p[4] === 'link')).toBe(true);
    expect(a.outcomes.points.map(p => p[1]).sort()).toEqual(['capped', 'expired']);
    expect(a.truncated).toBe(false);
    expect(a.checkpoint).toBeNull();
    expect(a.insights).toBeDefined();
    expect(a).toHaveProperty('actionCenter');
    expect(a.timeZone).toBe('Asia/Kolkata');
  });

  test('a link with only lost scans reports observed and lost, and no useful visits', async () => {
    lost(HOUR, 'paused'); lost(2 * HOUR, 'held');
    const a = await getLinkAnalytics(CODE, LINK, { windowDays: 7 });
    expect(a.totals).toMatchObject({ events: 0, observed: 2, delivered: 0, rescued: 0, lost: 2, useful: 0, usefulRate: 0, lostRate: 1 });
    expect(a.outcomes.classes).toEqual({ delivered: 0, rescued: 0, lost: 2 });
    expect(a.unique).toBeNull();
    expect(a.unavailable[0].metric).toBe('all');
    expect(a.truncated).toBe(false);
    expect(a.checkpoint).toBeNull();
  });

  test('a checkpoint on the link is passed through', async () => {
    v2(HOUR);
    const checkpoint = { type: 'ADD_FALLBACK', atMs: Date.now() - 2 * HOUR, applied: true, dismissed: null, baseline: { observed: 1, useful: 1, lost: 0, rescued: 0, usefulRate: 1, windowDays: 7 } };
    const a = await getLinkAnalytics(CODE, { ...LINK, checkpoint }, { windowDays: 7 });
    expect(a.checkpoint).toEqual(checkpoint);
  });
});

describe('Old and new event fields', () => {
  test('v1 (ip, referrer) and v2 (visitorKey, referrerHost) events both count for people, referrers and destinations', async () => {
    v1(HOUR, { ip: KEY_A, referrer: 'https://www.Instagram.com/p/abc?igshid=1', redirectedTo: 'https://kaayko.com/store?utm_source=poster#top' });
    v2(2 * HOUR, { visitorKey: KEY_B, referrerHost: 'instagram.com' });
    v2(3 * HOUR, { visitorKey: KEY_A, referrerHost: 'direct' });
    const a = await getLinkAnalytics(CODE, LINK, { windowDays: 7 });
    expect(a.unique).toMatchObject({ distinctVisitors: 2, coveredEvents: 3, totalEvents: 3, coveragePct: 100, reliable: true, lowerBound: 2, upperBound: 2 });
    expect(a.breakdowns.referrer).toEqual([{ value: 'instagram.com', clicks: 2 }, { value: null, clicks: 1 }]);
    expect(a.breakdowns.destination).toEqual([{ value: 'https://kaayko.com/store', clicks: 3 }]);
    expect(a.unavailable.some(u => u.metric === 'referrer')).toBe(false);
    expect(a.points.filter(p => p[6] === 'instagram.com')).toHaveLength(2);
    expect(a.points.filter(p => p[6] === null)).toHaveLength(1);
  });

  test('an event without a usable visitor key widens the bounds instead of inventing a person', async () => {
    v2(HOUR, { visitorKey: KEY_A });
    v1(2 * HOUR, { ip: null });
    const a = await getLinkAnalytics(CODE, LINK, { windowDays: 7 });
    expect(a.unique).toMatchObject({ distinctVisitors: 1, coveredEvents: 1, totalEvents: 2, coveragePct: 50, reliable: false, lowerBound: 1, upperBound: 2 });
    expect(a.unique.caveat).toMatch(/1 of 2 events/);
  });
});

describe('Read cap', () => {
  test('the read stops at the newest EVENT_READ_CAP events and says so', async () => {
    for (let i = 0; i <= EVENT_READ_CAP; i++) v2(i * 1000, { visitorKey: null });
    const a = await getLinkAnalytics(CODE, LINK, { windowDays: 30 });
    expect(a.truncated).toBe(true);
    expect(a.totals.observed).toBe(EVENT_READ_CAP);
  }, 30000);
});

describe('CSV export', () => {
  test('the column set is fixed and every row carries its outcome class', async () => {
    expect(EVENT_COLUMNS).toEqual(['time', 'link', 'source', 'platform', 'device', 'os', 'browser', 'country', 'referrer_host', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'window', 'sent_to', 'delivered', 'outcome', 'outcome_class']);
    v1(HOUR, { referrer: 'https://www.instagram.com/p/abc?x=1', redirectedTo: 'https://kaayko.com/store?utm_source=poster#top', utm: { utm_source: 'poster' } });
    rescued(2 * HOUR);
    lost(3 * HOUR, 'capped');
    const { csv, rows } = await linkEventsCsv(CODE, { windowDays: 7 });
    expect(rows).toBe(3);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe(EVENT_COLUMNS.join(','));
    expect(lines).toHaveLength(4);
    const byClass = Object.fromEntries(lines.slice(1).map(l => { const cells = l.split(','); return [cells[cells.length - 1], cells]; }));
    expect(Object.keys(byClass).sort()).toEqual(['delivered', 'lost', 'rescued']);
    expect(byClass.delivered[8]).toBe('instagram.com');
    expect(byClass.delivered[9]).toBe('poster');
    expect(byClass.delivered.slice(15)).toEqual(['https://kaayko.com/store', 'yes', 'delivered', 'delivered']);
    expect(byClass.rescued[8]).toBe('direct');
    expect(byClass.rescued.slice(15)).toEqual(['https://kaayko.com/fallback', 'yes', 'fallback', 'rescued']);
    expect(byClass.lost.slice(15)).toEqual(['', 'no', 'capped', 'lost']);
    expect(csv).not.toMatch(/a{16}|b{16}/);
  });
});

describe('Event record v2', () => {
  const base = { linkCode: CODE, tenantId: 'kaayko-default', platform: 'ios', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', ip: '203.0.113.10', referrer: 'https://WWW.Instagram.com/p/abc?igshid=1#frag' };
  const stored = (clickId) => admin._mocks.docData[`click_events/${clickId}`];

  test('trackClick and trackOutcome write the same minimised shape', async () => {
    const { clickId } = await trackClick({ ...base, utm: { utm_source: 'poster', utm_medium: 'qr', junk: 'x', utm_campaign: 'c'.repeat(300) }, metadata: { source: 'qr', scheduleWindow: 'night', linkTitle: 'Poster', linkMetadata: { any: 'thing' } } });
    const miss = await trackOutcome({ ...base, outcome: 'fallback', reason: 'clicks', delivered: true, redirectedTo: 'https://user:pw@kaayko.com/fallback?x=1#y', scanned: false });
    const click = stored(clickId);
    const fallback = stored(miss.clickId);
    expect(Object.keys(click).sort()).toEqual(Object.keys(fallback).sort());
    for (const key of ['ip', 'userAgent', 'referrer', 'installTimestamp']) {
      expect(click).not.toHaveProperty(key);
      expect(fallback).not.toHaveProperty(key);
    }
    expect(click.deviceInfo).toEqual({ deviceType: 'mobile', os: 'iOS', browser: 'Safari', parserVersion: 1 });
    expect(click).toMatchObject({ schemaVersion: 2, delivered: true, outcome: 'delivered', fallbackReason: null, visitorKeyVersion: 1, referrerHost: 'instagram.com', destinationKey: 'schedule:night', redirectedTo: null, installAttributed: false, metadata: { source: 'qr', scheduleWindow: 'night' } });
    expect(click.visitorKey).toMatch(/^[0-9a-f]{16}$/);
    expect(click.visitorKey).toBe(fallback.visitorKey);
    expect(click.utm).toEqual({ utm_source: 'poster', utm_medium: 'qr', utm_campaign: 'c'.repeat(200) });
    expect(click.expiresAt.toMillis() - click.timestampMs).toBe(30 * 86400000);
    expect(fallback).toMatchObject({ schemaVersion: 2, delivered: true, outcome: 'fallback', fallbackReason: 'clicks', destinationKey: 'fallback', redirectedTo: 'https://kaayko.com/fallback', metadata: { source: 'link', scheduleWindow: null }, utm: {} });
  });

  test('a lost scan has no destination; the redirect update stores a normalised destination', async () => {
    const lostScan = await trackOutcome({ ...base, outcome: 'capped', scanned: true });
    expect(stored(lostScan.clickId)).toMatchObject({ delivered: false, outcome: 'capped', destinationKey: null, redirectedTo: null, metadata: { source: 'qr', scheduleWindow: null } });
    const { clickId } = await trackClick({ ...base, referrer: null, ip: null, metadata: { source: 'link' } });
    await updateClickRedirect(clickId, 'https://kaayko.com/store?utm_source=poster&s=qr#top');
    expect(stored(clickId)).toMatchObject({ referrerHost: 'direct', visitorKey: null, destinationKey: null, redirectedTo: 'https://kaayko.com/store', metadata: { source: 'link', scheduleWindow: null } });
    expect(stored(clickId).redirectTimestamp).toBeDefined();
  });
});
