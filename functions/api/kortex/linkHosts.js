/**
 * Link hosts — the one place that knows which domains serve Kortex links.
 *
 * kaay.link is the short-link domain (15 Sep 2026). kaayko.com/l/<code> is
 * the legacy form every printed QR before that date encodes; it resolves
 * forever. Both hosts read the same `short_links` collection, so a code
 * works on either.
 *
 * On kaay.link the whole path is the link: `kaay.link/<slug>`. That host must
 * never expose anything else (the API, admin, pages), so everything that is
 * not `/`, `/qr/<code>.<png|svg>` or a single slug is a 404 there. The
 * reserved list keeps future pages on the domain from ever being shadowed by
 * a link name.
 */

const SHORT_HOST = 'kaay.link';
const LEGACY_HOST = 'kaayko.com';
const SHORT_BASE = `https://${SHORT_HOST}`;
const LEGACY_LINK_BASE = `https://${LEGACY_HOST}/l`;
/** QR images are served on both hosts; the short one is the canonical address. */
const QR_BASE = `${SHORT_BASE}/qr`;

/** Hosts that mean "this request is a kaay.link resolve". */
const LINK_HOSTS = Object.freeze([
  'kaay.link',
  'www.kaay.link',
  'kaay-link.web.app',
  'kaay-link.firebaseapp.com'
]);

/** Where `https://kaay.link/` itself goes. */
const ROOT_REDIRECT = 'https://kaayko.com/kortex';

/** First path segments a link may never claim on kaay.link. */
const RESERVED_SLUGS = Object.freeze([
  'api', 'qr', 'l', 'r', 'a', 'kortex', 'admin', 'login', 'logout', 'resolve', 'health',
  'support', 'report', 'appeal', 'terms', 'privacy', 'about', 'legal', 'help', 'status',
  'store', 'shop', 'cart', 'paddlingout', 'kutz', 'karma', 'roots', 'alumni', 'forge', 'reads',
  'kaayko', 'kaay', 'www', 'mail', 'app', 'apps', 'static', 'assets', 'fonts', 'img', 'images', 'js', 'css',
  'robots.txt', 'sitemap.xml', 'favicon.ico', 'manifest.json', '.well-known',
  'apple-app-site-association', 'assetlinks.json'
]);
const RESERVED = new Set(RESERVED_SLUGS);

/**
 * The host a request was addressed to. Firebase Hosting rewrites reach the
 * function with the original host; `x-forwarded-host` is consulted first in
 * case a proxy in between rewrote `host`.
 */
function requestHost(req) {
  const forwarded = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const raw = forwarded || String(req.headers.host || '');
  return raw.toLowerCase().replace(/:\d+$/, '');
}

function isLinkHost(host) {
  return LINK_HOSTS.includes(String(host || '').toLowerCase());
}

/** A slug that may be a code or (later) a name: 3–50 chars, letters/digits/-/_ with alphanumeric ends. */
function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,48}[a-zA-Z0-9]$/.test(slug);
}

function isReservedSlug(slug) {
  return RESERVED.has(String(slug || '').toLowerCase());
}

/** The public URL of a code on the short domain. */
function shortUrlFor(code) {
  return `${SHORT_BASE}/${encodeURIComponent(code)}`;
}

/** The QR image URL for a code. */
function qrUrlFor(code) {
  return `${QR_BASE}/${encodeURIComponent(code)}.png`;
}

module.exports = {
  SHORT_HOST,
  LEGACY_HOST,
  SHORT_BASE,
  LEGACY_LINK_BASE,
  QR_BASE,
  LINK_HOSTS,
  ROOT_REDIRECT,
  RESERVED_SLUGS,
  requestHost,
  isLinkHost,
  isValidSlug,
  isReservedSlug,
  shortUrlFor,
  qrUrlFor
};
