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
const { isPublicPaddlingSpot } = require('./communitySpotVisibility');
const { requireAdmin } = require('../../middleware/authMiddleware');
const { sendRawEmail } = require('../../services/emailNotificationService');

const db     = admin.firestore();
const bucket = admin.storage().bucket();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const LAKE_SUBMISSION_LIMIT_PER_DAY = 5;
const COMMUNITY_GO_LIVE_DELAY_MS = 48 * 60 * 60 * 1000;

function sanitizeText(value, maxLength = 160) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeEmail(value) {
  const email = sanitizeText(value, 254).toLowerCase();
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function parseCoordinate(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim() || req.ip || 'unknown';
}

function slugify(value) {
  const base = sanitizeText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base || `lake-${Date.now().toString(36)}`;
}

async function uniqueSpotId(baseSlug) {
  const base = `community-${baseSlug}`.slice(0, 90).replace(/-$/g, '');
  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const doc = await db.collection('paddlingSpots').doc(candidate).get();
    if (!doc.exists) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function sanitizeYesNo(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['yes', 'y', 'true', 'available'].includes(v)) return 'Y';
  if (['no', 'n', 'false', 'unavailable'].includes(v)) return 'N';
  return 'N';
}

function publicSubmissionPayload(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    spotId: data.spotId || docSnap.id,
    lakeName: data.lakeName || '',
    subtitle: data.subtitle || '',
    location: data.location || {},
    city: data.city || '',
    region: data.region || '',
    country: data.country || '',
    launchHint: data.launchHint || '',
    parkingAvl: data.parkingAvl || 'N',
    restroomsAvl: data.restroomsAvl || 'N',
    anonymous: data.anonymous === true,
    contactEmail: data.contactEmail || null,
    status: data.status || data.submissionStatus || 'pending',
    submissionStatus: data.submissionStatus || data.status || 'pending',
    notificationStatus: data.notificationStatus || 'not_requested',
    goLiveAt: data.goLiveAt || null,
    createdAt: data.createdAt || data.submittedAt || null,
    validatedAt: data.validatedAt || null,
    validatedBy: data.validatedBy || null
  };
}

function adminActor(req) {
  return req.user?.email || req.user?.uid || 'admin';
}

async function notifySubmissionValidated(submission, spotId) {
  if (!submission.contactEmail) {
    return { success: true, status: 'not_requested' };
  }

  const lakeName = escapeForEmail(submission.lakeName || 'your lake');
  const lakeUrl = `https://kaayko.com/paddlingout/?id=${encodeURIComponent(spotId)}`;

  return sendRawEmail({
    to: submission.contactEmail,
    subject: `Your Kaayko lake entry is validated`,
    html: `
      <p>Hi,</p>
      <p>Your Paddling Out entry for <strong>${lakeName}</strong> has been validated and is live on Kaayko.</p>
      <p><a href="${lakeUrl}">View the lake on Paddling Out</a></p>
      <p>Thanks for helping grow the paddling map.</p>
      <p>Kaayko</p>
    `,
    text: [
      'Hi,',
      '',
      `Your Paddling Out entry for ${submission.lakeName || 'your lake'} has been validated and is live on Kaayko.`,
      `View it here: ${lakeUrl}`,
      '',
      'Thanks for helping grow the paddling map.',
      'Kaayko'
    ].join('\n')
  });
}

