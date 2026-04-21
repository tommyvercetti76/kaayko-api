/**
 * Alumni Service
 *
 * Handles lead creation, updates, scoring, email OTP verification, and
 * admin read access.
 *
 * Firestore collections used
 * ──────────────────────────
 *   alumni_leads          Main submissions
 *   alumni_otps           Short-lived email OTP codes
 *   alumni_visit_tokens   Single-use visit tokens (managed by visitTokenService)
 *
 * Score table
 * ───────────
 *  +1  form submitted
 *  +2  meaningful comment (≥ 50 chars)
 *  +2  volunteer / donor intent
 *  +1  came from a trusted batch link (sourceGroup != null)
 *  +2  email verified (via OTP)
 *  +3  phone / WhatsApp provided and not empty
 *  -N  fraud penalty (from fraudService)
 *
 * Buckets
 * ───────
 *   low_confidence   score < 3
 *   medium           score 3–5
 *   verified         score ≥ 6  OR  emailVerified === true
 */

'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const { assessFraud } = require('./fraudService');

const db = admin.firestore();

const OTP_TTL_SECONDS  = 15 * 60;  // 15 minutes
const EDIT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// ─── helpers ────────────────────────────────────────────────────────────────

function hmacSecret() {
  return process.env.ALUMNI_TOKEN_SECRET || process.env.KORTEX_SYNC_KEY || 'alumni-dev';
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Generate an HMAC-signed edit token bound to a leadId */
function generateEditToken(leadId) {
  const payload = { lid: leadId, iat: Math.floor(Date.now() / 1000) };
  const pb64 = b64url(Buffer.from(JSON.stringify(payload)));
  const sig  = b64url(crypto.createHmac('sha256', hmacSecret()).update(pb64).digest());
  return `${pb64}.${sig}`;
}

/** Verify and decode an edit token; throws on invalid/expired */
function verifyEditToken(token) {
  const parts = token.split('.');
  if (parts.length !== 2) throw Object.assign(new Error('Malformed token'), { code: 'BAD_TOKEN' });

  const [pb64, sig] = parts;
  const expectedSig = b64url(crypto.createHmac('sha256', hmacSecret()).update(pb64).digest());

  const sigBuf = Buffer.from(sig, 'base64');
  const expBuf = Buffer.from(expectedSig, 'base64');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw Object.assign(new Error('Bad token signature'), { code: 'BAD_TOKEN' });
  }

  const payload = JSON.parse(Buffer.from(pb64, 'base64').toString('utf8'));
  if (payload.iat + EDIT_TTL_SECONDS < Math.floor(Date.now() / 1000)) {
    throw Object.assign(new Error('Edit token expired'), { code: 'TOKEN_EXPIRED' });
  }

  return payload;
}

/** Compute trust score from a lead document */
function computeScore(lead) {
  let score = 1; // base: submitted

  if ((lead.comment || '').length >= 50)              score += 2;
  if (lead.interestType?.includes('volunteer') ||
      lead.interestType?.includes('donate_later'))    score += 2;
  if (lead.sourceGroup)                               score += 1;
  if (lead.emailVerified)                             score += 2;
  if ((lead.phone || '').trim().length > 5)           score += 3;

  score -= (lead.fraudPenalty || 0);
  return Math.max(0, score);
}

