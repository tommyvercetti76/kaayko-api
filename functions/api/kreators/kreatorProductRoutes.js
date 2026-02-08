/**
 * Kreator Product Routes — Thin Router
 * Handlers in kreatorProductHandlers.js
 *
 * @module api/kreators/kreatorProductRoutes
 */

const express = require('express');
const router = express.Router();
const { requireKreatorAuth, requireActiveKreator } = require('../../middleware/kreatorAuthMiddleware');
const {
  upload, listProducts, createProduct,
  getProduct, updateProduct, deleteProduct
} = require('./kreatorProductHandlers');

router.get('/',    requireKreatorAuth, listProducts);
router.post('/',   requireKreatorAuth, requireActiveKreator, upload.array('images', 5), createProduct);
router.get('/:id', requireKreatorAuth, getProduct);
router.put('/:id', requireKreatorAuth, requireActiveKreator, upload.array('images', 5), updateProduct);
router.delete('/:id', requireKreatorAuth, requireActiveKreator, deleteProduct);

module.exports = router;
