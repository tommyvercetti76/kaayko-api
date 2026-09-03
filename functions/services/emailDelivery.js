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
const MANAGE_URL = 'https://kaayko.com/kortex#manage';

function fromAddress() {
  return process.env.KORTEX_EMAIL_FROM || 'kortex@kaayko.com';
}

function isConfigured() {
  return !!process.env.SENDGRID_API_KEY;
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
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html }
      ]
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
  const { to, subject, text, html, template = null, meta = null } = message;
  const record = {
    to,
    subject,
    text,
    html,
    template,
    meta,
    from: fromAddress(),
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: Date.now()
  };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to || ''))) {
    return { status: 'failed', error: 'invalid recipient' };
  }

  if (!isConfigured()) {
    try {
      const ref = await db.collection('pending_emails').add({ ...record, status: 'queued', reason: 'no_provider' });
      return { status: 'queued', id: ref.id };
    } catch (error) {
      console.error('[Email] queue write failed:', error.message);
      return { status: 'failed', error: error.message };
    }
  }

  try {
    await sendViaSendGrid({ to, subject, text, html }, fetchImpl);
    const ref = await db.collection('pending_emails').add({ ...record, status: 'sent', sentAtMs: Date.now() }).catch(() => null);
    return { status: 'sent', id: ref?.id || null };
  } catch (error) {
    console.error('[Email] send failed:', error.message);
    const ref = await db.collection('pending_emails').add({ ...record, status: 'failed', error: error.message }).catch(() => null);
    return { status: 'failed', id: ref?.id || null, error: error.message };
  }
}

// ─── Templates ────────────────────────────────────────────────────────────────

function shell(title, bodyHtml) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f6f5f2;font-family:Georgia,'Times New Roman',serif;color:#1b1a17">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e6e1d6">
    <tr><td style="padding:22px 28px;border-bottom:1px solid #e6e1d6;font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#8a6f3a">Kortex · by Kaayko</td></tr>
    <tr><td style="padding:28px">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:600">${escapeHtml(title)}</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:16px 28px;border-top:1px solid #e6e1d6;font-size:12px;color:#8a8579">You are receiving this because an email address was added to a Kortex workspace. If that was not you, ignore this message; nothing changes without the access code.</td></tr>
  </table></td></tr></table></body></html>`;
}

function codeBlock(accessCode) {
  return `<p style="margin:18px 0 6px;font-size:13px;color:#6b665c">Access code</p>
  <p style="margin:0 0 18px;font-family:Menlo,Consolas,monospace;font-size:20px;letter-spacing:.08em;background:#f6f5f2;border:1px solid #e6e1d6;padding:14px 16px">${escapeHtml(accessCode)}</p>`;
}

function guestAccessCodeMessage({ to, accessCode, link, lifetimeDays = 365, analyticsDays = 7 }) {
  const shortUrl = link?.shortUrl || '';
  const subject = 'Your Kortex access code';
  const text = [
    'Your Kortex access code',
    '',
    `Access code: ${accessCode}`,
    shortUrl ? `Your link: ${shortUrl}` : '',
    '',
    `Enter the code at ${MANAGE_URL} to see scans, change the destination, or download the QR again.`,
    `Free links stay live for ${lifetimeDays} days and renew every time you check in. Stats show the last ${analyticsDays} days.`,
    '',
    'Keep this code private: anyone who has it can manage the link.'
  ].filter(Boolean).join('\n');
  const html = shell('Your Kortex access code', `
    <p style="margin:0 0 8px;line-height:1.6">This code is the key to your free workspace. Enter it at
      <a href="${MANAGE_URL}" style="color:#8a6f3a">kaayko.com/kortex</a> to see scans, change where the QR points, or download it again.</p>
    ${codeBlock(accessCode)}
    ${shortUrl ? `<p style="margin:0 0 8px;font-size:14px;color:#6b665c">Your link: <a href="${escapeHtml(shortUrl)}" style="color:#8a6f3a">${escapeHtml(shortUrl)}</a></p>` : ''}
    <p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#6b665c">Free links stay live for ${lifetimeDays} days and renew every time you check in. Stats show the last ${analyticsDays} days. Keep the code private: anyone who has it can manage the link.</p>`);
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
    <p style="margin:0;font-size:14px;line-height:1.6;color:#6b665c">Enter it at <a href="${MANAGE_URL}" style="color:#8a6f3a">kaayko.com/kortex</a> to manage your links.</p>`);
  return { to, subject, text, html, template: 'guest_code_rotated', meta: null };
}

async function sendGuestAccessCode(params, options) {
  return deliver(guestAccessCodeMessage(params), options);
}

async function sendGuestCodeRotated(params, options) {
  return deliver(guestCodeRotatedMessage(params), options);
}

module.exports = { deliver, isConfigured, sendGuestAccessCode, sendGuestCodeRotated, guestAccessCodeMessage, guestCodeRotatedMessage, MANAGE_URL };
