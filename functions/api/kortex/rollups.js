/**
 * Daily rollups: one counts-only document per link per UTC day, so the
 * workspace overview reads days instead of replaying every event, and a
 * day's numbers outlive the 30-day event TTL. A rollup never holds a visitor
 * key, a referrer or a destination — only counts.
 *
 *   kortex_rollups/{tenantId}__{code}__{YYYY-MM-DD}
 *     { tenantId, code, date, observed, delivered, rescued, lost, qr, tap,
 *       byDevice, byCountry, byOutcome, byHourUtc[24], updatedAtMs, logicVersion }
 *   kortex_rollup_days/{YYYY-MM-DD}
 *     { date, complete, links, written, updatedAtMs, logicVersion }
 *
 * The day marker is what tells a reader the day was rolled at all (a tenant
 * with no scans that day has no rollup to find); `complete` is true only when
 * the day had ended before it was rolled, so today's partial roll is never
 * mistaken for a finished day.
 *
 * @module api/kortex/rollups
 */

'use strict';

const admin = require('firebase-admin');
const LinkService = require('./smartLinkService');
const { DEFAULT_TENANT_ID } = require('./tenantContext');

const db = admin.firestore();

const ROLLUPS = 'kortex_rollups';
const ROLLUP_DAYS = 'kortex_rollup_days';
const LOGIC_VERSION = 1;
const DAY_MS = 86400000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_READ_CAP = 10000;
const ROLLUP_READ_CAP = 5000;
const ROLLUP_DAYS_READ_CAP = 100;
const LINK_LIST_CAP = 500;

function utcDateKey(ms) { return new Date(ms).toISOString().slice(0, 10); }
function dayStartMs(dateKey) { return Date.parse(`${dateKey}T00:00:00Z`); }

/** `count` date keys ending the day before `dateKey`, oldest first. */
function dateKeysBefore(dateKey, count) {
  const end = dayStartMs(dateKey);
  return Array.from({ length: count }, (_, i) => utcDateKey(end - (count - i) * DAY_MS));
}

/** The two days the nightly job rolls: yesterday (final) and today (partial). */
function dailyRollupDates(nowMs = Date.now()) { return [utcDateKey(nowMs - DAY_MS), utcDateKey(nowMs)]; }

function rollupId(tenantId, code, dateKey) { return `${tenantId}__${code}__${dateKey}`; }

function eventMs(event) {
  if (Number.isFinite(event.timestampMs)) return event.timestampMs;
  return event.timestamp && typeof event.timestamp.toMillis === 'function' ? event.timestamp.toMillis() : null;
}

/** The stored outcome of an event of either schema version (readers accept both). */
function outcomeOf(event) { return event.outcome || (event.delivered === false ? 'unknown' : 'delivered'); }

/** delivered | rescued | lost. */
function outcomeClass(event) {
  const outcome = outcomeOf(event);
  if (outcome === 'fallback') return 'rescued';
  return outcome === 'delivered' && event.delivered !== false ? 'delivered' : 'lost';
}

function bump(map, key) { map[key] = (map[key] || 0) + 1; }

/** The counts of one link-day from its events. */
function rollupEvents(events) {
  const counts = { observed: 0, delivered: 0, rescued: 0, lost: 0, qr: 0, tap: 0, byDevice: {}, byCountry: {}, byOutcome: {}, byHourUtc: new Array(24).fill(0) };
  for (const event of events) {
    counts.observed += 1;
    counts[outcomeClass(event)] += 1;
    counts[event.metadata && event.metadata.source === 'qr' ? 'qr' : 'tap'] += 1;
    bump(counts.byDevice, (event.deviceInfo && event.deviceInfo.deviceType) || 'unknown');
    bump(counts.byCountry, (event.geo && event.geo.country) || 'unknown');
    bump(counts.byOutcome, outcomeOf(event));
    counts.byHourUtc[new Date(eventMs(event)).getUTCHours()] += 1;
  }
  return counts;
}

async function eventsOn(code, dateKey) {
  const start = dayStartMs(dateKey);
  const end = start + DAY_MS;
  const snap = await db.collection('click_events')
    .where('linkCode', '==', code)
    .where('timestampMs', '>=', start)
    .where('timestampMs', '<', end)
    .limit(EVENT_READ_CAP)
    .get();
  return snap.docs.map(d => d.data()).filter(e => { const ms = eventMs(e); return ms !== null && ms >= start && ms < end; });
}

/**
 * Roll one UTC day for every listed link that had events on it, then mark the day.
 * @param {{ dateUtc: string, nowMs?: number }} p  dateUtc as YYYY-MM-DD
 * @returns {Promise<{ date: string, complete: boolean, links: number, written: number }>}
 */
async function rollupDay({ dateUtc, nowMs = Date.now() }) {
  if (!DATE_KEY.test(String(dateUtc))) throw new Error('rollupDay needs dateUtc as YYYY-MM-DD');
  const { links } = await LinkService.listLinks({ limit: LINK_LIST_CAP });
  let written = 0;
  for (const link of links) {
    const code = link.code || link.id;
    const events = await eventsOn(code, dateUtc);
    if (!events.length) continue;
    const tenantId = link.tenantId || DEFAULT_TENANT_ID;
    await db.collection(ROLLUPS).doc(rollupId(tenantId, code, dateUtc)).set({
      tenantId, code, date: dateUtc, ...rollupEvents(events), updatedAtMs: nowMs, logicVersion: LOGIC_VERSION
    });
    written += 1;
  }
  const complete = dateUtc < utcDateKey(nowMs);
  await db.collection(ROLLUP_DAYS).doc(dateUtc).set({ date: dateUtc, complete, links: links.length, written, updatedAtMs: nowMs, logicVersion: LOGIC_VERSION });
  return { date: dateUtc, complete, links: links.length, written };
}

/** Date keys in [fromKey, toKey] whose marker says the day was rolled after it ended. */
async function completeRollupDays(fromKey, toKey) {
  const snap = await db.collection(ROLLUP_DAYS)
    .where('complete', '==', true)
    .where('date', '>=', fromKey)
    .where('date', '<=', toKey)
    .limit(ROLLUP_DAYS_READ_CAP)
    .get();
  return new Set(snap.docs.map(d => d.data().date).filter(date => date >= fromKey && date <= toKey));
}

/**
 * Every rollup of a tenant between two date keys (inclusive), keyed
 * `${code}|${date}`; null when the read hit its cap and could be incomplete.
 */
async function readTenantRollups(tenantId, fromKey, toKey) {
  const snap = await db.collection(ROLLUPS)
    .where('tenantId', '==', tenantId)
    .where('date', '>=', fromKey)
    .where('date', '<=', toKey)
    .limit(ROLLUP_READ_CAP)
    .get();
  if (snap.size >= ROLLUP_READ_CAP) return null;
  const byKey = new Map();
  for (const doc of snap.docs) {
    const rollup = doc.data();
    if (rollup.date >= fromKey && rollup.date <= toKey) byKey.set(`${rollup.code}|${rollup.date}`, rollup);
  }
  return byKey;
}

module.exports = { rollupDay, dailyRollupDates, dateKeysBefore, utcDateKey, dayStartMs, completeRollupDays, readTenantRollups };
