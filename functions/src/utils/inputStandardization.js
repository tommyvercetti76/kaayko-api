// File: functions/src/utils/inputStandardization.js
//
// 🔧 INPUT STANDARDIZATION UTILITY  
//
// Standardizes API input parameters across all endpoints to ensure consistent
// developer experience and prevent confusion from different parameter names

/**
 * Standard parameter names and their accepted aliases
 */
const PARAMETER_ALIASES = {
  // Location coordinates - support multiple formats
  latitude: ['lat', 'latitude'],
  longitude: ['lng', 'lon', 'longitude'], 
  
  // Combined location formats
  location: ['location', 'coords', 'coordinates'],
  
  // Known spots/places
  spotId: ['spotId', 'spot', 'id'],
  
  // Search parameters
  radius: ['radius', 'distance', 'range'],
  limit: ['limit', 'count', 'max', 'maxResults']
};

/**
 * Default values for common parameters
 */
const DEFAULTS = {
  radius: 80, // km
  limit: 50,
  latitude: null,
  longitude: null
};

/**
 * Coordinate validation ranges
 */
const COORDINATE_LIMITS = {
  latitude: { min: -90, max: 90 },
  longitude: { min: -180, max: 180 }
};

/**
 * Parse location string in various formats:
 * - "lat,lng" 
 * - "lat, lng"
 * - "latitude,longitude"
 * @param {string} locationStr - Location string
 * @returns {object|null} {latitude, longitude} or null if invalid
 */
function parseLocationString(locationStr) {
  if (!locationStr || typeof locationStr !== 'string') {
    return null;
  }

  // Clean and split the location string
  const cleaned = locationStr.replace(/[^a-zA-Z0-9,.-]/g, '');
  const parts = cleaned.split(',').map(part => parseFloat(part.trim()));
  
  if (parts.length !== 2 || parts.some(isNaN)) {
    return null;
  }

  const [latitude, longitude] = parts;
  return { latitude, longitude };
}

/**
 * Validate coordinate values
 * @param {number} latitude 
 * @param {number} longitude 
 * @returns {object} {valid, errors}
 */
