const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// Per-cold-start in-memory cache: avoids re-fetching Firestore on every request
const _cache = {};
async function getBrandDoc(brand) {
  const key = brand.toLowerCase();
  if (_cache[key]) return _cache[key];
  const snap = await admin.firestore().collection('Kameras').doc(key).get();
  if (!snap.exists) return null;
  _cache[key] = snap.data();
  return _cache[key];
}

// GET /cameras/:brand — all cameras for a brand
router.get('/:brand', async (req, res) => {
  try {
    const { brand } = req.params;
    const data = await getBrandDoc(brand);
    if (!data) return res.status(404).json({ error: { code: 'BRAND_NOT_FOUND', message: `No camera data found for brand: ${brand}` } });
    res.json({ brand, cameras: data.cameras || [] });
  } catch (e) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
  }
});

// GET /cameras/:brand/:modelName — single camera
router.get('/:brand/:modelName', async (req, res) => {
  try {
    const { brand, modelName } = req.params;
    const data = await getBrandDoc(brand);
    if (!data) return res.status(404).json({ error: { code: 'BRAND_NOT_FOUND', message: `No camera data found for brand: ${brand}` } });
    const camera = (data.cameras || []).find(
      c => c.modelName.toLowerCase() === decodeURIComponent(modelName).toLowerCase()
    );
    if (!camera) return res.status(404).json({ error: { code: 'CAMERA_NOT_FOUND', message: `Camera not found: ${modelName}` } });
    res.json(camera);
  } catch (e) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
  }
});

// GET /cameras/:brand/:modelName/lenses — lenses compatible with this camera
router.get('/:brand/:modelName/lenses', async (req, res) => {
  try {
    const { brand, modelName } = req.params;
    const decodedModel = decodeURIComponent(modelName);
    const data = await getBrandDoc(brand);
    if (!data) return res.status(404).json({ error: { code: 'BRAND_NOT_FOUND', message: `No lens data found for brand: ${brand}` } });
    const compatible = (data.lenses || []).filter(l =>
      Array.isArray(l.compatibleCameras) &&
      l.compatibleCameras.some(c => c.toLowerCase() === decodedModel.toLowerCase())
    );
    res.json({ brand, cameraModel: decodedModel, lenses: compatible });
  } catch (e) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
  }
});

module.exports = router;
