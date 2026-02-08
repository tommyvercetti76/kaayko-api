/**
 * Kreator Product Handlers — CRUD logic + image upload utilities
 * Extracted from kreatorProductRoutes.js for primer compliance.
 *
 * @module api/kreators/kreatorProductHandlers
 */

const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

const db = admin.firestore();
const bucket = admin.storage().bucket();

// ── Multer config ────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only image files are allowed'), false);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────

function generateStoreSlug(businessName) {
  return businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 50);
}

function priceToSymbol(price) {
  if (price >= 50) return '$$$$';
  if (price >= 35) return '$$$';
  if (price >= 20) return '$$';
  return '$';
}

async function uploadProductImage(file, productID, index) {
  const filename = `${index}_${Date.now()}.${file.originalname.split('.').pop()}`;
  const filepath = `kaaykoStoreTShirtImages/${productID}/${filename}`;
  const fileRef = bucket.file(filepath);
  await fileRef.save(file.buffer, { metadata: { contentType: file.mimetype, cacheControl: 'public, max-age=31536000' } });
  await fileRef.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${filepath}`;
}

// ── Handlers ─────────────────────────────────────────────────────────

async function listProducts(req, res) {
  try {
    const snapshot = await db.collection('kaaykoproducts').where('kreatorId', '==', req.kreator.uid).get();
    let products = snapshot.docs.map(doc => ({
      id: doc.id, ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.()?.toISOString(),
      updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString()
    }));
    products.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return res.json({ success: true, data: products, count: products.length });
  } catch (error) {
    console.error('[KreatorProducts] List error:', error);
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to fetch products' });
  }
}

async function createProduct(req, res) {
  try {
    const { title, description, price, quantity, category, tags, availableSizes, availableColors } = req.body;

    if (!title || !description || !price || !category) {
      return res.status(400).json({ success: false, error: 'Bad Request', message: 'Title, description, price, and category are required' });
    }
    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice < 0.99) {
      return res.status(400).json({ success: false, error: 'Bad Request', message: 'Price must be at least $0.99' });
    }

    const productID = `${req.kreator.uid.substring(0, 8)}_${uuidv4().substring(0, 8)}`;
    const imgSrc = [];
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        imgSrc.push(await uploadProductImage(req.files[i], productID, i));
      }
    }

    const storeSlug = generateStoreSlug(req.kreator.businessName || req.kreator.displayName);
    const productData = {
      title: title.trim(), description: description.trim(),
      price: priceToSymbol(parsedPrice), actualPrice: parsedPrice,
      votes: 0, productID,
      tags: JSON.parse(tags || '[]'), availableColors: JSON.parse(availableColors || '[]'),
      availableSizes: JSON.parse(availableSizes || '[]'), maxQuantity: parseInt(quantity) || 1,
      imgSrc, isAvailable: true, category,
      kreatorId: req.kreator.uid,
      storeName: req.kreator.businessName || req.kreator.displayName,
      storeSlug, sellerEmail: req.kreator.email,
      stockQuantity: parseInt(quantity) || 1,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await db.collection('kaaykoproducts').add(productData);
    await db.collection('kreators').doc(req.kreator.uid).update({
      'stats.totalProducts': admin.firestore.FieldValue.increment(1),
      'stats.lastProductCreatedAt': admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[KreatorProducts] ✅ Product created: ${docRef.id} by ${req.kreator.email}`);
    return res.status(201).json({
      success: true,
      data: { id: docRef.id, productID, ...productData, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      message: 'Product created successfully'
    });
  } catch (error) {
    console.error('[KreatorProducts] Create error:', error);
    return res.status(500).json({ success: false, error: 'Server Error', message: error.message || 'Failed to create product' });
  }
}

async function getProduct(req, res) {
  try {
    const doc = await db.collection('kaaykoproducts').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ success: false, error: 'Not Found', message: 'Product not found' });
    const product = doc.data();
    if (product.kreatorId !== req.kreator.uid) return res.status(403).json({ success: false, error: 'Forbidden', message: 'You do not own this product' });
    return res.json({ success: true, data: { id: doc.id, ...product, createdAt: product.createdAt?.toDate?.()?.toISOString(), updatedAt: product.updatedAt?.toDate?.()?.toISOString() } });
  } catch (error) {
    console.error('[KreatorProducts] Get error:', error);
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to fetch product' });
  }
}

async function updateProduct(req, res) {
  try {
    const docRef = db.collection('kaaykoproducts').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ success: false, error: 'Not Found', message: 'Product not found' });
    const existing = doc.data();
    if (existing.kreatorId !== req.kreator.uid) return res.status(403).json({ success: false, error: 'Forbidden', message: 'You do not own this product' });

    const updates = {};
    const { title, description, price, quantity, category, tags, availableSizes, availableColors, isAvailable } = req.body;
    if (title) updates.title = title.trim();
    if (description) updates.description = description.trim();
    if (price) { const p = parseFloat(price); updates.price = priceToSymbol(p); updates.actualPrice = p; }
    if (quantity) { updates.stockQuantity = parseInt(quantity); updates.maxQuantity = parseInt(quantity); }
    if (category) updates.category = category;
    if (tags) updates.tags = JSON.parse(tags);
    if (availableSizes) updates.availableSizes = JSON.parse(availableSizes);
    if (availableColors) updates.availableColors = JSON.parse(availableColors);
    if (isAvailable !== undefined) updates.isAvailable = isAvailable === 'true' || isAvailable === true;

    if (req.files && req.files.length > 0) {
      const imgSrc = [...(existing.imgSrc || [])];
      for (let i = 0; i < req.files.length; i++) {
        imgSrc.push(await uploadProductImage(req.files[i], existing.productID, imgSrc.length + i));
      }
      updates.imgSrc = imgSrc.slice(0, 5);
    }
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await docRef.update(updates);

    console.log(`[KreatorProducts] ✅ Product updated: ${req.params.id}`);
    return res.json({ success: true, data: { id: req.params.id, ...existing, ...updates }, message: 'Product updated successfully' });
  } catch (error) {
    console.error('[KreatorProducts] Update error:', error);
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to update product' });
  }
}

async function deleteProduct(req, res) {
  try {
    const docRef = db.collection('kaaykoproducts').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ success: false, error: 'Not Found', message: 'Product not found' });
    const product = doc.data();
    if (product.kreatorId !== req.kreator.uid) return res.status(403).json({ success: false, error: 'Forbidden', message: 'You do not own this product' });

    await docRef.update({ isAvailable: false, deletedAt: admin.firestore.FieldValue.serverTimestamp(), deletedBy: req.kreator.uid });
    await db.collection('kreators').doc(req.kreator.uid).update({ 'stats.totalProducts': admin.firestore.FieldValue.increment(-1) });

    console.log(`[KreatorProducts] ✅ Product deleted: ${req.params.id}`);
    return res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    console.error('[KreatorProducts] Delete error:', error);
    return res.status(500).json({ success: false, error: 'Server Error', message: 'Failed to delete product' });
  }
}

module.exports = { upload, listProducts, createProduct, getProduct, updateProduct, deleteProduct };
