/**
 * arcade/arcade.js — the mini-game endpoints.
 *
 *   GET  /arcade/challenge?productId=…&game=franking|mailrun   start a 2% run
 *   POST /arcade/solve                                          replay it, mint a code
 *   POST /arcade/beg/start                                      start the cart Beggathon
 *   POST /arcade/beg/solve                                      grade the plea, mint a code
 *   GET  /arcade/reward/:code                                   check a code
 *
 * ── Reward codes ──────────────────────────────────────────────────────────────
 * Every code is written to `arcade_rewards` with the game that produced it, the
 * percentage, its scope, and both timestamps. Codes are SINGLE USE and EXPIRE ONE HOUR
 * after minting, claimed or not. The window is short on purpose: this is a discount for
 * the order you are in the middle of, not a coupon to hoard. It is stated on the winning
 * screen, in the cart, and here.
 *
 *   game reward   2%    applies to the eligible (non-premium) lines
 *   beggathon     3-10% applies to the WHOLE cart, premium included
 *
 * Nothing about winning is decided in the browser. The two games are replayed here from
 * their input traces (gameRules.js, mirrored client-side); the plea is graded here
 * (begScore.js).
 */

const express = require("express");
const crypto = require("crypto");
const admin = require("firebase-admin");

const { FRANK, FLY } = require("./gameRules");
const { gradeBeg, MAX_PERCENT, BANTER } = require("./begScore");
const { loadStanding, strike, forgive, recordAttempt, gate, MAX_SURCHARGE } = require("./penalty");

const router = express.Router();
const db = () => admin.firestore();

const PRODUCTS = "kaaykoproducts";
const CHALLENGES = "arcade_challenges";
const REWARDS = "arcade_rewards";
const BEGS = "arcade_begs";

/** Beta: magnets and bottles carry the games. Totes and t-shirts stay premium. */
const DISCOUNTABLE_TYPES = new Set(["magnet", "bottle"]);
const GAME_PERCENT = 2;
const REWARD_TTL_MS = 60 * 60 * 1000;      // one hour, claimed or not
const CHALLENGE_TTL_MIN = 20;
const MAX_ATTEMPTS = 5;
const GAMES = new Set(["franking", "mailrun"]);

const SECRET = process.env.ARCADE_SECRET || "kaayko-arcade-dev-secret";

const emailKey = (email) =>
  crypto.createHash("sha256").update(String(email || "").trim().toLowerCase() + SECRET).digest("hex").slice(0, 32);

function rewardCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no ambiguous glyphs
  const raw = crypto.randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[raw[i] % alphabet.length];
  return `KAY-${out.slice(0, 5)}-${out.slice(5)}`;
}

/** One place that mints, so every code carries the same fields and the same clock. */
async function mintReward({ percent, scope, game, productId = null, email = null, meta = null, token = null }) {
  const code = rewardCode();
  await db().collection(REWARDS).doc(code).set({
    code,
    percent,
    // The token that won it. Checkout re-reads that token's standing, so a code
    // minted before a paste strike stops being worth anything (penalty rule 3).
    token,
    scope,                                   // "eligible" | "cart"
    game,
    productId,
    emailKey: email ? emailKey(email) : null,
    meta,
    redeemed: false,
    orderId: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + REWARD_TTL_MS)
  });
  return { code, expiresInMinutes: Math.round(REWARD_TTL_MS / 60000) };
}

async function loadProduct(id) {
  const byDoc = await db().collection(PRODUCTS).doc(id).get();
  if (byDoc.exists) return { id: byDoc.id, ...byDoc.data() };
  const byField = await db().collection(PRODUCTS).where("productID", "==", id).limit(1).get();
  return byField.empty ? null : { id: byField.docs[0].id, ...byField.docs[0].data() };
}

const freshChallenge = (fields) => db().collection(CHALLENGES).add({
  ...fields,
  solved: false,
  attempts: 0,
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + CHALLENGE_TTL_MIN * 60000)
});

