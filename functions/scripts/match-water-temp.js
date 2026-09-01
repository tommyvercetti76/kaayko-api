#!/usr/bin/env node
// functions/scripts/match-water-temp.js
//
// Find a MEASURED water-temperature source (USGS parameter 00010) for every
// curated spot — lakes included, not just rivers — and write it into
// data/spot-enrichment.json for human review.
//
// Why this exists: with only ~17 spots there is no excuse for estimating water
// temperature from air temperature when a real sensor is sitting on the water.
// Where no sensor exists we keep the documented estimate and label it — but we
// should never estimate where a reading is available.
//
// REVIEW BEFORE SEEDING. Proximity is not identity: the matcher will happily
// offer a creek gauge a few km from a lake (Diablo's nearest 00010 site is a
// creek 8.4 km away, which is NOT the lake's water). Accept a site only when it
// is genuinely on the same body of water. `siteType` and `distanceKm` are
// recorded to make that judgement possible:
//   LK = lake/reservoir  ·  ST = stream  ·  ES = estuary
//
// Usage:
//   USGS_API_KEY=... node scripts/match-water-temp.js [--radius 0.25] [--max-km 12]
// Then review data/spot-enrichment.json and run seed-spot-enrichment.js --apply

const fs = require('fs');
const path = require('path');

const API = 'https://api.waterdata.usgs.gov/ogcapi/v0';
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? Number(process.argv[i + 1]) : dflt;
};
const SEARCH_DEG = arg('--radius', 0.25);   // ~25 km half-box
const MAX_KM     = arg('--max-km', 12);     // beyond this, a site is a different water body
const PACE_MS    = process.env.USGS_API_KEY ? 250 : 4000;

const manifestPath = path.join(__dirname, '..', 'data', 'spot-enrichment.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const sleep = ms => new Promise(r => setTimeout(r, ms));

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function getJSON(url) {
  const key = process.env.USGS_API_KEY;
  const full = key ? `${url}&api_key=${encodeURIComponent(key)}` : url;
  const r = await fetch(full, { headers: { Accept: 'application/geo+json' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (d.error) {
    throw new Error(d.error.code === 'OVER_RATE_LIMIT'
      ? 'USGS rate limit — set USGS_API_KEY (free: https://api.waterdata.usgs.gov/signup/)'
      : `USGS ${d.error.code}`);
  }
  return d;
}

async function findWaterTempSite(lat, lng) {
  const bbox = [lng - SEARCH_DEG, lat - SEARCH_DEG, lng + SEARCH_DEG, lat + SEARCH_DEG].join(',');
  const d = await getJSON(`${API}/collections/monitoring-locations/items?bbox=${bbox}&f=json&limit=400`);

  const candidates = (d.features || [])
    .map(f => ({
      id: f.id,
      name: f.properties.monitoring_location_name,
      siteType: f.properties.site_type_code,
      lat: f.geometry?.coordinates?.[1],
      lng: f.geometry?.coordinates?.[0]
    }))
    .filter(s => Number.isFinite(s.lat))
    .map(s => ({ ...s, distanceKm: haversineKm(lat, lng, s.lat, s.lng) }))
    .filter(s => s.distanceKm <= MAX_KM)
    // Lake/reservoir sites first — for a lake spot they are far likelier to be
    // the same water than a nearby stream gauge.
    .sort((a, b) => {
      const rank = t => (t === 'LK' ? 0 : t === 'ES' ? 1 : 2);
      return rank(a.siteType) - rank(b.siteType) || a.distanceKm - b.distanceKm;
    })
    .slice(0, 12);

  for (const s of candidates) {
    await sleep(PACE_MS);
    let v;
    try {
      v = await getJSON(`${API}/collections/latest-continuous/items?monitoring_location_id=${encodeURIComponent(s.id)}&parameter_code=00010&f=json`);
    } catch (err) {
      if (/rate limit/i.test(err.message)) throw err;
      continue;
    }
    const p = v.features?.[0]?.properties;
    if (!p || !Number.isFinite(Number(p.value))) continue;
    const ageHours = (Date.now() - Date.parse(p.time)) / 3600000;
    if (ageHours > 48) continue;   // a site that stopped reporting is not a source
    return { ...s, celsius: Number(p.value), observedAt: p.time, ageHours: Math.round(ageHours) };
  }
  return null;
}

async function main() {
  const admin = require('firebase-admin');
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'kaaykostore' });
  const snap = await admin.firestore().collection('paddlingSpots').get();

  const spots = [];
  snap.forEach(doc => {
    const l = doc.data().location;
    if (manifest.spots[doc.id] && Number.isFinite(l?.latitude)) {
      spots.push({ id: doc.id, lat: l.latitude, lng: l.longitude, waterType: manifest.spots[doc.id].waterType });
    }
  });

  if (!process.env.USGS_API_KEY) {
    console.warn('⚠️  USGS_API_KEY not set — the keyless tier will rate-limit before finishing.');
    console.warn('    Free key: https://api.waterdata.usgs.gov/signup/\n');
  }

  let found = 0;
  for (const spot of spots) {
    process.stdout.write(`${spot.id.padEnd(12)} `);
    try {
      const site = await findWaterTempSite(spot.lat, spot.lng);
      if (!site) { console.log('— no measured source within range (estimate stands)'); continue; }
      console.log(`✓ ${site.celsius}°C  ${site.distanceKm.toFixed(1)}km  ${site.siteType}  ${site.name.slice(0, 44)}  [REVIEW: same water?]`);
      manifest.spots[spot.id].waterTemp = {
        gaugeId: site.id,
        gaugeName: site.name,
        distanceKm: +site.distanceKm.toFixed(1),
        siteType: site.siteType,
        sampleCelsius: site.celsius,     // review aid only; runtime always re-fetches
        matchedAt: new Date().toISOString().split('T')[0]
      };
      found++;
    } catch (err) {
      console.log(`! ${err.message}`);
      if (/rate limit/i.test(err.message)) break;
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n${found}/${spots.length} spots have a candidate water-temperature source.`);
  console.log('REVIEW each one (is it the same body of water?), delete any that are not,');
  console.log('then: node scripts/seed-spot-enrichment.js --apply');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
