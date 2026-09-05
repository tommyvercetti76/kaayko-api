require('./helpers/mockSetup');
const request = require('supertest');
const express = require('express');
const admin = require('firebase-admin');

const { listProducts, updateProduct, priceSymbolFor } = require('../api/admin/products');
const { resolveCart } = require('../api/checkout/pricing');

/** The admin routes run behind requireAuth/requireAdmin in production; here we
 *  stub the identity they leave on the request and exercise the handlers. */
function adminApp() {
  const app = express();
  app.use(express.json());
  const asAdmin = (req, _res, next) => { req.user = { uid: 'admin-uid', email: 'owner@kaayko.com' }; next(); };
  app.get('/admin/products', asAdmin, listProducts);
  app.patch('/admin/products/:id', asAdmin, updateProduct);
  return app;
}

const baseProduct = {
  title: 'Broke',
  description: "No you ain't!",
  price: '$$$',
  actualPrice: 39.99,
  productID: 'kaayko_broke_tshirt',
  availableSizes: ['S', 'M', 'L'],
  productType: 'tshirt',
  category: 'apparel',
  isAvailable: true,
  imgSrc: ['https://example.test/a.webp']
};

const auditDocs = () =>
  Object.entries(admin._mocks.docData)
    .filter(([p]) => p.startsWith('product_audit/'))
    .map(([, d]) => d);

describe('Admin products — listing', () => {
  test('returns hidden and sold-out products, which the public route must not', async () => {
    admin._mocks.docData['kaaykoproducts/live'] = { ...baseProduct, title: 'Live' };
    admin._mocks.docData['kaaykoproducts/hidden'] = { ...baseProduct, title: 'Hidden', isAvailable: false };
    admin._mocks.docData['kaaykoproducts/gone'] = { ...baseProduct, title: 'Gone', soldOut: true };

    const res = await request(adminApp()).get('/admin/products');

    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(3);
    const byTitle = Object.fromEntries(res.body.products.map(p => [p.title, p]));
    expect(byTitle.Hidden.isAvailable).toBe(false);
    expect(byTitle.Gone.soldOut).toBe(true);
    expect(byTitle.Live.isAvailable).toBe(true);
  });
});

