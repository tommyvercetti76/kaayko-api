/**
 * mailSender — the Firestore trigger that delivers `mail/{docId}` over SMTP.
 *
 * Nothing here touches the network: nodemailer is mocked and the trigger is
 * invoked directly with a synthetic Firestore event. What is proved:
 *   • a queued document is sent and marked SUCCESS with the extension's fields
 *   • a missing MAIL_SMTP_URL is a loud, recorded ERROR — never a silent drop
 *   • at-least-once trigger delivery cannot double-send (transactional claim)
 *   • transient failures go RETRY → RETRY → RETRY → ERROR; 5xx is ERROR at once
 */

require('./helpers/mockSetup');
const admin = require('firebase-admin');

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));
jest.mock('nodemailer', () => ({ createTransport: (...args) => mockCreateTransport(...args) }));

// Capture the trigger options and hand the handler back so tests can call it.
jest.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: jest.fn((opts, handler) => Object.assign(handler, { __trigger: opts }))
}));

const {
  mailSender,
  deliverMailDocument,
  isPermanentSmtpError,
  MAX_ATTEMPTS,
  SECRET_NAME
} = require('../triggers/mailSender');

const SMTP_URL = 'smtps://owner%40gmail.com:app-password@smtp.gmail.com:465';
const ORIGINAL_ENV = { ...process.env };

function seedMail(id, overrides = {}) {
  admin._mocks.docData[`mail/${id}`] = {
    to: 'buyer@example.com',
    message: { subject: 'Order Confirmation', html: '<p>Thanks</p>' },
    paymentIntentId: 'pi_1',
    createdAt: new Date(),
    ...overrides
  };
}

function firestoreEvent(docId) {
  return {
    id: `evt-${docId}`,
    params: { docId },
    data: { id: docId, exists: true, data: () => admin._mocks.docData[`mail/${docId}`] }
  };
}

function delivery(id) {
  return admin._mocks.docData[`mail/${id}`].delivery;
}

function transientError() {
  return Object.assign(new Error('connect ECONNREFUSED 74.125.20.108:465'), { code: 'ECONNECTION' });
}

