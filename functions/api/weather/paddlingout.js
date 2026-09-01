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
const crypto  = require('crypto');
const Busboy  = require('busboy');
const PaddleScoreCache = require('../../cache/paddleScoreCache');
const { isPublicPaddlingSpot } = require('./communitySpotVisibility');
const { requireAdmin, optionalAuthForAdmin } = require('../../middleware/authMiddleware');
const { sendRawEmail } = require('../../services/emailNotificationService');

const db     = admin.firestore();
const bucket = admin.storage().bucket();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const LAKE_SUBMISSION_LIMIT_PER_DAY = 5;
const COMMUNITY_GO_LIVE_DELAY_MS = 48 * 60 * 60 * 1000;
const LAKE_SUBMISSION_DEDUPE_MS = 7 * 24 * 60 * 60 * 1000;
const SUBMISSION_IMAGE_LIMIT = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = SUBMISSION_IMAGE_LIMIT * MAX_IMAGE_BYTES;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SUBMISSION_FIELDS = new Set([
  'lakeName',
  'name',
  'city',
  'region',
  'state',
  'country',
  'lat',
  'latitude',
  'lng',
  'lon',
  'longitude',
  'launchHint',
  'description',
  'text',
  'parkingAvl',
  'parking',
  'restroomsAvl',
  'restrooms',
  'contactPreference',
  'anonymous',
  'email',
  'pageUrl',
  'referrer',
  'source'
]);

function submitEntryUpload(req, res, next) {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    req.files = [];
    return next();
  }

  const busboy = Busboy({
    headers: req.headers,
    limits: {
      files: SUBMISSION_IMAGE_LIMIT,
      fileSize: MAX_IMAGE_BYTES,
      fields: 30,
      fieldSize: 1000
    }
  });
  const fields = {};
  const files = [];
  let totalBytes = 0;
  let uploadError = '';
  let finished = false;

  function fail(message) {
    uploadError = uploadError || message;
  }

  busboy.on('field', (name, value, info = {}) => {
    if (uploadError) return;
    if (!SUBMISSION_FIELDS.has(name)) return;
    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      return fail('Duplicate form fields are not allowed');
    }
    if (info.valueTruncated) return fail('Form field is too large');
    fields[name] = value;
  });

  busboy.on('file', (name, file, info = {}) => {
    if (name !== 'images') {
      file.resume();
      return;
    }

    const mimeType = info.mimeType || '';
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      fail('Images must be JPEG, PNG, or WebP files');
      file.resume();
      return;
    }

    const chunks = [];
    let size = 0;
    file.on('data', chunk => {
      if (uploadError) return;
      size += chunk.length;
      totalBytes += chunk.length;
      if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
        fail('Total image upload must be 15 MB or smaller');
        return;
      }
      chunks.push(chunk);
    });
    file.on('limit', () => fail('Each image must be 5 MB or smaller'));
    file.on('end', () => {
      if (uploadError) return;
      files.push({
        fieldname: name,
        originalname: sanitizeText(info.filename, 160),
        mimetype: mimeType,
        size,
        buffer: Buffer.concat(chunks)
      });
    });
  });

  busboy.on('filesLimit', () => fail(`Upload ${SUBMISSION_IMAGE_LIMIT} images or fewer`));
  busboy.on('fieldsLimit', () => fail('Too many form fields'));
  busboy.on('error', () => {
    if (finished) return;
    finished = true;
    return res.status(400).json({ success: false, error: 'Image upload is invalid' });
  });
  busboy.on('finish', () => {
    if (finished) return;
    finished = true;
    if (uploadError) {
      return res.status(400).json({ success: false, error: uploadError });
    }
    req.body = fields;
    req.files = files;
    return next();
  });

  if (Buffer.isBuffer(req.rawBody)) {
    busboy.end(req.rawBody);
  } else {
    req.pipe(busboy);
  }
}

