/**
 * Nearby Water Body Service
 * Extracted from nearbyWater.js — Overpass API queries, processing, dedup.
 *
 * @module api/weather/nearbyWaterService
 */

const https = require('https');
const { logger } = require('firebase-functions');

// In-memory cache for water body results
const waterBodyCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of waterBodyCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) waterBodyCache.delete(key);
  }
  logger.info(`🧹 Cache cleanup: ${waterBodyCache.size} entries remaining`);
}, 10 * 60 * 1000);

/** Overpass API POST with mirror failover */
async function queryOverpass(query) {
  const mirrors = ['overpass-api.de', 'overpass.kumi.systems', 'lz4.overpass-api.de'];
  const postData = `data=${encodeURIComponent(query)}`;

  for (const hostname of mirrors) {
    try {
      const data = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname, port: 443, path: '/api/interpreter', method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData), 'User-Agent': 'Kaayko-API/1.0 (paddling conditions)' }
        }, (res) => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
        });
        req.on('error', reject);
        req.setTimeout(45000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(postData);
        req.end();
      });
      logger.info(`✅ Overpass query successful via ${hostname}`);
      return data;
    } catch (error) {
      logger.warn(`⚠️ Overpass mirror ${hostname} failed:`, error.message);
    }
  }
  logger.error('❌ All Overpass mirrors failed');
  return { elements: [] };
}

/** Haversine distance in miles */
function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Get element center coordinates */
function getElementCoords(element) {
  if (element.center) return { lat: element.center.lat, lng: element.center.lon };
  if (element.bounds) return {
    lat: (element.bounds.minlat + element.bounds.maxlat) / 2,
    lng: (element.bounds.minlon + element.bounds.maxlon) / 2
  };
  if (element.lat && element.lon) return { lat: element.lat, lng: element.lon };
  return null;
}

/** Detect water body type + priority from OSM tags */
function classifyWaterBody(tags, nameLower) {
  if (tags.landuse === 'reservoir' || tags.water === 'reservoir' || nameLower.includes('reservoir') || tags.place === 'reservoir')
    return { type: 'Reservoir', priority: 1 };
  if (tags.water === 'lake' || tags.place === 'lake' || nameLower.includes('lake'))
    return { type: 'Lake', priority: 1 };
  if (tags.waterway === 'river') return { type: 'River', priority: 2 };
  if (nameLower.includes('pond')) return { type: 'Pond', priority: 4 };
  if (tags.natural === 'water') return { type: 'Lake', priority: 2 };
  return { type: 'Water Body', priority: 3 };
}

// Well-known TX lakes for priority boost
const KNOWN_LAKES = ['lewisville', 'white rock', 'trinity', 'grapevine', 'arlington',
  'ray hubbard', 'bachman', 'mountain creek', 'caddo', 'texoma', 'joe pool', 'cedar creek'];

/** Parse raw Overpass elements into water-body objects */
function parseWaterElements(elements, lat, lng) {
  const bodies = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const name = tags.name || tags.reservoir_name || tags.official_name;
    if (!name || name.trim().length === 0) continue;
    const coords = getElementCoords(el);
    if (!coords) continue;

    const nameLower = name.toLowerCase();
    const dist = distanceMiles(lat, lng, coords.lat, coords.lng);
    const { type, priority } = classifyWaterBody(tags, nameLower);
    const boosted = KNOWN_LAKES.some(k => nameLower.includes(k)) ? 0 : priority;

    bodies.push({
      name: name.trim(), type, lat: coords.lat, lng: coords.lng,
      distanceMiles: Math.round(dist * 10) / 10,
      areaKm2: null, access: tags.access || 'unknown',
      operator: tags.operator || null, priority: boosted
    });
  }
  return bodies;
}

/** Attach closest public land info (<= 0.3 mi) to each water body */
function attachPublicLand(bodies, publicElements) {
  if (!publicElements?.length) return bodies;
  return bodies.filter(wb => {
    let minDist = Infinity, closest = null;
    for (const el of publicElements) {
      const c = getElementCoords(el);
      if (!c) continue;
      const d = distanceMiles(wb.lat, wb.lng, c.lat, c.lng);
      if (d < minDist) {
        minDist = d;
        const pt = el.tags || {};
        closest = {
          name: pt.name || pt.official_name || 'Public Land',
          type: pt.boundary || pt.leisure || 'public',
          distanceMiles: Math.round(d * 100) / 100
        };
      }
    }
    if (minDist <= 0.3 && closest) { wb.publicLand = closest; return true; }
    return false;
  });
}

