/**
 * Monthly data-retention pass for the Kaayko Store.
 *
 * THE PATTERN: keep the transaction, drop the person.
 * ----------------------------------------------------
 * Sales-tax and accounting record-keeping runs longer than the privacy policy's
 * two-year promise, so order documents are never deleted here. Instead, once a
 * record is older than RETENTION_PII_DAYS the fields that identify a human are
 * removed and the money / tax / product / status fields stay exactly as they
 * were. The result is still a complete financial record; it just no longer
 * says who bought it.
 *
 * WHAT ONE RUN DOES
 *   1. orders + payment_intents older than RETENTION_PII_DAYS (default 730):
 *      customerEmail / customerPhone / customerName → null,
 *      shippingAddress → {redacted: true, redactedAt},
 *      plus piiRedacted / piiRedactedAt / piiRedactedFields as the audit marker.
 *   2. mail older than MAIL_RETENTION_DAYS (default 90): DELETED — each one is
 *      a rendered email that repeats the shopper's name and address.
 *   3. stripe_events + webhook_failures older than 400 days: DELETED — they are
 *      duplicate-suppression / triage records, not the order itself.
 *   4. A summary with counts is written to retention_runs/{YYYY-MM-DD}.
 *
 * SAFETY PROPERTIES
 *   - Idempotent: a document carrying piiRedacted:true is skipped, so a second
 *     run (or an overlapping one) redacts nothing twice and never moves the
 *     original redactedAt.
 *   - Chunked: at most CHUNK_SIZE (400) writes per Firestore batch, each chunk
 *     committed on its own, so a crash mid-run loses nothing already committed.
 *   - Resumable: the next run simply continues — nothing depends on this run
 *     having finished. A deadline stops a long run cleanly and records
 *     complete:false in the summary.
 *   - Double-checked ages: every document's own timestamp is re-checked in
 *     memory before it is touched, so a wrong query can never widen the blast
 *     radius. Documents without a usable timestamp are left alone.
 *   - Deletion is only possible for the collections in DELETABLE_COLLECTIONS.
 *     There is no code path that deletes an `orders` or `payment_intents`
 *     document.
 *
 * Wire it up in functions/index.js with:
 *   exports.orderRetention = require('./scheduled/orderRetention').orderRetention;
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULTS = Object.freeze({
  RETENTION_PII_DAYS: 730,
  MAIL_RETENTION_DAYS: 90,
  EVENT_RETENTION_DAYS: 400
});

// Floors protect against a mistyped env value ("RETENTION_PII_DAYS=0") wiping
// the contact details off live, unshipped orders.
const MIN_PII_DAYS = 30;
const MIN_MAIL_DAYS = 7;

/** Writes per Firestore batch (hard limit is 500). Also the query page size. */
const CHUNK_SIZE = 400;

/** How long a scheduled run may work before stopping cleanly (function timeout is 540s). */
const DEFAULT_DEADLINE_MS = 8 * 60 * 1000;

/** Absolute cap on pages per collection per run — a loop guard, not a policy. */
const MAX_PAGES = 5000;

/** Scalar fields that identify a person; set to null. */
const PII_SCALAR_FIELDS = Object.freeze(['customerEmail', 'customerPhone', 'customerName']);
/** Object fields that identify a person; replaced by the redaction marker. */
const PII_OBJECT_FIELDS = Object.freeze(['shippingAddress']);
const PII_FIELDS = Object.freeze([...PII_SCALAR_FIELDS, ...PII_OBJECT_FIELDS]);

const REDACT_COLLECTIONS = Object.freeze([
  { name: 'orders', field: 'createdAt' },
  { name: 'payment_intents', field: 'createdAt' }
]);

const DELETE_COLLECTIONS = Object.freeze([
  { name: 'mail', field: 'createdAt', window: 'mail' },
  { name: 'stripe_events', field: 'processedAt', window: 'events' },
  { name: 'webhook_failures', field: 'createdAt', window: 'events' }
]);

