/**
 * Validation middleware for DELETE /api/public/smartlinks/:code
 * Ensures the code param is present and valid format.
 */

function validateDeleteRequest(req, res, next) {
  const { code } = req.params;

  if (!code || typeof code !== 'string' || code.length < 3 || code.length > 50) {
    return res.status(400).json({
      success: false,
      error: 'Invalid link code'
    });
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$/.test(code)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid link code format'
    });
  }

  next();
}

module.exports = validateDeleteRequest;
