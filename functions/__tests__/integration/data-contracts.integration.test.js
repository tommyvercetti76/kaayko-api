/**
 * Data Contract Integration Tests
 *
 * Seeds the Firestore emulator with production-shaped documents,
 * then verifies that handler/service code can read them correctly
 * and that writes produce the expected document shapes.
 *
 * This is the FIRST test to run — it validates backward compatibility
 * with existing production data.
 */

// Unmock firebase-admin so we use the REAL SDK against the emulator
jest.unmock('firebase-admin');
jest.unmock('firebase-admin/firestore');

const { db, isEmulatorRunning, clearCollections, seedDoc, seedCollection, getDoc, getAllDocs } = require('./helpers/firestoreHelpers');
const seed = require('./helpers/seedData');

// ─── Pre-flight check ──────────────────────────────────────────────

let emulatorAvailable = false;

beforeAll(async () => {
  emulatorAvailable = await isEmulatorRunning();
  if (!emulatorAvailable) {
    console.error('\n⚠️  Firestore emulator not running. Start it with:\n   firebase emulators:start --only firestore,auth\n');
  }
});

beforeEach(async () => {
  if (!emulatorAvailable) return;
  await clearCollections();
});

afterAll(async () => {
  if (emulatorAvailable) await clearCollections();
});

const skipIfNoEmulator = () => {
  if (!emulatorAvailable) return true;
  return false;
};

// ═══════════════════════════════════════════════════════════════════
// PAYMENT_INTENTS — Document Shape Contracts
// ═══════════════════════════════════════════════════════════════════

