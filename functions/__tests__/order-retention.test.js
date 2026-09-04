/**
 * Monthly data-retention job — scheduled/orderRetention.js.
 *
 * Uses the shared firebase-admin mock for every behavioural test. That mock
 * ignores range filters, orderBy and startAfter, which is exactly why the job
 * re-checks every document's age in memory before touching it — the tests
 * below seed young and old documents side by side to prove that check holds.
 * Real cursor pagination is covered separately with a small in-memory
 * Firestore double that honours where/orderBy/limit/startAfter.
 */

require('./helpers/mockSetup');
const admin = require('firebase-admin');
const retention = require('../scheduled/orderRetention');
const { runRetentionOnce, orderRetention, planRedaction, toMillis, resolveConfig, DEFAULTS } = retention;

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 4, 12, 0, 0); // 2026-09-04T12:00:00Z
const ts = (daysAgo) => admin.firestore.Timestamp.fromMillis(NOW - daysAgo * DAY);
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

const ADDRESS = { name: 'Rohan Ramekar', line1: '5205 Tuskegee Trail', line2: null, city: 'McKinney', state: 'TX', postal_code: '75070', country: 'US' };

function seedOrder(id, createdAt, extra = {}) {
  admin._mocks.docData[`orders/${id}`] = {
    orderId: id,
    parentOrderId: 'pi_parent',
    productId: 'prod-1',
    productTitle: 'River Tee',
    size: 'M',
    gender: 'Male',
    quantity: 2,
    unitPriceCents: 3499,
    lineTotalCents: 6998,
    currency: 'usd',
    orderStatus: 'shipped',
    fulfillmentStatus: 'shipped',
    paymentStatus: 'paid',
    paymentMethod: 'card',
    chargeId: 'ch_test_123',
    trackingNumber: '1Z999',
    customerEmail: 'buyer@example.com',
    customerPhone: '+15551234567',
    customerName: 'Rohan Ramekar',
    shippingAddress: { ...ADDRESS },
    dataRetentionConsent: true,
    createdAt,
    ...extra
  };
  return admin._mocks.docData[`orders/${id}`];
}

function seedIntent(id, createdAt, extra = {}) {
  admin._mocks.docData[`payment_intents/${id}`] = {
    paymentIntentId: id,
    items: [{ productId: 'prod-1', productTitle: 'River Tee', size: 'M', gender: 'Male', quantity: 2, unitPriceCents: 3499, lineTotalCents: 6998 }],
    subtotalCents: 6998,
    taxCents: 577,
    totalCents: 7575,
    currency: 'usd',
    status: 'succeeded',
    paymentStatus: 'succeeded',
    taxCalculationId: 'taxcalc_1',
    taxTransactionId: 'tax_txn_1',
    taxJurisdiction: { country: 'US', state: 'TX', taxable: true },
    chargeId: 'ch_test_123',
    customerEmail: 'buyer@example.com',
    customerPhone: '+15551234567',
    shippingAddress: { ...ADDRESS },
    createdAt,
    ...extra
  };
  return admin._mocks.docData[`payment_intents/${id}`];
}

function seedMail(id, createdAt) {
  admin._mocks.docData[`mail/${id}`] = { to: 'buyer@example.com', message: { subject: 'Order', html: '<p>5205 Tuskegee Trail</p>' }, createdAt };
}
function seedEvent(id, processedAt) {
  admin._mocks.docData[`stripe_events/${id}`] = { eventId: id, type: 'payment_intent.succeeded', processedAt };
}
function seedFailure(id, createdAt) {
  admin._mocks.docData[`webhook_failures/${id}`] = { eventId: id, error: 'no items', permanent: true, createdAt };
}

const doc = (path) => admin._mocks.docData[path];

