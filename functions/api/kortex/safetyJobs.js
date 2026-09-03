/**
 * Scheduled safety work.
 *
 *   syncThreatFeeds()   — pulls the free URLhaus and OpenPhish feeds, writes one
 *                         de-duplicated host list to Cloud Storage. The runtime
 *                         check (destinationSafety.js) loads that file into memory,
 *                         so a feed refresh never costs a Firestore read per link.
 *
 *   rescanActiveLinks() — walks live links in creation order with a rolling
 *                         cursor stored in `kortex_safety_meta/rescan`, re-runs
 *                         the block checks (private host, blocklist, Safe Browsing)
 *                         and switches a link to `blocked` when a destination has
 *                         turned bad since it was created. Re-scans never hold.
 *
 * Both are exported for the scheduler in functions/index.js and for the
 * super-admin trigger routes in smartLinks.js.
 *
 * @module api/kortex/safetyJobs
 */

'use strict';

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const safety = require('./destinationSafety');
const { recordAudit } = require('./auditLog');
const { LINK_STATUS } = require('./safetyPages');

const db = admin.firestore();

const FEEDS = [
  {
    name: 'urlhaus',
    url: 'https://urlhaus.abuse.ch/downloads/hostfile/',
    // hosts-file format: "127.0.0.1<TAB>malicious.example"
    parse(text) {
      const hosts = new Set();
      for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(/\s+/);
        const host = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase();
        if (host && host !== 'localhost') hosts.add(host);
      }
      return hosts;
    }
  },
  {
    name: 'openphish',
    url: 'https://openphish.com/feed.txt',
    // one URL per line
    parse(text) {
      const hosts = new Set();
      for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        try {
          hosts.add(new URL(line).hostname.toLowerCase());
        } catch (_) { /* skip malformed */ }
      }
      return hosts;
    }
  }
];

const FEED_TIMEOUT_MS = 30 * 1000;
const RESCAN_META_DOC = 'kortex_safety_meta/rescan';
const FEED_META_DOC = 'kortex_safety_meta/feeds';

