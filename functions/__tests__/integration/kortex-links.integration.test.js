/**
 * Kortex Smart Links — Integration Tests
 *
 * Tests link CRUD, redirect handler, click tracking, and analytics
 * against REAL Firestore (emulator).
 *
 * External mocks: Email service, webhook service.
 */

jest.unmock('firebase-admin');
jest.unmock('firebase-admin/firestore');

// Mock only external services (email + webhooks)
jest.mock('../../services/emailNotificationService', () => ({
  sendLinkCreatedNotification: jest.fn(async () => ({ success: true })),
  sendKreatorApprovalEmail: jest.fn(async () => ({ success: true }))
}));

jest.mock('../../api/kortex/webhookService', () => ({
  triggerWebhooks: jest.fn(async () => {}),
  EVENT_TYPES: {
    LINK_CREATED: 'link.created',
    LINK_CLICKED: 'link.clicked',
    CLICK: 'link.clicked',
    INSTALL: 'app.installed'
  }
}));

const request = require('supertest');
const express = require('express');
const { db, isEmulatorRunning, clearCollections, seedDoc, getDoc, getAllDocs, countDocs } = require('./helpers/firestoreHelpers');
const seed = require('./helpers/seedData');

let emulatorAvailable = false;

beforeAll(async () => {
  emulatorAvailable = await isEmulatorRunning();
});

beforeEach(async () => {
  if (!emulatorAvailable) return;
  await clearCollections(['short_links', 'link_analytics', 'click_events', 'install_events']);
});

afterAll(async () => {
  if (emulatorAvailable) await clearCollections(['short_links', 'link_analytics', 'click_events', 'install_events']);
});

const skipIfNoEmulator = () => {
  if (!emulatorAvailable) return true;
  return false;
};

// ═══════════════════════════════════════════════════════════════════
// REDIRECT HANDLER — Core redirect logic
// ═══════════════════════════════════════════════════════════════════