beforeEach(() => {
  admin._mocks.resetAll();
  delete process.env.RETENTION_PII_DAYS;
  delete process.env.MAIL_RETENTION_DAYS;
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PII redaction on orders and payment_intents', () => {
  test('strips the person, keeps the transaction, on records older than 730 days', async () => {
    seedOrder('old_item1', ts(731));
    seedOrder('young_item1', ts(729));
    seedIntent('pi_old', ts(800));
    seedIntent('pi_young', ts(10));

    const summary = await runRetentionOnce({ now: NOW });

    const old = doc('orders/old_item1');
    expect(old.customerEmail).toBeNull();
    expect(old.customerPhone).toBeNull();
    expect(old.customerName).toBeNull();
    expect(old.shippingAddress).toEqual({ redacted: true, redactedAt: new Date(NOW).toISOString() });
    expect(old.piiRedacted).toBe(true);
    expect(old.piiRedactedAt).toBe(new Date(NOW).toISOString());
    expect(old.piiRedactedFields.sort()).toEqual(['customerEmail', 'customerName', 'customerPhone', 'shippingAddress']);
    // Everything that makes it a financial record survives
    expect(old).toMatchObject({
      orderId: 'old_item1', parentOrderId: 'pi_parent', productId: 'prod-1', productTitle: 'River Tee',
      size: 'M', gender: 'Male', quantity: 2, unitPriceCents: 3499, lineTotalCents: 6998, currency: 'usd',
      orderStatus: 'shipped', fulfillmentStatus: 'shipped', paymentStatus: 'paid', paymentMethod: 'card',
      chargeId: 'ch_test_123', trackingNumber: '1Z999', dataRetentionConsent: true
    });

    const young = doc('orders/young_item1');
    expect(young.customerEmail).toBe('buyer@example.com');
    expect(young.shippingAddress).toEqual(ADDRESS);
    expect(young.piiRedacted).toBeUndefined();

    const oldPi = doc('payment_intents/pi_old');
    expect(oldPi.customerEmail).toBeNull();
    expect(oldPi.customerPhone).toBeNull();
    expect(oldPi.shippingAddress).toEqual({ redacted: true, redactedAt: new Date(NOW).toISOString() });
    expect(oldPi).toMatchObject({
      subtotalCents: 6998, taxCents: 577, totalCents: 7575, taxCalculationId: 'taxcalc_1', taxTransactionId: 'tax_txn_1',
      taxJurisdiction: { country: 'US', state: 'TX', taxable: true }, chargeId: 'ch_test_123',
      status: 'succeeded', paymentStatus: 'succeeded'
    });
    expect(oldPi.items).toHaveLength(1);

    expect(doc('payment_intents/pi_young').customerEmail).toBe('buyer@example.com');

    expect(summary.collections.orders.redacted).toBe(1);
    expect(summary.collections.payment_intents.redacted).toBe(1);
  });

  test('is idempotent: a second run redacts nothing and leaves the original redactedAt alone', async () => {
    seedOrder('old_item1', ts(1000));
    seedIntent('pi_old', ts(1000));

    const first = await runRetentionOnce({ now: NOW });
    const firstStamp = doc('orders/old_item1').piiRedactedAt;
    expect(first.collections.orders.redacted).toBe(1);

    const second = await runRetentionOnce({ now: NOW + 30 * DAY });
    expect(second.collections.orders.redacted).toBe(0);
    expect(second.collections.orders.alreadyRedacted).toBe(1);
    expect(second.collections.payment_intents.redacted).toBe(0);
    expect(doc('orders/old_item1').piiRedactedAt).toBe(firstStamp);
    expect(doc('orders/old_item1').shippingAddress.redactedAt).toBe(firstStamp);
  });

  test('records that never held PII are left untouched (no marker, no write)', async () => {
    seedOrder('anon_item1', ts(900), { customerEmail: null, customerPhone: null, customerName: undefined, shippingAddress: null });
    delete admin._mocks.docData['orders/anon_item1'].customerName;

    const summary = await runRetentionOnce({ now: NOW });

    expect(doc('orders/anon_item1').piiRedacted).toBeUndefined();
    expect(summary.collections.orders.redacted).toBe(0);
    expect(summary.collections.orders.nothingToRedact).toBe(1);
  });

  test('handles the legacy ISO-string createdAt schema', async () => {
    seedOrder('legacy_old', iso(740));
    seedOrder('legacy_young', iso(5));

    await runRetentionOnce({ now: NOW });

    expect(doc('orders/legacy_old').customerEmail).toBeNull();
    expect(doc('orders/legacy_young').customerEmail).toBe('buyer@example.com');
  });

  test('never touches a document whose age cannot be established', async () => {
    seedOrder('undated', undefined);
    delete admin._mocks.docData['orders/undated'].createdAt;
    seedOrder('garbage_date', 'not a date');

    const summary = await runRetentionOnce({ now: NOW });

    expect(doc('orders/undated').customerEmail).toBe('buyer@example.com');
    expect(doc('orders/garbage_date').customerEmail).toBe('buyer@example.com');
    expect(summary.collections.orders.redacted).toBe(0);
  });

  test('the cutoff is exclusive: exactly 730 days old is not yet redacted', async () => {
    seedOrder('boundary', ts(730));
    await runRetentionOnce({ now: NOW });
    expect(doc('orders/boundary').customerEmail).toBe('buyer@example.com');
  });

  test('NEVER deletes an order or payment_intents document, however old', async () => {
    seedOrder('ancient_item1', ts(5000));
    seedIntent('pi_ancient', ts(5000));

    await runRetentionOnce({ now: NOW });

    expect(doc('orders/ancient_item1')).toBeDefined();
    expect(doc('payment_intents/pi_ancient')).toBeDefined();
    expect(doc('orders/ancient_item1').lineTotalCents).toBe(6998);
  });
});

