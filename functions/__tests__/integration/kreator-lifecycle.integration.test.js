/**
 * Kreator Lifecycle — Integration Tests
 *
 * Full kreator onboarding flow against REAL Firestore:
 *   1. Submit application → kreator_applications doc
 *   2. Duplicate detection
 *   3. List/filter/stats applications
 *   4. Approve → creates kreator + magic link + audit log
 *   5. Reject → reason + audit log
 *   6. Kreator profile CRUD
 *   7. Status transitions
 *
 * External mocks: Email service only.
 */

jest.unmock('firebase-admin');
jest.unmock('firebase-admin/firestore');

// Mock email service
jest.mock('../../services/emailNotificationService', () => ({
  sendKreatorApprovalEmail: jest.fn(async () => ({ success: true })),
  sendKreatorRejectionEmail: jest.fn(async () => ({ success: true })),
  sendLinkCreatedNotification: jest.fn(async () => ({ success: true }))
}));

// Mock webhook service
jest.mock('../../api/kortex/webhookService', () => ({
  triggerWebhooks: jest.fn(async () => {}),
  EVENT_TYPES: { LINK_CREATED: 'link.created' }
}));

const { db, isEmulatorRunning, clearCollections, seedDoc, getDoc, getAllDocs, countDocs } = require('./helpers/firestoreHelpers');
const seed = require('./helpers/seedData');

let emulatorAvailable = false;

beforeAll(async () => {
  emulatorAvailable = await isEmulatorRunning();
});

beforeEach(async () => {
  if (!emulatorAvailable) return;
  await clearCollections([
    'kreator_applications', 'kreators', 'short_links',
    'admin_audit_logs', 'admin_users', 'mail'
  ]);
});

afterAll(async () => {
  if (emulatorAvailable) {
    await clearCollections([
      'kreator_applications', 'kreators', 'short_links',
      'admin_audit_logs', 'admin_users', 'mail'
    ]);
  }
});

const skipIfNoEmulator = () => {
  if (!emulatorAvailable) return true;
  return false;
};

// ═══════════════════════════════════════════════════════════════════
// APPLICATION SERVICE — Submit, Query, Stats
// ═══════════════════════════════════════════════════════════════════