/** The ONLY collections this module may delete from. */
const DELETABLE_COLLECTIONS = new Set(DELETE_COLLECTIONS.map(c => c.name));

// ─── Config ──────────────────────────────────────────────────────────────────

function readDays(env, key, fallback, min) {
  const raw = env[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < min) {
    console.warn(`[retention] ${key}=${JSON.stringify(raw)} is not an integer >= ${min}; using default ${fallback}`);
    return fallback;
  }
  return n;
}

function resolveConfig(env = process.env) {
  return {
    piiDays: readDays(env, 'RETENTION_PII_DAYS', DEFAULTS.RETENTION_PII_DAYS, MIN_PII_DAYS),
    mailDays: readDays(env, 'MAIL_RETENTION_DAYS', DEFAULTS.MAIL_RETENTION_DAYS, MIN_MAIL_DAYS),
    eventDays: DEFAULTS.EVENT_RETENTION_DAYS
  };
}

// ─── Time helpers ────────────────────────────────────────────────────────────

/**
 * Milliseconds for any timestamp shape that has been written to these
 * collections over time: Firestore Timestamp, Date, ISO string, epoch number,
 * or a raw {seconds|_seconds} object. null when it cannot be read.
 */
function toMillis(value) {
  if (value === null || value === undefined) return null;
  if (typeof value.toMillis === 'function') {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'object') {
    const seconds = Number.isFinite(value.seconds) ? value.seconds
      : Number.isFinite(value._seconds) ? value._seconds : null;
    if (seconds !== null) return seconds * 1000;
  }
  return null;
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Cutoff values to query with. Documents written by this codebase carry
 * Firestore Timestamps; the December-2025 order schema stored ISO strings.
 * Firestore never matches a string against a Timestamp bound, so both
 * variants are queried. ISO-8601 strings order lexicographically, which makes
 * the string comparison correct.
 */
function cutoffVariants(cutoffMs) {
  return [
    { kind: 'timestamp', value: admin.firestore.Timestamp.fromMillis(cutoffMs) },
    { kind: 'iso', value: new Date(cutoffMs).toISOString() }
  ];
}

// ─── Redaction (pure) ────────────────────────────────────────────────────────

/**
 * Decide what to change on one document. Returns null when there is nothing
 * to do — either it was redacted on an earlier run or it never held PII.
 *
 * @param {object} data       Document data.
 * @param {string} redactedAt ISO timestamp for the marker.
 * @returns {object|null} update() payload
 */
function planRedaction(data, redactedAt) {
  if (!data || typeof data !== 'object') return null;
  if (data.piiRedacted === true) return null;

  const update = {};
  const fields = [];

  for (const field of PII_SCALAR_FIELDS) {
    if (data[field] !== undefined && data[field] !== null && data[field] !== '') {
      update[field] = null;
      fields.push(field);
    }
  }
  for (const field of PII_OBJECT_FIELDS) {
    const value = data[field];
    if (value && typeof value === 'object' && value.redacted !== true) {
      update[field] = { redacted: true, redactedAt };
      fields.push(field);
    }
  }

  if (fields.length === 0) return null;

  update.piiRedacted = true;
  update.piiRedactedAt = redactedAt;
  update.piiRedactedFields = fields;
  return update;
}

// ─── Paging ──────────────────────────────────────────────────────────────────

function emptyStats() {
  return { scanned: 0, redacted: 0, deleted: 0, alreadyRedacted: 0, nothingToRedact: 0, skippedTooYoung: 0, skippedUndated: 0, pages: 0, commits: 0 };
}

/**
 * Redact PII in one collection. Cursor-paged so already-redacted documents
 * (which stay in the result set) are walked past, never re-fetched.
 */
async function redactCollection(db, { name, field }, cutoffMs, ctx) {
  const stats = emptyStats();
  const redactedAt = new Date(ctx.nowMs).toISOString();
  // Ids seen this run. The two cutoff variants are disjoint in Firestore, but
  // a backend that ignores range filters (the test double) would hand the same
  // documents back twice and double every count.
  const seen = new Set();

  for (const cutoff of cutoffVariants(cutoffMs)) {
    let cursor = null;
    let lastId = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      if (ctx.pastDeadline()) { ctx.stoppedEarly = true; return stats; }

      let query = db.collection(name)
        .where(field, '<', cutoff.value)
        .orderBy(field, 'asc')
        .limit(ctx.chunkSize);
      if (cursor) query = query.startAfter(cursor);

      const snap = await query.get();
      if (snap.empty) break;
      stats.pages++;

      const batch = db.batch();
      let writes = 0;

      for (const doc of snap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        stats.scanned++;
        const data = doc.data() || {};
        const ageMs = toMillis(data[field]);
        if (ageMs === null) { stats.skippedUndated++; continue; }
        if (ageMs >= cutoffMs) { stats.skippedTooYoung++; continue; }

        const update = planRedaction(data, redactedAt);
        if (!update) {
          if (data.piiRedacted === true) stats.alreadyRedacted++;
          else stats.nothingToRedact++;
          continue;
        }
        batch.update(doc.ref, update);
        writes++;
      }

      if (writes > 0) {
        await batch.commit();
        stats.commits++;
        stats.redacted += writes;
      }

      const last = snap.docs[snap.docs.length - 1];
      // A cursor that does not move means the backend ignored startAfter
      // (in-memory doubles do); stop rather than spin on the same page.
      if (last.id === lastId) break;
      lastId = last.id;
      cursor = last;
      if (snap.size < ctx.chunkSize) break;
    }
  }

  return stats;
}

