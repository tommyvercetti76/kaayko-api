// File: functions/src/middleware/validation.js

/**
 * Validate paddlePredict query parameters
 */
function validatePaddlePredictQuery(req, res, next) {
  const { lat, lng, location } = req.query;
  const errors = [];

  // Must have either location OR coordinates (not both, not neither)
  const hasLocation = location && location.trim().length > 0;
  const hasCoordinates = lat !== undefined && lng !== undefined;

  if (!hasLocation && !hasCoordinates) {
    errors.push('Must provide either location or lat/lng coordinates');
  }
  if (hasLocation && hasCoordinates) {
    errors.push('Provide either location or coordinates, not both');
  }

  // Validate coordinates if provided
  if (hasCoordinates) {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    
    if (isNaN(latitude) || latitude < -90 || latitude > 90) {
      errors.push('lat must be a number between -90 and 90');
    }
    if (isNaN(longitude) || longitude < -180 || longitude > 180) {
      errors.push('lng must be a number between -180 and 180');
    }
  }

  // Validate location if provided
  if (hasLocation) {
    const locationStr = location.trim();
    if (locationStr.length < 2 || locationStr.length > 100) {
      errors.push('location must be between 2 and 100 characters');
    }
    if (!/^[a-zA-Z0-9\s\-\.,()]+$/.test(locationStr)) {
      errors.push('location contains invalid characters');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid input',
      details: errors
    });
  }

  // Set validated data
  req.validated = hasLocation 
    ? { location: location.trim() }
    : { lat: parseFloat(lat), lng: parseFloat(lng) };
    
  next();
}

/**
 * Validate enhance request body
 */
function validateEnhanceBody(req, res, next) {
  const { reports, preferences } = req.body;
  const errors = [];

  // Reports are now optional since we can fetch from paddlingReport API
  if (reports !== undefined) {
    // Validate reports array if provided
    if (!Array.isArray(reports)) {
      errors.push('reports must be an array');
    } else if (reports.length === 0) {
      errors.push('reports array cannot be empty');
    } else {
      reports.forEach((report, index) => {
        if (!report.id || typeof report.id !== 'string') {
          errors.push(`reports[${index}].id is required and must be a string`);
        }
        if (!report.name || typeof report.name !== 'string') {
          errors.push(`reports[${index}].name is required and must be a string`);
        }
        if (!report.conditions || typeof report.conditions !== 'object') {
          errors.push(`reports[${index}].conditions is required and must be an object`);
        } else {
          const { conditions } = report;
          ['temperature', 'windSpeed', 'beaufortScale', 'uvIndex', 'visibility'].forEach(field => {
            if (typeof conditions[field] !== 'number') {
              errors.push(`reports[${index}].conditions.${field} must be a number`);
            }
          });
          if (!Array.isArray(conditions.warnings)) {
            errors.push(`reports[${index}].conditions.warnings must be an array`);
          }
        }
      });
    }
  }

  // Validate preferences if provided
  if (preferences !== undefined) {
    if (typeof preferences !== 'object') {
      errors.push('preferences must be an object');
    } else {
      if (preferences.skillLevel && !['beginner', 'intermediate', 'advanced'].includes(preferences.skillLevel)) {
        errors.push('preferences.skillLevel must be one of: beginner, intermediate, advanced');
      }
      if (preferences.preferredConditions && !['calm', 'moderate', 'challenging'].includes(preferences.preferredConditions)) {
        errors.push('preferences.preferredConditions must be one of: calm, moderate, challenging');
      }
      if (preferences.timeOfDay && !['morning', 'afternoon', 'evening'].includes(preferences.timeOfDay)) {
        errors.push('preferences.timeOfDay must be one of: morning, afternoon, evening');
      }
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid input',
      details: errors
    });
  }

  req.validated = { reports, preferences };
  next();
}

module.exports = {
  validatePaddlePredictQuery,
  validateEnhanceBody
};