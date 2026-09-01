#!/usr/bin/env node
// functions/scripts/build-cell-coverage.js
//
// Compute per-spot mobile coverage grades from FCC Broadband Data Collection
// mobile-availability files and write them into data/spot-enrichment.json.
//
// The FCC publishes per-carrier mobile coverage as H3 resolution-9 hexagons
// (~2×/year, manual bulk download from broadbandmap.fcc.gov → Data Download →
// Mobile). This script NEVER guesses: no data file for a carrier → that carrier
// is omitted; no files at all → the spot keeps cellCoverage: null.
//
// Usage:
//   node scripts/build-cell-coverage.js --bdc-dir /path/to/bdc-csvs --vintage 2026-06
//
// Expected files in --bdc-dir (any subset): att.csv, verizon.csv, tmobile.csv
// Each CSV must contain an H3 res-9 hex id column (h3_res9_hex_id or h3index)
// and a technology column; rows present = coverage claimed at that hex.
//
// Grading per carrier at the spot's hex (plus its 6 neighbors, since launch
// points sit on shorelines where hexes straddle water):
//   center hex covered            → 'good'
//   only neighbor hex(es) covered → 'patchy'
//   nothing                      → 'none'
// Overall grade = best carrier grade.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

const BDC_DIR = arg('--bdc-dir');
const VINTAGE = arg('--vintage');
if (!BDC_DIR || !VINTAGE) {
  console.error('Usage: node scripts/build-cell-coverage.js --bdc-dir <dir> --vintage YYYY-MM');
  process.exit(1);
}

let h3;
try { h3 = require('h3-js'); }
catch { console.error('h3-js is required: npm i --save-dev h3-js'); process.exit(1); }

const CARRIERS = { att: 'att.csv', verizon: 'verizon.csv', tmobile: 'tmobile.csv' };
const manifestPath = path.join(__dirname, '..', 'data', 'spot-enrichment.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

async function loadCarrierHexes(file, wanted) {
  // Stream the (large) CSV and keep only the hexes we care about.
  const found = new Set();
  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  let hexCol = -1;
  for await (const line of rl) {
    const cols = line.split(',');
    if (hexCol === -1) {
      hexCol = cols.findIndex(c => /h3.*(res9|index)/i.test(c));
      if (hexCol === -1) hexCol = 0; // best effort: first column
      continue;
    }
    const hex = cols[hexCol]?.trim().replace(/"/g, '');
    if (wanted.has(hex)) found.add(hex);
  }
  return found;
}

async function main() {
  // Spot coordinates come from Firestore (authoritative), not the JSON.
  const admin = require('firebase-admin');
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'kaaykostore' });
  const snap = await admin.firestore().collection('paddlingSpots').get();
  const coords = {};
  snap.forEach(d => {
    const l = d.data().location;
    if (manifest.spots[d.id] && Number.isFinite(l?.latitude)) coords[d.id] = { lat: l.latitude, lng: l.longitude };
  });

  // Hex sets per spot: center + 6 neighbors at res 9
  const spotHexes = {};
  const wanted = new Set();
  for (const [id, c] of Object.entries(coords)) {
    const center = h3.latLngToCell(c.lat, c.lng, 9);
    const ring = h3.gridDisk(center, 1);
    spotHexes[id] = { center, ring: new Set(ring) };
    ring.forEach(hx => wanted.add(hx));
  }

  // Per-carrier coverage lookup
  const carrierHexes = {};
  for (const [carrier, file] of Object.entries(CARRIERS)) {
    const p = path.join(BDC_DIR, file);
    if (!fs.existsSync(p)) { console.warn(`no ${file} — ${carrier} omitted`); continue; }
    console.log(`reading ${file}…`);
    carrierHexes[carrier] = await loadCarrierHexes(p, wanted);
  }
  if (Object.keys(carrierHexes).length === 0) {
    console.error('No carrier files found — nothing written.');
    process.exit(1);
  }

  const rank = { none: 0, patchy: 1, good: 2 };
  for (const [id, hexes] of Object.entries(spotHexes)) {
    const carriers = {};
    for (const [carrier, covered] of Object.entries(carrierHexes)) {
      if (covered.has(hexes.center)) carriers[carrier] = 'good';
      else if ([...hexes.ring].some(hx => covered.has(hx))) carriers[carrier] = 'patchy';
      else carriers[carrier] = 'none';
    }
    const overall = Object.values(carriers).sort((a, b) => rank[b] - rank[a])[0] || 'none';
    manifest.spots[id].cellCoverage = {
      grade: overall,
      carriers,
      source: 'FCC BDC',
      bdcVintage: VINTAGE,
      h3Res: 9,
      computedAt: new Date().toISOString().split('T')[0]
    };
    console.log(`${id}: ${overall} (${Object.entries(carriers).map(([c, g]) => `${c}:${g}`).join(' ')})`);
  }

  manifest.meta.bdcVintage = VINTAGE;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote ${manifestPath}. Review, then: node scripts/seed-spot-enrichment.js --apply`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
