// functions/scheduled/enrichmentFreshness.js
//
// Monthly re-validation of the static enrichment data so it can't silently rot:
//   - gauge health: does each river spot's USGS gauge still exist and report
//     discharge within the last 7 days?
//   - FCC coverage age: BDC publishes ~2x/year; flag vintages older than ~9 months.
//   - editorial tips age: flag spots whose enrichment hasn't been reviewed in a year.
// Writes per-spot status to enrichment_status/{spotId} and a summary to
// enrichment_status/global (surfaced on GET /paddleScore/metrics).

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const USGS_API = 'https://api.waterdata.usgs.gov/ogcapi/v0';
const GAUGE_FRESH_DAYS = 7;
const BDC_MAX_AGE_DAYS = 270;
const TIPS_REVIEW_DAYS = 365;

async function gaugeReporting(gaugeId) {
  const url = `${USGS_API}/collections/latest-continuous/items?monitoring_location_id=${encodeURIComponent(gaugeId)}&parameter_code=00060&f=json`;
  const r = await fetch(url, { headers: { Accept: 'application/geo+json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
  const d = await r.json();
  const p = d.features?.[0]?.properties;
  if (!p) return { ok: false, reason: 'no discharge series' };
  const ageDays = (Date.now() - Date.parse(p.time)) / 86400000;
  return ageDays <= GAUGE_FRESH_DAYS
    ? { ok: true, lastReport: p.time }
    : { ok: false, reason: `last report ${Math.round(ageDays)}d ago`, lastReport: p.time };
}

exports.enrichmentFreshness = onSchedule({
  schedule: '0 6 1 * *',
  timeZone: 'America/Los_Angeles',
  timeoutSeconds: 300,
  memory: '256MiB'
}, async () => {
  logger.info('enrichmentFreshness: starting');
  const db = getFirestore();
  const snapshot = await db.collection('paddlingSpots').get();

  const gaugesOk = [], gaugesStale = [], tipsReviewDue = [];
  let oldestBdcAgeDays = null;
  const batch = db.batch();
  const now = Date.now();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const status = { spotId: doc.id, checkedAt: FieldValue.serverTimestamp() };

    if (data.hydrology?.gaugeId) {
      try {
        const g = await gaugeReporting(data.hydrology.gaugeId);
        status.gauge = { id: data.hydrology.gaugeId, ...g };
        (g.ok ? gaugesOk : gaugesStale).push(doc.id);
      } catch (err) {
        status.gauge = { id: data.hydrology.gaugeId, ok: false, reason: err.message };
        gaugesStale.push(doc.id);
      }
    }

    if (data.cellCoverage?.bdcVintage) {
      const age = (now - Date.parse(data.cellCoverage.bdcVintage + '-01')) / 86400000;
      status.bdcAgeDays = Math.round(age);
      status.bdcRefreshRecommended = age > BDC_MAX_AGE_DAYS;
      oldestBdcAgeDays = Math.max(oldestBdcAgeDays ?? 0, Math.round(age));
    }

    const reviewedAt = data.enrichmentUpdatedAt?.toMillis?.();
    if (reviewedAt && (now - reviewedAt) / 86400000 > TIPS_REVIEW_DAYS) {
      status.tipsReviewDue = true;
      tipsReviewDue.push(doc.id);
    }

    if (status.gauge || status.bdcAgeDays != null || status.tipsReviewDue) {
      batch.set(db.collection('enrichment_status').doc(doc.id), status);
    }
  }

  batch.set(db.collection('enrichment_status').doc('global'), {
    lastRun: FieldValue.serverTimestamp(),
    gaugesOk,
    gaugesStale,
    oldestBdcAgeDays,
    tipsReviewDue
  });
  await batch.commit();

  logger.info(`enrichmentFreshness: gauges ok=${gaugesOk.length} stale=${gaugesStale.length}; bdcAge=${oldestBdcAgeDays}; tipsDue=${tipsReviewDue.length}`);
});
