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

/**
 * Month (1-12) whose normals apply AT THE SPOT, not at Greenwich.
 *
 * Same bug class as the location-local clock fixed in algorithm v2.5.0: a gauge
 * in Hawaii (UTC-10) or New Zealand (UTC+13) sits in a different calendar month
 * from UTC for up to 14 hours around every month boundary, and the month selects
 * the percentile normals that decide the flow band — which feeds a score penalty
 * and a paddler-facing tip. The wrong month is a wrong band.
 *
 * Three sources, most trustworthy first. The chosen one is published on the
 * payload as `normalsMonthSource` so a consumer can see what it got:
 *   'local-time'       — the caller passed the spot's local wall clock
 *                        (WeatherAPI "YYYY-MM-DD HH:mm"), same string
 *                        paddleScoreCompute.js reads for its local hour. Exact.
 *   'solar-longitude'  — mean solar time from the spot's longitude
 *                        (offset = lon/15 h). Civil zones differ from mean solar
 *                        time by at most ~3 h in practice (zone width + DST), so
 *                        this cuts the worst-case month error from ~14 h of the
 *                        year to ~3 h of it.
 *   'utc'              — nothing positional was supplied; last resort, declared.
 *
 * @param {object} [opts]
 * @param {string} [opts.localTime]  spot-local wall clock, "YYYY-MM-DD HH:mm"
 * @param {number} [opts.longitude]  spot longitude in degrees east
 * @param {number} [opts.now]        epoch ms override (tests)
 * @returns {{month: number, source: string}}
 */
function resolveNormalsMonth(opts = {}) {
  const nowMs = Number.isFinite(opts.now) ? opts.now : Date.now();

  const lt = String(opts.localTime || '');
  const m = lt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) return { month, source: 'local-time' };
  }

  // Number(null) is 0 — i.e. Greenwich. A missing longitude must stay missing
  // rather than silently claiming the prime meridian (same null-as-zero class
  // as the 0.0 °C water-temperature bug in dataStandardization.js).
  const rawLon = opts.longitude;
  const lon = (rawLon === null || rawLon === undefined || rawLon === '') ? NaN : Number(rawLon);
  if (Number.isFinite(lon) && Math.abs(lon) <= 180) {
    const shifted = new Date(nowMs + (lon / 15) * 3600000);
    return { month: shifted.getUTCMonth() + 1, source: 'solar-longitude' };
  }

  return { month: new Date(nowMs).getUTCMonth() + 1, source: 'utc' };
}

function bandFor(cms, normalsForMonth) {
  if (!normalsForMonth || !Number.isFinite(cms)) return null;
  const { p10, p25, p75, p90 } = normalsForMonth;
  if (cms > p90) return 'high';
  if (cms > p75) return 'above';
  if (cms < p10) return 'low';   // drives FLOW_LOW in paddlePenalties.js
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
 * Percentile context + staleness, derived from a payload's own discharge and
 * observation time. Kept separate from the fetch so a CACHED payload can be
 * re-contextualised in-process: the cache is keyed by gauge only, so a payload
 * stored under one month (or by a caller that supplied no position) must not
 * hand the next caller that month's band. No network call, no extra USGS quota.
 */
function withNormals(payload, hydrologyMeta, monthInfo, nowMs = Date.now()) {
  const cms = Number(payload?.discharge?.cms);
  const normals = hydrologyMeta?.monthlyNormals?.[String(monthInfo.month)]
    || hydrologyMeta?.monthlyNormals?.[monthInfo.month]
    || null;
  const observedAt = payload?.discharge?.observedAt;
  const ageHours = observedAt ? (nowMs - Date.parse(observedAt)) / 3600000 : NaN;
  return {
    ...payload,
    pctOfNormal: pctOfNormal(cms, normals),
    pctOfNormalBand: bandFor(cms, normals),
    normalsMonth: monthInfo.month,
    normalsMonthSource: monthInfo.source,
    // Unknown age is stale: a reading we cannot date is not a live reading.
    stale: !Number.isFinite(ageHours) || ageHours > STALE_HOURS
  };
}

/**
 * Live hydrology for one gauge. Cache-first; { unavailable: true } is cached too.
 * @param {object} hydrologyMeta - the spot doc's hydrology block ({gaugeId, monthlyNormals, ...})
 * @param {object} [opts] - spot position for the normals month; see resolveNormalsMonth
 * @param {string} [opts.localTime] spot-local wall clock "YYYY-MM-DD HH:mm"
 * @param {number} [opts.longitude] spot longitude, degrees east
 * @param {number} [opts.now] epoch ms override (tests)
 */
async function getHydrology(hydrologyMeta, opts = {}) {
  const gaugeId = hydrologyMeta?.gaugeId;
  if (!gaugeId || hydrologyMeta.active === false) return null;

  const nowMs = Number.isFinite(opts.now) ? opts.now : Date.now();
  const monthInfo = resolveNormalsMonth({ ...opts, now: nowMs });

  const cache = new HydrologyCache();
  const cached = await cache.get(gaugeId);
  if (cached) return cached.unavailable ? null : withNormals(cached, hydrologyMeta, monthInfo, nowMs);

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

    payload = {
      gaugeId,
      gaugeName: hydrologyMeta.gaugeName || gaugeId,
      distanceKm: hydrologyMeta.distanceKm ?? null,
      discharge: { cms: Math.round(cms * 100) / 100, observedAt: discharge.time },
      // DISPLAY ONLY — deliberately not a scoring input. Stage is a height above
      // an arbitrary per-gauge datum and is meaningless without that gauge's rating
      // curve or a published minimum-runnable stage for the reach, neither of which
      // we hold. The FLOW_LOW / FLOW_HIGH gates in paddlePenalties.js key off the
      // discharge percentile instead, which is normalized per river. Do not wire
      // gageHeight into a penalty until per-reach minimum stages exist.
      gageHeight: stage ? { m: Math.round(stage.value * FT_TO_M * 100) / 100, observedAt: stage.time } : null,
      source: 'USGS Water Data API',
      gaugeUrl: `https://waterdata.usgs.gov/monitoring-location/${gaugeId.replace(/^USGS-/, '')}`,
      fetchedAt: new Date(nowMs).toISOString()
    };
    // pctOfNormal / pctOfNormalBand / stale are assigned by withNormals, from
    // the spot-local month — never from the server's UTC month.
    payload = withNormals(payload, hydrologyMeta, monthInfo, nowMs);
  } catch (err) {
    console.warn(`getHydrology ${gaugeId}: ${err.message}`);
    await cache.set(gaugeId, { unavailable: true });
    return null;
  }

  await cache.set(gaugeId, payload);
  return payload;
}

module.exports = { getHydrology, getWaterTemp, HydrologyCache, resolveNormalsMonth, STALE_HOURS };