function escapeForEmail(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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

async function submitEntryHandler(req, res) {
  try {
    const body = req.body || {};
    const lakeName = sanitizeText(body.lakeName || body.name, 120);
    const city = sanitizeText(body.city, 80);
    const region = sanitizeText(body.region || body.state, 80);
    const country = sanitizeText(body.country, 80) || 'United States';
    const launchHint = sanitizeText(body.launchHint, 160);
    const description = sanitizeText(body.description || body.text, 360);
    const source = sanitizeText(body.source, 60) || 'paddlingout_submitentry';
    const pageUrl = sanitizeText(body.pageUrl, 500);
    const referrer = sanitizeText(body.referrer, 500);
    const email = sanitizeEmail(body.email);
    const anonymous = body.anonymous === true || body.contactPreference === 'anonymous' || !email;
    const parkingAvl = sanitizeYesNo(body.parkingAvl || body.parking);
    const restroomsAvl = sanitizeYesNo(body.restroomsAvl || body.restrooms);

    if (email === null) {
      return res.status(400).json({ success: false, error: 'Invalid email address' });
    }

    if (!lakeName) {
      return res.status(400).json({
        success: false,
        error: 'Lake name is required'
      });
    }

    const lat = parseCoordinate(body.lat ?? body.latitude);
    const lng = parseCoordinate(body.lng ?? body.lon ?? body.longitude);
    const hasLat = lat !== null;
    const hasLng = lng !== null;

    if (!hasLat || !hasLng) {
      return res.status(400).json({ success: false, error: 'Latitude and longitude are required' });
    }
    if (hasLat !== hasLng) {
      return res.status(400).json({ success: false, error: 'Both lat and lng are required when submitting coordinates' });
    }
    if ((hasLat && (Number.isNaN(lat) || lat < -90 || lat > 90)) ||
        (hasLng && (Number.isNaN(lng) || lng < -180 || lng > 180))) {
      return res.status(400).json({ success: false, error: 'Invalid coordinates' });
    }

    const today = new Date().toISOString().split('T')[0];
    const ip = getClientIp(req);
    const rateDocId = `${ip}_${today}`.replace(/[\/#?[\]]/g, '_');
    const rateRef = db.collection('lake_submission_rate_limits').doc(rateDocId);
    const rateSnap = await rateRef.get();

    if (rateSnap.exists && (rateSnap.data().count || 0) >= LAKE_SUBMISSION_LIMIT_PER_DAY) {
      return res.status(429).json({
        success: false,
        error: 'Daily lake submission limit reached. Please try again tomorrow.'
      });
    }

    const locationPieces = [city, region, country].filter(Boolean);
    const subtitle = locationPieces.join(', ');
    const now = Date.now();
    const goLiveAtDate = new Date(now + COMMUNITY_GO_LIVE_DELAY_MS);
    const spotId = await uniqueSpotId(slugify([lakeName, city, region].filter(Boolean).join(' ')));
    const baseText = description || [
      launchHint ? `Launch note: ${launchHint}.` : '',
      'Community-submitted paddling location awaiting validation.'
    ].filter(Boolean).join(' ');

    const publicSpotDoc = {
      lakeName,
      title: lakeName,
      subtitle,
      text: baseText,
      location: hasLat ? { latitude: lat, longitude: lng } : {},
      parkingAvl,
      restroomsAvl,
      youtubeURL: '',
      imgSrc: [],
      communitySubmission: true,
      submissionStatus: 'pending',
      submittedAt: FieldValue.serverTimestamp(),
      goLiveAt: Timestamp.fromDate(goLiveAtDate),
      validatedAt: null,
      validatedBy: null,
      source,
      launchHint,
      city,
      region,
      country
    };

    const submissionDoc = {
      spotId,
      ...publicSpotDoc,
      contactEmail: anonymous ? null : email,
      anonymous,
      notificationStatus: anonymous ? 'not_requested' : 'pending_validation_notice',
      source,
      pageUrl,
      referrer,
      userAgent: sanitizeText(req.headers['user-agent'], 300),
      ip,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    await db.collection('paddlingSpots').doc(spotId).set(publicSpotDoc);
    await db.collection('paddling_lake_submissions').doc(spotId).set(submissionDoc);
    await rateRef.set({
      count: FieldValue.increment(1),
      date: today,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return res.status(201).json({
      success: true,
      id: spotId,
      goLiveAt: goLiveAtDate.toISOString(),
      message: anonymous
        ? 'Entry received. It will go live after the validation window.'
        : 'Entry received. We will notify you when it is validated.'
    });

  } catch (err) {
    console.error('paddlingOut POST /submitEntry error:', err.message, err.stack);
    return res.status(500).json({ success: false, error: 'Failed to submit lake entry' });
  }
}

/**
 * POST /paddlingOut/submitEntry
 *
 * Public community lake submission. Writes a paddlingSpots-compatible document
 * immediately, but public reads hide it until admin validation or goLiveAt.
 */
router.post('/submitEntry', submitEntryHandler);
router.post('/lakeRequests', submitEntryHandler);

/**
 * GET /paddlingOut/admin/submissions
 *
 * Admin-only view of community lake submissions. Uses the existing X-Admin-Key
 * path through requireAdmin for lightweight internal review tools.
 */
router.get('/admin/submissions', requireAdmin, async (req, res) => {
  try {
    const status = sanitizeText(req.query.status, 40);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const snapshot = await db.collection('paddling_lake_submissions')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    let submissions = snapshot.docs.map(publicSubmissionPayload);
    if (status) {
      submissions = submissions.filter(submission =>
        submission.status === status || submission.submissionStatus === status
      );
    }

    return res.json({ success: true, submissions });
  } catch (err) {
    console.error('paddlingOut GET /admin/submissions error:', err.message, err.stack);
    return res.status(500).json({ success: false, error: 'Failed to load submissions' });
  }
});

/**
 * POST /paddlingOut/admin/submissions/:id/validate
 *
 * Marks a community submission validated. Validated submissions are immediately
 * public; pending submissions also become public automatically when goLiveAt
 * passes.
 */
router.post('/admin/submissions/:id/validate', requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ success: false, error: 'Invalid submission ID' });
  }

  try {
    const submissionRef = db.collection('paddling_lake_submissions').doc(id);
    const spotRef = db.collection('paddlingSpots').doc(id);
    const [submissionSnap, spotSnap] = await Promise.all([
      submissionRef.get(),
      spotRef.get()
    ]);

    if (!submissionSnap.exists || !spotSnap.exists) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }

    const actor = adminActor(req);
    const notes = sanitizeText(req.body?.notes, 500);
    const validationUpdate = {
      submissionStatus: 'validated',
      validatedAt: FieldValue.serverTimestamp(),
      validatedBy: actor,
      updatedAt: FieldValue.serverTimestamp()
    };
    const submissionUpdate = {
      ...validationUpdate,
      status: 'validated'
    };
    if (notes) submissionUpdate.validationNotes = notes;

    await Promise.all([
      spotRef.set(validationUpdate, { merge: true }),
      submissionRef.set(submissionUpdate, { merge: true })
    ]);

    const submission = {
      ...submissionSnap.data(),
      ...submissionUpdate,
      spotId: id
    };

    let notification = { success: true, status: 'not_requested' };
    if (submission.contactEmail) {
      try {
        const emailResult = await notifySubmissionValidated(submission, id);
        notification = {
          success: emailResult.success !== false,
          status: 'sent',
          provider: emailResult.provider || null,
          messageId: emailResult.messageId || null
        };
      } catch (emailErr) {
        console.warn('paddlingOut validation email failed:', emailErr.message);
        notification = {
          success: false,
          status: 'failed',
          error: emailErr.message
        };
      }

      await submissionRef.set({
        notificationStatus: notification.status,
        notificationResult: notification,
        notificationUpdatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return res.json({
      success: true,
      id,
      status: 'validated',
      notification
    });
  } catch (err) {
    console.error(`paddlingOut POST /admin/submissions/${id}/validate error:`, err.message, err.stack);
    return res.status(500).json({ success: false, error: 'Failed to validate submission' });
  }
});

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

    const publicDocs = snapshot.docs.filter(docSnap => isPublicPaddlingSpot(docSnap.data()));

    const spots = await Promise.all(
      publicDocs.map(async docSnap => {
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
          restroomsAvl: data.restroomsAvl || 'N',
          communitySubmission: data.communitySubmission === true
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
    console.log(`paddlingOut: ${scored}/${spots.length} public spots have cached scores — ${Date.now() - startTime}ms`);

    res.set('Cache-Control', 'public, max-age=60');
    return res.json(spots);

  } catch (err) {
    console.error('paddlingOut GET / error:', err.message, err.stack);
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
    if (!isPublicPaddlingSpot(data)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const spot = {
      id:           docSnap.id,
      lakeName:     data.lakeName     || '',
      title:        data.title        || '',
      subtitle:     data.subtitle     || '',
      text:         data.text         || '',
      youtubeURL:   data.youtubeURL   || '',
      location:     data.location     || {},
      parkingAvl:   data.parkingAvl   || 'N',
      restroomsAvl: data.restroomsAvl || 'N',
      communitySubmission: data.communitySubmission === true
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