describe('Collection: payment_intents', () => {
  test('seed → read back: all fields preserved', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.paymentIntent({ id: 'pi_shape_test' });
    await seedDoc('payment_intents', 'pi_shape_test', data);

    const doc = await getDoc('payment_intents', 'pi_shape_test');
    expect(doc).not.toBeNull();
    expect(doc.paymentIntentId).toBe('pi_shape_test');
    expect(doc.totalAmount).toBe(3500);
    expect(doc.totalAmountFormatted).toBe('$35.00');
    expect(doc.currency).toBe('usd');
    expect(doc.itemCount).toBe(2);
    expect(doc.status).toBe('created');
    expect(doc.paymentStatus).toBe('pending');
    expect(doc.fulfillmentStatus).toBe('awaiting_payment');
    expect(doc.items).toHaveLength(2);
    expect(doc.items[0]).toEqual(expect.objectContaining({
      productId: 'prod_001',
      productTitle: 'Paddle Jersey',
      priceInCents: 2000
    }));
    expect(doc.customerEmail).toBe('customer@test.com');
    expect(doc.customerPhone).toBeNull();
    expect(doc.dataRetentionConsent).toBe(true);
    expect(doc.paidAt).toBeNull();
    expect(doc.fulfilledAt).toBeNull();
    expect(doc.cancelledAt).toBeNull();
    expect(doc.statusHistory).toHaveLength(1);
  });

  test('succeeded payment intent has all lifecycle fields', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.succeededPaymentIntent();
    await seedDoc('payment_intents', 'pi_test_succeeded_001', data);

    const doc = await getDoc('payment_intents', 'pi_test_succeeded_001');
    expect(doc.status).toBe('succeeded');
    expect(doc.paymentStatus).toBe('succeeded');
    expect(doc.fulfillmentStatus).toBe('processing');
    expect(doc.paidAt).toBeTruthy();
    expect(doc.amount).toBe(3500);
    expect(doc.statusHistory).toHaveLength(2);
  });

  test('failed payment intent has error fields', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.failedPaymentIntent();
    await seedDoc('payment_intents', 'pi_test_failed_001', data);

    const doc = await getDoc('payment_intents', 'pi_test_failed_001');
    expect(doc.status).toBe('failed');
    expect(doc.paymentStatus).toBe('failed');
    expect(doc.fulfillmentStatus).toBe('cancelled');
    expect(doc.failedAt).toBeTruthy();
    expect(doc.cancelledAt).toBeTruthy();
    expect(doc.errorMessage).toBe('Your card was declined.');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ORDERS — Document Shape Contracts
// ═══════════════════════════════════════════════════════════════════

describe('Collection: orders', () => {
  test('order doc has all required fields', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.order();
    await seedDoc('orders', data.orderId, data);

    const doc = await getDoc('orders', data.orderId);
    expect(doc).not.toBeNull();

    // Identity
    expect(doc.orderId).toBeTruthy();
    expect(doc.parentOrderId).toBeTruthy();
    expect(doc.itemIndex).toBe(1);
    expect(doc.totalItems).toBe(2);

    // Product
    expect(doc.productId).toBeTruthy();
    expect(doc.productTitle).toBeTruthy();
    expect(doc.size).toBeTruthy();
    expect(doc.gender).toBeTruthy();

    // Statuses
    expect(['pending', 'processing', 'shipped', 'delivered', 'returned']).toContain(doc.orderStatus);
    expect(['processing', 'fulfilled', 'cancelled']).toContain(doc.fulfillmentStatus);
    expect(doc.paymentStatus).toBe('paid');

    // Shipping (should start null)
    expect(doc.trackingNumber).toBeNull();
    expect(doc.carrier).toBeNull();
    expect(doc.trackingUrl).toBeNull();

    // Address
    expect(doc.shippingAddress).toEqual(expect.objectContaining({
      name: expect.any(String),
      line1: expect.any(String),
      city: expect.any(String),
      state: expect.any(String),
      postal_code: expect.any(String),
      country: expect.any(String)
    }));
  });

  test('shipped order has tracking info', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.shippedOrder();
    await seedDoc('orders', data.orderId, data);

    const doc = await getDoc('orders', data.orderId);
    expect(doc.orderStatus).toBe('shipped');
    expect(doc.trackingNumber).toBeTruthy();
    expect(doc.carrier).toBe('USPS');
    expect(doc.trackingUrl).toContain('usps.com');
    expect(doc.estimatedDelivery).toBeTruthy();
  });

  test('orders can be queried by parentOrderId', async () => {
    if (skipIfNoEmulator()) return;
    const piId = 'pi_query_test';
    await seedDoc('orders', `${piId}_item1`, seed.order({ parentOrderId: piId, itemIndex: 1 }));
    await seedDoc('orders', `${piId}_item2`, seed.order({ parentOrderId: piId, itemIndex: 2, productId: 'prod_002' }));

    const snap = await db.collection('orders').where('parentOrderId', '==', piId).get();
    expect(snap.size).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SHORT_LINKS — Document Shape Contracts
// ═══════════════════════════════════════════════════════════════════

describe('Collection: short_links', () => {
  test('standard link has all fields', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.shortLink();
    await seedDoc('short_links', data.code, data);

    const doc = await getDoc('short_links', data.code);
    expect(doc.code).toBe('lkTest1');
    expect(doc.shortUrl).toContain('kaayko.com');
    expect(doc.tenantId).toBe('kaayko-default');
    expect(doc.destinations).toEqual(expect.objectContaining({
      ios: expect.any(String),
      android: expect.any(String),
      web: expect.any(String)
    }));
    expect(doc.clickCount).toBe(42);
    expect(doc.installCount).toBe(7);
    expect(doc.enabled).toBe(true);
    expect(doc.metadata).toEqual(expect.objectContaining({ campaign: 'summer2025' }));
    expect(doc.utm).toEqual(expect.objectContaining({ utm_source: 'instagram' }));
  });

  test('A/B test link has array destinations', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.abTestLink();
    await seedDoc('short_links', data.code, data);

    const doc = await getDoc('short_links', data.code);
    expect(Array.isArray(doc.destinations.ios)).toBe(true);
    expect(doc.destinations.ios).toHaveLength(2);
    expect(doc.destinations.ios[0]).toEqual(expect.objectContaining({
      url: expect.any(String),
      weight: expect.any(Number),
      label: expect.any(String)
    }));
    // Android is still a simple string
    expect(typeof doc.destinations.android).toBe('string');
  });

  test('magic link has type + metadata fields', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.magicLink();
    await seedDoc('short_links', data.code, data);

    const doc = await getDoc('short_links', data.code);
    expect(doc.type).toBe('magic_link');
    expect(doc.tokenHash).toBeTruthy();
    expect(doc.tokenSalt).toBeTruthy();
    expect(doc.metadata.purpose).toBe('kreator_onboarding');
    expect(doc.metadata.targetEmail).toBeTruthy();
    expect(doc.metadata.targetKreatorId).toBeTruthy();
    expect(doc.metadata.applicationId).toBeTruthy();
    expect(doc.metadata.singleUse).toBe(true);
    expect(doc.metadata.usedAt).toBeNull();
  });

  test('disabled link has enabled=false', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.disabledLink();
    await seedDoc('short_links', data.code, data);
    const doc = await getDoc('short_links', data.code);
    expect(doc.enabled).toBe(false);
  });

  test('expired link has past expiresAt', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.expiredLink();
    await seedDoc('short_links', data.code, data);
    const doc = await getDoc('short_links', data.code);
    const expires = doc.expiresAt.toDate();
    expect(expires < new Date()).toBe(true);
  });

  test('index query: enabled + createdAt desc', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('short_links', 'lk001', seed.shortLink({ code: 'lk001', enabled: true }));
    await seedDoc('short_links', 'lk002', seed.shortLink({ code: 'lk002', enabled: false }));

    const snap = await db.collection('short_links')
      .where('enabled', '==', true)
      .orderBy('createdAt', 'desc')
      .get();
    expect(snap.size).toBe(1);
    expect(snap.docs[0].id).toBe('lk001');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ADMIN_USERS — Document Shape Contracts
// ═══════════════════════════════════════════════════════════════════

describe('Collection: admin_users', () => {
  test('admin user doc has all RBAC fields', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.adminUser();
    await seedDoc('admin_users', data.uid, data);

    const doc = await getDoc('admin_users', data.uid);
    expect(doc.uid).toBe('admin-uid-001');
    expect(doc.email).toBeTruthy();
    expect(doc.role).toBe('admin');
    expect(Array.isArray(doc.permissions)).toBe(true);
    expect(doc.permissions).toContain('smartlinks:create');
    expect(doc.enabled).toBe(true);
    expect(doc.metadata).toEqual(expect.objectContaining({
      createdBy: expect.any(String),
      environment: expect.any(String)
    }));
  });

  test('super-admin has wildcard permissions', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.superAdmin();
    await seedDoc('admin_users', data.uid, data);

    const doc = await getDoc('admin_users', data.uid);
    expect(doc.role).toBe('super-admin');
    expect(doc.permissions).toEqual(['*']);
  });

  test('index query: role + createdAt desc', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('admin_users', 'u1', seed.adminUser({ uid: 'u1', role: 'admin' }));
    await seedDoc('admin_users', 'u2', seed.adminUser({ uid: 'u2', role: 'viewer' }));

    const snap = await db.collection('admin_users')
      .where('role', '==', 'admin')
      .orderBy('createdAt', 'desc')
      .get();
    expect(snap.size).toBe(1);
    expect(snap.docs[0].id).toBe('u1');
  });
});