describe('Redirect Handler', () => {
  const { handleRedirect, detectPlatform, selectDestinationVariant } = require('../../api/kortex/redirectHandler');

  test('detectPlatform: iPhone → ios', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)')).toBe('ios');
  });

  test('detectPlatform: Android → android', () => {
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
  });

  test('detectPlatform: Chrome desktop → web', () => {
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120')).toBe('web');
  });

  test('selectDestinationVariant: string returns as-is', () => {
    expect(selectDestinationVariant('https://kaayko.com')).toBe('https://kaayko.com');
  });

  test('selectDestinationVariant: array picks a variant', () => {
    const variants = [
      { url: 'https://a.com', weight: 50, label: 'A' },
      { url: 'https://b.com', weight: 50, label: 'B' }
    ];
    const result = selectDestinationVariant(variants);
    expect(['https://a.com', 'https://b.com']).toContain(result);
  });

  test('redirect: active link → 302 to correct destination', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('short_links', 'lkActive', seed.shortLink({
      code: 'lkActive',
      destinations: { web: 'https://kaayko.com/summer-sale', ios: null, android: null }
    }));

    const mockRes = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
      redirect: jest.fn()
    };
    const mockReq = {
      get: jest.fn((h) => h === 'user-agent' ? 'Chrome Desktop' : null),
      ip: '127.0.0.1',
      query: {}
    };

    await handleRedirect(mockReq, mockRes, 'lkActive');
    expect(mockRes.redirect).toHaveBeenCalledWith(302, expect.stringContaining('kaayko.com/summer-sale'));
  });

  test('redirect: disabled link → 410', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('short_links', 'lkOff', seed.disabledLink({ code: 'lkOff' }));

    const mockRes = { status: jest.fn().mockReturnThis(), send: jest.fn(), redirect: jest.fn() };
    const mockReq = { get: jest.fn(() => ''), ip: '127.0.0.1', query: {} };

    await handleRedirect(mockReq, mockRes, 'lkOff');
    expect(mockRes.status).toHaveBeenCalledWith(410);
  });

  test('redirect: expired link → 410', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('short_links', 'lkExp', seed.expiredLink({ code: 'lkExp' }));

    const mockRes = { status: jest.fn().mockReturnThis(), send: jest.fn(), redirect: jest.fn() };
    const mockReq = { get: jest.fn(() => ''), ip: '127.0.0.1', query: {} };

    await handleRedirect(mockReq, mockRes, 'lkExp');
    expect(mockRes.status).toHaveBeenCalledWith(410);
  });

  test('redirect: nonexistent code → 404', async () => {
    if (skipIfNoEmulator()) return;
    const mockRes = { status: jest.fn().mockReturnThis(), send: jest.fn(), redirect: jest.fn() };
    const mockReq = { get: jest.fn(() => ''), ip: '127.0.0.1', query: {} };

    await handleRedirect(mockReq, mockRes, 'lkGhost');
    expect(mockRes.status).toHaveBeenCalledWith(404);
  });

  test('redirect increments clickCount on active link', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('short_links', 'lkCount', seed.shortLink({ code: 'lkCount', clickCount: 10 }));

    const mockRes = { status: jest.fn().mockReturnThis(), send: jest.fn(), redirect: jest.fn() };
    const mockReq = { get: jest.fn(() => 'Chrome'), ip: '127.0.0.1', query: {} };

    await handleRedirect(mockReq, mockRes, 'lkCount');

    // Wait for async update
    await new Promise(r => setTimeout(r, 500));

    const doc = await getDoc('short_links', 'lkCount');
    expect(doc.clickCount).toBe(11);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CLICK TRACKING — Full attribution funnel
// ═══════════════════════════════════════════════════════════════════

describe('Click Tracking & Attribution', () => {
  const { trackClick, updateClickRedirect, trackInstall } = require('../../api/kortex/clickTracking');

  test('trackClick creates click_events doc with correct shape', async () => {
    if (skipIfNoEmulator()) return;
    const result = await trackClick({
      linkCode: 'lkTest1',
      tenantId: 'kaayko-default',
      platform: 'ios',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
      ip: '10.0.0.1',
      referrer: 'https://instagram.com',
      utm: { utm_source: 'instagram' },
      metadata: { campaign: 'summer' }
    });

    expect(result.clickId).toMatch(/^c_/);
    expect(result.timestamp).toBeTruthy();

    // Verify in Firestore
    const doc = await getDoc('click_events', result.clickId);
    expect(doc).not.toBeNull();
    expect(doc.linkCode).toBe('lkTest1');
    expect(doc.tenantId).toBe('kaayko-default');
    expect(doc.platform).toBe('ios');
    expect(doc.deviceInfo).toBeTruthy();
    expect(doc.ip).toBe('10.0.0.1');
    expect(doc.referrer).toBe('https://instagram.com');
    expect(doc.utm.utm_source).toBe('instagram');
    expect(doc.installAttributed).toBe(false);
    expect(doc.expiresAt).toBeTruthy(); // 30-day TTL
  });

  test('updateClickRedirect sets destination on click event', async () => {
    if (skipIfNoEmulator()) return;
    const { clickId } = await trackClick({
      linkCode: 'lkTest1', tenantId: 'kaayko-default',
      platform: 'web', userAgent: 'Chrome', ip: '10.0.0.2'
    });

    await updateClickRedirect(clickId, 'https://kaayko.com/store');

    const doc = await getDoc('click_events', clickId);
    expect(doc.redirectedTo).toBe('https://kaayko.com/store');
    expect(doc.redirectTimestamp).toBeTruthy();
  });

  test('trackInstall attributes click → install and creates install_events doc', async () => {
    if (skipIfNoEmulator()) return;
    // Seed the link
    await seedDoc('short_links', 'lkInstall', seed.shortLink({ code: 'lkInstall', installCount: 5 }));

    // Track a click
    const { clickId } = await trackClick({
      linkCode: 'lkInstall', tenantId: 'kaayko-default',
      platform: 'ios', userAgent: 'iPhone UA', ip: '10.0.0.3'
    });

    // Track an install
    const result = await trackInstall({
      clickId,
      deviceId: 'device_abc123',
      platform: 'ios',
      appVersion: '2.1.0',
      metadata: { source: 'organic' }
    });

    expect(result.success).toBe(true);
    expect(result.attributed).toBe(true);
    expect(result.isNewInstall).toBe(true);
    expect(result.context.linkCode).toBe('lkInstall');

    // Verify click event was marked as attributed
    const clickDoc = await getDoc('click_events', clickId);
    expect(clickDoc.installAttributed).toBe(true);
    expect(clickDoc.installDeviceId).toBe('device_abc123');

    // Verify install_events doc was created
    const installDocs = await getAllDocs('install_events');
    expect(installDocs.length).toBe(1);
    expect(installDocs[0].clickId).toBe(clickId);
    expect(installDocs[0].linkCode).toBe('lkInstall');
    expect(installDocs[0].deviceId).toBe('device_abc123');

    // Verify short_links installCount was incremented
    const linkDoc = await getDoc('short_links', 'lkInstall');
    expect(linkDoc.installCount).toBe(6);
  });

  test('trackInstall is idempotent (second call returns existing)', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('short_links', 'lkIdem', seed.shortLink({ code: 'lkIdem' }));

    const { clickId } = await trackClick({
      linkCode: 'lkIdem', tenantId: 'kaayko-default',
      platform: 'android', userAgent: 'Android UA', ip: '10.0.0.4'
    });

    await trackInstall({ clickId, deviceId: 'd1', platform: 'android', appVersion: '1.0' });
    const result2 = await trackInstall({ clickId, deviceId: 'd1', platform: 'android', appVersion: '1.0' });

    expect(result2.success).toBe(true);
    expect(result2.attributed).toBe(true);
    expect(result2.isNewInstall).toBe(false);
  });

  test('trackInstall with invalid clickId returns not attributed', async () => {
    if (skipIfNoEmulator()) return;
    const result = await trackInstall({
      clickId: 'c_nonexistent',
      deviceId: 'd1', platform: 'ios', appVersion: '1.0'
    });
    expect(result.success).toBe(true);
    expect(result.attributed).toBe(false);
  });

  test('trackInstall with no clickId returns error', async () => {
    if (skipIfNoEmulator()) return;
    const result = await trackInstall({ deviceId: 'd1', platform: 'ios', appVersion: '1.0' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('clickId');
  });
});

// ═══════════════════════════════════════════════════════════════════
// KORTEX HANDLERS — CRUD via handlers
// ═══════════════════════════════════════════════════════════════════

describe('Kortex Handlers — Link Event Tracking', () => {
  const handlers = require('../../api/kortex/kortexHandlers');

  test('trackEvent: install event increments installCount', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('short_links', 'lkTrack', seed.shortLink({ code: 'lkTrack', installCount: 3 }));

    const mockReq = { params: { type: 'install' }, body: { linkId: 'lkTrack', platform: 'ios' } };
    const mockRes = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await handlers.trackEvent(mockReq, mockRes);

    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    // Verify installCount incremented
    const doc = await getDoc('short_links', 'lkTrack');
    expect(doc.installCount).toBe(4);

    // Verify analytics doc created
    const analytics = await getAllDocs('link_analytics');
    expect(analytics.some(a => a.linkId === 'lkTrack' && a.type === 'install')).toBe(true);
  });

  test('trackEvent: click event creates analytics doc', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('short_links', 'lkClick', seed.shortLink({ code: 'lkClick' }));

    const mockReq = {
      params: { type: 'click' },
      body: { linkId: 'lkClick', userId: 'user123', platform: 'web', metadata: { page: '/store' } }
    };
    const mockRes = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await handlers.trackEvent(mockReq, mockRes);

    const analytics = await getAllDocs('link_analytics');
    const doc = analytics.find(a => a.linkId === 'lkClick');
    expect(doc).toBeTruthy();
    expect(doc.type).toBe('click');
    expect(doc.userId).toBe('user123');
    expect(doc.metadata.page).toBe('/store');
  });

  test('trackEvent: missing linkId → 400', async () => {
    if (skipIfNoEmulator()) return;
    const mockReq = { params: { type: 'click' }, body: {} };
    const mockRes = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await handlers.trackEvent(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// LINK CRUD — via kortexService
// ═══════════════════════════════════════════════════════════════════

describe('LinkService — CRUD', () => {
  const LinkService = require('../../api/kortex/kortexService');

  test('createShortLink generates valid doc', async () => {
    if (skipIfNoEmulator()) return;
    const link = await LinkService.createShortLink({
      destinations: {
        web: 'https://kaayko.com/new-collection',
        ios: 'https://apps.apple.com/app/kaayko/id123',
        android: null
      },
      title: 'New Collection',
      description: 'Check out our spring collection',
      createdBy: 'admin@kaayko.com',
      tenantId: 'kaayko-default',
      tenantName: 'Kaayko',
      domain: 'kaayko.com',
      pathPrefix: '/l'
    });

    expect(link.code).toMatch(/^lk/);
    expect(link.shortUrl).toContain('kaayko.com/l/');
    expect(link.qrCodeUrl).toBeTruthy();
    expect(link.destinations.web).toBe('https://kaayko.com/new-collection');

    // Verify in Firestore
    const doc = await getDoc('short_links', link.code);
    expect(doc).not.toBeNull();
    expect(doc.title).toBe('New Collection');
    expect(doc.enabled).toBe(true);
    expect(doc.clickCount).toBe(0);
    expect(doc.tenantId).toBe('kaayko-default');
  });

  test('getShortLink reads back created link', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('short_links', 'lkRead', seed.shortLink({ code: 'lkRead' }));

    const link = await LinkService.getShortLink('lkRead');
    expect(link.code).toBe('lkRead');
    expect(link.destinations).toBeTruthy();
    expect(link.clickCount).toBe(42);
  });

  test('getShortLink throws NOT_FOUND for missing code', async () => {
    if (skipIfNoEmulator()) return;
    await expect(LinkService.getShortLink('lkGhost')).rejects.toThrow();
  });

  test('updateShortLink modifies fields', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('short_links', 'lkUpd', seed.shortLink({ code: 'lkUpd', title: 'Old Title' }));

    const result = await LinkService.updateShortLink('lkUpd', {
      title: 'Updated Title',
      enabled: false
    });

    const doc = await getDoc('short_links', 'lkUpd');
    expect(doc.title).toBe('Updated Title');
    expect(doc.enabled).toBe(false);
  });

  test('deleteShortLink removes doc', async () => {
    if (skipIfNoEmulator()) return;
    await seedDoc('short_links', 'lkDel', seed.shortLink({ code: 'lkDel' }));

    await LinkService.deleteShortLink('lkDel');

    const doc = await getDoc('short_links', 'lkDel');
    expect(doc).toBeNull();
  });
});
