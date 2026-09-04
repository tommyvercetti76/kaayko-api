/**
 * Store policy copy — the statements that must read identically everywhere.
 *
 * Why this file exists: the FTC Mail, Internet, or Telephone Order Merchandise
 * Rule (16 CFR Part 435) binds a seller to the ship time it states — state
 * none and a 30-day default applies. Miss the stated time and the buyer must
 * get a delay notice with a revised date and the choice to consent or cancel
 * for a full refund. So the ship-time statement lives HERE, once:
 *
 *   • renderEmail() (./render.js) injects these values into every template, so
 *     orderConfirmation.html, shippingConfirmation.html and delayNotice.html
 *     cannot say different things.
 *   • The storefront (kaayko/src/cart.html) should carry the same sentence;
 *     SHIP_TIME_TEXT is exported so a test or build step can compare the two.
 *   • The delay-notice endpoint (../admin/orderNotices.js) uses the day counts
 *     to decide whether a revised date needs the buyer's express consent.
 */

const SHIP_DAYS = Object.freeze({ min: 5, max: 7 });       // business days until it ships
const DELIVERY_DAYS = Object.freeze({ min: 7, max: 14 });  // calendar days until it arrives

// The literal sentence customers see. Built from the numbers above so the
// prose and the arithmetic in orderNotices.js can never disagree.
const SHIP_TIME_TEXT =
  `Made to order — ships in ${SHIP_DAYS.min}–${SHIP_DAYS.max} business days, ` +
  `delivered within ${DELIVERY_DAYS.min}–${DELIVERY_DAYS.max}.`;

// A revised date more than this many days past the original promise needs the
// buyer's express consent (silence is not consent); inside it, silence keeps
// the order open. 16 CFR 435.2(b)(1).
const DELAY_CONSENT_DAYS = 30;

const RETURNS_WINDOW_TEXT = '30-day returns';
const RETURNS_POLICY_PATH = '/legal/returns';
const RETURNS_POLICY_URL = `https://kaayko.com${RETURNS_POLICY_PATH}`;
const SUPPORT_EMAIL = 'orders@kaayko.com';

/** Template variables every email may use; merged UNDER caller data by renderEmail(). */
function policyTemplateVars() {
  return {
    shipTimeText: SHIP_TIME_TEXT,
    returnsWindowText: RETURNS_WINDOW_TEXT,
    returnsUrl: RETURNS_POLICY_URL,
    supportEmail: SUPPORT_EMAIL
  };
}

module.exports = {
  SHIP_DAYS,
  DELIVERY_DAYS,
  SHIP_TIME_TEXT,
  DELAY_CONSENT_DAYS,
  RETURNS_WINDOW_TEXT,
  RETURNS_POLICY_PATH,
  RETURNS_POLICY_URL,
  SUPPORT_EMAIL,
  policyTemplateVars
};
