/**
 * Kreator Product Routes
 * 
 * Handles product CRUD operations for sellers (kreators)
 * Products are stored in the main 'kaaykoproducts' collection with seller attribution
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { requireKreatorAuth, requireActiveKreator } = require('../../middleware/kreatorAuthMiddleware');

const db = admin.firestore();
const bucket = admin.storage().bucket();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 5
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

/**
 * Generate a URL-friendly store slug from business name
 */
function generateStoreSlug(businessName) {
  return businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

/**
 * Convert price to price symbol for display
 */
/**
 * Parse a JSON string array from a multipart field, safely.
 *
 * The old code called JSON.parse() straight on the body: a malformed value threw
 * into the 500 handler, and a well-formed one was written to the shared
 * catalogue with no type, length or content check at all. Tags land on the
 * public storefront, so an unvalidated element was a stored-XSS path.
 *
 * @returns {{ok: true, value: string[]}|{ok: false, message: string}}
 */
function parseStringArray(raw, field, { maxItems = 12, maxLen = 40 } = {}) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: [] };
  let parsed;
  if (Array.isArray(raw)) parsed = raw;
  else {
    try { parsed = JSON.parse(raw); }
    catch (_) { return { ok: false, message: `${field} must be a JSON array` }; }
  }
  if (!Array.isArray(parsed)) return { ok: false, message: `${field} must be a JSON array` };
  const value = parsed
    .map(x => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean);
  if (value.length > maxItems) return { ok: false, message: `${field}: at most ${maxItems} entries` };
  if (value.some(x => x.length > maxLen)) return { ok: false, message: `${field}: each entry must be ${maxLen} characters or fewer` };
  // Belt and braces alongside the escaping fix in kaayko_ui.js: nothing that
  // could open a tag reaches the catalogue in the first place.
  if (value.some(x => /[<>]/.test(x))) return { ok: false, message: `${field} cannot contain < or >` };
  return { ok: true, value };
}

/** Closed set, matching api/admin/products.js. A free string here silently broke
 *  the storefront's fit picker, which tests category === 'apparel'. */
const CATEGORIES = Object.freeze(['apparel', 'accessories', 'art', 'other']);
const PRODUCT_TYPES = Object.freeze(['tshirt', 'tote', 'magnet', 'print', 'sticker', 'mug', 'cap', 'poster']);

const { priceSymbolFor } = require('../checkout/pricing');

/** Delegates to the one tier rule in pricing.js — this used to be a third,
 *  divergent threshold set (>=50/35/20). */
function priceToSymbol(price) {
  return priceSymbolFor(price);
}

/**
 * Upload image to Firebase Storage
 */
async function uploadProductImage(file, productID, index) {
  const filename = `${index}_${Date.now()}.${file.originalname.split('.').pop()}`;
  const filepath = `kaaykoStoreTShirtImages/${productID}/${filename}`;
  
  const fileRef = bucket.file(filepath);
  
  await fileRef.save(file.buffer, {
    metadata: {
      contentType: file.mimetype,
      cacheControl: 'public, max-age=31536000'
    }
  });
  
  // Make the file public
  await fileRef.makePublic();
  
  // Return public URL
  return `https://storage.googleapis.com/${bucket.name}/${filepath}`;
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /kreators/products
 * List all products for the authenticated kreator
 */
router.get('/', requireKreatorAuth, async (req, res) => {
  try {
    console.log(`[KreatorProducts] Fetching products for kreator: ${req.kreator.uid}`);
    
    // Simple query without ordering to avoid index requirement
    const snapshot = await db.collection('kaaykoproducts')
      .where('kreatorId', '==', req.kreator.uid)
      .get();
    
    let products = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.()?.toISOString(),
      updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString()
    }));
    
    // Sort in JS instead of Firestore to avoid index requirement
    products.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
      const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
      return dateB - dateA; // Descending
    });
    
    console.log(`[KreatorProducts] Found ${products.length} products for kreator: ${req.kreator.uid}`);
    
    return res.json({
      success: true,
      data: products,
      count: products.length
    });
    
  } catch (error) {
    console.error('[KreatorProducts] List error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to fetch products'
    });
  }
});

/**
 * POST /kreators/products
 * Create a new product
 */
