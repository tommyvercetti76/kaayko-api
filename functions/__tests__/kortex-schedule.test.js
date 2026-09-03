/**
 * Time-of-day routing: validation, the pure picker (server clock, link
 * timezone, midnight wrap, DST), and the wiring through create / update /
 * redirect for guest links.
 */

require('./helpers/mockSetup');

const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');
const S = require('../api/kortex/linkSchedule');
const safety = require('../api/kortex/destinationSafety');

const UA = ['User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'];
const LANG = ['Accept-Language', 'en'];

let app;
let redirectApp;
beforeAll(() => {
  app = buildTestApp('/kortex', require('../api/kortex/smartLinks'));
  redirectApp = buildTestApp('/', require('../api/kortex/deeplinkRoutes'));
});
beforeEach(() => { admin._mocks.resetAll(); safety.resetCaches(); });

const DAY_NIGHT = {
  timezone: 'Asia/Kolkata',
  windows: [
    { label: 'day', start: '06:00', end: '18:00', url: 'https://kaayko.com/day' },
    { label: 'night', start: '18:00', end: '06:00', url: 'https://kaayko.com/night' }
  ]
};

describe('normalizeSchedule', () => {
  test('accepts a day/night pair and labels defaults', () => {
    const s = S.normalizeSchedule({ timezone: 'Asia/Kolkata', windows: [{ start: '06:00', end: '18:00', url: 'https://kaayko.com/day' }] });
    expect(s.timezone).toBe('Asia/Kolkata');
    expect(s.windows[0]).toEqual({ label: '06:00-18:00', start: '06:00', end: '18:00', url: 'https://kaayko.com/day' });
    expect(s.version).toBe(1);
  });

  test('null, empty and no windows clear the schedule', () => {
    expect(S.normalizeSchedule(null)).toBeNull();
    expect(S.normalizeSchedule({})).toBeNull();
    expect(S.normalizeSchedule({ timezone: 'UTC', windows: [] })).toBeNull();
  });

  test('rejects bad zones, times, equal bounds, bad urls, too many windows', () => {
    const win = { start: '06:00', end: '18:00', url: 'https://kaayko.com/' };
    expect(() => S.normalizeSchedule({ timezone: 'Mars/Olympus', windows: [win] })).toThrow(/time zone/);
    expect(() => S.normalizeSchedule({ timezone: 'UTC', windows: [{ ...win, start: '6am' }] })).toThrow(/HH:MM/);
    expect(() => S.normalizeSchedule({ timezone: 'UTC', windows: [{ ...win, end: '06:00' }] })).toThrow(/must differ/);
    expect(() => S.normalizeSchedule({ timezone: 'UTC', windows: [{ ...win, url: 'javascript:alert(1)' }] })).toThrow(/http/);
    expect(() => S.normalizeSchedule({ timezone: 'UTC', windows: Array(9).fill(win) })).toThrow(/at most 8/);
  });
});

describe('pickScheduledDestination', () => {
  // 2026-06-15T02:30:00Z is 08:00 in Kolkata (+05:30) and 03:30 in London (BST, +01:00).
  const morningIST = new Date('2026-06-15T02:30:00Z');
  // 2026-06-15T15:30:00Z is 21:00 in Kolkata.
  const eveningIST = new Date('2026-06-15T15:30:00Z');

  test('uses the link timezone, not the server one', () => {
    expect(S.pickScheduledDestination(DAY_NIGHT, morningIST).label).toBe('day');
    expect(S.pickScheduledDestination(DAY_NIGHT, eveningIST).label).toBe('night');
    const london = { ...DAY_NIGHT, timezone: 'Europe/London' };
    expect(S.pickScheduledDestination(london, morningIST).label).toBe('night'); // 03:30 BST
  });

  test('handles a window that wraps midnight and boundaries exactly', () => {
    expect(S.windowMatches({ start: '18:00', end: '06:00' }, S.toMinutes('23:59'))).toBe(true);
    expect(S.windowMatches({ start: '18:00', end: '06:00' }, S.toMinutes('00:00'))).toBe(true);
    expect(S.windowMatches({ start: '18:00', end: '06:00' }, S.toMinutes('06:00'))).toBe(false);
    expect(S.windowMatches({ start: '06:00', end: '18:00' }, S.toMinutes('06:00'))).toBe(true);
    expect(S.windowMatches({ start: '06:00', end: '18:00' }, S.toMinutes('18:00'))).toBe(false);
  });

  test('follows daylight-saving rules of the zone', () => {
    const ny = { timezone: 'America/New_York', windows: [{ label: 'day', start: '09:00', end: '17:00', url: 'https://kaayko.com/day' }] };
    expect(S.localMinutes(new Date('2026-01-15T14:30:00Z'), 'America/New_York')).toBe(9 * 60 + 30);  // EST: 09:30
    expect(S.localMinutes(new Date('2026-07-15T14:30:00Z'), 'America/New_York')).toBe(10 * 60 + 30); // EDT: 10:30
    expect(S.pickScheduledDestination(ny, new Date('2026-07-15T21:30:00Z'))).toBeNull();               // 17:30 EDT: outside
    expect(S.pickScheduledDestination(ny, new Date('2026-01-15T21:30:00Z')).label).toBe('day');       // 16:30 EST: inside
  });

  test('returns null for gaps, no schedule and a broken zone', () => {
    const partial = { timezone: 'UTC', windows: [{ start: '09:00', end: '10:00', url: 'https://kaayko.com/x' }] };
    expect(S.pickScheduledDestination(partial, new Date('2026-06-15T12:00:00Z'))).toBeNull();
    expect(S.pickScheduledDestination(null)).toBeNull();
    expect(S.pickScheduledDestination({ timezone: 'Nope/Zone', windows: partial.windows })).toBeNull();
  });
});