/** Dedup nearby segments of the same water body */
function deduplicateBodies(bodies) {
  const result = [];
  for (const wb of bodies) {
    const baseName = wb.name.toLowerCase().replace(/\s+(lake|river|creek|reservoir|pond)\s*$/, '').trim();
    const idx = result.findIndex(ex => {
      const exBase = ex.name.toLowerCase().replace(/\s+(lake|river|creek|reservoir|pond)\s*$/, '').trim();
      return exBase === baseName && distanceMiles(wb.lat, wb.lng, ex.lat, ex.lng) <= 2;
    });
    if (idx >= 0) {
      const ex = result[idx];
      if (wb.distanceMiles < ex.distanceMiles || (wb.priority < ex.priority && Math.abs(wb.distanceMiles - ex.distanceMiles) < 1))
        result[idx] = wb;
    } else {
      result.push(wb);
    }
  }
  return result;
}

/** Sort by priority → public access → distance, strip priority, limit 20 */
function sortAndClean(bodies) {
  bodies.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const ps = w => w.publicLand ? 10 : w.access === 'public' ? 5 : 0;
    if (ps(a) !== ps(b)) return ps(b) - ps(a);
    return a.distanceMiles - b.distanceMiles;
  });
  return bodies.slice(0, 20).map(({ priority, ...rest }) => rest);
}

/**
 * Find nearby water bodies.
 * @param {number} lat
 * @param {number} lng
 * @param {number} radius km
 * @param {boolean} publicOnly
 * @returns {Promise<Object>} response payload
 */
async function findNearbyWater(lat, lng, radius, publicOnly) {
  const cacheKey = `${Math.round(lat * 100) / 100},${Math.round(lng * 100) / 100},${radius},${publicOnly}`;
  const cached = waterBodyCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.info(`✅ Cache HIT for ${cacheKey}`);
    return { ...cached.data, cached: true, cacheAge: Math.round((Date.now() - cached.timestamp) / 1000) };
  }

  const radiusMeters = radius * 1000;
  const waterQuery = `[out:json][timeout:90];(
relation(around:${radiusMeters},${lat},${lng})["landuse"="reservoir"]["name"];
way(around:${radiusMeters},${lat},${lng})["landuse"="reservoir"]["name"];
relation(around:${radiusMeters},${lat},${lng})["water"="lake"]["name"];
way(around:${radiusMeters},${lat},${lng})["water"="lake"]["name"];
relation(around:${radiusMeters},${lat},${lng})["place"="lake"]["name"];
way(around:${radiusMeters},${lat},${lng})["place"="lake"]["name"];
relation(around:${radiusMeters},${lat},${lng})["natural"="water"]["name"];
way(around:${radiusMeters},${lat},${lng})["natural"="water"]["name"];
relation(around:${radiusMeters},${lat},${lng})["waterway"="river"]["name"];
);out center tags;`;

  const waterData = await queryOverpass(waterQuery);
  let waterBodies = parseWaterElements(waterData.elements || [], lat, lng);

  if (publicOnly) {
    const pq = `[out:json][timeout:90];(
relation(around:${radiusMeters},${lat},${lng})["boundary"="protected_area"];
relation(around:${radiusMeters},${lat},${lng})["boundary"="national_park"];
relation(around:${radiusMeters},${lat},${lng})["boundary"="park"];
way(around:${radiusMeters},${lat},${lng})["leisure"="nature_reserve"];
relation(around:${radiusMeters},${lat},${lng})["leisure"="nature_reserve"];
way(around:${radiusMeters},${lat},${lng})["leisure"="park"];
relation(around:${radiusMeters},${lat},${lng})["leisure"="park"];
);out tags center;`;
    const publicData = await queryOverpass(pq);
    waterBodies = attachPublicLand(waterBodies, publicData.elements || []);
  }

  const results = sortAndClean(deduplicateBodies(waterBodies));
  const responseData = {
    success: true, location: { lat, lng, radiusKm: radius },
    waterBodies: results, publicOnly, timestamp: new Date().toISOString(), cached: false
  };

  waterBodyCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
  logger.info(`💾 Cached result for ${cacheKey} (${waterBodyCache.size} entries)`);
  return responseData;
}

module.exports = { findNearbyWater };
