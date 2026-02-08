/**
 * Shared auth error response builder.
 * @module middleware/authErrors
 */

/** Send a standardized auth error response. */
function authError(res, status, error, message, code) {
  return res.status(status).json({ success: false, error, message, code });
}

module.exports = { authError };