describe('Expiring collections', () => {
  test('deletes mail older than 90 days and keeps the rest', async () => {
    seedMail('pi_a_customer', ts(91));
    seedMail('pi_a_admin', ts(91));
    seedMail('pi_b_customer', ts(89));
    seedMail('pi_c_admin', ts(1));

    const summary = await runRetentionOnce({ now: NOW });

    expect(doc('mail/pi_a_customer')).toBeUndefined();
    expect(doc('mail/pi_a_admin')).toBeUndefined();
    expect(doc('mail/pi_b_customer')).toBeDefined();
    expect(doc('mail/pi_c_admin')).toBeDefined();
    expect(summary.collections.mail.deleted).toBe(2);
  });

  test('deletes stripe_events and webhook_failures older than 400 days', async () => {
    seedEvent('evt_old', ts(401));
    seedEvent('evt_young', ts(399));
    seedFailure('evt_fail_old', ts(500));
    seedFailure('evt_fail_young', ts(30));

    const summary = await runRetentionOnce({ now: NOW });

    expect(doc('stripe_events/evt_old')).toBeUndefined();
    expect(doc('stripe_events/evt_young')).toBeDefined();
    expect(doc('webhook_failures/evt_fail_old')).toBeUndefined();
    expect(doc('webhook_failures/evt_fail_young')).toBeDefined();
    expect(summary.collections.stripe_events.deleted).toBe(1);
    expect(summary.collections.webhook_failures.deleted).toBe(1);
  });

  test('undated mail is never deleted', async () => {
    admin._mocks.docData['mail/nodate'] = { to: 'x@example.com', message: { subject: 's' } };
    await runRetentionOnce({ now: NOW });
    expect(doc('mail/nodate')).toBeDefined();
  });
});

describe('Configuration', () => {
  test('defaults are 730 / 90 / 400 days', () => {
    expect(resolveConfig({})).toEqual({ piiDays: 730, mailDays: 90, eventDays: 400 });
    expect(DEFAULTS).toEqual({ RETENTION_PII_DAYS: 730, MAIL_RETENTION_DAYS: 90, EVENT_RETENTION_DAYS: 400 });
  });

  test('RETENTION_PII_DAYS and MAIL_RETENTION_DAYS shorten the windows', async () => {
    process.env.RETENTION_PII_DAYS = '365';
    process.env.MAIL_RETENTION_DAYS = '30';
    seedOrder('one_year', ts(400));
    seedMail('m_45d', ts(45));

    const summary = await runRetentionOnce({ now: NOW });

    expect(doc('orders/one_year').customerEmail).toBeNull();
    expect(doc('mail/m_45d')).toBeUndefined();
    expect(summary.config).toMatchObject({ piiDays: 365, mailDays: 30 });
  });

  test('a dangerous or malformed value falls back to the default', async () => {
    process.env.RETENTION_PII_DAYS = '0';
    process.env.MAIL_RETENTION_DAYS = 'soon';
    seedOrder('recent', ts(3));
    seedMail('m_recent', ts(3));

    const summary = await runRetentionOnce({ now: NOW });

    expect(doc('orders/recent').customerEmail).toBe('buyer@example.com');
    expect(doc('mail/m_recent')).toBeDefined();
    expect(summary.config).toMatchObject({ piiDays: 730, mailDays: 90 });
  });
});

