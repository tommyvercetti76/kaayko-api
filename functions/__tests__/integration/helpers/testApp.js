/**
 * Test Express App Builder — Integration Tests
 *
 * Creates Express apps that mount REAL routers/handlers but with
 * auth middleware replaced by a test-friendly version that injects
 * req.user from an X-Test-User header.
 */

const express = require('express');

/**
 * Default test users
 */
const TEST_USERS = {
  superAdmin: { uid: 'super-admin-uid', email: 'super@kaayko.com', role: 'super-admin' },
  admin: { uid: 'admin-uid-001', email: 'admin@kaayko.com', role: 'admin' },
  viewer: { uid: 'viewer-uid-001', email: 'viewer@kaayko.com', role: 'viewer' },
  kreator: { uid: 'kreator_uid_001', email: 'jane.doe@example.com', role: 'kreator' }
};

/**
 * Build an Express app for integration testing.
 * Auth middleware is bypassed — req.user is set from X-Test-User header
 * or defaults to the specified role.
 *
 * @param {Function} mountFn — receives (app) and mounts routes
 * @param {Object} [opts]
 * @param {string} [opts.defaultRole='superAdmin'] — fallback user role
 * @returns {express.Express}
 */
function buildIntegrationApp(mountFn, opts = {}) {
  const app = express();
  app.use(express.json());

  // Test auth middleware — injects user from header or default
  app.use((req, _res, next) => {
    const header = req.get('X-Test-User');
    if (header) {
      try { req.user = JSON.parse(header); } catch { req.user = TEST_USERS.superAdmin; }
    } else {
      req.user = TEST_USERS[opts.defaultRole || 'superAdmin'];
    }
    next();
  });

  // Let the caller mount whatever routes they need
  mountFn(app);

  return app;
}

module.exports = { buildIntegrationApp, TEST_USERS };
