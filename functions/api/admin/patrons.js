/**
 * admin/patrons.js — the owner's own list of people, and what they pay.
 *
 *   GET    /api/admin/patrons            list
 *   GET    /api/admin/patrons/:email     one (email is hashed to find the record)
 *   PUT    /api/admin/patrons/:email     create or update
 *   DELETE /api/admin/patrons/:email     remove
 *
 * All of it sits behind the ordinary admin login. A patron record is the only way a
 * premium product is ever discounted, so this endpoint is the whole trust boundary:
 * nothing here is reachable from the storefront.
 *
 * Records are keyed by a hash of the email, not the email itself. The owner types a
 * real address; what is stored is a counter-style record with a label they choose.
 */

const express = require("express");
const admin = require("firebase-admin");
const { requireAuth, requireAdmin } = require("../../middleware/authMiddleware");
const { emailKey } = require("../arcade/arcade");
const { PATRONS } = require("../arcade/rewards");

const router = express.Router();
const db = () => admin.firestore();

router.use(requireAuth, requireAdmin);

const clampPercent = (v) => Math.max(0, Math.min(Number(v) || 0, 100));

/** { "kaayko_bottle_tiger": 12.5 } — dollars, per unit. Anything unparseable is dropped. */
function cleanFixedPrices(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [productID, value] of Object.entries(raw)) {
    const dollars = Number(value);
    if (!productID || !Number.isFinite(dollars) || dollars < 0) continue;
    out[String(productID)] = Math.round(dollars * 100) / 100;
  }
  return out;
}

router.get("/", async (_req, res) => {
  try {
    const snap = await db().collection(PATRONS).get();
    const patrons = snap.docs.map((d) => ({ key: d.id, ...d.data() }));
    return res.json({ success: true, count: patrons.length, patrons });
  } catch (err) {
    console.error("[patrons] list failed:", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.get("/:email", async (req, res) => {
  try {
    const snap = await db().collection(PATRONS).doc(emailKey(req.params.email)).get();
    if (!snap.exists) return res.status(404).json({ success: false, code: "NO_PATRON" });
    return res.json({ success: true, patron: { key: snap.id, ...snap.data() } });
  } catch (err) {
    console.error("[patrons] get failed:", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.put("/:email", async (req, res) => {
  try {
    const email = String(req.params.email || "").trim();
    if (!email.includes("@")) return res.status(400).json({ success: false, code: "BAD_EMAIL" });

    const { label, percent, fixedPrices, note, active } = req.body || {};
    const record = {
      label: String(label || "").slice(0, 80) || null,
      percent: clampPercent(percent),
      fixedPrices: cleanFixedPrices(fixedPrices),
      note: String(note || "").slice(0, 400) || null,
      active: active !== false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user?.email || req.user?.uid || "admin"
    };
    if (!record.percent && !Object.keys(record.fixedPrices).length) {
      return res.status(400).json({ success: false, code: "NO_BENEFIT", message: "Set a percent or at least one fixed price." });
    }

    const ref = db().collection(PATRONS).doc(emailKey(email));
    const existed = (await ref.get()).exists;
    if (!existed) record.createdAt = admin.firestore.FieldValue.serverTimestamp();
    await ref.set(record, { merge: true });

    return res.json({ success: true, created: !existed, key: ref.id, patron: record });
  } catch (err) {
    console.error("[patrons] put failed:", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.delete("/:email", async (req, res) => {
  try {
    await db().collection(PATRONS).doc(emailKey(req.params.email)).delete();
    return res.json({ success: true });
  } catch (err) {
    console.error("[patrons] delete failed:", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

module.exports = router;
