const crypto = require('crypto');
/**
 * Client IP resolution for requests arriving through Firebase Hosting → Cloud Run.
 *
 * Why this exists: `req.ip` and `req.connection.remoteAddress` resolve to the
 * proxy (commonly ::ffff:127.0.0.1) once a request has passed through Hosting,
 * so every visitor collapses to one address. That silently broke unique-visitor
 * counting and made per-IP rate limits behave as a single global bucket.
 *
 * Why not `app.set('trust proxy', true)`: that makes Express take the LEFTMOST
 * X-Forwarded-For entry, which is supplied by the caller. Anyone can send
 * `X-Forwarded-For: 1.2.3.4` and Google's load balancer appends the real address
 * after it, so the leftmost value is attacker-controlled — fine for analytics
 * you don't mind being lied to about, not fine for rate limiting.
 *
 * Approach: walk the forwarded chain from the RIGHT (proxy-appended, therefore
 * trustworthy) and return the first address that is publicly routable. Injected
 * values sit to the left of the real one and are never reached.
 *
 * @module api/kortex/clientIp
 */

// Loopback, RFC1918, CGNAT, link-local, unique-local v6.
const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

function normalise(raw) {
  if (!raw) return null;
  let ip = String(raw).trim();
  if (!ip) return null;
  // Strip IPv6-mapped IPv4 prefix and any bracket/port decoration.
  if (ip.startsWith('[')) ip = ip.slice(1, ip.indexOf(']') === -1 ? undefined : ip.indexOf(']'));
  if (ip.toLowerCase().startsWith('::ffff:')) ip = ip.slice(7);
  // Trailing :port on a bare IPv4 (never strip from IPv6, which is colon-rich).
  if ((ip.match(/:/g) || []).length === 1 && ip.includes('.')) ip = ip.split(':')[0];
  return ip || null;
}

function isPublic(ip) {
  if (!ip) return false;
  if (ip === '::1' || ip === '0.0.0.0' || ip === 'unknown') return false;
  if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return false;
  if (PRIVATE_V4.some(rx => rx.test(ip))) return false;
  return true;
}

/**
 * Resolve the originating client IP.
 *
 * @param {import('express').Request} req
 * @returns {string|null} Public client IP, or null when none can be established.
 *   Callers must treat null as "unknown" rather than substituting a placeholder —
 *   a shared sentinel would re-create the single-bucket bug this module fixes.
 */
function getClientIp(req) {
  if (!req) return null;

  const chain = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map(normalise)
    .filter(Boolean);

  // Right-to-left: the rightmost entries were appended by infrastructure.
  for (let i = chain.length - 1; i >= 0; i--) {
    if (isPublic(chain[i])) return chain[i];
  }

  // Single-hop or direct-to-Run deployments.
  const direct = normalise(req.ip) || normalise(req.connection?.remoteAddress) ||
                 normalise(req.socket?.remoteAddress);
  return isPublic(direct) ? direct : null;
}

/** Salt for IP hashes: a dedicated secret, else derived from the guest pepper chain; never a public constant outside the emulator. */
function ipSalt() {
  if (process.env.KORTEX_IP_SALT) return process.env.KORTEX_IP_SALT;
  for (const key of ['KORTEX_ACCESS_PEPPER', 'KORTEX_LINK_SIGNING_SECRET', 'ADMIN_PASSPHRASE']) {
    if (process.env[key]) return crypto.createHash('sha256').update(`kortex-ip-salt:${process.env[key]}`).digest('hex');
  }
  if (process.env.FUNCTIONS_EMULATOR === 'true' || process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return 'kortex-ip-salt-emulator';
  return null;
}
/** HMAC of the client IP under the salt, 16 hex chars; null when no salt exists (never a guessable hash). */
function hashClientIp(ip) {
  if (!ip) return null;
  const salt = ipSalt();
  if (!salt) return null;
  return crypto.createHmac('sha256', salt).update(String(ip)).digest('hex').slice(0, 16);
}

module.exports = {
  hashClientIp,
  ipSalt, getClientIp, isPublic, normalise };
