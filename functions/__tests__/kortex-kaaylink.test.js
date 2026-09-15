/**
 * kaay.link — the short-link host. The router claims requests addressed to a
 * link host (root, /qr/<code>, /<slug>) and 404s everything else there; any
 * other host passes through untouched. Scans on kaay.link record the host.
 */

require('./helpers/mockSetup');

jest.mock('../middleware/securityMiddleware', () => ({
  secureHeaders: (req, res, next) => next(),
  botProtection: (req, res, next) => next(),
  rateLimiter: () => (req, res, next) => next(),
  honeypot: (req, res) => res.status(200).json({ success: true, honeypot: true }),
}));

const request = require('supertest');
const express = require('express');
const admin = require('firebase-admin');
const hosts = require('../api/kortex/linkHosts');
const { assertDestinationAllowed } = require('../api/kortex/domainPolicy');

const BROWSER = ['User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'];
const LANG = ['Accept-Language', 'en-IN,en;q=0.9'];
const settle = () => new Promise(r => setTimeout(r, 60));

let app;
beforeAll(() => {
  app = express();
  app.use(require('../api/kortex/kaayLinkRouter'));
  // What sits behind the router on kaayko.com: the legacy /l/ resolver.
  app.use('/', require('../api/kortex/deeplinkRoutes'));
  app.get('/kortex/guest/capabilities', (req, res) => res.json({ reached: 'api' }));
});
beforeEach(() => admin._mocks.resetAll());

const clickEvents = () => Object.keys(admin._mocks.docData).filter(k => k.startsWith('click_events/')).map(k => admin._mocks.docData[k]);
const houseLink = (code, extra = {}) => {
  admin._mocks.docData[`short_links/${code}`] = {
    code, tenantId: 'kaayko-default', enabled: true, title: code, clickCount: 0,
    destinations: { web: 'https://kaayko.com/paddlingout', ios: null, android: null }, ...extra
  };
};

describe('linkHosts', () => {
  test('knows the link hosts and reads x-forwarded-host first', () => {
    expect(hosts.isLinkHost('kaay.link')).toBe(true);
    expect(hosts.isLinkHost('KAAY.LINK')).toBe(true);
    expect(hosts.isLinkHost('kaay-link.web.app')).toBe(true);
    expect(hosts.isLinkHost('kaayko.com')).toBe(false);
    expect(hosts.requestHost({ headers: { host: 'api-x.a.run.app', 'x-forwarded-host': 'kaay.link' } })).toBe('kaay.link');
    expect(hosts.requestHost({ headers: { host: 'kaay.link:443' } })).toBe('kaay.link');
  });

  test('slug rules: shape and reserved words', () => {
    expect(hosts.isValidSlug('kx-abc123')).toBe(true);
    expect(hosts.isValidSlug('lk1ngp')).toBe(true);
    expect(hosts.isValidSlug('ab')).toBe(false);
    expect(hosts.isValidSlug('-abc')).toBe(false);
    expect(hosts.isValidSlug('a.b')).toBe(false);
    expect(hosts.isReservedSlug('api')).toBe(true);
    expect(hosts.isReservedSlug('Admin')).toBe(true);
    expect(hosts.isReservedSlug('paddle')).toBe(false);
    expect(hosts.shortUrlFor('kx-abc123')).toBe('https://kaay.link/kx-abc123');
  });
});

describe('kaay.link host', () => {
  test('root goes to the Kortex page', async () => {
    const res = await request(app).get('/').set('Host', 'kaay.link');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(hosts.ROOT_REDIRECT);
  });

  test('a slug resolves the same link as kaayko.com/l/<code>, and the event records the host', async () => {
    houseLink('kx-abc123');
    const res = await request(app).get('/kx-abc123?s=qr').set('Host', 'kaay.link').set(...BROWSER).set(...LANG);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/kaayko\.com\/paddlingout/);
    await settle();
    const events = clickEvents();
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({ source: 'qr', host: 'kaay.link' });
  });

  test('the same scan on kaayko.com/l records no host (legacy form)', async () => {
    houseLink('kx-abc123');
    const res = await request(app).get('/l/kx-abc123').set('Host', 'kaayko.com').set(...BROWSER).set(...LANG);
    expect(res.status).toBe(302);
    await settle();
    expect(clickEvents()[0].metadata.host).toBeNull();
  });

  test('www and the web.app host count as link hosts too', async () => {
    houseLink('kx-abc123');
    for (const host of ['www.kaay.link', 'kaay-link.web.app']) {
      const res = await request(app).get('/kx-abc123').set('Host', host).set(...BROWSER).set(...LANG);
      expect(res.status).toBe(302);
    }
  });

  test('a mixed-case slug folds to the lowercase code', async () => {
    houseLink('lk1ngp');
    const res = await request(app).get('/LK1NGP').set('Host', 'kaay.link').set(...BROWSER).set(...LANG);
    expect(res.status).toBe(302);
  });

  test('unknown, reserved and malformed slugs are 404s', async () => {
    for (const path of ['/nope99', '/api', '/admin', '/kortex', '/ab', '/-bad', '/a.b']) {
      const res = await request(app).get(path).set('Host', 'kaay.link').set(...BROWSER);
      expect(res.status).toBe(404);
    }
  });

  test('nothing deeper than one segment is served on kaay.link — the API is unreachable there', async () => {
    houseLink('kx-abc123');
    for (const path of ['/kortex/guest/capabilities', '/api/kortex/guest/capabilities', '/l/kx-abc123', '/kx-abc123/extra', '/health', '/resolve']) {
      const res = await request(app).get(path).set('Host', 'kaay.link').set(...BROWSER);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('reached');
    }
    const post = await request(app).post('/kx-abc123').set('Host', 'kaay.link');
    expect(post.status).toBe(404);
  });

  test('the QR image is served on kaay.link', async () => {
    houseLink('kx-abc123', { shortUrl: 'https://kaay.link/kx-abc123' });
    const res = await request(app).get('/qr/kx-abc123.svg').set('Host', 'kaay.link');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/svg/);
  });

  test('other hosts pass through: the API and /l/ still work on kaayko.com', async () => {
    houseLink('kx-abc123');
    const api = await request(app).get('/kortex/guest/capabilities').set('Host', 'kaayko.com');
    expect(api.body).toEqual({ reached: 'api' });
    const legacy = await request(app).get('/l/kx-abc123').set('Host', 'api-vwcc5j4qda-uc.a.run.app').set(...BROWSER).set(...LANG);
    expect(legacy.status).toBe(302);
  });
});

describe('self-link guard', () => {
  test('a destination on kaay.link or kaayko.com/l/ is refused on every path', () => {
    for (const url of ['https://kaay.link/abc', 'https://www.kaay.link/abc', 'https://kaayko.com/l/lk1ngp', 'https://kaayko.com/l']) {
      expect(() => assertDestinationAllowed({ webDestination: url, tenantId: 'kaayko-default', bypass: true })).toThrow(/another short link/);
    }
  });
  test('ordinary kaayko.com pages are still fine', () => {
    expect(() => assertDestinationAllowed({ webDestination: 'https://kaayko.com/paddlingout', tenantId: 'kaayko-default' })).not.toThrow();
    expect(() => assertDestinationAllowed({ webDestination: 'https://kaayko.com/lakes/x', tenantId: 'kaayko-default' })).not.toThrow();
  });
});