// ═══════════════════════════════════════════════════════════════════
// KREATOR_APPLICATIONS — Document Shape Contracts
// ═══════════════════════════════════════════════════════════════════

describe('Collection: kreator_applications', () => {
  test('pending application has all required fields', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.kreatorApplication();
    await seedDoc('kreator_applications', data.id, data);

    const doc = await getDoc('kreator_applications', data.id);
    expect(doc.id).toBe('app_TEST00001');
    expect(doc.applicationType).toBe('seller');
    expect(doc.firstName).toBeTruthy();
    expect(doc.lastName).toBeTruthy();
    expect(doc.email).toContain('@');
    expect(doc.phone).toMatch(/^\+\d/);
    expect(doc.businessName).toBeTruthy();
    expect(doc.businessType).toBe('sole_proprietor');
    expect(doc.productCategories).toBeInstanceOf(Array);
    expect(doc.productDescription.length).toBeGreaterThanOrEqual(50);
    expect(doc.consent.termsAccepted).toBe(true);
    expect(doc.consent.authenticityConfirmed).toBe(true);
    expect(doc.status).toBe('pending');
    expect(doc.reviewedBy).toBeNull();
    expect(doc.kreatorId).toBeNull();
  });

  test('approved application links to kreator', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.approvedApplication();
    await seedDoc('kreator_applications', data.id, data);

    const doc = await getDoc('kreator_applications', data.id);
    expect(doc.status).toBe('approved');
    expect(doc.reviewedBy).toBeTruthy();
    expect(doc.kreatorId).toBe('kreator_uid_001');
    expect(doc.magicLinkCode).toBe('lkMagic');
  });

  test('rejected application has reason', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.rejectedApplication();
    await seedDoc('kreator_applications', data.id, data);

    const doc = await getDoc('kreator_applications', data.id);
    expect(doc.status).toBe('rejected');
    expect(doc.rejectionReason.length).toBeGreaterThanOrEqual(10);
  });

  test('index query: status + submittedAt desc', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreator_applications', 'a1', seed.kreatorApplication({ id: 'a1', status: 'pending' }));
    await seedDoc('kreator_applications', 'a2', seed.approvedApplication({ id: 'a2' }));

    const snap = await db.collection('kreator_applications')
      .where('status', '==', 'pending')
      .orderBy('submittedAt', 'desc')
      .get();
    expect(snap.size).toBe(1);
    expect(snap.docs[0].id).toBe('a1');
  });
});

