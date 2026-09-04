/**
 * Support requests with plan-aware response targets: "priority support" as a
 * queue with a promise attached, not a mailbox nobody reads.
 *
 *   free      3 business days   priority 3
 *   pro       1 business day    priority 2
 *   business  4 hours           priority 1
 *   enterprise 4 hours          priority 1
 *
 * @module api/kortex/supportRequests
 */

'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');

const COLLECTION = 'kortex_support_requests';

const TARGETS = Object.freeze({
  free: { hours: 72, label: 'within 3 business days', priority: 3 },
  starter: { hours: 72, label: 'within 3 business days', priority: 3 },
  pro: { hours: 24, label: 'within 1 business day', priority: 2 },
  business: { hours: 4, label: 'within 4 hours', priority: 1 },
  enterprise: { hours: 4, label: 'within 4 hours', priority: 1 }
});

function targetFor(plan) {
  return TARGETS[String(plan || 'free').toLowerCase()] || TARGETS.free;
}

function escapeHtml(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validate(body = {}) {
  const email = cleanText(body.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'An email address is needed so we can reply' };
  const subject = cleanText(body.subject, 120);
  const message = cleanText(body.message, 2000);
  if (message.length < 10) return { error: 'Tell us a little more (at least 10 characters)' };
  const code = cleanText(body.code, 80);
  if (code && !/^[A-Za-z0-9_-]{3,80}$/.test(code)) return { error: 'That link code does not look right' };
  return { email, subject: subject || message.slice(0, 60), message, code: code || null };
}

/**
 * @param {object} p
 * @param {object} p.body
 * @param {{plan: string, tenantId: string|null, via: 'admin'|'guest'|'public'}} p.requester
 */
async function createRequest({ body, requester, ip, userAgent, email, recordAudit, req }) {
  const input = validate(body);
  if (input.error) return { ok: false, error: input.error };
  const target = targetFor(requester.plan);
  const nowMs = Date.now();
  const db = admin.firestore();
  const doc = {
    email: input.email,
    subject: input.subject,
    message: input.message,
    code: input.code,
    tenantId: requester.tenantId || null,
    plan: requester.plan || 'free',
    via: requester.via,
    priority: target.priority,
    targetHours: target.hours,
    targetByMs: nowMs + target.hours * 3600000,
    status: 'open',
    reporter: require('./clientIp').hashClientIp(ip),
    userAgent: String(userAgent || '').slice(0, 200),
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: nowMs
  };
  const ref = await db.collection(COLLECTION).add(doc);

  let delivery = 'not_configured';
  const inbox = process.env.KORTEX_SUPPORT_EMAIL;
  if (email && inbox) {
    try {
      const result = await email.deliver({
        to: inbox,
        subject: `[Kortex support · P${target.priority}] ${input.subject}`,
        text: `From: ${input.email}\nPlan: ${doc.plan} (${target.label})\nLink: ${input.code || '-'}\nRequest: ${ref.id}\n\n${input.message}`,
        html: `<p><b>From:</b> ${escapeHtml(input.email)}<br><b>Plan:</b> ${escapeHtml(doc.plan)} (${escapeHtml(target.label)})<br><b>Link:</b> ${escapeHtml(input.code || '-')}<br><b>Request:</b> ${escapeHtml(ref.id)}</p><p style="white-space:pre-wrap">${escapeHtml(input.message)}</p>`
      });
      delivery = result && result.status ? result.status : 'sent';
    } catch (_) { delivery = 'failed'; }
  }

  if (recordAudit) {
    recordAudit({ req, actor: { type: requester.via, name: 'support' }, action: 'support.requested', tenantId: doc.tenantId, code: input.code, extra: { plan: doc.plan, priority: doc.priority, requestId: ref.id, delivery } });
  }
  return { ok: true, id: ref.id, plan: doc.plan, priority: doc.priority, target: target.label, targetBy: new Date(doc.targetByMs).toISOString(), delivery };
}

async function listRequests({ status = 'open', limit = 100 } = {}) {
  const db = admin.firestore();
  const base = status && status !== 'all'
    ? db.collection(COLLECTION).where('status', '==', status)
    : db.collection(COLLECTION);
  const snap = await base.limit(Math.min(limit, 500)).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.priority - b.priority) || ((a.createdAtMs || 0) - (b.createdAtMs || 0)));
}

async function resolveRequest(id, { note, actor }) {
  const db = admin.firestore();
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) { const e = new Error('Request not found'); e.code = 'NOT_FOUND'; throw e; }
  await ref.update({ status: 'resolved', note: cleanText(note, 1000) || null, resolvedBy: actor || null, resolvedAt: FieldValue.serverTimestamp(), resolvedAtMs: Date.now() });
  return { id, status: 'resolved' };
}

module.exports = { COLLECTION, TARGETS, targetFor, validate, createRequest, listRequests, resolveRequest };
