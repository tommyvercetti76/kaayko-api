/**
 * Optional link fields that feed the insights: a placement label (where the
 * QR lives), the economics of a print run, and a campaign window. All pure,
 * all validated here and nowhere else.
 *
 * @module api/kortex/linkFields
 */

'use strict';

function validationError(message) { const e = new Error(message); e.code = 'VALIDATION_ERROR'; return e; }

const PLACEMENTS = ['poster', 'flyer', 'menu', 'table tent', 'badge', 'storefront', 'sticker', 'packaging', 'sign', 'email', 'instagram bio', 'website', 'sms', 'other'];

/** Free text, lowercase, ≤ 40 chars; null clears. */
function normalizePlacement(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'string') throw validationError('Placement must be text');
  const v = input.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
  return v || null;
}

/** { printCost, valuePerVisit, currency } — non-negative numbers; null clears. */
function normalizeEconomics(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw validationError('Economics must be an object');
  const num = (v, name) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) throw validationError(`${name} must be a number of zero or more`);
    return Math.round(n * 100) / 100;
  };
  const printCost = num(input.printCost, 'Print cost');
  const valuePerVisit = num(input.valuePerVisit, 'Value per visit');
  let currency = String(input.currency || 'USD').trim().toUpperCase().slice(0, 3);
  if (!/^[A-Z]{3}$/.test(currency)) currency = 'USD';
  if (printCost === null && valuePerVisit === null) return null;
  return { printCost, valuePerVisit, currency };
}

/** { startAt, endAt } ISO dates, start before end; null clears. */
function normalizeCampaignWindow(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw validationError('Campaign window must be an object');
  const parse = (v, name) => {
    if (v === undefined || v === null || v === '') return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw validationError(`${name} must be a date`);
    return d.toISOString();
  };
  const startAt = parse(input.startAt, 'Campaign start');
  const endAt = parse(input.endAt, 'Campaign end');
  if (!startAt && !endAt) return null;
  if (startAt && endAt && new Date(startAt) >= new Date(endAt)) throw validationError('Campaign start must be before its end');
  return { startAt, endAt };
}

module.exports = { PLACEMENTS, normalizePlacement, normalizeEconomics, normalizeCampaignWindow };