describe('Run summary', () => {
  test('writes retention_runs/{date} with per-collection counts', async () => {
    seedOrder('old_item1', ts(800));
    seedOrder('young_item1', ts(1));
    seedIntent('pi_old', ts(800));
    seedMail('m_old', ts(100));
    seedEvent('evt_old', ts(450));
    seedFailure('f_young', ts(10));

    const summary = await runRetentionOnce({ now: NOW });
    const written = doc('retention_runs/2026-09-04');

    expect(written).toBeDefined();
    expect(written).toEqual(summary);
    expect(written.date).toBe('2026-09-04');
    expect(written.runId).toBe('2026-09-04T12:00:00.000Z');
    expect(written.complete).toBe(true);
    expect(written.stoppedEarly).toBe(false);
    expect(written.errors).toEqual([]);
    expect(written.cutoffs).toEqual({
      pii: new Date(NOW - 730 * DAY).toISOString(),
      mail: new Date(NOW - 90 * DAY).toISOString(),
      events: new Date(NOW - 400 * DAY).toISOString()
    });
    expect(written.collections.orders).toMatchObject({ scanned: 2, redacted: 1, skippedTooYoung: 1 });
    expect(written.collections.payment_intents).toMatchObject({ redacted: 1 });
    expect(written.collections.mail).toMatchObject({ deleted: 1 });
    expect(written.collections.stripe_events).toMatchObject({ deleted: 1 });
    expect(written.collections.webhook_failures).toMatchObject({ deleted: 0 });
    expect(typeof written.durationMs).toBe('number');
  });

  test('a deadline stops the run cleanly and is recorded as incomplete', async () => {
    seedOrder('old_item1', ts(800));
    const summary = await runRetentionOnce({ now: NOW, deadlineMs: 0 });

    expect(summary.complete).toBe(false);
    expect(summary.stoppedEarly).toBe(true);
    expect(doc('orders/old_item1').customerEmail).toBe('buyer@example.com');
    expect(doc('retention_runs/2026-09-04').stoppedEarly).toBe(true);
  });

  test('a failing collection is recorded and the others still run', async () => {
    seedOrder('old_item1', ts(800));
    seedMail('m_old', ts(100));
    const realCollection = admin._mocks.firestore.collection.getMockImplementation();
    admin._mocks.firestore.collection.mockImplementation((path) => {
      if (path === 'orders') throw new Error('orders index missing');
      return realCollection(path);
    });

    try {
      const summary = await runRetentionOnce({ now: NOW });
      expect(summary.complete).toBe(false);
      expect(summary.errors).toEqual([{ collection: 'orders', message: 'orders index missing' }]);
      expect(doc('mail/m_old')).toBeUndefined();
      expect(doc('retention_runs/2026-09-04').errors).toHaveLength(1);
    } finally {
      admin._mocks.firestore.collection.mockImplementation(realCollection);
    }
  });

  test('the scheduled export runs a pass and fails loudly when a collection errored', async () => {
    seedOrder('old_item1', ts(800));
    await expect(orderRetention()).resolves.toBeUndefined();
    expect(doc('orders/old_item1').customerEmail).toBeNull();

    const realCollection = admin._mocks.firestore.collection.getMockImplementation();
    admin._mocks.firestore.collection.mockImplementation((path) => {
      if (path === 'mail') throw new Error('mail unavailable');
      return realCollection(path);
    });
    try {
      await expect(orderRetention()).rejects.toThrow(/mail unavailable/);
    } finally {
      admin._mocks.firestore.collection.mockImplementation(realCollection);
    }
  });
});

