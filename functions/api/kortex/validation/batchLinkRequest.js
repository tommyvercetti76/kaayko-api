/**
 * Validation middleware for POST /api/public/smartlinks/batch
 * Ensures request contains a valid links array.
 */

function validateBatchRequest(req, res, next) {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      success: false,
      error: 'Request body must be a JSON object'
    });
  }

  const { links } = req.body;

  if (!Array.isArray(links)) {
    return res.status(400).json({
      success: false,
      error: 'links must be an array'
    });
  }

  if (links.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'links array must not be empty'
    });
  }

  if (links.length > 100) {
    return res.status(400).json({
      success: false,
      error: 'Maximum 100 links per batch request'
    });
  }

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    if (!link || typeof link !== 'object' || Array.isArray(link)) {
      return res.status(400).json({
        success: false,
        error: `links[${i}] must be a JSON object`
      });
    }

    if (!link.webDestination && !link.iosDestination && !link.androidDestination) {
      return res.status(400).json({
        success: false,
        error: `links[${i}] must have at least one destination`
      });
    }
  }

  next();
}

module.exports = validateBatchRequest;
