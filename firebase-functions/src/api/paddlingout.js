//  functions/src/api/paddlingSpots.js
//
//  Express router for the "Paddling Out" spots API.
//
//  • GET  /paddlingSpots         → list all paddling spots
//  • GET  /paddlingSpots/:id     → details (and images) for one spot

const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');

const db     = admin.firestore();
const bucket = admin.storage().bucket();

// functions/src/api/paddlingSpots.js

/**
 * Lists all images under "images/paddling_out/"
 * and returns only those whose fileName starts with spotId.
 */
async function fetchSpotImages(spotId) {
    const prefix = `images/paddling_out/`;
    try {
      // List all files in the paddling_out folder
      const [files] = await bucket.getFiles({ prefix });
      // Filter only images for this spotId
      const matching = files.filter((file) => {
        const fileName = file.name.split('/').pop() || '';
        return fileName.toLowerCase().startsWith(spotId.toLowerCase());
      });
      const urls = matching.map((file) => {
        const encodedPath = encodeURIComponent(file.name);
        return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media`;
      });
      console.log(`Found ${urls.length} images for spot ${spotId}:`, urls);
      return urls;
    } catch (err) {
      console.error(`Error fetching images for spot ${spotId}:`, err);
      return [];
    }
  }

/**
 * GET /paddlingSpots
 *
 * Returns an array of all paddling spot documents,
 * each including a fresh set of signed image URLs.
 */
router.get('/', async (req, res) => {
  console.log('🏄 paddlingOut GET / route hit!');
  try {
    console.log('Attempting to fetch paddlingSpots collection...');
    const snapshot = await db.collection('paddlingSpots').get();
    console.log(`Found ${snapshot.docs.length} documents in paddlingSpots collection`);
    
    if (snapshot.empty) {
      console.log('No documents found in paddlingSpots collection');
      return res.json([]);
    }
    
    const spots = await Promise.all(
      snapshot.docs.map(async docSnap => {
        const data = docSnap.data();
        const spot = {
          id:           docSnap.id,
          lakeName:     data.lakeName   || '',
          title:        data.title      || '',
          subtitle:     data.subtitle   || '',
          text:         data.text       || '',
          youtubeURL:   data.youtubeURL || '',
          location:     data.location   || {},
          parkingAvl:   data.parkingAvl || 'N',
          restroomsAvl: data.restroomsAvl || 'N'
        };
        
        // Always fetch images from Storage to ensure we get the latest
        spot.imgSrc = await fetchSpotImages(docSnap.id);
        return spot;
      })
    );

    // Cache JSON for 60 seconds
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(spots);
  } catch (err) {
    console.error('Error listing paddling spots:', err);
    console.error('Error details:', err.message);
    console.error('Error stack:', err.stack);
    return res.status(500).json({ 
      error: 'Server error',
      details: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /paddlingSpots/:id
 *
 * Returns a single paddling spot by document ID,
 * including its array of signed image URLs.
 */
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: 'Missing spot ID' });
  }

  try {
    const docSnap = await db.collection('paddlingSpots').doc(id).get();
    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Not found' });
    }

    const data = docSnap.data();
    const spot = {
      id:           docSnap.id,
      lakeName:     data.lakeName   || '',
      title:        data.title      || '',
      subtitle:     data.subtitle   || '',
      text:         data.text       || '',
      youtubeURL:   data.youtubeURL || '',
      location:     data.location   || {},
      parkingAvl:   data.parkingAvl || 'N',
      restroomsAvl: data.restroomsAvl || 'N'
    };
    
    // Always fetch images from Storage to ensure we get the latest
    spot.imgSrc = await fetchSpotImages(id);

    // Cache JSON for 60 seconds
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(spot);
  } catch (err) {
    console.error(`Error fetching paddling spot ${id}:`, err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;