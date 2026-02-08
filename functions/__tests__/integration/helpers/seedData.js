/**
 * Production-Realistic Seed Data
 *
 * Every factory produces documents that EXACTLY match the shapes
 * found in production Firestore. Used to validate that refactored
 * handlers can read/write real data without corruption.
 *
 * Source: Handler source code + ORDER_DATA_STRUCTURE.md + Firestore rules/indexes
 */

const admin = require('firebase-admin');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');

// ─── Helpers ───────────────────────────────────────────────────────

const ts = (dateStr) => Timestamp.fromDate(new Date(dateStr || Date.now()));
const now = () => new Date().toISOString();
const serverTs = () => FieldValue.serverTimestamp();

// ─── PAYMENT_INTENTS ───────────────────────────────────────────────

function paymentIntent(overrides = {}) {
  const id = overrides.id || 'pi_test_abc123';
  return {
    paymentIntentId: id,
    totalAmount: 3500,
    totalAmountFormatted: '$35.00',
    currency: 'usd',
    itemCount: 2,
    status: 'created',
    paymentStatus: 'pending',
    fulfillmentStatus: 'awaiting_payment',
    createdAt: serverTs(),
    updatedAt: serverTs(),
    paidAt: null,
    fulfilledAt: null,
    cancelledAt: null,
    items: [
      { productId: 'prod_001', productTitle: 'Paddle Jersey', size: 'M', gender: 'Men', price: '$20.00', priceInCents: 2000 },
      { productId: 'prod_002', productTitle: 'Kayak Cap', size: 'OS', gender: 'Unisex', price: '$15.00', priceInCents: 1500 }
    ],
    customerEmail: 'customer@test.com',
    customerPhone: null,
    dataRetentionConsent: true,
    statusHistory: [
      { status: 'created', timestamp: now(), note: 'Payment intent created' }
    ],
    ...overrides
  };
}

function succeededPaymentIntent(overrides = {}) {
  const paidTime = now();
  return paymentIntent({
    id: 'pi_test_succeeded_001',
    status: 'succeeded',
    paymentStatus: 'succeeded',
    fulfillmentStatus: 'processing',
    paidAt: paidTime,
    amount: 3500,
    statusHistory: [
      { status: 'created', timestamp: '2025-01-01T00:00:00.000Z', note: 'Payment intent created' },
      { status: 'succeeded', timestamp: paidTime, note: 'Payment successful' }
    ],
    ...overrides
  });
}

function failedPaymentIntent(overrides = {}) {
  const failTime = now();
  return paymentIntent({
    id: 'pi_test_failed_001',
    status: 'failed',
    paymentStatus: 'failed',
    fulfillmentStatus: 'cancelled',
    failedAt: failTime,
    cancelledAt: failTime,
    errorMessage: 'Your card was declined.',
    statusHistory: [
      { status: 'created', timestamp: '2025-01-01T00:00:00.000Z', note: 'Payment intent created' },
      { status: 'failed', timestamp: failTime, note: 'Payment failed' }
    ],
    ...overrides
  });
}

// ─── ORDERS ────────────────────────────────────────────────────────

function order(overrides = {}) {
  const piId = overrides.parentOrderId || 'pi_test_succeeded_001';
  const idx = overrides.itemIndex || 1;
  const orderId = overrides.orderId || `${piId}_item${idx}`;

  return {
    orderId,
    parentOrderId: piId,
    itemIndex: idx,
    totalItems: 2,
    productId: 'prod_001',
    productTitle: 'Paddle Jersey',
    size: 'M',
    gender: 'Men',
    price: '$20.00',
    totalAmount: 3500,
    currency: 'usd',
    orderStatus: 'pending',
    fulfillmentStatus: 'processing',
    paymentStatus: 'paid',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: now(),
    paidAt: now(),
    processedAt: null,
    shippedAt: null,
    deliveredAt: null,
    returnedAt: null,
    trackingNumber: null,
    carrier: null,
    trackingUrl: null,
    estimatedDelivery: null,
    customerEmail: 'customer@test.com',
    customerPhone: null,
    shippingAddress: {
      name: 'John Doe',
      line1: '123 Paddle Lane',
      line2: null,
      city: 'Portland',
      state: 'OR',
      postal_code: '97201',
      country: 'US'
    },
    dataRetentionConsent: true,
    paymentMethod: 'card',
    statusHistory: [
      { status: 'pending', timestamp: '2025-01-01T00:00:00.000Z', note: 'Order created' },
      { status: 'paid', timestamp: now(), note: 'Payment successful' },
      { status: 'processing', timestamp: now(), note: 'Order processing started' }
    ],
    internalNotes: [],
    customerNotes: null,
    ...overrides
  };
}

