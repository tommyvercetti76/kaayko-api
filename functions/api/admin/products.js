/**
 * Admin product management — the only authenticated write path for the
 * storefront catalogue.
 *
 * WHY THIS EXISTS SEPARATELY FROM api/kreators/kreatorProductRoutes.js
 * -------------------------------------------------------------------
 * That router can only touch documents carrying a `kreatorId` matching the
 * caller, and it authenticates with the kreator HMAC session token rather than
 * a Firebase ID token. Every product written by the Python uploader has no
 * `kreatorId`, so the whole catalogue is invisible to it. This module runs
 * under the ordinary admin login (requireAuth + requireAdmin) and can see
 * everything. It deliberately writes the SAME field names the kreator router
 * writes, so handing a product to a kreator later is a `kreatorId` backfill,
 * not a rewrite.
 *
 * WHY THE WHITELIST IS NOT NEGOTIABLE
 * -----------------------------------
 * api/checkout/pricing.js re-prices every order from these documents. The
 * client's price is discarded; `actualPrice`, `price`, `isAvailable`,
 * `soldOut` and `availableSizes` are what decide whether a sale happens and
 * for how much. An unvalidated write here is a wrong charge, so unknown keys
 * are rejected by name rather than ignored.
 */

const admin = require('firebase-admin');
const { PRICE_SYMBOL_CENTS } = require('../checkout/pricing');

const COLLECTION = 'kaaykoproducts';
const AUDIT_COLLECTION = 'product_audit';

// Mirrors store_upload.py's TYPES and the kreator router's categories. Kept as
// closed sets so a typo cannot drop a product out of its storefront section.
const PRODUCT_TYPES = Object.freeze(['tote', 'magnet', 'tshirt', 'print', 'sticker', 'mug', 'cap', 'poster']);
const CATEGORIES = Object.freeze(['apparel', 'accessories', 'art', 'other']);

const LIMITS = Object.freeze({
  TITLE: 120,
  DESCRIPTION: 300,
  THEME: 40,
  TAG: 30,
  TAGS: 10,
  SIZE: 40,
  SIZES: 12,
  STORY: 600,
  ROW_LABEL: 40,
  ROW_VALUE: 80,
  ROWS: 4,
  PRICE_MIN: 1,
  PRICE_MAX: 500
});

/**
 * The `price` tier symbol is a legacy fallback that checkout uses only when
 * `actualPrice` is missing. We re-derive it from the same table checkout reads
 * so the two can never disagree about which tier a product sits in.
 * @param {number} dollars
 * @returns {string} one of "$" … "$$$$"
 */
function priceSymbolFor(dollars) {
  const cents = Math.round(dollars * 100);
  const tiers = Object.entries(PRICE_SYMBOL_CENTS).sort((a, b) => a[1] - b[1]);
  let symbol = tiers[0][0];
  for (const [sym, tierCents] of tiers) {
    if (cents >= tierCents) symbol = sym;
  }
  return symbol;
}

/* ── Field validators ──────────────────────────────────────────
   Each returns { ok: true, value } or { ok: false, message }. A validator
   never coerces silently: a bad value is an error the admin UI can show, not
   a default that quietly changes the catalogue.
   ────────────────────────────────────────────────────────────── */

const str = (max, { min = 0 } = {}) => (raw) => {
  if (typeof raw !== 'string') return { ok: false, message: 'must be text' };
  const value = raw.trim();
  if (value.length < min) return { ok: false, message: `must be at least ${min} character${min === 1 ? '' : 's'}` };
  if (value.length > max) return { ok: false, message: `must be ${max} characters or fewer (got ${value.length})` };
  return { ok: true, value };
};

const bool = (raw) =>
  typeof raw === 'boolean' ? { ok: true, value: raw } : { ok: false, message: 'must be true or false' };

const oneOf = (allowed) => (raw) => {
  if (typeof raw !== 'string') return { ok: false, message: 'must be text' };
  const value = raw.trim().toLowerCase();
  return allowed.includes(value)
    ? { ok: true, value }
    : { ok: false, message: `must be one of: ${allowed.join(', ')}` };
};

