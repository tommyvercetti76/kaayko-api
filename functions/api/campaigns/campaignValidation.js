const VALID_STATUSES = new Set(['draft', 'active', 'paused', 'archived', 'expired']);
const VALID_ROLES = new Set(['owner', 'editor', 'viewer', 'link-operator']);
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const TYPE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

function cleanString(value, max = 120) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function normalizeSlug(value) {
  return cleanString(value, 32).toLowerCase();
}

function validateCampaignCreate(body = {}) {
  const name = cleanString(body.name, 120);
  const slug = normalizeSlug(body.slug || body.type);
  const type = cleanString(body.type || slug, 32).toLowerCase();
  const campaignId = cleanString(body.campaignId || slug, 80).toLowerCase();
  const status = cleanString(body.status || 'draft', 20).toLowerCase();

  const errors = [];
  if (!name) errors.push('Campaign name is required');
  if (!slug || !SLUG_PATTERN.test(slug)) errors.push('Campaign slug must be 1-32 chars: lowercase letters, numbers, hyphen, underscore');
  if (!type || !TYPE_PATTERN.test(type)) errors.push('Campaign type must start with a letter and use lowercase letters, numbers, hyphen, underscore');
  if (!campaignId || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(campaignId)) errors.push('Campaign ID must be 1-80 route-safe lowercase chars');
  if (!VALID_STATUSES.has(status)) errors.push('Invalid campaign status');

  if (errors.length) {
    const error = new Error('Invalid campaign request');
    error.code = 'VALIDATION_ERROR';
    error.details = errors;
    throw error;
  }

  return {
    campaignId,
    name,
    slug,
    type,
    status,
    description: cleanString(body.description, 500),
    defaultDestinations: normalizeDestinations(body.defaultDestinations || body.destinations || {}),
    settings: normalizeSettings(body.settings || {})
  };
}

function validateCampaignUpdate(body = {}) {
  const updates = {};
  if (body.name !== undefined) updates.name = cleanString(body.name, 120);
  if (body.description !== undefined) updates.description = cleanString(body.description, 500);
  if (body.defaultDestinations !== undefined || body.destinations !== undefined) {
    updates.defaultDestinations = normalizeDestinations(body.defaultDestinations || body.destinations || {});
  }
  if (body.settings !== undefined) updates.settings = normalizeSettings(body.settings || {});
  if (body.status !== undefined) {
    const status = cleanString(body.status, 20).toLowerCase();
    if (!VALID_STATUSES.has(status)) {
      const error = new Error('Invalid campaign status');
      error.code = 'VALIDATION_ERROR';
      error.details = ['Invalid campaign status'];
      throw error;
    }
    updates.status = status;
  }

  if (Object.keys(updates).length === 0) {
    const error = new Error('No campaign updates provided');
    error.code = 'VALIDATION_ERROR';
    error.details = ['At least one update field is required'];
    throw error;
  }

  return updates;
}

function validateMemberRole(role) {
  const normalized = cleanString(role, 30).toLowerCase();
  if (!VALID_ROLES.has(normalized)) {
    const error = new Error('Invalid campaign member role');
    error.code = 'VALIDATION_ERROR';
    error.details = ['Invalid campaign member role'];
    throw error;
  }
  return normalized;
}

function normalizeDestinations(destinations) {
  return {
    web: cleanString(destinations.web, 2000) || null,
    ios: cleanString(destinations.ios, 2000) || null,
    android: cleanString(destinations.android, 2000) || null
  };
}

function normalizeSettings(settings) {
  const normalized = { ...settings };
  delete normalized.tenantId;
  delete normalized.createdBy;
  delete normalized.ownerUids;
  if (normalized.maxUsesPerLink !== undefined) {
    normalized.maxUsesPerLink = Math.max(1, Math.min(100000, Number(normalized.maxUsesPerLink) || 1));
  }
  return normalized;
}

// ─── Campaign Link Validation ─────────────────────────────────────────────────

/**
 * Validate a campaign link code.
 * Must be 1–80 chars: lowercase letters, digits, hyphens, underscores.
 * May NOT contain the slug separator character `_` as a prefix to avoid
 * collision with the composite shortLinkCode format `{slug}_{code}`.
 * Leading/trailing hyphens are disallowed.
 */
