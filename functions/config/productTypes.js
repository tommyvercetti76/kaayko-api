/**
 * productTypes.js — THE product-type registry. One table, read by everything.
 *
 *   pricing.js            → price when a document carries no actualPrice; tax code; sellability
 *   api/products          → GET /products/types and `productTypes` on the list; hides coming-soon types
 *   api/admin/products    → the admin enum and the select in the Products view
 *   kreatorProductRoutes  → the enum a kreator may choose from
 *   store_uploader        → fetches GET /products/types for KNOWN_TYPES and per-type defaults
 *
 * Adding a type is one row here. Nothing elsewhere changes. Flipping a row from
 * `coming_soon` to `live` is a launch.
 *
 * Fields:
 *   key         string   what `kaaykoproducts.productType` holds
 *   label       string   plural, for grid sections and chips
 *   singular    string   for the PDP eyebrow ("Originals · Hoodie")
 *   priceCents  int      the price of the type. pricing.js charges this when a document
 *                        has no `actualPrice`; the uploader writes it as the default.
 *   sizes       string[] uploader default for `availableSizes`. Never [] — an empty
 *                        array switches size validation off (see pricing.resolveSize).
 *   category    string   uploader default; matches CATEGORIES below
 *   taxCode     string   Stripe Tax product code when the document carries none
 *   status      'live' | 'coming_soon' | 'retired'
 *                        coming_soon: shown as a line on the grid, never listed, never priced
 *                        retired:     never listed, never priced (historical orders untouched)
 *
 * Decided 13 Sep 2026 (Rohan): magnets 5.99, t-shirts 19.99, bottles 19.99, hoodies 24.99,
 * totes 29.99; mugs 9.99 and stickers 4.99 coming soon; print, cap and poster dropped.
 *
 * 13 Sep 2026 (evening): the Product Owner review's price list, accepted by the owner:
 * tee 24.99 · hoodie 49.99 (was below cost) · tote 29.99 · bottle 29.99 · magnet 9.99
 * (carries its own postage alone) · mug 19.99. The sticker is RETIRED as a product; it
 * comes back as the card in every parcel. Historical orders snapshot their price.
 */

const CLOTHING = 'txcd_30011000';   // Stripe Tax: Clothing & Footwear
const GOODS    = 'txcd_99999999';   // Stripe Tax: general tangible goods

const PRODUCT_TYPES = Object.freeze([
  Object.freeze({ key: 'tshirt',  label: 'T-Shirts', singular: 'T-Shirt', priceCents: 2499, sizes: ['S', 'M', 'L', 'XL'], category: 'apparel',     taxCode: CLOTHING, status: 'live' }),
  Object.freeze({ key: 'hoodie',  label: 'Hoodies',  singular: 'Hoodie',  priceCents: 4999, sizes: ['S', 'M', 'L', 'XL'], category: 'apparel',     taxCode: CLOTHING, status: 'live' }),
  Object.freeze({ key: 'tote',    label: 'Totes',    singular: 'Tote',    priceCents: 2999, sizes: ['One Size'],          category: 'accessories', taxCode: GOODS,    status: 'live' }),
  Object.freeze({ key: 'bottle',  label: 'Bottles',  singular: 'Bottle',  priceCents: 2999, sizes: ['20 oz'],             category: 'drinkware',   taxCode: GOODS,    status: 'live' }),
  Object.freeze({ key: 'magnet',  label: 'Magnets',  singular: 'Magnet',  priceCents: 999,  sizes: ['One Size'],          category: 'accessories', taxCode: GOODS,    status: 'live' }),
  Object.freeze({ key: 'mug',     label: 'Mugs',     singular: 'Mug',     priceCents: 1999,  sizes: ['One Size'],          category: 'drinkware',   taxCode: GOODS,    status: 'coming_soon' }),
  Object.freeze({ key: 'sticker', label: 'Stickers', singular: 'Sticker', priceCents: 499,  sizes: ['One Size'],          category: 'accessories', taxCode: GOODS,    status: 'retired' })
]);

/** Closed set for `category`. 'other' is what a kreator product lands in when nothing fits. */
const CATEGORIES = Object.freeze(['apparel', 'accessories', 'drinkware', 'other']);

const BY_KEY = new Map(PRODUCT_TYPES.map((t) => [t.key, t]));

/** The row for a `productType` value, or null when the type is unknown to the registry. */
function typeFor(productType) {
  const key = String(productType || '').trim().toLowerCase();
  return BY_KEY.get(key) || null;
}

/** Keys of every row, in registry order — the admin/kreator enum. */
const TYPE_KEYS = Object.freeze(PRODUCT_TYPES.map((t) => t.key));

/**
 * May a product of this type be listed and sold?
 * Unknown types (a kreator's 'other') are sellable: the registry only refuses what it
 * knows is not ready or is retired.
 */
function isSellableType(productType) {
  const t = typeFor(productType);
  return !t || t.status === 'live';
}

/** What the public API hands the storefront: nothing an operator would not put on the grid. */
function publicTypes() {
  return PRODUCT_TYPES
    .filter((t) => t.status !== 'retired')
    .map(({ key, label, singular, priceCents, sizes, category, status }) => ({ key, label, singular, priceCents, sizes, category, status }));
}

module.exports = { PRODUCT_TYPES, CATEGORIES, TYPE_KEYS, typeFor, isSellableType, publicTypes };
