/**
 * arcade/rewards.js — what a won game is actually worth, decided server-side.
 *
 * Three separate things live here, all of which must be enforced away from the browser:
 *
 *   1. Reward codes. Single use, time limited, and only ever worth a percentage off the
 *      ELIGIBLE part of a cart. Totes and t-shirts are premium: they are excluded from
 *      the discount base even when a winning code is present.
 *   2. The monthly order cap. Two orders per calendar month, counted against a hash of
 *      the checkout email. There are no accounts, so email is the only handle we have;
 *      it is stored hashed so the ledger is a counter, not a customer list.
 *   3. Patrons. People the owner chooses, who get their own percentage or their own
 *      fixed price on named products. This is the only path to a discount on premium.
 */

const admin = require("firebase-admin");
const { DISCOUNTABLE_TYPES, REWARDS, emailKey, REWARD_PERCENT } = require("./arcade");
const { loadStanding } = require("./penalty");
const { gameEligibleItems } = require("./eligibility");

// The two business ceilings on a game code. A plea is worth at most a tenth of the
// lines whose seller opted in, and never more than MAX_DISCOUNT_CENTS however large the
// bag: the game is a small kindness on one order, not a pricing channel.
const MAX_GAME_PERCENT = 10;
const MAX_DISCOUNT_CENTS = 2500;

// A promo is the fourth thing: a code the owner (or a maker, for their own shelf)
// hands out on purpose — printed on a card, sent to friends. It is not won, so it
// is not single-use, not an hour long and not tied to an email or a browser token.
// It IS still worth only what its document says, decided here. Doc shape, keyed by
// the uppercase code in `arcade_rewards`:
//   { kind: 'promo', percent, scope: 'store' | 'cart', storeSlug?, label?, active,
//     expiresAt?, maxDiscountCents?, uses }
const MAX_PROMO_PERCENT = 50;

const ORDER_LEDGER = "arcade_order_ledger";
const PATRONS = "kaayko_patrons";

const MAX_ORDERS_PER_MONTH = 2;
const MAX_PATRON_PERCENT = 100;

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7); // YYYY-MM

const isEligible = (item) => DISCOUNTABLE_TYPES.has(String(item?.productType || "").toLowerCase());

/**
 * Subtotal of the discountable lines only.
 * @param {Array<{productType?:string, unitPriceCents?:number, quantity?:number, lineTotalCents?:number}>} items
 */
function eligibleSubtotalCents(items) {
  return (items || []).reduce((sum, i) => {
    if (!isEligible(i)) return sum;
    const line = Number.isFinite(i.lineTotalCents)
      ? i.lineTotalCents
      : (Number(i.unitPriceCents) || 0) * (Number(i.quantity) || 0);
    return sum + Math.max(0, line);
  }, 0);
}

/**
 * Validate a reward code against a cart and compute the discount.
 * Never throws on a bad code: an invalid code is a zero discount plus a reason.
 *
 * @returns {Promise<{applied:boolean, discountCents:number, percent:number, code:string|null, reason:string|null}>}
 */
