/**
 * Server-side price authority for the Kaayko Store checkout.
 *
 * The client is NEVER trusted for money. Every line item is re-priced by
 * reading `kaaykoproducts/{productId}` from Firestore; any `price` /
 * `actualPrice` / `amount` field arriving in the request body is discarded.
 *
 * Product-document facts this module relies on (verified against
 * `kaayko/scripts/store_uploader/firestore_writer.py`, which is the writer, and
 * `functions/api/products/products.js`, which is the reader):
 *
 *   actualPrice      number   — the real dollar price (e.g. 29.99). Authoritative.
 *   price            string   — a TIER SYMBOL ("$", "$$", "$$$", "$$$$"), NOT a
 *                               dollar string. Only legacy/kreator docs ever hold
 *                               something like "$24.99".
 *   isAvailable      boolean  — absent means available (products.js uses
 *                               `d.isAvailable !== false`). This is the only real
 *                               availability flag on kaaykoproducts; there is no
 *                               `archived` field on this collection.
 *   deletedAt        ts       — set by the kreator soft-delete alongside
 *                               isAvailable:false. Treated as unavailable too.
 *   availableSizes   string[] — size options; used to validate the client's size.
 *   productID        string   — a SECONDARY id (storage prefix). The Firestore
 *                               document id is canonical.
 *   taxCode          string   — OPTIONAL Stripe Tax product tax code
 *                               ("txcd_30011000"). Absent on every product the
 *                               uploader writes today; see ./tax.js for the
 *                               default applied when it is missing.
 *
 * There is no `gender` field on product documents, so gender cannot be validated
 * against the catalogue; it is instead constrained to the fixed UI enum.
 *
 * @module api/checkout/pricing
 */

const admin = require('firebase-admin');

const PRODUCTS_COLLECTION = 'kaaykoproducts';

/** Tier-symbol → cents. Mirrors PRICE_MAP in kaayko/src/js/kaayko_ui.js. */
const PRICE_SYMBOL_CENTS = Object.freeze({
  '$': 1999,
  '$$': 2999,
  '$$$': 3999,
  '$$$$': 4999
});

/** Gender values the store UI can produce. Anything else is rejected. */
const ALLOWED_GENDERS = Object.freeze(['Male', 'Female', 'Teen', 'Child', 'Infant', 'Unisex']);

const LIMITS = Object.freeze({
  MAX_LINE_ITEMS: 10,          // distinct lines after dedupe
  MAX_QUANTITY_PER_ITEM: 10,
  MAX_TOTAL_CENTS: 500000      // $5,000 ceiling
});

const CURRENCY = 'usd';

/** Structured failure — the handler turns this into a 400 JSON body. */
function fail(code, message, extra = {}) {
  return { ok: false, status: 400, code, message, ...extra };
}

/**
 * Resolve the authoritative unit price, in cents, from a product document.
 * Returns null when no usable price can be established.
 *
 * @param {object} data Raw Firestore product data.
 * @returns {{cents: number, source: string}|null}
 */