function shippedOrder(overrides = {}) {
  const shipTime = now();
  return order({
    orderId: 'pi_test_shipped_001_item1',
    orderStatus: 'shipped',
    shippedAt: shipTime,
    trackingNumber: '9400111899223456789012',
    carrier: 'USPS',
    trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223456789012',
    estimatedDelivery: '2025-02-10',
    statusHistory: [
      { status: 'pending', timestamp: '2025-01-01T00:00:00.000Z', note: 'Order created' },
      { status: 'paid', timestamp: '2025-01-01T00:01:00.000Z', note: 'Payment successful' },
      { status: 'processing', timestamp: '2025-01-01T00:01:00.000Z', note: 'Order processing started' },
      { status: 'shipped', timestamp: shipTime, note: 'Shipped via USPS' }
    ],
    ...overrides
  });
}

// ─── SHORT_LINKS ───────────────────────────────────────────────────

function shortLink(overrides = {}) {
  return {
    code: 'lkTest1',
    shortUrl: 'https://kaayko.com/l/lkTest1',
    qrCodeUrl: 'https://kaayko.com/qr/lkTest1.png',
    tenantId: 'kaayko-default',
    tenantName: 'Kaayko',
    domain: 'kaayko.com',
    pathPrefix: '/l',
    apiKeyId: null,
    destinations: {
      ios: 'https://apps.apple.com/app/kaayko/id123',
      android: 'https://play.google.com/store/apps/details?id=com.kaayko',
      web: 'https://kaayko.com/store'
    },
    title: 'Summer Sale Link',
    description: 'Promo for summer collection',
    metadata: { campaign: 'summer2025' },
    utm: { utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'summer2025' },
    expiresAt: Timestamp.fromDate(new Date('2026-12-31')),
    clickCount: 42,
    installCount: 7,
    uniqueUsers: [],
    lastClickedAt: ts('2025-06-01'),
    lastInstallAt: ts('2025-05-28'),
    enabled: true,
    createdBy: 'admin@kaayko.com',
    createdAt: serverTs(),
    updatedAt: serverTs(),
    ...overrides
  };
}

function disabledLink(overrides = {}) {
  return shortLink({ code: 'lkDisab', enabled: false, clickCount: 0, ...overrides });
}

function expiredLink(overrides = {}) {
  return shortLink({
    code: 'lkExpir',
    expiresAt: Timestamp.fromDate(new Date('2024-01-01')),
    ...overrides
  });
}

function abTestLink(overrides = {}) {
  return shortLink({
    code: 'lkABTst',
    destinations: {
      ios: [
        { url: 'https://apps.apple.com/app/kaayko/id123', weight: 70, label: 'App Store' },
        { url: 'https://kaayko.com/ios-landing', weight: 30, label: 'Landing Page' }
      ],
      android: 'https://play.google.com/store/apps/details?id=com.kaayko',
      web: 'https://kaayko.com/store'
    },
    ...overrides
  });
}

function magicLink(overrides = {}) {
  return shortLink({
    code: 'lkMagic',
    type: 'magic_link',
    tokenHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    tokenSalt: 'salt123abc',
    destinations: { web: 'https://kaayko.com/kreator/onboard' },
    metadata: {
      purpose: 'kreator_onboarding',
      targetEmail: 'newkreator@test.com',
      targetKreatorId: 'kreator_uid_001',
      applicationId: 'app_TEST00001',
      singleUse: true,
      usedAt: null,
      usedFromIp: null,
      usedUserAgent: null,
      createdByAdmin: 'super-admin-uid'
    },
    ...overrides
  });
}

// ─── ADMIN_USERS ───────────────────────────────────────────────────

function adminUser(overrides = {}) {
  return {
    uid: 'admin-uid-001',
    email: 'admin@kaayko.com',
    displayName: 'Admin User',
    role: 'admin',
    permissions: ['smartlinks:create', 'smartlinks:read', 'smartlinks:update', 'smartlinks:delete', 'analytics:read', 'qr:create'],
    metadata: {
      createdBy: 'super-admin-uid',
      createdByEmail: 'super@kaayko.com',
      environment: 'production',
      isFirstAdmin: false,
      createdVia: 'admin_panel'
    },
    createdAt: serverTs(),
    updatedAt: serverTs(),
    lastLoginAt: null,
    enabled: true,
    ...overrides
  };
}