router.post('/', requireKreatorAuth, requireActiveKreator, upload.array('images', 5), async (req, res) => {
  try {
    const { 
      title, 
      description, 
      price, 
      quantity, 
      category, 
      tags, 
      availableSizes, 
      availableColors 
    } = req.body;
    
    // Validate required fields
    if (!title || !description || !price || !category) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Title, description, price, and category are required'
      });
    }
    
    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice < 0.99 || parsedPrice > 500) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Price must be between $0.99 and $500'
      });
    }

    const normalisedCategory = String(category || '').trim().toLowerCase();
    if (!CATEGORIES.includes(normalisedCategory)) {
      return res.status(400).json({
        success: false, error: 'Bad Request',
        message: `category must be one of: ${CATEGORIES.join(', ')}`
      });
    }

    const requestedType = String(req.body.productType || '').trim().toLowerCase();
    if (requestedType && !PRODUCT_TYPES.includes(requestedType)) {
      return res.status(400).json({
        success: false, error: 'Bad Request',
        message: `productType must be one of: ${PRODUCT_TYPES.join(', ')}`
      });
    }

    const parsedTags   = parseStringArray(tags, 'tags', { maxItems: 10, maxLen: 30 });
    const parsedSizes  = parseStringArray(availableSizes, 'availableSizes');
    const parsedColors = parseStringArray(availableColors, 'availableColors');
    for (const r of [parsedTags, parsedSizes, parsedColors]) {
      if (!r.ok) return res.status(400).json({ success: false, error: 'Bad Request', message: r.message });
    }
    
    // Generate unique product ID
    const productID = `${req.kreator.uid.substring(0, 8)}_${uuidv4().substring(0, 8)}`;
    
    // Upload images
    const imgSrc = [];
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const url = await uploadProductImage(req.files[i], productID, i);
        imgSrc.push(url);
      }
    }
    
    // Store slug. The kreator uid is folded in because the slug was previously
    // derived from the business name alone with no uniqueness check — two
    // kreators trading as "Wild Prints" would have collided into one storefront,
    // each able to see the other's products under ?store=. Zero kreator products
    // existed when this changed, so no migration was needed.
    const storeSlug = `${generateStoreSlug(req.kreator.businessName || req.kreator.displayName)}-${req.kreator.uid.substring(0, 6).toLowerCase()}`;
    
    // Create product document
    const productData = {
      // Core fields (matching existing kaaykoproducts schema)
      title: title.trim(),
      description: description.trim(),
      price: priceToSymbol(parsedPrice), // For display in store
      actualPrice: parsedPrice, // Actual dollar amount
      votes: 0,
      productID,
      tags: parsedTags.value,
      availableColors: parsedColors.value,
      availableSizes: parsedSizes.value,
      // Without a productType every kreator product fell into the storefront's
      // "Other" bucket. Default from the category so it lands somewhere real.
      productType: requestedType || (normalisedCategory === 'apparel' ? 'tshirt' : 'other'),
      maxQuantity: parseInt(quantity) || 1,
      imgSrc,
      isAvailable: true,
      
      // Category
      category: normalisedCategory,
      
      // Seller attribution
      kreatorId: req.kreator.uid,
      storeName: req.kreator.businessName || req.kreator.displayName,
      storeSlug: storeSlug,
      sellerEmail: req.kreator.email,
      
      // Inventory
      stockQuantity: parseInt(quantity) || 1,
      
      // Timestamps
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Save to Firestore
    const docRef = await db.collection('kaaykoproducts').add(productData);
    
    // Update kreator stats
    await db.collection('kreators').doc(req.kreator.uid).update({
      'stats.totalProducts': admin.firestore.FieldValue.increment(1),
      'stats.lastProductCreatedAt': admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`[KreatorProducts] ✅ Product created: ${docRef.id} by ${req.kreator.email}`);
    
    return res.status(201).json({
      success: true,
      data: {
        id: docRef.id,
        productID,
        ...productData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      message: 'Product created successfully'
    });
    
  } catch (error) {
    console.error('[KreatorProducts] Create error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message || 'Failed to create product'
    });
  }
});

/**
 * GET /kreators/products/:id
 * Get a specific product
 */
