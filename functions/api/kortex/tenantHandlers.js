/**
 * Tenant Route Handlers — registration, listing, migration
 * Extracted from tenantRoutes.js for primer compliance.
 *
 * @module api/kortex/tenantHandlers
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();

// ─── Admin Migration ───────────────────────────────────
async function migrate(req, res) {
  try {
    const { migrateExistingLinksToDefaultTenant } = require('./tenantContext');
    const result = await migrateExistingLinksToDefaultTenant();
    return res.json({ success: true, message: 'Migration completed successfully', result });
  } catch (error) {
    console.error('[SmartLinks] Migration error:', error);
    return res.status(500).json({ success: false, error: 'Migration failed', message: error.message });
  }
}

// ─── Tenant Registration ───────────────────────────────
async function register(req, res) {
  try {
    const registrationData = req.body;
    console.log('[TenantReg] New registration request:', registrationData.organization?.name);

    if (!registrationData.organization?.name || !registrationData.organization?.domain || !registrationData.contact?.email) {
      return res.status(400).json({ success: false, error: 'Missing required fields: organization name, domain, and contact email are required' });
    }

    const existingTenant = await db.collection('tenants').where('domain', '==', registrationData.organization.domain).limit(1).get();
    if (!existingTenant.empty) return res.status(409).json({ success: false, error: 'A tenant with this domain already exists' });

    const registrationRef = await db.collection('pending_tenant_registrations').add({
      ...registrationData, status: 'pending', submittedAt: FieldValue.serverTimestamp(),
      reviewedAt: null, reviewedBy: null, tenantId: null
    });

    console.log('[TenantReg] ✅ Stored registration:', registrationRef.id);
    return res.json({ success: true, message: 'Registration submitted successfully', registrationId: registrationRef.id, estimatedReviewTime: '24-48 hours' });
  } catch (error) {
    console.error('[TenantReg] Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to submit registration', message: error.message });
  }
}

// ─── List Tenants ──────────────────────────────────────
async function listTenants(req, res) {
  try {
    const profileDoc = await db.collection('admin_users').doc(req.user.uid).get();
    if (!profileDoc.exists) return res.status(404).json({ success: false, error: 'User profile not found' });

    const profile = profileDoc.data();
    const defaultTenant = [{ id: 'kaayko-default', name: 'Kaayko (Default)', domain: 'kaayko.com', pathPrefix: '/l' }];

    if (profile.role === 'super-admin') {
      const snap = await db.collection('tenants').where('enabled', '==', true).orderBy('name').get();
      const tenants = snap.docs.map(d => ({ id: d.id, name: d.data().name, domain: d.data().domain, pathPrefix: d.data().pathPrefix }));
      return res.json({ success: true, tenants: tenants.length > 0 ? tenants : defaultTenant });
    }

    const tenantId = profile.tenantId || 'kaayko-default';
    const tenantDoc = await db.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) return res.json({ success: true, tenants: defaultTenant });

    const t = tenantDoc.data();
    return res.json({ success: true, tenants: [{ id: tenantDoc.id, name: t.name, domain: t.domain, pathPrefix: t.pathPrefix }] });
  } catch (error) {
    console.error('[SmartLinks] Error fetching tenants:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch tenants', message: error.message });
  }
}

module.exports = { migrate, register, listTenants };
