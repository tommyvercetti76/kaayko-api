// functions/data/lakeIndex.js
//
// In-memory lake index built from HydroLAKES global dataset (3,021 named lakes).
// Loaded once at module init — 280KB JSON, <5ms parse, ~0ms queries.
//
// For US coordinates: supplements with USGS NHD API (layer 12 = Large Scale Waterbody)
// which has comprehensive regional coverage of smaller named lakes.
//
// Fallback: Nominatim/OSM reverse + name search when all primary sources return 0 results.

const https  = require('https');
const { logger } = require('firebase-functions');

// ── HydroLAKES in-memory index ─────────────────────────────────────────────
const HYDROLAKES = require('./hydrolakes.json');

const LAKE_TYPE_NAME  = { 1: 'Lake', 2: 'Reservoir', 3: 'Lake' };
const NHD_FTYPE_NAME  = { 390: 'Lake', 436: 'Reservoir', 361: 'Playa' };

// Minimum area to be considered paddleable — eliminates backyard ponds
const MIN_AREA_KM2 = 0.5;

// OSM water types we care about for paddling
const OSM_WATER_TYPES = new Set([
  'water', 'lake', 'reservoir', 'pond', 'lagoon', 'bay', 'river', 'stream', 'canal', 'oxbow'
]);
const OSM_WATER_CLASSES = new Set(['natural', 'waterway', 'landuse']);
const OSM_TYPE_MAP = {
  water: 'Lake', lake: 'Lake', reservoir: 'Reservoir',
  pond: 'Lake', lagoon: 'Lake', bay: 'Lake', oxbow: 'Lake',
  river: 'River', stream: 'River', canal: 'Canal'
};

logger.info(`💧 LakeIndex loaded: ${HYDROLAKES.length} named lakes from HydroLAKES`);

// ── Haversine distance (miles) ─────────────────────────────────────────────
function distMiles(lat1, lon1, lat2, lon2) {
  const R    = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
               Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Estimate area in km² from OSM bounding box ────────────────────────────
function estimateAreaFromBbox(bbox, lat) {
  if (!Array.isArray(bbox) || bbox.length < 4) return null;
  const [minLat, maxLat, minLon, maxLon] = bbox.map(parseFloat);
  const h = (maxLat - minLat) * 111;
  const w = (maxLon - minLon) * 111 * Math.cos((lat || 0) * Math.PI / 180);
  const area = Math.round(Math.abs(h * w) * 10) / 10;
  return area > 0 ? area : null;
}

// ── Search HydroLAKES in-memory ────────────────────────────────────────────
// O(n) but n=3021 — completes in <1ms
function searchHydroLAKES(lat, lng, radiusMiles) {
  const results = [];
  const dLatDeg = radiusMiles / 69.0;

  for (const lake of HYDROLAKES) {
    // Skip ponds — must be genuinely paddleable
    if (lake.a < MIN_AREA_KM2) continue;
    // Fast lat pre-filter before haversine
    if (Math.abs(lake.lat - lat) > dLatDeg + 0.5) continue;

    const d = distMiles(lat, lng, lake.lat, lake.lng);
    if (d > radiusMiles) continue;

    results.push({
      id:            `hl_${lake.id}`,
      name:          lake.n,
      type:          LAKE_TYPE_NAME[lake.t] || 'Lake',
      lat:           lake.lat,
      lng:           lake.lng,
      distanceMiles: Math.round(d * 10) / 10,
      areaKm2:       lake.a,
      country:       lake.c,
      access:        'public',
      relevancy:     lake.t === 2 ? 85 : 90,
      source:        'hydrolakes',
      paddlingFeatures: {}
    });
  }

  return results.sort((a, b) => a.distanceMiles - b.distanceMiles);
}

// ── USGS NHD query (US only) ───────────────────────────────────────────────
function isUSCoord(lat, lng) {
  return lat >= 24 && lat <= 50 && lng >= -130 && lng <= -65;
}

async function queryNHD(lat, lng, radiusMiles) {
  const dLat = radiusMiles / 69.0;
  const dLng = radiusMiles / (69.0 * Math.cos(lat * Math.PI / 180));

  const bbox = JSON.stringify({
    xmin: lng - dLng, ymin: lat - dLat,
    xmax: lng + dLng, ymax: lat + dLat,
    spatialReference: { wkid: 4326 }
  });

  const qs = [
    // Min 0.5 km² — eliminates ponds and storm drainage features
    'where=GNIS_NAME+IS+NOT+NULL+AND+FType+IN+(390,436)+AND+AreaSqKm+>=+0.5',
    `geometry=${encodeURIComponent(bbox)}`,
    'geometryType=esriGeometryEnvelope',
    'spatialRel=esriSpatialRelIntersects',
    'inSR=4326',
    'outSR=4326',
    'outFields=GNIS_NAME,FType,AreaSqKm',
    'returnGeometry=true',
    'f=json',
    'resultRecordCount=30',
    'orderByFields=AreaSqKm+DESC'
  ].join('&');

  const path = `/arcgis/rest/services/nhd/MapServer/12/query?${qs}`;

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'hydro.nationalmap.gov',
      port: 443, path, method: 'GET',
      headers: { 'User-Agent': 'Kaayko-API/1.0' }
    }, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try {
          const data     = JSON.parse(body);
          const features = data.features || [];
          const results  = [];

          for (const feat of features) {
            const attrs = feat.attributes || {};
            const name  = (attrs.GNIS_NAME || '').trim();
            if (!name) continue;

            const rings = feat.geometry?.rings || [];
            if (!rings.length) continue;
            const pts  = rings[0];
            const cLng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
            const cLat = pts.reduce((s, p) => s + p[1], 0) / pts.length;

            const d = distMiles(lat, lng, cLat, cLng);
            if (d > radiusMiles) continue;

            const ftype = attrs.FType || 390;
            results.push({
              id:            `nhd_${name.toLowerCase().replace(/\s+/g, '_')}`,
              name,
              type:          NHD_FTYPE_NAME[ftype] || 'Lake',
              lat:           Math.round(cLat * 10000) / 10000,
              lng:           Math.round(cLng * 10000) / 10000,
              distanceMiles: Math.round(d * 10) / 10,
              areaKm2:       attrs.AreaSqKm ? Math.round(attrs.AreaSqKm * 10) / 10 : null,
              country:       'United States of America',
              access:        'public',
              relevancy:     ftype === 436 ? 85 : 90,
              source:        'nhd',
              paddlingFeatures: {}
            });
          }

          logger.info(`🏞️ NHD returned ${results.length} water bodies near ${lat.toFixed(3)},${lng.toFixed(3)}`);
          resolve(results);
        } catch (e) {
          logger.warn('NHD parse error:', e.message);
          resolve([]);
        }
      });
    });

    req.on('error', (e) => { logger.warn('NHD request error:', e.message); resolve([]); });
    req.setTimeout(12000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

// ── Nominatim HTTP helper ──────────────────────────────────────────────────
function nominatimGet(path) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'nominatim.openstreetmap.org',
      port: 443, path, method: 'GET',
      headers: {
        'User-Agent': 'Kaayko-PaddleApp/1.0 (contact@kaayko.com)',
        'Accept-Language': 'en'
      }
    }, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// Extract clean water body name from Nominatim display_name
