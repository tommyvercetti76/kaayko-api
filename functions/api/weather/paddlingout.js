// functions/api/weather/paddlingout.js
//
// GET /paddlingOut       — all curated paddling spots with pre-warmed paddle scores
// GET /paddlingOut/:id   — single spot
//
// Paddle scores are NEVER computed inline here. They are pre-computed every 15 minutes
// by the warmPaddleScoreCache scheduled function and stored in paddle_score_cache.
// This endpoint reads that collection in a single Firestore read — lightning quick.

const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const PaddleScoreCache = require('../../cache/paddleScoreCache');

const db     = admin.firestore();
const bucket = admin.storage().bucket();

/**
 * Fetch image URLs for a spot from Firebase Storage.
 * Returns an empty array on any error — images are non-critical.
 */
async function fetchSpotImages(spotId) {
  const prefix = 'images/paddling_out/';
  try {
    const [files] = await bucket.getFiles({ prefix });
    const matching = files.filter(file => {
      const fileName = file.name.split('/').pop() || '';
      return fileName.toLowerCase().startsWith(spotId.toLowerCase());
    });
    return matching.map(file => {
      const encodedPath = encodeURIComponent(file.name);
      return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media`;
    });
  } catch (err) {
    console.error(`fetchSpotImages failed for ${spotId}:`, err.message);
    return [];
  }
}

/**
 * GET /paddlingOut
 *
 * Returns all curated paddling spots. Each spot includes pre-warmed paddle scores
 * from paddle_score_cache (written by the 15-min scheduled warmer). If the cache
 * has never been populated (e.g. first deploy), paddleScore will be null — the
 * warmer will fill it within 15 minutes.
 *
 * Total reads: 1 Firestore collection (paddlingSpots) + 1 Firestore collection
 * (paddle_score_cache) + N parallel Storage reads for images.
 * Typical response: 150–300ms.
 */
router.get('/', async (req, res) => {
  const startTime = Date.now();
  console.log('paddlingOut GET /');

  try {
    const [snapshot, allScores] = await Promise.all([
      db.collection('paddlingSpots').get(),
      new PaddleScoreCache().getAll()
    ]);

    if (snapshot.empty) {
      return res.json([]);
    }

    const spots = await Promise.all(
      snapshot.docs.map(async docSnap => {
        const data = docSnap.data();
        const spot = {
          id:           docSnap.id,
          lakeName:     data.lakeName     || '',
          title:        data.title        || '',
          subtitle:     data.subtitle     || '',
          text:         data.text         || '',
          youtubeURL:   data.youtubeURL   || '',
          location:     data.location     || {},
          parkingAvl:   data.parkingAvl   || 'N',
          restroomsAvl: data.restroomsAvl || 'N'
        };

        // Images and paddle score fetched concurrently
        const [imgSrc, paddleScore] = await Promise.all([
          fetchSpotImages(docSnap.id),
          Promise.resolve(allScores.get(docSnap.id) || null)
        ]);

        spot.imgSrc     = imgSrc;
        spot.paddleScore = paddleScore;

        return spot;
      })
    );

    const scored = spots.filter(s => s.paddleScore !== null).length;
    console.log(`paddlingOut: ${scored}/${spots.length} spots have cached scores — ${Date.now() - startTime}ms`);

    res.set('Cache-Control', 'public, max-age=60');
    return res.json(spots);

  } catch (err) {
    console.error('paddlingOut GET / error:', err.message);
    return res.status(500).json({
      error: 'Server error',
      details: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /paddlingOut/:id
 *
 * Returns a single paddling spot with its cached paddle score.
 */
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid spot ID' });
  }

  try {
    const [docSnap, allScores] = await Promise.all([
      db.collection('paddlingSpots').doc(id).get(),
      new PaddleScoreCache().getAll()
    ]);

    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Not found' });
    }

    const data = docSnap.data();
    const spot = {
      id:           docSnap.id,
      lakeName:     data.lakeName     || '',
      title:        data.title        || '',
      subtitle:     data.subtitle     || '',
      text:         data.text         || '',
      youtubeURL:   data.youtubeURL   || '',
      location:     data.location     || {},
      parkingAvl:   data.parkingAvl   || 'N',
      restroomsAvl: data.restroomsAvl || 'N'
    };

    const [imgSrc] = await Promise.all([fetchSpotImages(id)]);
    spot.imgSrc      = imgSrc;
    spot.paddleScore = allScores.get(id) || null;

    res.set('Cache-Control', 'public, max-age=60');
    return res.json(spot);

  } catch (err) {
    console.error(`paddlingOut GET /${id} error:`, err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
