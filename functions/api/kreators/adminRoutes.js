/**
 * Kreator Admin Routes — Thin Router
 * Handlers in adminHandlers.js
 *
 * @module api/kreators/adminRoutes
 */

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../../middleware/authMiddleware');
const { optionalAuthForAdmin } = require('../../middleware/authRBAC');
const {
  listApplications, getApplication, approveApplication, rejectApplication,
  listKreators, getStats, getKreator, resendLink
} = require('./adminHandlers');

// All admin routes require authentication
router.use(optionalAuthForAdmin, requireAdmin);

// Application management
router.get('/applications',               listApplications);
router.get('/applications/:id',            getApplication);
router.put('/applications/:id/approve',    approveApplication);
router.put('/applications/:id/reject',     rejectApplication);

// Kreator management
router.get('/list',                        listKreators);
router.get('/stats',                       getStats);
router.get('/:uid',                        getKreator);
router.post('/:uid/resend-link',           resendLink);

module.exports = router;
