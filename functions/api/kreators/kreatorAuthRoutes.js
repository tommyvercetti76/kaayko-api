/**
 * Kreator Auth Routes — thin router
 *
 * Google OAuth sign-in, connect, and disconnect flows.
 *
 * Routes:
 * - POST /auth/google/signin      - Sign in with Google (public)
 * - POST /auth/google/connect     - Link Google account (kreator auth)
 * - POST /auth/google/disconnect  - Unlink Google account (kreator auth)
 *
 * @module api/kreators/kreatorAuthRoutes
 */

const express = require('express');
const router = express.Router();
const { requireKreatorAuth, requireActiveKreator } = require('../../middleware/kreatorAuthMiddleware');
const h = require('./kreatorAuthHandlers');

router.post('/google/signin', h.googleSignIn);
router.post('/google/connect', requireKreatorAuth, h.googleConnect);
router.post('/google/disconnect', requireKreatorAuth, requireActiveKreator, h.googleDisconnect);

module.exports = router;
