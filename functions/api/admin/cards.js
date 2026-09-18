/**
 * Kaayko property cards — the copy on the business cards, editable.
 *
 * WHY THIS EXISTS
 * ---------------
 * The five cards were pre-rendered SVG files with the words welded into them,
 * produced by a script on a laptop. Changing "Store" to "Shop" meant finding
 * that laptop. The words now live here, and both the web card page and the
 * print sheet render from these documents, so the printed card and the one on
 * the site can no longer disagree.
 *
 * WHAT IS NOT EDITABLE, AND WHY
 * -----------------------------
 * `slug` is the document id and the art filename and the anchor other pages
 * link to; renaming it would orphan an asset and break a link, so it is set at
 * seed time and refused here. `art` is a closed set: the files that actually
 * exist under /assets/cards/art. Everything else about a card is words, and
 * words are the point of this router.
 *
 * The QR is NOT stored. It is generated from `url` wherever the card is drawn,
 * so a corrected link can never leave a stale QR pointing at the old one.
 */

const admin = require('firebase-admin');

const COLLECTION = 'kaaykocards';
const SETTINGS = 'kaaykosettings';
const BRAND_DOC = 'cards';

// The art files that exist. A card may only point at one of these.
const ART = Object.freeze(['kaayko', 'paddlingout', 'forge', 'kortex', 'alumni']);

const LIMITS = Object.freeze({
  NAME: 24,        // 86px serif in a 593-unit column
  HOOK: 58,        // two lines at 26 characters, plus a little slack
  HOST: 40,
  URL: 300,
  TAGLINE: 72,     // 11px letterspaced across 1018 units
  PROPERTIES: 80,
  CONTACT: 60,
  LABEL: 16,
  LINE: 64,        // one sentence under the name on the back
  FACT: 22,        // 17px letterspaced, three across a 874-unit row
  FACTS: 3         // three, in the same three places on every card
});

/* ── validators ───────────────────────────────────────────────
   Each returns {ok:true, value} or {ok:false, message}. Nothing coerces
   silently: a value that would overflow the card is an error the admin can
   see and fix, not a default that quietly prints something else.
   ───────────────────────────────────────────────────────────── */

const str = (max, { min = 1 } = {}) => (raw) => {
  if (typeof raw !== 'string') return { ok: false, message: 'must be text' };
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length < min) return { ok: false, message: 'cannot be empty' };
  if (value.length > max) return { ok: false, message: `must be ${max} characters or fewer (that is ${value.length})` };
  return { ok: true, value };
};

const optionalStr = (max) => (raw) => {
  if (raw === '' || raw === null || raw === undefined) return { ok: true, value: '' };
  return str(max, { min: 1 })(raw);
};

const url = (raw) => {
  const base = str(LIMITS.URL)(raw);
  if (!base.ok) return base;
  let parsed;
  try { parsed = new URL(base.value); } catch (_) { return { ok: false, message: 'must be a full URL, including https://' }; }
  if (parsed.protocol !== 'https:') return { ok: false, message: 'must be https — the QR is printed and cannot be corrected later' };
  return { ok: true, value: parsed.toString() };
};

const hex = (raw) => {
  if (typeof raw !== 'string') return { ok: false, message: 'must be text' };
  const value = raw.trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(value)) return { ok: false, message: 'must be a hex colour like #8A5A2B' };
  return { ok: true, value };
};

const artName = (raw) => {
  if (typeof raw !== 'string') return { ok: false, message: 'must be text' };
  const value = raw.trim().toLowerCase();
  if (!ART.includes(value)) return { ok: false, message: `must be one of: ${ART.join(', ')}` };
  return { ok: true, value };
};

const order = (raw) => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 99) return { ok: false, message: 'must be a whole number from 1 to 99' };
  return { ok: true, value };
};

const bool = (raw) => (typeof raw === 'boolean'
  ? { ok: true, value: raw }
  : { ok: false, message: 'must be true or false' });

/* The three facts along the bottom of the back. Exactly three, because the row
   is a fixed three-cell grid and the series only reads as a set when every card
   fills the same three places. Each is short enough to stay on one line at
   17px with 4px of letterspacing. */
const facts = (raw) => {
  if (!Array.isArray(raw)) return { ok: false, message: 'must be a list of three short facts' };
  if (raw.length !== LIMITS.FACTS) return { ok: false, message: `must be exactly ${LIMITS.FACTS} facts` };
  const out = [];
  for (const item of raw) {
    if (typeof item !== 'string') return { ok: false, message: 'each fact must be text' };
    const value = item.trim().replace(/\s+/g, ' ');
    if (!value) return { ok: false, message: 'a fact cannot be blank' };
    if (value.length > LIMITS.FACT) return { ok: false, message: `each fact is at most ${LIMITS.FACT} characters` };
    out.push(value);
  }
  return { ok: true, value: out };
};

const EDITABLE = Object.freeze({
  name: str(LIMITS.NAME),
  hook: str(LIMITS.HOOK),
  host: optionalStr(LIMITS.HOST),
  url,
  accent: hex,
  art: artName,
  n: order,
  live: bool,
  line: str(LIMITS.LINE),
  facts
});

