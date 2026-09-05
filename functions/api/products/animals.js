/**
 * /api/animals — Kaayko animal pages.
 *   GET /animals           → list summaries (slug, name, status, artUrl, productCount)
 *   GET /animals/:slug     → full animal doc + every kaaykoproducts SKU bearing it
 */

const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");

const db = admin.firestore();
const ANIMALS = "kaayko_animals";
const PRODUCTS = "kaaykoproducts";

function shapeAnimal(doc) {
  const d = doc.data();
  return {
    slug: d.slug || doc.id,
    name: d.name || "",
    scientificName: d.scientificName || "",
    iucnStatus: d.iucnStatus || "",
    population: d.population || "",
    park: d.park || "",
    regions: d.regions || [],
    bio: d.bio || "",
    artUrl: d.artUrl || null,
    artPreviewUrl: d.artPreviewUrl || null,
    productMatch: d.productMatch || [],
    createdAt: d.createdAt?.toDate?.()?.toISOString() || null,
    updatedAt: d.updatedAt?.toDate?.()?.toISOString() || null,
  };
}

function shapeProduct(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    productID: d.productID || "",
    title: d.title || "",
    description: d.description || "",
    price: d.price || "",
    actualPrice: typeof d.actualPrice === "number" ? d.actualPrice : null,
    productType: d.productType || "",
    category: d.category || "",
    tags: d.tags || [],
    availableSizes: d.availableSizes || [],
    availableColors: d.availableColors || [],
    maxQuantity: d.maxQuantity || 1,
    isAvailable: d.isAvailable !== false,
    soldOut: d.soldOut === true,
    storyCopy: typeof d.storyCopy === "string" ? d.storyCopy : "",
    fileRows: Array.isArray(d.fileRows) ? d.fileRows : [],
    theme: d.theme || "",
    imgSrc: Array.isArray(d.imgSrc) ? d.imgSrc : [],
    previewSrc: Array.isArray(d.previewSrc) ? d.previewSrc : [],
    animalSlug: d.animalSlug || null,
    createdAt: d.createdAt?.toDate?.()?.toISOString() || null,
  };
}

router.get("/", async (_req, res) => {
  try {
    const snap = await db.collection(ANIMALS).get();
    const animals = snap.docs.map(shapeAnimal);
    return res.json({ success: true, animals });
  } catch (err) {
    console.error("animals list error:", err);
    return res.status(500).json({ success: false, error: "Server error", code: "SERVER_ERROR" });
  }
});

router.get("/:slug", async (req, res) => {
  const slug = req.params.slug;
  if (!slug) {
    return res.status(400).json({ success: false, error: "Bad Request", code: "MISSING_SLUG" });
  }
  try {
    const docSnap = await db.collection(ANIMALS).doc(slug).get();
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, error: "Not found", code: "NOT_FOUND" });
    }
    const animal = shapeAnimal(docSnap);

    const productSnap = await db
      .collection(PRODUCTS)
      .where("animalSlug", "==", slug)
      .get();
    const products = productSnap.docs
      .map(shapeProduct)
      .filter((p) => p.isAvailable !== false);

    return res.json({ success: true, animal, products });
  } catch (err) {
    console.error(`animal fetch error for ${slug}:`, err);
    return res.status(500).json({ success: false, error: "Server error", code: "SERVER_ERROR" });
  }
});

module.exports = router;
