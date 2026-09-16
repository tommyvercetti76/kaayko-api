/** Guest tools added 16 Sep 2026: the routing preview, ending a workspace, the public status. */
require('./helpers/mockSetup');
const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');
const safety = require('../api/kortex/destinationSafety');
const UA = ['User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'];
let app;
beforeAll(() => { app = buildTestApp('/kortex', require('../api/kortex/smartLinks')); });
beforeEach(() => { admin._mocks.resetAll(); safety.resetCaches(); });
const docs = (prefix) => Object.keys(admin._mocks.docData).filter(k => k.startsWith(prefix));

async function makeWorkspace() {
  const res = await request(app).post('/kortex/guest/links').set(...UA).send({ destination: 'https://kaayko.com/paddlingout', title: 'Poster', schedule: { timezone: 'Asia/Kolkata', windows: [{ label: 'night', start: '18:00', end: '06:00', url: 'https://kaayko.com/paddlingout?after=hours' }] } });
  expect(res.status).toBe(201);
  return { session: res.body.session, code: res.body.link.code, accessCode: res.body.accessCode };
}

test('preview says what the code does for a phone at a moment, and why', async () => {
  const { session, code } = await makeWorkspace();
  const night = Date.parse('2026-09-16T16:30:00Z');
  const r = await request(app).get(`/kortex/guest/links/${code}/preview?platform=ios&at=${night}`).set(...UA).set('Authorization', `Bearer ${session}`);
  expect(r.status).toBe(200);
  expect(r.body.preview).toMatchObject({ platform: 'ios', outcome: 'delivered', destination: 'https://kaayko.com/paddlingout?after=hours' });
  expect(r.body.preview.steps.some(s => s.rule === 'window' && s.hit)).toBe(true);
  const bad = await request(app).get(`/kortex/guest/links/${code}/preview?at=whenever`).set(...UA).set('Authorization', `Bearer ${session}`);
  expect(bad.status).toBe(400);
});

test('the owner can end the workspace with the access code; links, scans and the workspace go', async () => {
  const { session, code, accessCode } = await makeWorkspace();
  admin._mocks.docData[`click_events/ev1`] = { linkCode: code, tenantId: 'x' };
  admin._mocks.docData[`link_answers/${code}_abc`] = { code, choice: 'yes' };
  const wrong = await request(app).delete('/kortex/guest/workspace').set(...UA).set('Authorization', `Bearer ${session}`).send({ accessCode: 'KX-NOPE00-AAAA-BBBB-CCCC-DDDD' });
  expect([400, 401, 403]).toContain(wrong.status);
  expect(docs(`short_links/${code}`)).toHaveLength(1);
  const r = await request(app).delete('/kortex/guest/workspace').set(...UA).set('Authorization', `Bearer ${session}`).send({ accessCode });
  expect(r.status).toBe(200);
  expect(r.body.deleted).toMatchObject({ links: 1, events: 1, answers: 1 });
  expect(docs(`short_links/${code}`)).toHaveLength(0);
  expect(docs('click_events/')).toHaveLength(0);
  expect(docs('link_answers/')).toHaveLength(0);
  expect(docs('tenants/')).toHaveLength(0);
});

test('status is public and reports the last probe', async () => {
  const none = await request(app).get('/kortex/guest/status').set(...UA);
  expect(none.status).toBe(200);
  expect(none.body.known).toBe(false);
  const now = Date.now();
  admin._mocks.docData['kortex_status/probe'] = { atMs: now, ok: true, checks: [{ name: 'phone', status: 200, ms: 120, ok: true }], recent: [{ atMs: now - 3600000, ok: false }, { atMs: now, ok: true }, { atMs: now - 3 * 86400000, ok: false }] };
  const r = await request(app).get('/kortex/guest/status').set(...UA);
  expect(r.body).toMatchObject({ known: true, ok: true, last24h: { runs: 2, ok: 1, ratio: 0.5 } });
});
