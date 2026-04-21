/**
 * Alumni Fraud Detection Service
 *
 * Scores each submission for suspicious behaviour and returns a penalty
 * to subtract from the lead's trust score.
 *
 * Rules
 * ─────
 * -5  Burst from same link:  >5 submissions within 5 minutes
 * -3  IP duplicate:          >3 submissions from same IP in 1 hour
 * -3  Device fingerprint:    same fp, different name in 24 h
 * -2  Empty / fake name:     single-word name or only whitespace
 * -1  Impossible batch combo: batch year > current year or < 1950
 *
 * Flags returned are stored on the lead for human review.
 */

'use strict';

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const db = admin.firestore();
const CURRENT_YEAR = new Date().getFullYear();

/**
 * Assess fraud risk for an incoming submission.
 *
 * @param {Object} params
 * @param {string} params.ip_hash   - hashed requester IP
 * @param {string} params.linkCode  - Kortex link code
 * @param {string} params.fpHash    - optional device fingerprint hash
 * @param {string} params.name      - submitted name
 * @param {string|number} params.batch - graduation year
 * @returns {Promise<{ penalty: number, flags: string[] }>}
 */
async function assessFraud({ ip_hash, linkCode, fpHash, name, batch }) {
  const flags = [];
  let penalty = 0;

  const now = Date.now();
  const fiveMinAgo  = admin.firestore.Timestamp.fromMillis(now - 5  * 60 * 1000);
  const oneHourAgo  = admin.firestore.Timestamp.fromMillis(now - 60 * 60 * 1000);
  const oneDayAgo   = admin.firestore.Timestamp.fromMillis(now - 24 * 60 * 60 * 1000);

  try {
    // ── 1. Burst from same link (>5 in 5 min) ──────────────────────────────
    if (linkCode) {
      const burstSnap = await db.collection('alumni_leads')
        .where('linkCode', '==', linkCode)
        .where('createdAt', '>=', fiveMinAgo)
        .count()
        .get();
      if (burstSnap.data().count > 5) {
        flags.push('burst_from_link');
        penalty += 5;
      }
    }

    // ── 2. IP duplicate (>3 in 1 hour) ─────────────────────────────────────
    if (ip_hash) {
      const ipSnap = await db.collection('alumni_leads')
        .where('ip_hash', '==', ip_hash)
        .where('createdAt', '>=', oneHourAgo)
        .count()
        .get();
      if (ipSnap.data().count > 3) {
        flags.push('ip_duplicate');
        penalty += 3;
      }
    }

    // ── 3. Device fingerprint: same fp, different names in 24 h ─────────────
    if (fpHash) {
      const fpSnap = await db.collection('alumni_leads')
        .where('fpHash', '==', fpHash)
        .where('createdAt', '>=', oneDayAgo)
        .limit(10)
        .get();

      const existingNames = new Set(fpSnap.docs.map(d => d.data().name?.toLowerCase()?.trim()));
      const incomingName = (name || '').toLowerCase().trim();
      if (existingNames.size > 0 && !existingNames.has(incomingName)) {
        flags.push('device_name_mismatch');
        penalty += 3;
      }
    }

    // ── 4. Name sanity ──────────────────────────────────────────────────────
    const nameTrimmed = (name || '').trim();
    if (!nameTrimmed || nameTrimmed.split(/\s+/).length < 2) {
      flags.push('suspicious_name');
      penalty += 2;
    }

    // ── 5. Batch year range ─────────────────────────────────────────────────
    if (batch) {
      const yr = parseInt(batch, 10);
      if (isNaN(yr) || yr < 1950 || yr > CURRENT_YEAR + 1) {
        flags.push('impossible_batch_year');
        penalty += 1;
      }
    }
  } catch (err) {
    // Fraud checks are best-effort — never block a submission
    console.error('[Alumni/Fraud] Assessment error:', err.message);
  }

  return { penalty, flags };
}

module.exports = { assessFraud };
