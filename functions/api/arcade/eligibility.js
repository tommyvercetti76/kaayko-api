/**
 * arcade/eligibility.js — whose products the game is switched on for.
 *
 * The Beggathon is a toggle, not a fixture. A discount it wins comes out of the
 * seller's pocket, so the seller decides:
 *
 *   kaaykoproducts/{id}.gamesEnabled   true | false     the product's own switch
 *   kreators/{uid}.features.games      true | false     a kreator's default for all
 *                                                       of their products
 *
 * Resolution, cheapest first: an explicit product switch wins; otherwise a kreator's
 * product follows the kreator's flag, which is OFF unless they turned it on; and a
 * product with no kreator is Kaayko's own, where the game is on.
 *
 * Two places ask: `/arcade/beg/start` (so nobody plays for a product that cannot pay
 * out) and `computeRewardDiscount` (so a whole-bag code only touches lines whose
 * seller opted in). The second one is the money guard — the first is just manners.
 */

const PRODUCTS = "kaaykoproducts";
const KREATORS = "kreators";

/** @returns {Promise<boolean>} */
async function gamesAllowedForProduct(db, productId, cache = new Map()) {
  const id = String(productId || "").trim();
  if (!id || id.includes("/")) return false;
  if (cache.has(`p:${id}`)) return cache.get(`p:${id}`);

  let allowed = false;
  try {
    const snap = await db.collection(PRODUCTS).doc(id).get();
    const d = snap.exists ? snap.data() || {} : null;
    if (!d) allowed = false;
    else if (d.gamesEnabled === false) allowed = false;
    else if (d.gamesEnabled === true) allowed = true;
    else if (d.kreatorId) allowed = await kreatorGamesOn(db, d.kreatorId, cache);
    else allowed = true;
  } catch (err) {
    console.error("[arcade] eligibility lookup failed:", err.message);
    allowed = false;                       // when in doubt, nobody pays for a discount
  }
  cache.set(`p:${id}`, allowed);
  return allowed;
}

async function kreatorGamesOn(db, kreatorId, cache) {
  const key = `k:${kreatorId}`;
  if (cache.has(key)) return cache.get(key);
  let on = false;
  try {
    const snap = await db.collection(KREATORS).doc(String(kreatorId)).get();
    on = snap.exists && snap.data()?.features?.games === true;
  } catch (_) { on = false; }
  cache.set(key, on);
  return on;
}

/**
 * The subset of `items` whose product allows the game.
 * @param {Array<{productId?:string}>} items
 * @returns {Promise<Array>}
 */
async function gameEligibleItems(db, items) {
  const cache = new Map();
  const out = [];
  for (const item of items || []) {
    if (await gamesAllowedForProduct(db, item?.productId, cache)) out.push(item);
  }
  return out;
}

module.exports = { gamesAllowedForProduct, gameEligibleItems };
