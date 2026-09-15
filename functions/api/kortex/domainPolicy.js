/**
 * Kortex destination-domain policy — one place every link-creation path shares.
 *
 * Rationale: the domain allowlist used to live only in the admin router, so the
 * public API, batch, and tenant-link paths could mint kaayko-branded links to
 * arbitrary domains. Enforcement now lives in the service layer (see
 * smartLinkService.createShortLink / updateShortLink) which calls
 * assertDestinationAllowed, so admin, API-key, batch, and tenant-link creation
 * all obey the same rule.
 *
 * Policy:
 *  - Default Kaayko tenant (kaayko-default): destinations must be on the Kaayko
 *    domain whitelist. Super-admins can bypass with an explicit flag.
 *  - Real tenants: if the tenant configured settings.allowedDomains, destinations
 *    must match it; otherwise the tenant's links are unrestricted (default-open),
 *    since a provisioned tenant is expected to link to its own properties.
 */

const { DEFAULT_TENANT_ID } = require('./tenantContext');

// Global Kaayko domain whitelist — these domains (and their subdomains) are the
// only destinations allowed for the default Kaayko tenant.
const KAAYKO_DOMAIN_WHITELIST = [
  'kaayko.com',
  'coolschools.kaayko.com',
  'alumni.kaayko.com',
  'blog.kaayko.com',
];

function hostMatches(host, domain) {
  return host === domain || host.endsWith('.' + domain);
}

function isWhitelistedDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return KAAYKO_DOMAIN_WHITELIST.some(d => hostMatches(host, d));
  } catch {
    return false;
  }
}

/**
 * Throw a coded error when a web destination is not allowed for the tenant.
 * No-op when there is no web destination or when bypass is set.
 *
 * @param {Object} opts
 * @param {string} [opts.webDestination] - Destination URL to validate.
 * @param {string} opts.tenantId - Owning tenant.
 * @param {string[]|null} [opts.allowedDomains] - Tenant settings.allowedDomains.
 * @param {boolean} [opts.bypass] - Super-admin custom-destination bypass.
 * @throws {Error} code DOMAIN_NOT_WHITELISTED | DOMAIN_NOT_ALLOWED | INVALID_URL
 */
/**
 * A short link that points at another short link is a loop waiting to happen
 * (and hides the real destination from the safety engine). Refused on every
 * path, super-admin included.
 */
function assertNotSelfLink(url) {
  let u;
  try { u = new URL(url); } catch { return; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const { SHORT_HOST, LEGACY_HOST } = require('./linkHosts');
  const isShortHost = host === SHORT_HOST;
  const isLegacyShortPath = host === LEGACY_HOST && /^\/l(\/|$)/.test(u.pathname);
  if (isShortHost || isLegacyShortPath) {
    const err = new Error('A link cannot point at another short link. Use the final destination instead.');
    err.code = 'SELF_LINK';
    throw err;
  }
}

function assertDestinationAllowed({ webDestination, tenantId, allowedDomains, bypass }) {
  if (!webDestination) return;
  assertNotSelfLink(webDestination);
  if (bypass) return;

  let host;
  try {
    host = new URL(webDestination).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    const err = new Error('Web destination is not a valid URL');
    err.code = 'INVALID_URL';
    throw err;
  }

  if (tenantId === DEFAULT_TENANT_ID) {
    if (!KAAYKO_DOMAIN_WHITELIST.some(d => hostMatches(host, d))) {
      const err = new Error('Destination domain is not on the Kaayko whitelist. Only approved Kaayko domains are allowed.');
      err.code = 'DOMAIN_NOT_WHITELISTED';
      throw err;
    }
    return;
  }

  if (Array.isArray(allowedDomains) && allowedDomains.length > 0) {
    if (!allowedDomains.some(d => hostMatches(host, d))) {
      const err = new Error(`Destination domain not allowed for this tenant. Allowed: ${allowedDomains.join(', ')}`);
      err.code = 'DOMAIN_NOT_ALLOWED';
      throw err;
    }
  }
}

module.exports = {
  KAAYKO_DOMAIN_WHITELIST,
  isWhitelistedDomain,
  assertDestinationAllowed,
};
