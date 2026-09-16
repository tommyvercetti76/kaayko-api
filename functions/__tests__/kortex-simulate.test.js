/** The routing simulator answers "what would this code do, for this phone, now?" in the redirect's own order. */
const { simulate } = require('../api/kortex/linkSimulate');

const base = { code: 'kx-sim', enabled: true, status: 'active', destinations: { web: 'https://a.example/day', ios: 'https://apps.apple.com/x', android: null }, clickCount: 0 };

describe('simulate', () => {
  test('default, device, then a night window in the link\'s own zone', () => {
    const link = { ...base, schedule: { timezone: 'Asia/Kolkata', windows: [{ label: 'night', start: '18:00', end: '06:00', url: 'https://a.example/night' }] } };
    const noon = Date.parse('2026-09-16T06:30:00Z');       // 12:00 IST
    expect(simulate(link, { platform: 'web', at: noon })).toMatchObject({ outcome: 'delivered', destination: 'https://a.example/day' });
    expect(simulate(link, { platform: 'ios', at: noon })).toMatchObject({ outcome: 'delivered', destination: 'https://apps.apple.com/x' });
    expect(simulate(link, { platform: 'android', at: noon }).destination).toBe('https://a.example/day');
    const night = Date.parse('2026-09-16T16:30:00Z');      // 22:00 IST
    const r = simulate(link, { platform: 'ios', at: night });
    expect(r.destination).toBe('https://a.example/night');
    expect(r.steps.find(s => s.rule === 'window').hit).toBe(true);
    expect(r.timeZone).toBe('Asia/Kolkata');
  });

  test('the earlier rules stop the chain: workspace off, held, paused, cap with and without fallback, end date', () => {
    expect(simulate(base, { gate: { enabled: false } }).outcome).toBe('workspace_off');
    expect(simulate({ ...base, status: 'held' }).outcome).toBe('held');
    expect(simulate({ ...base, enabled: false }).outcome).toBe('paused');
    expect(simulate({ ...base, limits: { maxClicks: 10 }, clickCount: 10 })).toMatchObject({ outcome: 'capped', destination: null });
    expect(simulate({ ...base, limits: { maxClicks: 10, fallbackUrl: 'https://a.example/full' }, clickCount: 10 })).toMatchObject({ outcome: 'fallback', destination: 'https://a.example/full' });
    expect(simulate({ ...base, expiresAt: '2026-01-01T00:00:00Z' }, { at: Date.parse('2026-09-16T00:00:00Z') }).outcome).toBe('capped');
    expect(simulate({ ...base, expiresAt: '2027-01-01T00:00:00Z' }, { at: Date.parse('2026-09-16T00:00:00Z') }).outcome).toBe('delivered');
  });

  test('an unknown platform is web; a bad moment is now', () => {
    const r = simulate(base, { platform: 'toaster', at: 'not a date' });
    expect(r.platform).toBe('web');
    expect(r.outcome).toBe('delivered');
  });
});