async function fetchText(url, fetchImpl) {
  const doFetch = fetchImpl || global.fetch;
  const response = await doFetch(url, {
    headers: { 'User-Agent': 'Kortex-SafetySync/1.0 (+https://kaayko.com/kortex)' },
    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(FEED_TIMEOUT_MS) : undefined
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/**
 * Download every feed and publish the merged host list to Storage.
 * A feed that fails is skipped; the file is still written from the feeds that
 * succeeded so one upstream outage never empties the list.
 */
async function syncThreatFeeds({ fetchImpl } = {}) {
  const summary = { feeds: {}, totalHosts: 0, path: safety.FEED_OBJECT_PATH, syncedAt: new Date().toISOString() };
  const merged = new Set();
  let succeeded = 0;

  for (const feed of FEEDS) {
    try {
      const text = await fetchText(feed.url, fetchImpl);
      const hosts = feed.parse(text);
      hosts.forEach(h => merged.add(h));
      summary.feeds[feed.name] = { ok: true, hosts: hosts.size };
      succeeded++;
    } catch (error) {
      console.error(`[SafetySync] ${feed.name} failed:`, error.message);
      summary.feeds[feed.name] = { ok: false, error: error.message };
    }
  }

  if (succeeded === 0) {
    summary.written = false;
    await db.doc(FEED_META_DOC).set({ ...summary, updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    return summary;
  }

  const header = `# Kortex blocked hosts — generated ${summary.syncedAt} from ${Object.keys(summary.feeds).filter(k => summary.feeds[k].ok).join(', ')}\n`;
  const body = [...merged].sort().join('\n') + '\n';
  const file = admin.storage().bucket().file(safety.FEED_OBJECT_PATH);
  await file.save(header + body, { contentType: 'text/plain', resumable: false, metadata: { cacheControl: 'no-cache' } });

  summary.totalHosts = merged.size;
  summary.written = true;
  safety.resetCaches();
  await db.doc(FEED_META_DOC).set({ ...summary, updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
  return summary;
}

function linkDestinationUrls(link) {
  const urls = [];
  for (const value of Object.values(link.destinations || {})) {
    if (!value) continue;
    if (Array.isArray(value)) value.forEach(v => { const u = typeof v === 'string' ? v : v?.url; if (u) urls.push(u); });
    else urls.push(value);
  }
  return urls;
}

/**
 * Re-check a page of live links. Returns counts and the links it blocked.
 * @param {Object} options
 * @param {number} [options.limit=300]
 * @param {string|null} [options.tenantId] - restrict to one tenant (manual trigger)
 * @param {Function} [options.fetchImpl]
 */
async function rescanActiveLinks({ limit = 300, tenantId = null, fetchImpl } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 300, 500));
  const metaRef = db.doc(RESCAN_META_DOC);
  const metaSnap = await metaRef.get();
  const meta = metaSnap.exists ? metaSnap.data() : {};

  let query = db.collection('short_links').where('enabled', '==', true);
  if (tenantId) query = query.where('tenantId', '==', tenantId);

  let snapshot;
  try {
    let ordered = query.orderBy('createdAt', 'desc');
    if (!tenantId && meta.cursorCreatedAt) ordered = ordered.startAfter(meta.cursorCreatedAt);
    snapshot = await ordered.limit(safeLimit).get();
  } catch (error) {
    // Missing index: fall back to an unordered page so the job still runs.
    console.warn('[SafetyRescan] ordered query failed, using unordered page:', error.message);
    snapshot = await query.limit(safeLimit).get();
  }

  const links = snapshot.docs
    .map(doc => ({ id: doc.id, ref: doc.ref, ...doc.data() }))
    .filter(link => link.status !== LINK_STATUS.BLOCKED);

  // One Safe Browsing call for the whole page.
  const allUrls = [];
  links.forEach(link => allUrls.push(...linkDestinationUrls(link)));
  const safeBrowsingResults = await safety.checkSafeBrowsing(allUrls, { fetchImpl });

  const result = { scanned: 0, blocked: [], errors: 0, exhausted: snapshot.size < safeLimit, scannedAt: new Date().toISOString() };

  for (const link of links) {
    try {
      const assessment = await safety.assessDestinations(link.destinations || {}, {
        tenantId: link.tenantId,
        tenant: null,
        actorIsSuperAdmin: false,
        purpose: 'rescan',
        safeBrowsingResults,
        fetchImpl
      });
      result.scanned++;
      const record = safety.buildSafetyRecord(assessment, { purpose: 'rescan', actor: 'system:rescan' });
      const update = { safety: record, updatedAt: FieldValue.serverTimestamp() };

      if (assessment.verdict === safety.VERDICT.BLOCK) {
        update.status = LINK_STATUS.BLOCKED;
        update.blockedAt = FieldValue.serverTimestamp();
        update.blockedReason = record.reasons.map(r => r.code).join(',');
        await link.ref.update(update);
        result.blocked.push({ code: link.id, tenantId: link.tenantId || null, reasons: record.reasons });

        await Promise.all([
          db.collection('security_alerts').add({
            type: 'destination_blocked',
            severity: 'high',
            code: link.id,
            tenantId: link.tenantId || null,
            reasons: record.reasons,
            timestamp: FieldValue.serverTimestamp()
          }).catch(() => {}),
          recordAudit({
            actor: { name: 'rescan' },
            action: 'link.blocked',
            code: link.id,
            tenantId: link.tenantId || null,
            before: { status: link.status || LINK_STATUS.ACTIVE },
            after: { status: LINK_STATUS.BLOCKED, safety: record },
            reason: 'Destination flagged during scheduled re-scan'
          })
        ]);
      } else {
        await link.ref.update(update);
      }
    } catch (error) {
      result.errors++;
      console.error(`[SafetyRescan] ${link.id} failed:`, error.message);
    }
  }

  // Advance the rolling cursor; wrap to the start once the collection is exhausted.
  if (!tenantId) {
    const last = snapshot.docs[snapshot.docs.length - 1];
    await metaRef.set({
      cursorCreatedAt: result.exhausted || !last ? null : (last.data().createdAt || null),
      lastRunAt: FieldValue.serverTimestamp(),
      lastRun: { scanned: result.scanned, blocked: result.blocked.length, errors: result.errors, exhausted: result.exhausted }
    }, { merge: true }).catch(() => {});
  }

  return result;
}

module.exports = { FEEDS, syncThreatFeeds, rescanActiveLinks, RESCAN_META_DOC, FEED_META_DOC };
