/**
 * Transactional email for Kortex.
 *
 * Sends through SendGrid's REST API when SENDGRID_API_KEY is set; otherwise
 * queues the message in `pending_emails` so nothing is lost and the caller
 * can tell the user honestly what happened (`status: 'queued'`).
 *
 * Every delivery attempt is recorded in `pending_emails` with its outcome, so
 * a provider can be connected later and the queue drained.
 *
 * @module services/emailDelivery
 */

'use strict';

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const db = admin.firestore();

const SENDGRID_ENDPOINT = 'https://api.sendgrid.com/v3/mail/send';
const SEND_TIMEOUT_MS = 8000;
const linkHosts = require('../api/kortex/linkHosts');
const MANAGE_URL = `${linkHosts.SHORT_BASE}/#manage`;
const MANAGE_LABEL = linkHosts.SHORT_HOST;

function fromAddress() {
  return process.env.KORTEX_EMAIL_FROM || 'kortex@kaayko.com';
}

const SENSITIVE_TEMPLATES = new Set(['guest_access_code', 'guest_code_rotated']);

function isConfigured() {
  // "Configured" means mailSender can actually deliver. MAIL_SMTP_URL always
  // exists so the functions can deploy; it holds the sentinel 'UNCONFIGURED'
  // until a real provider URL is set, and that sentinel must not read as
  // configured — otherwise an access code would be queued for a delivery that
  // is not coming.
  const url = typeof process.env.MAIL_SMTP_URL === 'string' ? process.env.MAIL_SMTP_URL.trim() : '';
  return Boolean(url) && url !== 'UNCONFIGURED';
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendViaSendGrid({ to, subject, text, html }, fetchImpl) {
  const doFetch = fetchImpl || global.fetch;
  const response = await doFetch(SENDGRID_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(SEND_TIMEOUT_MS) : undefined,
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromAddress(), name: 'Kortex by Kaayko' },
      subject,
      // SendGrid rejects an empty content part, so send only what has a body.
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html }
      ].filter(part => typeof part.value === 'string' && part.value.trim())
    })
  });
  if (response.status !== 202 && !response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`SendGrid HTTP ${response.status} ${body.slice(0, 200)}`);
  }
}

/**
 * Deliver one message. Never throws; returns { status: 'sent'|'queued'|'failed', id, error? }.
 */
async function deliver(message, { fetchImpl } = {}) {
  // REWRITTEN 6 Sep 2026. This used to POST to SendGrid (no key, never
  // configured) and otherwise park the message in `pending_emails`, a second
  // queue nothing ever drained. It now goes through notify() into the one `mail`
  // collection that mailSender actually delivers.
  //
  // The sensitive-template rule is PRESERVED and still matters. It exists so a
  // guest access code is never left sitting in a queue that cannot be drained.
  // Now that a provider exists the code is delivered in seconds, so queueing it
  // is correct — but the document is tagged `sensitive: true` so
  // scheduled/mailRedrive.js can strip the body once delivery succeeds, rather
  // than leaving a live credential in Firestore until retention runs at 90 days.
  const { to, subject, text, html, template = null, meta = null } = message;
  const { notify } = require('./notify');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to || ''))) {
    return { status: 'failed', error: 'invalid recipient' };
  }

  const sensitive = SENSITIVE_TEMPLATES.has(template);

  // PRESERVED PROPERTY: a message carrying a live credential is never written to
  // the queue when there is no way to send it. Queueing it would leave an access
  // code sitting in Firestore indefinitely for a delivery that is not coming.
  // With credentials present it is queued and then redacted after delivery by
  // scheduled/mailRedrive.js, so the code is at rest for seconds, not forever.
  if (sensitive && !isConfigured()) {
    return { status: 'not_configured', id: null };
  }

  const result = await notify({
    product: 'kortex',
    kind: template || 'kortex-mail',
    to,
    subject,
    html,
    text,
    // Access codes must never be deduped away — a rotated code is a NEW code
    // and has to reach the person even if the subject line is identical.
    dedupeKey: sensitive ? `kortex_${template}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` : undefined,
  });

  if (!result.queued && result.reason !== 'already_queued') {
    console.error('[Email] queue failed:', result.reason);
    return { status: 'failed', error: result.reason };
  }

  if (sensitive && result.mailId) {
    // Marked for post-delivery redaction. Written separately so an older
    // notify() cannot silently drop the flag.
    await db.collection('mail').doc(result.mailId)
      .set({ sensitive: true }, { merge: true })
      .catch((e) => console.error('[Email] could not flag sensitive mail:', e.message));
  }

  return { status: 'sent', id: result.mailId };
}

// ─── Templates ────────────────────────────────────────────────────────────────