function validateCoordinates(latitude, longitude) {
  const errors = [];
  
  if (typeof latitude !== 'number' || isNaN(latitude)) {
    errors.push('Latitude must be a valid number');
  } else if (latitude < COORDINATE_LIMITS.latitude.min || latitude > COORDINATE_LIMITS.latitude.max) {
    errors.push(`Latitude must be between ${COORDINATE_LIMITS.latitude.min} and ${COORDINATE_LIMITS.latitude.max}`);
  }
  
  if (typeof longitude !== 'number' || isNaN(longitude)) {
    errors.push('Longitude must be a valid number');
  } else if (longitude < COORDINATE_LIMITS.longitude.min || longitude > COORDINATE_LIMITS.longitude.max) {
    errors.push(`Longitude must be between ${COORDINATE_LIMITS.longitude.min} and ${COORDINATE_LIMITS.longitude.max}`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Standardize API input parameters
 * Accepts multiple parameter formats and returns standardized object
 * 
 * @param {object} queryParams - Raw query parameters from req.query
 * @returns {object} Standardized parameters with validation
 */
function standardizeInputs(queryParams) {
  const result = {
    // Core location parameters
    latitude: null,
    longitude: null,
    spotId: null,
    
    // Search parameters  
    radius: DEFAULTS.radius,
    limit: DEFAULTS.limit,
    
    // Validation results
    valid: true,
    errors: [],
    warnings: []
  };

  // Extract latitude from various aliases
  for (const alias of PARAMETER_ALIASES.latitude) {
    if (queryParams[alias] !== undefined) {
      const value = parseFloat(queryParams[alias]);
      if (!isNaN(value)) {
        result.latitude = value;
        break;
      }
    }
  }

  // Extract longitude from various aliases
  for (const alias of PARAMETER_ALIASES.longitude) {
    if (queryParams[alias] !== undefined) {
      const value = parseFloat(queryParams[alias]);
      if (!isNaN(value)) {
        result.longitude = value;
        break;
      }
    }
  }

  // Extract combined location parameter
  for (const alias of PARAMETER_ALIASES.location) {
    if (queryParams[alias] !== undefined && result.latitude === null && result.longitude === null) {
      const parsed = parseLocationString(queryParams[alias]);
      if (parsed) {
        result.latitude = parsed.latitude;
        result.longitude = parsed.longitude;
        break;
      } else {
        result.errors.push(`Invalid location format: ${queryParams[alias]}. Expected: "lat,lng"`);
      }
    }
  }

  // Extract spotId from various aliases
  for (const alias of PARAMETER_ALIASES.spotId) {
    if (queryParams[alias] !== undefined) {
      result.spotId = queryParams[alias].toString();
      break;
    }
  }

  // Extract radius
  for (const alias of PARAMETER_ALIASES.radius) {
    if (queryParams[alias] !== undefined) {
      const value = parseFloat(queryParams[alias]);
      if (!isNaN(value) && value > 0) {
        result.radius = value;
        break;
      }
    }
  }

  // Extract limit
  for (const alias of PARAMETER_ALIASES.limit) {
    if (queryParams[alias] !== undefined) {
      const value = parseInt(queryParams[alias]);
      if (!isNaN(value) && value > 0) {
        result.limit = Math.min(value, 200); // Cap at 200
        break;
      }
    }
  }

  // Validate coordinates if provided
  if (result.latitude !== null && result.longitude !== null) {
    const validation = validateCoordinates(result.latitude, result.longitude);
    if (!validation.valid) {
      result.errors.push(...validation.errors);
      result.valid = false;
    }
  }

  // Check if we have valid location data
  const hasCoordinates = result.latitude !== null && result.longitude !== null;
  const hasSpotId = result.spotId !== null;
  
  if (!hasCoordinates && !hasSpotId) {
    result.errors.push('Location required: provide coordinates (lat,lng) or spotId');
    result.valid = false;
  }

  // Add warnings for deprecated parameters
  const deprecatedParams = ['coords', 'coordinates', 'spot', 'id'];
  for (const param of deprecatedParams) {
    if (queryParams[param] !== undefined) {
      result.warnings.push(`Parameter '${param}' is deprecated. Use standard names: lat, lng, spotId`);
    }
  }

  return result;
}

/**
 * Create standardized error response for invalid inputs
 * @param {object} inputResult - Result from standardizeInputs()
 * @param {string} endpoint - API endpoint name
 * @returns {object} Error response object
 */
function createInputErrorResponse(inputResult, endpoint) {
  return {
    success: false,
    error: 'Invalid input parameters',
    details: inputResult.errors,
    warnings: inputResult.warnings,
    usage: {
      endpoint: `/${endpoint}`,
      parameters: {
        location_methods: [
          'lat=42.3601&lng=-71.0589 (separate coordinates)',
          'location=42.3601,-71.0589 (combined coordinates)',  
          'spotId=merrimack (known spot ID)'
        ],
        optional: {
          radius: 'Search radius in km (default: 80)',
          limit: 'Maximum results (default: 50, max: 200)'
        }
      },
      examples: {
        coordinates: `/${endpoint}?lat=42.3601&lng=-71.0589`,
        location_string: `/${endpoint}?location=42.3601,-71.0589`,
        spot_id: `/${endpoint}?spotId=merrimack`,
        with_options: `/${endpoint}?lat=42.3601&lng=-71.0589&radius=50&limit=25`
      }
    }
  };
}

/**
 * Middleware to standardize inputs for all location-based APIs
 * @param {string} endpoint - API endpoint name for error messages
 * @returns {function} Express middleware function
 */
function createInputMiddleware(endpoint) {
  return (req, res, next) => {
    const standardized = standardizeInputs(req.query);
    
    if (!standardized.valid) {
      return res.status(400).json(createInputErrorResponse(standardized, endpoint));
    }
    
    // Attach standardized inputs to request
    req.standardizedInputs = standardized;
    
    // Log warnings if any
    if (standardized.warnings.length > 0) {
      console.log(`⚠️ Input warnings for /${endpoint}:`, standardized.warnings);
    }
    
    next();
  };
}

module.exports = {
  standardizeInputs,
  createInputErrorResponse,
  createInputMiddleware,
  parseLocationString,
  validateCoordinates,
  PARAMETER_ALIASES,
  DEFAULTS,
  COORDINATE_LIMITS
};
