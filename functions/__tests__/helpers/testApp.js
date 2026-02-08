/**
 * Test app builder — creates a fresh Express app with the same
 * middleware/routing as the production index.js for supertest.
 */
const express = require('express');
const cors = require('cors');

/**
 * Build a minimal Express app that mounts ONLY the given route group.
 * This keeps tests isolated and fast.
 *
 * @param {string} mountPath - e.g. '/smartlinks'
 * @param {Function|Router} routerOrApp - the Express Router/app to mount
 * @param {Object} [opts] - options
 * @param {Array<Function>} [opts.middleware] - extra global middleware
 * @param {boolean} [opts.rawBody] - mount raw body parser first (for webhooks)
 * @returns {express.Application}
 */
function buildTestApp(mountPath, routerOrApp, opts = {}) {
  const app = express();
  app.use(cors());

  if (opts.rawBody) {
    app.use(mountPath, express.raw({ type: 'application/json' }));
  }

  app.use(express.json());

  if (opts.middleware) {
    opts.middleware.forEach((mw) => app.use(mw));
  }

  if (mountPath) {
    app.use(mountPath, routerOrApp);
  } else {
    app.use(routerOrApp);
  }

  return app;
}

/**
 * Build the FULL api app identical to index.js for integration-level tests.
 * Useful for testing cross-cutting concerns like middleware order, 404 handling, etc.
 */
function buildFullApp() {
  const app = express();
  app.use(cors());

  // Stripe webhook needs raw body BEFORE json parser
  app.use('/createPaymentIntent/webhook', express.raw({ type: 'application/json' }), require('../../api/checkout/stripeWebhook'));

  app.use(express.json());

  app.use('/images', require('../../api/products/images'));
  app.get('/helloWorld', (_r, res) => res.send('OK'));
  app.use('/products', require('../../api/products/products'));
  app.use('/paddlingOut', require('../../api/weather/paddlingout'));
  app.use('/docs', require('../../api/core/docs'));
  app.use('/nearbyWater', require('../../api/weather/nearbyWater'));
  app.use('/paddleScore', require('../../api/weather/paddleScore'));
  app.use('/fastForecast', require('../../api/weather/fastForecast'));
  app.use('/forecast', require('../../api/weather/forecast').router);
  app.use('/smartlinks', require('../../api/kortex/kortex'));
  app.use('/public', require('../../api/kortex/publicApiRouter'));
  app.use('/', require('../../api/kortex/publicRouter'));
  app.use('/kreators', require('../../api/kreators/kreatorRoutes'));
  app.use('/gptActions', require('../../api/ai/gptActions'));
  app.use('/auth', require('../../api/auth/authRoutes'));
  app.use('/createPaymentIntent', require('../../api/checkout/router'));
  app.use('/billing', require('../../api/billing/router'));

  const { requireAuth, requireAdmin } = require('../../middleware/authMiddleware');
  app.post('/admin/updateOrderStatus', requireAuth, requireAdmin, require('../../api/admin/updateOrderStatus'));
  const { getOrder, listOrders } = require('../../api/admin/getOrder');
  app.get('/admin/getOrder', requireAuth, requireAdmin, getOrder);
  app.get('/admin/listOrders', requireAuth, requireAdmin, listOrders);
  app.use('/admin', require('../../api/admin/adminUsers'));

  return app;
}

module.exports = { buildTestApp, buildFullApp };
