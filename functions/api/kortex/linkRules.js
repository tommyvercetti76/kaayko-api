/**
 * Link rules: usage caps and expiry, as a property of any link.
 *
 *   limits: {
 *     maxClicks:   integer > 0 | null     stop after this many recorded clicks
 *     fallbackUrl: https URL | null       where visitors go once the link is over
 *                                         its cap or past its expiry; without one
 *                                         they see a 410 page
 *     version: 1
 *   }
 *
 * `expiresAt` stays where it has always lived (top level on the link); the
 * fallback applies to both conditions. Everything here is pure: the caller
 * passes the link document and the clock, so the decision is testable and
 * identical in all three resolvers.
 *
 * @module api/kortex/linkRules
 */

'use strict';

const MAX_CLICKS_CEILING = 10_000_000;
const URL_MAX = 2048;

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

function cleanUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > URL_MAX) throw validationError('Fallback URL is too long');
  let parsed;
  try { parsed = new URL(trimmed); } catch (_) { throw validationError('Fallback URL must be a full web address'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw validationError('Fallback URL must start with http or https');
  return parsed.toString();
}

/**
 * Normalise client input. `null`, `undefined`-free empty objects and objects
 * with neither field clear the limits.
 * @returns {{maxClicks: number|null, fallbackUrl: string|null, version: 1}|null}
 */
function normalizeLimits(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw validationError('Limits must be an object');

  let maxClicks = null;
  if (input.maxClicks !== undefined && input.maxClicks !== null && input.maxClicks !== '') {
    const n = Number(input.maxClicks);
    if (!Number.isInteger(n) || n < 1 || n > MAX_CLICKS_CEILING) throw validationError('Scan limit must be a whole number between 1 and 10,000,000');
    maxClicks = n;
  }
  const fallbackUrl = cleanUrl(input.fallbackUrl);
  if (maxClicks === null && fallbackUrl === null) return null;
  return { maxClicks, fallbackUrl, version: 1 };
}

function expiryDate(link) {
  const raw = link && link.expiresAt;
  if (!raw) return null;
  const date = raw.toDate ? raw.toDate() : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Decide whether a link is past its cap or expiry.
 * @param {object} link  short_links document
 * @param {Date} [now]
 * @returns {{over: false} | {over: true, reason: 'expired'|'clicks', fallbackUrl: string|null}}
 */
function evaluateLimits(link, now = new Date()) {
  const limits = (link && link.limits) || {};
  const fallbackUrl = typeof limits.fallbackUrl === 'string' && limits.fallbackUrl ? limits.fallbackUrl : null;

  const expiry = expiryDate(link);
  if (expiry && expiry < now) return { over: true, reason: 'expired', fallbackUrl };

  const maxClicks = Number(limits.maxClicks);
  if (Number.isInteger(maxClicks) && maxClicks > 0) {
    const count = Number(link.clickCount) || 0;
    if (count >= maxClicks) return { over: true, reason: 'clicks', fallbackUrl };
  }
  return { over: false };
}

function limitUrls(limits) {
  return limits && limits.fallbackUrl ? [limits.fallbackUrl] : [];
}

const OVER_LIMIT_COPY = Object.freeze({
  expired: { title: 'Link Expired', message: 'This link has expired and is no longer available.' },
  clicks: { title: 'Link Limit Reached', message: 'This link has been used the maximum number of times. Ask the sender for a fresh one.' }
});

module.exports = { normalizeLimits, evaluateLimits, limitUrls, expiryDate, OVER_LIMIT_COPY, MAX_CLICKS_CEILING };
