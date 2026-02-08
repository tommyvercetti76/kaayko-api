/**
 * Test factories — reusable mock data for all test suites.
 */

const factories = {
  // ─── Auth tokens ───────────────────────────────────────────
  tokens: {
    admin: 'VALID_ADMIN_TOKEN',
    user: 'VALID_USER_TOKEN',
    superAdmin: 'VALID_SUPER_ADMIN_TOKEN',
    expired: 'EXPIRED_TOKEN',
    invalid: 'totally-bogus-token',
    missing: undefined,
    malformed: 'not-a-jwt'
  },

  // ─── Admin passphrase ─────────────────────────────────────
  adminKey: 'test-admin-passphrase',

  // ─── API keys ──────────────────────────────────────────────
  apiKeys: {
    valid: 'ak_' + 'a'.repeat(32),         // 35 chars, starts with ak_
    disabled: 'ak_' + 'b'.repeat(32),
    noScopes: 'ak_' + 'c'.repeat(32),
    tooShort: 'ak_short',                   // < 35 chars
    wrongPrefix: 'xx_' + 'a'.repeat(32),    // wrong prefix
  },

  // ─── User objects ──────────────────────────────────────────
  adminUser: (overrides = {}) => ({
    uid: 'admin-uid',
    email: 'admin@kaayko.com',
    role: 'admin',
    displayName: 'Admin User',
    createdAt: new Date(),
    permissions: ['manage_users', 'manage_orders', 'manage_links'],
    ...overrides
  }),

  superAdminUser: (overrides = {}) => ({
    uid: 'super-admin-uid',
    email: 'super@kaayko.com',
    role: 'super-admin',
    displayName: 'Super Admin',
    createdAt: new Date(),
    permissions: ['*'],
    ...overrides
  }),

  regularUser: (overrides = {}) => ({
    uid: 'user-uid',
    email: 'user@test.com',
    role: 'viewer',
    displayName: 'Regular User',
    createdAt: new Date(),
    permissions: [],
    ...overrides
  }),

  // ─── Kreator objects ───────────────────────────────────────
  kreator: (overrides = {}) => ({
    uid: 'kreator-uid-1',
    email: 'kreator@test.com',
    firstName: 'Test',
    lastName: 'Kreator',
    displayName: 'Test Kreator',
    status: 'active',
    brand: 'TestBrand',
    createdAt: { toDate: () => new Date() },
    updatedAt: { toDate: () => new Date() },
    ...overrides
  }),

  kreatorApplication: (overrides = {}) => ({
    email: 'newkreator@test.com',
    firstName: 'New',
    lastName: 'Kreator',
    brand: 'NewBrand',
    website: 'https://newbrand.com',
    socialMedia: '@newbrand',
    why: 'I want to sell paddle gear',
    ...overrides
  }),

  // ─── Smart link / Kortex objects ───────────────────────────
  smartLink: (overrides = {}) => ({
    id: 'link-123',
    linkId: 'link-123',
    title: 'Test Link',
    destinationUrl: 'https://example.com/product',
    shortCode: 'abc123',
    status: 'active',
    createdBy: 'admin-uid',
    tenantId: 'tenant-1',
    clicks: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }),

  // ─── Tenant objects ────────────────────────────────────────
  tenant: (overrides = {}) => ({
    id: 'tenant-1',
    name: 'Test Tenant',
    domain: 'test.kaayko.com',
    ownerId: 'admin-uid',
    status: 'active',
    plan: 'pro',
    createdAt: new Date(),
    ...overrides
  }),

  // ─── Order objects ─────────────────────────────────────────
  order: (overrides = {}) => ({
    id: 'order-123',
    paymentIntentId: 'pi_test_123',
    customerEmail: 'buyer@test.com',
    items: [{ productId: 'prod-1', name: 'Paddle', price: 29.99, quantity: 1 }],
    total: 29.99,
    status: 'completed',
    createdAt: new Date(),
    ...overrides
  }),

  // ─── Product objects ───────────────────────────────────────
  product: (overrides = {}) => ({
    id: 'prod-1',
    name: 'Test Paddle',
    description: 'A great paddle for testing',
    price: 29.99,
    category: 'paddles',
    images: ['https://storage.googleapis.com/test-image.jpg'],
    votes: 0,
    status: 'active',
    ...overrides
  }),

  kreatorProduct: (overrides = {}) => ({
    id: 'kprod-1',
    title: 'Kreator Product',
    description: 'A kreator digital product',
    price: 9.99,
    type: 'digital',
    status: 'active',
    kreatorId: 'kreator-uid-1',
    createdAt: { toDate: () => new Date() },
    ...overrides
  }),

  // ─── Billing objects ───────────────────────────────────────
  subscription: (overrides = {}) => ({
    plan: 'pro',
    status: 'active',
    stripeCustomerId: 'cus_test_123',
    stripeSubscriptionId: 'sub_test_123',
    currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
    ...overrides
  }),

  // ─── Weather objects ───────────────────────────────────────
  paddlingSpot: (overrides = {}) => ({
    id: 'spot-1',
    name: 'Lake Michigan Beach',
    lat: 42.0,
    lng: -87.6,
    type: 'lake',
    state: 'IL',
    ...overrides
  }),

  forecast: (overrides = {}) => ({
    temperature: 72,
    windSpeed: 8,
    windDirection: 'SW',
    waveHeight: 1.2,
    uvIndex: 6,
    conditions: 'Partly Cloudy',
    ...overrides
  })
};

module.exports = factories;
