/**
 * Kortex Smart Links API — Thin Router
 *
 * Mounts sub-routers, wires CRUD + analytics to kortexHandlers.
 * Route order matters: named routes BEFORE /:code catch-all.
 *
 * @module api/kortex/kortex
 */

const express = require('express');
const router = express.Router();

const { handleRedirect } = require('./redirectHandler');
const { requireAuth, requireAdmin } = require('../../middleware/authMiddleware');
const { botProtection, secureHeaders } = require('../../middleware/securityMiddleware');
const { honeypot } = require('../../middleware/securityUtils');
const {
  getStats, createLink, listLinks,
  getLink, updateLink, deleteLink, trackEvent
} = require('./kortexHandlers');

// Global security
router.use(secureHeaders);
router.use(botProtection);

// Honeypot traps (before sub-routers)
router.get('/admin/api-key', honeypot);
router.post('/admin/bulk-import', honeypot);
router.get('/export-all-data', honeypot);

// ── Sub-routers ──────────────────────────────────────────────────────
router.use('/', require('./tenantRoutes'));

// ── Named routes (BEFORE /:code catch-all) ───────────────────────────
router.get('/health', (req, res) => res.json({
  success: true, service: 'Kortex Smart Links API', status: 'healthy', timestamp: new Date().toISOString()
}));

router.get('/stats',       requireAuth, requireAdmin, getStats);
router.get('/r/:code',     (req, res) => handleRedirect(req, res, req.params.code, { trackAnalytics: false }));

router.post('/',           requireAuth, requireAdmin, createLink);
router.get('/',            requireAuth, requireAdmin, listLinks);

// ── /:code routes (AFTER named routes) ───────────────────────────────
router.get('/:code',       getLink);
router.put('/:code',       requireAuth, requireAdmin, updateLink);
router.delete('/:code',    requireAuth, requireAdmin, deleteLink);

// ── ROOTS sync proxy (keeps sync key server-side) ───────────────────
const ROOTS_API_BASE = 'https://cool-schools-api-420407869747.us-central1.run.app/api/v1/roots';

router.post('/roots-sync', requireAuth, requireAdmin, async (req, res) => {
  try {
    const syncKey = process.env.KORTEX_SYNC_KEY;
    if (!syncKey) return res.status(500).json({ error: 'KORTEX_SYNC_KEY not configured' });

    const response = await fetch(`${ROOTS_API_BASE}/invites/kortex-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kortex-Sync-Key': syncKey,
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json().catch(() => ({}));
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[roots-sync] proxy error:', err.message);
    res.status(502).json({ error: 'ROOTS sync proxy failed' });
  }
});

// ── Event tracking ───────────────────────────────────────────────────
router.post('/events/:type', trackEvent);

module.exports = router;