// e.g. "Ambazari Lake, Sitabuldi, Nagpur, ..." → "Ambazari Lake"
function extractOsmName(displayName) {
  if (!displayName) return null;
  const first = displayName.split(',')[0].trim();
  // Filter out bare generics with no real name
  const generic = ['water', 'lake', 'river', 'pond', 'reservoir', 'stream', 'canal'];
  if (generic.includes(first.toLowerCase())) return null;
  return first.length > 1 ? first : null;
}

function makeOsmResult(name, lat, lng, osmType, areaKm2, distanceMiles = 0) {
  return {
    id:            `osm_${name.toLowerCase().replace(/\s+/g, '_')}`,
    name,
    type:          OSM_TYPE_MAP[osmType] || 'Lake',
    lat:           Math.round(lat  * 10000) / 10000,
    lng:           Math.round(lng  * 10000) / 10000,
    distanceMiles: Math.round(distanceMiles * 10) / 10,
    areaKm2:       areaKm2 || null,
    country:       null,
    access:        'public',
    relevancy:     75, // Lower than primary sources — treat as best-effort
    source:        'osm',
    paddlingFeatures: {}
  };
}

// ── Nominatim fallback ─────────────────────────────────────────────────────
// Three approaches, run in order until results found:
//  1. Bounding-box search — finds all named water bodies in the radius area
//  2. Reverse geocode — catches the specific lake the geocoder placed us at
//  3. Forward name search — catches exact lake when geocoder landed on a road
async function nominatimFallback(lat, lng, query) {
  const results = [];
  const seen    = new Set();

  function addResult(item, overrideLat, overrideLng) {
    const name = extractOsmName(item.display_name);
    if (!name) return;
    const key = name.toLowerCase().replace(/\s/g, '');
    if (seen.has(key)) return;

    const iLat = parseFloat(overrideLat ?? item.lat ?? lat);
    const iLng = parseFloat(overrideLng ?? item.lon ?? lng);
    if (isNaN(iLat) || isNaN(iLng)) return;

    const d    = distMiles(lat, lng, iLat, iLng);
    const area = estimateAreaFromBbox(item.boundingbox, iLat);
    if (area !== null && area < MIN_AREA_KM2) return; // skip ponds

    seen.add(key);
    results.push(makeOsmResult(name, iLat, iLng, item.type, area, d));
    logger.info(`🗺️ OSM found: "${name}" (${item.type || item.class}, ${d.toFixed(1)}mi, ${area ?? '?'}km²)`);
  }

  // 1. Bounding-box search — the most powerful approach for non-US regions.
  //    Searches all named natural/waterway features within the radius bounding box.
  try {
    const dLat = (30 / 69.0).toFixed(4); // ~30mi in degrees
    const dLng = (30 / (69.0 * Math.cos(lat * Math.PI / 180))).toFixed(4);
    const viewbox = `${(lng - dLng)},${(lat + dLat)},${(lng + dLng)},${(lat - dLat)}`;
    const body = await nominatimGet(
      `/search?format=json&limit=20&bounded=1&viewbox=${viewbox}` +
      `&featuretype=natural&addressdetails=0`
    );
    if (body) {
      const list = JSON.parse(body) || [];
      for (const item of list) {
        if (!OSM_WATER_TYPES.has(item.type) && item.class !== 'waterway') continue;
        addResult(item);
      }
    }
  } catch (e) { logger.warn('OSM bbox search error:', e.message); }

  // 2. Reverse geocode — works when user searched an exact lake by name
  //    Nominatim placed us AT the lake's center → reverse confirms what it is
  try {
    const body = await nominatimGet(`/reverse?lat=${lat}&lon=${lng}&format=json&zoom=14`);
    if (body) {
      const r = JSON.parse(body);
      if (r && (OSM_WATER_CLASSES.has(r.class) || OSM_WATER_TYPES.has(r.type))) {
        addResult(r, lat, lng);
      }
    }
  } catch (e) { logger.warn('OSM reverse error:', e.message); }

  // 3. Forward name search — catches cases where geocoder landed on a road/address
  if (query && results.length < 3) {
    try {
      const q    = encodeURIComponent(query.replace(/,.*$/, '').trim());
      const body = await nominatimGet(
        `/search?q=${q}&format=json&limit=10&addressdetails=0`
      );
      if (body) {
        const list = JSON.parse(body) || [];
        for (const item of list) {
          if (!OSM_WATER_CLASSES.has(item.class) && !OSM_WATER_TYPES.has(item.type)) continue;
          const iLat = parseFloat(item.lat);
          const iLng = parseFloat(item.lon);
          if (distMiles(lat, lng, iLat, iLng) > 120) continue;
          addResult(item);
        }
      }
    } catch (e) { logger.warn('OSM forward error:', e.message); }
  }

  return results;
}