const LINK_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,78}[a-z0-9]$|^[a-z0-9]$/;

function validateLinkCode(value) {
  const code = cleanString(value, 80).toLowerCase();
  if (!code || !LINK_CODE_PATTERN.test(code)) {
    const error = new Error('Invalid link code: must be 1-80 chars using lowercase letters, numbers, hyphens, underscores');
    error.code = 'VALIDATION_ERROR';
    error.details = ['Link code must match pattern: lowercase letters, numbers, hyphens, underscores (1-80 chars)'];
    throw error;
  }
  return code;
}

/**
 * Validate and normalise a campaign link create request.
 * All body-provided campaign/tenant fields are ignored; they are set server-side.
 */
function validateLinkCreate(body = {}) {
  const errors = [];

  const code = cleanString(body.code, 80).toLowerCase();
  if (!code || !LINK_CODE_PATTERN.test(code)) {
    errors.push('Link code must be 1-80 chars: lowercase letters, numbers, hyphens, underscores');
  }

  const destinations = normalizeDestinations(body.destinations || body.defaultDestinations || {});
  if (!destinations.web && !destinations.ios && !destinations.android) {
    errors.push('At least one destination (web, ios, or android) is required');
  }

  if (errors.length) {
    const error = new Error('Invalid campaign link request');
    error.code = 'VALIDATION_ERROR';
    error.details = errors;
    throw error;
  }

  return {
    code,
    destinations,
    utm: normalizeUTM(body.utm || {}),
    metadata: normalizeLinkMetadata(body.metadata || {}),
    title: cleanString(body.title || body.code, 120)
  };
}

/**
 * Validate a campaign link update request.
 * Only destinations, utm, metadata, and title are updatable.
 */
function validateLinkUpdate(body = {}) {
  const updates = {};

  if (body.destinations !== undefined || body.defaultDestinations !== undefined) {
    updates.destinations = normalizeDestinations(body.destinations || body.defaultDestinations || {});
  }
  if (body.utm !== undefined) {
    updates.utm = normalizeUTM(body.utm || {});
  }
  if (body.metadata !== undefined) {
    updates.metadata = normalizeLinkMetadata(body.metadata || {});
  }
  if (body.title !== undefined) {
    updates.title = cleanString(body.title, 120);
  }

  if (Object.keys(updates).length === 0) {
    const error = new Error('No campaign link updates provided');
    error.code = 'VALIDATION_ERROR';
    error.details = ['At least one updatable field is required: destinations, utm, metadata, title'];
    throw error;
  }

  return updates;
}

function normalizeUTM(utm = {}) {
  if (!utm || typeof utm !== 'object' || Array.isArray(utm)) return {};
  const UTM_KEYS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'source', 'medium', 'campaign', 'term', 'content']);
  const UTM_CANONICAL = {
    source: 'utm_source', medium: 'utm_medium', campaign: 'utm_campaign',
    term: 'utm_term', content: 'utm_content'
  };
  const result = {};
  for (const [k, v] of Object.entries(utm)) {
    if (!UTM_KEYS.has(k)) continue;
    const canonical = UTM_CANONICAL[k] || k;
    const val = cleanString(v, 100).toLowerCase();
    if (val) result[canonical] = val;
  }
  return result;
}

function normalizeLinkMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  // Strip server-owned fields from any client-provided metadata
  const clean = { ...metadata };
  delete clean.campaignId;
  delete clean.tenantId;
  delete clean.createdBy;
  delete clean.shortLinkCode;
  // Limit values to strings of reasonable length
  const result = {};
  for (const [k, v] of Object.entries(clean)) {
    if (typeof k === 'string' && k.length <= 50) {
      result[k] = cleanString(v, 500);
    }
  }
  return result;
}

module.exports = {
  validateCampaignCreate,
  validateCampaignUpdate,
  validateMemberRole,
  validateLinkCode,
  validateLinkCreate,
  validateLinkUpdate,
  VALID_STATUSES,
  VALID_ROLES
};
