/**
 * Every web origin Kaayko serves its own first-party pages from.
 *
 * Two independent controls consult this: the privileged-prefix CORS rule in
 * functions/index.js, and the checkout origin guard in
 * api/checkout/router.js. They used to hold separate hardcoded copies, which
 * meant adding a domain in one place and discovering the omission only when
 * checkout returned ORIGIN_NOT_ALLOWED from the new domain.
 *
 * kaay.store is the storefront's own domain. It serves the same store,
 * product, animal and cart pages as kaayko.com/store from a second Firebase
 * Hosting site, so it is first-party and must be able to reach checkout.
 */
const KAAYKO_WEB_ORIGINS = Object.freeze([
  'https://kaayko.com',
  'https://www.kaayko.com',
  'https://kaaykostore.web.app',
  'https://kaaykostore.firebaseapp.com',
  'https://kaay.store',
  'https://www.kaay.store',
  'https://kaay-store.web.app',
  'https://kaay-store.firebaseapp.com',
]);

/**
 * Firebase Hosting preview channels: https://kaaykostore--<channel>-<hash>.web.app
 * and https://kaay-store--<channel>-<hash>.web.app. Only someone who can deploy
 * to the project can mint one, so they carry the same trust as a production
 * deploy — and without them the checkout cannot be smoke-tested before it ships.
 */
const KAAYKO_PREVIEW_ORIGIN = /^https:\/\/(?:kaaykostore|kaay-store)--[a-z0-9-]+\.web\.app$/;

/** True for every origin Kaayko serves its own pages from, previews included. */
function isKaaykoOrigin(origin) {
  return typeof origin === 'string' && (KAAYKO_WEB_ORIGINS.includes(origin) || KAAYKO_PREVIEW_ORIGIN.test(origin));
}

module.exports = { KAAYKO_WEB_ORIGINS, KAAYKO_PREVIEW_ORIGIN, isKaaykoOrigin };
