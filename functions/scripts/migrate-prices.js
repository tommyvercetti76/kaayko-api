#!/usr/bin/env node
/**
 * migrate-prices.js — prices by product type; the tier symbol retires.
 *
 * For every house product (no `kreatorId`) in `kaaykoproducts`:
 *   • `actualPrice` ← the registry price for its `productType` (config/productTypes.js)
 *   • `price`       ← deleted (the tier symbol; nothing reads it after 13 Sep 2026)
 *   • one `product_audit` entry per changed document, actor "migrate-prices"
 *
 * Kreator products keep their own `actualPrice`; only the dead `price` field is
 * removed from them. A house product with no `productType` but category apparel
 * (nine hidden shirts from before the field existed) is typed `tshirt`.
 * Historical orders are untouched — they snapshot the price.
 *
 *   node scripts/migrate-prices.js            # dry run: prints the diff, writes nothing
 *   node scripts/migrate-prices.js --apply    # writes
 *
 * Auth: Application Default Credentials (gcloud auth application-default login)
 * or GOOGLE_APPLICATION_CREDENTIALS. Project: kaaykostore.
 */
const admin = require('firebase-admin');
const { typeFor } = require('../config/productTypes');

const APPLY = process.argv.includes('--apply');
const PROJECT = process.env.GCLOUD_PROJECT || 'kaaykostore';

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

async function main() {
  const snap = await db.collection('kaaykoproducts').get();
  const plan = [];
  const problems = [];

  for (const doc of snap.docs) {
    const d = doc.data();
    const isHouse = !d.kreatorId;
    const type = typeFor(d.productType);
    const changes = {};

    if (isHouse) {
      // Nine hidden shirts were uploaded before productType existed: category
      // apparel, sizes S/M/L, no type. The fit picker already treats them as
      // t-shirts; the document should say so too.
      let resolvedType = type;
      if (!resolvedType && !d.productType && String(d.category || '').toLowerCase() === 'apparel') {
        resolvedType = typeFor('tshirt');
        changes.productType = { from: null, to: 'tshirt' };
      }
      if (!resolvedType) {
        problems.push(`${doc.id}: productType "${d.productType}" is not in the registry — skipped`);
        continue;
      }
      const next = resolvedType.priceCents / 100;
      if (d.actualPrice !== next) changes.actualPrice = { from: d.actualPrice ?? null, to: next };
    }
    if (d.price !== undefined) changes.price = { from: d.price, to: null };

    if (Object.keys(changes).length) plan.push({ id: doc.id, title: d.title || '', type: d.productType || '', isHouse, changes });
  }

  console.log(`${snap.size} products read; ${plan.length} to change; ${problems.length} skipped.\n`);
  for (const p of plan) {
    const parts = Object.entries(p.changes).map(([k, c]) => `${k}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
    console.log(`  ${p.id.padEnd(28)} ${p.type.padEnd(7)} ${p.isHouse ? 'house  ' : 'kreator'}  ${parts.join('; ')}`);
  }
  for (const p of problems) console.log(`  ! ${p}`);

  if (!APPLY) {
    console.log('\n[dry run] nothing written. Re-run with --apply.');
    return;
  }

  let batch = db.batch();
  let n = 0;
  for (const p of plan) {
    const ref = db.collection('kaaykoproducts').doc(p.id);
    const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: 'migrate-prices' };
    if (p.changes.actualPrice) update.actualPrice = p.changes.actualPrice.to;
    if (p.changes.productType) update.productType = p.changes.productType.to;
    if (p.changes.price) update.price = admin.firestore.FieldValue.delete();
    batch.update(ref, update);
    batch.set(db.collection('product_audit').doc(), {
      productId: p.id,
      productTitle: p.title,
      uid: null,
      email: 'migrate-prices',
      at: admin.firestore.FieldValue.serverTimestamp(),
      changes: p.changes
    });
    n += 2;
    if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (n) await batch.commit();
  console.log(`\nApplied ${plan.length} update(s) with audit entries.`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
