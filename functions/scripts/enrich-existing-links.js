/**
 * Retroactive Enrichment Migration
 *
 * Backfills intent, destinationType, audience, source, conversionGoal,
 * and tenantId on all existing short_links that are missing these fields.
 *
 * Safe: uses merge writes, never overwrites existing enrichment values.
 *
 * Run: GOOGLE_CLOUD_PROJECT=kaaykostore node scripts/enrich-existing-links.js
 */

const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'kaaykostore' });
}
const db = admin.firestore();

function inferEnrichment(code, data) {
  const meta = data.metadata || {};
  const dest = String(data.destinations?.web || data.webDestination || '').toLowerCase();
  const title = String(data.title || '').toLowerCase();
  const campaign = meta.campaign || '';
  const utm = data.utm || {};

  const enrichment = {};

  // tenantId — backfill missing ones to kaayko-default
  if (!data.tenantId) {
    enrichment.tenantId = 'kaayko-default';
    enrichment.tenantName = 'Kaayko';
  }

  // intent
  if (!data.intent) {
    if (campaign === 'alumni' || dest.includes('/alumni')) {
      enrichment.intent = meta.isAdmin ? 'view' : 'register';
    } else if (dest.includes('/store') || title.includes('vip') || title.includes('valentine') || title.includes('specially')) {
      enrichment.intent = 'purchase';
    } else if (title.includes('psych') || title.includes('roots') || title.includes('assessment')) {
      enrichment.intent = 'survey';
    } else if (dest.includes('paddlingout') || dest.includes('paddling-out') || title.includes('lake') || title.includes('reservoir') || title.includes('park') || title.includes('trinity')) {
      enrichment.intent = 'view';
    } else if (dest.includes('/kreator') || title.includes('kreator') || title.includes('onboarding')) {
      enrichment.intent = 'apply';
    } else {
      enrichment.intent = 'view';
    }
  }

  // destinationType
  if (!data.destinationType) {
    if (campaign === 'alumni' || dest.includes('/alumni')) {
      enrichment.destinationType = 'alumni_form';
    } else if (dest.includes('/store') || dest.includes('store.html')) {
      enrichment.destinationType = 'store';
    } else if (title.includes('psych') || title.includes('roots') || title.includes('assessment')) {
      enrichment.destinationType = 'assessment';
    } else if (dest.includes('paddlingout') || dest.includes('paddling-out') || title.includes('lake')) {
      enrichment.destinationType = 'paddle_spot';
    } else if (dest.includes('/kreator')) {
      enrichment.destinationType = 'kreator_onboarding';
    } else {
      enrichment.destinationType = 'external_url';
    }
  }

  // audience
  if (!data.audience) {
    if (campaign === 'alumni' || dest.includes('/alumni')) {
      enrichment.audience = 'alumni';
    } else if (title.includes('vip')) {
      enrichment.audience = 'vip';
    } else if (title.includes('psych') || title.includes('roots') || title.includes('assessment')) {
      enrichment.audience = 'students';
    } else if (dest.includes('/kreator')) {
      enrichment.audience = 'creators';
    } else {
      enrichment.audience = 'public';
    }
  }

  // source
  if (!data.source) {
    if (utm.utm_source) {
      enrichment.source = String(utm.utm_source).toLowerCase();
    } else if (utm.source) {
      enrichment.source = String(utm.source).toLowerCase();
    } else if (data.createdBy === 'system' || data.createdBy === 'admin@kaayko.com') {
      enrichment.source = 'manual';
    } else {
      enrichment.source = 'manual';
    }
  }

  // conversionGoal
  if (!data.conversionGoal) {
    if (enrichment.intent === 'register' || data.intent === 'register') {
      enrichment.conversionGoal = 'registration_submitted';
    } else if (enrichment.intent === 'purchase' || data.intent === 'purchase') {
      enrichment.conversionGoal = 'order_placed';
    } else if (enrichment.intent === 'survey' || data.intent === 'survey') {
      enrichment.conversionGoal = 'assessment_completed';
    } else if (enrichment.intent === 'apply' || data.intent === 'apply') {
      enrichment.conversionGoal = 'application_submitted';
    } else {
      enrichment.conversionGoal = 'page_viewed';
    }
  }

  return enrichment;
}

async function run() {
  const snapshot = await db.collection('short_links').get();
  console.log(`Found ${snapshot.size} links to process\n`);

  let updated = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const enrichment = inferEnrichment(doc.id, data);

    if (Object.keys(enrichment).length === 0) {
      console.log(`  SKIP ${doc.id} — already enriched`);
      skipped++;
      continue;
    }

    enrichment.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await db.collection('short_links').doc(doc.id).update(enrichment);
    console.log(`  ✅ ${doc.id} — set: ${Object.keys(enrichment).filter(k => k !== 'updatedAt').join(', ')}`);
    updated++;
  }

  console.log(`\nDone: ${updated} enriched, ${skipped} already complete`);
}

run().then(() => process.exit(0)).catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
