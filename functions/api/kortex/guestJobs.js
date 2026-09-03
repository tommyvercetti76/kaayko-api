/**
 * Guest workspace housekeeping.
 *
 * A free workspace expires KORTEX_GUEST_LIFETIME_DAYS after its last check-in.
 * This job marks expired workspaces and disables their links with
 * `disabledReason: 'guest_expired'`; the next successful access-code entry
 * revives them (see guestAccess.verifyAccessCode). Nothing is deleted, so a
 * printed QR that was forgotten for a year comes straight back.
 *
 * @module api/kortex/guestJobs
 */

'use strict';

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { GUEST_KIND } = require('./guestAccess');
const { recordAudit } = require('./auditLog');

const db = admin.firestore();

async function disableWorkspaceLinks(tenantId) {
  const snapshot = await db.collection('short_links')
    .where('tenantId', '==', tenantId)
    .where('enabled', '==', true)
    .limit(500)
    .get();
  if (snapshot.empty) return 0;
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.update(doc.ref, {
    enabled: false,
    disabledReason: 'guest_expired',
    updatedAt: FieldValue.serverTimestamp()
  }));
  await batch.commit();
  return snapshot.size;
}

/**
 * Expire guest workspaces whose renewal deadline has passed.
 * @param {Object} options
 * @param {number} [options.limit=200]
 * @param {number} [options.nowMs]
 */
async function expireGuestWorkspaces({ limit = 200, nowMs = Date.now() } = {}) {
  const snapshot = await db.collection('tenants')
    .where('kind', '==', GUEST_KIND)
    .where('guest.expiresAtMs', '<', nowMs)
    .limit(Math.max(1, Math.min(Number(limit) || 200, 500)))
    .get();

  const result = { checked: snapshot.size, expired: 0, linksDisabled: 0, ranAt: new Date(nowMs).toISOString() };

  for (const doc of snapshot.docs) {
    const tenant = doc.data() || {};
    const guestInfo = tenant.guest || {};
    // Defensive re-check: the in-memory test double ignores range filters.
    if (guestInfo.expired === true || !(guestInfo.expiresAtMs < nowMs)) continue;
    try {
      const linksDisabled = await disableWorkspaceLinks(doc.id);
      await doc.ref.update({
        'guest.expired': true,
        'guest.expiredAtMs': nowMs,
        updatedAt: FieldValue.serverTimestamp()
      });
      result.expired++;
      result.linksDisabled += linksDisabled;
      recordAudit({ actor: { name: 'guest-housekeeping' }, action: 'guest.expired', tenantId: doc.id, extra: { linksDisabled } });
    } catch (error) {
      console.error(`[GuestHousekeeping] ${doc.id} failed:`, error.message);
    }
  }

  return result;
}

module.exports = { expireGuestWorkspaces, disableWorkspaceLinks };