describe('planRedaction()', () => {
  const AT = '2026-09-04T12:00:00.000Z';

  test('nulls scalar PII, replaces the address, and lists what it did', () => {
    const update = planRedaction({ customerEmail: 'a@b.c', customerPhone: '1', customerName: 'A', shippingAddress: { line1: 'x' }, lineTotalCents: 5 }, AT);
    expect(update).toEqual({
      customerEmail: null, customerPhone: null, customerName: null,
      shippingAddress: { redacted: true, redactedAt: AT },
      piiRedacted: true, piiRedactedAt: AT,
      piiRedactedFields: ['customerEmail', 'customerPhone', 'customerName', 'shippingAddress']
    });
    expect(update.lineTotalCents).toBeUndefined();
  });

  test('only touches the fields that are present', () => {
    expect(planRedaction({ customerEmail: 'a@b.c' }, AT)).toEqual({
      customerEmail: null, piiRedacted: true, piiRedactedAt: AT, piiRedactedFields: ['customerEmail']
    });
  });

  test('returns null for already-redacted, empty, or non-object input', () => {
    expect(planRedaction({ piiRedacted: true, customerEmail: 'still@here' }, AT)).toBeNull();
    expect(planRedaction({ lineTotalCents: 5, customerEmail: null, shippingAddress: null }, AT)).toBeNull();
    expect(planRedaction({ shippingAddress: { redacted: true, redactedAt: 'earlier' } }, AT)).toBeNull();
    expect(planRedaction(null, AT)).toBeNull();
    expect(planRedaction('x', AT)).toBeNull();
  });
});

describe('toMillis()', () => {
  test('reads every timestamp shape these collections have carried', () => {
    expect(toMillis(admin.firestore.Timestamp.fromMillis(1000))).toBe(1000);
    expect(toMillis(new Date(2000))).toBe(2000);
    expect(toMillis('1970-01-01T00:00:03.000Z')).toBe(3000);
    expect(toMillis(4000)).toBe(4000);
    expect(toMillis({ seconds: 5, nanoseconds: 0 })).toBe(5000);
    expect(toMillis({ _seconds: 6, _nanoseconds: 0 })).toBe(6000);
    expect(toMillis(null)).toBeNull();
    expect(toMillis(undefined)).toBeNull();
    expect(toMillis('yesterday')).toBeNull();
    expect(toMillis({})).toBeNull();
    expect(toMillis(NaN)).toBeNull();
  });
});

// ─── Chunking with a Firestore double that honours cursors ───────────────────

/**
 * Minimal in-memory Firestore: where (==, <, <=, >, >=) with Firestore's
 * type separation (a Timestamp bound never matches a string), orderBy, limit,
 * startAfter, doc get/update/delete/set and write batches. Enough to prove the
 * job pages with a moving cursor and commits one batch per chunk.
 */
function makeFakeDb(seed) {
  const store = {};
  for (const [collection, docs] of Object.entries(seed)) store[collection] = { ...docs };
  const commits = [];

  const kind = (v) => (v && typeof v.toMillis === 'function') ? 'ts' : typeof v === 'string' ? 'str' : 'other';
  const matches = (value, op, bound) => {
    if (kind(value) !== kind(bound) || kind(value) === 'other') return op === '==' ? value === bound : false;
    const a = kind(value) === 'ts' ? value.toMillis() : value;
    const b = kind(bound) === 'ts' ? bound.toMillis() : bound;
    switch (op) {
      case '==': return a === b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
      default: throw new Error(`unsupported op ${op}`);
    }
  };
  const sortKey = (v) => (kind(v) === 'ts' ? v.toMillis() : v);

  const docRef = (collection, id) => ({
    id,
    path: `${collection}/${id}`,
    get: async () => ({ exists: !!store[collection]?.[id], id, data: () => store[collection]?.[id] }),
    set: async (data, opts) => {
      store[collection] = store[collection] || {};
      store[collection][id] = opts?.merge ? { ...(store[collection][id] || {}), ...data } : data;
    },
    update: async (data) => { store[collection][id] = { ...store[collection][id], ...data }; },
    delete: async () => { delete store[collection]?.[id]; }
  });

  const query = (collection, state = { filters: [], order: null, limit: null, after: null }) => ({
    where: (field, op, value) => query(collection, { ...state, filters: [...state.filters, { field, op, value }] }),
    orderBy: (field, dir = 'asc') => query(collection, { ...state, order: { field, dir } }),
    limit: (n) => query(collection, { ...state, limit: n }),
    startAfter: (snap) => query(collection, { ...state, after: snap }),
    doc: (id) => docRef(collection, id),
    get: async () => {
      let docs = Object.entries(store[collection] || {}).map(([id, data]) => ({ id, data: () => data, ref: docRef(collection, id) }));
      docs = docs.filter(d => state.filters.every(f => matches(d.data()[f.field], f.op, f.value)));
      if (state.order) {
        const { field, dir } = state.order;
        docs.sort((x, y) => {
          const a = sortKey(x.data()[field]); const b = sortKey(y.data()[field]);
          const cmp = a < b ? -1 : a > b ? 1 : x.id.localeCompare(y.id);
          return dir === 'desc' ? -cmp : cmp;
        });
      }
      if (state.after) {
        const idx = docs.findIndex(d => d.id === state.after.id);
        docs = idx >= 0 ? docs.slice(idx + 1) : docs;
      }
      if (state.limit !== null) docs = docs.slice(0, state.limit);
      return { empty: docs.length === 0, size: docs.length, docs };
    }
  });

  return {
    store,
    commits,
    collection: (name) => query(name),
    batch: () => {
      const ops = [];
      return {
        update: (ref, data) => ops.push(() => ref.update(data)),
        delete: (ref) => ops.push(() => ref.delete()),
        set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
        commit: async () => { for (const op of ops) await op(); commits.push(ops.length); }
      };
    }
  };
}

