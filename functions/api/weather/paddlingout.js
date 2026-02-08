/**
 * Paddling Out Router — Spot listings with live paddle scores
 *
 * GET /paddlingOut      → all spots (with images + ML paddle scores)
 * GET /paddlingOut/:id  → single spot detail
 *
 * @module api/weather/paddlingout
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getPaddleScoreForLocation } = require('./paddlingoutService');

const db = admin.firestore();
const bucket = admin.storage().bucket();

/** Fetch spot images from Firebase Storage. */
async function fetchSpotImages(spotId) {
  const prefix = 'images/paddling_out/';
  try {
    const [files] = await bucket.getFiles({ prefix });
    const matching = files.filter(f => (f.name.split('/').pop() || '').toLowerCase().startsWith(spotId.toLowerCase()));
    return matching.map(f => {
      const encoded = encodeURIComponent(f.name);
      return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media`;
    });
  } catch (err) {
    console.error(`Error fetching images for spot ${spotId}:`, err);
    return [];
  }
}

/** Build a spot document with images and paddle score. */
async function enrichSpot(docSnap) {
  const data = docSnap.data();
  const spot = {
    id: docSnap.id,
    lakeName: data.lakeName || '', title: data.title || '',
    subtitle: data.subtitle || '', text: data.text || '',
    youtubeURL: data.youtubeURL || '', location: data.location || {},
    parkingAvl: data.parkingAvl || 'N', restroomsAvl: data.restroomsAvl || 'N'
  };
  spot.imgSrc = await fetchSpotImages(docSnap.id);
  spot.paddleScore = await getPaddleScoreForLocation(spot.location);
  return spot;
}

router.get('/', async (req, res) => {
  console.log('🏄 paddlingOut GET / route hit!');
  const startTime = Date.now();
  try {
    const snapshot = await db.collection('paddlingSpots').get();
    if (snapshot.empty) return res.json([]);

    const spots = await Promise.all(snapshot.docs.map(enrichSpot));
    const scored = spots.filter(s => s.paddleScore).length;
    console.log(`✅ Paddle scores: ${scored}/${spots.length} locations`);

    res.set('Cache-Control', 'public, max-age=60');
    console.log(`⏱️  paddlingOut response: ${Date.now() - startTime}ms`);
    return res.json(spots);
  } catch (err) {
    console.error('Error listing paddling spots:', err);
    return res.status(500).json({ error: 'Server error', details: err.message, timestamp: new Date().toISOString() });
  }
});

router.get('/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'Missing spot ID' });
  try {
    const docSnap = await db.collection('paddlingSpots').doc(id).get();
    if (!docSnap.exists) return res.status(404).json({ error: 'Not found' });

    const spot = await enrichSpot(docSnap);
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(spot);
  } catch (err) {
    console.error(`Error fetching paddling spot ${id}:`, err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
