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
function priceToSymbol(price) {
  if (price >= 50) return '$$$$';
  if (price >= 35) return '$$$';
  if (price >= 20) return '$$';
  return '$';
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
    if (isNaN(parsedPrice) || parsedPrice < 0.99) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Price must be at least $0.99'
      });
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
    
    // Generate store slug
    const storeSlug = generateStoreSlug(req.kreator.businessName || req.kreator.displayName);
    
    // Create product document
    const productData = {
      // Core fields (matching existing kaaykoproducts schema)
      title: title.trim(),
      description: description.trim(),
      price: priceToSymbol(parsedPrice), // For display in store
      actualPrice: parsedPrice, // Actual dollar amount
      votes: 0,
      productID,
      tags: JSON.parse(tags || '[]'),
      availableColors: JSON.parse(availableColors || '[]'),
      availableSizes: JSON.parse(availableSizes || '[]'),
      maxQuantity: parseInt(quantity) || 1,
      imgSrc,
      isAvailable: true,
      
      // Category
      category: category,
      
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
    if (category) updates.category = category;
    if (tags) updates.tags = JSON.parse(tags);
    if (availableSizes) updates.availableSizes = JSON.parse(availableSizes);
    if (availableColors) updates.availableColors = JSON.parse(availableColors);
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
