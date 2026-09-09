require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const admin = require('firebase-admin');

const { publicCards, listCards, updateCard, updateBrand } = require('../api/admin/cards');

/** The admin routes run behind requireAuth/requirePlatformAdmin in production;
 *  here we stub the identity they leave on the request and exercise the
 *  handlers directly. The public route gets no identity at all, on purpose. */
function app() {
  const a = express();
  a.use(express.json());
  const asAdmin = (req, _res, next) => { req.user = { uid: 'admin-uid', email: 'owner@kaayko.com' }; next(); };
  a.get('/cards', publicCards);
  a.get('/admin/cards', asAdmin, listCards);
  a.patch('/admin/cards', asAdmin, updateBrand);
  a.patch('/admin/cards/:slug', asAdmin, updateCard);
  return a;
}

const card = (over = {}) => ({
  n: 1, name: 'Store', hook: 'Your style sucks. Heal here.',
  url: 'https://kaay.store', host: 'kaay.store', accent: '#8A5A2B',
  art: 'kaayko', live: true, ...over
});

beforeEach(() => {
  for (const key of Object.keys(admin._mocks.docData)) delete admin._mocks.docData[key];
});

describe('Cards — reading', () => {
  test('the public route hides a card that is not live; the admin route shows it', async () => {
    admin._mocks.docData['kaaykocards/kaayko'] = card();
    admin._mocks.docData['kaaykocards/forge'] = card({ n: 3, name: 'Forge', art: 'forge', live: false });

    const pub = await request(app()).get('/cards');
    expect(pub.status).toBe(200);
    expect(pub.body.cards.map((c) => c.slug)).toEqual(['kaayko']);

    const adm = await request(app()).get('/admin/cards');
    expect(adm.body.cards.map((c) => c.slug).sort()).toEqual(['forge', 'kaayko']);
  });

  test('cards come back in printing order, not document order', async () => {
    admin._mocks.docData['kaaykocards/alumni'] = card({ n: 5, name: 'Alumni', art: 'alumni' });
    admin._mocks.docData['kaaykocards/kaayko'] = card({ n: 1 });
    admin._mocks.docData['kaaykocards/forge'] = card({ n: 3, name: 'Forge', art: 'forge' });

    const res = await request(app()).get('/cards');
    expect(res.body.cards.map((c) => c.n)).toEqual([1, 3, 5]);
  });

  test('no QR is ever stored — it is drawn from the URL', async () => {
    admin._mocks.docData['kaaykocards/kaayko'] = card();
    const res = await request(app()).get('/cards');
    expect(res.body.cards[0]).not.toHaveProperty('qr');
    expect(res.body.cards[0].url).toBe('https://kaay.store');
  });
});

describe('Cards — writing', () => {
  test('an ordinary copy change saves', async () => {
    admin._mocks.docData['kaaykocards/kaayko'] = card();
    const res = await request(app()).patch('/admin/cards/kaayko').send({ name: 'Shop' });
    expect(res.status).toBe(200);
    expect(res.body.card.name).toBe('Shop');
  });

  test('copy too long to fit the card is refused with the reason, not truncated', async () => {
    admin._mocks.docData['kaaykocards/kaayko'] = card();
    const res = await request(app()).patch('/admin/cards/kaayko')
      .send({ name: 'A name far too long to sit in that column' });
    expect(res.status).toBe(400);
    expect(res.body.problems.name).toMatch(/24 characters/);
  });

  test('a non-https URL is refused — the QR is printed and cannot be corrected later', async () => {
    admin._mocks.docData['kaaykocards/kaayko'] = card();
    const res = await request(app()).patch('/admin/cards/kaayko').send({ url: 'http://kaay.store' });
    expect(res.status).toBe(400);
    expect(res.body.problems.url).toMatch(/https/);
  });

  test('a URL that is not a URL is refused', async () => {
    admin._mocks.docData['kaaykocards/kaayko'] = card();
    const res = await request(app()).patch('/admin/cards/kaayko').send({ url: 'kaay.store' });
    expect(res.status).toBe(400);
  });

  test('art must name a file that exists', async () => {
    admin._mocks.docData['kaaykocards/kaayko'] = card();
    const bad = await request(app()).patch('/admin/cards/kaayko').send({ art: 'ostrich' });
    expect(bad.status).toBe(400);
    const good = await request(app()).patch('/admin/cards/kaayko').send({ art: 'forge' });
    expect(good.status).toBe(200);
  });

  test('the slug is refused by name, so the UI can say why', async () => {
    admin._mocks.docData['kaaykocards/kaayko'] = card();
    const res = await request(app()).patch('/admin/cards/kaayko').send({ slug: 'store' });
    expect(res.status).toBe(400);
    expect(res.body.problems.slug).toMatch(/set once/);
  });

  test('an unknown field is refused rather than silently written', async () => {
    admin._mocks.docData['kaaykocards/kaayko'] = card();
    const res = await request(app()).patch('/admin/cards/kaayko').send({ price: 9 });
    expect(res.status).toBe(400);
    expect(res.body.problems.price).toBeTruthy();
    expect(admin._mocks.docData['kaaykocards/kaayko'].price).toBeUndefined();
  });

  test('one bad field rejects the whole patch — no half-saved card', async () => {
    admin._mocks.docData['kaaykocards/kaayko'] = card();
    const res = await request(app()).patch('/admin/cards/kaayko')
      .send({ name: 'Shop', accent: 'crimson' });
    expect(res.status).toBe(400);
    expect(admin._mocks.docData['kaaykocards/kaayko'].name).toBe('Store');
  });

  test('an unknown card is a 404, not a new document', async () => {
    const res = await request(app()).patch('/admin/cards/ostrich').send({ name: 'Nope' });
    expect(res.status).toBe(404);
    expect(admin._mocks.docData['kaaykocards/ostrich']).toBeUndefined();
  });

  test('the shared back-of-card block saves on its own', async () => {
    const res = await request(app()).patch('/admin/cards').send({ contact: 'hello@kaayko.com' });
    expect(res.status).toBe(200);
    expect(res.body.brand.contact).toBe('hello@kaayko.com');
  });

  test('a field that is not on the card back is refused', async () => {
    const res = await request(app()).patch('/admin/cards').send({ hook: 'nope' });
    expect(res.status).toBe(400);
  });
});