describe('Guest links with a schedule', () => {
  async function createScheduled(schedule) {
    return request(app).post('/kortex/guest/links').set(...UA)
      .send({ destination: 'https://kaayko.com/paddlingout', title: 'Cafe', schedule });
  }

  test('creates with a validated schedule and redirects by the server clock', async () => {
    const created = await createScheduled(DAY_NIGHT);
    expect(created.status).toBe(201);
    expect(created.body.link.schedule.windows).toHaveLength(2);
    const stored = admin._mocks.docData[`short_links/${created.body.link.code}`];
    expect(stored.schedule.timezone).toBe('Asia/Kolkata');

    // Same pure function the resolver uses, evaluated now: the redirect must agree.
    const expected = S.pickScheduledDestination(DAY_NIGHT).url;
    admin._mocks.docData['tenants/' + created.body.workspace.id].plan = 'pro'; // plain 302 instead of the interstitial
    const res = await request(redirectApp).get(`/l/${created.body.link.code}`).set(...UA).set(...LANG);
    expect(res.status).toBe(302);
    expect(res.headers.location.startsWith(expected)).toBe(true);
  });

  test('a visitor cannot steer the choice from the request', async () => {
    const created = await createScheduled(DAY_NIGHT);
    admin._mocks.docData['tenants/' + created.body.workspace.id].plan = 'pro';
    const expected = S.pickScheduledDestination(DAY_NIGHT).url;
    const res = await request(redirectApp).get(`/l/${created.body.link.code}?time=03:00&tz=Pacific/Honolulu&window=night`)
      .set(...UA).set(...LANG).set('X-Forwarded-Time', '03:00');
    expect(res.status).toBe(302);
    expect(res.headers.location.startsWith(expected)).toBe(true);
  });

  test('rejects an invalid timezone and a window pointing at a private host', async () => {
    const badZone = await createScheduled({ ...DAY_NIGHT, timezone: 'Mars/Olympus' });
    expect(badZone.status).toBe(400);
    expect(badZone.body.code).toBe('VALIDATION_ERROR');

    const badUrl = await createScheduled({ timezone: 'UTC', windows: [{ start: '00:00', end: '12:00', url: 'http://192.168.1.1/admin' }] });
    expect(badUrl.status).toBe(422);
    expect(badUrl.body.code).toBe('DESTINATION_BLOCKED');
    expect(Object.keys(admin._mocks.docData).some(k => k.startsWith('tenants/'))).toBe(false);
  });

  test('the owner can change and clear the schedule; the safety check still runs on edits', async () => {
    const created = await createScheduled(DAY_NIGHT);
    const code = created.body.link.code;
    const headers = ['X-Kortex-Guest-Session', created.body.session];

    const changed = await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...headers)
      .send({ schedule: { timezone: 'Europe/London', windows: [{ label: 'lunch', start: '12:00', end: '14:00', url: 'https://kaayko.com/lunch' }] } });
    expect(changed.status).toBe(200);
    expect(changed.body.link.schedule.timezone).toBe('Europe/London');
    expect(changed.body.link.schedule.windows[0].label).toBe('lunch');

    const blocked = await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...headers)
      .send({ schedule: { timezone: 'UTC', windows: [{ start: '00:00', end: '12:00', url: 'http://127.0.0.1/' }] } });
    expect(blocked.status).toBe(422);

    const cleared = await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...headers).send({ schedule: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.link.schedule).toBeNull();
    expect(admin._mocks.docData[`short_links/${code}`].schedule).toBeNull();
  });

  test('another workspace cannot set a schedule on the link', async () => {
    const created = await createScheduled(DAY_NIGHT);
    const other = await request(app).post('/kortex/guest/links').set(...UA).send({ destination: 'https://kaayko.com/store' });
    const res = await request(app).patch(`/kortex/guest/links/${created.body.link.code}`).set(...UA)
      .set('X-Kortex-Guest-Session', other.body.session).send({ schedule: null });
    expect(res.status).toBe(404);
    expect(admin._mocks.docData[`short_links/${created.body.link.code}`].schedule.windows).toHaveLength(2);
  });
});