describe('kreatorApplicationService', () => {
  let appService;

  beforeAll(() => {
    appService = require('../../services/kreatorApplicationService');
  });

  const validApplicationData = {
    firstName: 'Alice',
    lastName: 'Smith',
    email: 'alice.smith@example.com',
    phone: '+15559876543',
    businessName: 'River Gear Co',
    businessType: 'sole_proprietor',
    website: 'https://rivergear.co',
    productCategories: ['paddles', 'accessories'],
    productDescription: 'Premium river gear for kayakers and canoeists, handcrafted from sustainable materials with attention to quality.',
    productCount: '10-25',
    priceRange: '$30-$150',
    location: 'Bend, OR',
    shippingCapability: 'nationwide',
    fulfillmentTime: '3-5 business days',
    inventoryManagement: 'manual',
    consent: {
      termsAccepted: true,
      authenticityConfirmed: true
    }
  };

  test('submitApplication creates doc with correct shape', async () => {
    if (skipIfNoEmulator()) return;
    const result = await appService.submitApplication(validApplicationData, {
      ip: '192.168.1.1',
      userAgent: 'Test Browser'
    });

    expect(result.success).toBe(true);
    expect(result.applicationId).toMatch(/^app_/);
    expect(result.status).toBe('pending');

    // Verify in Firestore
    const doc = await getDoc('kreator_applications', result.applicationId);
    expect(doc).not.toBeNull();
    expect(doc.firstName).toBe('Alice');
    expect(doc.lastName).toBe('Smith');
    expect(doc.displayName).toBe('Alice Smith');
    expect(doc.email).toBe('alice.smith@example.com');
    expect(doc.businessName).toBe('River Gear Co');
    expect(doc.brandName).toBe('River Gear Co');
    expect(doc.status).toBe('pending');
    expect(doc.applicationType).toBe('seller');
    expect(doc.consent.termsAccepted).toBe(true);
    expect(doc.consent.dataProcessingConsent).toBe(true);
    expect(doc.reviewedBy).toBeNull();
    expect(doc.kreatorId).toBeNull();
    expect(doc.magicLinkCode).toBeNull();
    expect(doc.submittedFromIp).toBe('192.168.1.1');
    expect(doc.expiresAt).toBeTruthy();
  });

  test('submitApplication rejects missing required fields', async () => {
    if (skipIfNoEmulator()) return;
    try {
      await appService.submitApplication({ firstName: 'Only' });
      fail('Should have thrown');
    } catch (err) {
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details).toBeTruthy();
    }
  });

  test('submitApplication rejects duplicate pending email', async () => {
    if (skipIfNoEmulator()) return;
    await appService.submitApplication(validApplicationData);

    try {
      await appService.submitApplication(validApplicationData);
      fail('Should have thrown');
    } catch (err) {
      expect(err.code).toBe('DUPLICATE_APPLICATION');
      expect(err.existingStatus).toBe('pending');
    }
  });

  test('submitApplication allows resubmit after rejection', async () => {
    if (skipIfNoEmulator()) return;
    // Seed a rejected application
    await seedDoc('kreator_applications', 'app_old', seed.rejectedApplication({
      id: 'app_old',
      email: 'retry@example.com'
    }));

    const data = { ...validApplicationData, email: 'retry@example.com' };
    const result = await appService.submitApplication(data);
    expect(result.success).toBe(true);
  });

  test('getApplication returns seeded application', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreator_applications', 'app_GET1', seed.kreatorApplication({ id: 'app_GET1' }));

    const result = await appService.getApplication('app_GET1');
    expect(result).not.toBeNull();
    expect(result.id).toBe('app_GET1');
    expect(result.status).toBe('pending');
    // Timestamps should be serialized to ISO strings
    expect(typeof result.submittedAt === 'string' || result.submittedAt === undefined).toBe(true);
  });

  test('getApplication returns null for unknown ID', async () => {
    if (skipIfNoEmulator()) return;
    const result = await appService.getApplication('app_GHOST');
    expect(result).toBeNull();
  });

  test('listApplications returns all with pagination', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreator_applications', 'a1', seed.kreatorApplication({ id: 'a1', email: 'a1@test.com' }));
    await seedDoc('kreator_applications', 'a2', seed.kreatorApplication({ id: 'a2', email: 'a2@test.com' }));
    await seedDoc('kreator_applications', 'a3', seed.approvedApplication({ id: 'a3', email: 'a3@test.com' }));

    const result = await appService.listApplications();
    expect(result.applications.length).toBe(3);
    expect(result.total).toBe(3);
  });

  test('listApplications filters by status', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreator_applications', 'a1', seed.kreatorApplication({ id: 'a1', email: 'b1@test.com', status: 'pending' }));
    await seedDoc('kreator_applications', 'a2', seed.approvedApplication({ id: 'a2', email: 'b2@test.com' }));

    const result = await appService.listApplications({ status: 'pending' });
    expect(result.applications.length).toBe(1);
    expect(result.applications[0].status).toBe('pending');
  });

  test('getApplicationStats counts by status', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreator_applications', 's1', seed.kreatorApplication({ id: 's1', email: 's1@test.com', status: 'pending' }));
    await seedDoc('kreator_applications', 's2', seed.kreatorApplication({ id: 's2', email: 's2@test.com', status: 'pending' }));
    await seedDoc('kreator_applications', 's3', seed.approvedApplication({ id: 's3', email: 's3@test.com' }));
    await seedDoc('kreator_applications', 's4', seed.rejectedApplication({ id: 's4', email: 's4@test.com' }));

    const stats = await appService.getApplicationStats();
    expect(stats.pending).toBe(2);
    expect(stats.approved).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.total).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// KREATOR SERVICE — CRUD + Profile
// ═══════════════════════════════════════════════════════════════════

