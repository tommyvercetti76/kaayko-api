/**
 * Jest config for INTEGRATION tests
 * Runs against Firebase Emulators (Firestore + Auth)
 *
 * Usage:
 *   1. Start emulators:  firebase emulators:start --only firestore,auth
 *   2. Run tests:        npm run test:integration
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/integration/**/*.integration.test.js'],
  setupFiles: ['./__tests__/integration/setup.js'],
  testTimeout: 30000,
  verbose: true,
  // Do NOT clear/restore mocks — we selectively mock only external services
  clearMocks: false,
  restoreMocks: false,
  // Ignore caches but NOT __mocks__ (we unmock firebase-admin per-file)
  modulePathIgnorePatterns: ['node_modules/.cache', '.old']
};
