require('./helpers/mockSetup');
const admin = require('firebase-admin');
const { notify } = require('../services/notify');
const { assess } = require('../scheduled/mailRedrive');

const mailDocs = () =>
  Object.entries(admin._mocks.docData).filter(([p]) => p.startsWith('mail/'));

describe('notify() — the one send path', () => {
  test('queues one mail document with product and kind tags', async () => {
    const r = await notify({
      product: 'kreator', kind: 'application-received',
      to: 'applicant@example.com', subject: 'We have your application',
      html: '<p>Thanks</p>', dedupeKey: 'kreator_app_abc123',
    });
    expect(r.queued).toBe(true);
    expect(r.mailId).toBe('kreator_app_abc123');

    const [, doc] = mailDocs()[0];
    expect(doc.to).toEqual(['applicant@example.com']);
    expect(doc.product).toBe('kreator');
    expect(doc.kind).toBe('application-received');
    expect(doc.message.subject).toBe('We have your application');
  });

  test('a repeat with the same dedupeKey does not queue twice', async () => {
    const args = {
      product: 'store', kind: 'receipt', to: 'buyer@example.com',
      subject: 'Your order', html: '<p>x</p>', dedupeKey: 'pi_123_customer',
    };
    const first = await notify(args);
    const second = await notify(args);
    expect(first.queued).toBe(true);
    expect(second.queued).toBe(false);
    expect(second.reason).toBe('already_queued');
    expect(mailDocs()).toHaveLength(1);
  });

  // The property that matters most: the old stack returned {success:true} after
  // a console.log, which is how a platform-wide outage stayed invisible.
  describe('never reports success for something it did not queue', () => {
    test.each([
      ['no recipient', { to: '' }, 'no_valid_recipient'],
      ['malformed recipient', { to: 'not-an-email' }, 'no_valid_recipient'],
      ['no subject', { subject: '' }, 'subject is required'],
      ['no body', { html: undefined, text: undefined }, 'nothing to send'],
    ])('%s', async (_label, override, expectedReason) => {
      const r = await notify({
        product: 'alumni', kind: 'x', to: 'a@b.com',
        subject: 'S', html: '<p>b</p>', ...override,
      });
      expect(r.queued).toBe(false);
      expect(r.reason).toContain(expectedReason);
      expect(mailDocs()).toHaveLength(0);
    });

    test('unknown product is refused by name', async () => {
      const r = await notify({ product: 'nope', kind: 'x', to: 'a@b.com', subject: 'S', html: '<p>b</p>' });
      expect(r.queued).toBe(false);
      expect(r.reason).toMatch(/unknown product "nope"/);
    });

    test('a broken template fails loudly instead of queueing an empty email', async () => {
      const r = await notify({
        product: 'paddling', kind: 'x', to: 'a@b.com',
        subject: 'S', template: 'does-not-exist', data: {},
      });
      expect(r.queued).toBe(false);
      expect(r.reason).toMatch(/template "does-not-exist" failed/);
      expect(mailDocs()).toHaveLength(0);
    });
  });

  test('without a dedupeKey, identical sends collapse within the same day', async () => {
    const args = { product: 'contact', kind: 'enquiry', to: 'a@b.com', subject: 'Hello', html: '<p>hi</p>' };
    await notify(args);
    const again = await notify(args);
    expect(again.reason).toBe('already_queued');
    expect(mailDocs()).toHaveLength(1);
  });

  test('accepts multiple recipients and drops invalid ones', async () => {
    const r = await notify({
      product: 'system', kind: 'alert', to: ['ok@b.com', 'bad', 'also@c.com'],
      subject: 'S', text: 'body', dedupeKey: 'multi_1',
    });
    expect(r.queued).toBe(true);
    expect(mailDocs()[0][1].to).toEqual(['ok@b.com', 'also@c.com']);
  });
});

describe('mailRedrive — what gets another attempt', () => {
  const now = 1_700_000_000_000;
  test.each([
    ['never attempted (the real outage)', {}, true],
    ['retry under the cap', { delivery: { state: 'RETRY', attempts: 2 } }, true],
    ['retry at the cap', { delivery: { state: 'RETRY', attempts: 4 } }, false],
    ['delivered', { delivery: { state: 'SUCCESS' } }, false],
    ['error — needs a human', { delivery: { state: 'ERROR', attempts: 4 } }, false],
    ['in flight', { delivery: { state: 'PROCESSING', leaseExpireTime: now } }, false],
    ['dead invocation', { delivery: { state: 'PROCESSING', leaseExpireTime: now - 3_600_000 } }, true],
  ])('%s -> %s', (_label, data, expected) => {
    expect(assess(data, now).redrive).toBe(expected);
  });
});
