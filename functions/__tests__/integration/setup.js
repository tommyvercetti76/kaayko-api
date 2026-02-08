/**
 * Integration test setup — runs via setupFiles BEFORE the test framework.
 *
 * ⚠️  Emulators MUST be running:
 *   firebase emulators:start --only firestore,auth
 *
 * This file sets env vars so firebase-admin connects to the emulator
 * instead of production.
 */

// ─── Emulator connections ──────────────────────────────────────────
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8081';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'kaaykostore';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'kaaykostore' });
process.env.FUNCTIONS_EMULATOR = 'true';

// ─── Required env vars (all test-safe values) ──────────────────────
process.env.ADMIN_PASSPHRASE = 'test-admin-passphrase';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_integration';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';
process.env.STRIPE_CHECKOUT_WEBHOOK_SECRET = 'whsec_checkout_fake';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.WEATHER_API_KEY = 'test-weather-key';
process.env.KREATOR_JWT_SECRET = 'test-kreator-jwt-secret';

// ─── Suppress noisy console during tests ───────────────────────────
const _origError = console.error;
console.log = () => {};
console.info = () => {};
console.warn = () => {};
// Keep console.error for debugging
console.error = _origError;