const strArray = (maxItems, maxLen, { minItems = 0 } = {}) => (raw) => {
  if (!Array.isArray(raw)) return { ok: false, message: 'must be a list' };
  const value = raw.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
  if (value.length < minItems) return { ok: false, message: `needs at least ${minItems} entr${minItems === 1 ? 'y' : 'ies'}` };
  if (value.length > maxItems) return { ok: false, message: `at most ${maxItems} entries` };
  if (value.some((s) => s.length > maxLen)) return { ok: false, message: `each entry must be ${maxLen} characters or fewer` };
  if (new Set(value.map((s) => s.toLowerCase())).size !== value.length) return { ok: false, message: 'entries must be unique' };
  return { ok: true, value };
};

/** Money, in dollars. Rejects anything that would produce a surprising charge. */
function price(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return { ok: false, message: 'must be a number' };
  if (n < LIMITS.PRICE_MIN || n > LIMITS.PRICE_MAX) {
    return { ok: false, message: `must be between $${LIMITS.PRICE_MIN} and $${LIMITS.PRICE_MAX}` };
  }
  if (Math.round(n * 100) !== Number((n * 100).toFixed(4))) {
    return { ok: false, message: 'must have at most 2 decimal places' };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** The PDP dossier rows: [{label, value}, …]. */
function fileRows(raw) {
  if (!Array.isArray(raw)) return { ok: false, message: 'must be a list' };
  if (raw.length > LIMITS.ROWS) return { ok: false, message: `at most ${LIMITS.ROWS} rows` };
  const value = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') return { ok: false, message: 'each row must have a label and a value' };
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    const val = typeof row.value === 'string' ? row.value.trim() : '';
    if (!label && !val) continue;                       // a blank row is a deletion
    if (!label || !val) return { ok: false, message: 'each row needs both a label and a value' };
    if (label.length > LIMITS.ROW_LABEL) return { ok: false, message: `row labels must be ${LIMITS.ROW_LABEL} characters or fewer` };
    if (val.length > LIMITS.ROW_VALUE) return { ok: false, message: `row values must be ${LIMITS.ROW_VALUE} characters or fewer` };
    value.push({ label, value: val });
  }
  return { ok: true, value };
}

/**
 * Everything an admin may change, and nothing else. Anything absent from this
 * map is refused by name — see REFUSED below for why the notable ones are out.
 */
const EDITABLE = Object.freeze({
  title:          str(LIMITS.TITLE, { min: 1 }),
  description:    str(LIMITS.DESCRIPTION),
  actualPrice:    price,
  isAvailable:    bool,
  soldOut:        bool,
  availableSizes: strArray(LIMITS.SIZES, LIMITS.SIZE, { minItems: 1 }),
  availableColors: strArray(LIMITS.SIZES, LIMITS.SIZE),
  productType:    oneOf(PRODUCT_TYPES),
  category:       oneOf(CATEGORIES),
  theme:          str(LIMITS.THEME),
  tags:           strArray(LIMITS.TAGS, LIMITS.TAG),
  storyCopy:      str(LIMITS.STORY),
  fileRows:       fileRows
});

/**
 * Fields that exist on the document but must never be set through this route,
 * with the reason surfaced to the caller rather than a blank 400.
 */
const REFUSED = Object.freeze({
  imgSrc: 'images are managed by the image editor, not this form',
  previewSrc: 'images are managed by the image editor, not this form',
  price: 'derived from actualPrice — set actualPrice instead',
  productID: 'identity cannot change once a product exists',
  id: 'identity cannot change once a product exists',
  kreatorId: 'ownership is not editable here',
  votes: 'set by shoppers, not by admins',
  createdAt: 'immutable',
  deletedAt: 'use isAvailable to hide a product',
  taxCode: 'tax codes are set deliberately, outside this form'
});

/**
 * GET /admin/products
 *
 * The full catalogue, hidden and sold-out included — this is the one view that
 * must show unpublished work, so it deliberately does NOT reuse the public
 * whitelist in api/products/products.js.
 */
async function listProducts(_req, res) {
  try {
    const db = admin.firestore();
    const snap = await db.collection(COLLECTION).get();

    const products = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        productID: d.productID || '',
        title: d.title || '',
        description: d.description || '',
        actualPrice: typeof d.actualPrice === 'number' ? d.actualPrice : null,
        price: d.price || '',
        isAvailable: d.isAvailable !== false,
        soldOut: d.soldOut === true,
        deletedAt: d.deletedAt ? true : false,
        availableSizes: Array.isArray(d.availableSizes) ? d.availableSizes : [],
        availableColors: Array.isArray(d.availableColors) ? d.availableColors : [],
        productType: d.productType || '',
        category: d.category || '',
        theme: d.theme || '',
        tags: Array.isArray(d.tags) ? d.tags : [],
        storyCopy: typeof d.storyCopy === 'string' ? d.storyCopy : '',
        fileRows: Array.isArray(d.fileRows) ? d.fileRows : [],
        imgSrc: Array.isArray(d.imgSrc) ? d.imgSrc : [],
        previewSrc: Array.isArray(d.previewSrc) ? d.previewSrc : [],
        animalSlug: d.animalSlug || null,
        storeName: d.storeName || null,
        updatedAt: d.updatedAt?.toDate?.()?.toISOString() || null,
        updatedBy: d.updatedBy || null
      };
    });

    products.sort((a, b) => a.title.localeCompare(b.title));
    return res.json({ success: true, products, count: products.length });
  } catch (err) {
    console.error('admin listProducts failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to load products' });
  }
}

