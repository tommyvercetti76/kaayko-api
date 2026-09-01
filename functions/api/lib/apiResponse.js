// functions/api/lib/apiResponse.js
//
// One error contract for the paddling API surface. The audit found five
// incompatible error shapes (and a /forecast that returned HTTP 200 on
// failure), which makes uptime monitoring and third-party clients guess.
//
// Envelope:
//   { success: false, error: <human message>, code: <STABLE_MACHINE_CODE>,
//     details?: <object>, requestId?: <string> }
//
// Codes are part of the public contract — add new ones, never repurpose.

const ERROR_CODES = {
  BAD_REQUEST:        { status: 400, message: 'Invalid request' },
  BAD_COORDS:         { status: 400, message: 'lat/lng must be finite coordinates' },
  MISSING_PARAM:      { status: 400, message: 'Required parameter missing' },
  UNAUTHORIZED:       { status: 401, message: 'Authentication required' },
  FORBIDDEN:          { status: 403, message: 'Not permitted' },
  NOT_FOUND:          { status: 404, message: 'Not found' },
  RATE_LIMITED:       { status: 429, message: 'Rate limit reached' },
  INTERNAL:           { status: 500, message: 'Server error' },
  UPSTREAM_UNAVAILABLE:{ status: 502, message: 'Upstream data source unavailable' },
  SERVICE_UNAVAILABLE:{ status: 503, message: 'Service temporarily unavailable' }
};

/**
 * Send a standardized error. `code` drives the HTTP status unless overridden.
 * Never leaks raw provider/Firestore errors — pass `details` deliberately.
 */
function sendError(res, code, message, details) {
  const spec = ERROR_CODES[code] || ERROR_CODES.INTERNAL;
  const body = {
    success: false,
    error: message || spec.message,
    code: ERROR_CODES[code] ? code : 'INTERNAL'
  };
  if (details && typeof details === 'object') body.details = details;
  return res.status(spec.status).json(body);
}

/**
 * Cache-Control for GETs that are safe to serve from a shared cache/CDN.
 * The paddle score cache turns over every 15 minutes, so 60s public with a
 * short stale window keeps the CDN useful without ever showing a stale verdict
 * for long.
 */
function setPublicCache(res, seconds = 60, staleSeconds = 120) {
  res.set('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${staleSeconds}`);
}

module.exports = { ERROR_CODES, sendError, setPublicCache };