/** Determine confidence bucket from score */
function scoreToBucket(score, emailVerified) {
  if (score >= 6 || emailVerified) return 'verified';
  if (score >= 3)                  return 'medium_confidence';
  return 'low_confidence';
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Create a new alumni lead from a verified form submission.
 *
 * @param {Object} formData  - validated fields from request body
 * @param {Object} tokenData - decoded visit token payload { lc, sg, sb, ih, ... }
 * @param {string} ip_hash   - hashed IP
 * @returns {Promise<{ leadId: string, editToken: string, score: number, bucket: string }>}
 */
async function createLead(formData, tokenData, ip_hash) {
  const {
    name, email, phone = '', batch = '', city = '', country = '',
    relationship = 'alumnus', interestType = [], comment = '',
    fpHash = null,
  } = formData;

  // ── Fraud check ──────────────────────────────────────────────────────────
  const { penalty, flags } = await assessFraud({
    ip_hash,
    linkCode: tokenData.lc,
    fpHash,
    name,
    batch,
  });

  // ── Build document ───────────────────────────────────────────────────────
  // Deduplication is handled by the single-use visit token gate upstream;
  // no email dedup needed (email is optional for anonymous voting).
  const leadRef = db.collection('alumni_leads').doc();
  const editToken = generateEditToken(leadRef.id);

  const lead = {
    name:         name ? name.trim() : null,
    email:        email ? email.toLowerCase().trim() : null,
    phone:        phone.trim(),
    batch:        String(batch).trim(),
    city:         city.trim(),
    country:      country.trim(),
    relationship,
    interestType: Array.isArray(interestType) ? interestType : [interestType],
    comment:      comment.trim(),

    // Source
    linkCode:    tokenData.lc || null,
    sourceGroup: tokenData.sg || null,
    sourceBatch: tokenData.sb || null,
    campaign:    'alumni',
    visitId:     tokenData.vid || null,

    // Device / trust
    ip_hash,
    fpHash:      fpHash || null,
    fraudFlags:  flags,
    fraudPenalty: penalty,

    // Verification
    emailVerified: false,
    emailVerifiedAt: null,

    // Tokens
    editToken,

    // Will be computed below
    score:  0,
    bucket: 'low_confidence',

    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  lead.score  = computeScore(lead);
  lead.bucket = scoreToBucket(lead.score, false);

  await leadRef.set(lead);

  return {
    leadId:    leadRef.id,
    editToken,
    score:     lead.score,
    bucket:    lead.bucket,
    duplicate: false,
  };
}

/**
 * Update an existing lead via its edit token.
 *
 * @param {string} editToken
 * @param {Object} updates  - subset of form fields to overwrite
 * @returns {Promise<{ leadId: string, score: number, bucket: string }>}
 */
async function updateLead(editToken, updates) {
  const payload = verifyEditToken(editToken);
  const ref = db.collection('alumni_leads').doc(payload.lid);
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error('Lead not found'), { code: 'NOT_FOUND' });

  const allowed = ['phone', 'city', 'country', 'interestType', 'comment', 'batch', 'relationship'];
  const safe = {};
  for (const k of allowed) {
    if (updates[k] !== undefined) {
      safe[k] = Array.isArray(updates[k]) ? updates[k] : String(updates[k]).trim();
    }
  }
  if (!Object.keys(safe).length) throw Object.assign(new Error('No valid fields'), { code: 'NO_OP' });

  const merged = { ...snap.data(), ...safe };
  const score  = computeScore(merged);
  const bucket = scoreToBucket(score, merged.emailVerified);

  await ref.update({ ...safe, score, bucket, updatedAt: FieldValue.serverTimestamp() });

  return { leadId: payload.lid, score, bucket };
}

/**
 * Send a 6-digit OTP to the lead's email for verification.
 *
 * @param {string} editToken
 * @returns {Promise<void>}
 */
async function sendEmailOtp(editToken) {
  const payload = verifyEditToken(editToken);
  const snap = await db.collection('alumni_leads').doc(payload.lid).get();
  if (!snap.exists) throw Object.assign(new Error('Lead not found'), { code: 'NOT_FOUND' });

  const lead = snap.data();
  if (!lead.email) throw Object.assign(new Error('No email on record'), { code: 'NO_EMAIL' });
  if (lead.emailVerified) return; // already done

  // Invalidate previous unexpired OTPs for this lead
  const oldOtps = await db.collection('alumni_otps')
    .where('leadId', '==', payload.lid)
    .where('used', '==', false)
    .get();
  const batch = db.batch();
  oldOtps.docs.forEach(d => batch.update(d.ref, { used: true }));
  await batch.commit();

  // Generate new OTP
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const exp  = admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_SECONDS * 1000);

  await db.collection('alumni_otps').add({
    leadId: payload.lid,
    email:  lead.email,
    code,
    expiresAt: exp,
    used: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Attempt to deliver via email notification service (best-effort)
  try {
    const { sendRawEmail } = require('../../services/emailNotificationService');
    if (sendRawEmail) {
      await sendRawEmail({
        to: lead.email,
        subject: 'Verify your interest — Alumni Network',
        html: `
          <p>Hi ${lead.name.split(' ')[0]},</p>
          <p>Your verification code for the Alumni Network interest form is:</p>
          <h2 style="letter-spacing:6px;font-size:36px;">${code}</h2>
          <p>It expires in 15 minutes. If you didn't request this, ignore it.</p>
        `,
      });
    }
  } catch (emailErr) {
    console.warn('[Alumni] OTP email failed (non-blocking):', emailErr.message);
  }
}

/**
 * Verify the OTP supplied by the user and upgrade the lead's score.
 *
 * @param {string} editToken
 * @param {string} code  - 6-digit code from the user
 * @returns {Promise<{ score: number, bucket: string }>}
 */
async function verifyEmailOtp(editToken, code) {
  const payload = verifyEditToken(editToken);
  const now = admin.firestore.Timestamp.now();

  const otpSnap = await db.collection('alumni_otps')
    .where('leadId', '==', payload.lid)
    .where('code',   '==', String(code).trim())
    .where('used',   '==', false)
    .limit(1)
    .get();

  if (otpSnap.empty) throw Object.assign(new Error('Invalid or expired OTP'), { code: 'INVALID_OTP' });

  const otpDoc = otpSnap.docs[0];
  const otpData = otpDoc.data();

  if (otpData.expiresAt.toMillis() < now.toMillis()) {
    throw Object.assign(new Error('OTP expired'), { code: 'OTP_EXPIRED' });
  }

  // Mark OTP used
  await otpDoc.ref.update({ used: true, usedAt: FieldValue.serverTimestamp() });

  // Upgrade lead
  const leadRef = db.collection('alumni_leads').doc(payload.lid);
  const leadSnap = await leadRef.get();
  const lead = leadSnap.data();

  const updatedLead = { ...lead, emailVerified: true };
  const score  = computeScore(updatedLead);
  const bucket = scoreToBucket(score, true);

  await leadRef.update({
    emailVerified: true,
    emailVerifiedAt: FieldValue.serverTimestamp(),
    score,
    bucket,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { score, bucket };
}

/**
 * Get a lead's public summary by edit token (for the thank-you page).
 *
 * @param {string} editToken
 * @returns {Promise<Object>}
 */
async function getLeadByEditToken(editToken) {
  const payload = verifyEditToken(editToken);
  const snap = await db.collection('alumni_leads').doc(payload.lid).get();
  if (!snap.exists) throw Object.assign(new Error('Lead not found'), { code: 'NOT_FOUND' });

  const d = snap.data();
  return {
    leadId:        snap.id,
    name:          d.name,
    email:         d.email,
    batch:         d.batch,
    interestType:  d.interestType,
    emailVerified: d.emailVerified,
    score:         d.score,
    bucket:        d.bucket,
    createdAt:     d.createdAt,
  };
}

/**
 * Admin: list leads with optional bucket filter and pagination.
 *
 * @param {Object} opts
 * @param {string}  opts.bucket    - filter by bucket (optional)
 * @param {number}  opts.limit     - page size (default 50)
 * @param {string}  opts.startAfter - last doc ID for cursor pagination
 * @returns {Promise<{ leads: Object[], total: number }>}
 */
async function adminListLeads({ bucket, limit = 50, startAfter } = {}) {
  let q = db.collection('alumni_leads').orderBy('createdAt', 'desc');
  if (bucket) q = q.where('bucket', '==', bucket);
  q = q.limit(Math.min(limit, 200));

  if (startAfter) {
    const cursorDoc = await db.collection('alumni_leads').doc(startAfter).get();
    if (cursorDoc.exists) q = q.startAfter(cursorDoc);
  }

  const snap = await q.get();
  const leads = snap.docs.map(d => {
    const data = d.data();
    return {
      id:            d.id,
      name:          data.name,
      email:         data.email,
      phone:         data.phone,
      batch:         data.batch,
      city:          data.city,
      country:       data.country,
      relationship:  data.relationship,
      interestType:  data.interestType,
      comment:       data.comment,
      sourceGroup:   data.sourceGroup,
      sourceBatch:   data.sourceBatch,
      score:         data.score,
      bucket:        data.bucket,
      emailVerified: data.emailVerified,
      fraudFlags:    data.fraudFlags,
      createdAt:     data.createdAt,
    };
  });

  return { leads, hasMore: snap.docs.length === limit };
}

/**
 * Admin: aggregate stats across all leads.
 *
 * @returns {Promise<Object>}
 */
async function adminStats() {
  const [total, verified, medium, low, suspicious] = await Promise.all([
    db.collection('alumni_leads').count().get(),
    db.collection('alumni_leads').where('bucket', '==', 'verified').count().get(),
    db.collection('alumni_leads').where('bucket', '==', 'medium_confidence').count().get(),
    db.collection('alumni_leads').where('bucket', '==', 'low_confidence').count().get(),
    db.collection('alumni_leads').where('fraudFlags', '!=', []).count().get(),
  ]);

  // Unique batches represented
  const batchSnap = await db.collection('alumni_leads')
    .select('batch')
    .limit(1000)
    .get();
  const batches = new Set(batchSnap.docs.map(d => d.data().batch).filter(Boolean));

  // Volunteer / donor count
  const volunteerSnap = await db.collection('alumni_leads')
    .where('interestType', 'array-contains-any', ['volunteer', 'donate_later'])
    .count()
    .get();

  // Comment count (have meaningful comment)
  const commentSnap = await db.collection('alumni_leads')
    .where('comment', '!=', '')
    .count()
    .get();

  return {
    total:      total.data().count,
    verified:   verified.data().count,
    medium:     medium.data().count,
    low:        low.data().count,
    suspicious: suspicious.data().count,
    batches:    batches.size,
    withVolunteerOrDonorIntent: volunteerSnap.data().count,
    withComment: commentSnap.data().count,
  };
}

module.exports = {
  createLead,
  updateLead,
  sendEmailOtp,
  verifyEmailOtp,
  getLeadByEditToken,
  adminListLeads,
  adminStats,
};
