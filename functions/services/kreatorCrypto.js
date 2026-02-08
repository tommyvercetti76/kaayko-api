/**
 * Kreator Crypto Utilities
 *
 * Pure token/password utilities - no Firebase dependency.
 * Handles: scrypt hashing, magic link tokens, password validation, session JWTs.
 *
 * @module services/kreatorCrypto
 */

const crypto = require('crypto');

// ── Constants ────────────────────────────────────────────────────────

const KREATOR_STATUS = {
  PENDING_PASSWORD: 'pending_password',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DEACTIVATED: 'deactivated'
};

const TOKEN_HASH_CONFIG = {
  keyLength: 64,
  saltLength: 32,
  scryptParams: { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
};

const MAGIC_LINK_EXPIRY_HOURS = {
  onboarding: 24,
  password_reset: 1,
  login: 1
};

const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
  specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?'
};

// ── Session secret ───────────────────────────────────────────────────

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET && process.env.FUNCTIONS_EMULATOR !== 'true') {
  console.error('[SECURITY] SESSION_SECRET environment variable is required in production');
}

function getSessionSecret() {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    return process.env.SESSION_SECRET || 'dev-only-secret-not-for-production';
  }
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable must be configured');
  }
  return process.env.SESSION_SECRET;
}

// ── Token hashing (scrypt) ───────────────────────────────────────────

/**
 * Hash a token using scrypt
 * @param {string} plainToken
 * @returns {{ hash: string, salt: string }}
 */
function hashToken(plainToken) {
  const salt = crypto.randomBytes(TOKEN_HASH_CONFIG.saltLength).toString('hex');
  const hash = crypto.scryptSync(
    plainToken, salt,
    TOKEN_HASH_CONFIG.keyLength,
    TOKEN_HASH_CONFIG.scryptParams
  ).toString('hex');
  return { hash, salt };
}

/**
 * Verify a token against stored hash (timing-safe)
 * @param {string} plainToken
 * @param {string} storedHash
 * @param {string} storedSalt
 * @returns {boolean}
 */
function verifyToken(plainToken, storedHash, storedSalt) {
  try {
    const computedHash = crypto.scryptSync(
      plainToken, storedSalt,
      TOKEN_HASH_CONFIG.keyLength,
      TOKEN_HASH_CONFIG.scryptParams
    ).toString('hex');
    return crypto.timingSafeEqual(
      Buffer.from(computedHash, 'hex'),
      Buffer.from(storedHash, 'hex')
    );
  } catch (error) {
    console.error('[Kreator] Token verification error:', error.message);
    return false;
  }
}

// ── Magic link generation ────────────────────────────────────────────

/**
 * Generate magic link token with hash
 * @param {string} purpose - 'onboarding' | 'password_reset' | 'login'
 * @returns {{ token: { code: string }, hash: string, salt: string, expiresAt: Date }}
 */
function generateMagicLinkToken(purpose = 'onboarding') {
  const randomPart = crypto.randomBytes(12).toString('base64url').substring(0, 16);
  const code = `ml_${randomPart}`;
  const { hash, salt } = hashToken(code);

  const expiresAt = new Date();
  const expiryHours = MAGIC_LINK_EXPIRY_HOURS[purpose] || 24;
  expiresAt.setHours(expiresAt.getHours() + expiryHours);

  return { token: { code }, hash, salt, expiresAt };
}

// ── Password validation ──────────────────────────────────────────────

/**
 * Validate password against requirements
 * @param {string} password
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePassword(password) {
  const errors = [];

  if (!password || typeof password !== 'string') {
    return { valid: false, errors: ['Password is required'] };
  }
  if (password.length < PASSWORD_REQUIREMENTS.minLength) {
    errors.push(`Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`);
  }
  if (password.length > PASSWORD_REQUIREMENTS.maxLength) {
    errors.push(`Password must not exceed ${PASSWORD_REQUIREMENTS.maxLength} characters`);
  }
  if (PASSWORD_REQUIREMENTS.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (PASSWORD_REQUIREMENTS.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (PASSWORD_REQUIREMENTS.requireNumber && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (PASSWORD_REQUIREMENTS.requireSpecial) {
    const specialRegex = new RegExp(
      `[${PASSWORD_REQUIREMENTS.specialChars.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}]`
    );
    if (!specialRegex.test(password)) {
      errors.push('Password must contain at least one special character (!@#$%^&*...)');
    }
  }
  return { valid: errors.length === 0, errors };
}

// ── Session tokens (JWT-like) ────────────────────────────────────────

/**
 * Create a session token for authenticated kreators
 * @param {string} uid - Kreator UID
 * @returns {string} Session token
 */
async function createSessionToken(uid) {
  const payload = {
    uid,
    role: 'kreator',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', getSessionSecret())
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

/**
 * Verify a session token
 * @param {string} token
 * @returns {Object|null} Decoded payload or null
 */
function verifySessionToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;

    const expectedSig = crypto.createHmac('sha256', getSessionSecret())
      .update(`${header}.${body}`)
      .digest('base64url');
    if (signature !== expectedSig) {
      console.error('[Kreator] Invalid token signature');
      return null;
    }

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      console.error('[Kreator] Token expired');
      return null;
    }
    return payload;
  } catch (error) {
    console.error('[Kreator] Token verification error:', error.message);
    return null;
  }
}

module.exports = {
  KREATOR_STATUS,
  TOKEN_HASH_CONFIG,
  MAGIC_LINK_EXPIRY_HOURS,
  PASSWORD_REQUIREMENTS,
  hashToken,
  verifyToken,
  generateMagicLinkToken,
  validatePassword,
  createSessionToken,
  verifySessionToken
};
