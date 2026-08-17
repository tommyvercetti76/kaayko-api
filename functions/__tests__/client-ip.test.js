const { getClientIp, isPublic, normalise } = require('../api/kortex/clientIp');

const req = (xff, direct) => ({
  headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
  ip: direct,
  connection: {},
  socket: {},
});

describe('getClientIp', () => {
  test('reads the proxy-appended address, not the client-supplied one', () => {
    // Google appends the real address to whatever the caller sent.
    expect(getClientIp(req('1.2.3.4, 203.0.113.9'))).toBe('203.0.113.9');
  });

  test('a spoofed public IP cannot displace the real one', () => {
    const spoofed = getClientIp(req('8.8.8.8, 198.51.100.7'));
    expect(spoofed).toBe('198.51.100.7');
    expect(spoofed).not.toBe('8.8.8.8');
  });

  test('skips proxy hops that are private and returns the real client', () => {
    expect(getClientIp(req('203.0.113.9, 10.0.0.5, 127.0.0.1'))).toBe('203.0.113.9');
  });

  test('returns null rather than a shared sentinel when only private hops exist', () => {
    // The old code collapsed every visitor onto ::ffff:127.0.0.1, which broke
    // unique counting and made per-IP rate limits global. Null keeps callers honest.
    expect(getClientIp(req('10.0.0.5, 127.0.0.1'))).toBeNull();
    expect(getClientIp(req(undefined, '::ffff:127.0.0.1'))).toBeNull();
  });

  test('falls back to the direct socket address when it is publicly routable', () => {
    expect(getClientIp(req(undefined, '203.0.113.9'))).toBe('203.0.113.9');
  });

  test('normalises IPv6-mapped IPv4 and stray ports', () => {
    expect(normalise('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(normalise('203.0.113.9:51234')).toBe('203.0.113.9');
    expect(normalise('  203.0.113.9  ')).toBe('203.0.113.9');
  });

  test('preserves IPv6 addresses instead of truncating at a colon', () => {
    expect(getClientIp(req('2001:db8::1'))).toBe('2001:db8::1');
  });

  test('rejects every private and reserved range', () => {
    for (const ip of ['10.1.1.1', '192.168.0.1', '172.16.0.1', '172.31.255.255',
                      '127.0.0.1', '169.254.1.1', '100.64.0.1', '::1',
                      'fe80::1', 'fd00::1', '0.0.0.0']) {
      expect(isPublic(ip)).toBe(false);
    }
    for (const ip of ['203.0.113.9', '8.8.8.8', '172.32.0.1', '2001:db8::1']) {
      expect(isPublic(ip)).toBe(true);
    }
  });

  test('survives malformed input without throwing', () => {
    expect(getClientIp(req(''))).toBeNull();
    expect(getClientIp(req(',,,'))).toBeNull();
    expect(getClientIp(null)).toBeNull();
  });
});
