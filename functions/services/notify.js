/**
 * notify() — the one way Kaayko sends email.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 6 Sep 2026 this platform had THREE mail stacks and had never sent a single
 * email:
 *
 *   1. queueMailOnce -> Firestore `mail` -> mailSender (SMTP). Correct design,
 *      used only by the store — and `mailSender` was never deployed.
 *   2. services/emailNotificationService.js -> SendGrid. Used by alumni, kortex,
 *      paddling and kreator. @sendgrid/mail is not installed and no key is set,
 *      so it fell through to console.log and returned `{success: true}`. Every
 *      caller believed the mail had gone out.
 *   3. services/emailDelivery.js -> SendGrid REST -> a second `pending_emails`
 *      queue that nothing drains.
 *
 * Fragmentation is why nobody noticed. One product's mail being broken is a bug;
 * four products each believing their own private stack works is a system that
 * cannot be observed.
 *
 * THE CONTRACT
 * ------------
 * Everything goes into ONE queue (`mail`) under a DETERMINISTIC id, delivered by
 * ONE sender (triggers/mailSender.js), observable through ONE health endpoint
 * (api/admin/mailHealth.js) and retried by ONE job (scheduled/mailRedrive.js).
 *
 * This function NEVER reports success for a message it did not queue. That is
 * the single most important property here: the previous stack's silent
 * `{success:true}` is what hid the outage.
 *
 * Adding email to a new product is: pick a `product` tag, pick a `kind`, pass a
 * stable `dedupeKey`. No new transport, no new queue, no new secret.
 */

'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');
const { renderEmail, queueMailOnce } = require('../api/email/render');
const { resolveNotifyEmail } = require('../api/email/notifyAddress');

/** Products allowed to send. A closed set so a typo'd tag is caught, not filed. */
const PRODUCTS = Object.freeze(['store', 'paddling', 'alumni', 'kreator', 'kortex', 'contact', 'system']);

const MAX_SUBJECT = 200;

function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.trim().length <= 254;
}

/** Accepts one address or a list; returns the valid ones. */
function normaliseTo(to) {
  const list = Array.isArray(to) ? to : [to];
  return list.map((a) => (typeof a === 'string' ? a.trim() : '')).filter(isEmail);
}

/**
 * A stable id when the caller has no natural one.
 *
 * Content hash plus a UTC-day bucket: an accidental double-fire within the same
 * day collapses to one send, while a deliberate resend tomorrow still goes out.
 * Callers with a real key (a payment intent id, an application id) should always
 * pass `dedupeKey` instead — that is what makes a webhook replay safe.
 */
function derivedKey(product, kind, to, subject, day) {
  const hash = crypto.createHash('sha256')
    .update([product, kind, to.join(','), subject, day].join('|'))
    .digest('hex')
    .slice(0, 16);
  return `${product}_${kind}_${hash}`;
}

/**
 * Queue one email.
 *
 * @param {object} args
 * @param {string} args.product   one of PRODUCTS — tags the document for health/redrive reporting
 * @param {string} args.kind      short slug, e.g. 'application-received'
 * @param {string|string[]} args.to
 * @param {string} args.subject
 * @param {string} [args.html]    supply html/text, or template/data
 * @param {string} [args.text]
 * @param {string} [args.template] a name under api/email/templates
 * @param {object} [args.data]     template variables
 * @param {string} [args.replyTo]  defaults to the owner address
 * @param {string} [args.dedupeKey] STRONGLY preferred — makes retries idempotent
 * @param {FirebaseFirestore.Firestore} [args.db]
 * @returns {Promise<{queued: boolean, mailId: string|null, reason?: string}>}
 *   `queued:false` with a reason is a real answer, never a silent success.
 */
async function notify({
  product,
  kind,
  to,
  subject,
  html,
  text,
  template,
  data,
  replyTo,
  dedupeKey,
  db = admin.firestore(),
} = {}) {
  if (!PRODUCTS.includes(product)) {
    return { queued: false, mailId: null, reason: `unknown product "${product}" (expected one of: ${PRODUCTS.join(', ')})` };
  }
  if (typeof kind !== 'string' || !kind.trim()) {
    return { queued: false, mailId: null, reason: 'kind is required' };
  }

  const recipients = normaliseTo(to);
  if (!recipients.length) {
    // The commonest real case: an anonymous submitter, or an order with no
    // email. Not an error — but the caller is told plainly so it can decide.
    return { queued: false, mailId: null, reason: 'no_valid_recipient' };
  }

  const cleanSubject = String(subject || '').trim().slice(0, MAX_SUBJECT);
  if (!cleanSubject) {
    return { queued: false, mailId: null, reason: 'subject is required' };
  }

  let body = { html, text };
  if (template) {
    try {
      body = { html: renderEmail(template, data || {}), text };
    } catch (err) {
      // A missing or broken template is a code bug. Fail loudly rather than
      // queueing an empty email.
      return { queued: false, mailId: null, reason: `template "${template}" failed to render: ${err.message}` };
    }
  }
  if (!body.html && !body.text) {
    return { queued: false, mailId: null, reason: 'nothing to send (no html, text or template)' };
  }

  const day = new Date().toISOString().slice(0, 10);
  const mailId = String(dedupeKey || derivedKey(product, kind.trim(), recipients, cleanSubject, day))
    .replace(/[^A-Za-z0-9_.@:-]/g, '_')
    .slice(0, 400);

  try {
    const queued = await queueMailOnce(db, mailId, {
      to: recipients,
      replyTo: replyTo || resolveNotifyEmail(),
      message: {
        subject: cleanSubject,
        ...(body.html ? { html: body.html } : {}),
        ...(body.text ? { text: body.text } : {}),
      },
      // Tags, so mailHealth and the redrive job can report per product rather
      // than as one undifferentiated pile.
      product,
      kind: kind.trim(),
    });
    // queued:false here means the id already existed — the dedupe working, not
    // a failure. Either way nothing was lost.
    return { queued, mailId, ...(queued ? {} : { reason: 'already_queued' }) };
  } catch (err) {
    console.error(`[notify] failed to queue ${product}/${kind} (${mailId}):`, err.message);
    return { queued: false, mailId, reason: `queue_failed: ${err.message}` };
  }
}

module.exports = { notify, PRODUCTS };
