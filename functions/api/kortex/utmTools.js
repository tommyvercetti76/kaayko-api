/**
 * UTM helpers shared by every resolver.
 *
 * Merge rule, in one sentence: tags already on the destination stay; the
 * link's own tags fill the gaps; a QR scan with no medium anywhere becomes
 * utm_medium=qr. Before this module the redirect overwrote whatever the
 * destination carried, which silently rewrote campaigns people had set up.
 *
 * @module api/kortex/utmTools
 */

'use strict';

const UTM_KEYS = Object.freeze(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']);
const QR_MARKER = 's';
const QR_MARKER_VALUE = 'qr';

/** Did this request arrive through a QR scan (served QR images carry ?s=qr)? */
function isQrScan(query = {}) {
  return String(query[QR_MARKER] || '').toLowerCase() === QR_MARKER_VALUE;
}

/** Short URL with the scan marker, for every QR image Kortex renders. */
function scanUrl(shortUrl) {
  try {
    const url = new URL(shortUrl);
    url.searchParams.set(QR_MARKER, QR_MARKER_VALUE);
    return url.toString();
  } catch (_) {
    return `${shortUrl}${shortUrl.includes('?') ? '&' : '?'}${QR_MARKER}=${QR_MARKER_VALUE}`;
  }
}

/**
 * Put clickId and UTM tags onto a destination without clobbering what it has.
 * @param {string} destination
 * @param {{clickId?: string|null, utm?: object, scanned?: boolean}} tracking
 */
function mergeTrackingIntoDestination(destination, tracking = {}) {
  const { clickId = null, utm = {}, scanned = false } = tracking;
  const tags = {};
  for (const key of UTM_KEYS) {
    const value = utm && utm[key];
    if (typeof value === 'string' && value.trim()) tags[key] = value.trim();
  }
  if (scanned && !tags.utm_medium) tags.utm_medium = 'qr';

  try {
    const url = new URL(destination);
    if (clickId && !url.searchParams.has('clickId')) url.searchParams.set('clickId', clickId);
    for (const [key, value] of Object.entries(tags)) {
      if (!url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    return url.toString();
  } catch (_) {
    // Unparseable destination: append only what is certainly absent.
    const present = new Set((destination.split('?')[1] || '').split('&').map(p => decodeURIComponent(p.split('=')[0])));
    const params = [];
    if (clickId && !present.has('clickId')) params.push(`clickId=${encodeURIComponent(clickId)}`);
    for (const [key, value] of Object.entries(tags)) {
      if (!present.has(key)) params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
    if (!params.length) return destination;
    return `${destination}${destination.includes('?') ? '&' : '?'}${params.join('&')}`;
  }
}

/**
 * Read the campaign tags a pasted URL already carries, and the URL without them.
 * Used by the API for validation and mirrored client-side for the forms.
 */
function decodeUtm(input) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch (_) { return { ok: false, tags: {}, cleanUrl: null }; }
  const tags = {};
  for (const key of UTM_KEYS) {
    const value = url.searchParams.get(key);
    if (value) { tags[key] = value; url.searchParams.delete(key); }
  }
  return { ok: true, tags, cleanUrl: url.toString(), hasTags: Object.keys(tags).length > 0 };
}

module.exports = { UTM_KEYS, QR_MARKER, isQrScan, scanUrl, mergeTrackingIntoDestination, decodeUtm };