// ── Public API: findNearby ─────────────────────────────────────────────────
// Strategy by region:
//   US/Canada: NHD (authoritative) + HydroLAKES supplement
//   Rest of world: OSM/Nominatim as PRIMARY (HydroLAKES is too US-biased to be useful)
//
// query: original text the user typed — used for OSM name lookup
async function findNearby(lat, lng, radiusMiles = 30, query = '') {
  const isUS = isUSCoord(lat, lng);

  // ── Normalise for dedup ──────────────────────────────────────────────────
  function normalise(name) {
    return name.toLowerCase()
      .replace(/\s+(lake|reservoir|pond|river|creek|lagoon|bay)\s*$/i, '')
      .replace(/^(lake|reservoir|pond|river|creek|lagoon|bay)\s+/i, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  const seen   = new Map();
  const merged = [];

  function addBody(body) {
    const key = normalise(body.name);
    if (!key) return;
    if (seen.has(key)) {
      const idx = seen.get(key);
      if (body.distanceMiles < merged[idx].distanceMiles) merged[idx] = body;
      return;
    }
    seen.set(key, merged.length);
    merged.push(body);
  }

  if (isUS) {
    // ── US path: NHD (authoritative) → HydroLAKES supplement ──────────────
    const [nhdResults, hlResults] = await Promise.all([
      queryNHD(lat, lng, radiusMiles),
      Promise.resolve(searchHydroLAKES(lat, lng, radiusMiles))
    ]);
    for (const b of nhdResults) addBody(b);
    for (const b of hlResults)  addBody(b);

    // OSM fallback only if both are dry
    if (merged.length === 0) {
      logger.info(`🔍 US sources empty — OSM fallback (q="${query}")`);
      const osm = await nominatimFallback(lat, lng, query);
      for (const b of osm) addBody(b);
    }

    logger.info(`🗺️ US findNearby(${lat.toFixed(3)},${lng.toFixed(3)}): ${nhdResults.length} NHD + ${hlResults.length} HL → ${merged.length}`);

  } else {
    // ── Global path: OSM as PRIMARY ────────────────────────────────────────
    // HydroLAKES has only 37 Indian lakes, 123 Chinese, etc. — not reliable.
    // OSM has millions of named water bodies worldwide maintained by local communities.
    logger.info(`🌍 Non-US search — OSM primary (q="${query}")`);
    const osmResults = await nominatimFallback(lat, lng, query);
    for (const b of osmResults) addBody(b);

    // HydroLAKES as supplement for any major lakes OSM reverse missed
    const hlResults = searchHydroLAKES(lat, lng, radiusMiles);
    for (const b of hlResults) addBody(b);

    logger.info(`🗺️ Global findNearby(${lat.toFixed(3)},${lng.toFixed(3)}): ${osmResults.length} OSM + ${hlResults.length} HL → ${merged.length}`);
  }

  merged.sort((a, b) => b.relevancy - a.relevancy || a.distanceMiles - b.distanceMiles);
  return merged.slice(0, 25);
}

module.exports = { findNearby, distMiles };
