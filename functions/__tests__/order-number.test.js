/**
 * services/orderNumber.js — the number a customer can quote, and the token
 * behind their status link.
 */
require('./helpers/mockSetup');
const admin = require('firebase-admin');
const {
  allocateOrderNumber, isOrderNumber, normalizeOrderNumber, newStatusToken, tokensMatch, statusPath, statusUrl, FIRST
} = require('../services/orderNumber');

describe('allocateOrderNumber', () => {
  test('starts at KAAY-1001 and counts up, one per call', async () => {
    const db = admin.firestore();
    expect(await allocateOrderNumber(db)).toBe(`KAAY-${FIRST}`);
    expect(await allocateOrderNumber(db)).toBe(`KAAY-${FIRST + 1}`);
    expect(await allocateOrderNumber(db)).toBe(`KAAY-${FIRST + 2}`);
    expect(admin._mocks.docData['counters/orders'].next).toBe(FIRST + 3);
  });

  test('never goes below the floor even if the counter document was hand-edited', async () => {
    admin._mocks.docData['counters/orders'] = { next: 7 };
    expect(await allocateOrderNumber(admin.firestore())).toBe(`KAAY-${FIRST}`);
  });
});

describe('the number and the token', () => {
  test('isOrderNumber / normalizeOrderNumber accept what a person would type', () => {
    expect(isOrderNumber('KAAY-1042')).toBe(true);
    expect(isOrderNumber('KAAY-104')).toBe(false);
    expect(isOrderNumber('pi_3abc')).toBe(false);
    expect(normalizeOrderNumber('  kaay-1042 ')).toBe('KAAY-1042');
    expect(normalizeOrderNumber('KAAY-1042; drop table')).toBeNull();
    expect(normalizeOrderNumber('')).toBeNull();
  });

  test('tokens are long, unique and compared in constant time without throwing', () => {
    const a = newStatusToken();
    const b = newStatusToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(a).not.toBe(b);
    expect(tokensMatch(a, a)).toBe(true);
    expect(tokensMatch(a, b)).toBe(false);
    expect(tokensMatch(a, a.slice(0, -1))).toBe(false);   // length mismatch → false, no throw
    expect(tokensMatch('', '')).toBe(false);               // empty never matches
    expect(tokensMatch(undefined, 'x')).toBe(false);
  });

  test('the status link lives on kaay.store and carries the token as a query', () => {
    expect(statusPath('KAAY-1042', 'tok')).toBe('/order/KAAY-1042?t=tok');
    expect(statusUrl('KAAY-1042', 'tok')).toBe('https://kaay.store/order/KAAY-1042?t=tok');
  });
});
