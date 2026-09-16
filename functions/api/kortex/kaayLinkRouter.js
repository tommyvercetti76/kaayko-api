/**
 * kaay.link — the short-link host.
 *
 * Firebase Hosting site `kaay-link` rewrites every path to the `api`
 * function, so this router is mounted FIRST in index.js and claims every
 * request addressed to a link host. Nothing else on the API is reachable
 * through kaay.link: the only shapes served are
 *
 *   GET /                → 302 to the Kortex page
 *   GET /qr/<code>.png   → the link's QR image (same service as kaayko.com/qr)
 *   GET /<slug>          → resolve the link (same handler as kaayko.com/l/<code>)
 *
 * Everything else is a 404. Requests to any other host pass straight through
 * (`next('router')`), so kaayko.com behaviour is untouched.
 */

const express = require('express');
const admin = require('firebase-admin');
const { createRateLimitMiddleware, securityHeadersMiddleware } = require('../weather/sharedWeatherUtils');
const { handleRedirect, errorPage } = require('./redirectHandler');
const { serveLinkQr } = require('./qrService');
const hosts = require('./linkHosts');
const answers = require('./linkAnswers');

const router = express.Router();
const db = admin.firestore();

// Same ceiling as /l/ on kaayko.com: a classroom behind one NAT is never refused.
const MAX_REQUESTS_PER_MINUTE = 240;

// Host gate: not a link host → skip this whole router.
router.use((req, res, next) => {
  const host = hosts.requestHost(req);
  if (!hosts.isLinkHost(host)) return next('router');
  req.linkHost = host;
  next();
});

router.use(createRateLimitMiddleware(MAX_REQUESTS_PER_MINUTE));
router.use(securityHeadersMiddleware);

function notFound(res, message = 'This page does not exist.') {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).send(errorPage(404, 'Not Found', message, false));
}

router.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, hosts.ROOT_REDIRECT);
});

// The pages a buyer looks for on the short host live on kaayko.com.
const PAGES = { security: 'https://kaayko.com/kortex/security', status: 'https://kaayko.com/kortex/security#status', pricing: 'https://kaayko.com/kortex#pricing', terms: 'https://kaayko.com/legal/kortex-terms', privacy: 'https://kaayko.com/legal/kortex-terms#privacy', help: 'https://kaayko.com/kortex/support', support: 'https://kaayko.com/kortex/support' };
router.get('/:page(security|status|pricing|terms|privacy|help|support)', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.redirect(302, PAGES[req.params.page]);
});

router.get('/qr/:file', (req, res) => serveLinkQr(req, res).catch(err => {
  console.error('[kaay.link] QR failed:', err);
  if (!res.headersSent) res.status(500).json({ success: false, error: 'QR generation failed' });
}));

/**
 * Resolve the slug to a link code. Legacy generated codes are lowercase, but
 * admin-chosen codes may not be, so the exact slug is tried first and the
 * lowercase form second. Names (Phase 3) will slot in after these two reads.
 */
async function resolveSlug(slug) {
  const exact = await db.collection('short_links').doc(slug).get();
  if (exact.exists) return slug;
  const lower = slug.toLowerCase();
  if (lower !== slug) {
    const folded = await db.collection('short_links').doc(lower).get();
    if (folded.exists) return lower;
  }
  return null;
}

router.get('/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!hosts.isValidSlug(slug) || hosts.isReservedSlug(slug)) return notFound(res);
  try {
    const code = await resolveSlug(slug);
    if (!code) return notFound(res, `The link "${slug}" doesn't exist or has been removed.`);
    return handleRedirect(req, res, code, { trackAnalytics: true, host: req.linkHost, askPage: true });
  } catch (err) {
    console.error('[kaay.link] resolve failed:', err);
    if (!res.headersSent) return res.status(500).send(errorPage(500, 'Something went wrong', 'Please try again in a moment.', false));
  }
});

/**
 * The answer to a code's question. A plain form POST from the ask page;
 * the body is urlencoded and parsed here only, so the API's JSON parser
 * (mounted after this router) is not involved.
 */
router.post('/:slug/answer', express.urlencoded({ extended: false, limit: '2kb' }), async (req, res) => {
  const { slug } = req.params;
  res.setHeader('Cache-Control', 'no-store');
  if (!hosts.isValidSlug(slug) || hosts.isReservedSlug(slug)) return notFound(res);
  try {
    const code = await resolveSlug(slug);
    const snap = code ? await db.collection('short_links').doc(code).get() : null;
    const link = snap && snap.exists ? { code, ...snap.data() } : null;
    if (!link || !link.ask || link.enabled === false || (link.status && link.status !== 'active')) return notFound(res, 'This code is not asking anything right now.');
    const result = await answers.recordAnswer({ req, code, link, host: req.linkHost, body: req.body || {} });
    if (!result.ok) return res.status(400).send(errorPage(400, 'Pick one', 'Choose one of the answers and send again.', false));
    // Only the link's own destination may be continued to; the form's `go` is a hint, never trusted.
    const web = (link.destinations && link.destinations.web) || link.webDestination || null;
    const go = req.body && typeof req.body.go === 'string' && web && req.body.go.startsWith(web.split('?')[0]) ? req.body.go : web;
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'");
    return res.status(200).set('Content-Type', 'text/html; charset=utf-8').send(answers.thanksPage({ link, choice: result.choice, destination: go }));
  } catch (err) {
    console.error('[kaay.link] answer failed:', err);
    if (!res.headersSent) return res.status(500).send(errorPage(500, 'Something went wrong', 'Please scan again in a moment.', false));
  }
});

// Anything deeper, or any other method, is not a link.
router.all('*', (req, res) => notFound(res));

module.exports = router;
module.exports.resolveSlug = resolveSlug;