/**
 * Delete expired documents from one of the DELETABLE_COLLECTIONS. Re-queries
 * from the start after each chunk: deleted documents leave the result set, so
 * no cursor is needed and a partial run needs no bookkeeping.
 */
async function deleteCollection(db, { name, field }, cutoffMs, ctx) {
  if (!DELETABLE_COLLECTIONS.has(name)) {
    throw new Error(`[retention] refusing to delete from "${name}" — only ${[...DELETABLE_COLLECTIONS].join(', ')} may be deleted`);
  }
  const stats = emptyStats();
  const seen = new Set();

  for (const cutoff of cutoffVariants(cutoffMs)) {
    for (let page = 0; page < MAX_PAGES; page++) {
      if (ctx.pastDeadline()) { ctx.stoppedEarly = true; return stats; }

      const snap = await db.collection(name)
        .where(field, '<', cutoff.value)
        .orderBy(field, 'asc')
        .limit(ctx.chunkSize)
        .get();
      if (snap.empty) break;
      stats.pages++;

      const batch = db.batch();
      let writes = 0;
      for (const doc of snap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        stats.scanned++;
        const ageMs = toMillis((doc.data() || {})[field]);
        if (ageMs === null) { stats.skippedUndated++; continue; }
        if (ageMs >= cutoffMs) { stats.skippedTooYoung++; continue; }
        batch.delete(doc.ref);
        writes++;
      }

      // Nothing expired on this page: everything the query returned failed the
      // in-memory check, so re-querying would return the same page forever.
      if (writes === 0) break;

      await batch.commit();
      stats.commits++;
      stats.deleted += writes;
      if (snap.size < ctx.chunkSize) break;
    }
  }

  return stats;
}

// ─── One full pass ───────────────────────────────────────────────────────────

/**
 * Run one retention pass and write retention_runs/{date}.
 *
 * @param {{now?: number, db?: object, chunkSize?: number, deadlineMs?: number, env?: object}} [opts]
 * @returns {Promise<object>} the summary that was written
 */
