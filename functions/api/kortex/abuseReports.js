/**
 * Public abuse reports and the automatic hold they can trigger.
 *
 * Anyone can report a link. The response is the same whether or not the code
 * exists (no enumeration). A report is stored with a hashed reporter IP; when
 * two different reporters flag the same guest-tier link for phishing or
 * malware inside a day, the link is held for review on the spot. Account
 * tenants are never auto-held from reports alone: a reviewer decides.
 *
 * @module api/kortex/abuseReports
 */

'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');

const COLLECTION = 'kortex_abuse_reports';
const REASONS = Object.freeze(['phishing', 'malware', 'scam', 'adult', 'spam', 'other']);
const AUTO_HOLD_REASONS = new Set(['phishing', 'malware', 'scam']);
const AUTO_HOLD_DISTINCT_REPORTERS = 3;
const AUTO_HOLD_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const AUTO_HOLD_WINDOW_MS = 24 * 60 * 60 * 1000;

function hashReporter(ip) {
  return require('./clientIp').hashClientIp(ip) || 'unknown';
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validate(body = {}) {
  const code = cleanText(body.code, 80);
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(code)) return { error: 'A link code is required' };
  const reason = cleanText(body.reason, 20).toLowerCase();
  if (!REASONS.includes(reason)) return { error: 'Pick a reason from the list' };
  const details = cleanText(body.details, 1000);
  const email = cleanText(body.email, 200).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That email does not look right' };
  return { code, reason, details, email: email || null };
}

/**
 * Store a report and apply the auto-hold rule. Always resolves; the caller
 * answers 202 regardless so a reporter learns nothing about the code.
 */
async function fileReport({ body, ip, userAgent, setLinkStatus, recordAudit, req }) {
  const input = validate(body);
  if (input.error) return { accepted: false, error: input.error };

  const db = admin.firestore();
  const linkSnap = await db.collection('short_links').doc(input.code).get();
  const link = linkSnap.exists ? linkSnap.data() : null;
  const reporter = hashReporter(ip);
  const nowMs = Date.now();

  const report = {
    code: input.code,
    linkExists: !!link,
    tenantId: link ? (link.tenantId || 'kaayko-default') : null,
    reason: input.reason,
    details: input.details,
    reporterEmail: input.email,
    reporter,
    userAgent: String(userAgent || '').slice(0, 200),
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: nowMs
  };
  const ref = await db.collection(COLLECTION).add(report);

  let autoHeld = false;
  const recentlyReviewed = link && ((link.safety?.review?.approvedAtMs || 0) > nowMs - AUTO_HOLD_COOLDOWN_MS || (link.autoHeldAtMs || 0) > nowMs - AUTO_HOLD_COOLDOWN_MS);
  if (link && !recentlyReviewed && AUTO_HOLD_REASONS.has(input.reason) && (link.status || 'active') === 'active') {
    const tenantSnap = link.tenantId ? await db.collection('tenants').doc(link.tenantId).get() : null;
    const tenantKind = tenantSnap && tenantSnap.exists ? (tenantSnap.data().kind || null) : null;
    if (tenantKind === 'guest') {
      // One equality filter, window applied in memory: no composite index needed.
      const recent = await db.collection(COLLECTION).where('code', '==', input.code).get();
      const reporters = new Set(recent.docs.map(d => d.data())
        .filter(r => (r.createdAtMs || 0) >= nowMs - AUTO_HOLD_WINDOW_MS)
        .map(r => r.reporter).filter(Boolean));
      reporters.add(reporter);
      if (reporters.size >= AUTO_HOLD_DISTINCT_REPORTERS) {
        await setLinkStatus(input.code, 'held', { reason: `abuse_reports:${input.reason}`, actor: 'abuse-reports' });
        await db.collection('short_links').doc(input.code).update({ autoHeldAtMs: nowMs, heldBy: 'abuse-reports' });
        await ref.update({ autoHeld: true });
        autoHeld = true;
        await db.collection('security_alerts').add({
          type: 'abuse_auto_hold',
          code: input.code,
          tenantId: link.tenantId || null,
          reason: input.reason,
          reporters: reporters.size,
          createdAt: FieldValue.serverTimestamp()
        });
      }
    }
  }

  if (recordAudit) {
    recordAudit({
      req,
      actor: { type: 'public', name: 'abuse-report' },
      action: 'link.reported',
      code: input.code,
      tenantId: report.tenantId,
      extra: { reason: input.reason, autoHeld, reportId: ref.id }
    });
  }
  return { accepted: true, id: ref.id, autoHeld };
}

async function listReports({ status = 'open', limit = 100 } = {}) {
  const db = admin.firestore();
  const base = status && status !== 'all' ? db.collection(COLLECTION).where('status', '==', status) : db.collection(COLLECTION);
  const snap = await base.limit(Math.min(limit, 500)).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
}

async function resolveReport(id, { resolution, actor }) {
  const db = admin.firestore();
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) { const e = new Error('Report not found'); e.code = 'NOT_FOUND'; throw e; }
  await ref.update({ status: 'resolved', resolution: cleanText(resolution, 500) || null, resolvedBy: actor || null, resolvedAt: FieldValue.serverTimestamp() });
  return { id, status: 'resolved' };
}

module.exports = { COLLECTION, REASONS, fileReport, listReports, resolveReport, validate, AUTO_HOLD_DISTINCT_REPORTERS };