function resolveUnitPriceCents(data) {
  if (!data) return null;

  if (typeof data.actualPrice === 'number' && Number.isFinite(data.actualPrice)) {
    const cents = Math.round(data.actualPrice * 100);
    return cents > 0 ? { cents, source: 'actualPrice' } : null;
  }

  const raw = typeof data.price === 'string' ? data.price.trim() : '';
  if (!raw) return null;

  // Tier symbol ("$$$") — a run of dollar signs and nothing else.
  if (/^\$+$/.test(raw)) {
    const cents = PRICE_SYMBOL_CENTS[raw];
    return cents ? { cents, source: 'priceSymbol' } : null;
  }

  // Legacy numeric string ("$24.99", "1,299.00").
  const parsed = parseFloat(raw.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  const cents = Math.round(parsed * 100);
  return cents > 0 ? { cents, source: 'priceString' } : null;
}

/**
 * Load a product by its canonical Firestore document id, falling back for one
 * release to a lookup on the legacy `productID` field.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} id
 * @returns {Promise<{id: string, data: object, viaLegacyField: boolean}|null>}
 */
async function loadProduct(db, id) {
  const snap = await db.collection(PRODUCTS_COLLECTION).doc(id).get();
  if (snap.exists) {
    return { id: snap.id, data: snap.data() || {}, viaLegacyField: false };
  }

  // Compatibility path: the frontend used to send the `productID` field value.
  // Kept for one release; the warning is how we know when it can be deleted.
  const query = await db
    .collection(PRODUCTS_COLLECTION)
    .where('productID', '==', id)
    .limit(1)
    .get();

  if (query.empty) return null;

  console.warn(
    `[checkout/pricing] LEGACY_PRODUCT_LOOKUP productID="${id}" resolved to doc "${query.docs[0].id}" — client is sending the wrong identifier`
  );
  return { id: query.docs[0].id, data: query.docs[0].data() || {}, viaLegacyField: true };
}

/** Stripe Tax product tax codes look like "txcd_30011000". */
const TAX_CODE_RE = /^txcd_\d{6,12}$/;

/**
 * Per-product Stripe Tax code override. Only a well-formed code is honoured —
 * anything else is treated as absent so a typo in a product document cannot
 * turn into a failed tax calculation (and therefore a blocked checkout).
 *
 * @param {object} data Raw Firestore product data.
 * @returns {string|null}
 */
function resolveTaxCode(data) {
  const raw = typeof data?.taxCode === 'string' ? data.taxCode.trim() : '';
  return TAX_CODE_RE.test(raw) ? raw : null;
}

/** A product is purchasable unless it is explicitly switched off. */
function isPurchasable(data) {
  if (data.isAvailable === false) return false;
  if (data.soldOut === true) return false;
  if (data.deletedAt) return false;
  return true;
}

/**
 * Validate the requested size against the product's `availableSizes`.
 * Returns the canonical value from the document (so casing is normalised).
 *
 * @returns {{ok: true, size: string|null}|{ok: false}}
 */
function resolveSize(data, requested) {
  const options = Array.isArray(data.availableSizes)
    ? data.availableSizes.filter(s => typeof s === 'string' && s.trim())
    : [];
  const wanted = typeof requested === 'string' ? requested.trim() : '';

  if (options.length === 0) {
    // Product carries no size options — accept a short free-form label or fall
    // back to the same "One Size" default the storefront uses.
    if (!wanted) return { ok: true, size: 'One Size' };
    if (wanted.length > 40) return { ok: false };
    return { ok: true, size: wanted };
  }

  if (!wanted) return { ok: false };
  const match = options.find(o => o.trim().toLowerCase() === wanted.toLowerCase());
  return match ? { ok: true, size: match.trim() } : { ok: false };
}

/**
 * Constrain gender to the storefront enum. Product documents carry no gender
 * field, so this is an allowlist rather than a catalogue check.
 *
 * @returns {{ok: true, gender: string|null}|{ok: false}}
 */
function resolveGender(requested) {
  if (requested === undefined || requested === null || requested === '') {
    return { ok: true, gender: null };
  }
  if (typeof requested !== 'string') return { ok: false };
  const match = ALLOWED_GENDERS.find(g => g.toLowerCase() === requested.trim().toLowerCase());
  return match ? { ok: true, gender: match } : { ok: false };
}

/** Quantity must be an integer in 1..MAX_QUANTITY_PER_ITEM; absent means 1. */
function resolveQuantity(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, quantity: 1 };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1 || n > LIMITS.MAX_QUANTITY_PER_ITEM) return { ok: false };
  return { ok: true, quantity: n };
}

/**
 * Re-price a client cart from the catalogue.
 *
 * Client-supplied prices are read nowhere in this function — the only fields
 * consumed from each raw item are productId, size, gender and quantity.
 *
 * @param {Array<object>} rawItems Line items as posted by the client.
 * @param {{db?: FirebaseFirestore.Firestore}} [opts]
 * @returns {Promise<
 *   {ok: true, items: Array<object>, subtotalCents: number, totalCents: number,
 *    currency: string, usedLegacyLookup: boolean}
 *   | {ok: false, status: number, code: string, message: string}
 * >}
 */