async function runRetentionOnce(opts = {}) {
  const nowMs = Number.isFinite(opts.now) ? opts.now : Date.now();
  const db = opts.db || admin.firestore();
  const chunkSize = Math.max(1, Math.min(Number(opts.chunkSize) || CHUNK_SIZE, 500));
  const deadlineMs = Number.isFinite(opts.deadlineMs) ? opts.deadlineMs : DEFAULT_DEADLINE_MS;
  const config = resolveConfig(opts.env || process.env);

  const startedWall = Date.now();
  const deadlineAt = startedWall + deadlineMs;
  const ctx = {
    nowMs,
    chunkSize,
    stoppedEarly: false,
    pastDeadline: () => Date.now() >= deadlineAt
  };

  const cutoffs = {
    pii: nowMs - config.piiDays * DAY_MS,
    mail: nowMs - config.mailDays * DAY_MS,
    events: nowMs - config.eventDays * DAY_MS
  };

  const summary = {
    runId: new Date(nowMs).toISOString(),
    date: isoDate(nowMs),
    startedAt: new Date(startedWall).toISOString(),
    finishedAt: null,
    durationMs: null,
    complete: false,
    stoppedEarly: false,
    config: { ...config, chunkSize, deadlineMs },
    cutoffs: {
      pii: new Date(cutoffs.pii).toISOString(),
      mail: new Date(cutoffs.mail).toISOString(),
      events: new Date(cutoffs.events).toISOString()
    },
    collections: {},
    errors: []
  };

  for (const target of REDACT_COLLECTIONS) {
    try {
      summary.collections[target.name] = await redactCollection(db, target, cutoffs.pii, ctx);
    } catch (err) {
      console.error(`[retention] ${target.name}: ${err.message}`);
      summary.errors.push({ collection: target.name, message: String(err.message || err) });
    }
  }

  for (const target of DELETE_COLLECTIONS) {
    try {
      summary.collections[target.name] = await deleteCollection(db, target, cutoffs[target.window], ctx);
    } catch (err) {
      console.error(`[retention] ${target.name}: ${err.message}`);
      summary.errors.push({ collection: target.name, message: String(err.message || err) });
    }
  }

  summary.stoppedEarly = ctx.stoppedEarly;
  summary.complete = summary.errors.length === 0 && !ctx.stoppedEarly;
  summary.finishedAt = new Date().toISOString();
  summary.durationMs = Date.now() - startedWall;

  await db.collection('retention_runs').doc(summary.date).set(summary);

  const c = summary.collections;
  console.log(
    `[retention] ${summary.date}: orders redacted=${c.orders?.redacted ?? '-'} payment_intents redacted=${c.payment_intents?.redacted ?? '-'} ` +
    `mail deleted=${c.mail?.deleted ?? '-'} stripe_events deleted=${c.stripe_events?.deleted ?? '-'} webhook_failures deleted=${c.webhook_failures?.deleted ?? '-'} ` +
    `complete=${summary.complete}${ctx.stoppedEarly ? ' (deadline)' : ''}${summary.errors.length ? ` errors=${summary.errors.length}` : ''}`
  );

  return summary;
}

// ─── Scheduled entry point ───────────────────────────────────────────────────

// 04:10 UTC on the 1st of every month. Off the hour so it never lines up with
// the other nightly jobs, and a fixed UTC time so the cutoff maths are the same
// whatever the owner's timezone.
const orderRetention = onSchedule({
  schedule: '10 4 1 * *',
  timeZone: 'UTC',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 540
}, async () => {
  const summary = await runRetentionOnce();
  if (summary.errors.length > 0) {
    // Surface it as a failed execution so it shows up in the Functions console
    // rather than only inside a Firestore document nobody opens.
    throw new Error(`orderRetention finished with ${summary.errors.length} error(s): ${summary.errors.map(e => `${e.collection}: ${e.message}`).join('; ')}`);
  }
});

module.exports = {
  orderRetention,
  runRetentionOnce,
  planRedaction,
  toMillis,
  resolveConfig,
  DEFAULTS,
  CHUNK_SIZE,
  PII_FIELDS,
  DELETABLE_COLLECTIONS
};
