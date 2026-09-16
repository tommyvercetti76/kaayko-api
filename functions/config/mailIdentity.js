/**
 * config/mailIdentity.js — the Kaayko address family, one place.
 *
 * Every email leaves from an address that says which product wrote it, and
 * replies land in a mailbox a person reads. The family:
 *
 *   store     "Kaayko Store"        orders@kaayko.com    receipts, shipping, delays, refunds
 *   kortex    "Kortex by Kaayko"    kortex@kaayko.com    access codes, reports, link notices, support
 *   alumni    "Kaayko Alumni"       alumni@kaayko.com    interest-form verification
 *   kreator   "Kaayko Kreators"     kreators@kaayko.com  creator programme
 *   paddling  "Paddling Out"        paddling@kaayko.com  lake submissions, spot reviews
 *   contact   "Kaayko"              help@kaayko.com      general help; the human address on pages
 *   system    "Kaayko"              admin@kaayko.com     internal alerts to the owner (new order, new link, abuse)
 *   security  "Kaayko Security"     security@kaayko.com  disclosure, abuse reports
 *
 * Delivery is one Zoho mailbox (MAILBOX) sending over SMTP. Zoho only lets an
 * account send From itself or From an alias attached to it, so EVERY address
 * above must exist in Zoho as an alias of that mailbox (Zoho Mail admin →
 * Users → the mailbox → Mail Accounts → Email Aliases, then "send mail as").
 * Nothing here can check that; POST /admin/mail/identity-test sends one mail
 * per member so the owner can see which ones Zoho accepts.
 *
 * Overrides, all optional:
 *   MAIL_DOMAIN            the domain (default kaayko.com)
 *   MAIL_MAILBOX           the authenticated account (default rohan@<domain>)
 *   MAIL_FROM_<PRODUCT>    a full address for one member, e.g. MAIL_FROM_STORE
 *   MAIL_FROM              the trigger's global From override (mailSender.js)
 */
'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FAMILY = Object.freeze({
  store:    { local: 'orders',   name: 'Kaayko Store',     replyTo: 'store',   purpose: 'receipts, shipping, delays, refunds' },
  kortex:   { local: 'kortex',   name: 'Kortex by Kaayko', replyTo: 'kortex',  purpose: 'access codes, reports, link notices, support' },
  alumni:   { local: 'alumni',   name: 'Kaayko Alumni',    replyTo: 'alumni',  purpose: 'interest-form verification' },
  kreator:  { local: 'kreators', name: 'Kaayko Kreators',  replyTo: 'kreator', purpose: 'creator programme' },
  paddling: { local: 'paddling', name: 'Paddling Out',     replyTo: 'paddling', purpose: 'lake submissions, spot reviews' },
  contact:  { local: 'help',     name: 'Kaayko',           replyTo: 'contact', purpose: 'general help; the human address on pages' },
  system:   { local: 'admin',    name: 'Kaayko',           replyTo: 'contact', purpose: 'internal alerts to the owner' },
  security: { local: 'security', name: 'Kaayko Security',  replyTo: 'security', purpose: 'disclosure, abuse reports' }
});

const PRODUCTS = Object.freeze(Object.keys(FAMILY));

function domain() {
  const d = String(process.env.MAIL_DOMAIN || '').trim().toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : 'kaayko.com';
}

/** The authenticated Zoho account. Every family address is an alias of it. */
function mailbox() {
  const m = String(process.env.MAIL_MAILBOX || '').trim().toLowerCase();
  return EMAIL_RE.test(m) ? m : `rohan@${domain()}`;
}

function memberOf(product) {
  return FAMILY[product] ? product : 'contact';
}

/** Bare address for a product, e.g. orders@kaayko.com. */
function address(product) {
  const key = memberOf(product);
  const env = String(process.env[`MAIL_FROM_${key.toUpperCase()}`] || '').trim().toLowerCase();
  if (EMAIL_RE.test(env)) return env;
  return `${FAMILY[key].local}@${domain()}`;
}

/** RFC 5322 display form: "Kaayko Store" <orders@kaayko.com>. */
function formatted(product) {
  const key = memberOf(product);
  return `"${FAMILY[key].name.replace(/"/g, '')}" <${address(key)}>`;
}

/**
 * What a mail for `product` should carry.
 * @returns {{product:string, name:string, address:string, from:string, replyTo:string, inbox:string}}
 *   inbox: where a person reads replies for this product (the reply-to address).
 */
function identity(product) {
  const key = memberOf(product);
  const reply = address(FAMILY[key].replyTo);
  return { product: key, name: FAMILY[key].name, address: address(key), from: formatted(key), replyTo: reply, inbox: reply };
}

/**
 * Fill from/replyTo on a mail document from its product tag, keeping any the
 * caller set. A document without a product is general mail (contact).
 */
function stampIdentity(doc = {}) {
  const id = identity(doc.product);
  const out = { ...doc };
  if (!out.product) out.product = id.product;
  if (typeof out.from !== 'string' || !out.from.trim()) out.from = id.from;
  if (typeof out.replyTo !== 'string' || !out.replyTo.trim()) out.replyTo = id.replyTo;
  return out;
}

/** Every member with its live addresses, for the admin test and the docs. */
function family() {
  return PRODUCTS.map(p => ({ ...identity(p), purpose: FAMILY[p].purpose }));
}

module.exports = { FAMILY, PRODUCTS, domain, mailbox, address, formatted, identity, stampIdentity, family, EMAIL_RE };
