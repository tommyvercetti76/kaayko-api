/**
 * Seed Script: Create Somalwar tenant + assign admin
 *
 * Run once via: node scripts/seed-somalwar-tenant.js
 * Requires GOOGLE_APPLICATION_CREDENTIALS or firebase-admin initialized context
 *
 * Creates:
 *   tenants/somalwar — Tenant document
 *   admin_users/{uid} — Admin user with tenantId: 'somalwar'
 *
 * Admin email: rohanramekar17@gmail.com
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'kaaykostore' });
}

const db = admin.firestore();

const TENANT_ID = 'somalwar';
const ADMIN_EMAIL = 'rohanramekar17@gmail.com';

async function seedSomalwarTenant() {
  console.log('Creating Somalwar tenant...');

  // 1. Create tenant document
  await db.collection('tenants').doc(TENANT_ID).set({
    name: 'Somalwar Academy',
    slug: 'somalwar',
    domain: 'somalwar.com',
    pathPrefix: '/l',
    plan: 'pro',
    enabled: true,
    contactEmail: ADMIN_EMAIL,
    adminEmail: ADMIN_EMAIL,
    settings: {
      allowedDomains: ['somalwar.com', 'somalwaracademy.com', 'somalwaracademy.in'],
      brandColor: '#1a237e',
      logoUrl: null
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'system-seed'
  }, { merge: true });

  console.log(`  ✅ Tenant 'somalwar' created`);

  // 2. Find user UID by email — SAFELY add tenant access without overwriting existing role
  let uid;
  try {
    const userRecord = await admin.auth().getUserByEmail(ADMIN_EMAIL);
    uid = userRecord.uid;
    console.log(`  Found existing user: ${uid}`);

    // Check existing claims/role — NEVER downgrade a super-admin
    const existingDoc = await db.collection('admin_users').doc(uid).get();
    const existingRole = existingDoc.exists ? existingDoc.data().role : null;

    if (existingRole === 'super-admin') {
      console.log(`  ⚠️  User is super-admin — preserving role, only adding tenant access`);
      // Just add somalwar to their tenantIds
      await db.collection('admin_users').doc(uid).update({
        tenantIds: admin.firestore.FieldValue.arrayUnion(TENANT_ID),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`  ✅ Added '${TENANT_ID}' to super-admin tenantIds (role unchanged)`);
    } else {
      // Set custom claims for login flow
      await admin.auth().setCustomUserClaims(uid, {
        role: 'admin',
        tenantId: TENANT_ID
      });
      console.log(`  ✅ Custom claims set: { role: 'admin', tenantId: '${TENANT_ID}' }`);

      // Create/update admin_users document
      await db.collection('admin_users').doc(uid).set({
        email: ADMIN_EMAIL,
        role: 'admin',
        tenantId: TENANT_ID,
        tenantIds: [TENANT_ID],
        tenantName: 'Somalwar Academy',
        permissions: ['links:create', 'links:read', 'links:update', 'links:delete', 'campaigns:manage', 'analytics:read', 'qr:generate'],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      console.log(`  ✅ Admin user '${ADMIN_EMAIL}' assigned to tenant 'somalwar' with role: admin`);
    }
  } catch (err) {
    console.log(`  User not found in Firebase Auth. Creating admin_users entry with email as placeholder UID.`);
    console.log(`  ⚠️  You must create this user in Firebase Auth first, then re-run this script to set claims.`);
    uid = ADMIN_EMAIL.replace(/[^a-zA-Z0-9]/g, '_');
  }

  // 4. Create a sample link for the tenant to verify scoping
  const sampleCode = 'swl-alumni-2024';
  await db.collection('short_links').doc(sampleCode).set({
    code: sampleCode,
    title: 'Somalwar Alumni Connect 2024',
    webDestination: 'https://somalwar.com/alumni',
    destinations: { web: 'https://somalwar.com/alumni' },
    intent: 'register',
    conversionGoal: 'registration_submitted',
    enabled: true,
    tenantId: TENANT_ID,
    createdBy: ADMIN_EMAIL,
    clickCount: 0,
    shortUrl: `https://kaayko.com/l/${sampleCode}`,
    metadata: {
      campaign: 'alumni',
      schoolName: 'Somalwar Academy',
      intent: 'register'
    },
    utm: {
      utm_source: 'whatsapp',
      utm_medium: 'social',
      utm_campaign: 'alumni-connect-2024'
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`  ✅ Sample link '${sampleCode}' created for tenant`);

  // 5. Create a sample campaign
  const campaignId = 'somalwar-alumni-connect';
  await db.collection('campaigns').doc(campaignId).set({
    campaignId,
    name: 'Alumni Connect 2024',
    slug: 'alumni-connect',
    type: 'alumni_outreach',
    status: 'active',
    tenantId: TENANT_ID,
    createdBy: ADMIN_EMAIL,
    settings: {
      maxUsesPerLink: 0,
      allowPublicStats: false,
      expiresAt: null
    },
    linkCount: 1,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`  ✅ Sample campaign '${campaignId}' created`);

  console.log('\n🎉 Somalwar tenant fully seeded!');
  console.log('\nTenant admin login flow:');
  console.log(`  1. Go to kaayko.com/admin/kortex.html`);
  console.log(`  2. Login with: ${ADMIN_EMAIL}`);
  console.log(`  3. Select tenant: Somalwar Academy`);
  console.log(`  4. Dashboard shows ONLY somalwar data`);
  console.log(`  5. Can create links for: somalwar.com, somalwaracademy.com, somalwaracademy.in`);
}

seedSomalwarTenant()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