describe('Chunked, cursor-paged processing (Firestore double)', () => {
  function oldOrder(i) {
    return {
      orderId: `o${i}`, lineTotalCents: 100 + i, customerEmail: `b${i}@example.com`,
      shippingAddress: { ...ADDRESS }, createdAt: ts(800 + i)
    };
  }

  test('walks every expired document in chunks, one commit per chunk, all redacted exactly once', async () => {
    const orders = {};
    for (let i = 0; i < 9; i++) orders[`o${i}`] = oldOrder(i);
    orders.young = { orderId: 'young', customerEmail: 'y@example.com', createdAt: ts(3) };
    orders.legacy = { orderId: 'legacy', customerEmail: 'l@example.com', createdAt: iso(900) };
    const db = makeFakeDb({ orders, payment_intents: {}, mail: {}, stripe_events: {}, webhook_failures: {} });

    const summary = await runRetentionOnce({ now: NOW, db, chunkSize: 4 });

    // 9 Timestamp docs → pages of 4,4,1 ; 1 legacy string doc → 1 page
    expect(summary.collections.orders.redacted).toBe(10);
    expect(summary.collections.orders.pages).toBe(4);
    expect(summary.collections.orders.commits).toBe(4);
    expect(db.commits.filter(n => n > 0)).toEqual([4, 4, 1, 1]);
    for (let i = 0; i < 9; i++) {
      expect(db.store.orders[`o${i}`].customerEmail).toBeNull();
      expect(db.store.orders[`o${i}`].lineTotalCents).toBe(100 + i);
    }
    expect(db.store.orders.legacy.customerEmail).toBeNull();
    expect(db.store.orders.young.customerEmail).toBe('y@example.com');
    expect(db.store.retention_runs['2026-09-04'].complete).toBe(true);

    // Second pass: pages are walked (already-redacted docs stay in range) but nothing changes.
    const again = await runRetentionOnce({ now: NOW, db, chunkSize: 4 });
    expect(again.collections.orders.redacted).toBe(0);
    expect(again.collections.orders.alreadyRedacted).toBe(10);
    expect(again.collections.orders.commits).toBe(0);
  });

  test('deletes expiring documents chunk by chunk without a cursor', async () => {
    const mail = {};
    for (let i = 0; i < 7; i++) mail[`m${i}`] = { to: 'x@example.com', createdAt: ts(100 + i) };
    mail.fresh = { to: 'x@example.com', createdAt: ts(2) };
    const db = makeFakeDb({ orders: {}, payment_intents: {}, mail, stripe_events: {}, webhook_failures: {} });

    const summary = await runRetentionOnce({ now: NOW, db, chunkSize: 3 });

    expect(summary.collections.mail.deleted).toBe(7);
    expect(summary.collections.mail.commits).toBe(3);
    expect(Object.keys(db.store.mail)).toEqual(['fresh']);
  });
});
