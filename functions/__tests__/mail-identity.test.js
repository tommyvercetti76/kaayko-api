/** The Kaayko address family: every product writes as itself and replies land where a person reads. */
const path = require('path');

describe('config/mailIdentity', () => {
  const fresh = () => { jest.resetModules(); return require('../config/mailIdentity'); };
  afterEach(() => { delete process.env.MAIL_DOMAIN; delete process.env.MAIL_FROM_STORE; delete process.env.MAIL_MAILBOX; delete process.env.MAIL_ALIASES; });

  test('each product has its own address and reply address on kaayko.com', () => {
    const m = fresh();
    expect(m.identity('store')).toMatchObject({ address: 'orders@kaayko.com', from: '"Kaayko Store" <orders@kaayko.com>', replyTo: 'orders@kaayko.com' });
    expect(m.identity('kortex')).toMatchObject({ address: 'kortex@kaayko.com', from: '"Kortex by Kaayko" <kortex@kaayko.com>' });
    expect(m.identity('alumni').address).toBe('alumni@kaayko.com');
    expect(m.identity('kreator').address).toBe('kreators@kaayko.com');
    expect(m.identity('paddling').address).toBe('paddling@kaayko.com');
    expect(m.identity('security').address).toBe('security@kaayko.com');
    expect(m.identity('system')).toMatchObject({ address: 'admin@kaayko.com', replyTo: 'help@kaayko.com', inbox: 'help@kaayko.com' });
    expect(m.mailbox()).toBe('rohan@kaayko.com');
  });

  test('an unknown or missing product is general mail from help@', () => {
    const m = fresh();
    expect(m.identity(undefined).address).toBe('help@kaayko.com');
    expect(m.identity('nonsense').product).toBe('contact');
  });

  test('stampIdentity fills from/replyTo from the product and keeps what the caller set', () => {
    const m = fresh();
    expect(m.stampIdentity({ product: 'store', to: 'a@b.c' })).toMatchObject({ from: '"Kaayko Store" <orders@kaayko.com>', replyTo: 'orders@kaayko.com' });
    expect(m.stampIdentity({ to: 'a@b.c' }).product).toBe('contact');
    expect(m.stampIdentity({ product: 'kortex', from: 'x@y.z', replyTo: 'q@y.z' })).toMatchObject({ from: 'x@y.z', replyTo: 'q@y.z' });
  });

  test('env overrides: domain, one member, and the mailbox', () => {
    process.env.MAIL_DOMAIN = 'example.org'; process.env.MAIL_FROM_STORE = 'shop@example.org'; process.env.MAIL_MAILBOX = 'ops@example.org';
    const m = fresh();
    expect(m.identity('kortex').address).toBe('kortex@example.org');
    expect(m.identity('store').address).toBe('shop@example.org');
    expect(m.mailbox()).toBe('ops@example.org');
    process.env.MAIL_DOMAIN = 'not a domain';
    expect(fresh().domain()).toBe('kaayko.com');
  });

  test('MAIL_ALIASES names what exists in Zoho; anything else sends from the mailbox, keeping its name', () => {
    process.env.MAIL_ALIASES = 'admin, orders,security';
    const m = fresh();
    expect(m.identity('store')).toMatchObject({ address: 'orders@kaayko.com', from: '"Kaayko Store" <orders@kaayko.com>', replyTo: 'orders@kaayko.com', aliasLive: true });
    expect(m.identity('kortex')).toMatchObject({ address: 'rohan@kaayko.com', from: '"Kortex by Kaayko" <rohan@kaayko.com>', replyTo: 'rohan@kaayko.com', aliasLive: false });
    expect(m.identity('system')).toMatchObject({ address: 'admin@kaayko.com', replyTo: 'rohan@kaayko.com' });   // help@ is not live yet
    delete process.env.MAIL_ALIASES;
    expect(fresh().identity('kortex').address).toBe('kortex@kaayko.com');
  });

  test('the family lists every product once, with a purpose', () => {
    const m = fresh();
    const fam = m.family();
    expect(fam.map(f => f.product)).toEqual(['store', 'kortex', 'alumni', 'kreator', 'paddling', 'contact', 'system', 'security']);
    expect(fam.every(f => f.purpose && f.from.includes('@kaayko.com'))).toBe(true);
    expect(m.PRODUCTS).toContain('contact');
  });
});
