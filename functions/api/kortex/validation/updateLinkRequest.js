/**
 * Validation middleware for PUT /api/public/smartlinks/:code
 * Ensures request body only contains allowed update fields.
 */

const ALLOWED_FIELDS = new Set([
  'title',
  'description',
  'webDestination',
  'iosDestination',
  'androidDestination',
  'destinations',
  'metadata',
  'metadataPatch',
  'utm',
  'enabled',
  'expiresAt',
  'destinationType',
  'campaignId',
  'requiresAuth',
  'audience',
  'source',
  'intent',
  'returnTo',
  'conversionGoal',
  'sourceRules'
]);

function validateUpdateRequest(req, res, next) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      error: 'Request body must be a JSON object'
    });
  }

  const keys = Object.keys(req.body);
  if (keys.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Request body must contain at least one field to update'
    });
  }

  const disallowed = keys.filter(k => !ALLOWED_FIELDS.has(k));
  if (disallowed.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Disallowed fields: ${disallowed.join(', ')}`,
      allowedFields: Array.from(ALLOWED_FIELDS)
    });
  }

  next();
}

module.exports = validateUpdateRequest;