router.get('/:id', requireKreatorAuth, async (req, res) => {
  try {
    const doc = await db.collection('kaaykoproducts').doc(req.params.id).get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Product not found'
      });
    }
    
    const product = doc.data();
    
    // Ensure kreator owns this product
    if (product.kreatorId !== req.kreator.uid) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'You do not own this product'
      });
    }
    
    return res.json({
      success: true,
      data: {
        id: doc.id,
        ...product,
        createdAt: product.createdAt?.toDate?.()?.toISOString(),
        updatedAt: product.updatedAt?.toDate?.()?.toISOString()
      }
    });
    
  } catch (error) {
    console.error('[KreatorProducts] Get error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to fetch product'
    });
  }
});

/**
 * PUT /kreators/products/:id
 * Update a product
 */
router.put('/:id', requireKreatorAuth, requireActiveKreator, upload.array('images', 5), async (req, res) => {
  try {
    const docRef = db.collection('kaaykoproducts').doc(req.params.id);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Product not found'
      });
    }
    
    const existingProduct = doc.data();
    
    // Ensure kreator owns this product
    if (existingProduct.kreatorId !== req.kreator.uid) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'You do not own this product'
      });
    }
    
    const updates = {};
    const { title, description, price, quantity, category, tags, availableSizes, availableColors, isAvailable } = req.body;
    
    if (title) updates.title = title.trim();
    if (description) updates.description = description.trim();
    if (price) {
      const parsedPrice = parseFloat(price);
      updates.price = priceToSymbol(parsedPrice);
      updates.actualPrice = parsedPrice;
    }
    if (quantity) {
      updates.stockQuantity = parseInt(quantity);
      updates.maxQuantity = parseInt(quantity);
    }
    if (category) {
      const c = String(category).trim().toLowerCase();
      if (!CATEGORIES.includes(c)) {
        return res.status(400).json({ success: false, error: 'Bad Request', message: `category must be one of: ${CATEGORIES.join(', ')}` });
      }
      updates.category = c;
    }
    for (const [field, raw, opts] of [
      ['tags', tags, { maxItems: 10, maxLen: 30 }],
      ['availableSizes', availableSizes, {}],
      ['availableColors', availableColors, {}]
    ]) {
      if (raw === undefined) continue;
      const r = parseStringArray(raw, field, opts);
      if (!r.ok) return res.status(400).json({ success: false, error: 'Bad Request', message: r.message });
      updates[field] = r.value;
    }
    if (isAvailable !== undefined) updates.isAvailable = isAvailable === 'true' || isAvailable === true;
    
    // Handle new images
    if (req.files && req.files.length > 0) {
      const imgSrc = [...(existingProduct.imgSrc || [])];
      for (let i = 0; i < req.files.length; i++) {
        const url = await uploadProductImage(req.files[i], existingProduct.productID, imgSrc.length + i);
        imgSrc.push(url);
      }
      updates.imgSrc = imgSrc.slice(0, 5); // Max 5 images
    }
    
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    
    await docRef.update(updates);
    
    console.log(`[KreatorProducts] ✅ Product updated: ${req.params.id}`);
    
    return res.json({
      success: true,
      data: { id: req.params.id, ...existingProduct, ...updates },
      message: 'Product updated successfully'
    });
    
  } catch (error) {
    console.error('[KreatorProducts] Update error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to update product'
    });
  }
});

/**
 * DELETE /kreators/products/:id
 * Delete a product (soft delete - marks as unavailable)
 */
router.delete('/:id', requireKreatorAuth, requireActiveKreator, async (req, res) => {
  try {
    const docRef = db.collection('kaaykoproducts').doc(req.params.id);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Product not found'
      });
    }
    
    const product = doc.data();
    
    // Ensure kreator owns this product
    if (product.kreatorId !== req.kreator.uid) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'You do not own this product'
      });
    }
    
    // Soft delete
    await docRef.update({
      isAvailable: false,
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      deletedBy: req.kreator.uid
    });
    
    // Update kreator stats
    await db.collection('kreators').doc(req.kreator.uid).update({
      'stats.totalProducts': admin.firestore.FieldValue.increment(-1)
    });
    
    console.log(`[KreatorProducts] ✅ Product deleted: ${req.params.id}`);
    
    return res.json({
      success: true,
      message: 'Product deleted successfully'
    });
    
  } catch (error) {
    console.error('[KreatorProducts] Delete error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: 'Failed to delete product'
    });
  }
});

module.exports = router;