function sanitizeText(value, maxLength = 160) {
  if (Array.isArray(value)) return '';
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
  if (Array.isArray(value)) return NaN;
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
  const random = crypto.randomBytes(4).toString('hex');
  const base = `community-${baseSlug}-${random}`.slice(0, 90).replace(/-$/g, '');
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

function parseBoolean(value) {
  if (value === true) return true;
  const v = String(value || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y'].includes(v);
}

function publicStorageUrl(path) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
}

function hashValue(value) {
  const salt = process.env.IP_HASH_SALT || process.env.ADMIN_PASSPHRASE || 'kaayko-paddlingout-v1';
  return crypto.createHash('sha256').update(`${salt}:${value || 'unknown'}`).digest('hex');
}

function normalizedSubmissionKey({ lakeName, city, region, country, lat, lng }) {
  const key = [
    lakeName.toLowerCase(),
    city.toLowerCase(),
    region.toLowerCase(),
    country.toLowerCase(),
    Number(lat).toFixed(3),
    Number(lng).toFixed(3)
  ].join('|');
  return hashValue(key);
}

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function imageExtension(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

function validateSubmissionImages(files) {
  if (!Array.isArray(files) || files.length === 0) {
    const err = new Error('At least one lake image is required');
    err.code = 'IMAGE_REQUIRED';
    throw err;
  }
  if (files.length > SUBMISSION_IMAGE_LIMIT) {
    const err = new Error(`Upload ${SUBMISSION_IMAGE_LIMIT} images or fewer`);
    err.code = 'TOO_MANY_IMAGES';
    throw err;
  }

  const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
    const err = new Error('Total image upload must be 15 MB or smaller');
    err.code = 'IMAGES_TOO_LARGE';
    throw err;
  }

  return files.map(file => {
    const detectedMime = detectImageMime(file.buffer);
    if (!detectedMime || detectedMime !== file.mimetype || !ALLOWED_IMAGE_TYPES.has(detectedMime)) {
      const err = new Error('Images must be valid JPEG, PNG, or WebP files');
      err.code = 'INVALID_IMAGE_SIGNATURE';
      throw err;
    }
    return {
      file,
      mime: detectedMime,
      size: file.size || file.buffer.length,
      ext: imageExtension(detectedMime)
    };
  });
}

async function reserveSubmissionSlot({ ipHash, dedupeKey }) {
  const today = new Date().toISOString().split('T')[0];
  const rateDocId = `${ipHash}_${today}`;
  const rateRef = db.collection('lake_submission_rate_limits').doc(rateDocId);
  const dedupeRef = db.collection('paddling_lake_submission_keys').doc(dedupeKey);
  const expiresAt = Timestamp.fromMillis(Date.now() + LAKE_SUBMISSION_DEDUPE_MS);

  await db.runTransaction(async transaction => {
    const [rateSnap, dedupeSnap] = await Promise.all([
      transaction.get(rateRef),
      transaction.get(dedupeRef)
    ]);

    if (rateSnap.exists && (rateSnap.data().count || 0) >= LAKE_SUBMISSION_LIMIT_PER_DAY) {
      const err = new Error('Daily lake submission limit reached. Please try again tomorrow.');
      err.code = 'RATE_LIMIT';
      throw err;
    }
    if (dedupeSnap.exists) {
      const err = new Error('This lake entry was already submitted recently.');
      err.code = 'DUPLICATE_SUBMISSION';
      throw err;
    }

    transaction.set(rateRef, {
      count: FieldValue.increment(1),
      date: today,
      ipHash,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(dedupeRef, {
      ipHash,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt
    });
  });
}

async function uploadSubmissionImages(images, spotId) {
  const uploaded = [];
  try {
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const random = crypto.randomBytes(6).toString('hex');
      const path = `images/paddling_out/${spotId}-${i + 1}-${random}.${image.ext}`;
      const fileRef = bucket.file(path);
      await fileRef.save(image.file.buffer, {
        resumable: false,
        metadata: {
          contentType: image.mime,
          cacheControl: 'public, max-age=31536000, immutable',
          metadata: {
            source: 'paddlingout_submitentry',
            communitySubmission: 'true'
          }
        },
        validation: 'md5'
      });
      uploaded.push({
        path,
        url: publicStorageUrl(path),
        contentType: image.mime,
        size: image.size
      });
    }
    return uploaded;
  } catch (err) {
    await Promise.allSettled(uploaded.map(image => bucket.file(image.path).delete()));
    throw err;
  }
}

async function deleteSubmissionImages(imagePaths) {
  if (!Array.isArray(imagePaths) || !imagePaths.length) return [];
  const results = await Promise.allSettled(
    imagePaths.map(path => bucket.file(path).delete())
  );
  return results.map((result, index) => ({
    path: imagePaths[index],
    deleted: result.status === 'fulfilled',
    error: result.status === 'rejected' ? result.reason?.message || 'delete failed' : null
  }));
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
    imgSrc: Array.isArray(data.imgSrc) ? data.imgSrc : [],
    imageCount: data.imageCount || 0,
    imagePaths: Array.isArray(data.imagePaths) ? data.imagePaths : [],
    imageMeta: Array.isArray(data.imageMeta) ? data.imageMeta : [],
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
// One Storage listing per request (short in-memory TTL), grouped in memory —
// listing the whole prefix once PER SPOT made the list route O(spots × files).
let _imageListCache = { at: 0, files: null };
const IMAGE_LIST_TTL_MS = 60 * 1000;

async function listAllSpotImages() {
  if (_imageListCache.files && Date.now() - _imageListCache.at < IMAGE_LIST_TTL_MS) {
    return _imageListCache.files;
  }
  const [files] = await bucket.getFiles({ prefix: 'images/paddling_out/' });
  const names = files.map(f => f.name);
  _imageListCache = { at: Date.now(), files: names };
  return names;
}

async function fetchSpotImages(spotId) {
  try {
    const names = await listAllSpotImages();
    return names
      .filter(name => {
        const fileName = (name.split('/').pop() || '').toLowerCase();
        return fileName.startsWith(spotId.toLowerCase());
      })
      .map(publicStorageUrl);
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
    const country = sanitizeText(body.country, 80);
    const launchHint = sanitizeText(body.launchHint, 160);
    const description = sanitizeText(body.description || body.text, 360);
    const source = 'paddlingout_submitentry';
    const pageUrl = sanitizeText(body.pageUrl, 500);
    const referrer = sanitizeText(body.referrer, 500);
    const email = sanitizeEmail(body.email);
    const contactPreference = sanitizeText(body.contactPreference, 20);
    const anonymous = parseBoolean(body.anonymous) || contactPreference === 'anonymous';
    const parkingAvl = sanitizeYesNo(body.parkingAvl || body.parking);
    const restroomsAvl = sanitizeYesNo(body.restroomsAvl || body.restrooms);
    const images = validateSubmissionImages(req.files || []);

    if (email === null) {
      return res.status(400).json({ success: false, error: 'Invalid email address' });
    }
    if (!anonymous && !email) {
      return res.status(400).json({ success: false, error: 'Email is required when notification is requested' });
    }

    if (!lakeName || lakeName.length < 2) {
      return res.status(400).json({ success: false, error: 'Lake name is required' });
    }
    if (!city || city.length < 2) {
      return res.status(400).json({ success: false, error: 'City or nearest town is required' });
    }
    if (!region || region.length < 2) {
      return res.status(400).json({ success: false, error: 'State or region is required' });
    }
    if (!country || country.length < 2) {
      return res.status(400).json({ success: false, error: 'Country is required' });
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

    const ip = getClientIp(req);
    const ipHash = hashValue(ip);
    const dedupeKey = normalizedSubmissionKey({ lakeName, city, region, country, lat, lng });
    await reserveSubmissionSlot({ ipHash, dedupeKey });

    const locationPieces = [city, region, country].filter(Boolean);
    const subtitle = locationPieces.join(', ');
    const now = Date.now();
    const goLiveAtDate = new Date(now + COMMUNITY_GO_LIVE_DELAY_MS);
    const spotId = await uniqueSpotId(slugify([lakeName, city, region].filter(Boolean).join(' ')));
    const baseText = description || [
      launchHint ? `Launch note: ${launchHint}.` : '',
      'Community-submitted paddling location awaiting validation.'
    ].filter(Boolean).join(' ');
    const uploadedImages = await uploadSubmissionImages(images, spotId);
    const imgSrc = uploadedImages.map(image => image.url);
    const imagePaths = uploadedImages.map(image => image.path);

    const publicSpotDoc = {
      lakeName,
      title: lakeName,
      subtitle,
      text: baseText,
      location: hasLat ? { latitude: lat, longitude: lng } : {},
      parkingAvl,
      restroomsAvl,
      youtubeURL: '',
      imgSrc,
      imageCount: uploadedImages.length,
      communitySubmission: true,
      // Enrichment fields are admin-graded, never community-supplied
      waterType: null,
      submissionStatus: 'pending',
      submittedAt: FieldValue.serverTimestamp(),
      // Approve-to-publish: null goLiveAt means isPublicPaddlingSpot keeps this
      // hidden until an admin sets submissionStatus='validated' via the Kortex
      // Submissions tab. (To revert to auto-publish, restore
      // Timestamp.fromMillis(now + COMMUNITY_GO_LIVE_DELAY_MS).)
      goLiveAt: null,
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
      imagePaths,
      imageMeta: uploadedImages.map(image => ({
        contentType: image.contentType,
        size: image.size
      })),
      source,
      pageUrl,
      referrer,
      userAgent: sanitizeText(req.headers['user-agent'], 300),
      ipHash,
      dedupeKey,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    await db.collection('paddlingSpots').doc(spotId).set(publicSpotDoc);
    await db.collection('paddling_lake_submissions').doc(spotId).set(submissionDoc);

    // Notify the admin that a new submission is waiting for review (best-effort;
    // never fail the submission if mail is down). The Kortex Submissions tab
    // reads the same `paddling_lake_submissions` (status == 'pending') queue and
    // shows a live count badge, so this is a convenience nudge on top of that.
    (function notifyAdmin() {
      const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const coords = hasLat ? `${lat}, ${lng}` : 'n/a';
      sendRawEmail({
        to: 'rohan@kaayko.com',
        subject: `New lake submission: ${lakeName}`,
        text:
          `A community paddling spot was submitted and is awaiting review.\n\n` +
          `Name: ${lakeName}\nLocation: ${subtitle}\nCoords: ${coords}\n` +
          `From: ${anonymous ? 'anonymous' : email}\n\n` +
          `Review it in Kortex → Submissions: https://kaayko.com/admin/kortex#/submissions`,
        html:
          `<p>A community paddling spot is awaiting review.</p>` +
          `<p><strong>${esc(lakeName)}</strong><br>${esc(subtitle)}<br>Coords: ${esc(coords)}<br>` +
          `From: ${anonymous ? 'anonymous' : esc(email)}</p>` +
          `<p>Review it in <a href="https://kaayko.com/admin/kortex#/submissions">Kortex → Submissions</a>.</p>`
      }).catch(() => {});
    })();

    return res.status(201).json({
      success: true,
      id: spotId,
      goLiveAt: null,
      message: anonymous
        ? 'Entry received. It will appear on the map once our team reviews and approves it.'
        : 'Entry received. We will review it shortly and email you when it is approved.'
    });

  } catch (err) {
    if (err.code === 'RATE_LIMIT') {
      return res.status(429).json({ success: false, error: err.message });
    }
    if (err.code === 'DUPLICATE_SUBMISSION') {
      return res.status(409).json({ success: false, error: err.message });
    }
    if (['IMAGE_REQUIRED', 'TOO_MANY_IMAGES', 'IMAGES_TOO_LARGE', 'INVALID_IMAGE_SIGNATURE'].includes(err.code)) {
      return res.status(400).json({ success: false, error: err.message });
    }
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
router.post('/submitEntry', submitEntryUpload, submitEntryHandler);
router.post('/lakeRequests', submitEntryUpload, submitEntryHandler);

/**
 * GET /paddlingOut/admin/submissions
 *
 * Admin-only view of community lake submissions. Uses the existing X-Admin-Key
 * path through requireAdmin for lightweight internal review tools.
 */
router.get('/admin/submissions', optionalAuthForAdmin, requireAdmin, async (req, res) => {
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
router.post('/admin/submissions/:id/validate', optionalAuthForAdmin, requireAdmin, async (req, res) => {
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
 * POST /paddlingOut/admin/submissions/:id/reject
 *
 * Admin safety brake for spam, private-property submissions, or unsafe images.
 * Rejected submissions never auto-publish, and uploaded images are deleted by
 * default so rejected media does not remain publicly addressable.
 */
router.post('/admin/submissions/:id/reject', optionalAuthForAdmin, requireAdmin, async (req, res) => {
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

    const submission = submissionSnap.data() || {};
    const actor = adminActor(req);
    const reason = sanitizeText(req.body?.reason, 500);
    const deleteImages = req.body?.deleteImages !== false;
    const deletionResult = deleteImages
      ? await deleteSubmissionImages(submission.imagePaths || [])
      : [];

    const spotUpdate = {
      submissionStatus: 'rejected',
      imgSrc: [],
      imageCount: 0,
      rejectedAt: FieldValue.serverTimestamp(),
      rejectedBy: actor,
      updatedAt: FieldValue.serverTimestamp()
    };
    const submissionUpdate = {
      ...spotUpdate,
      status: 'rejected',
      rejectionReason: reason || null,
      imageDeletionResult: deletionResult,
      notificationStatus: submission.contactEmail ? 'rejected_not_sent' : (submission.notificationStatus || 'not_requested')
    };

    await Promise.all([
      spotRef.set(spotUpdate, { merge: true }),
      submissionRef.set(submissionUpdate, { merge: true })
    ]);

    return res.json({
      success: true,
      id,
      status: 'rejected',
      imagesDeleted: deletionResult.filter(item => item.deleted).length
    });
  } catch (err) {
    console.error(`paddlingOut POST /admin/submissions/${id}/reject error:`, err.message, err.stack);
    return res.status(500).json({ success: false, error: 'Failed to reject submission' });
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
// ── Geocode proxy (cached) ────────────────────────────────────────────────
// Funnels place-name lookups through ONE server identity with caching, so the
// site's users can't get rate-limited/blocked by Nominatim's ~1 req/s policy
// (previously every keystroke hit Nominatim from the visitor's own IP). Returns
// Nominatim's raw JSON array so the client parsing is unchanged.
// Registered before GET /:id so "geocode" isn't captured as a spot id.
const GEOCODE_CACHE = new Map(); // "q|limit" -> { at, data }
const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;
const GEOCODE_MAX_ENTRIES = 500;
let _lastNominatimAt = 0;

// Per-IP sliding-window limiter. In-memory (per-instance) — imperfect under
// scale-out, but it bounds a single client hammering the shared Nominatim identity
// without paying a Firestore round-trip per typeahead keystroke.
const GEOCODE_IP_WINDOW_MS = 60 * 1000;
const GEOCODE_IP_MAX_PER_WINDOW = 30;
const GEOCODE_IP_HITS = new Map(); // ip -> [timestamps]

function geocodeRateLimited(ip) {
  const now = Date.now();
  const hits = (GEOCODE_IP_HITS.get(ip) || []).filter(t => now - t < GEOCODE_IP_WINDOW_MS);
  if (hits.length >= GEOCODE_IP_MAX_PER_WINDOW) {
    GEOCODE_IP_HITS.set(ip, hits);
    return true;
  }
  hits.push(now);
  GEOCODE_IP_HITS.set(ip, hits);
  if (GEOCODE_IP_HITS.size > 2000) {
    // Drop stale IPs so the map can't grow unbounded
    for (const [k, v] of GEOCODE_IP_HITS) {
      if (v.length === 0 || now - v[v.length - 1] > GEOCODE_IP_WINDOW_MS) GEOCODE_IP_HITS.delete(k);
    }
  }
  return false;
}

router.get('/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  const limit = Math.max(1, Math.min(8, parseInt(req.query.limit, 10) || 1));
  if (q.length < 2) return res.json([]);

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  if (geocodeRateLimited(ip)) {
    return res.status(429).json([]);
  }

  const key = q.toLowerCase() + '|' + limit;

  const hit = GEOCODE_CACHE.get(key);
  if (hit && (Date.now() - hit.at) < GEOCODE_TTL_MS) {
    res.set('Cache-Control', 'public, max-age=86400');
    return res.json(hit.data);
  }

  // Politeness throttle: keep the shared server identity under ~1 req/s.
  const since = Date.now() - _lastNominatimAt;
  if (since < 1100) await new Promise(r => setTimeout(r, 1100 - since));
  _lastNominatimAt = Date.now();

  try {
    const url = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(q) +
      '&format=json&addressdetails=1&limit=' + limit;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Kaayko/1.0 (+https://kaayko.com; rohan@kaayko.com)',
        'Accept-Language': 'en'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return res.status(502).json([]);
    const data = await r.json();
    GEOCODE_CACHE.set(key, { at: Date.now(), data });
    if (GEOCODE_CACHE.size > GEOCODE_MAX_ENTRIES) {
      GEOCODE_CACHE.delete(GEOCODE_CACHE.keys().next().value); // evict oldest
    }
    res.set('Cache-Control', 'public, max-age=86400');
    return res.json(data);
  } catch (err) {
    console.error('paddlingOut /geocode error:', err.message);
    return res.status(504).json([]);
  }
});

const { applyCraftAdjustment } = require('./craftAdjustments');
const { getPreparationTips } = require('./paddleTips');
const { getHydrology } = require('./hydrologyService');

router.get('/', async (req, res) => {
  const startTime = Date.now();
  console.log('paddlingOut GET /');

  try {
    const craft = req.query.craft; // optional; kayak/absent = identity
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
          communitySubmission: data.communitySubmission === true,
          // Enrichment (absent on unenriched/community spots — clients render nothing)
          waterType:    data.waterType || null,
          cellCoverage: data.cellCoverage ? { grade: data.cellCoverage.grade } : null
        };

        // Images and paddle score fetched concurrently
        const [imgSrc, paddleScore] = await Promise.all([
          fetchSpotImages(docSnap.id),
          Promise.resolve(allScores.get(docSnap.id) || null)
        ]);

        spot.imgSrc     = imgSrc;
        spot.paddleScore = applyCraftAdjustment(paddleScore, craft);

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
      error: 'Server error'
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
    // One keyed cache read — getAll() scanned the whole collection for a single spot
    const [docSnap, cachedScore] = await Promise.all([
      db.collection('paddlingSpots').doc(id).get(),
      new PaddleScoreCache().get(id)
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
      communitySubmission: data.communitySubmission === true,
      // Full enrichment on the detail route (absent fields stay null/undefined)
      waterType:    data.waterType || null,
      cellCoverage: data.cellCoverage || null,
      localTips:    Array.isArray(data.localTips) ? data.localTips : [],
      launchHint:   data.launchHint || null
    };

    // Live hydrology for gauged river spots (cache-first, 30-min TTL)
    const [imgSrc, hydrologyNow] = await Promise.all([
      fetchSpotImages(id),
      data.hydrology ? getHydrology(data.hydrology).catch(() => null) : Promise.resolve(null)
    ]);
    spot.imgSrc      = imgSrc;
    spot.hydrologyNow = hydrologyNow;
    spot.paddleScore = applyCraftAdjustment(cachedScore || null, req.query.craft);
    // Preparation tips — computed from the cached conditions + this spot's real
    // enrichment; empty array when there's nothing grounded to say.
    spot.tips = spot.paddleScore ? getPreparationTips({
      conditions: spot.paddleScore.conditions,
      craft: req.query.craft,
      spot: { cellCoverage: data.cellCoverage, localTips: data.localTips },
      hydrology: hydrologyNow,
      warningMessages: spot.paddleScore.warnings?.messages || []
    }) : [];

    res.set('Cache-Control', 'public, max-age=60');
    return res.json(spot);

  } catch (err) {
    console.error(`paddlingOut GET /${id} error:`, err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
