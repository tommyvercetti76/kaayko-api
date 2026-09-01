// functions/api/weather/hydrologyService.js
//
// Live river data from the modernized USGS Water Data OGC API, normalized to SI
// at this boundary (discharge m³/s, stage m). Percentile-of-normal context comes
// from the spot's precomputed monthlyNormals (dictionary read — no stats calls
// at request time). Cached 30 min per gauge in hydrology_cache, with negative
// caching so a dead gauge doesn't get re-probed on every request.

const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const API = 'https://api.waterdata.usgs.gov/ogcapi/v0';
const CFS_TO_CMS = 0.0283168;
const FT_TO_M = 0.3048;
const TTL_MINUTES = 30;
const STALE_HOURS = 24; // gauge readings older than this are flagged, not presented as live

class HydrologyCache {
  constructor() {
    this.db = getFirestore();
    this.COLLECTION = 'hydrology_cache';
  }
  async get(gaugeId) {
    try {
      const doc = await this.db.collection(this.COLLECTION).doc(gaugeId).get();
      if (!doc.exists) return null;
      const data = doc.data();
      if (!data.expiresAt || data.expiresAt.toDate() <= new Date()) return null;
      return data.payload; // may be { unavailable: true } — negative cache
    } catch { return null; }
  }
  async set(gaugeId, payload) {
    try {
      const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);
      await this.db.collection(this.COLLECTION).doc(gaugeId).set({
        gaugeId, payload, cachedAt: FieldValue.serverTimestamp(), expiresAt
      });
    } catch (err) { console.warn(`HydrologyCache.set ${gaugeId}: ${err.message}`); }
  }
}

// The keyless tier is rate-limited hard enough that even 17 spots exhaust it.
// USGS_API_KEY (free: https://api.waterdata.usgs.gov/signup/) is appended when set.
function usgsUrl(path) {
  const key = process.env.USGS_API_KEY;
  return key ? `${API}${path}&api_key=${encodeURIComponent(key)}` : `${API}${path}`;
}

async function fetchLatest(gaugeId, parameterCode) {
  const url = usgsUrl(`/collections/latest-continuous/items?monitoring_location_id=${encodeURIComponent(gaugeId)}&parameter_code=${parameterCode}&f=json`);
  const r = await fetch(url, { headers: { Accept: 'application/geo+json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`USGS ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(`USGS ${d.error.code || 'error'}`);
  const p = d.features?.[0]?.properties;
  if (!p || !Number.isFinite(Number(p.value))) return null;
  return { value: Number(p.value), time: p.time };
}

/**
 * MEASURED water temperature (USGS parameter 00010) for a spot that has a
 * reviewed water-temperature site. Returns null when there is no source, the
 * reading is stale, or USGS is unavailable — callers then fall back to the
 * documented estimate and label it as one.
 *
 * @param {object} meta - spot.waterTemp: { gaugeId, gaugeName, distanceKm, siteType }
 */
async function getWaterTemp(meta) {
  const gaugeId = meta?.gaugeId;
  if (!gaugeId) return null;

  const cache = new HydrologyCache();
  const cacheKey = `wtemp_${gaugeId}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached.unavailable ? null : cached;

  try {
    const reading = await fetchLatest(gaugeId, '00010');
    if (!reading) { await cache.set(cacheKey, { unavailable: true }); return null; }

    const ageHours = (Date.now() - Date.parse(reading.time)) / 3600000;
    if (ageHours > STALE_HOURS) { await cache.set(cacheKey, { unavailable: true }); return null; }

    const payload = {
      celsius: Math.round(reading.value * 10) / 10,
      observedAt: reading.time,
      gaugeId,
      gaugeName: meta.gaugeName || gaugeId,
      distanceKm: meta.distanceKm ?? null,
      siteType: meta.siteType || null,
      source: 'USGS Water Data API',
      gaugeUrl: `https://waterdata.usgs.gov/monitoring-location/${gaugeId.replace(/^USGS-/, '')}`
    };
    await cache.set(cacheKey, payload);
    return payload;
  } catch (err) {
    console.warn(`getWaterTemp ${gaugeId}: ${err.message}`);
    await cache.set(cacheKey, { unavailable: true });
    return null;
  }
}

function bandFor(cms, normalsForMonth) {
  if (!normalsForMonth || !Number.isFinite(cms)) return null;
  const { p10, p25, p75, p90 } = normalsForMonth;
  if (cms > p90) return 'high';
  if (cms > p75) return 'above';
  if (cms < p10) return 'low';
  if (cms < p25) return 'below';
  return 'normal';
}

/** Approximate percentile of the current flow within this month's normal record. */
function pctOfNormal(cms, n) {
  if (!n || !Number.isFinite(cms)) return null;
  const pts = [[n.p10, 10], [n.p25, 25], [n.p50, 50], [n.p75, 75], [n.p90, 90]];
  if (cms <= pts[0][0]) return 10;
  if (cms >= pts[4][0]) return 90;
  for (let i = 0; i < pts.length - 1; i++) {
    const [v1, q1] = pts[i], [v2, q2] = pts[i + 1];
    if (cms >= v1 && cms <= v2) {
      return Math.round(q1 + (q2 - q1) * ((cms - v1) / Math.max(v2 - v1, 1e-9)));
    }
  }
  return 50;
}

/**
 * Live hydrology for one gauge. Cache-first; { unavailable: true } is cached too.
 * @param {object} hydrologyMeta - the spot doc's hydrology block ({gaugeId, monthlyNormals, ...})
 */
async function getHydrology(hydrologyMeta) {
  const gaugeId = hydrologyMeta?.gaugeId;
  if (!gaugeId || hydrologyMeta.active === false) return null;

  const cache = new HydrologyCache();
  const cached = await cache.get(gaugeId);
  if (cached) return cached.unavailable ? null : cached;

  let payload;
  try {
    const [discharge, stage] = await Promise.all([
      fetchLatest(gaugeId, '00060'),
      hydrologyMeta.hasStage ? fetchLatest(gaugeId, '00065') : Promise.resolve(null)
    ]);

    if (!discharge) {
      await cache.set(gaugeId, { unavailable: true });
      return null;
    }

    const cms = discharge.value * CFS_TO_CMS;
    const month = new Date().getUTCMonth() + 1;
    const normalsForMonth = hydrologyMeta.monthlyNormals?.[String(month)] || hydrologyMeta.monthlyNormals?.[month] || null;
    const ageHours = (Date.now() - Date.parse(discharge.time)) / 3600000;

    payload = {
      gaugeId,
      gaugeName: hydrologyMeta.gaugeName || gaugeId,
      distanceKm: hydrologyMeta.distanceKm ?? null,
      discharge: { cms: Math.round(cms * 100) / 100, observedAt: discharge.time },
      gageHeight: stage ? { m: Math.round(stage.value * FT_TO_M * 100) / 100, observedAt: stage.time } : null,
      pctOfNormal: pctOfNormal(cms, normalsForMonth),
      pctOfNormalBand: bandFor(cms, normalsForMonth),
      stale: ageHours > STALE_HOURS,
      source: 'USGS Water Data API',
      gaugeUrl: `https://waterdata.usgs.gov/monitoring-location/${gaugeId.replace(/^USGS-/, '')}`,
      fetchedAt: new Date().toISOString()
    };
  } catch (err) {
    console.warn(`getHydrology ${gaugeId}: ${err.message}`);
    await cache.set(gaugeId, { unavailable: true });
    return null;
  }

  await cache.set(gaugeId, payload);
  return payload;
}

module.exports = { getHydrology, getWaterTemp, HydrologyCache };