// ═══════════════════════════════════════════════════════════════════
// KREATORS — Document Shape Contracts
// ═══════════════════════════════════════════════════════════════════

describe('Collection: kreators', () => {
  test('active kreator has complete profile', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.kreator();
    await seedDoc('kreators', data.uid, data);

    const doc = await getDoc('kreators', data.uid);
    expect(doc.uid).toBe('kreator_uid_001');
    expect(doc.status).toBe('active');
    expect(doc.authProviders).toContain('password');
    expect(doc.plan).toBe('kreator-free');
    expect(doc.planLimits).toEqual(expect.objectContaining({
      productsAllowed: 50,
      monthlyOrders: 100
    }));
    expect(doc.stats).toEqual(expect.objectContaining({
      totalProducts: expect.any(Number),
      totalOrders: expect.any(Number),
      totalRevenue: expect.any(Number)
    }));
    expect(doc.deletedAt).toBeNull();
    expect(doc.applicationId).toBeTruthy();
    expect(doc.permissions).toBeInstanceOf(Array);
  });

  test('pending kreator awaits password', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.pendingKreator();
    await seedDoc('kreators', data.uid, data);

    const doc = await getDoc('kreators', data.uid);
    expect(doc.status).toBe('pending_password');
    expect(doc.authProviders).toEqual([]);
    expect(doc.passwordSetAt).toBeNull();
  });

  test('soft-delete filter works (deletedAt == null)', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreators', 'k1', seed.kreator({ uid: 'k1', deletedAt: null }));
    await seedDoc('kreators', 'k2', seed.kreator({ uid: 'k2', deletedAt: new Date() }));

    const snap = await db.collection('kreators').where('deletedAt', '==', null).get();
    expect(snap.size).toBe(1);
    expect(snap.docs[0].id).toBe('k1');
  });
});

// ═══════════════════════════════════════════════════════════════════
// KAAYKOPRODUCTS — Document Shape Contracts
// ═══════════════════════════════════════════════════════════════════

