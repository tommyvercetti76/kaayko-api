/**
 * linkHistory.js — daily totals for one link over up to a year, read from the
 * counts-only rollups (rollups.js) that outlive the 30-day event TTL. Paid
 * plans only (analyticsPolicy.historyDaysFor). Days with no rollup are zero.
 */
const admin = require('firebase-admin');
const { utcDateKey, dayStartMs } = require('./rollups');

const DAY_MS = 86400000;
const READ_CAP = 400;

async function linkHistory(tenantId, code, days, nowMs = Date.now()) {
  const n = Math.max(1, Math.min(366, Number(days) || 0));
  const toKey = utcDateKey(nowMs);
  const fromKey = utcDateKey(nowMs - (n - 1) * DAY_MS);
  const snap = await admin.firestore().collection('kortex_rollups')
    .where('tenantId', '==', tenantId)
    .where('code', '==', code)
    .where('date', '>=', fromKey)
    .where('date', '<=', toKey)
    .limit(READ_CAP)
    .get();
  const byDate = new Map(snap.docs.map(d => [d.data().date, d.data()]));
  const points = [];
  let observed = 0, delivered = 0, lost = 0, qr = 0;
  for (let ms = dayStartMs(fromKey); ms <= dayStartMs(toKey); ms += DAY_MS) {
    const key = utcDateKey(ms);
    const r = byDate.get(key) || {};
    const p = { date: key, observed: r.observed || 0, delivered: r.delivered || 0, lost: r.lost || 0, qr: r.qr || 0 };
    observed += p.observed; delivered += p.delivered; lost += p.lost; qr += p.qr;
    points.push(p);
  }
  return { days: n, from: fromKey, to: toKey, totals: { observed, delivered, lost, qr }, points, source: 'rollups', note: 'Daily totals only. Device, country and visitor detail is kept for 30 days.' };
}

module.exports = { linkHistory };