beforeEach(() => {
  mockSendMail.mockReset();
  mockCreateTransport.mockClear();
  mockSendMail.mockResolvedValue({
    messageId: '<abc@kaayko>', accepted: ['buyer@example.com'], rejected: [], pending: [], response: '250 OK'
  });
  // Firebase-managed secrets arrive with a trailing newline.
  process.env[SECRET_NAME] = `${SMTP_URL}\n`;
  delete process.env.MAIL_FROM;
  delete process.env.ORDER_NOTIFY_EMAIL;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ────────────────────────────────────────────────────────────────
describe('mailSender — trigger definition', () => {
  test('is a us-central1 / 256MiB onCreate trigger on mail/{docId} bound to the MAIL_SMTP_URL secret', () => {
    expect(SECRET_NAME).toBe('MAIL_SMTP_URL');
    expect(mailSender.__trigger).toMatchObject({
      document: 'mail/{docId}',
      region: 'us-central1',
      memory: '256MiB'
    });
    expect(mailSender.__trigger.secrets).toContain('MAIL_SMTP_URL');
  });

  test('does not load the Express app or express itself', () => {
    const loaded = Object.keys(require.cache);
    expect(loaded.some(p => p.endsWith('/triggers/mailSender.js'))).toBe(true);
    expect(loaded.some(p => p.endsWith('/functions/index.js'))).toBe(false);
    expect(loaded.some(p => p.includes('/node_modules/express/'))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
describe('mailSender — delivery', () => {
  test('sends a queued document over SMTP and records SUCCESS on it', async () => {
    seedMail('pi_1_customer');

    const result = await mailSender(firestoreEvent('pi_1_customer'));

    expect(result.sent).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const message = mockSendMail.mock.calls[0][0];
    expect(message.to).toEqual(['buyer@example.com']);
    expect(message.subject).toBe('Order Confirmation');
    expect(message.html).toBe('<p>Thanks</p>');
    // From and Reply-To default to the owner address from notifyAddress.js.
    expect(message.from).toBe('rohanramekar17@gmail.com');
    expect(message.replyTo).toBe('rohanramekar17@gmail.com');

    const d = delivery('pi_1_customer');
    expect(d.state).toBe('SUCCESS');
    expect(d.attempts).toBe(1);
    expect(d.error).toBeNull();
    expect(d.startTime).toBeTruthy();
    expect(d.endTime).toBeTruthy();
    expect(d.leaseExpireTime).toBeNull();
    expect(d.info).toMatchObject({ messageId: '<abc@kaayko>', accepted: ['buyer@example.com'], rejected: [] });
  });

  test('the transport is built from the TRIMMED secret value', async () => {
    process.env[SECRET_NAME] = 'smtps://other%40gmail.com:pw@smtp.gmail.com:465\n';
    seedMail('m_trim');

    await deliverMailDocument('m_trim');

    expect(mockCreateTransport).toHaveBeenCalledWith('smtps://other%40gmail.com:pw@smtp.gmail.com:465');
  });

  test('MAIL_FROM overrides From; a per-document from/replyTo/cc wins over the defaults', async () => {
    process.env.MAIL_FROM = '"Kaayko Orders" <orders@kaayko.com>';
    seedMail('m_from');
    await deliverMailDocument('m_from');
    expect(mockSendMail.mock.calls[0][0].from).toBe('"Kaayko Orders" <orders@kaayko.com>');
    expect(mockSendMail.mock.calls[0][0].replyTo).toBe('rohanramekar17@gmail.com');

    seedMail('m_from2', { from: 'custom@kaayko.com', replyTo: 'support@kaayko.com', cc: 'copy@kaayko.com' });
    await deliverMailDocument('m_from2');
    const msg = mockSendMail.mock.calls[1][0];
    expect(msg.from).toBe('custom@kaayko.com');
    expect(msg.replyTo).toBe('support@kaayko.com');
    expect(msg.cc).toEqual(['copy@kaayko.com']);
  });

  test('ORDER_NOTIFY_EMAIL changes the default From / Reply-To without a code change', async () => {
    process.env.ORDER_NOTIFY_EMAIL = 'ops@kaayko.com';
    seedMail('m_owner');
    await deliverMailDocument('m_owner');
    expect(mockSendMail.mock.calls[0][0].from).toBe('ops@kaayko.com');
    expect(mockSendMail.mock.calls[0][0].replyTo).toBe('ops@kaayko.com');
  });

  test('a document that no longer exists is skipped without sending', async () => {
    const result = await deliverMailDocument('nope');
    expect(result).toMatchObject({ skipped: true, reason: 'missing' });
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────
describe('mailSender — configuration failures', () => {
  test('a missing MAIL_SMTP_URL marks the document ERROR with the reason and logs loudly — nothing is sent', async () => {
    delete process.env[SECRET_NAME];
    seedMail('m_nosecret');

    const result = await mailSender(firestoreEvent('m_nosecret'));

    expect(result.state).toBe('ERROR');
    expect(mockSendMail).not.toHaveBeenCalled();
    const d = delivery('m_nosecret');
    expect(d.state).toBe('ERROR');
    expect(d.attempts).toBe(1);
    expect(d.error).toContain('MAIL_SMTP_URL secret is not set');
    expect(d.error).toContain('firebase functions:secrets:set MAIL_SMTP_URL');
    expect(d.endTime).toBeTruthy();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('MAIL_SMTP_URL'));
  });

  test('a malformed MAIL_SMTP_URL is a permanent ERROR, not four connection timeouts', async () => {
    process.env[SECRET_NAME] = 'smtp.gmail.com:465';
    seedMail('m_badurl');

    await deliverMailDocument('m_badurl');

    expect(delivery('m_badurl').state).toBe('ERROR');
    expect(delivery('m_badurl').error).toMatch(/smtps?:\/\//);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('a document with no recipient, or no message, is a permanent ERROR', async () => {
    seedMail('m_noto', { to: null });
    await deliverMailDocument('m_noto');
    expect(delivery('m_noto').state).toBe('ERROR');
    expect(delivery('m_noto').error).toContain('no recipient');

    seedMail('m_nomsg', { message: {} });
    await deliverMailDocument('m_nomsg');
    expect(delivery('m_nomsg').state).toBe('ERROR');
    expect(delivery('m_nomsg').error).toContain('message.subject');

    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────
describe('mailSender — idempotency under at-least-once trigger delivery', () => {
  test('a duplicate invocation for the same document does not send twice', async () => {
    seedMail('m_dup');

    const first = await mailSender(firestoreEvent('m_dup'));
    const second = await mailSender(firestoreEvent('m_dup'));

    expect(first.sent).toBe(true);
    expect(second).toMatchObject({ skipped: true, reason: 'SUCCESS' });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(delivery('m_dup').attempts).toBe(1);
  });

  test('a document another invocation is still PROCESSING is left alone', async () => {
    seedMail('m_busy', { delivery: { state: 'PROCESSING', attempts: 1, leaseExpireTime: Date.now() + 60_000 } });

    const result = await deliverMailDocument('m_busy');

    expect(result).toMatchObject({ skipped: true, reason: 'PROCESSING' });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('a PROCESSING claim whose lease expired (invocation died mid-send) can be re-claimed', async () => {
    seedMail('m_stale', { delivery: { state: 'PROCESSING', attempts: 1, leaseExpireTime: Date.now() - 1 } });

    const result = await deliverMailDocument('m_stale');

    expect(result.sent).toBe(true);
    expect(delivery('m_stale').state).toBe('SUCCESS');
    expect(delivery('m_stale').attempts).toBe(2);
  });

  test('an ERROR document is not retried unless forced', async () => {
    seedMail('m_err', { delivery: { state: 'ERROR', attempts: 4, error: 'boom' } });

    expect(await deliverMailDocument('m_err')).toMatchObject({ skipped: true, reason: 'ERROR' });
    expect(mockSendMail).not.toHaveBeenCalled();

    const forced = await deliverMailDocument('m_err', { force: true });
    expect(forced.sent).toBe(true);
    expect(delivery('m_err').state).toBe('SUCCESS');
    expect(delivery('m_err').attempts).toBe(5);
  });

  test('the claim happens inside a Firestore transaction', async () => {
    seedMail('m_tx');
    await deliverMailDocument('m_tx');
    expect(admin._mocks.firestore.runTransaction).toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────
describe('mailSender — RETRY / ERROR transitions', () => {
  test('a transient SMTP failure leaves the document in RETRY with the attempt count and error', async () => {
    mockSendMail.mockRejectedValueOnce(transientError());
    seedMail('m_retry');

    const result = await mailSender(firestoreEvent('m_retry'));

    expect(result.state).toBe('RETRY');
    const d = delivery('m_retry');
    expect(d.state).toBe('RETRY');
    expect(d.attempts).toBe(1);
    expect(d.error).toContain('ECONNECTION');
    expect(d.endTime).toBeTruthy();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('attempt 1/4'));
  });

  test('a RETRY document is re-attempted; the 4th failure becomes ERROR and stays there', async () => {
    mockSendMail.mockRejectedValue(transientError());
    seedMail('m_exhaust');

    const states = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      states.push((await deliverMailDocument('m_exhaust')).state);
    }

    expect(MAX_ATTEMPTS).toBe(4);
    expect(states).toEqual(['RETRY', 'RETRY', 'RETRY', 'ERROR']);
    expect(delivery('m_exhaust').attempts).toBe(4);
    expect(mockSendMail).toHaveBeenCalledTimes(4);

    const after = await deliverMailDocument('m_exhaust');
    expect(after).toMatchObject({ skipped: true, reason: 'ERROR' });
    expect(mockSendMail).toHaveBeenCalledTimes(4);
  });

  test('a retry that succeeds ends in SUCCESS with the cumulative attempt count', async () => {
    mockSendMail.mockRejectedValueOnce(transientError());
    seedMail('m_recover');

    await deliverMailDocument('m_recover');
    expect(delivery('m_recover').state).toBe('RETRY');

    const r = await deliverMailDocument('m_recover');
    expect(r.state).toBe('SUCCESS');
    expect(delivery('m_recover').attempts).toBe(2);
    expect(delivery('m_recover').error).toBeNull();
  });

  test('a permanent SMTP failure (5xx or bad credentials) is ERROR on the first attempt', async () => {
    mockSendMail.mockRejectedValueOnce(
      Object.assign(new Error('Mailbox unavailable'), { code: 'EENVELOPE', responseCode: 550 })
    );
    seedMail('m_550');
    const r = await deliverMailDocument('m_550');
    expect(r.state).toBe('ERROR');
    expect(delivery('m_550').attempts).toBe(1);
    expect(delivery('m_550').error).toContain('550');

    mockSendMail.mockRejectedValueOnce(
      Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), { code: 'EAUTH', responseCode: 535 })
    );
    seedMail('m_auth');
    expect((await deliverMailDocument('m_auth')).state).toBe('ERROR');
    expect(delivery('m_auth').error).toContain('EAUTH');
  });

  test('classification: 4xx / socket / timeout are transient, 5xx / EAUTH are permanent', () => {
    expect(isPermanentSmtpError(Object.assign(new Error('greylisted'), { code: 'EENVELOPE', responseCode: 451 }))).toBe(false);
    expect(isPermanentSmtpError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toBe(false);
    expect(isPermanentSmtpError(Object.assign(new Error('dns'), { code: 'EDNS' }))).toBe(false);
    expect(isPermanentSmtpError(Object.assign(new Error('no user'), { responseCode: 550 }))).toBe(true);
    expect(isPermanentSmtpError(Object.assign(new Error('bad login'), { code: 'EAUTH' }))).toBe(true);
    expect(isPermanentSmtpError(null)).toBe(false);
  });

  test('the trigger handler never throws, even when Firestore itself fails', async () => {
    seedMail('m_fsdown');
    const real = admin._mocks.firestore.runTransaction.getMockImplementation();
    admin._mocks.firestore.runTransaction.mockImplementation(async () => {
      throw new Error('14 UNAVAILABLE: Firestore unavailable');
    });
    try {
      await expect(mailSender(firestoreEvent('m_fsdown'))).resolves.toBeUndefined();
    } finally {
      admin._mocks.firestore.runTransaction.mockImplementation(real);
    }
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('could not record delivery'), expect.anything());
    expect(mockSendMail).not.toHaveBeenCalled();
    // Untouched: a re-drive can pick it up.
    expect(delivery('m_fsdown')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
describe('nodemailer connection URL (real parser, not the mock)', () => {
  test('decodes %40 in the username, so a Gmail address can be the SMTP user', () => {
    const real = jest.requireActual('nodemailer');
    const transport = real.createTransport(SMTP_URL);
    expect(transport.options.auth.user).toBe('owner@gmail.com');
    expect(transport.options.auth.pass).toBe('app-password');
    expect(transport.options.host).toBe('smtp.gmail.com');
    expect(transport.options.port).toBe(465);
    expect(transport.options.secure).toBe(true);
  });
});
