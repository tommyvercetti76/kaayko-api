/**
 * Redirect-path changes from the trust pass: held/blocked pages on every
 * resolver, crawlers not counted as clicks, search engines not blocked, the
 * house tenant served a real 302, and the API resolver honouring link gates.
 */

require('./helpers/mockSetup');

jest.mock('../middleware/securityMiddleware', () => ({
  secureHeaders: (req, res, next) => next(),
  botProtection: (req, res, next) => next(),
  rateLimiter: () => (req, res, next) => next(),
  honeypot: (req, res) => res.status(200).json({ success: true, honeypot: true }),
}));

const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');

const BROWSER = ['User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'];
const LANG = ['Accept-Language', 'en-IN,en;q=0.9'];
const GOOGLEBOT = ['User-Agent', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'];
const WHATSAPP = ['User-Agent', 'WhatsApp/2.23.20 A'];

let redirectApp;
let apiApp;
let alumniApp;
beforeAll(() => {
  redirectApp = buildTestApp('/', require('../api/kortex/deeplinkRoutes'));
  apiApp = buildTestApp('/kortex', require('../api/kortex/smartLinks'));
  alumniApp = buildTestApp('/', require('../api/kortex/tenantLinkResolver'));
});
beforeEach(() => admin._mocks.resetAll());

const clickEvents = () => Object.keys(admin._mocks.docData).filter(k => k.startsWith('click_events/'));

const houseLink = (code, extra = {}) => {
  admin._mocks.docData[`short_links/${code}`] = {
    code, tenantId: 'kaayko-default', enabled: true, title: code, clickCount: 0,
    destinations: { web: 'https://kaayko.com/paddlingout', ios: null, android: null }, ...extra
  };
};
const tenantLink = (code, extra = {}) => {
  admin._mocks.docData['tenants/tenant-a'] = { name: 'Tenant A', enabled: true, plan: 'starter', slug: 'tenant-a' };
  admin._mocks.docData[`short_links/${code}`] = {
    code, tenantId: 'tenant-a', enabled: true, title: code, clickCount: 0,
    destinations: { web: 'https://tenant-a.test/landing', ios: null, android: null }, ...extra
  };
};

describe('Held and blocked links', () => {
  test('a held link serves the review page with no click recorded', async () => {
    tenantLink('held1', { status: 'held' });
    const res = await request(redirectApp).get('/l/held1').set(...BROWSER).set(...LANG);
    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.text).toContain('being reviewed');
    expect(res.text).toContain('/kortex/appeal?code=held1');
    expect(clickEvents()).toHaveLength(0);
    expect(admin._mocks.docData['short_links/held1'].clickCount).toBe(0);
  });

  test('a blocked link answers 410 with the appeal link', async () => {
    tenantLink('blk1', { status: 'blocked' });
    const res = await request(redirectApp).get('/l/blk1').set(...BROWSER).set(...LANG);
    expect(res.status).toBe(410);
    expect(res.text).toContain('has been disabled');
    expect(clickEvents()).toHaveLength(0);
  });

  test('the alumni-host resolver honours the same states', async () => {
    tenantLink('al-blocked', { status: 'blocked' });
    const res = await request(alumniApp).get('/tenant-a/al-blocked').set('Host', 'alumni.kaayko.com').set(...BROWSER).set(...LANG);
    expect(res.status).toBe(410);
    expect(res.text).toContain('has been disabled');
  });

  test('the API resolver refuses held, blocked, disabled and expired links', async () => {
    tenantLink('r-held', { status: 'held' });
    tenantLink('r-blocked', { status: 'blocked' });
    tenantLink('r-off', { enabled: false });
    tenantLink('r-old', { expiresAt: new Date(Date.now() - 86400000).toISOString() });
    tenantLink('r-ok');
    const codes = { 'r-held': 409, 'r-blocked': 410, 'r-off': 410, 'r-old': 410, 'r-ok': 200 };
    for (const [code, status] of Object.entries(codes)) {
      const res = await request(apiApp).get(`/kortex/links/${code}/resolve`).set(...BROWSER);
      expect([code, res.status]).toEqual([code, status]);
    }
    // The gated ones must not have bumped a counter.
    expect(admin._mocks.docData['short_links/r-held'].clickCount).toBe(0);
    expect(admin._mocks.docData['short_links/r-blocked'].clickCount).toBe(0);
  });
});

describe('Crawlers and the house tenant', () => {
  test('a Kaayko-owned link is a plain 302, not the Powered-by interstitial', async () => {
    houseLink('house1');
    const res = await request(redirectApp).get('/l/house1').set(...BROWSER).set(...LANG);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://kaayko.com/paddlingout');
    expect(clickEvents()).toHaveLength(1);
  });

  test('a starter tenant still gets the interstitial for real visitors', async () => {
    tenantLink('starter1');
    const res = await request(redirectApp).get('/l/starter1').set(...BROWSER).set(...LANG);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Powered by');
  });

  test('Googlebot is served the destination and is not counted as a click', async () => {
    tenantLink('seo1');
    const res = await request(redirectApp).get('/l/seo1').set(...GOOGLEBOT);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://tenant-a.test/landing');
    expect(clickEvents()).toHaveLength(0);
    expect(admin._mocks.docData['short_links/seo1'].clickCount).toBe(0);
  });

  test('a WhatsApp preview fetch is not counted as a click', async () => {
    houseLink('wa1');
    const res = await request(redirectApp).get('/l/wa1').set(...WHATSAPP);
    expect(res.status).toBe(302);
    expect(clickEvents()).toHaveLength(0);
  });

  test('a UA-less client is still refused', async () => {
    houseLink('nouа1');
    const res = await request(redirectApp).get('/l/nouа1');
    expect(res.status).toBe(404);
  });
});