function superAdmin(overrides = {}) {
  return adminUser({
    uid: 'super-admin-uid',
    email: 'super@kaayko.com',
    displayName: 'Super Admin',
    role: 'super-admin',
    permissions: ['*'],
    metadata: {
      isFirstAdmin: true,
      createdVia: 'initialization',
      environment: 'production'
    },
    ...overrides
  });
}

// ─── KREATOR_APPLICATIONS ──────────────────────────────────────────

function kreatorApplication(overrides = {}) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  return {
    id: 'app_TEST00001',
    applicationType: 'seller',
    firstName: 'Jane',
    lastName: 'Doe',
    displayName: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: '+15551234567',
    businessName: 'Paddle Craft Co',
    brandName: 'Paddle Craft Co',
    businessType: 'sole_proprietor',
    website: 'https://paddlecraft.co',
    productCategories: ['paddles', 'accessories'],
    productDescription: 'Handcrafted wooden paddles for kayaking and canoeing enthusiasts. Each paddle is made from sustainably sourced hardwood.',
    productCount: '10-25',
    priceRange: '$50-$200',
    location: 'Portland, OR',
    shippingCapability: 'nationwide',
    fulfillmentTime: '5-7 business days',
    inventoryManagement: 'manual',
    socialMedia: '@paddlecraft',
    referralSource: 'instagram',
    additionalInfo: null,
    consent: {
      termsAccepted: true,
      authenticityConfirmed: true,
      dataProcessingConsent: true,
      consentTimestamp: '2025-01-15T10:00:00.000Z'
    },
    locale: 'en-US',
    status: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    rejectionReason: null,
    kreatorId: null,
    magicLinkCode: null,
    submittedAt: serverTs(),
    updatedAt: serverTs(),
    expiresAt: Timestamp.fromDate(expiresAt),
    submittedFromIp: '192.168.1.100',
    submittedUserAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    ...overrides
  };
}

function approvedApplication(overrides = {}) {
  return kreatorApplication({
    id: 'app_APPROVED01',
    status: 'approved',
    reviewedBy: 'super-admin-uid',
    reviewedAt: ts(),
    reviewNotes: 'Great fit for the platform',
    kreatorId: 'kreator_uid_001',
    magicLinkCode: 'lkMagic',
    ...overrides
  });
}

function rejectedApplication(overrides = {}) {
  return kreatorApplication({
    id: 'app_REJECTED01',
    email: 'rejected@example.com',
    status: 'rejected',
    reviewedBy: 'super-admin-uid',
    reviewedAt: ts(),
    rejectionReason: 'Product category does not align with our marketplace focus at this time.',
    ...overrides
  });
}

// ─── KREATORS ──────────────────────────────────────────────────────

function kreator(overrides = {}) {
  return {
    uid: 'kreator_uid_001',
    email: 'jane.doe@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    displayName: 'Jane Doe',
    brandName: 'Paddle Craft Co',
    businessName: 'Paddle Craft Co',
    businessType: 'sole_proprietor',
    phone: '+15551234567',
    website: 'https://paddlecraft.co',
    productCategories: ['paddles', 'accessories'],
    location: 'Portland, OR',
    avatarUrl: null,
    bio: null,
    authProviders: ['password'],
    passwordSetAt: ts(),
    googleConnectedAt: null,
    status: 'active',
    verificationStatus: 'pending',
    permissions: ['products:create', 'products:read', 'products:update', 'products:delete'],
    plan: 'kreator-free',
    planLimits: { productsAllowed: 50, monthlyOrders: 100 },
    stats: { totalProducts: 3, totalOrders: 0, totalRevenue: 0, lastProductCreatedAt: null },
    applicationId: 'app_APPROVED01',
    approvedBy: 'super-admin-uid',
    approvedAt: serverTs(),
    consent: {
      termsAccepted: true,
      authenticityConfirmed: true,
      dataProcessingConsent: true,
      consentTimestamp: '2025-01-15T10:00:00.000Z'
    },
    locale: 'en-US',
    createdAt: serverTs(),
    updatedAt: serverTs(),
    lastLoginAt: null,
    lastActivityAt: null,
    deletedAt: null,
    deletedBy: null,
    ...overrides
  };
}

function pendingKreator(overrides = {}) {
  return kreator({
    uid: 'kreator_pending_001',
    email: 'pending@example.com',
    status: 'pending_password',
    authProviders: [],
    passwordSetAt: null,
    stats: { totalProducts: 0, totalOrders: 0, totalRevenue: 0, lastProductCreatedAt: null },
    ...overrides
  });
}