function shell(title, bodyHtml) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f6f5f2;font-family:Georgia,'Times New Roman',serif;color:#1b1a17">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e6e1d6">
    <tr><td style="padding:22px 28px;border-bottom:1px solid #e6e1d6;background:#0a1129;color:#ede8df"><span style="font-size:20px;letter-spacing:.18em;font-weight:700">KORTEX</span> <span style="font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#d9bd7b;margin-left:10px">by KAAYKO</span><span style="float:right;font-family:Menlo,Consolas,monospace;font-size:12px;color:#d9bd7b;padding-top:6px">kaay.link</span></td></tr>
    <tr><td style="padding:28px">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:600">${escapeHtml(title)}</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:16px 28px;border-top:1px solid #e6e1d6;font-size:12px;color:#8a8579">You are receiving this because an email address was added to a Kortex workspace. If that was not you, ignore this message; nothing changes without the access code.<br>Kortex is a KAAYKO product · <a href="https://kaayko.com" style="color:#8a6f3a">kaayko.com</a></td></tr>
  </table></td></tr></table></body></html>`;
}

function codeBlock(accessCode) {
  return `<p style="margin:18px 0 6px;font-size:13px;color:#6b665c">Access code</p>
  <p style="margin:0 0 18px;font-family:Menlo,Consolas,monospace;font-size:20px;letter-spacing:.08em;background:#f6f5f2;border:1px solid #e6e1d6;padding:14px 16px">${escapeHtml(accessCode)}</p>`;
}

function qrBlock(link) {
  const code = link?.code;
  if (!code) return '';
  const qr = linkHosts.qrUrlFor(code);
  const shortUrl = link.shortUrl || linkHosts.shortUrlFor(code);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px auto 6px"><tr>
    <td align="center" style="background:#ffffff;border:1px solid #e6e1d6;padding:10px"><img src="${escapeHtml(qr)}?size=360" width="180" height="180" alt="QR code for ${escapeHtml(shortUrl)}" style="display:block;width:180px;height:180px"></td></tr>
    <tr><td align="center" style="padding-top:8px;font-family:Menlo,Consolas,monospace;font-size:15px"><a href="${escapeHtml(shortUrl)}" style="color:#8a6f3a;text-decoration:none">${escapeHtml(shortUrl.replace(/^https?:\/\//, ''))}</a></td></tr></table>`;
}
function buttonBlock(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px auto 4px"><tr><td align="center" style="background:#b5935a;padding:13px 26px"><a href="${escapeHtml(href)}" style="color:#080808;text-decoration:none;font-size:13px;letter-spacing:.16em;text-transform:uppercase;font-weight:600">${escapeHtml(label)}</a></td></tr></table>`;
}

function guestAccessCodeMessage({ to, accessCode, link, lifetimeDays = 365, analyticsDays = 7 }) {
  const shortUrl = link?.shortUrl || (link?.code ? linkHosts.shortUrlFor(link.code) : '');
  const subject = shortUrl ? `Your Kortex access code for ${shortUrl.replace(/^https?:\/\//, '')}` : 'Your Kortex access code';
  const text = [
    'Your Kortex access code',
    '',
    `Access code: ${accessCode}`,
    shortUrl ? `Your link: ${shortUrl}` : '',
    link?.code ? `Your QR image: ${linkHosts.qrUrlFor(link.code)}` : '',
    '',
    `Enter the code at ${MANAGE_URL} to see scans, change the destination, or download the QR again.`,
    `Free links stay live for ${lifetimeDays} days and renew every time you check in. Stats show the last ${analyticsDays} days.`,
    '',
    'Keep this code private: anyone who has it can manage the link.'
  ].filter(Boolean).join('\n');
  const html = shell('Your Kortex access code', `
    <p style="margin:0 0 8px;line-height:1.6">Your QR is live. Print it anywhere; the code below is the key to its scans and settings, and it is shown only here.</p>
    ${qrBlock(link)}
    ${codeBlock(accessCode)}
    ${buttonBlock(MANAGE_URL, 'Open my dashboard')}
    <p style="margin:6px 0 0;font-size:13px;color:#8a8579;text-align:center">${escapeHtml(MANAGE_LABEL)}, then <i>already have a code</i></p>
    <p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#6b665c">Scans by day, device and country. Change where the QR points at any time without reprinting. Free links stay live for ${lifetimeDays} days and renew every time you check in; stats show the last ${analyticsDays} days. Keep the code private: anyone who has it can manage the link.</p>`);
  return { to, subject, text, html, template: 'guest_access_code', meta: { code: link?.code || null } };
}

function guestCodeRotatedMessage({ to, accessCode, lifetimeDays = 365 }) {
  const subject = 'Your new Kortex access code';
  const text = [
    'Your new Kortex access code',
    '',
    `Access code: ${accessCode}`,
    '',
    'Your previous code no longer works. Enter the new one at ' + MANAGE_URL + ' to manage your links.',
    `Free links stay live for ${lifetimeDays} days and renew every time you check in.`
  ].join('\n');
  const html = shell('Your new Kortex access code', `
    <p style="margin:0 0 8px;line-height:1.6">A new access code was issued for your workspace. Your previous code no longer works.</p>
    ${codeBlock(accessCode)}
    ${buttonBlock(MANAGE_URL, 'Open my dashboard')}
    <p style="margin:6px 0 0;font-size:13px;color:#8a8579;text-align:center">${escapeHtml(MANAGE_LABEL)}, then <i>already have a code</i></p>`);
  return { to, subject, text, html, template: 'guest_code_rotated', meta: null };
}

async function sendGuestAccessCode(params, options) {
  return deliver(guestAccessCodeMessage(params), options);
}

async function sendGuestCodeRotated(params, options) {
  return deliver(guestCodeRotatedMessage(params), options);
}

module.exports = { deliver, isConfigured, SENSITIVE_TEMPLATES, sendGuestAccessCode, sendGuestCodeRotated, guestAccessCodeMessage, guestCodeRotatedMessage, MANAGE_URL };