async function computeRewardDiscount(db, { items, rewardCode, email, token }) {
  const none = (reason) => ({ applied: false, discountCents: 0, percent: 0, scope: null, code: null, reason });
  const code = String(rewardCode || "").trim().toUpperCase();
  if (!code) return none(null);

  const ref = db.collection(REWARDS).doc(code);
  const snap = await ref.get();
  if (!snap.exists) return none("NO_SUCH_CODE");

  const r = snap.data();
  if (r.kind === "promo") return promoDiscount(r, code, items);
  if (r.redeemed) return none("ALREADY_REDEEMED");

  // Penalty rules 2 and 3. A locked token buys nothing, and a code minted before the
  // strike that locked it is dead — otherwise "win, then paste" would be free money.
  const owner = r.token || token;
  if (owner) {
    const standing = await loadStanding(db, owner);
    if (standing.locked) return none("LOCKED");
    const minted = r.createdAt && typeof r.createdAt.toMillis === "function" ? r.createdAt.toMillis() : 0;
    if (standing.voidedAt && minted && standing.voidedAt > minted) return none("VOIDED");
  }
  // Codes live one hour from minting, claimed or not.
  if (r.expiresAt && r.expiresAt.toMillis() < Date.now()) return none("EXPIRED");
  // A code won under one email cannot be handed to another.
  if (r.emailKey && email && r.emailKey !== emailKey(email)) return none("WRONG_OWNER");

  // Scope decides the base. A Beggathon code was argued for at the cart, so it takes
  // the whole cart; a game code only ever touches the non-premium lines.
  const scope = r.scope === "cart" ? "cart" : "eligible";
  // "cart" means every line whose seller has the game switched on (eligibility.js) —
  // a kreator who never opted in never pays for somebody else's plea.
  const eligible = scope === "cart" ? await gameEligibleItems(db, items) : [];
  const base = scope === "cart"
    ? eligible.reduce((sum, i) => sum + Math.max(0, Number.isFinite(i.lineTotalCents)
        ? i.lineTotalCents
        : (Number(i.unitPriceCents) || 0) * (Number(i.quantity) || 0)), 0)
    : eligibleSubtotalCents(items);
  if (base <= 0) return none(scope === "cart" ? "NO_ELIGIBLE_ITEMS" : "NO_ELIGIBLE_ITEMS");

  const percent = Math.min(Number(r.percent) || REWARD_PERCENT, MAX_GAME_PERCENT);
  return {
    applied: true,
    discountCents: Math.min(MAX_DISCOUNT_CENTS, Math.floor((base * percent) / 100)),
    percent,
    scope,
    code,
    reason: null
  };
}

/**
 * A promo against a priced cart. `scope: 'store'` takes the lines on the named
 * shelf (pricing.js stamps `storeSlug` on every line); `scope: 'cart'` takes every
 * line. Premium types are NOT excluded here: a maker discounting her own totes is
 * the point, and only the owner can write these documents.
 */
function promoDiscount(r, code, items) {
  const none = (reason) => ({ applied: false, discountCents: 0, percent: 0, scope: null, code: null, kind: "promo", reason });
  if (r.active === false) return none("PROMO_INACTIVE");
  if (r.expiresAt && typeof r.expiresAt.toMillis === "function" && r.expiresAt.toMillis() < Date.now()) return none("EXPIRED");
  const scope = r.scope === "cart" ? "cart" : "store";
  const slug = String(r.storeSlug || "").trim();
  if (scope === "store" && !slug) return none("PROMO_INACTIVE");
  const base = (items || []).reduce((sum, i) => {
    if (scope === "store" && String(i.storeSlug || "") !== slug) return sum;
    const line = Number.isFinite(i.lineTotalCents) ? i.lineTotalCents : (Number(i.unitPriceCents) || 0) * (Number(i.quantity) || 0);
    return sum + Math.max(0, line);
  }, 0);
  if (base <= 0) return none("NO_ELIGIBLE_ITEMS");
  const percent = Math.max(0, Math.min(Number(r.percent) || 0, MAX_PROMO_PERCENT));
  if (percent <= 0) return none("PROMO_INACTIVE");
  let discountCents = Math.floor((base * percent) / 100);
  if (Number.isFinite(Number(r.maxDiscountCents)) && Number(r.maxDiscountCents) > 0) discountCents = Math.min(discountCents, Number(r.maxDiscountCents));
  return { applied: true, discountCents, percent, scope, code, kind: "promo", label: r.label || null, reason: null };
}

