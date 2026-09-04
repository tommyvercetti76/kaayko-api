/**
 * Link context fields: controlled placement keys with owner labels (pure
 * rules, then the round trip through the guest door), economics and the
 * campaign window.
 */
require('./helpers/mockSetup');
const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');
const safety = require('../api/kortex/destinationSafety');
const gate = require('../api/kortex/tenantGate');
const { PLACEMENTS, normalizePlacement, placementKey, placementDisplay } = require('../api/kortex/linkFields');

const UA = ['User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'];
let app;
beforeAll(() => { app = buildTestApp('/kortex', require('../api/kortex/smartLinks')); });
beforeEach(() => {
  admin._mocks.resetAll(); safety.resetCaches(); gate.resetCache(); delete process.env.SENDGRID_API_KEY;
  admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', email: 'admin@kaayko.com', tenantId: 'kaayko-default', tenantIds: ['kaayko-default'] };
  admin._mocks.docData['admin_users/super-admin-uid'] = { role: 'super-admin', email: 'super@kaayko.com', tenantId: 'kaayko-default' };
});
const doc = (p) => admin._mocks.docData[p];
async function createGuest(extra = {}) { return request(app).post('/kortex/guest/links').set(...UA).set('X-Forwarded-For', '203.0.113.10').send({ destination: 'https://kaayko.com/paddlingout', title: 'Poster', ...extra }); }
const KEYS = ['poster', 'flyer', 'menu', 'table_tent', 'packaging', 'badge', 'business_card', 'window', 'screen', 'vehicle', 'other'];

describe('Placement rules', () => {
  test('the controlled list is fixed, in display order, with a name for every key', () => {
    expect(PLACEMENTS.map(p => p.key)).toEqual(KEYS);
    PLACEMENTS.forEach(p => { expect(typeof p.name).toBe('string'); expect(p.name.length).toBeGreaterThan(0); });
    expect(Object.isFrozen(PLACEMENTS)).toBe(true);
  });

  test('a key, a display name, an object or legacy free text all normalise to { key, label }', () => {
    expect(normalizePlacement('table_tent')).toEqual({ key: 'table_tent', label: null });
    expect(normalizePlacement('Table tent')).toEqual({ key: 'table_tent', label: null });
    expect(normalizePlacement('  Table   Tent ')).toEqual({ key: 'table_tent', label: null });
    expect(normalizePlacement('Table-Tent')).toEqual({ key: 'table_tent', label: null });
    expect(normalizePlacement('business card')).toEqual({ key: 'business_card', label: null });
    expect(normalizePlacement('storefront')).toEqual({ key: 'window', label: null });
    expect(normalizePlacement('window')).toEqual({ key: 'window', label: null });
    expect(normalizePlacement('POSTER')).toEqual({ key: 'poster', label: null });
    expect(normalizePlacement({ key: 'poster', label: 'Lobby poster' })).toEqual({ key: 'poster', label: 'Lobby poster' });
    expect(normalizePlacement({ key: 'Table tent' })).toEqual({ key: 'table_tent', label: null });
    expect(normalizePlacement({ label: 'Lobby wall' })).toEqual({ key: 'other', label: 'Lobby wall' });
    expect(normalizePlacement('lobby wall')).toEqual({ key: 'other', label: 'lobby wall' });
    expect(normalizePlacement('instagram bio')).toEqual({ key: 'other', label: 'instagram bio' });
  });

  test('labels are plain text of at most forty characters; empty input clears', () => {
    expect(normalizePlacement({ key: 'other', label: `  ${'x'.repeat(60)}  ` }).label).toBe('x'.repeat(40));
    expect(normalizePlacement({ key: 'other', label: 'Lobby <b>wall</b>' }).label).toBe('Lobby bwall/b');
    expect(normalizePlacement({ key: 'other', label: 'line one\ttwo ' }).label).toBe('line one two');
    expect(normalizePlacement(null)).toBeNull();
    expect(normalizePlacement(undefined)).toBeNull();
    expect(normalizePlacement('')).toBeNull();
    expect(normalizePlacement('   ')).toBeNull();
    expect(normalizePlacement({})).toBeNull();
    expect(normalizePlacement({ key: null, label: '' })).toBeNull();
  });

  test('labels that look like an email, a phone number or a web address are refused; so are unknown keys and non-text', () => {
    const rejects = (input) => { let code = null; try { normalizePlacement(input); } catch (e) { code = e.code; } expect(code).toBe('VALIDATION_ERROR'); };
    rejects('rohan@example.com');
    rejects({ key: 'other', label: 'call +1 415 555 0100' });
    rejects('(020) 7946 0958');
    rejects('https://kaayko.com/x');
    rejects('kaayko.com/menu');
    rejects('www.kaayko.com');
    rejects({ key: 'poster', label: '//cdn.example.net' });
    rejects({ key: 'castle' });
    rejects({ key: 'poster', label: 42 });
    rejects(5);
    rejects(['poster']);
    expect(normalizePlacement('poster near st. john')).toEqual({ key: 'other', label: 'poster near st. john' });
    expect(normalizePlacement('table 4')).toEqual({ key: 'other', label: 'table 4' });
  });

  test('placementDisplay shows the label, else the controlled name, and copes with legacy free text', () => {
    expect(placementDisplay({ placement: 'table_tent', placementLabel: null })).toBe('Table tent');
    expect(placementDisplay({ placement: 'window', placementLabel: 'Front glass' })).toBe('Front glass');
    expect(placementDisplay({ placement: 'table tent' })).toBe('Table tent');
    expect(placementDisplay({ placement: 'lobby wall' })).toBe('lobby wall');
    expect(placementDisplay({ placement: 'other', placementLabel: null })).toBe('Other');
    expect(placementDisplay({ placement: null })).toBeNull();
    expect(placementDisplay({})).toBeNull();
    expect(placementKey({ placement: 'table tent' })).toBe('table_tent');
    expect(placementKey({ placement: 'lobby wall' })).toBe('other');
    expect(placementKey({ placement: 'menu' })).toBe('menu');
    expect(placementKey({})).toBeNull();
  });
});