/**
 * PATCH /admin/products/:id
 *
 * Partial update. Only keys present in the body are touched, so the UI can send
 * a single toggle without round-tripping the whole document.
 */
async function updateProduct(req, res) {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ success: false, error: 'Missing product id' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const keys = Object.keys(body);
  if (keys.length === 0) {
    return res.status(400).json({ success: false, error: 'Nothing to update' });
  }

  // Reject the whole request on any bad field: a partial apply would leave the
  // admin unsure which half of their edit landed.
  const updates = {};
  const errors = [];
  for (const key of keys) {
    if (REFUSED[key]) { errors.push(`${key}: ${REFUSED[key]}`); continue; }
    const validate = EDITABLE[key];
    if (!validate) { errors.push(`${key}: not an editable field`); continue; }
    const result = validate(body[key]);
    if (!result.ok) { errors.push(`${key}: ${result.message}`); continue; }
    updates[key] = result.value;
  }
  if (errors.length) {
    return res.status(400).json({ success: false, error: errors.join('; '), fields: errors });
  }

  try {
    const db = admin.firestore();
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: 'Product not found' });
    const before = snap.data();

    // Keep the legacy tier symbol in step with the real price.
    if (Object.prototype.hasOwnProperty.call(updates, 'actualPrice')) {
      updates.price = priceSymbolFor(updates.actualPrice);
    }

    // Only record fields that actually moved, so the audit trail is signal.
    const changes = {};
    for (const [key, next] of Object.entries(updates)) {
      const prev = before[key];
      if (JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)) {
        changes[key] = { from: prev ?? null, to: next };
      }
    }

    if (Object.keys(changes).length === 0) {
      return res.json({ success: true, unchanged: true, id });
    }

    const actor = req.user?.email || req.user?.uid || 'admin-key';
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    updates.updatedBy = actor;

    await ref.update(updates);

    // Append-only. Written after the update so a failed write leaves no ghost
    // entry, and never allowed to fail the request — losing an audit line is
    // bad, but losing the admin's edit because logging broke is worse.
    try {
      await db.collection(AUDIT_COLLECTION).add({
        productId: id,
        productTitle: before.title || '',
        uid: req.user?.uid || null,
        email: actor,
        at: admin.firestore.FieldValue.serverTimestamp(),
        changes
      });
    } catch (auditErr) {
      console.error('product_audit write failed for', id, auditErr);
    }

    return res.json({ success: true, id, changed: Object.keys(changes) });
  } catch (err) {
    console.error('admin updateProduct failed:', err);
    return res.status(500).json({ success: false, error: 'Failed to update product' });
  }
}

module.exports = { listProducts, updateProduct, priceSymbolFor, EDITABLE, REFUSED, PRODUCT_TYPES, CATEGORIES, LIMITS };