/** Shared guard for both solve routes. Responds and returns null when it refuses. */
async function openChallenge(res, challengeId) {
  if (!challengeId) { res.status(400).json({ success: false, code: "MISSING_CHALLENGE" }); return null; }
  const ref = db().collection(CHALLENGES).doc(String(challengeId));
  const snap = await ref.get();
  if (!snap.exists) { res.status(404).json({ success: false, code: "NO_CHALLENGE" }); return null; }
  const ch = snap.data();
  if (ch.solved) { res.status(409).json({ success: false, code: "ALREADY_SOLVED" }); return null; }
  if (ch.expiresAt && ch.expiresAt.toMillis() < Date.now()) {
    res.status(410).json({ success: false, code: "EXPIRED", message: "That run went stale. Start a new one." });
    return null;
  }
  if ((ch.attempts || 0) >= MAX_ATTEMPTS) {
    res.status(429).json({ success: false, code: "NO_ATTEMPTS", message: "Out of runs on this machine." });
    return null;
  }
  return { ref, ch };
}

/* ── GET /arcade/challenge ─────────────────────────────────────────────────── */

const tokenOf = (req) => String(req.query?.token || req.body?.token || "").trim().slice(0, 64) || null;

router.get("/challenge", async (req, res) => {
  try {
    const productId = String(req.query.productId || "").trim();
    if (!productId) return res.status(400).json({ success: false, code: "MISSING_PRODUCT" });

    const product = await loadProduct(productId);
    if (!product) return res.status(404).json({ success: false, code: "NO_PRODUCT" });

    if (!DISCOUNTABLE_TYPES.has(String(product.productType || "").toLowerCase())) {
      return res.json({
        success: true, playable: false, reason: "PREMIUM",
        message: "This one is premium. No games, no discounts, no negotiation."
      });
    }

    // Penalty rule 2: a locked token is told so before it is handed a game to play.
    const standing = await loadStanding(db(), tokenOf(req));
    const ok = gate(standing);

    const game = GAMES.has(String(req.query.game)) ? String(req.query.game) : "franking";
    const seed = crypto.randomBytes(4).readUInt32LE(0);
    const ref = await freshChallenge({ productId: product.id, productTitle: product.title || "", game, seed });

    return res.json({
      success: true, playable: true,
      locked: !ok.allowed, lockCode: ok.code || null, lockMessage: ok.message || null,
      surchargePercent: standing.surchargePercent,
      challengeId: ref.id, game, seed,
      target: game === "mailrun" ? FLY.TARGET : FRANK.TARGET,
      rewardPercent: GAME_PERCENT,
      rewardScope: "eligible",
      rewardExpiresInMinutes: Math.round(REWARD_TTL_MS / 60000),
      attemptsAllowed: MAX_ATTEMPTS
    });
  } catch (err) {
    console.error("[arcade] challenge failed:", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

/* ── POST /arcade/solve ────────────────────────────────────────────────────── */

router.post("/solve", async (req, res) => {
  try {
    const token = tokenOf(req);
    const standing = await loadStanding(db(), token);
    const ok = gate(standing);
    if (!ok.allowed) return res.status(403).json({ success: false, correct: false, code: ok.code, message: ok.message });

    const opened = await openChallenge(res, req.body?.challengeId);
    if (!opened) return;
    const { ref, ch } = opened;
    const attempts = (ch.attempts || 0) + 1;

    const verdict = ch.game === "mailrun"
      ? FLY.replay(ch.seed, req.body?.events)
      : FRANK.replay(ch.seed, req.body?.taps);

    if (!verdict.cleared) {
      await ref.update({ attempts, lastReason: verdict.reason || "SHORT" });
      return res.json({
        success: true, correct: false,
        reason: verdict.reason || "SHORT",
        progress: ch.game === "mailrun" ? verdict.passed : verdict.franked,
        target: ch.game === "mailrun" ? FLY.TARGET : FRANK.TARGET,
        attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts),
        message: "Not this time."
      });
    }

    const { code, expiresInMinutes } = await mintReward({
      percent: GAME_PERCENT, scope: "eligible", game: ch.game,
      productId: ch.productId, email: req.body?.email, token,
      meta: { seed: ch.seed, result: verdict }
    });
    await ref.update({ attempts, solved: true, rewardCode: code });
    await recordAttempt(db(), token, { won: true });

    return res.json({
      success: true, correct: true, code,
      percent: GAME_PERCENT, scope: "eligible", expiresInMinutes,
      message: `${GAME_PERCENT}% off the magnets and bottles in this order. Expires in ${expiresInMinutes} minutes.`
    });
  } catch (err) {
    console.error("[arcade] solve failed:", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

/* ── The Beggathon, at the cart ────────────────────────────────────────────── */

router.post("/beg/start", async (req, res) => {
  try {
    const standing = await loadStanding(db(), tokenOf(req));
    const ref = await freshChallenge({ game: "beg" });
    return res.json({
      success: true, challengeId: ref.id, game: "beg",
      windowMs: 60000,
      rewardPercentMax: MAX_PERCENT,
      rewardScope: "cart",
      rewardExpiresInMinutes: Math.round(REWARD_TTL_MS / 60000),
      attemptsAllowed: MAX_ATTEMPTS,
      // Penalty rule 4: a locked shopper is begging to get back to the normal price,
      // not for a discount, and the screen has to say so before they start typing.
      surchargePercent: standing.surchargePercent,
      mode: standing.locked ? "atonement" : "discount",
      message: standing.locked
        ? `You are carrying +${standing.surchargePercent}% for pasting. A good plea takes one percent off that. It will not earn you a discount.`
        : null
    });
  } catch (err) {
    console.error("[arcade] beg/start failed:", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.post("/beg/solve", async (req, res) => {
  try {
    const token = tokenOf(req);
    const standing = await loadStanding(db(), token);

    // ── Penalty rule 1. A paste is not a refusal, it is a charge. It is handled
    //    before every other check, because it is the one outcome that costs money.
    if (req.body?.pasted || req.body?.dropped) {
      const why = req.body?.pasted ? "PASTED" : "DROPPED";
      const { surchargePercent, strikes } = await strike(db(), token, why);
      await recordAttempt(db(), token, {});
      return res.json({
        success: true, correct: false, reason: why,
        penalty: { surchargePercent, strikes, max: MAX_SURCHARGE },
        message: `${BANTER[why]} That is +1% on this order, now +${surchargePercent}% in total, ` +
                 `and no game in the shop pays out until it is gone. Beg it back down, one percent at a time.`
      });
    }

    // A locked shopper may still beg — that is the only way out (rule 4) — but the
    // attempt budget still binds, which is what stops atonement being a free grader.
    const ok = gate(standing, { atoning: standing.locked });
    if (!ok.allowed) {
      return res.status(403).json({ success: false, correct: false, code: ok.code, message: ok.message });
    }

    const opened = await openChallenge(res, req.body?.challengeId);
    if (!opened) return;
    const { ref, ch } = opened;
    if (ch.game !== "beg") return res.status(400).json({ success: false, code: "WRONG_GAME" });
    const attempts = (ch.attempts || 0) + 1;

    // Originality is judged against what other people actually wrote, so the corpus is
    // read here rather than trusted from the browser (rule 8).
    const priorSnap = await db().collection(BEGS).orderBy("createdAt", "desc").limit(40).get();
    const prior = priorSnap.docs.map((d) => d.data().text || "");

    // Rule 7: this token's own last ten pleas and typing rhythms.
    const graded = gradeBeg(req.body || {}, prior, { texts: standing.texts, prints: standing.prints });

    if (!graded.ok) {
      await ref.update({ attempts, lastReason: graded.reason });
      await recordAttempt(db(), token, { text: req.body?.text });
      return res.json({
        success: true, correct: false,
        reason: graded.reason, gate: graded.gate, message: graded.message,
        surchargePercent: standing.surchargePercent,
        attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts)
      });
    }

    await db().collection(BEGS).add({
      text: String(req.body?.text || "").slice(0, 900),
      percent: standing.locked ? 0 : graded.percent,
      axes: graded.axes,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await ref.update({ attempts, solved: true });

    // ── Penalty rule 4. Locked: this buys back a percent of the surcharge and
    //    nothing more. No code is minted, because that is the whole punishment.
    if (standing.locked) {
      const { surchargePercent, cleared } = await forgive(db(), token);
      await recordAttempt(db(), token, { text: req.body?.text, print: graded.print });
      return res.json({
        success: true, correct: true, forgiven: true, percent: 0,
        surchargePercent, cleared,
        axes: graded.axes, verdict: graded.verdict,
        words: graded.words, seconds: graded.seconds,
        message: cleared
          ? "He tore up the note. You are back to the ordinary price, which is all you were asking for."
          : `He crossed off one percent. You are still carrying +${surchargePercent}%.`
      });
    }

    const { code, expiresInMinutes } = await mintReward({
      percent: graded.percent, scope: "cart", game: "beg",
      email: req.body?.email, token,
      meta: { axes: graded.axes, words: graded.words, seconds: graded.seconds }
    });
    await ref.update({ rewardCode: code });
    await recordAttempt(db(), token, { text: req.body?.text, print: graded.print, won: true });

    return res.json({
      success: true, correct: true, code,
      percent: graded.percent, scope: "cart",
      axes: graded.axes, verdict: graded.verdict,
      words: graded.words, seconds: graded.seconds,
      expiresInMinutes,
      message: `${graded.percent}% off the whole cart. Expires in ${expiresInMinutes} minutes.`
    });
  } catch (err) {
    console.error("[arcade] beg/solve failed:", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

/* ── GET /arcade/reward/:code ──────────────────────────────────────────────── */

router.get("/reward/:code", async (req, res) => {
  try {
    const snap = await db().collection(REWARDS).doc(String(req.params.code || "").toUpperCase()).get();
    if (!snap.exists) return res.status(404).json({ success: false, code: "NO_REWARD" });
    const r = snap.data();
    const expired = r.expiresAt && r.expiresAt.toMillis() < Date.now();

    // Penalty rules 2 and 3, asked here as well as at checkout. This route is what the
    // cart's Apply button calls, and it must not promise a discount that the payment
    // intent will then refuse — that would read as the shop losing the code.
    let locked = false, voided = false;
    const owner = r.token || tokenOf(req);
    if (owner) {
      const standing = await loadStanding(db(), owner);
      locked = standing.locked;
      const minted = r.createdAt && typeof r.createdAt.toMillis === "function" ? r.createdAt.toMillis() : 0;
      voided = !!(standing.voidedAt && minted && standing.voidedAt > minted);
    }

    return res.json({
      success: true,
      valid: !r.redeemed && !expired && !locked && !voided,
      locked, voided,
      surchargeNote: locked ? "A paste penalty is on this browser. Nothing pays out until it is gone." : null,
      percent: r.percent,
      scope: r.scope || "eligible",
      game: r.game || null,
      redeemed: !!r.redeemed,
      expired: !!expired,
      minutesLeft: expired || !r.expiresAt ? 0 : Math.max(0, Math.round((r.expiresAt.toMillis() - Date.now()) / 60000))
    });
  } catch (err) {
    console.error("[arcade] reward lookup failed:", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

module.exports = router;
module.exports.DISCOUNTABLE_TYPES = DISCOUNTABLE_TYPES;
module.exports.REWARDS = REWARDS;
module.exports.emailKey = emailKey;
module.exports.REWARD_PERCENT = GAME_PERCENT;
module.exports.REWARD_TTL_MS = REWARD_TTL_MS;
module.exports.CHALLENGES = CHALLENGES;
