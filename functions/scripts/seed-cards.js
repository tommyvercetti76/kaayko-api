#!/usr/bin/env node
/**
 * seed-cards.js — move the property-card copy out of the generated SVGs and
 * into Firestore, once.
 *
 * Reads the card list the print script left behind (assets/cards/index.json)
 * and writes one document per card plus the shared back-of-card block. Safe to
 * re-run: it merges, so a later edit made in the admin panel is not clobbered
 * by a field this script would set to the same seed value — but it WILL restore
 * a field the seed knows and the document has lost.
 *
 *   node scripts/seed-cards.js             # show what it would write
 *   node scripts/seed-cards.js --commit    # write it
 *   node scripts/seed-cards.js --snapshot  # refresh the site's offline fallback
 *
 * --snapshot writes Firestore back out to assets/cards/index.json. That file is
 * what /card falls back to when the API cannot be reached; without a refresh it
 * slowly becomes a record of what the cards used to say.
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'kaaykostore' });
const db = admin.firestore();

const INDEX = path.resolve(__dirname, '../../../kaayko/src/assets/cards/index.json');
const COMMIT = process.argv.includes('--commit');
const SNAPSHOT = process.argv.includes('--snapshot');

// The back of every card. These were constants in the Python generator; they
// are content, so they belong with the rest of the content.
const BRAND = {
  label: 'KAAYKO',
  tagline: 'BUILDS THINGS, AND PUBLISHES THE FAILURES NEXT TO THE RESULTS',
  properties: 'Kaayko · Paddling Out · Forge · Kortex · Alumni',
  contact: 'kaayko.com · hello@kaayko.com'
};

// The host line as it is printed, which is not always what a URL parser returns.
const HOSTS = {
  kaayko: 'kaay.store',
  paddlingout: 'kaayko.com/paddlingout',
  forge: 'kaayko.com/forge',
  kortex: 'kaayko.com/kortex',
  alumni: 'kaayko.com/alumni'
};

async function snapshot() {
  const [cards, brandDoc] = await Promise.all([
    db.collection('kaaykocards').get(),
    db.collection('kaaykosettings').doc('cards').get()
  ]);
  const rows = cards.docs
    .map((d) => ({ slug: d.id, ...d.data() }))
    .filter((c) => c.live !== false)
    .sort((a, b) => a.n - b.n)
    .map(({ n, slug, name, hook, host, url, accent, art }) =>
      ({ n, slug, name, hook, host, url, accent, art }));
  const out = {
    label: (brandDoc.exists && brandDoc.data().label) || 'KAAYKO',
    v: String(Date.now()),
    note: 'Offline fallback for /card. The live copy is in Firestore; refresh this with scripts/seed-cards.js --snapshot',
    cards: rows
  };
  fs.writeFileSync(INDEX, JSON.stringify(out, null, 1) + '\n');
  console.log(`snapshot written: ${rows.length} cards -> ${INDEX}`);
}

(async () => {
  if (SNAPSHOT) return snapshot();

  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const rows = index.cards.map((c) => ({
    slug: c.slug,
    n: c.n,
    name: c.name,
    hook: c.hook,
    host: HOSTS[c.slug] || '',
    url: c.url,
    accent: c.accent,
    art: c.slug,
    live: true
  }));

  for (const row of rows) {
    console.log(`${COMMIT ? 'write' : 'would write'}  kaaykocards/${row.slug}  ${row.n}. ${row.name} — "${row.hook}"`);
  }
  console.log(`${COMMIT ? 'write' : 'would write'}  kaaykosettings/cards  ${BRAND.label} / ${BRAND.contact}`);

  if (!COMMIT) return console.log('\nnothing written. re-run with --commit');

  const batch = db.batch();
  for (const { slug, ...rest } of rows) {
    batch.set(db.collection('kaaykocards').doc(slug),
      { ...rest, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  batch.set(db.collection('kaaykosettings').doc('cards'),
    { ...BRAND, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  console.log(`\n${rows.length} cards and the brand block written.`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
