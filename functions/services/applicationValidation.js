// Application Validation – constants and input validation for kreator applications

const crypto = require('crypto');

const APPLICATION_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired'
};

const APPLICATION_EXPIRY_DAYS = 30;

const VALID_PRODUCT_CATEGORIES = [
  'apparel', 'souvenirs', 'coaching', 'consulting',
  'digital', 'art', 'fitness', 'sports', 'courses', 'other'
];

const VALID_BUSINESS_TYPES = [
  'sole_proprietor', 'llc', 'corporation',
  'partnership', 'individual_maker', 'manufacturer'
];

/** Generate a unique application ID (format: app_XXXXXXXXXX) */
function generateApplicationId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'app_';
  for (let i = 0; i < 10; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/** Validate seller application data */
function validateApplication(data) {
  const errors = [];

  // Personal info
  if (!data.firstName || typeof data.firstName !== 'string' || data.firstName.trim().length < 1)
    errors.push('First name is required');
  if (!data.lastName || typeof data.lastName !== 'string' || data.lastName.trim().length < 1)
    errors.push('Last name is required');
  if (!data.email || typeof data.email !== 'string')
    errors.push('Email is required');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
    errors.push('Invalid email format');
  if (!data.phone || typeof data.phone !== 'string')
    errors.push('Phone number is required');
  else if (!/^\+?[\d\s\-()]{7,20}$/.test(data.phone))
    errors.push('Invalid phone number format');

  // Business info
  if (!data.businessName || typeof data.businessName !== 'string' || data.businessName.trim().length < 2)
    errors.push('Business/Brand name is required (minimum 2 characters)');
  if (!data.businessType || !VALID_BUSINESS_TYPES.includes(data.businessType))
    errors.push('Valid business type is required');
  if (data.website) {
    try { new URL(data.website); } catch { errors.push('Invalid website URL format'); }
  }

  // Product info
  if (!data.productCategories || !Array.isArray(data.productCategories) || data.productCategories.length === 0) {
    errors.push('At least one product category is required');
  } else {
    const invalid = data.productCategories.filter(c => !VALID_PRODUCT_CATEGORIES.includes(c));
    if (invalid.length > 0) errors.push(`Invalid product categories: ${invalid.join(', ')}`);
  }
  if (!data.productDescription || typeof data.productDescription !== 'string')
    errors.push('Product description is required');
  else if (data.productDescription.length < 50)
    errors.push('Product description must be at least 50 characters');
  else if (data.productDescription.length > 2000)
    errors.push('Product description must not exceed 2000 characters');
  if (!data.productCount) errors.push('Product count range is required');
  if (!data.priceRange) errors.push('Price range is required');

  // Operations info
  if (!data.location || typeof data.location !== 'string' || data.location.trim().length < 3)
    errors.push('Business location is required');
  if (!data.shippingCapability) errors.push('Shipping capability is required');
  if (!data.fulfillmentTime) errors.push('Fulfillment time is required');
  if (!data.inventoryManagement) errors.push('Inventory management approach is required');

  // Agreements
  if (!data.agreedToTerms) errors.push('You must agree to the Seller Terms & Conditions');
  if (!data.confirmedAuthenticity) errors.push('You must confirm product authenticity');

  return { valid: errors.length === 0, errors };
}

module.exports = {
  APPLICATION_STATUS,
  APPLICATION_EXPIRY_DAYS,
  VALID_PRODUCT_CATEGORIES,
  VALID_BUSINESS_TYPES,
  generateApplicationId,
  validateApplication
};
