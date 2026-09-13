/**
 * orderNumber.js — the number a customer can say out loud.
 *
 * `KAAY-1042`: a prefix and a counter, allocated once per paid order inside a
 * Firestore transaction on `counters/orders`, so two webhooks cannot mint the
 * same one. Stripe's `pi_…` id stays on the server; it never again appears on a
 * receipt, a policy page or a status screen.
 *
 * Alongside the number the webhook mints a status token — 32 random bytes,
 * base64url — which is the only credential the tokenised order page accepts.
 * It is stored on `payment_intents/{pi}` (a collection no client can read) and
 * travels to the customer inside the receipt link. Anyone holding the link can
 * see the order; nobody can guess one.
 */
const admin = require('firebase-admin');
const crypto = require('crypto');

const PREFIX = 'KAAY';
const FIRST = 1001;
const COUNTER_PATH = ['counters', 'orders'];
const ORDER_NUMBER_RE = /^KAAY-\d{4,8}$/;
const STATUS_HOST = 'https://kaay.store';

/** Next number in sequence, transactionally. Never reuses, never skips on success. */
async function allocateOrderNumber(db = admin.firestore()) {
  const ref = db.collection(COUNTER_PATH[0]).doc(COUNTER_PATH[1]);
  const n = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const next = data && Number.isInteger(data.next) && data.next >= FIRST ? data.next : FIRST;
    tx.set(ref, { next: next + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
  return `${PREFIX}-${n}`;
}

function isOrderNumber(value) {
  return ORDER_NUMBER_RE.test(String(value || ''));
}

/** Upper-cases and trims what a person typed; returns null if it is not a number at all. */
function normalizeOrderNumber(value) {
  const v = String(value || '').trim().toUpperCase();
  return isOrderNumber(v) ? v : null;
}

function newStatusToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Constant-time compare that never throws on length mismatch. */
function tokensMatch(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length === 0 || x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function statusPath(orderNumber, token) {
  return `/order/${encodeURIComponent(orderNumber)}?t=${encodeURIComponent(token)}`;
}

function statusUrl(orderNumber, token) {
  return `${STATUS_HOST}${statusPath(orderNumber, token)}`;
}

module.exports = {
  allocateOrderNumber,
  isOrderNumber,
  normalizeOrderNumber,
  newStatusToken,
  tokensMatch,
  statusPath,
  statusUrl,
  PREFIX,
  FIRST
};