const BRAND_EDITABLE = Object.freeze({
  label: str(LIMITS.LABEL),
  tagline: optionalStr(LIMITS.TAGLINE),
  properties: optionalStr(LIMITS.PROPERTIES),
  contact: optionalStr(LIMITS.CONTACT)
});

// Named so the UI can say why, rather than dropping the key on the floor.
const REFUSED = Object.freeze({
  slug: 'the slug is the document id, the art filename and the link anchor — it is set once',
  id: 'the slug is the document id, the art filename and the link anchor — it is set once',
  qr: 'the QR is generated from the URL every time the card is drawn, never stored'
});

const db = () => admin.firestore();

/** A build stamp so the browser cannot serve yesterday's copy from cache. */
const stampOf = (docs) => String(docs.reduce(
  (max, d) => Math.max(max, d.updateTime ? d.updateTime.toMillis() : 0), 0) || Date.now());

function shape(doc) {
  const d = doc.data() || {};
  return {
    slug: doc.id,
    n: d.n ?? 99,
    name: d.name ?? '',
    hook: d.hook ?? '',
    host: d.host ?? '',
    url: d.url ?? '',
    accent: d.accent ?? '#8A5A2B',
    art: d.art ?? doc.id,
    // The back of a card advertises itself: one sentence and three checkable
    // facts. Without these the back falls back to the hook and an empty row.
    line: d.line ?? '',
    facts: Array.isArray(d.facts) ? d.facts.slice(0, LIMITS.FACTS) : [],
    live: d.live !== false,
    updatedAt: d.updatedAt ? d.updatedAt.toMillis?.() ?? d.updatedAt : null
  };
}

async function readBrand() {
  const snap = await db().collection(SETTINGS).doc(BRAND_DOC).get();
  const d = snap.exists ? snap.data() : {};
  return {
    label: d.label ?? 'KAAYKO',
    tagline: d.tagline ?? '',
    properties: d.properties ?? '',
    contact: d.contact ?? ''
  };
}

/** GET /cards — public. Live cards only, in order. */
async function publicCards(_req, res) {
  try {
    const snap = await db().collection(COLLECTION).get();
    const cards = snap.docs.map(shape).filter((c) => c.live).sort((a, b) => a.n - b.n);
    const brand = await readBrand();
    res.set('Cache-Control', 'public, max-age=60, must-revalidate');
    res.json({ v: stampOf(snap.docs), brand, cards });
  } catch (err) {
    console.error('publicCards', err);
    res.status(500).json({ error: 'Could not load the cards.' });
  }
}

/** GET /admin/cards — every card, hidden ones included, plus the brand block. */
async function listCards(_req, res) {
  try {
    const snap = await db().collection(COLLECTION).get();
    const cards = snap.docs.map(shape).sort((a, b) => a.n - b.n);
    res.json({ v: stampOf(snap.docs), brand: await readBrand(), cards, art: ART, limits: LIMITS });
  } catch (err) {
    console.error('listCards', err);
    res.status(500).json({ error: 'Could not load the cards.' });
  }
}

/** PATCH /admin/cards/:slug — whitelisted partial update. */
async function updateCard(req, res) {
  const slug = String(req.params.slug || '').trim();
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return res.status(400).json({ error: 'Unknown card.' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const keys = Object.keys(body);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to change.' });

  const update = {};
  const problems = {};
  for (const key of keys) {
    if (REFUSED[key]) { problems[key] = REFUSED[key]; continue; }
    const check = EDITABLE[key];
    if (!check) { problems[key] = 'is not a field on a card'; continue; }
    const result = check(body[key]);
    if (!result.ok) problems[key] = result.message;
    else update[key] = result.value;
  }
  if (Object.keys(problems).length) return res.status(400).json({ error: 'Some fields were refused.', problems });

  try {
    const ref = db().collection(COLLECTION).doc(slug);
    const before = await ref.get();
    if (!before.exists) return res.status(404).json({ error: 'Unknown card.' });

    update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await ref.update(update);
    const after = await ref.get();
    res.json({ card: shape(after) });
  } catch (err) {
    console.error('updateCard', err);
    res.status(500).json({ error: 'Could not save the card.' });
  }
}

/** PATCH /admin/cards — the shared block printed on the back of every card. */
async function updateBrand(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const keys = Object.keys(body);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to change.' });

  const update = {};
  const problems = {};
  for (const key of keys) {
    const check = BRAND_EDITABLE[key];
    if (!check) { problems[key] = 'is not a field on the card back'; continue; }
    const result = check(body[key]);
    if (!result.ok) problems[key] = result.message;
    else update[key] = result.value;
  }
  if (Object.keys(problems).length) return res.status(400).json({ error: 'Some fields were refused.', problems });

  try {
    update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await db().collection(SETTINGS).doc(BRAND_DOC).set(update, { merge: true });
    res.json({ brand: await readBrand() });
  } catch (err) {
    console.error('updateBrand', err);
    res.status(500).json({ error: 'Could not save the card back.' });
  }
}

module.exports = { publicCards, listCards, updateCard, updateBrand, EDITABLE, BRAND_EDITABLE, REFUSED, ART, LIMITS, COLLECTION, SETTINGS, BRAND_DOC };
