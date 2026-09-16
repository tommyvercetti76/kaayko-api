/**
 * Optional link fields that feed the insights: a placement (where the QR
 * lives), the economics of a print run, and a campaign window. All pure,
 * all validated here and nowhere else.
 *
 * Placement is a controlled key plus an optional owner-entered label. The key
 * is what analytics group by; the label is only ever shown (escaped by the
 * client) and is refused when it looks like an email, a phone number or a URL.
 * Storage on the link: `placement: <key>`, `placementLabel: <label|null>`.
 *
 * @module api/kortex/linkFields
 */

'use strict';

function validationError(message) { const e = new Error(message); e.code = 'VALIDATION_ERROR'; return e; }

/** Controlled placements in display order. */
const PLACEMENTS = Object.freeze([
  { key: 'poster', name: 'Poster' },
  { key: 'flyer', name: 'Flyer' },
  { key: 'menu', name: 'Menu' },
  { key: 'table_tent', name: 'Table tent' },
  { key: 'packaging', name: 'Packaging' },
  { key: 'badge', name: 'Badge' },
  { key: 'business_card', name: 'Business card' },
  { key: 'window', name: 'Storefront window' },
  { key: 'screen', name: 'Screen' },
  { key: 'vehicle', name: 'Vehicle' },
  { key: 'other', name: 'Other' }
]);

const OTHER = 'other';
const LABEL_MAX = 40;

/** Legacy free text that maps onto a controlled key. */
const SYNONYMS = {
  'storefront': 'window', 'shop window': 'window', 'store window': 'window', 'storefront window': 'window', 'storefront / window': 'window',
  'tent': 'table_tent', 'card': 'business_card', 'visiting card': 'business_card',
  'display': 'screen', 'tv': 'screen', 'digital screen': 'screen', 'kiosk': 'screen',
  'car': 'vehicle', 'van': 'vehicle', 'truck': 'vehicle', 'bike': 'vehicle',
  'box': 'packaging', 'bag': 'packaging', 'label': 'packaging',
  'leaflet': 'flyer', 'handout': 'flyer', 'lanyard': 'badge', 'name tag': 'badge', 'sign': 'poster', 'banner': 'poster'
};

const LOOKS_LIKE_EMAIL = /\S+@\S+\.\S+/;
const LOOKS_LIKE_PHONE = /(?:\+?\d[\d\s().-]{6,}\d)/;
const LOOKS_LIKE_URL = /(?:https?:|\/\/|www\.|\S\.(?:[a-z]{2,})(?:\/|\?|#|$))/i;

function placementByKey(key) { return PLACEMENTS.find(p => p.key === key) || null; }

/** Lowercase, one space between words, no separators: the form every match uses. */
function foldText(text) { return String(text).toLowerCase().replace(/[\s_-]+/g, ' ').trim(); }

/** Resolve free text to a controlled key, or null when it is not a known name. */
function keyForText(text) {
  const folded = foldText(text);
  if (!folded) return null;
  const known = PLACEMENTS.find(p => foldText(p.key) === folded || foldText(p.name) === folded);
  if (known) return known.key;
  return SYNONYMS[folded] || null;
}

/** Plain text a person typed: control characters become spaces, angle brackets go, whitespace collapses, length is capped. */
function cleanLabel(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw validationError('Placement label must be text');
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
  if (!text) return null;
  if (LOOKS_LIKE_EMAIL.test(text) || LOOKS_LIKE_PHONE.test(text) || LOOKS_LIKE_URL.test(text)) {
    throw validationError('A placement label cannot be an email address, a phone number or a web address');
  }
  return text;
}

/** Text becomes a key when it names a placement, otherwise `other` labelled with the text. */
function placementFromText(text) {
  const key = keyForText(text);
  if (key) return { key, label: null };
  const label = cleanLabel(text);
  return label ? { key: OTHER, label } : null;
}

function placementFromObject(input) {
  const key = input.key === null || input.key === undefined ? null : keyForText(input.key);
  if (input.key !== null && input.key !== undefined && !key) throw validationError('Unknown placement');
  const label = cleanLabel(input.label);
  if (!key) return label ? { key: OTHER, label } : null;
  return { key, label };
}

/**
 * Accepts a key ("table_tent"), a display name ("Table tent"), `{ key, label }`,
 * or legacy free text (synonyms map onto keys; anything else becomes `other`
 * with the text as its label). Returns `{ key, label }` or null to clear.
 */
function normalizePlacement(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string') return placementFromText(input);
  if (typeof input === 'object' && !Array.isArray(input)) return placementFromObject(input);
  throw validationError('Placement must be text or { key, label }');
}

/** The controlled key a link groups under, tolerating legacy free-text values. Null when unplaced. */
function placementKey(link) {
  const stored = link && link.placement;
  if (!stored) return null;
  if (typeof stored === 'object') return placementByKey(stored.key) ? stored.key : null;
  return keyForText(stored) || OTHER;
}

/** What a person sees for a link's placement: the owner's label, else the controlled name. Null when unplaced. */
function placementDisplay(link) {
  const key = placementKey(link);
  if (!key) return null;
  const stored = link.placement;
  const label = (link.placementLabel && String(link.placementLabel)) || (typeof stored === 'object' ? stored.label : null);
  if (label) return label;
  if (key === OTHER && typeof stored === 'string' && !keyForText(stored)) return String(stored).trim().slice(0, LABEL_MAX);
  return placementByKey(key).name;
}

/** { printCost, valuePerVisit, currency } — non-negative numbers; null clears. */
function normalizeEconomics(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw validationError('Economics must be an object');
  const num = (v, name) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) throw validationError(`${name} must be a number of zero or more`);
    return Math.round(n * 100) / 100;
  };
  const printCost = num(input.printCost, 'Print cost');
  const valuePerVisit = num(input.valuePerVisit, 'Value per visit');
  let currency = String(input.currency || 'USD').trim().toUpperCase().slice(0, 3);
  if (!/^[A-Z]{3}$/.test(currency)) currency = 'USD';
  if (printCost === null && valuePerVisit === null) return null;
  return { printCost, valuePerVisit, currency };
}