// ─── KAAYKOPRODUCTS ────────────────────────────────────────────────

function product(overrides = {}) {
  return {
    productID: 'kreator_p001',
    title: 'Handcrafted Maple Paddle',
    description: 'A beautiful hand-finished maple canoe paddle, perfect for flatwater paddling.',
    price: '$$',
    actualPrice: 29.99,
    votes: 12,
    tags: ['paddle', 'handcrafted', 'maple'],
    availableColors: ['natural', 'walnut'],
    availableSizes: ['52"', '54"', '56"'],
    maxQuantity: 5,
    stockQuantity: 15,
    imgSrc: ['https://storage.googleapis.com/kaayko-images/prod001_1.jpg'],
    isAvailable: true,
    category: 'paddles',
    kreatorId: 'kreator_uid_001',
    storeName: 'Paddle Craft Co',
    storeSlug: 'paddle-craft-co',
    sellerEmail: 'jane.doe@example.com',
    createdAt: serverTs(),
    updatedAt: serverTs(),
    ...overrides
  };
}

// ─── CLICK_EVENTS ──────────────────────────────────────────────────

function clickEvent(overrides = {}) {
  const t = new Date();
  return {
    clickId: 'c_abc123def456',
    linkCode: 'lkTest1',
    tenantId: 'kaayko-default',
    timestamp: serverTs(),
    timestampMs: t.getTime(),
    platform: 'ios',
    deviceInfo: {
      platform: 'ios',
      os: 'iOS 17.4',
      browser: 'Safari',
      deviceType: 'mobile',
      rawUserAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)'
    },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
    ip: '192.168.1.50',
    referrer: 'https://instagram.com',
    utm: { utm_source: 'instagram', utm_medium: 'social' },
    redirectedTo: 'https://apps.apple.com/app/kaayko/id123',
    redirectTimestamp: serverTs(),
    installAttributed: false,
    installTimestamp: null,
    metadata: {},
    expiresAt: Timestamp.fromMillis(t.getTime() + 30 * 24 * 60 * 60 * 1000),
    ...overrides
  };
}

// ─── TENANTS ───────────────────────────────────────────────────────

function tenant(overrides = {}) {
  return {
    name: 'Kaayko Default',
    domain: 'kaayko.com',
    pathPrefix: '/l',
    enabled: true,
    plan: 'starter',
    subscriptionStatus: 'active',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    scheduledDowngrade: null,
    updatedAt: serverTs(),
    ...overrides
  };
}

// ─── API_KEYS ──────────────────────────────────────────────────────

function apiKey(overrides = {}) {
  return {
    tenantId: 'kaayko-default',
    name: 'Production Key',
    secretHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    scopes: ['read:links', 'write:links'],
    rateLimitPerMinute: 60,
    createdAt: serverTs(),
    lastUsedAt: null,
    usageCount: 0,
    disabled: false,
    ...overrides
  };
}

// ─── WEBHOOK_SUBSCRIPTIONS ─────────────────────────────────────────

function webhookSubscription(overrides = {}) {
  return {
    tenantId: 'kaayko-default',
    targetUrl: 'https://hooks.example.com/kaayko',
    secret: 'whsec_test_secret_123',
    events: ['link.created', 'link.clicked', 'app.installed'],
    description: 'Main event webhook',
    enabled: true,
    createdAt: serverTs(),
    updatedAt: null,
    lastTriggeredAt: null,
    deliveryCount: 0,
    failureCount: 0,
    ...overrides
  };
}

// ─── FORECAST_CACHE ────────────────────────────────────────────────

function forecastCache(overrides = {}) {
  return {
    location_id: 'loc_portland',
    forecast: {
      location: 'Portland, OR',
      temperature: 72,
      conditions: 'Partly Cloudy',
      wind: { speed: 8, direction: 'NW' },
      paddleScore: 85
    },
    cached_at: serverTs(),
    ttl_hours: 3.5,
    ...overrides
  };
}

module.exports = {
  // Payment
  paymentIntent, succeededPaymentIntent, failedPaymentIntent,
  order, shippedOrder,
  // Links
  shortLink, disabledLink, expiredLink, abTestLink, magicLink,
  // Admin
  adminUser, superAdmin,
  // Kreators
  kreatorApplication, approvedApplication, rejectedApplication,
  kreator, pendingKreator,
  // Products
  product,
  // Analytics
  clickEvent,
  // Multi-tenant
  tenant, apiKey, webhookSubscription,
  // Weather
  forecastCache,
  // Helpers
  ts, now, serverTs
};
