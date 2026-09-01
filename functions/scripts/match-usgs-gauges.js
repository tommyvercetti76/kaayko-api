#!/usr/bin/env node
// functions/scripts/match-usgs-gauges.js
//
// Match each river spot to its nearest ACTIVELY-REPORTING USGS discharge gauge
// (modernized Water Data OGC API only) and precompute monthly discharge normals.
// Writes into data/spot-enrichment.json for human review — a nearest gauge can
// sit on the wrong fork, and (verified) a nearby gauge can exist without a live
// feed (Moab's Highway Bridge site) while the canonical reference sits farther
// upstream (Cisco). Review the gaugeName + distanceKm before seeding.
//
// Usage: node scripts/match-usgs-gauges.js
// Then:  review data/spot-enrichment.json → node scripts/seed-spot-enrichment.js --apply

const fs = require('fs');
const path = require('path');

const API = 'https://api.waterdata.usgs.gov/ogcapi/v0';
const SEARCH_DEG = 0.6;          // ~60 km half-box — wide, distance flagged for review
const NORMALS_YEARS = 10;        // period for monthly percentile normals
const CFS_TO_CMS = 0.0283168;

const manifestPath = path.join(__dirname, '..', 'data', 'spot-enrichment.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// The keyless tier rate-limits hard enough to fail partway through 17 spots.
// Get a free key at https://api.waterdata.usgs.gov/signup/ and export USGS_API_KEY.
async function getJSON(url) {
  const key = process.env.USGS_API_KEY;
  const full = key ? `${url}&api_key=${encodeURIComponent(key)}` : url;
  const r = await fetch(full, { headers: { Accept: 'application/geo+json' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const d = await r.json();
  if (d.error) {
    throw new Error(d.error.code === 'OVER_RATE_LIMIT'
      ? 'USGS rate limit — set USGS_API_KEY (free: https://api.waterdata.usgs.gov/signup/)'
      : `USGS ${d.error.code}`);
  }
  return d;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

async function findReportingGauge(lat, lng, riverToken) {
  const bbox = [lng - SEARCH_DEG, lat - SEARCH_DEG, lng + SEARCH_DEG, lat + SEARCH_DEG].join(',');
  // site_type_code=ST server-side: dense boxes (e.g. New England) can fill the
  // page limit with groundwater wells before a single stream site appears.
  const d = await getJSON(`${API}/collections/monitoring-locations/items?bbox=${bbox}&site_type_code=ST&f=json&limit=500`);
  const streams = (d.features || [])
    .filter(f => f.properties?.site_type_code === 'ST')
    .map(f => ({
      id: f.id,
      name: f.properties.monitoring_location_name,
      lat: f.geometry?.coordinates?.[1],
      lng: f.geometry?.coordinates?.[0]
    }))
    .filter(s => Number.isFinite(s.lat))
    .map(s => ({ ...s, distanceKm: haversineKm(lat, lng, s.lat, s.lng) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  // Same-river candidates first (nearest tributary gauges are the classic
  // wrong-fork trap — Souhegan-in-Merrimack-town vs the Merrimack mainstem),
  // then everything else by distance as fallback.
  const named = streams.filter(s => riverToken && String(s.name).toUpperCase().includes(riverToken));
  const rest = streams.filter(s => !named.includes(s));
  const ordered = [...named, ...rest];

  console.log(`  ${streams.length} stream sites in box (${named.length} match "${riverToken}"); probing for live discharge…`);
  for (const s of ordered.slice(0, 40)) {
    const live = await getJSON(`${API}/collections/latest-continuous/items?monitoring_location_id=${encodeURIComponent(s.id)}&parameter_code=00060&f=json`);
    const feat = live.features?.[0];
    // FRESHNESS is mandatory: latest-continuous happily returns decades-old
    // final readings from discontinued gauges (Courthouse Wash's "latest" is 1989).
    const fresh = feat && (Date.now() - Date.parse(feat.properties?.time)) < 7 * 24 * 3600 * 1000;
    if (fresh && Number.isFinite(Number(feat.properties?.value))) {
      const stage = await getJSON(`${API}/collections/latest-continuous/items?monitoring_location_id=${encodeURIComponent(s.id)}&parameter_code=00065&f=json`);
      return { ...s, hasStage: (stage.features || []).length > 0, latestCfs: Number(feat.properties.value), latestTime: feat.properties.time };
    }
    console.log(`    ${s.id} (${s.distanceKm.toFixed(1)} km) — no live discharge, skipping`);
  }
  return null;
}

async function monthlyNormals(gaugeId) {
  const end = new Date();
  const start = new Date(end.getTime() - NORMALS_YEARS * 365.25 * 24 * 3600 * 1000);
  const range = `${start.toISOString().split('T')[0]}/${end.toISOString().split('T')[0]}`;
  const byMonth = Array.from({ length: 13 }, () => []);
  let url = `${API}/collections/daily/items?monitoring_location_id=${encodeURIComponent(gaugeId)}&parameter_code=00060&statistic_id=00003&datetime=${range}&f=json&limit=10000`;
  let pages = 0;
  while (url && pages < 5) {
    const d = await getJSON(url);
    for (const f of d.features || []) {
      const v = Number(f.properties?.value);
      const t = f.properties?.time;
      if (!Number.isFinite(v) || !t) continue;
      const month = Number(String(t).split('-')[1]);
      if (month >= 1 && month <= 12) byMonth[month].push(v * CFS_TO_CMS);
    }
    url = (d.links || []).find(l => l.rel === 'next')?.href || null;
    pages++;
  }
  const normals = {};
  let total = 0;
  for (let m = 1; m <= 12; m++) {
    const vals = byMonth[m].sort((a, b) => a - b);
    total += vals.length;
    if (vals.length < 30) continue; // not enough data for a defensible normal
    normals[m] = {
      p10: +percentile(vals, 0.10).toFixed(2),
      p25: +percentile(vals, 0.25).toFixed(2),
      p50: +percentile(vals, 0.50).toFixed(2),
      p75: +percentile(vals, 0.75).toFixed(2),
      p90: +percentile(vals, 0.90).toFixed(2)
    };
  }
  console.log(`  normals from ${total} daily values across ${Object.keys(normals).length} months (m³/s)`);
  return Object.keys(normals).length >= 6 ? normals : null;
}

async function main() {
  const admin = require('firebase-admin');
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'kaaykostore' });
  const snap = await admin.firestore().collection('paddlingSpots').get();
  const rivers = [];
  snap.forEach(doc => {
    const e = manifest.spots[doc.id];
    const data = doc.data();
    const l = data.location;
    if (e?.waterType === 'river' && Number.isFinite(l?.latitude)) {
      // "Merrimack River" → "MERRIMACK": the river's name for gauge-name matching
      const riverToken = String(data.title || data.lakeName || doc.id).split(/\s+/)[0].toUpperCase();
      rivers.push({ id: doc.id, lat: l.latitude, lng: l.longitude, riverToken });
    }
  });

  for (const spot of rivers) {
    console.log(`\n${spot.id} (${spot.lat.toFixed(4)}, ${spot.lng.toFixed(4)}) river="${spot.riverToken}"`);
    try {
      const gauge = await findReportingGauge(spot.lat, spot.lng, spot.riverToken);
      if (!gauge) { console.log('  NO reporting gauge found — hydrology stays null'); continue; }
      console.log(`  → ${gauge.id} "${gauge.name}" @ ${gauge.distanceKm.toFixed(1)} km, latest ${gauge.latestCfs} cfs (${gauge.latestTime}), stage:${gauge.hasStage}`);
      const normals = await monthlyNormals(gauge.id);
      manifest.spots[spot.id].hydrology = {
        gaugeId: gauge.id,
        gaugeName: gauge.name,
        distanceKm: +gauge.distanceKm.toFixed(1),
        hasStage: gauge.hasStage,
        monthlyNormals: normals,           // m³/s; null when record too thin
        matchedAt: new Date().toISOString().split('T')[0],
        active: true
      };
    } catch (err) {
      console.error(`  FAILED: ${err.message} — hydrology unchanged`);
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nWrote ${manifestPath}. REVIEW gauge names/distances (wrong-fork check), then seed with --apply.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
