/**
 * Shared email rendering + queueing helpers.
 *
 * Everything the store sends (order confirmation, owner notification, payment
 * failure alert, shipping confirmation) goes through here so that ONE set of
 * escaping and idempotency rules applies to all of them.
 *
 * DELIVERY: these helpers write to the Firestore `mail` collection in the
 * document shape the `firestore-send-email` extension defined
 * ({ to, message: { subject, html, text? }, ... }). The extension is NOT
 * installed; delivery is done in-repo by the `mailSender` Firestore trigger
 * (functions/triggers/mailSender.js), which sends each new document over SMTP
 * and writes `delivery.state` back. See docs/products/STORE.md and
 * functions/api/checkout/README.md.
 * Never install the extension alongside that trigger — mail would send twice.
 *
 * POLICY COPY: renderEmail() merges the constants from ./policy.js (ship time,
 * returns link, support address) under every template's data, so the FTC
 * ship-time statement is written once and cannot drift between emails.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { policyTemplateVars } = require('./policy');

const TEMPLATE_DIR = path.join(__dirname, 'templates');
const templateCache = new Map();

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function lookup(scope, key) {
  return String(key).split('.').reduce((o, k) => (o == null ? undefined : o[k]), scope);
}

/**
 * Minimal, dependency-free template renderer.
 *   {{#each items}} ... {{/each}}   repeat block per array element
 *   {{key}}                          HTML-ESCAPED interpolation
 *   {{{key}}}                        raw interpolation (trusted markup only)
 * All customer-supplied values (product titles, sizes, emails, addresses) go
 * through {{key}} and are therefore escaped.
 */
function renderTemplate(template, data) {
  // Blocks first so their bodies are rendered against the element scope.
  const withBlocks = template.replace(
    /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, key, body) => {
      const list = lookup(data, key);
      if (!Array.isArray(list)) return '';
      return list
        .map((entry, index) =>
          renderTemplate(body, { ...data, ...entry, '@index': index, '@number': index + 1 })
        )
        .join('');
    }
  );

  return withBlocks
    .replace(/\{\{\{\s*([\w.@]+)\s*\}\}\}/g, (_m, key) => {
      const v = lookup(data, key);
      return v == null ? '' : String(v);
    })
    .replace(/\{\{\s*([\w.@]+)\s*\}\}/g, (_m, key) => escapeHtml(lookup(data, key)));
}

/** Read a template from api/email/templates, cached per process. */
function loadTemplate(name) {
  if (!templateCache.has(name)) {
    templateCache.set(name, fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8'));
  }
  return templateCache.get(name);
}

function renderEmail(templateName, data) {
  // An `undefined` caller value must not blank a policy constant (the FTC
  // ship-time line in particular); only a real value overrides one.
  const defined = Object.fromEntries(
    Object.entries(data || {}).filter(([, value]) => value !== undefined)
  );
  return renderTemplate(loadTemplate(templateName), { ...policyTemplateVars(), ...defined });
}

function formatMoney(cents, currency = 'usd') {
  const amount = (Number(cents || 0) / 100).toFixed(2);
  const symbol = String(currency).toLowerCase() === 'usd' ? '$' : '';
  return `${symbol}${amount}`;
}

/**
 * Queue a mail document under a DETERMINISTIC id, skipping the write when one
 * already exists. Every notification in the store uses this, so a webhook
 * redelivery, a double-click on "mark shipped", or a manual event replay can
 * never send the same email twice.
 *
 * @returns {Promise<boolean>} true when this call actually queued the mail.
 */
async function queueMailOnce(db, docId, payload) {
  const ref = db.collection('mail').doc(docId);
  const existing = await ref.get();
  if (existing.exists) {
    console.log(`↩️  Mail ${docId} already queued — skipping duplicate send`);
    return false;
  }
  await ref.set({
    ...payload,
    createdAt: payload.createdAt || admin.firestore.FieldValue.serverTimestamp()
  });
  return true;
}

module.exports = {
  escapeHtml,
  renderTemplate,
  loadTemplate,
  renderEmail,
  formatMoney,
  queueMailOnce
};
