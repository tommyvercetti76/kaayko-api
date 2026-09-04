/**
 * Mail sender — the in-repo replacement for the `firestore-send-email` extension.
 *
 * Every email the store sends is a document in the Firestore `mail` collection,
 * written by queueMailOnce() in api/email/render.js in the exact shape the
 * extension expects ({ to, message: { subject, html, text? }, ... }). The
 * extension is NOT installed and is not wanted; this trigger does the delivery
 * instead and writes the same `delivery` fields back onto the document
 * (state / attempts / error / startTime / endTime / info), so the two are
 * interchangeable — but NEVER BOTH: if the extension is ever installed
 * alongside this trigger, every email is sent twice. One or the other.
 *
 * Configuration (see docs/STRIPE_EMAIL_SETUP_GUIDE.md):
 *   MAIL_SMTP_URL  Secret Manager, ONE value: a full smtps:// URL, e.g.
 *                  smtps://user%40gmail.com:app-password@smtp.gmail.com:465
 *                  (the @ in the username MUST be written %40). Set it with
 *                  `firebase functions:secrets:set MAIL_SMTP_URL`. Firebase
 *                  delivers secrets with a trailing newline — trimmed here.
 *   MAIL_FROM      env (functions/.env), optional. Default: the owner address
 *                  from api/email/notifyAddress.js. Gmail rewrites From to the
 *                  authenticated account unless it is a verified "Send mail as"
 *                  alias, so leave this unset when sending through Gmail.
 *   Reply-To defaults to the owner address so customer replies land in the
 *   inbox that is actually read.
 *
 * Delivery guarantees:
 *   • Firestore triggers are at-least-once. Before sending, the document is
 *     CLAIMED in a transaction: delivery.state → PROCESSING only when there is
 *     no state yet (or the previous attempt ended in RETRY, or a PROCESSING
 *     lease from a crashed invocation has expired). A duplicate invocation
 *     finds the claim and exits — it cannot double-send.
 *   • Transient SMTP failures (connection, timeout, 4xx) leave state RETRY with
 *     the attempt count; the 4th failure marks ERROR. Permanent failures (5xx,
 *     bad credentials, a document with no recipient) mark ERROR at once.
 *     Nothing re-drives RETRY documents automatically yet — deliverMailDocument()
 *     is exported so a scheduled job can, and it accepts { force: true } to
 *     re-run an ERROR document by hand.
 *   • A missing MAIL_SMTP_URL marks the document ERROR with a clear reason and
 *     logs loudly. The trigger handler never throws.
 *
 * This module is its own Cloud Function (us-central1, 256MiB). It must never
 * import the Express app or anything that drags the API's dependencies in.
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { resolveNotifyEmail } = require('../api/email/notifyAddress');

const SECRET_NAME = 'MAIL_SMTP_URL';
const MAX_ATTEMPTS = 4;
// A PROCESSING claim older than this belongs to an invocation that died
// mid-send (functions time out long before it); the document may be re-claimed.
const LEASE_MS = 10 * 60 * 1000;

class PermanentMailError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentMailError';
    this.permanent = true;
  }
}

// ─── Transport ─────────────────────────────────────────────────

let transportCache = { url: null, transport: null };

function getTransport(smtpUrl) {
  if (transportCache.url !== smtpUrl) {
    transportCache = { url: smtpUrl, transport: nodemailer.createTransport(smtpUrl) };
  }
  return transportCache.transport;
}

/**
 * Read and sanity-check the SMTP URL so a typo fails fast on the first
 * document instead of after four connection timeouts.
 * @returns {{url?: string, error?: string}}
 */
function readSmtpUrl(env = process.env) {
  const raw = env[SECRET_NAME];
  const url = typeof raw === 'string' ? raw.trim() : '';
  if (!url) {
    return {
      error: `${SECRET_NAME} secret is not set — mail cannot be delivered. ` +
             `Run: firebase functions:secrets:set ${SECRET_NAME} (see docs/STRIPE_EMAIL_SETUP_GUIDE.md)`
    };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: `${SECRET_NAME} is not a valid URL (expected smtps://user%40host:password@smtp.host:465)` };
  }
  if (!['smtp:', 'smtps:'].includes(parsed.protocol) || !parsed.hostname) {
    return { error: `${SECRET_NAME} must be an smtp:// or smtps:// URL with a host (got "${parsed.protocol}//${parsed.hostname}")` };
  }
  return { url };
}

// ─── Helpers ───────────────────────────────────────────────────

function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function timestampAt(ms) {
  return admin.firestore.Timestamp.fromMillis(ms);
}

