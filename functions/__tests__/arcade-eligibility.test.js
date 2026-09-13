/**
 * The two money guards on a game code: a whole-bag code only touches lines whose
 * seller runs the game, and it can never exceed 10% or $25. And nobody is ever
 * charged above list price — the surcharge is zero on the wire, always.
 */
require('./helpers/mockSetup');
const admin = require('firebase-admin');

const db = () => admin.firestore();
const { gamesAllowedForProduct, gameEligibleItems } = require('../api/arcade/eligibility');
const { computeRewardDiscount, computeSurcharge, MAX_DISCOUNT_CENTS } = require('../api/arcade/rewards');

async function seed(path, data) { await db().doc(path).set(data); }

describe('arcade eligibility', () => {
  test("Kaayko's own product (no kreator) runs the game by default", async () => {
    await seed('kaaykoproducts/own', { title: 'Tote' });
    expect(await gamesAllowedForProduct(db(), 'own')).toBe(true);
  });
  test('an explicit gamesEnabled:false wins over everything', async () => {
    await seed('kaaykoproducts/off', { gamesEnabled: false });
    expect(await gamesAllowedForProduct(db(), 'off')).toBe(false);
  });
  test("a kreator's product is OFF unless the kreator opted in", async () => {
    await seed('kreators/k1', { businessName: 'Quiet' });
    await seed('kreators/k2', { businessName: 'Loud', features: { games: true } });
    await seed('kaaykoproducts/q', { kreatorId: 'k1' });
    await seed('kaaykoproducts/l', { kreatorId: 'k2' });
    await seed('kaaykoproducts/lf', { kreatorId: 'k2', gamesEnabled: false });
    expect(await gamesAllowedForProduct(db(), 'q')).toBe(false);
    expect(await gamesAllowedForProduct(db(), 'l')).toBe(true);
    expect(await gamesAllowedForProduct(db(), 'lf')).toBe(false);
  });
  test('a missing or malformed product never pays out', async () => {
    expect(await gamesAllowedForProduct(db(), 'nope')).toBe(false);
    expect(await gamesAllowedForProduct(db(), 'a/b')).toBe(false);
    expect(await gamesAllowedForProduct(db(), '')).toBe(false);
  });
  test('gameEligibleItems keeps only opted-in lines', async () => {
    await seed('kaaykoproducts/a', {});
    await seed('kaaykoproducts/b', { gamesEnabled: false });
    const kept = await gameEligibleItems(db(), [{ productId: 'a' }, { productId: 'b' }, { productId: 'zzz' }]);
    expect(kept.map((i) => i.productId)).toEqual(['a']);
  });
});

describe('reward money guards', () => {
  const future = () => ({ toMillis: () => Date.now() + 60000 });
  test('a cart code discounts only the opted-in lines', async () => {
    await seed('kaaykoproducts/a', {});
    await seed('kaaykoproducts/b', { gamesEnabled: false });
    await seed('arcade_rewards/KAY-AAAAA-AAAAA', { percent: 10, scope: 'cart', redeemed: false, expiresAt: future() });
    const r = await computeRewardDiscount(db(), {
      items: [{ productId: 'a', lineTotalCents: 2000 }, { productId: 'b', lineTotalCents: 8000 }],
      rewardCode: 'KAY-AAAAA-AAAAA'
    });
    expect(r.applied).toBe(true);
    expect(r.discountCents).toBe(200);          // 10% of the $20 line, not of the $100 bag
  });
  test('a cart of only opted-out lines gets nothing, with a reason', async () => {
    await seed('kaaykoproducts/b', { gamesEnabled: false });
    await seed('arcade_rewards/KAY-BBBBB-BBBBB', { percent: 10, scope: 'cart', redeemed: false, expiresAt: future() });
    const r = await computeRewardDiscount(db(), { items: [{ productId: 'b', lineTotalCents: 8000 }], rewardCode: 'KAY-BBBBB-BBBBB' });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('NO_ELIGIBLE_ITEMS');
  });
  test('percent is capped at 10 and the discount at $25', async () => {
    await seed('kaaykoproducts/a', {});
    await seed('arcade_rewards/KAY-CCCCC-CCCCC', { percent: 40, scope: 'cart', redeemed: false, expiresAt: future() });
    const r = await computeRewardDiscount(db(), { items: [{ productId: 'a', lineTotalCents: 100000 }], rewardCode: 'KAY-CCCCC-CCCCC' });
    expect(r.percent).toBe(10);
    expect(r.discountCents).toBe(MAX_DISCOUNT_CENTS);
    expect(MAX_DISCOUNT_CENTS).toBe(2500);
  });
  test('the surcharge is zero whatever the standing', async () => {
    await seed('arcade_penalties/tok', { surchargePercent: 5, strikes: 5 });
    const s = await computeSurcharge(db(), { items: [{ lineTotalCents: 10000 }], token: 'tok' });
    expect(s).toEqual({ percent: 0, cents: 0 });
  });
});
