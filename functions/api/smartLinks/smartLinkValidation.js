/**
 * Smart Link Validation Utilities
 * Centralized validation logic for smart links
 */

/**
 * Generate a unique 6-character short code with 'lk' prefix (Branch-style)
 * @returns {string} Random alphanumeric code (e.g., "lk1ngp", "lk9xrf")
 */
function generateShortCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = 'lk';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Validate link ID format
 * @param {string} id - Link identifier
 * @returns {boolean} True if valid
 */
function isValidLinkId(id) {
  if (!id || typeof id !== 'string') return false;
  return /^[a-zA-Z0-9_-]{3,50}$/.test(id);
}

/**
 * Validate short code format
 * @param {string} code - Short code
 * @returns {boolean} True if valid
 */
function isValidShortCode(code) {
  if (!code || typeof code !== 'string') return false;
  // Allow alphanumeric, hyphens, and underscores (3-50 chars)
  return /^[a-zA-Z0-9_-]{3,50}$/.test(code);
}

/**
 * Validate content space
 * @param {string} space - Content space name
 * @returns {boolean} True if valid
 */
function isValidSpace(space) {
  const validSpaces = ['lake', 'product', 'category', 'store', 'reads', 'spot', 'qr', 'promo', 'custom'];
  return validSpaces.includes(space);
}

/**
 * Get list of all valid spaces
 * @returns {string[]} Array of valid space names
 */
function getValidSpaces() {
  return ['lake', 'product', 'category', 'store', 'reads', 'spot', 'qr', 'promo', 'custom'];
}

/**
 * Normalize UTM parameters
 * @param {Object} query - Query parameters
 * @returns {Object} Normalized UTM parameters
 */
function normalizeUTMs(query) {
  const UTM_WHITELIST = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  const normalized = {};
  
  for (const key of UTM_WHITELIST) {
    if (query[key]) {
      normalized[key] = String(query[key]).toLowerCase().slice(0, 100);
    }
  }
  
  return normalized;
}

module.exports = {
  generateShortCode,
  isValidLinkId,
  isValidShortCode,
  isValidSpace,
  getValidSpaces,
  normalizeUTMs
};