describe('Link context fields through the guest door', () => {
  test('placement is stored as key + label, shown by label, cleared by null, and refused when the label is personal data', async () => {
    const created = await createGuest({ placement: ' Table Tent ' });
    expect(created.status).toBe(201);
    expect(created.body.link.placement).toBe('table_tent');
    expect(created.body.link.placementLabel).toBeNull();
    const code = created.body.link.code; const session = ['X-Kortex-Guest-Session', created.body.session];
    expect(doc(`short_links/${code}`)).toMatchObject({ placement: 'table_tent', placementLabel: null });

    const labelled = await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...session).send({ placement: { key: 'other', label: 'Lobby wall' } });
    expect(labelled.status).toBe(200);
    expect(labelled.body.link).toMatchObject({ placement: 'other', placementLabel: 'Lobby wall' });
    const analytics = await request(app).get(`/kortex/guest/links/${code}/analytics`).set(...UA).set(...session);
    expect(analytics.body.analytics.insights.placement.headline).toMatch(/Lobby wall/);
    expect(analytics.body.analytics.insights.placement.metrics.placement).toBe('other');

    const personal = await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...session).send({ placement: { key: 'other', label: 'call 415 555 0100' } });
    expect(personal.status).toBe(400);
    expect(personal.body.code).toBe('VALIDATION_ERROR');
    expect((await createGuest({ placement: 'me@example.com' })).status).toBe(400);

    const cleared = await request(app).patch(`/kortex/guest/links/${code}`).set(...UA).set(...session).send({ placement: null });
    expect(cleared.body.link.placement).toBeNull();
    expect(cleared.body.link.placementLabel).toBeNull();
    expect(doc(`short_links/${code}`).placementLabel).toBeNull();
  });

  test('economics and a campaign window round-trip and are validated', async () => {
    const created = await createGuest({ economics: { printCost: 40, valuePerVisit: 1.5, currency: 'inr' }, campaignWindow: { startAt: '2026-09-01', endAt: '2026-09-30' } });
    expect(created.status).toBe(201);
    expect(created.body.link.economics).toEqual({ printCost: 40, valuePerVisit: 1.5, currency: 'INR' });
    expect(created.body.link.campaignWindow.startAt).toMatch(/^2026-09-01/);
    expect((await createGuest({ economics: { printCost: -5 } })).status).toBe(400);
    const session = ['X-Kortex-Guest-Session', created.body.session];
    const cleared = await request(app).patch(`/kortex/guest/links/${created.body.link.code}`).set(...UA).set(...session).send({ economics: null, campaignWindow: null });
    expect(cleared.body.link.economics).toBeNull();
    expect(cleared.body.link.campaignWindow).toBeNull();
    const a = await request(app).get(`/kortex/guest/links/${created.body.link.code}/analytics`).set(...UA).set(...session);
    expect(a.body.analytics.insights.roi.status).toBe('none');
    expect(a.body.analytics.insights.roi.title).toBe('Estimated print payback');
  });
});
