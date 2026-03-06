/**
 * Global test setup — runs via setupFiles BEFORE the test framework.
 * Only env vars and module-level operations allowed here.
 * NO beforeAll/afterAll/afterEach (those need the test framework).
 */

// ─── Environment ───────────────────────────────────────────────
process.env.FUNCTIONS_EMULATOR = 'true';
process.env.ADMIN_PASSPHRASE = 'test-admin-passphrase';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';
process.env.STRIPE_CHECKOUT_WEBHOOK_SECRET = 'whsec_checkout_fake';
process.env.JWT_SECRET = 'test-jwt-secret-key';
process.env.GCLOUD_PROJECT = 'kaayko-test';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'kaayko-test' });

// ─── Suppress noisy console during tests ───────────────────────
console.log = () => {};
console.info = () => {};
console.warn = () => {};
