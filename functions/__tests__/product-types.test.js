/**
 * config/productTypes.js is the one table behind prices-by-type, tax codes, the
 * admin/kreator enums, the uploader defaults and the coming-soon line on the grid.
 * These tests pin the decisions of 13 Sep 2026 and the invariants the rest of the
 * money path relies on.
 */
const { PRODUCT_TYPES, CATEGORIES, TYPE_KEYS, typeFor, isSellableType, publicTypes } = require('../config/productTypes');
const { resolveUnitPriceCents, resolveTaxCode } = require('../api/checkout/pricing');

describe('productTypes registry — the decided table', () => {
  test('prices by type are the ones Rohan set', () => {
    const cents = Object.fromEntries(PRODUCT_TYPES.map((t) => [t.key, t.priceCents]));
    expect(cents).toEqual({
      tshirt: 2499, hoodie: 4999, tote: 2999, bottle: 2999, magnet: 999,
      mug: 1999, sticker: 499
    });
  });

  test('mug is coming soon, the sticker is retired (it is the parcel card); everything else is live; print/cap/poster are gone', () => {
    expect(typeFor('mug').status).toBe('coming_soon');
    expect(typeFor('sticker').status).toBe('retired');
    for (const key of ['tshirt', 'hoodie', 'tote', 'bottle', 'magnet']) expect(typeFor(key).status).toBe('live');
    for (const key of ['print', 'cap', 'poster']) expect(typeFor(key)).toBeNull();
    expect(TYPE_KEYS).toEqual(['tshirt', 'hoodie', 'tote', 'bottle', 'magnet', 'mug', 'sticker']);
  });

  test('every row is complete and no default size list is empty (pricing.resolveSize would accept anything)', () => {
    for (const t of PRODUCT_TYPES) {
      expect(t.key).toMatch(/^[a-z]+$/);
      expect(t.label).toBeTruthy();
      expect(t.singular).toBeTruthy();
      expect(Number.isInteger(t.priceCents) && t.priceCents > 0).toBe(true);
      expect(Array.isArray(t.sizes) && t.sizes.length > 0).toBe(true);
      expect(CATEGORIES).toContain(t.category);
      expect(t.taxCode).toMatch(/^txcd_\d{6,12}$/);
      expect(['live', 'coming_soon', 'retired']).toContain(t.status);
    }
  });

  test('typeFor is case- and whitespace-tolerant and null for the unknown', () => {
    expect(typeFor(' Tote ')).toBe(typeFor('tote'));
    expect(typeFor('')).toBeNull();
    expect(typeFor(undefined)).toBeNull();
    expect(typeFor('other')).toBeNull();
  });

  test('sellability: live and unknown types sell; coming-soon does not', () => {
    expect(isSellableType('tshirt')).toBe(true);
    expect(isSellableType('other')).toBe(true);      // a kreator product the registry does not know
    expect(isSellableType('')).toBe(true);
    expect(isSellableType('mug')).toBe(false);
    expect(isSellableType('sticker')).toBe(false);
  });

  test('publicTypes carries what the storefront draws and nothing operational', () => {
    const pub = publicTypes();
    expect(pub.map((t) => t.key)).toEqual(TYPE_KEYS.filter((k) => k !== 'sticker'));   // retired rows never reach the storefront
    expect(Object.keys(pub[0]).sort()).toEqual(['category', 'key', 'label', 'priceCents', 'singular', 'sizes', 'status']);
    expect(pub.find((t) => t.key === 'mug')).toMatchObject({ label: 'Mugs', priceCents: 1999, status: 'coming_soon' });
  });
});

describe('pricing.js reads the registry', () => {
  test('actualPrice wins; the type is the fallback; nothing else is a source', () => {
    expect(resolveUnitPriceCents({ actualPrice: 12.5, productType: 'tote' })).toEqual({ cents: 1250, source: 'actualPrice' });
    expect(resolveUnitPriceCents({ productType: 'tote' })).toEqual({ cents: 2999, source: 'productType' });
    expect(resolveUnitPriceCents({ productType: 'hoodie' })).toEqual({ cents: 4999, source: 'productType' });
    expect(resolveUnitPriceCents({ productType: 'mug' })).toBeNull();            // coming soon: no price
    expect(resolveUnitPriceCents({ price: '$$$$', productType: '' })).toBeNull(); // the symbol is dead
    expect(resolveUnitPriceCents({ price: '$24.99' })).toBeNull();               // so is the legacy string
    expect(resolveUnitPriceCents({ actualPrice: 0, productType: 'tote' })).toBeNull(); // zero is a refusal, not a fallback
  });

  test('tax code: document override, then the type, then the category', () => {
    expect(resolveTaxCode({ taxCode: 'txcd_12345678', productType: 'tshirt' })).toBe('txcd_12345678');
    expect(resolveTaxCode({ taxCode: 'not a code', productType: 'tshirt' })).toBe('txcd_30011000');
    expect(resolveTaxCode({ productType: 'hoodie' })).toBe('txcd_30011000');
    expect(resolveTaxCode({ productType: 'bottle' })).toBe('txcd_99999999');
    expect(resolveTaxCode({ productType: 'magnet' })).toBe('txcd_99999999');
    expect(resolveTaxCode({ category: 'drinkware' })).toBe('txcd_99999999');
    expect(resolveTaxCode({ category: 'apparel' })).toBe('txcd_30011000');
    expect(resolveTaxCode({})).toBeNull();
  });
});
