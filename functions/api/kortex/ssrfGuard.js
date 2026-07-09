/**
 * SSRF guard for outbound webhook target URLs.
 *
 * Webhooks POST from inside the Cloud Functions network, so an attacker-controlled
 * target URL is an SSRF primitive (e.g. the GCP metadata server at 169.254.169.254).
 * This guard enforces https and rejects loopback / link-local / private / metadata
 * destinations by hostname and by IP literal.
 *
 * NOTE: This is a synchronous URL/IP-literal check. It does not resolve DNS, so a
 * hostname that resolves to a private address (DNS rebinding) is not caught here —
 * that requires a resolve-time re-check at send time and is tracked as a follow-up.
 */

const net = require('net');

function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true; // malformed → treat as unsafe
  if (p[0] === 0) return true;                       // 0.0.0.0/8
  if (p[0] === 10) return true;                      // 10.0.0.0/8
  if (p[0] === 127) return true;                     // loopback
  if (p[0] === 169 && p[1] === 254) return true;     // link-local + GCP metadata
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16.0.0/12
  if (p[0] === 192 && p[1] === 168) return true;     // 192.168.0.0/16
  if (p[0] >= 224) return true;                      // multicast / reserved
  return false;
}

function isPrivateIPv6(ip) {
  const low = ip.toLowerCase();
  return low === '::1' || low === '::' ||
    low.startsWith('fc') || low.startsWith('fd') ||  // unique local
    low.startsWith('fe80') ||                        // link-local
    low.startsWith('::ffff:');                       // IPv4-mapped (defer to v4 rules elsewhere)
}

/**
 * Throw a coded error when the URL is unsafe for an outbound webhook.
 * @param {string} rawUrl
 * @throws {Error} code INVALID_WEBHOOK_URL | INSECURE_WEBHOOK_URL | BLOCKED_WEBHOOK_URL
 */
function assertSafeWebhookUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    const err = new Error('Invalid webhook targetUrl');
    err.code = 'INVALID_WEBHOOK_URL';
    throw err;
  }

  if (u.protocol !== 'https:') {
    const err = new Error('Webhook targetUrl must use https');
    err.code = 'INSECURE_WEBHOOK_URL';
    throw err;
  }

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  const blockedHosts = new Set(['localhost', 'metadata.google.internal', 'metadata']);

  let blocked = blockedHosts.has(host) || host.endsWith('.localhost') || host.endsWith('.internal');
  if (!blocked) {
    const ipType = net.isIP(host);
    if (ipType === 4) blocked = isPrivateIPv4(host);
    else if (ipType === 6) blocked = isPrivateIPv6(host);
  }

  if (blocked) {
    const err = new Error('Webhook targetUrl points to a disallowed (private/internal) host');
    err.code = 'BLOCKED_WEBHOOK_URL';
    throw err;
  }
}

module.exports = { assertSafeWebhookUrl };
