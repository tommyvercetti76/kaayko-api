const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

const _cache = {};
async function getBrandDoc(brand) {
  const key = brand.toLowerCase();
  if (_cache[key]) return _cache[key];
  const snap = await admin.firestore().collection('Kameras').doc(key).get();
  if (!snap.exists) return null;
  _cache[key] = snap.data();
  return _cache[key];
}

// GET /lenses/:brand — all lenses for a brand
router.get('/:brand', async (req, res) => {
  try {
    const { brand } = req.params;
    const data = await getBrandDoc(brand);
    if (!data) return res.status(404).json({ error: { code: 'BRAND_NOT_FOUND', message: `No lens data found for brand: ${brand}` } });
    res.json({ brand, lenses: data.lenses || [] });
  } catch (e) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
  }
});

// GET /lenses/:brand/:lensName — single lens
router.get('/:brand/:lensName', async (req, res) => {
  try {
    const { brand, lensName } = req.params;
    const data = await getBrandDoc(brand);
    if (!data) return res.status(404).json({ error: { code: 'BRAND_NOT_FOUND', message: `No lens data found for brand: ${brand}` } });
    const lens = (data.lenses || []).find(
      l => l.lensName.toLowerCase() === decodeURIComponent(lensName).toLowerCase()
    );
    if (!lens) return res.status(404).json({ error: { code: 'LENS_NOT_FOUND', message: `Lens not found: ${lensName}` } });
    res.json(lens);
  } catch (e) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
  }
});

module.exports = router;