async function resolveCart(rawItems, opts = {}) {
  const db = opts.db || admin.firestore();

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return fail('MISSING_ITEMS', 'items must be a non-empty array');
  }
  if (rawItems.length > LIMITS.MAX_LINE_ITEMS) {
    return fail('TOO_MANY_ITEMS', `A cart may contain at most ${LIMITS.MAX_LINE_ITEMS} line items`);
  }

  // ── Pass 1: shape validation + dedupe on (productId, size, gender) ─────────
  const merged = new Map();
  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (!item || typeof item !== 'object') {
      return fail('INVALID_ITEM', `Item ${i + 1} is not an object`);
    }

    const productId = typeof item.productId === 'string' ? item.productId.trim() : '';
    if (!productId || productId.length > 200 || productId.includes('/')) {
      return fail('MISSING_PRODUCT_ID', `Item ${i + 1} is missing a valid productId`);
    }

    const qty = resolveQuantity(item.quantity);
    if (!qty.ok) {
      return fail(
        'INVALID_QUANTITY',
        `Item ${i + 1} quantity must be a whole number between 1 and ${LIMITS.MAX_QUANTITY_PER_ITEM}`
      );
    }

    const gender = resolveGender(item.gender);
    if (!gender.ok) {
      return fail('INVALID_GENDER', `Item ${i + 1} has an unrecognised gender`);
    }

    const requestedSize = typeof item.size === 'string' ? item.size.trim() : '';
    const key = `${productId}|${requestedSize.toLowerCase()}|${gender.gender || ''}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += qty.quantity;
      if (existing.quantity > LIMITS.MAX_QUANTITY_PER_ITEM) {
        return fail(
          'INVALID_QUANTITY',
          `Combined quantity for a single product may not exceed ${LIMITS.MAX_QUANTITY_PER_ITEM}`
        );
      }
    } else {
      merged.set(key, { productId, requestedSize, gender: gender.gender, quantity: qty.quantity });
    }
  }

  if (merged.size > LIMITS.MAX_LINE_ITEMS) {
    return fail('TOO_MANY_ITEMS', `A cart may contain at most ${LIMITS.MAX_LINE_ITEMS} line items`);
  }

  // ── Pass 2: catalogue lookup + authoritative pricing ───────────────────────
  const productCache = new Map();
  const items = [];
  let subtotalCents = 0;
  let usedLegacyLookup = false;

  for (const line of merged.values()) {
    let product = productCache.get(line.productId);
    if (product === undefined) {
      product = await loadProduct(db, line.productId);
      productCache.set(line.productId, product);
    }

    if (!product) {
      return fail('PRODUCT_NOT_FOUND', `Unknown product: ${line.productId}`);
    }
    if (product.viaLegacyField) usedLegacyLookup = true;

    if (!isPurchasable(product.data)) {
      return fail('PRODUCT_UNAVAILABLE', `Product is not available for purchase: ${product.id}`);
    }

    const price = resolveUnitPriceCents(product.data);
    if (!price || !Number.isFinite(price.cents) || price.cents <= 0) {
      return fail('PRODUCT_PRICE_UNAVAILABLE', `Product has no valid price: ${product.id}`);
    }

    const size = resolveSize(product.data, line.requestedSize);
    if (!size.ok) {
      return fail('INVALID_SIZE', `Size "${line.requestedSize}" is not available for product ${product.id}`);
    }

    const lineTotalCents = price.cents * line.quantity;
    subtotalCents += lineTotalCents;

    items.push({
      productId: product.id,
      productTitle: typeof product.data.title === 'string' && product.data.title.trim()
        ? product.data.title.trim()
        : 'Kaayko Product',
      size: size.size,
      gender: line.gender,
      quantity: line.quantity,
      unitPriceCents: price.cents,
      lineTotalCents,
      // null when the product carries no override; ./tax.js applies the default.
      taxCode: resolveTaxCode(product.data)
    });
  }

  // Sales tax is NOT part of this total. It depends on the shipping address,
  // which is unknown at pricing time; POST /createPaymentIntent/tax adds it to
  // the PaymentIntent once the address is complete (see ./tax.js). Shipping is
  // still free, so subtotal and total coincide here.
  const totalCents = subtotalCents;
  if (totalCents <= 0) {
    return fail('INVALID_TOTAL', 'Order total must be greater than zero');
  }
  if (totalCents > LIMITS.MAX_TOTAL_CENTS) {
    return fail(
      'TOTAL_TOO_LARGE',
      `Order total exceeds the $${(LIMITS.MAX_TOTAL_CENTS / 100).toFixed(0)} limit`
    );
  }

  return { ok: true, items, subtotalCents, totalCents, currency: CURRENCY, usedLegacyLookup };
}

module.exports = {
  resolveCart,
  resolveUnitPriceCents,
  resolveTaxCode,
  TAX_CODE_RE,
  PRICE_SYMBOL_CENTS,
  ALLOWED_GENDERS,
  LIMITS,
  CURRENCY,
  PRODUCTS_COLLECTION
};