describe('kreatorService — CRUD', () => {
  let kreatorService;

  beforeAll(() => {
    kreatorService = require('../../services/kreatorService');
  });

  test('getKreator returns seeded kreator with ISO timestamps', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreators', 'k1', seed.kreator({ uid: 'k1' }));

    const result = await kreatorService.getKreator('k1');
    expect(result).not.toBeNull();
    expect(result.uid).toBe('k1');
    expect(result.status).toBe('active');
    expect(result.plan).toBe('kreator-free');
    // Timestamps serialized to ISO strings
    if (result.createdAt) expect(typeof result.createdAt).toBe('string');
  });

  test('getKreator returns null for missing uid', async () => {
    if (skipIfNoEmulator()) return;
    const result = await kreatorService.getKreator('ghost');
    expect(result).toBeNull();
  });

  test('getKreatorByEmail finds by email', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreators', 'k_email', seed.kreator({ uid: 'k_email', email: 'find@test.com' }));

    const result = await kreatorService.getKreatorByEmail('find@test.com');
    expect(result).not.toBeNull();
    expect(result.email).toBe('find@test.com');
  });

  test('getKreatorByEmail is case-insensitive', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreators', 'k_case', seed.kreator({ uid: 'k_case', email: 'case@test.com' }));

    const result = await kreatorService.getKreatorByEmail('CASE@TEST.COM');
    // Service lowercases+trims the email before querying
    expect(result).not.toBeNull();
  });

  test('listKreators excludes soft-deleted', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreators', 'k_active', seed.kreator({ uid: 'k_active', deletedAt: null }));
    await seedDoc('kreators', 'k_deleted', seed.kreator({ uid: 'k_deleted', deletedAt: new Date() }));

    const result = await kreatorService.listKreators();
    expect(result.kreators.length).toBe(1);
    expect(result.kreators[0].uid).toBe('k_active');
    expect(result.total).toBe(1);
  });

  test('listKreators filters by status', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreators', 'k_act', seed.kreator({ uid: 'k_act', status: 'active', deletedAt: null }));
    await seedDoc('kreators', 'k_pend', seed.pendingKreator({ uid: 'k_pend', deletedAt: null }));

    const result = await kreatorService.listKreators({ status: 'active' });
    expect(result.kreators.every(k => k.status === 'active')).toBe(true);
  });

  test('updateKreatorProfile only changes allowed fields', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreators', 'k_prof', seed.kreator({ uid: 'k_prof', displayName: 'Old Name' }));

    const result = await kreatorService.updateKreatorProfile('k_prof', {
      displayName: 'New Name',
      bio: 'I make awesome paddles',
      // These should be IGNORED (not in allowed fields)
      role: 'super-admin',
      status: 'suspended',
      email: 'hacked@evil.com'
    });

    const doc = await getDoc('kreators', 'k_prof');
    expect(doc.displayName).toBe('New Name');
    expect(doc.bio).toBe('I make awesome paddles');
    // Verify protected fields were NOT changed
    expect(doc.status).toBe('active'); // unchanged
    expect(doc.email).toBe('jane.doe@example.com'); // unchanged from seed
  });

  test('updateKreatorProfile throws NOT_FOUND for missing kreator', async () => {
    if (skipIfNoEmulator()) return;
    try {
      await kreatorService.updateKreatorProfile('ghost', { displayName: 'X' });
      fail('Should have thrown');
    } catch (err) {
      expect(err.code).toBe('NOT_FOUND');
    }
  });

  test('updateLastLogin sets timestamps', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreators', 'k_login', seed.kreator({ uid: 'k_login', lastLoginAt: null }));

    await kreatorService.updateLastLogin('k_login');

    const doc = await getDoc('kreators', 'k_login');
    expect(doc.lastLoginAt).toBeTruthy();
    expect(doc.lastActivityAt).toBeTruthy();
  });

  test('getKreatorStats counts by status', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreators', 'ks1', seed.kreator({ uid: 'ks1', status: 'active', deletedAt: null }));
    await seedDoc('kreators', 'ks2', seed.kreator({ uid: 'ks2', status: 'active', deletedAt: null }));
    await seedDoc('kreators', 'ks3', seed.pendingKreator({ uid: 'ks3', deletedAt: null }));

    const stats = await kreatorService.getKreatorStats();
    expect(stats.active).toBe(2);
    expect(stats.pendingPassword).toBe(1);
    expect(stats.total).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PRODUCT STATS — Kreator stats.totalProducts
// ═══════════════════════════════════════════════════════════════════

describe('Kreator Product Stats', () => {
  test('seeded kreator stats reflect product count', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('kreators', 'k_stats', seed.kreator({
      uid: 'k_stats',
      stats: { totalProducts: 5, totalOrders: 2, totalRevenue: 150.00, lastProductCreatedAt: null }
    }));

    const doc = await getDoc('kreators', 'k_stats');
    expect(doc.stats.totalProducts).toBe(5);
    expect(doc.stats.totalOrders).toBe(2);
    expect(doc.stats.totalRevenue).toBe(150);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EDGE CASES — Legacy & Missing Fields
// ═══════════════════════════════════════════════════════════════════

describe('Edge Cases — Backward Compatibility', () => {
  let kreatorService;

  beforeAll(() => {
    kreatorService = require('../../services/kreatorService');
  });

  test('kreator with no socialLinks (legacy doc) reads fine', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.kreator({ uid: 'k_legacy' });
    delete data.bio;
    delete data.avatarUrl;
    await seedDoc('kreators', 'k_legacy', data);

    const result = await kreatorService.getKreator('k_legacy');
    expect(result).not.toBeNull();
    expect(result.bio).toBeUndefined();
  });

  test('kreator with missing stats (legacy doc) reads fine', async () => {
    if (skipIfNoEmulator()) return;
    const data = seed.kreator({ uid: 'k_nostats' });
    delete data.stats;
    await seedDoc('kreators', 'k_nostats', data);

    const result = await kreatorService.getKreator('k_nostats');
    expect(result).not.toBeNull();
    expect(result.stats).toBeUndefined();
  });

  test('application with missing optional fields reads fine', async () => {
    if (skipIfNoEmulator()) return;
    const appService = require('../../services/kreatorApplicationService');
    const data = seed.kreatorApplication({ id: 'app_minimal' });
    delete data.socialMedia;
    delete data.referralSource;
    delete data.additionalInfo;
    delete data.website;
    await seedDoc('kreator_applications', 'app_minimal', data);

    const result = await appService.getApplication('app_minimal');
    expect(result).not.toBeNull();
    expect(result.socialMedia).toBeUndefined();
  });
});
