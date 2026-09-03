/**
 * Self-serve tenant provisioning.
 *
 * Flow (landing page → API):
 *   1. Browser creates the Firebase Auth user (email + password) and sends the
 *      ID token to POST /kortex/tenants/provision with the organisation name.
 *   2. This module creates the tenant row, the admin_users profile and the
 *      custom claims that the login page and the SPA read.
 *   3. Browser sends the verification email through Firebase; writes stay
 *      gated by `requireVerifiedEmail` until the address is confirmed.
 *
 * Idempotent: calling it again for a user that already owns a tenant returns
 * that tenant instead of creating a second one, so a browser that lost the
 * response can safely retry at next login.
 *
 * @module api/kortex/provisioning
 */

'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');
const { recordAudit } = require('./auditLog');
const { isFreemailDomain } = require('./destinationSafety');

const db = admin.firestore();

const ORG_MIN = 2;
const ORG_MAX = 80;
const RESERVED_SLUGS = new Set([
  'kaayko', 'kaayko-default', 'admin', 'api', 'kortex', 'alumni', 'roots', 'store', 'login',
  'register', 'health', 'l', 'a', 'public', 'billing', 'campaigns', 'www', 'app', 'support'
]);

function slugify(value) {
  const slug = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'org';
}

function randomSuffix(length = 4) {
  return crypto.randomBytes(4).toString('base64url').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, length).padEnd(length, 'x');
}

function hashForStorage(value) {
  if (!value) return null;
  const salt = process.env.KORTEX_IP_SALT || 'kortex-ip-salt';
  return crypto.createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 16);
}

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

async function uniqueTenantId(base) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = `${base}-${randomSuffix(attempt < 3 ? 4 : 6)}`;
    if (RESERVED_SLUGS.has(candidate)) continue;
    const existing = await db.collection('tenants').doc(candidate).get();
    if (!existing.exists) return candidate;
  }
  throw new Error('Could not allocate a tenant id');
}

/**
 * Create a starter tenant for a freshly signed-up Firebase user.
 *
 * @param {Object} params
 * @param {string} params.uid
 * @param {string} params.email
 * @param {boolean} params.emailVerified
 * @param {string} [params.displayName]
 * @param {string} params.organization
 * @param {string} [params.useCase]
 * @param {import('express').Request} [params.req]
 */
async function provisionSelfServeTenant(params) {
  const { uid, email, emailVerified = false, displayName = '', organization, useCase = '', req = null } = params || {};

  if (!uid || !email) throw validationError('An authenticated user with an email address is required');
  const org = String(organization || '').trim();
  if (org.length < ORG_MIN || org.length > ORG_MAX) {
    throw validationError(`Organisation name must be between ${ORG_MIN} and ${ORG_MAX} characters`);
  }
  const name = String(displayName || '').trim().slice(0, 80);
  const useCaseClean = String(useCase || '').trim().slice(0, 80);
  const emailLower = String(email).toLowerCase().trim();
  const emailDomain = emailLower.split('@')[1] || '';

  // Idempotency: an existing admin profile with a tenant wins.
  const profileRef = db.collection('admin_users').doc(uid);
  const existingProfile = await profileRef.get();
  if (existingProfile.exists) {
    const profile = existingProfile.data() || {};
    const tenantId = profile.tenantId || (Array.isArray(profile.tenantIds) ? profile.tenantIds[0] : null);
    if (tenantId) {
      const tenantDoc = await db.collection('tenants').doc(tenantId).get();
      const tenant = tenantDoc.exists ? tenantDoc.data() : { id: tenantId, name: profile.tenantName || tenantId, plan: 'starter' };
      return {
        existing: true,
        tenant: { id: tenantId, slug: tenant.slug || tenantId, name: tenant.name || tenantId, plan: tenant.plan || 'starter' },
        user: { uid, role: profile.role || 'admin', requireEmailVerification: profile.requireEmailVerification === true }
      };
    }
  }

  const tenantId = await uniqueTenantId(slugify(org));
  const trustedDomains = emailDomain && !isFreemailDomain(emailDomain) ? [emailDomain] : [];
  const now = admin.firestore.FieldValue.serverTimestamp();
  const nowMs = Date.now();

  const tenantDoc = {
    id: tenantId,
    slug: tenantId,
    kind: 'account',
    name: org,
    domain: 'kaayko.com',
    pathPrefix: '/l',
    linkNamespace: 'kaayko',
    plan: 'starter',
    enabled: true,
    provisionedVia: 'self-serve',
    useCase: useCaseClean || null,
    contact: { name: name || null, email: emailLower },
    trustedDomains,
    settings: { reviewUnknownDomains: null },
    createdBy: uid,
    createdAt: now,
    createdAtMs: nowMs,
    updatedAt: now
  };

  const profileDoc = {
    uid,
    email: emailLower,
    displayName: name || emailLower.split('@')[0],
    role: 'admin',
    tenantId,
    tenantIds: [tenantId],
    tenantName: org,
    permissions: [],
    provisionedVia: 'self-serve',
    requireEmailVerification: true,
    emailVerifiedAtSignup: emailVerified === true,
    signupIpHash: req ? hashForStorage(require('./clientIp').getClientIp(req)) : null,
    createdAt: now,
    updatedAt: now
  };

  const batch = db.batch();
  batch.set(db.collection('tenants').doc(tenantId), tenantDoc);
  batch.set(profileRef, profileDoc);
  await batch.commit();

  // Custom claims: merge so unrelated claims (e.g. kreator) survive.
  try {
    let existingClaims = {};
    try {
      const authUser = await admin.auth().getUser(uid);
      existingClaims = authUser?.customClaims || {};
    } catch (_) { /* new user: no claims */ }
    await admin.auth().setCustomUserClaims(uid, { ...existingClaims, role: 'admin', tenantId });
  } catch (error) {
    console.error('[Provisioning] setCustomUserClaims failed:', error.message);
  }

  await recordAudit({
    req,
    action: 'tenant.provisioned',
    tenantId,
    after: { name: org, plan: 'starter', trustedDomains },
    extra: { uid, email: emailLower, useCase: useCaseClean || null, provisionedVia: 'self-serve' }
  });

  return {
    existing: false,
    tenant: { id: tenantId, slug: tenantId, name: org, plan: 'starter' },
    user: { uid, role: 'admin', requireEmailVerification: true }
  };
}

module.exports = { provisionSelfServeTenant, slugify, RESERVED_SLUGS };
