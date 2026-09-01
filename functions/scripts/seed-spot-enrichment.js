#!/usr/bin/env node
// functions/scripts/seed-spot-enrichment.js
//
// Push reviewed enrichment fields (waterType, cellCoverage, localTips, hydrology)
// from data/spot-enrichment.json onto curated paddlingSpots docs.
//
// SAFE BY DEFAULT: dry-run prints a field-level diff and writes nothing.
//   node scripts/seed-spot-enrichment.js            # dry-run diff
//   node scripts/seed-spot-enrichment.js --apply    # merge-write the diff
//
// Only docIds present in the JSON are touched; only the four enrichment fields
// are written (merge). Community spots are never in the JSON.

const path = require('path');
const admin = require('firebase-admin');

const APPLY = process.argv.includes('--apply');
const FIELDS = ['waterType', 'cellCoverage', 'localTips', 'hydrology'];

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'kaaykostore' });
const db = admin.firestore();

async function main() {
  const manifest = require(path.join(__dirname, '..', 'data', 'spot-enrichment.json'));
  const spots = manifest.spots || {};
  let changes = 0;

  for (const [docId, enrichment] of Object.entries(spots)) {
    const ref = db.collection('paddlingSpots').doc(docId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.warn(`SKIP ${docId}: no such spot doc`);
      continue;
    }
    const current = snap.data();
    const update = {};

    for (const f of FIELDS) {
      if (!(f in enrichment)) continue;
      const next = enrichment[f];
      if (next === null || (Array.isArray(next) && next.length === 0)) continue; // no data → never write
      if (JSON.stringify(current[f]) !== JSON.stringify(next)) update[f] = next;
    }

    if (Object.keys(update).length === 0) continue;
    changes++;
    console.log(`${APPLY ? 'WRITE' : 'DIFF '} ${docId}: ${Object.keys(update).map(f => `${f}: ${JSON.stringify(current[f]) || '∅'} → ${JSON.stringify(update[f]).slice(0, 120)}`).join(' | ')}`);

    if (APPLY) {
      update.enrichmentUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
      await ref.set(update, { merge: true });
    }
  }

  console.log(`${APPLY ? 'Applied' : 'Dry-run:'} ${changes} spot(s) ${APPLY ? 'updated' : 'would change'}. ${APPLY ? '' : 'Re-run with --apply to write.'}`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