/** Burn the code. Called only once the payment intent for `orderId` exists. */
async function redeemReward(db, code, orderId) {
  if (!code) return;
  await db.collection(REWARDS).doc(String(code).toUpperCase()).set({
    redeemed: true,
    orderId: orderId || null,
    redeemedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

/** A promo is never burned; it counts. */
async function countPromoUse(db, code, orderId) {
  if (!code) return;
  await db.collection(REWARDS).doc(String(code).toUpperCase()).set({
    uses: admin.firestore.FieldValue.increment(1),
    lastOrderId: orderId || null,
    lastUsedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

/* ── the monthly cap ──────────────────────────────────────────────────────── */

/**
 * How many orders this email has placed this calendar month.
 * @returns {Promise<{count:number, limit:number, allowed:boolean}>}
 */
async function monthlyOrderStatus(db, email) {
  const key = emailKey(email);
  if (!email) return { count: 0, limit: MAX_ORDERS_PER_MONTH, allowed: true };
  const snap = await db.collection(ORDER_LEDGER).doc(`${key}_${monthKey()}`).get();
  const count = snap.exists ? Number(snap.data().count) || 0 : 0;
  return { count, limit: MAX_ORDERS_PER_MONTH, allowed: count < MAX_ORDERS_PER_MONTH };
}

/** Record one placed order against the month. Atomic, so two tabs cannot both squeeze in. */
async function recordOrder(db, email, orderId) {
  if (!email) return;
  const key = emailKey(email);
  const ref = db.collection(ORDER_LEDGER).doc(`${key}_${monthKey()}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? Number(snap.data().count) || 0 : 0;
    tx.set(ref, {
      count: count + 1,
      month: monthKey(),
      lastOrderId: orderId || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

/* ── patrons: the owner's own list ────────────────────────────────────────── */

/**
 * A patron record keyed by email hash:
 *   { label, percent, fixedPrices: { <productID>: <dollars> }, active, note }
 *
 * `percent` applies to the whole cart, premium included — this is the deliberate
 * exception to the no-discount-on-premium rule, and only the owner can grant it.
 */
async function loadPatron(db, email) {
  if (!email) return null;
  const snap = await db.collection(PATRONS).doc(emailKey(email)).get();
  if (!snap.exists) return null;
  const p = snap.data();
  return p.active === false ? null : p;
}

/**
 * Patron pricing, applied to an already-priced cart.
 * A fixed price wins over a percentage on the same line.
 *
 * @returns {{discountCents:number, percent:number, fixedLines:number, label:string|null}}
 */
function applyPatronPricing(patron, items) {
  if (!patron) return { discountCents: 0, percent: 0, fixedLines: 0, label: null };

  const fixed = patron.fixedPrices && typeof patron.fixedPrices === "object" ? patron.fixedPrices : {};
  const percent = Math.max(0, Math.min(Number(patron.percent) || 0, MAX_PATRON_PERCENT));

  let discountCents = 0;
  let fixedLines = 0;

  for (const item of items || []) {
    const qty = Number(item.quantity) || 0;
    const unit = Number(item.unitPriceCents) || 0;
    const line = Number.isFinite(item.lineTotalCents) ? item.lineTotalCents : unit * qty;
    const override = fixed[item.productID] ?? fixed[item.productId];

    if (Number.isFinite(Number(override))) {
      const target = Math.round(Number(override) * 100) * qty;
      if (target < line) { discountCents += line - target; fixedLines += 1; }
      continue;                        // a fixed price is the whole deal for that line
    }
    if (percent > 0) discountCents += Math.floor((line * percent) / 100);
  }

  return { discountCents, percent, fixedLines, label: patron.label || null };
}

/**
 * Penalty rules 1 and 9. What pasting costs, computed here and shown as its own line at
 * checkout. Never silent: the cart prints it before anybody is asked to pay.
 *
 * @returns {Promise<{percent:number, cents:number}>}
 */
/**
 * Nobody is ever charged MORE than the list price because of a game. The paste
 * surcharge that used to live here (+1% a strike, to +5%) was a consumer-law
 * exposure — an undisclosed behavioural mark-up on an advertised price — and it was
 * removed on 13 Sep 2026. A strike now costs the shopper their discounts (penalty.js),
 * never money. The function stays so checkout's arithmetic does not change shape.
 */
async function computeSurcharge(_db, _opts) {
  return { percent: 0, cents: 0 };
}

module.exports = {
  computeRewardDiscount,
  computeSurcharge,
  redeemReward,
  countPromoUse,
  promoDiscount,
  eligibleSubtotalCents,
  monthlyOrderStatus,
  recordOrder,
  loadPatron,
  applyPatronPricing,
  MAX_ORDERS_PER_MONTH,
  MAX_GAME_PERCENT,
  MAX_DISCOUNT_CENTS,
  MAX_PROMO_PERCENT,
  ORDER_LEDGER,
  PATRONS
};
