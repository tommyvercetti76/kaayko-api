/** A handed-out promo: worth what its document says, scoped to one shelf, never burned. */
const { promoDiscount, MAX_PROMO_PERCENT } = require('../api/arcade/rewards');

const tote = (slug, cents, qty = 1) => ({ productType: 'tote', storeSlug: slug, unitPriceCents: cents, quantity: qty, lineTotalCents: cents * qty });

describe('promoDiscount', () => {
  const promo = { kind: 'promo', percent: 20, scope: 'store', storeSlug: 'moms-shop', active: true };

  test('takes 20% off the shelf lines only, premium types included', () => {
    const r = promoDiscount(promo, 'MUM-SHOP-20', [tote('moms-shop', 3000, 2), tote('other-shelf', 5000), { productType: 'magnet', storeSlug: null, unitPriceCents: 800, quantity: 1, lineTotalCents: 800 }]);
    expect(r).toMatchObject({ applied: true, kind: 'promo', percent: 20, scope: 'store', code: 'MUM-SHOP-20', discountCents: 1200 });
  });

  test('nothing from that shelf in the bag means nothing off, with a reason', () => {
    expect(promoDiscount(promo, 'MUM-SHOP-20', [tote('other-shelf', 5000)])).toMatchObject({ applied: false, discountCents: 0, reason: 'NO_ELIGIBLE_ITEMS' });
  });

  test('an inactive, expired, or unscoped promo is refused', () => {
    expect(promoDiscount({ ...promo, active: false }, 'X', [tote('moms-shop', 3000)]).reason).toBe('PROMO_INACTIVE');
    expect(promoDiscount({ ...promo, expiresAt: { toMillis: () => Date.now() - 1 } }, 'X', [tote('moms-shop', 3000)]).reason).toBe('EXPIRED');
    expect(promoDiscount({ ...promo, storeSlug: '' }, 'X', [tote('moms-shop', 3000)]).reason).toBe('PROMO_INACTIVE');
  });

  test('percent is capped and an optional ceiling in cents holds', () => {
    expect(promoDiscount({ ...promo, percent: 90 }, 'X', [tote('moms-shop', 10000)]).percent).toBe(MAX_PROMO_PERCENT);
    expect(promoDiscount({ ...promo, maxDiscountCents: 500 }, 'X', [tote('moms-shop', 10000)]).discountCents).toBe(500);
  });

  test('cart scope takes every line', () => {
    expect(promoDiscount({ ...promo, scope: 'cart' }, 'X', [tote('a', 1000), tote('b', 1000)]).discountCents).toBe(400);
  });
});