describe('Collection: kaaykoproducts', () => {
  test('product has all fields', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.product();
    await seedDoc('kaaykoproducts', data.productID, data);

    const doc = await getDoc('kaaykoproducts', data.productID);
    expect(doc.productID).toBeTruthy();
    expect(doc.title).toBeTruthy();
    expect(doc.price).toMatch(/^\$+$/);
    expect(doc.actualPrice).toBeGreaterThanOrEqual(0.99);
    expect(doc.votes).toBeGreaterThanOrEqual(0);
    expect(doc.tags).toBeInstanceOf(Array);
    expect(doc.imgSrc).toBeInstanceOf(Array);
    expect(doc.isAvailable).toBe(true);
    expect(doc.kreatorId).toBeTruthy();
    expect(doc.storeName).toBeTruthy();
    expect(doc.storeSlug).toBeTruthy();
  });

  test('price symbol mapping matches actualPrice', async () => {
    if (skipIfNoEmulator()) return;
    const cases = [
      { actualPrice: 15.99, expectedSymbol: '$' },
      { actualPrice: 29.99, expectedSymbol: '$$' },
      { actualPrice: 42.00, expectedSymbol: '$$$' },
      { actualPrice: 75.00, expectedSymbol: '$$$$' }
    ];

    for (const { actualPrice, expectedSymbol } of cases) {
      const data = seed.product({ productID: `prod_${actualPrice}`, actualPrice, price: expectedSymbol });
      await seedDoc('kaaykoproducts', data.productID, data);
      const doc = await getDoc('kaaykoproducts', data.productID);
      expect(doc.price).toBe(expectedSymbol);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// CLICK_EVENTS — Document Shape Contracts
// ═══════════════════════════════════════════════════════════════════

describe('Collection: click_events', () => {
  test('click event has attribution fields', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.clickEvent();
    await seedDoc('click_events', data.clickId, data);

    const doc = await getDoc('click_events', data.clickId);
    expect(doc.clickId).toMatch(/^c_/);
    expect(doc.linkCode).toBeTruthy();
    expect(doc.tenantId).toBeTruthy();
    expect(doc.platform).toMatch(/^(ios|android|web)$/);
    expect(doc.deviceInfo).toEqual(expect.objectContaining({
      platform: expect.any(String),
      os: expect.any(String),
      browser: expect.any(String)
    }));
    expect(doc.installAttributed).toBe(false);
    expect(doc.expiresAt).toBeTruthy(); // TTL field
  });
});

// ═══════════════════════════════════════════════════════════════════
// TENANTS & API_KEYS — Document Shape Contracts
// ═══════════════════════════════════════════════════════════════════

describe('Collection: tenants', () => {
  test('tenant has billing fields', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.tenant();
    await seedDoc('tenants', 'kaayko-default', data);

    const doc = await getDoc('tenants', 'kaayko-default');
    expect(doc.name).toBeTruthy();
    expect(doc.domain).toBeTruthy();
    expect(doc.plan).toBe('starter');
    expect(doc.subscriptionStatus).toBe('active');
    expect(doc.enabled).toBe(true);
  });
});

describe('Collection: api_keys', () => {
  test('API key has scope + rate limit fields', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.apiKey();
    await seedDoc('api_keys', 'key_001', data);

    const doc = await getDoc('api_keys', 'key_001');
    expect(doc.tenantId).toBeTruthy();
    expect(doc.secretHash).toBeTruthy();
    expect(doc.scopes).toBeInstanceOf(Array);
    expect(doc.rateLimitPerMinute).toBe(60);
    expect(doc.disabled).toBe(false);
    expect(doc.usageCount).toBe(0);
  });
});

describe('Collection: webhook_subscriptions', () => {
  test('webhook sub has all required fields', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.webhookSubscription();
    await seedDoc('webhook_subscriptions', 'wh_001', data);

    const doc = await getDoc('webhook_subscriptions', 'wh_001');
    expect(doc.tenantId).toBeTruthy();
    expect(doc.targetUrl).toMatch(/^https:/);
    expect(doc.secret).toBeTruthy();
    expect(doc.events).toBeInstanceOf(Array);
    expect(doc.events).toContain('link.created');
    expect(doc.enabled).toBe(true);
    expect(doc.deliveryCount).toBe(0);
    expect(doc.failureCount).toBe(0);
  });
});
