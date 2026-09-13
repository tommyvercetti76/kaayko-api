/**
 * arcade/penalty.js — the price of cheating, and the ten rules that interlock to hold it.
 *
 * Everything here hangs off one client token, kept in the browser's own storage. Clearing
 * it is "refreshing the cookie" and it is the only way out of a lockout — which is the
 * point: the punishment is meant to be shakeable, but only by somebody who has understood
 * that they were caught.
 *
 * THE TEN RULES. They are numbered because they only work together; each one plugs a leak
 * the one before it opens.
 *
 *   1  PASTE STRIKE      Pasting into the Beggathon locks every discount in the shop for
 *                        this browser. It NEVER raises the price: the +1%-a-strike
 *                        surcharge was removed on 13 Sep 2026 as a consumer-law exposure.
 *                        The `surchargePercent` field is kept as the count of accepted
 *                        pleas still owed before the lock lifts (max 5).
 *   2  TOTAL LOCKOUT     While locked, NO game mints a code — not the Beggathon, not the
 *                        two machines. Otherwise a paster just goes and plays Mail Run.
 *   3  VOID ON STRIKE    A strike voids any code already won and not yet spent, so the
 *                        order of operations (win, then paste) buys nothing.
 *   4  THE WAY BACK      A clean, accepted plea while locked burns 1% off the surcharge
 *                        and grants NO discount. At zero the lock lifts. You beg your way
 *                        back to the normal price; you do not beg your way to a discount.
 *   5  ONE WIN AN HOUR   One reward per token per hour, across all three games, so a
 *                        winning run cannot simply be repeated.
 *   6  ATTEMPT BUDGET    Twelve graded attempts per token per hour, across all games.
 *                        Refusals cost an attempt; that is what makes brute force expensive.
 *   7  NO SELF REPEAT    The last ten pleas from this token are remembered. Re-sending one,
 *                        or re-sending the same typing rhythm, is refused (see begScore).
 *   8  NO ECHO           Pleas are checked against everybody else's recent ones, so the
 *                        winning text cannot be passed around.
 *   9  NEVER A CHARGE    computeSurcharge() answers zero, always. A strike costs the
 *                        shopper their discounts, never money above the list price.
 *  10  TOKEN ROTATION IS NOT AN ESCAPE  A fresh token clears the lock, as promised, but the
 *                        monthly order cap is keyed to the EMAIL, so rotating storage buys
 *                        a clean slate on discounts and no extra orders at all.
 */

const admin = require("firebase-admin");

const PENALTIES = "arcade_penalties";

const MAX_SURCHARGE = 5;              // rule 1: +1% a strike, five strikes deep
const WIN_COOLDOWN_MS = 60 * 60 * 1000;   // rule 5
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000; // rule 6
const MAX_ATTEMPTS_PER_WINDOW = 12;       // rule 6
const HISTORY_KEPT = 10;                  // rule 7: the last ten pleas and rhythms
const ATTEMPTS_KEPT = 40;                 // rule 6: must exceed the budget, or it never binds

const ref = (db, token) => db.collection(PENALTIES).doc(String(token).slice(0, 64));

const clean = () => ({
  surchargePercent: 0, strikes: 0, locked: false,
  wins: [], attempts: [], texts: [], prints: []
});

/** Read a token's standing. A token nobody has seen is clean, not suspicious. */
async function loadStanding(db, token) {
  if (!token) return { ...clean(), token: null };
  const snap = await ref(db, token).get();
  if (!snap.exists) return { ...clean(), token };
  const d = snap.data() || {};
  const now = Date.now();
  const at = (x) => (x && typeof x.toMillis === "function" ? x.toMillis() : Number(x) || 0);
  return {
    token,
    surchargePercent: Math.max(0, Math.min(MAX_SURCHARGE, Number(d.surchargePercent) || 0)),
    strikes: Number(d.strikes) || 0,
    locked: (Number(d.surchargePercent) || 0) > 0,
    wins: (d.wins || []).map(at).filter((t) => now - t < WIN_COOLDOWN_MS),
    attempts: (d.attempts || []).map(at).filter((t) => now - t < ATTEMPT_WINDOW_MS),
    texts: d.texts || [],
    prints: d.prints || [],
    voidedAt: at(d.voidedAt)
  };
}

