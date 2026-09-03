/**
 * Client-settable link fields.
 *
 * Every create and update path used to spread the raw request body into the
 * service layer, which let a caller set internal fields such as
 * `bypassDomainCheck`, `tenantId`, `status`, `safety` or `linkSignature`.
 * Routes now pick from these allowlists first; anything not listed is dropped
 * before the service sees it. Server-derived fields (tenant, creator, safety
 * verdict, status) are added by the route after picking.
 *
 * @module api/kortex/validation/linkInput
 */

'use strict';

const CREATE_FIELDS = Object.freeze([
  'title', 'description',
  'webDestination', 'iosDestination', 'androidDestination', 'destinations', 'destination',
  'code', 'shortCode', 'publicCode', 'namespace', 'pathNamespace', 'tenantSlug', 'alumniDomain',
  'utm', 'metadata', 'sourceRules', 'expiresAt', 'enabled',
  'destinationType', 'campaignId', 'requiresAuth', 'audience', 'source', 'intent',
  'returnTo', 'conversionGoal', 'destinationCategory', 'destinationTemplate',
  'generateQR', 'tags', 'schedule'
]);

const UPDATE_FIELDS = Object.freeze([
  'title', 'description',
  'webDestination', 'iosDestination', 'androidDestination', 'destinations',
  'utm', 'metadata', 'metadataPatch', 'sourceRules', 'expiresAt', 'enabled',
  'destinationType', 'campaignId', 'requiresAuth', 'audience', 'source', 'intent',
  'returnTo', 'conversionGoal', 'destinationCategory', 'destinationTemplate', 'tags', 'schedule'
]);

/** Fields a client must never be able to set, kept for documentation and tests. */
const PROTECTED_FIELDS = Object.freeze([
  'bypassDomainCheck', 'actorIsSuperAdmin', 'tenantId', 'tenantName', 'domain', 'pathPrefix',
  'apiKeyId', 'createdBy', 'linkSignature', 'status', 'safety', 'clickCount', 'installCount',
  'uniqueVisitCount', 'uniqueUsers', 'createdAt', 'updatedAt', 'isCampaignLink'
]);

function pick(body, fields) {
  const out = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out;
  for (const key of fields) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

/**
 * Legacy clients send destinations as top-level webDestination/iosDestination/
 * androidDestination; newer ones send a `destinations` object. Updates in the
 * service layer only read `destinations`, so fold the flat form into it.
 */
function foldDestinations(input) {
  const flat = {};
  if (input.webDestination !== undefined) flat.web = input.webDestination;
  if (input.iosDestination !== undefined) flat.ios = input.iosDestination;
  if (input.androidDestination !== undefined) flat.android = input.androidDestination;
  if (Object.keys(flat).length) {
    input.destinations = { ...(input.destinations || {}), ...flat };
  }
  return input;
}

function pickCreateInput(body) {
  return pick(body, CREATE_FIELDS);
}

function pickUpdateInput(body) {
  return foldDestinations(pick(body, UPDATE_FIELDS));
}

module.exports = { CREATE_FIELDS, UPDATE_FIELDS, PROTECTED_FIELDS, pickCreateInput, pickUpdateInput };