describe('Admin products — the write whitelist', () => {
  beforeEach(() => { admin._mocks.docData['kaaykoproducts/p1'] = { ...baseProduct }; });

  test('names an unknown field rather than ignoring it', async () => {
    const res = await request(adminApp()).patch('/admin/products/p1').send({ sneaky: 'value' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sneaky: not an editable field/);
  });

  test('refuses a checkout-critical field with the reason', async () => {
    const res = await request(adminApp()).patch('/admin/products/p1').send({ price: '$' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/price: derived from actualPrice/);
  });

  test('refuses images — those belong to the image editor', async () => {
    const res = await request(adminApp()).patch('/admin/products/p1').send({ imgSrc: ['https://evil.test/x.png'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/imgSrc: images are managed/);
  });

  test('rejects the whole request when one field of several is bad', async () => {
    const res = await request(adminApp()).patch('/admin/products/p1').send({ title: 'Fine', actualPrice: 9999 });
    expect(res.status).toBe(400);
    expect(admin._mocks.docData['kaaykoproducts/p1'].title).toBe('Broke'); // nothing applied
  });
});

describe('Admin products — price safety', () => {
  beforeEach(() => { admin._mocks.docData['kaaykoproducts/p1'] = { ...baseProduct }; });

  test.each([
    [0.5, 'below the floor'],
    [600, 'above the ceiling'],
    [34.999, 'more than 2 decimal places'],
    ['free', 'not a number']
  ])('rejects %p (%s)', async (value) => {
    const res = await request(adminApp()).patch('/admin/products/p1').send({ actualPrice: value });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/actualPrice/);
  });

  test('accepts a valid price and keeps the legacy tier symbol in step', async () => {
    const res = await request(adminApp()).patch('/admin/products/p1').send({ actualPrice: 29.99 });
    expect(res.status).toBe(200);
    const saved = admin._mocks.docData['kaaykoproducts/p1'];
    expect(saved.actualPrice).toBe(29.99);
    expect(saved.price).toBe('$$');           // 2999 tier — never left pointing at $$$
  });

  test('the tier symbol comes from the same table checkout prices from', () => {
    expect(priceSymbolFor(19.99)).toBe('$');
    expect(priceSymbolFor(29.99)).toBe('$$');
    expect(priceSymbolFor(39.99)).toBe('$$$');
    expect(priceSymbolFor(49.99)).toBe('$$$$');
    expect(priceSymbolFor(5)).toBe('$');       // below every tier, still the cheapest
  });
});

describe('Admin products — sizes', () => {
  beforeEach(() => { admin._mocks.docData['kaaykoproducts/p1'] = { ...baseProduct }; });

  // resolveSize() treats an empty availableSizes as "accept any free-form size",
  // so saving one would silently switch off size validation for that SKU.
  test('refuses an empty size list', async () => {
    const res = await request(adminApp()).patch('/admin/products/p1').send({ availableSizes: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/availableSizes.*at least 1/i);
  });

  test('refuses duplicate sizes', async () => {
    const res = await request(adminApp()).patch('/admin/products/p1').send({ availableSizes: ['M', 'm'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unique/);
  });

  test('accepts and trims a good list', async () => {
    const res = await request(adminApp()).patch('/admin/products/p1').send({ availableSizes: [' S ', 'M', 'L', 'XL'] });
    expect(res.status).toBe(200);
    expect(admin._mocks.docData['kaaykoproducts/p1'].availableSizes).toEqual(['S', 'M', 'L', 'XL']);
  });
});

describe('Admin products — audit trail', () => {
  beforeEach(() => { admin._mocks.docData['kaaykoproducts/p1'] = { ...baseProduct }; });

  test('records who changed what, from and to', async () => {
    await request(adminApp()).patch('/admin/products/p1').send({ actualPrice: 34.99, soldOut: true });

    const entries = auditDocs();
    expect(entries).toHaveLength(1);
    expect(entries[0].email).toBe('owner@kaayko.com');
    expect(entries[0].productId).toBe('p1');
    expect(entries[0].changes.actualPrice).toEqual({ from: 39.99, to: 34.99 });
    expect(entries[0].changes.soldOut).toEqual({ from: null, to: true });
  });

  test('a no-op write logs nothing and touches nothing', async () => {
    const res = await request(adminApp()).patch('/admin/products/p1').send({ title: 'Broke' });
    expect(res.status).toBe(200);
    expect(res.body.unchanged).toBe(true);
    expect(auditDocs()).toHaveLength(0);
    expect(admin._mocks.docData['kaaykoproducts/p1'].updatedBy).toBeUndefined();
  });

  test('404s on a product that does not exist', async () => {
    const res = await request(adminApp()).patch('/admin/products/nope').send({ title: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('Sold out is enforced where the money is', () => {
  test('resolveCart refuses a sold-out product', async () => {
    admin._mocks.docData['kaaykoproducts/p1'] = { ...baseProduct, soldOut: true };

    const result = await resolveCart([{ productId: 'p1', size: 'M', gender: 'Unisex', quantity: 1 }]);

    expect(result.ok).toBe(false);
  });

  test('the same cart succeeds once it is back in stock', async () => {
    admin._mocks.docData['kaaykoproducts/p1'] = { ...baseProduct, soldOut: false };

    const result = await resolveCart([{ productId: 'p1', size: 'M', gender: 'Unisex', quantity: 1 }]);

    expect(result.ok).toBe(true);
    expect(result.totalCents).toBe(3999);
  });
});

describe('Hidden products leave the server', () => {
  const { buildTestApp } = require('./helpers/testApp');
  const publicApp = () => buildTestApp('/products', require('../api/products/products'));

  test('the public list omits hidden and soft-deleted products', async () => {
    admin._mocks.docData['kaaykoproducts/live'] = { ...baseProduct, title: 'Live' };
    admin._mocks.docData['kaaykoproducts/hidden'] = { ...baseProduct, title: 'Hidden', isAvailable: false };
    admin._mocks.docData['kaaykoproducts/deleted'] = { ...baseProduct, title: 'Deleted', deletedAt: new Date() };

    const res = await request(publicApp()).get('/products');

    expect(res.status).toBe(200);
    expect(res.body.products.map(p => p.title)).toEqual(['Live']);
  });

  test('a hidden product 404s on its direct link', async () => {
    admin._mocks.docData['kaaykoproducts/hidden'] = { ...baseProduct, isAvailable: false };
    const res = await request(publicApp()).get('/products/hidden');
    expect(res.status).toBe(404);
  });

  test('soldOut reaches the storefront so it can render the badge', async () => {
    admin._mocks.docData['kaaykoproducts/gone'] = { ...baseProduct, soldOut: true };
    const res = await request(publicApp()).get('/products/gone');
    expect(res.status).toBe(200);
    expect(res.body.product.soldOut).toBe(true);
  });
});
