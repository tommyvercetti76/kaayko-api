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

module.exports = { KAAYKO_WEB_ORIGINS };
