#!/usr/bin/env node
/**
 * Seed Firestore Emulator with production-realistic data
 *
 * Usage:
 *   1. Start emulators:  firebase emulators:start --only functions,firestore,auth
 *   2. Run this script:  node scripts/seed-emulator.js
 *
 * Seeds all key collections so you can manually test every frontend page:
 *   - Store page:      products in kaaykoproducts
 *   - Paddling Out:    spots in paddlingOutSpots
 *   - Admin panel:     admin_users, short_links, tenants
 *   - Kreator portal:  kreator_applications, kreators
 *   - Checkout flow:   payment_intents, orders
 */

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8081';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'kaaykostore' });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

async function seed() {
  console.log('🌱 Seeding Firestore emulator with test data...\n');

  // ─── Products (store page) ───────────────────────────────────────
  const products = [
    {
      productID: 'prod_paddle_001',
      title: 'Handcrafted Maple Paddle',
      description: 'A beautiful hand-finished maple canoe paddle. Perfect for flatwater paddling.',
      price: '$$',
      actualPrice: 29.99,
      votes: 42,
      tags: ['paddle', 'handcrafted', 'maple', 'flatwater'],
      availableColors: ['natural', 'walnut', 'cherry'],
      availableSizes: ['52"', '54"', '56"'],
      maxQuantity: 5,
      stockQuantity: 25,
      imgSrc: ['https://placehold.co/600x400/2d5016/white?text=Maple+Paddle'],
      isAvailable: true,
      category: 'paddles',
      kreatorId: 'kreator_uid_001',
      storeName: 'Paddle Craft Co',
      storeSlug: 'paddle-craft-co',
      sellerEmail: 'jane@paddlecraft.co',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    },
    {
      productID: 'prod_jersey_002',
      title: 'Kaayko River Jersey',
      description: 'Quick-dry performance jersey with UV protection. Built for long days on the water.',
      price: '$$',
      actualPrice: 34.99,
      votes: 28,
      tags: ['apparel', 'jersey', 'UV protection', 'quick-dry'],
      availableColors: ['ocean blue', 'forest green', 'sunset orange'],
      availableSizes: ['S', 'M', 'L', 'XL'],
      maxQuantity: 3,
      stockQuantity: 50,
      imgSrc: ['https://placehold.co/600x400/1a3a5c/white?text=River+Jersey'],
      isAvailable: true,
      category: 'apparel',
      kreatorId: 'kreator_uid_001',
      storeName: 'Paddle Craft Co',
      storeSlug: 'paddle-craft-co',
      sellerEmail: 'jane@paddlecraft.co',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    },
    {
      productID: 'prod_cap_003',
      title: 'Kayak Life Cap',
      description: 'Lightweight mesh-back cap with embroidered paddle logo. One size fits all.',
      price: '$',
      actualPrice: 18.99,
      votes: 65,
      tags: ['cap', 'hat', 'accessories'],
      availableColors: ['navy', 'olive', 'khaki'],
      availableSizes: ['OS'],
      maxQuantity: 10,
      stockQuantity: 100,
      imgSrc: ['https://placehold.co/600x400/4a6741/white?text=Kayak+Cap'],
      isAvailable: true,
      category: 'accessories',
      kreatorId: 'kreator_uid_002',
      storeName: 'River Gear Co',
      storeSlug: 'river-gear-co',
      sellerEmail: 'alice@rivergear.co',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }
  ];

  for (const p of products) {
    await db.collection('kaaykoproducts').doc(p.productID).set(p);
  }
  console.log(`✅ kaaykoproducts: ${products.length} products`);

  // ─── Paddling Out Spots ──────────────────────────────────────────
  const spots = [
    {
      id: 'spot_001', name: 'Willamette River - Portland', type: 'river',
      lat: 45.5152, lng: -122.6784, difficulty: 'beginner',
      description: 'Calm flatwater section perfect for beginners. Easy launch from Sellwood Bridge.',
      amenities: ['parking', 'restrooms', 'boat_launch'],
      imageUrl: 'https://placehold.co/600x400/2563eb/white?text=Willamette'
    },
    {
      id: 'spot_002', name: 'Lake Oswego - George Rogers Park', type: 'lake',
      lat: 45.4060, lng: -122.7282, difficulty: 'beginner',
      description: 'Peaceful lake paddle with mountain views. Sheltered from wind.',
      amenities: ['parking', 'picnic_area'],
      imageUrl: 'https://placehold.co/600x400/0891b2/white?text=Lake+Oswego'
    },
    {
      id: 'spot_003', name: 'Deschutes River - Bend', type: 'river',
      lat: 44.0582, lng: -121.3153, difficulty: 'intermediate',
      description: 'Class II rapids with scenic canyon walls. Float section available.',
      amenities: ['parking', 'camping', 'restrooms'],
      imageUrl: 'https://placehold.co/600x400/d97706/white?text=Deschutes'
    }
  ];

  for (const s of spots) {
    await db.collection('paddlingOutSpots').doc(s.id).set(s);
  }
  console.log(`✅ paddlingOutSpots: ${spots.length} spots`);

  // ─── Admin Users ─────────────────────────────────────────────────
  // Create Firebase Auth user for admin
  try {
    await admin.auth().createUser({
      uid: 'super-admin-uid',
      email: 'admin@kaayko.com',
      password: 'testpassword123',
      emailVerified: true,
      displayName: 'Test Super Admin'
    });
    console.log('✅ Firebase Auth: super-admin user created (admin@kaayko.com / testpassword123)');
  } catch (e) {
    if (e.code === 'auth/uid-already-exists') console.log('ℹ️  Firebase Auth: super-admin already exists');
    else console.error('⚠️  Auth create failed:', e.message);
  }

  await db.collection('admin_users').doc('super-admin-uid').set({
    uid: 'super-admin-uid',
    email: 'admin@kaayko.com',
    displayName: 'Test Super Admin',
    role: 'super-admin',
    permissions: ['*'],
    metadata: { isFirstAdmin: true, createdVia: 'seed-script', environment: 'local' },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastLoginAt: null,
    enabled: true
  });
  console.log('✅ admin_users: super-admin seeded');

  // ─── Tenants ─────────────────────────────────────────────────────
  await db.collection('tenants').doc('kaayko-default').set({
    name: 'Kaayko', domain: 'kaayko.com', pathPrefix: '/l',
    enabled: true, plan: 'starter', subscriptionStatus: 'active',
    stripeCustomerId: null, stripeSubscriptionId: null,
    currentPeriodEnd: null, scheduledDowngrade: null,
    updatedAt: FieldValue.serverTimestamp()
  });
  console.log('✅ tenants: kaayko-default seeded');

  // ─── Short Links (for admin panel) ──────────────────────────────
  const links = [
    {
      code: 'lk1ngp', shortUrl: 'https://kaayko.com/l/lk1ngp',
      qrCodeUrl: 'https://kaayko.com/qr/lk1ngp.png',
      tenantId: 'kaayko-default', tenantName: 'Kaayko',
      domain: 'kaayko.com', pathPrefix: '/l', apiKeyId: null,
      destinations: { ios: 'https://apps.apple.com/app/kaayko/id123', android: 'https://play.google.com/store/apps/details?id=com.kaayko', web: 'https://kaayko.com/store' },
      title: 'Summer Sale', description: 'Summer collection promo',
      metadata: { campaign: 'summer2025' },
      utm: { utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'summer2025' },
      expiresAt: Timestamp.fromDate(new Date('2026-12-31')),
      clickCount: 147, installCount: 23, uniqueUsers: [],
      lastClickedAt: Timestamp.fromDate(new Date('2025-06-15')),
      lastInstallAt: Timestamp.fromDate(new Date('2025-06-10')),
      enabled: true, createdBy: 'admin@kaayko.com',
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    },
    {
      code: 'lk9xrf', shortUrl: 'https://kaayko.com/l/lk9xrf',
      qrCodeUrl: 'https://kaayko.com/qr/lk9xrf.png',
      tenantId: 'kaayko-default', tenantName: 'Kaayko',
      domain: 'kaayko.com', pathPrefix: '/l', apiKeyId: null,
      destinations: { web: 'https://kaayko.com/paddlingout' },
      title: 'Paddling Guide', description: 'Link to paddling spots page',
      metadata: {}, utm: {},
      expiresAt: null,
      clickCount: 52, installCount: 0, uniqueUsers: [],
      lastClickedAt: Timestamp.fromDate(new Date('2025-07-01')),
      lastInstallAt: null,
      enabled: true, createdBy: 'admin@kaayko.com',
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    }
  ];

  for (const l of links) {
    await db.collection('short_links').doc(l.code).set(l);
  }
  console.log(`✅ short_links: ${links.length} links`);

  // ─── Kreator Application (for kreator admin review) ──────────────
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await db.collection('kreator_applications').doc('app_SEED00001').set({
    id: 'app_SEED00001', applicationType: 'seller',
    firstName: 'Marcus', lastName: 'Rivera',
    displayName: 'Marcus Rivera', email: 'marcus@riverpaddles.com',
    phone: '+15039876543', businessName: 'River Paddles LLC',
    brandName: 'River Paddles LLC', businessType: 'llc',
    website: 'https://riverpaddles.com',
    productCategories: ['paddles', 'kayaks'],
    productDescription: 'Premium handcrafted river paddles and custom touring kayaks, built in Portland Oregon with locally sourced Pacific Northwest wood.',
    productCount: '25-50', priceRange: '$100-$500',
    location: 'Portland, OR', shippingCapability: 'nationwide',
    fulfillmentTime: '7-10 business days', inventoryManagement: 'spreadsheet',
    socialMedia: '@riverpaddles', referralSource: 'word_of_mouth',
    additionalInfo: null,
    consent: { termsAccepted: true, authenticityConfirmed: true, dataProcessingConsent: true, consentTimestamp: new Date().toISOString() },
    locale: 'en-US', status: 'pending',
    reviewedBy: null, reviewedAt: null, reviewNotes: null,
    rejectionReason: null, kreatorId: null, magicLinkCode: null,
    submittedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt),
    submittedFromIp: '10.0.0.1', submittedUserAgent: 'Mozilla/5.0'
  });
  console.log('✅ kreator_applications: 1 pending application');

  // ─── Kreator (active, for kreator portal) ────────────────────────
  try {
    await admin.auth().createUser({
      uid: 'kreator_uid_001',
      email: 'jane@paddlecraft.co',
      password: 'kreatorpass123',
      emailVerified: true,
      displayName: 'Jane Doe'
    });
    console.log('✅ Firebase Auth: kreator user created (jane@paddlecraft.co / kreatorpass123)');
  } catch (e) {
    if (e.code === 'auth/uid-already-exists') console.log('ℹ️  Firebase Auth: kreator already exists');
    else console.error('⚠️  Auth create failed:', e.message);
  }

  await db.collection('kreators').doc('kreator_uid_001').set({
    uid: 'kreator_uid_001', email: 'jane@paddlecraft.co',
    firstName: 'Jane', lastName: 'Doe', displayName: 'Jane Doe',
    brandName: 'Paddle Craft Co', businessName: 'Paddle Craft Co',
    businessType: 'sole_proprietor', phone: '+15551234567',
    website: 'https://paddlecraft.co', productCategories: ['paddles', 'accessories'],
    location: 'Portland, OR', avatarUrl: null, bio: 'Handcrafting paddles since 2018',
    authProviders: ['password'], passwordSetAt: Timestamp.fromDate(new Date()),
    googleConnectedAt: null,
    status: 'active', verificationStatus: 'verified',
    permissions: ['products:create', 'products:read', 'products:update', 'products:delete'],
    plan: 'kreator-free', planLimits: { productsAllowed: 50, monthlyOrders: 100 },
    stats: { totalProducts: 2, totalOrders: 5, totalRevenue: 249.95, lastProductCreatedAt: null },
    applicationId: 'app_APPROVED01', approvedBy: 'super-admin-uid',
    approvedAt: FieldValue.serverTimestamp(),
    consent: { termsAccepted: true, authenticityConfirmed: true, dataProcessingConsent: true, consentTimestamp: '2025-01-15T10:00:00.000Z' },
    locale: 'en-US',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    lastLoginAt: null, lastActivityAt: null,
    deletedAt: null, deletedBy: null
  });
  console.log('✅ kreators: active kreator seeded');

  // ─── Orders (for admin order management) ─────────────────────────
  const piId = 'pi_seed_completed_001';
  const paidAt = new Date().toISOString();

  await db.collection('payment_intents').doc(piId).set({
    paymentIntentId: piId, totalAmount: 4899, totalAmountFormatted: '$48.99',
    currency: 'usd', itemCount: 2,
    status: 'succeeded', paymentStatus: 'succeeded', fulfillmentStatus: 'processing',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    paidAt, fulfilledAt: null, cancelledAt: null, amount: 4899,
    items: [
      { productId: 'prod_paddle_001', productTitle: 'Handcrafted Maple Paddle', size: '54"', gender: 'Unisex', price: '$29.99', priceInCents: 2999 },
      { productId: 'prod_cap_003', productTitle: 'Kayak Life Cap', size: 'OS', gender: 'Unisex', price: '$18.99', priceInCents: 1899 }
    ],
    customerEmail: 'buyer@example.com', customerPhone: null,
    dataRetentionConsent: true,
    statusHistory: [
      { status: 'created', timestamp: '2025-06-01T10:00:00.000Z', note: 'Payment intent created' },
      { status: 'succeeded', timestamp: paidAt, note: 'Payment successful' }
    ]
  });

  await db.collection('orders').doc(`${piId}_item1`).set({
    orderId: `${piId}_item1`, parentOrderId: piId, itemIndex: 1, totalItems: 2,
    productId: 'prod_paddle_001', productTitle: 'Handcrafted Maple Paddle', size: '54"', gender: 'Unisex', price: '$29.99',
    totalAmount: 4899, currency: 'usd',
    orderStatus: 'processing', fulfillmentStatus: 'processing', paymentStatus: 'paid',
    createdAt: '2025-06-01T10:00:00.000Z', updatedAt: paidAt, paidAt,
    processedAt: null, shippedAt: null, deliveredAt: null, returnedAt: null,
    trackingNumber: null, carrier: null, trackingUrl: null, estimatedDelivery: null,
    customerEmail: 'buyer@example.com', customerPhone: null,
    shippingAddress: { name: 'Alex Johnson', line1: '789 River Road', line2: null, city: 'Portland', state: 'OR', postal_code: '97201', country: 'US' },
    dataRetentionConsent: true, paymentMethod: 'card',
    statusHistory: [
      { status: 'pending', timestamp: '2025-06-01T10:00:00.000Z', note: 'Order created' },
      { status: 'paid', timestamp: paidAt, note: 'Payment successful' },
      { status: 'processing', timestamp: paidAt, note: 'Processing started' }
    ],
    internalNotes: [], customerNotes: null
  });

  await db.collection('orders').doc(`${piId}_item2`).set({
    orderId: `${piId}_item2`, parentOrderId: piId, itemIndex: 2, totalItems: 2,
    productId: 'prod_cap_003', productTitle: 'Kayak Life Cap', size: 'OS', gender: 'Unisex', price: '$18.99',
    totalAmount: 4899, currency: 'usd',
    orderStatus: 'shipped', fulfillmentStatus: 'processing', paymentStatus: 'paid',
    createdAt: '2025-06-01T10:00:00.000Z', updatedAt: paidAt, paidAt,
    processedAt: paidAt, shippedAt: paidAt, deliveredAt: null, returnedAt: null,
    trackingNumber: '9400111899223456789012', carrier: 'USPS',
    trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223456789012',
    estimatedDelivery: '2025-06-10',
    customerEmail: 'buyer@example.com', customerPhone: null,
    shippingAddress: { name: 'Alex Johnson', line1: '789 River Road', line2: null, city: 'Portland', state: 'OR', postal_code: '97201', country: 'US' },
    dataRetentionConsent: true, paymentMethod: 'card',
    statusHistory: [
      { status: 'pending', timestamp: '2025-06-01T10:00:00.000Z', note: 'Order created' },
      { status: 'paid', timestamp: paidAt, note: 'Payment successful' },
      { status: 'processing', timestamp: paidAt, note: 'Processing started' },
      { status: 'shipped', timestamp: paidAt, note: 'Shipped via USPS' }
    ],
    internalNotes: [{ note: 'Priority shipping requested', timestamp: paidAt, author: 'admin' }],
    customerNotes: null
  });
  console.log('✅ payment_intents + orders: 1 payment, 2 order items');

  // ─── Forecast Cache (for weather pages) ──────────────────────────
  await db.collection('forecast_cache').doc('loc_portland').set({
    location_id: 'loc_portland',
    forecast: {
      location: { name: 'Portland', region: 'Oregon', lat: 45.52, lng: -122.68 },
      current: { temp_f: 72, condition: 'Partly Cloudy', wind_mph: 8, wind_dir: 'NW', humidity: 55 },
      forecast: { forecastday: [{ date: '2025-06-15', day: { maxtemp_f: 78, mintemp_f: 58, condition: { text: 'Sunny' } } }] }
    },
    cached_at: FieldValue.serverTimestamp(),
    ttl_hours: 3.5
  });
  console.log('✅ forecast_cache: Portland forecast cached');

  console.log('\n🎉 Seeding complete! All collections populated.\n');
  console.log('📋 Test Credentials:');
  console.log('   Admin:   admin@kaayko.com / testpassword123');
  console.log('   Kreator: jane@paddlecraft.co / kreatorpass123');
  console.log('\n🌐 Open http://localhost:5500 to test the frontend\n');

  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
