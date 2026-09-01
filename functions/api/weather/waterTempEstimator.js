// functions/api/weather/waterTempEstimator.js
//
// Estimating lake water temperature from TODAY's air temperature is physically
// wrong and it produced real harm: Lake Union on 31 Aug estimated 9.5 °C (49 °F)
// against an actual ~21 °C (70 °F), which fired a "Cold water" alert and told
// paddlers to wear a drysuit on a warm summer lake.
//
// A lake's surface integrates heat over WEEKS, not hours. The standard
// first-order approximation is that summer surface temperature tracks the
// multi-week mean air temperature. So we use a real 30-day mean air temperature
// (Open-Meteo — free, no key) rather than a same-day guess.
//
// This is still an ESTIMATE and is always labelled as one. A measured USGS
// sensor (hydrologyService.getWaterTemp) always wins when the spot has one.

const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const COLLECTION = 'water_temp_estimate_cache';
const TTL_HOURS = 24;          // 30-day means move slowly; one fetch per spot per day
const STALE_MAX_DAYS = 14;     // on upstream failure, an old window still beats a bad formula
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

/** Cache key at ~11 km resolution — neighbouring spots share a climate window. */
function coordKey(lat, lng) {
  return `wt_${(Math.round(lat * 10) / 10).toFixed(1)}_${(Math.round(lng * 10) / 10).toFixed(1)}`;
}

async function fetch30DayMeanAir(lat, lng) {
  const url = `${OPEN_METEO}?latitude=${lat}&longitude=${lng}` +
              `&daily=temperature_2m_mean&past_days=30&forecast_days=1&timezone=auto`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const d = await r.json();
  const vals = (d?.daily?.temperature_2m_mean || []).filter(v => Number.isFinite(v));
  if (vals.length < 14) throw new Error('insufficient history');
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/**
 * Estimated water temperature (°C), or null when the climate window can't be
 * fetched — callers then fall back to the caller's own cruder estimate.
 *
 * Model: surface water ≈ 30-day mean air temperature, floored at 1 °C (ice
 * cover) and never above 32 °C. Deliberately simple and documented: it is a
 * first-order physical approximation, not a tuned model, and it is always
 * presented to users as an estimate.
 */
async function estimateWaterTempC(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const db = getFirestore();
  const key = coordKey(lat, lng);

  let staleValue = null;   // last known good, used if the upstream call fails
  try {
    const doc = await db.collection(COLLECTION).doc(key).get();
    if (doc.exists) {
      const data = doc.data();
      if (Number.isFinite(data.celsius)) {
        if (data.expiresAt && data.expiresAt.toDate() > new Date()) return data.celsius;
        // Expired but usable: a 30-day mean barely moves day to day, so a
        // slightly stale value is far better than the crude fallback.
        const ageDays = data.computedAt?.toDate
          ? (Date.now() - data.computedAt.toDate().getTime()) / 86400000
          : Infinity;
        if (ageDays <= STALE_MAX_DAYS) staleValue = data.celsius;
      }
    }
  } catch { /* cache miss is non-fatal */ }

  let celsius;
  try {
    const meanAir = await fetch30DayMeanAir(lat, lng);
    celsius = Math.round(Math.max(1, Math.min(32, meanAir)) * 10) / 10;
  } catch (err) {
    // Open-Meteo is free and occasionally rate-limits shared Cloud Run egress.
    // Serving the last good climate window keeps a transient failure from
    // silently reverting us to the bad same-day formula (which is what put a
    // drysuit warning on a warm summer lake).
    console.warn(`estimateWaterTempC ${key}: ${err.message}${staleValue != null ? ' — serving last known good' : ''}`);
    return staleValue;
  }

  db.collection(COLLECTION).doc(key).set({
    celsius,
    method: '30d-mean-air',
    computedAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + TTL_HOURS * 3600 * 1000)
  }).catch(() => { /* non-fatal */ });

  return celsius;
}

module.exports = { estimateWaterTempC };
