/**
 * linkAnswers.js — one question at the scan.
 *
 * A link with `ask` does not send the scanner straight on: it shows the
 * question first ("Are you coming?"), records the answer, thanks them and
 * offers the destination. One answer per person per code: the record's id is
 * a hash of the client (IP + user agent + code + secret), so scanning again
 * and answering again replaces the earlier answer instead of stacking. The
 * scan itself is still a scan (redirectHandler tracks it before the page).
 *
 *   link_answers/{code}_{visitor}  { code, tenantId, choice, guests, atMs, host, expiresAt }
 *
 * Nothing personal is kept: no name, no address, no raw IP. Per-guest
 * invitations (a name behind each answer) are a campaign feature: each
 * invitee gets their own code, so the code IS the name.
 */

const crypto = require('crypto');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { getClientIp } = require('./clientIp');

const COLLECTION = 'link_answers';
const KEEP_DAYS = 400;              // the year a free code lives, plus a month
const MAX_GUESTS = 20;
const LATEST = 8;

const db = () => admin.firestore();

function escapeHtml(v = '') {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function visitorKey(req, code) {
  const secret = process.env.KORTEX_SYNC_KEY || process.env.ALUMNI_TOKEN_SECRET || 'kortex-answers';
  const ip = getClientIp(req) || '';
  const ua = req.get('user-agent') || '';
  return crypto.createHash('sha256').update(`${code}|${ip}|${ua}|${secret}`).digest('hex').slice(0, 20);
}

/* ── the page ─────────────────────────────────────────────────────────── */

const STYLE = `*{margin:0;padding:0;box-sizing:border-box}html{color-scheme:dark}body{font-family:Georgia,'Times New Roman',serif;background:linear-gradient(180deg,#060b1e 0%,#0a1233 55%,#080808 100%);color:#ede8df;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.card{width:100%;max-width:420px;padding:32px 28px;border:1px solid rgba(181,147,90,.35);background:rgba(5,7,14,.72);box-shadow:0 30px 80px rgba(0,0,0,.45)}
.k{font-style:italic;font-size:.78rem;letter-spacing:.28em;text-transform:uppercase;color:#b5935a;margin-bottom:10px}
h1{font-weight:500;font-size:1.7rem;line-height:1.2;margin-bottom:6px}.t{font-style:italic;color:rgba(237,232,223,.7);margin-bottom:22px}
.opts{display:grid;gap:10px;margin-bottom:18px}.opt{display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid rgba(181,147,90,.3);cursor:pointer;font-size:1.1rem;min-height:52px}
.opt:has(input:checked){border-color:#d9bd7b;background:rgba(181,147,90,.12)}.opt input{accent-color:#d9bd7b;width:18px;height:18px}
label.g{display:block;font-style:italic;font-size:.9rem;letter-spacing:.06em;color:#b5935a;margin-bottom:6px}.n{width:100%;padding:10px 0;background:none;border:0;border-bottom:1px solid rgba(181,147,90,.3);color:#ede8df;font-family:inherit;font-size:1.2rem;outline:none}
.btn{display:block;width:100%;margin-top:22px;padding:15px;background:#b5935a;color:#080808;border:0;font-family:inherit;font-weight:600;font-size:.9rem;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;text-align:center;text-decoration:none}
.skip{display:block;margin-top:16px;text-align:center;font-style:italic;color:rgba(237,232,223,.6);text-decoration:none}.skip:hover{color:#d9bd7b}
.foot{margin-top:24px;padding-top:12px;border-top:1px solid rgba(181,147,90,.22);font-style:italic;font-size:.78rem;color:rgba(237,232,223,.45);text-align:center}.foot a{color:#b5935a;text-decoration:none}`;

function shell(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main class="card">${body}<p class="foot">Powered by <a href="https://kaayko.com/kortex?ref=ask">Kortex</a></p></main></body></html>`;
}

/**
 * The question, as a plain HTML form (no script needed). POSTs to the same
 * slug on the same host; `go` carries the destination the answer leads to.
 */
function askPage({ code, link, destination, host }) {
  const ask = link.ask;
  const title = link.title && link.title !== code ? link.title : '';
  const opts = ask.options.map((o, i) => `<label class="opt"><input type="radio" name="choice" value="${escapeHtml(o.key)}"${i === 0 ? ' required' : ''}> ${escapeHtml(o.label)}</label>`).join('');
  const guests = ask.guests ? `<label class="g" for="guests">How many of you?</label><input class="n" id="guests" name="guests" type="number" inputmode="numeric" min="1" max="${MAX_GUESTS}" value="1">` : '';
  const skip = destination ? `<a class="skip" href="${escapeHtml(destination)}">Skip, just take me there</a>` : '';
  return shell(ask.question, `<p class="k">One question</p>${title ? `<h1>${escapeHtml(title)}</h1>` : ''}<p class="t">${escapeHtml(ask.question)}</p>
<form method="post" action="/${encodeURIComponent(code)}/answer"><div class="opts">${opts}</div>${guests}<input type="hidden" name="go" value="${escapeHtml(destination || '')}"><button class="btn" type="submit">Send</button></form>${skip}`);
}

function thanksPage({ link, choice, destination }) {
  const ask = link.ask;
  const chosen = ask.options.find(o => o.key === choice);
  const go = destination ? `<a class="btn" href="${escapeHtml(destination)}">Continue</a>` : '';
  return shell('Thank you', `<p class="k">Noted${chosen ? `: ${escapeHtml(chosen.label)}` : ''}</p><h1>${escapeHtml(ask.thanks)}</h1><p class="t">Scan the code again to change your answer.</p>${go}`);
}

/* ── the record ───────────────────────────────────────────────────────── */

/**
 * Store one answer. Returns { ok, choice, guests } or { ok:false, reason }.
 * The choice must be one of the link's options; guests is clamped.
 */
async function recordAnswer({ req, code, link, host, body = {} }) {
  const ask = link.ask;
  if (!ask) return { ok: false, reason: 'NO_QUESTION' };
  const choice = String(body.choice || '').trim().toLowerCase();
  if (!ask.options.some(o => o.key === choice)) return { ok: false, reason: 'BAD_CHOICE' };
  let guests = 1;
  if (ask.guests) {
    const n = parseInt(body.guests, 10);
    guests = Number.isFinite(n) ? Math.max(1, Math.min(MAX_GUESTS, n)) : 1;
  }
  const now = Date.now();
  const id = `${code}_${visitorKey(req, code)}`;
  const ref = db().collection(COLLECTION).doc(id);
  const before = await ref.get();
  await ref.set({
    code,
    tenantId: link.tenantId || 'kaayko-default',
    choice,
    guests,
    atMs: now,
    at: admin.firestore.Timestamp.fromMillis(now),
    firstAtMs: before.exists ? (before.data().firstAtMs || now) : now,
    changed: before.exists ? FieldValue.increment(1) : 0,
    host: host || null,
    platform: /iphone|ipad/i.test(req.get('user-agent') || '') ? 'ios' : /android/i.test(req.get('user-agent') || '') ? 'android' : 'web',
    expiresAt: admin.firestore.Timestamp.fromMillis(now + KEEP_DAYS * 86400000)
  }, { merge: true });
  return { ok: true, choice, guests, replaced: before.exists };
}

async function deleteAnswers(code) {
  const snap = await db().collection(COLLECTION).where('code', '==', code).get();
  let n = 0;
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db().batch();
    snap.docs.slice(i, i + 400).forEach(d => { batch.delete(d.ref); n++; });
    await batch.commit();
  }
  return n;
}

/* ── the tally ────────────────────────────────────────────────────────── */

/**
 * Counts per option, people (answers) and heads (guests), the latest few.
 * @returns {{question, options:[{key,label,count,guests}], answered, guests, changed, latest:[{choice,guests,atMs}]}}
 */
async function tallyAnswers(code, ask) {
  const snap = await db().collection(COLLECTION).where('code', '==', code).get();
  const rows = snap.docs.map(d => d.data()).sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
  const byKey = Object.fromEntries((ask.options || []).map(o => [o.key, { key: o.key, label: o.label, count: 0, guests: 0 }]));
  let changed = 0;
  for (const r of rows) {
    const o = byKey[r.choice]; if (!o) continue;
    o.count += 1; o.guests += Number(r.guests) || 1;
    if (r.changed) changed += 1;
  }
  return {
    question: ask.question,
    guestsAsked: ask.guests !== false,
    options: Object.values(byKey),
    answered: rows.length,
    guests: rows.reduce((s, r) => s + (Number(r.guests) || 1), 0),
    changed,
    latest: rows.slice(0, LATEST).map(r => ({ choice: r.choice, guests: Number(r.guests) || 1, atMs: r.atMs || null, platform: r.platform || null }))
  };
}

module.exports = { askPage, thanksPage, recordAnswer, deleteAnswers, tallyAnswers, COLLECTION, MAX_GUESTS };
