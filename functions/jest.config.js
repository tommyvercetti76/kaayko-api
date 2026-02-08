/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js', '!**/__tests__/integration/**'],
  testPathIgnorePatterns: ['__tests__/integration/'],
  setupFiles: ['./__tests__/setup.js'],
  modulePathIgnorePatterns: ['node_modules', '.old'],
  testTimeout: 15000,
  verbose: true,
  collectCoverageFrom: [
    'api/**/*.js',
    'middleware/**/*.js',
    'services/**/*.js',
    'scheduled/**/*.js',
    '!**/__tests__/**',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true
};