/** { startAt, endAt } ISO dates, start before end; null clears. */
function normalizeCampaignWindow(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw validationError('Campaign window must be an object');
  const parse = (v, name) => {
    if (v === undefined || v === null || v === '') return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw validationError(`${name} must be a date`);
    return d.toISOString();
  };
  const startAt = parse(input.startAt, 'Campaign start');
  const endAt = parse(input.endAt, 'Campaign end');
  if (!startAt && !endAt) return null;
  if (startAt && endAt && new Date(startAt) >= new Date(endAt)) throw validationError('Campaign start must be before its end');
  return { startAt, endAt };
}

/* ── ask: one question at the scan ──────────────────────────────────────────
   A code may ask the person who scanned it one question before it sends them
   on: "Are you coming?" with Yes / Maybe / No, and optionally how many they
   are bringing. Stored on the link as
     ask: { question, options: [{ key, label }], guests, thanks }
   or null. Two to four options; keys are slugs of the labels and must be
   distinct. Free workspaces get one question per code; per-guest invitations
   are a campaign feature on paid plans (each invitee their own code, so an
   answer is a name, not a count). */
const ASK_QUESTION_MAX = 120;
const ASK_OPTION_MAX = 24;
const ASK_THANKS_MAX = 160;
const ASK_DEFAULT = Object.freeze({
  question: 'Are you coming?',
  options: Object.freeze([{ key: 'yes', label: 'Yes' }, { key: 'maybe', label: 'Maybe' }, { key: 'no', label: 'No' }]),
  guests: true,
  thanks: 'Thank you. See you there.'
});

function askError(detail) {
  const err = new Error(detail);
  err.code = 'INVALID_ASK';
  err.status = 400;
  return err;
}

const slugOf = (label) => String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

function normalizeAsk(input) {
  if (input === undefined || input === null || input === false) return null;
  if (input === true) return { ...ASK_DEFAULT, options: ASK_DEFAULT.options.map(o => ({ ...o })) };
  if (typeof input !== 'object' || Array.isArray(input)) throw askError('The question must be an object, true, or null.');
  const question = String(input.question ?? ASK_DEFAULT.question).trim().replace(/\s+/g, ' ');
  if (!question) throw askError('The question cannot be empty.');
  if (question.length > ASK_QUESTION_MAX) throw askError(`The question must be ${ASK_QUESTION_MAX} characters or fewer.`);
  const raw = Array.isArray(input.options) && input.options.length ? input.options : ASK_DEFAULT.options;
  const options = raw.map((o) => {
    const label = String(typeof o === 'object' && o ? (o.label ?? o.key ?? '') : o).trim().replace(/\s+/g, ' ');
    if (!label) throw askError('Every answer needs a label.');
    if (label.length > ASK_OPTION_MAX) throw askError(`Answers must be ${ASK_OPTION_MAX} characters or fewer.`);
    const key = slugOf(label) || 'option';
    return { key, label };
  });
  if (options.length < 2 || options.length > 4) throw askError('Give two to four answers.');
  if (new Set(options.map(o => o.key)).size !== options.length) throw askError('Answers must be different from each other.');
  const thanks = String(input.thanks ?? ASK_DEFAULT.thanks).trim().replace(/\s+/g, ' ').slice(0, ASK_THANKS_MAX) || ASK_DEFAULT.thanks;
  return { question, options, guests: input.guests !== false, thanks };
}

module.exports = { PLACEMENTS, normalizePlacement, placementKey, placementDisplay, normalizeEconomics, normalizeCampaignWindow, normalizeAsk, ASK_DEFAULT };
