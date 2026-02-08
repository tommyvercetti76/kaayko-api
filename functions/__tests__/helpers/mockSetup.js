/**
 * Shared mock setup — import at top of every test file.
 * Registers firebase-admin, firebase-functions mocks & afterEach cleanup.
 *
 * Usage: require('./helpers/mockSetup') at top of every *.test.js
 */

// ─── Mock firebase-admin (auto-discovers /functions/__mocks__/firebase-admin.js)
jest.mock('firebase-admin');

// ─── Mock firebase-admin/firestore (modular import used by some files) ─────
jest.mock('firebase-admin/firestore', () => {
  const adminMock = require('firebase-admin');
  const mockFs = adminMock._mocks.firestore;
  return {
    getFirestore: jest.fn(() => mockFs),
    FieldValue: adminMock._mocks.FieldValue,
    Timestamp: adminMock._mocks.Timestamp
  };
});

// ─── Mock firebase-functions ───────────────────────────────────
jest.mock('firebase-functions/v2/https', () => ({
  onRequest: jest.fn((opts, handler) => handler)
}));

jest.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: jest.fn((opts, handler) => handler)
}));

jest.mock('firebase-functions', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), log: jest.fn() },
  config: () => ({ stripe: { secret: 'sk_test_fake', webhook_secret: 'whsec_test_fake' } })
}));

// ─── Reset mock Firestore data between tests ──────────────────
afterEach(() => {
  const adminMock = require('firebase-admin');
  if (adminMock._mocks) adminMock._mocks.resetAll();
});