function normalizeAddresses(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Turn a `mail` document into a nodemailer message.
 * Throws PermanentMailError for a document that can never be sent.
 */
function buildMessage(doc, { from, replyTo }) {
  const to = normalizeAddresses(doc.to);
  const cc = normalizeAddresses(doc.cc);
  const bcc = normalizeAddresses(doc.bcc);
  if (!to.length && !cc.length && !bcc.length) {
    throw new PermanentMailError('Mail document has no recipient (to/cc/bcc)');
  }

  const message = doc.message && typeof doc.message === 'object' ? doc.message : {};
  const subject = typeof message.subject === 'string' ? message.subject : '';
  const html = typeof message.html === 'string' ? message.html : undefined;
  const text = typeof message.text === 'string' ? message.text : undefined;
  if (!subject && !html && !text) {
    throw new PermanentMailError('Mail document has no message.subject, message.html or message.text');
  }

  const out = { from: nonEmptyString(doc.from) || from, to, subject };
  if (html !== undefined) out.html = html;
  if (text !== undefined) out.text = text;
  const rt = nonEmptyString(doc.replyTo) || replyTo;
  if (rt) out.replyTo = rt;
  if (cc.length) out.cc = cc;
  if (bcc.length) out.bcc = bcc;
  if (doc.headers && typeof doc.headers === 'object') out.headers = doc.headers;
  return out;
}

/** Retrying cannot help: bad credentials, an SMTP 5xx, or a document we cannot send. */
function isPermanentSmtpError(err) {
  if (!err) return false;
  if (err.permanent === true || err instanceof PermanentMailError) return true;
  if (err.code === 'EAUTH') return true;
  const rc = Number(err.responseCode);
  return rc >= 500 && rc < 600;
}

function describeError(err) {
  const parts = [err?.code, err?.responseCode, err?.message].filter(Boolean);
  return parts.join(' ') || 'Unknown error';
}

// ─── Delivery ──────────────────────────────────────────────────

/**
 * Deliver one `mail/{docId}` document. Safe to call more than once for the
 * same document: only an unclaimed (or RETRY / expired-lease) document is sent.
 *
 * @param {string} docId
 * @param {object} [options]
 * @param {boolean} [options.force]  re-run a document already in ERROR
 * @param {number}  [options.now]    epoch ms (tests)
 * @param {object}  [options.env]    environment (tests)
 * @returns {Promise<object>} outcome summary; never throws after the claim.
 */
async function deliverMailDocument(docId, { force = false, now = Date.now(), env = process.env } = {}) {
  const db = admin.firestore();
  const ref = db.collection('mail').doc(docId);

  // 1. Claim the document, transactionally, so a duplicate invocation cannot
  //    send it a second time.
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { skip: 'missing' };

    const doc = snap.data() || {};
    const delivery = doc.delivery && typeof doc.delivery === 'object' ? doc.delivery : {};
    const state = delivery.state || null;
    const leaseExpired = state === 'PROCESSING' && (toMillis(delivery.leaseExpireTime) ?? 0) < now;
    const claimable = !state || state === 'RETRY' || leaseExpired || (force && state === 'ERROR');
    if (!claimable) return { skip: state };

    const attempts = (Number(delivery.attempts) || 0) + 1;
    const next = {
      ...delivery,
      state: 'PROCESSING',
      attempts,
      startTime: delivery.startTime || timestampAt(now),
      leaseExpireTime: timestampAt(now + LEASE_MS),
      error: null
    };
    tx.update(ref, { delivery: next });
    return { doc, delivery: next, attempts };
  });

  if (claim.skip) {
    console.log(`[mailSender] ${docId}: skipped (state=${claim.skip})`);
    return { docId, sent: false, skipped: true, reason: claim.skip };
  }

  const { doc, delivery, attempts } = claim;
  const finish = (patch) => ref.update({
    delivery: { ...delivery, ...patch, leaseExpireTime: null, endTime: timestampAt(Date.now()) }
  });

  // 2. Configuration. A missing secret is an ERROR on the document, said loudly.
  const smtp = readSmtpUrl(env);
  if (smtp.error) {
    console.error(`[mailSender] ❌ ${docId}: ${smtp.error}`);
    await finish({ state: 'ERROR', error: smtp.error });
    return { docId, sent: false, state: 'ERROR', attempts, error: smtp.error };
  }

  // 3. Build and send.
  try {
    const owner = resolveNotifyEmail();
    const message = buildMessage(doc, {
      from: nonEmptyString(env.MAIL_FROM) || owner,
      replyTo: owner
    });
    const info = await getTransport(smtp.url).sendMail(message);
    const summary = {
      messageId: info?.messageId || null,
      accepted: Array.isArray(info?.accepted) ? info.accepted : [],
      rejected: Array.isArray(info?.rejected) ? info.rejected : [],
      pending: Array.isArray(info?.pending) ? info.pending : [],
      response: info?.response || null
    };
    await finish({ state: 'SUCCESS', error: null, info: summary });
    console.log(`[mailSender] ✅ ${docId}: sent to ${message.to.join(', ')} (attempt ${attempts})`);
    return { docId, sent: true, state: 'SUCCESS', attempts, info: summary };
  } catch (err) {
    const permanent = isPermanentSmtpError(err);
    const exhausted = attempts >= MAX_ATTEMPTS;
    const state = permanent || exhausted ? 'ERROR' : 'RETRY';
    const error = describeError(err);
    console.error(
      `[mailSender] ${state === 'ERROR' ? '❌' : '⚠️'} ${docId}: attempt ${attempts}/${MAX_ATTEMPTS} failed ` +
      `(${permanent ? 'permanent' : exhausted ? 'attempts exhausted' : 'transient, will retry'}): ${error}`
    );
    await finish({ state, error });
    return { docId, sent: false, state, attempts, error, permanent };
  }
}

// ─── Trigger ───────────────────────────────────────────────────

const mailSender = onDocumentCreated({
  document: 'mail/{docId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
  secrets: [SECRET_NAME]
}, async (event) => {
  const docId = event?.params?.docId || event?.data?.id;
  if (!docId) {
    console.error('[mailSender] ❌ Firestore event carried no document id', event?.id);
    return;
  }
  try {
    return await deliverMailDocument(docId);
  } catch (err) {
    // Only reachable when Firestore itself fails (claim or write-back). Say so
    // loudly; the document is untouched or still leased, so a re-drive can
    // pick it up.
    console.error(`[mailSender] ❌ ${docId}: could not record delivery — ${err.message}`, err);
  }
});

module.exports = {
  mailSender,
  deliverMailDocument,
  buildMessage,
  readSmtpUrl,
  isPermanentSmtpError,
  PermanentMailError,
  SECRET_NAME,
  MAX_ATTEMPTS,
  LEASE_MS
};