/**
 * Rule 1 and rule 3. A paste costs a percent and voids anything already won.
 * @returns {Promise<{surchargePercent:number, strikes:number}>}
 */
async function strike(db, token, reason = "PASTED") {
  if (!token) return { surchargePercent: 0, strikes: 0 };
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const r = ref(db, token);
    const snap = await tx.get(r);
    const d = snap.exists ? snap.data() : {};
    const surchargePercent = Math.min(MAX_SURCHARGE, (Number(d.surchargePercent) || 0) + 1);
    const strikes = (Number(d.strikes) || 0) + 1;
    tx.set(r, {
      surchargePercent, strikes, lastReason: reason,
      // Rule 3: everything won before this moment stops counting.
      voidedAt: admin.firestore.Timestamp.fromMillis(now),
      lastStrikeAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { surchargePercent, strikes };
  });
}

/**
 * Rule 4. A clean plea while locked buys back one percent, and nothing else.
 * @returns {Promise<{surchargePercent:number, cleared:boolean}>}
 */
async function forgive(db, token) {
  if (!token) return { surchargePercent: 0, cleared: true };
  return db.runTransaction(async (tx) => {
    const r = ref(db, token);
    const snap = await tx.get(r);
    const d = snap.exists ? snap.data() : {};
    const surchargePercent = Math.max(0, (Number(d.surchargePercent) || 0) - 1);
    tx.set(r, { surchargePercent, lastReason: "FORGIVEN" }, { merge: true });
    return { surchargePercent, cleared: surchargePercent === 0 };
  });
}

/** Rules 5 and 6, plus rule 7's memory. Called once per graded attempt. */
async function recordAttempt(db, token, { text, print, won } = {}) {
  if (!token) return;
  const now = admin.firestore.Timestamp.now();
  const r = ref(db, token);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(r);
    const d = snap.exists ? snap.data() : {};
    const keep = (arr, v, n = HISTORY_KEPT) => [...(arr || []), v].slice(-n);
    const patch = {
      // Kept deeper than the budget itself. Trimmed to ten, the list could never hold
      // twelve entries and the attempt cap silently never fired.
      attempts: keep(d.attempts, now, ATTEMPTS_KEPT),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (text) patch.texts = keep(d.texts, String(text).slice(0, 900));
    if (print) patch.prints = keep(d.prints, print);
    if (won) patch.wins = keep(d.wins, now);
    tx.set(r, patch, { merge: true });
  });
}

/**
 * The one question every route asks before it hands anything out.
 * @returns {{allowed:boolean, code?:string, message?:string}}
 */
function gate(standing, opts = {}) {
  // Rule 6 first, and it binds even while locked. Atonement is a way out, not an
  // unlimited one — without this a locked token could hammer the grader for ever.
  if (standing.attempts.length >= MAX_ATTEMPTS_PER_WINDOW) {
    return {
      allowed: false, code: "NO_ATTEMPTS",
      message: "Twelve tries in an hour. He has gone inside. Come back later."
    };
  }
  // Rule 4: a locked shopper is allowed to keep begging, because that is the only
  // route back to the ordinary price. Everything else they are locked out of.
  if (opts.atoning) return { allowed: true };

  // Rule 2: a lockout stops every game, not just the one that caused it.
  if (standing.locked) {
    return {
      allowed: false, code: "LOCKED",
      message: `You are carrying a +${standing.surchargePercent}% surcharge for pasting. ` +
               `No game pays out until that is gone. Beg it off, one percent at a time.`
    };
  }
  // Rule 5: one payout an hour, whichever game produced it.
  if (standing.wins.length > 0) {
    const mins = Math.max(1, Math.ceil((WIN_COOLDOWN_MS - (Date.now() - Math.max(...standing.wins))) / 60000));
    return {
      allowed: false, code: "COOLDOWN",
      message: `You already won something this hour. Another in ${mins} minute${mins === 1 ? "" : "s"}.`
    };
  }
  return { allowed: true };
}

module.exports = {
  loadStanding, strike, forgive, recordAttempt, gate,
  PENALTIES, MAX_SURCHARGE, MAX_ATTEMPTS_PER_WINDOW, WIN_COOLDOWN_MS
};
