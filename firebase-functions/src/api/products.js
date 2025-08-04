/**
 * functions/src/api/products.js
 *
 * Defines Express routes for product-related API endpoints.
 * Now reads imgSrc directly from Firestore, falling back to signed URLs only if needed.
 */

const express = require("express");
const router = express.Router();
const admin  = require("firebase-admin");

const db     = admin.firestore();
const bucket = admin.storage().bucket();

/**
 * Fallback: fetch public URLs for all files under
 *   kaaykoStoreTShirtImages/<productID>/
 * @param {string} productID
 * @returns {Promise<string[]>}
 */
async function fetchImagesFromStorage(productID) {
  try {
    const prefix = `kaaykoStoreTShirtImages/${productID}/`;
    const [files] = await bucket.getFiles({ prefix });
    
    // Create public URLs instead of signed URLs
    const urls = files
      .filter(f => !f.name.endsWith("/"))
      .map(file => {
        // Create public URL format: https://firebasestorage.googleapis.com/v0/b/BUCKET_NAME/o/PATH?alt=media
        const encodedPath = encodeURIComponent(file.name);
        return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media`;
      });
      
    console.log(`Found ${urls.length} images for product ${productID}:`, urls);
    return urls;
  } catch (err) {
    console.error(`Error fetching Storage images for ${productID}:`, err);
    return [];
  }
}

/**
 * GET /products
 *
 * Returns all products, reading each Firestore doc’s imgSrc array.
 * If imgSrc is missing or empty, falls back to live Storage lookup.
 */
router.get("/", async (_req, res) => {
  try {
    const snap = await db.collection("kaaykoproducts").get();
    const products = await Promise.all(
      snap.docs.map(async docSnap => {
        const d = docSnap.data();
        const base = {
          id:              docSnap.id,
          title:           d.title           || "",
          description:     d.description     || "",
          price:           d.price           || "",
          votes:           d.votes           || 0,
          productID:       d.productID       || "",
          tags:            d.tags            || [],
          availableColors: d.availableColors || [],
          availableSizes:  d.availableSizes  || [],
          maxQuantity:     d.maxQuantity     || 1,
          imgSrc:          Array.isArray(d.imgSrc) ? d.imgSrc : []
        };

        // Always fetch images from Storage to ensure we get the latest
        if (base.productID) {
          base.imgSrc = await fetchImagesFromStorage(base.productID);
        }
        return base;
      })
    );

    return res.json(products);
  } catch (err) {
    console.error("Error listing products:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /products/:id
 *
 * Returns one product by Firestore doc ID, including imgSrc fallback.
 */
router.get("/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "Missing product ID" });

  try {
    const docSnap = await db.collection("kaaykoproducts").doc(id).get();
    if (!docSnap.exists) return res.status(404).json({ error: "Not found" });

    const d = docSnap.data();
    const product = {
      id,
      title:           d.title           || "",
      description:     d.description     || "",
      price:           d.price           || "",
      votes:           d.votes           || 0,
      productID:       d.productID       || "",
      tags:            d.tags            || [],
      availableColors: d.availableColors || [],
      availableSizes:  d.availableSizes  || [],
      maxQuantity:     d.maxQuantity     || 1,
      imgSrc:          Array.isArray(d.imgSrc) ? d.imgSrc : []
    };

    // Always fetch images from Storage to ensure we get the latest
    if (product.productID) {
      product.imgSrc = await fetchImagesFromStorage(product.productID);
    }

    return res.json(product);
  } catch (err) {
    console.error("Error fetching product:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /products/:id/vote
 *
 * Body: { voteChange: 1 | -1 }
 * Atomically increments the 'votes' field.
 */
router.post("/:id/vote", async (req, res) => {
  const id = req.params.id;
  const { voteChange } = req.body;
  if (!id) return res.status(400).json({ error: "Missing product ID" });
  if (![1, -1].includes(voteChange)) {
    return res.status(400).json({ error: "voteChange must be +1 or -1" });
  }

  try {
    await db
      .collection("kaaykoproducts")
      .doc(id)
      .update({ votes: admin.firestore.FieldValue.increment(voteChange) });
    return res.json({ success: true });
  } catch (err) {
    console.error("Error updating votes:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;