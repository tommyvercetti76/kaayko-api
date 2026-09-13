// functions/api/weather/paddlingout.js
//
// GET  /paddlingOut                 — all public paddling spots with pre-warmed paddle scores
// GET  /paddlingOut/:id             — single spot
// GET  /paddlingOut/geocode, /reverse-geocode — cached Nominatim proxies
// POST /paddlingOut/submitEntry     — community submission (multipart, 2–5 photos)
// Admin (platform admin only):
//   GET/POST /paddlingOut/admin/submissions[/:id/validate|reject]
//   GET/PATCH /paddlingOut/admin/spots[/:id], POST/DELETE …/:id/images, POST …/:id/warm-score
//
// Public reads never compute paddle scores inline. They are pre-computed every
// 15 minutes by warmPaddleScoreCache into paddle_score_cache. The ONE exception
// is warmScoreNow(): when an admin publishes or moves a spot, its score is
// computed immediately so the home list never shows "—" for a fresh spot.

const express = require('express');
const { resolveNotifyEmail } = require('../email/notifyAddress');
const router  = express.Router();
const admin   = require('firebase-admin');
const crypto  = require('crypto');
const Busboy  = require('busboy');
const PaddleScoreCache = require('../../cache/paddleScoreCache');
const { isPublicPaddlingSpot } = require('./communitySpotVisibility');
const { requireAdmin, requirePlatformAdmin, optionalAuthForAdmin } = require('../../middleware/authMiddleware');
const { sendRawEmail } = require('../../services/emailNotificationService');
const { stripImageMetadata } = require('./imageSanitize');
const { computePaddleScoreForSpot } = require('./paddleScoreCompute');

const db     = admin.firestore();
const bucket = admin.storage().bucket();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const LAKE_SUBMISSION_LIMIT_PER_DAY = 5;        // per IP hash
const LAKE_SUBMISSION_LIMIT_PER_EMAIL = 3;      // per contact email, when one is given
// Whole-site ceiling: a botnet cycling IPs and emails still cannot fill the
// review queue or the bucket. Overridable without a deploy.
const LAKE_SUBMISSION_LIMIT_GLOBAL_PER_DAY = Number(process.env.LAKE_SUBMISSION_GLOBAL_CAP) > 0
  ? Number(process.env.LAKE_SUBMISSION_GLOBAL_CAP) : 40;
const COMMUNITY_GO_LIVE_DELAY_MS = 48 * 60 * 60 * 1000;
const LAKE_SUBMISSION_DEDUPE_MS = 7 * 24 * 60 * 60 * 1000;
// A single photo is not enough to review a launch (one framed shot can hide a
// private dock or a fenced ramp); two is the floor, five the ceiling.
const SUBMISSION_IMAGE_MIN = 2;
const SUBMISSION_IMAGE_LIMIT = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = SUBMISSION_IMAGE_LIMIT * MAX_IMAGE_BYTES;
const MAX_TOTAL_IMAGE_MB = Math.round(MAX_TOTAL_IMAGE_BYTES / (1024 * 1024));
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// Two public spots closer than this are almost certainly the same launch. The
// submission is still accepted (a second ramp on the same lake is legitimate)
// but the admin card is flagged so the reviewer looks before approving.
const NEAR_DUPLICATE_METRES = 400;
// Display tags an admin can put on a spot. The card renders these as chips;
// anything outside this list is dropped on write so the client never has to
// escape free text from the catalogue.
const SPOT_TAGS = Object.freeze({
  'community':  'Community',
  'new':        'New',
  'verified':   'Verified',
  'staff-pick': 'Staff pick',
  'seasonal':   'Seasonal',
  'river':      'River',
  'boat-ramp':  'Boat ramp'
});
// Honeypot: a field no human sees. Bots that fill every input get a 201 and
// nothing stored, so they don't learn the trap exists.
const HONEYPOT_FIELD = 'website';
const SUBMISSION_FIELDS = new Set([
  HONEYPOT_FIELD,
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

// Multipart parser shared by the public submit form and the admin photo-add
// route. Parses on req.rawBody when Firebase has already buffered the body
// (Cloud Functions), otherwise streams the request (tests, emulator).
function imageUploadMiddleware(options = {}) {
  const allowedFields = options.fields || SUBMISSION_FIELDS;
  const maxFiles = options.maxFiles || SUBMISSION_IMAGE_LIMIT;
  return function parseMultipart(req, res, next) {
    return submitEntryUpload(req, res, next, { allowedFields, maxFiles });
  };
}

function submitEntryUpload(req, res, next, options = {}) {
  const allowedFields = options.allowedFields || SUBMISSION_FIELDS;
  const maxFiles = options.maxFiles || SUBMISSION_IMAGE_LIMIT;
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    req.files = [];
    return next();
  }

  const busboy = Busboy({
    headers: req.headers,
    limits: {
      files: maxFiles,
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
    if (!allowedFields.has(name)) return;
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
        fail(`Total image upload must be ${MAX_TOTAL_IMAGE_MB} MB or smaller`);
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

  busboy.on('filesLimit', () => fail(`Upload ${maxFiles} images or fewer`));
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

// X-Forwarded-For is `<client>, <proxy>, <gfe>` and ANY client can prepend an
// arbitrary first entry, so keying a rate limit on `split(',')[0]` let one caller
// mint unlimited buckets. api/kortex/clientIp.js already resolves the chain
// right-to-left and skips private ranges; use it rather than a second opinion.
const { getClientIp: resolveClientIp } = require('../kortex/clientIp');

function getClientIp(req) {
  // A shared 'unknown' bucket is deliberate here: when no public IP can be
  // established, one restrictive bucket is the safe failure mode for a limiter.
  return resolveClientIp(req) || 'unknown';
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

function validateSubmissionImages(files, { min = SUBMISSION_IMAGE_MIN, max = SUBMISSION_IMAGE_LIMIT } = {}) {
  const count = Array.isArray(files) ? files.length : 0;
  if (count < min) {
    const err = new Error(min === 1
      ? 'At least one lake image is required'
      : `At least ${min} lake photos are required (${count} received)`);
    err.code = 'IMAGE_REQUIRED';
    throw err;
  }
  if (count > max) {
    const err = new Error(`Upload ${max} images or fewer`);
    err.code = 'TOO_MANY_IMAGES';
    throw err;
  }

  const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
    const err = new Error(`Total image upload must be ${MAX_TOTAL_IMAGE_MB} MB or smaller`);
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
    // Public bucket, anonymous submitter: never publish the phone's GPS fix,
    // device model or capture time embedded in the file.
    const cleaned = stripImageMetadata(file.buffer, detectedMime);
    return {
      file: { ...file, buffer: cleaned },
      mime: detectedMime,
      size: cleaned.length,
      ext: imageExtension(detectedMime)
    };
  });
}

async function reserveSubmissionSlot({ ipHash, dedupeKey, emailHash = null }) {
  const today = new Date().toISOString().split('T')[0];
  const rateDocId = `${ipHash}_${today}`;
  const rateRef = db.collection('lake_submission_rate_limits').doc(rateDocId);
  // Second bucket keyed on the (hashed) contact email: a carrier NAT shares
  // one IP across thousands of people, so the IP cap alone is either too
  // tight for them or too loose for one person cycling connections.
  const emailRef = emailHash ? db.collection('lake_submission_rate_limits').doc(`e_${emailHash}_${today}`) : null;
  const dedupeRef = db.collection('paddling_lake_submission_keys').doc(dedupeKey);
  const globalRef = db.collection('lake_submission_rate_limits').doc(`g_${today}`);
  const expiresAt = Timestamp.fromMillis(Date.now() + LAKE_SUBMISSION_DEDUPE_MS);

  await db.runTransaction(async transaction => {
    const [rateSnap, dedupeSnap, emailSnap, globalSnap] = await Promise.all([
      transaction.get(rateRef),
      transaction.get(dedupeRef),
      emailRef ? transaction.get(emailRef) : Promise.resolve(null),
      transaction.get(globalRef)
    ]);

    if (globalSnap.exists && (globalSnap.data().count || 0) >= LAKE_SUBMISSION_LIMIT_GLOBAL_PER_DAY) {
      const err = new Error('We have received a lot of lake submissions today. Please try again tomorrow.');
      err.code = 'RATE_LIMIT';
      throw err;
    }
    if (rateSnap.exists && (rateSnap.data().count || 0) >= LAKE_SUBMISSION_LIMIT_PER_DAY) {
      const err = new Error('Daily lake submission limit reached. Please try again tomorrow.');
      err.code = 'RATE_LIMIT';
      throw err;
    }
    if (emailSnap && emailSnap.exists && (emailSnap.data().count || 0) >= LAKE_SUBMISSION_LIMIT_PER_EMAIL) {
      const err = new Error('You have reached today\'s limit for this email address. Please try again tomorrow.');
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
    if (emailRef) {
      transaction.set(emailRef, {
        count: FieldValue.increment(1),
        date: today,
        emailHash,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    transaction.set(globalRef, {
      count: FieldValue.increment(1),
      date: today,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(dedupeRef, {
      ipHash,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt
    });
  });
}

async function uploadSubmissionImages(images, spotId, options = {}) {
  const source = options.source || 'paddlingout_submitentry';
  const uploaded = [];
  try {
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const random = crypto.randomBytes(6).toString('hex');
      // Filename starts with the spot id so fetchSpotImages' prefix listing
      // picks it up; the timestamp keeps admin-added photos sorting after the
      // originals instead of colliding with `-1-`, `-2-` from the submission.
      const seq = options.sequencePrefix ? `${options.sequencePrefix}${i + 1}` : String(i + 1);
      const path = `images/paddling_out/${spotId}-${seq}-${random}.${image.ext}`;
      const fileRef = bucket.file(path);
      await fileRef.save(image.file.buffer, {
        resumable: false,
        metadata: {
          contentType: image.mime,
          cacheControl: 'public, max-age=31536000, immutable',
          metadata: {
            source,
            communitySubmission: source === 'paddlingout_submitentry' ? 'true' : 'false'
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
    invalidateImageListCache();
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
  invalidateImageListCache();
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
    text: data.text || '',
    description: data.description || '',
    parkingAvl: data.parkingAvl || 'N',
    restroomsAvl: data.restroomsAvl || 'N',
    tags: normalizeTags(data.tags),
    possibleDuplicateOf: data.possibleDuplicateOf || null,
    validationNotes: data.validationNotes || null,
    rejectionReason: data.rejectionReason || null,
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
  // Forecast is the page that actually renders a single spot; the old
  // `/paddlingout/?id=` landed on the directory with a query it ignores.
  const lakeUrl = `https://kaayko.com/paddlingout/forecast?id=${encodeURIComponent(spotId)}`;

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

// Tell a submitter who asked to be notified that their entry was not used —
// the delay notice promised an answer either way. Reason is optional and is
// the admin's own words, so it is escaped for the HTML body.
async function notifySubmissionRejected(submission, reason) {
  if (!submission.contactEmail) return { success: true, status: 'not_requested' };
  const lakeName = escapeForEmail(submission.lakeName || 'your lake');
  const why = reason ? escapeForEmail(reason) : '';
  return sendRawEmail({
    to: submission.contactEmail,
    subject: `Your Kaayko lake entry was not added`,
    html: `
      <p>Hi,</p>
      <p>Thanks for sending <strong>${lakeName}</strong> to Paddling Out. We reviewed it and could not add it this time.</p>
      ${why ? `<p>Reason: ${why}</p>` : ''}
      <p>If you think we got this wrong, reply to this email, or <a href="https://kaayko.com/paddlingout/submitentry">submit it again</a> with a public launch point and photos of the water and the put-in.</p>
      <p>Kaayko</p>
    `,
    text: [
      'Hi,', '',
      `Thanks for sending ${submission.lakeName || 'your lake'} to Paddling Out. We reviewed it and could not add it this time.`,
      reason ? `Reason: ${reason}` : '',
      'If you think we got this wrong, reply to this email, or submit it again with a public launch point and photos of the water and the put-in: https://kaayko.com/paddlingout/submitentry',
      '', 'Kaayko'
    ].filter(l => l !== '').join('\n')
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

function invalidateImageListCache() {
  _imageListCache = { at: 0, files: null };
}

// Files that belong to ONE spot id. Curated photos are `<id><n>.webp`, community
// and admin uploads are `<id>-<seq>-<12 hex>.<ext>` (seq = `1` or `a<ts>-1`).
// Matching the full shape, not just the prefix, stops `whiterock` from claiming
// `whiterock-north-1-….jpg` and lets one spot's delete route touch only its
// own files.
const IMAGE_EXT_RE = '(?:jpe?g|png|webp)';
function fileBelongsToSpot(fileName, spotId) {
  const name = String(fileName || '').toLowerCase();
  const id = String(spotId || '').toLowerCase();
  if (!id || !name.startsWith(id)) return false;
  const rest = name.slice(id.length);
  return new RegExp(`^(?:\\d*\\.${IMAGE_EXT_RE}|-(?:a[0-9a-z]+-)?\\d+-[0-9a-f]{12}\\.${IMAGE_EXT_RE})$`).test(rest);
}

function spotImagePathsFromList(names, spotId) {
  return names.filter(name => fileBelongsToSpot(name.split('/').pop() || '', spotId));
}

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
    // Strict ownership (verified 12 Sep 2026: all 90 bucket files conform), so
    // `jenny` no longer picks up a future `jenny-lake-…` spot's photos.
    return spotImagePathsFromList(names, spotId).map(publicStorageUrl);
  } catch (err) {
    console.error(`fetchSpotImages failed for ${spotId}:`, err.message);
    return [];
  }
}

// Haversine distance in metres between two coordinate pairs.
function distanceMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Nearest existing spot (public or pending) within NEAR_DUPLICATE_METRES, or
// null. One collection read; the catalogue is small enough that a bounding-box
// query is not worth an index.
async function findNearbySpot(lat, lng, excludeId = null) {
  try {
    const snapshot = await db.collection('paddlingSpots').get();
    let best = null;
    snapshot.forEach(docSnap => {
      if (docSnap.id === excludeId) return;
      const data = docSnap.data() || {};
      if (data.archived === true || String(data.submissionStatus || '').toLowerCase() === 'rejected') return;
      const la = Number(data.location?.latitude);
      const ln = Number(data.location?.longitude);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
      const d = distanceMetres(lat, lng, la, ln);
      if (d <= NEAR_DUPLICATE_METRES && (!best || d < best.distanceMetres)) {
        best = {
          id: docSnap.id,
          lakeName: data.title || data.lakeName || docSnap.id,
          distanceMetres: Math.round(d),
          isPublic: isPublicPaddlingSpot(data)
        };
      }
    });
    return best;
  } catch (err) {
    console.warn('findNearbySpot failed:', err.message);
    return null;
  }
}

function normalizeTags(value) {
  const list = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',') : []);
  const out = [];
  list.forEach(raw => {
    const tag = String(raw || '').trim().toLowerCase();
    if (SPOT_TAGS[tag] && !out.includes(tag)) out.push(tag);
  });
  return out.slice(0, 4);
}

async function submitEntryHandler(req, res) {
  try {
    const body = req.body || {};
    if (sanitizeText(body[HONEYPOT_FIELD], 50)) {
      // Bot filled the invisible field. Say yes, store nothing.
      return res.status(201).json({
        success: true,
        id: `community-${crypto.randomBytes(4).toString('hex')}`,
        goLiveAt: null,
        message: 'Entry received. It will appear on the map once our team reviews and approves it.'
      });
    }
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
    // Null Island and the poles are where broken geocoders and empty GPS fixes
    // land; no paddling launch is there.
    if ((Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) || Math.abs(lat) > 85) {
      return res.status(400).json({ success: false, error: 'Those coordinates are not a real launch point. Drop the pin on the water.' });
    }

    const ip = getClientIp(req);
    const ipHash = hashValue(ip);
    const dedupeKey = normalizedSubmissionKey({ lakeName, city, region, country, lat, lng });
    await reserveSubmissionSlot({ ipHash, dedupeKey, emailHash: email ? hashValue(email) : null });
    const nearbySpot = await findNearbySpot(lat, lng);

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
      country,
      tags: [],
      archived: false
    };

    const submissionDoc = {
      spotId,
      ...publicSpotDoc,
      description,
      // Reviewer aids — never rendered publicly
      possibleDuplicateOf: nearbySpot,
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
        to: resolveNotifyEmail(),
        subject: `New lake submission: ${lakeName}`,
        text:
          `A community paddling spot was submitted and is awaiting review.\n\n` +
          `Name: ${lakeName}\nLocation: ${subtitle}\nCoords: ${coords}\n` +
          `From: ${anonymous ? 'anonymous' : email}\n` +
          (nearbySpot ? `Possible duplicate of: ${nearbySpot.lakeName} (${nearbySpot.distanceMetres} m away)\n` : '') +
          `\nReview it in Kortex → Submissions: https://kaayko.com/admin/kortex#/submissions`,
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

// ── Admin moderation + catalogue management ──────────────────────────────
// Every route below publishes or edits PUBLIC content, so it needs a platform
// administrator: `admin` is a self-serve role (anyone can provision it), and
// requireAdmin alone would let a tenant admin approve spam onto the map.
// requireAdmin still runs first because it is what turns X-Admin-Key into
// req.user.authMethod = 'admin-key', which requirePlatformAdmin honours.
const adminGuard = [optionalAuthForAdmin, requireAdmin, requirePlatformAdmin];

const SPOT_ID_RE = /^[a-zA-Z0-9_-]+$/;

// Compute and cache a paddle score for a spot right now. Used when a spot
// becomes public (approve) or moves (coordinate edit) so the home list shows a
// score immediately instead of "—" until the 15-minute warmer next runs.
// Best-effort with a hard timeout: never blocks or fails the admin action.
async function warmScoreNow(spotId, data) {
  const lat = Number(data.location?.latitude);
  const lng = Number(data.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { warmed: false, reason: 'no coordinates' };
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('score compute timed out')), 12000));
    const score = await Promise.race([
      computePaddleScoreForSpot({ id: spotId, lat, lng, name: data.title || data.lakeName || spotId }),
      timeout
    ]);
    if (!score) return { warmed: false, reason: 'weather unavailable' };
    await new PaddleScoreCache().set(spotId, score);
    return { warmed: true, rating: score.rating ?? null };
  } catch (err) {
    console.warn(`warmScoreNow failed for ${spotId}:`, err.message);
    return { warmed: false, reason: err.message };
  }
}

/**
 * GET /paddlingOut/admin/submissions
 *
 * Admin-only view of community lake submissions.
 */
router.get('/admin/submissions', ...adminGuard, async (req, res) => {
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

    return res.json({ success: true, submissions, tags: SPOT_TAGS });
  } catch (err) {
    console.error('paddlingOut GET /admin/submissions error:', err.message, err.stack);
    return res.status(500).json({ success: false, error: 'Failed to load submissions' });
  }
});

/**
 * POST /paddlingOut/admin/submissions/:id/validate
 *
 * Marks a community submission validated → public immediately. Refuses to
 * publish a spot that has no coordinates or no photos (an admin can PATCH /
 * add photos first), and warms its paddle score so the card is complete on the
 * very next page load.
 */
router.post('/admin/submissions/:id/validate', ...adminGuard, async (req, res) => {
  const id = req.params.id;
  if (!id || !SPOT_ID_RE.test(id)) {
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

    const spotData = spotSnap.data() || {};
    const submissionData = submissionSnap.data() || {};
    if (String(submissionData.status || '').toLowerCase() === 'rejected') {
      return res.status(409).json({ success: false, error: 'This submission was rejected and its photos were deleted. Ask for a fresh submission.' });
    }
    const lat = Number(spotData.location?.latitude);
    const lng = Number(spotData.location?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(422).json({ success: false, error: 'Cannot publish: the spot has no coordinates. Edit it and set a location first.' });
    }
    const images = await fetchSpotImages(id);
    if (!images.length) {
      return res.status(422).json({ success: false, error: 'Cannot publish: the spot has no photos. Add at least one photo first.' });
    }
    if (!spotData.title && !spotData.lakeName) {
      return res.status(422).json({ success: false, error: 'Cannot publish: the spot has no name.' });
    }

    const actor = adminActor(req);
    const notes = sanitizeText(req.body?.notes, 500);
    const requestedTags = req.body?.tags !== undefined ? normalizeTags(req.body.tags) : null;
    const existingTags = normalizeTags(spotData.tags);
    // Default display tag for a community spot; the admin can remove it later.
    const tags = requestedTags !== null
      ? requestedTags
      : (existingTags.length ? existingTags : ['community']);
    const validationUpdate = {
      submissionStatus: 'validated',
      archived: false,
      tags,
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
      ...submissionData,
      ...submissionUpdate,
      spotId: id
    };

    // Score + email in parallel: neither depends on the other and both are
    // best-effort from the admin's point of view.
    const [paddleScore, notification] = await Promise.all([
      warmScoreNow(id, spotData),
      (async () => {
        if (!submission.contactEmail) return { success: true, status: 'not_requested' };
        let result;
        try {
          const emailResult = await notifySubmissionValidated(submission, id);
          result = {
            success: emailResult.success !== false,
            status: 'sent',
            provider: emailResult.provider || null,
            messageId: emailResult.messageId || null
          };
        } catch (emailErr) {
          console.warn('paddlingOut validation email failed:', emailErr.message);
          result = { success: false, status: 'failed', error: emailErr.message };
        }
        await submissionRef.set({
          notificationStatus: result.status,
          notificationResult: result,
          notificationUpdatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return result;
      })()
    ]);

    return res.json({
      success: true,
      id,
      status: 'validated',
      tags,
      paddleScore,
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
router.post('/admin/submissions/:id/reject', ...adminGuard, async (req, res) => {
  const id = req.params.id;
  if (!id || !SPOT_ID_RE.test(id)) {
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
    // The SPA sends `rejectionReason`; older tooling sent `reason`. Accept both
    // — the note used to be silently dropped.
    const reason = sanitizeText(req.body?.rejectionReason ?? req.body?.reason, 500);
    const deleteImages = req.body?.deleteImages !== false;
    // Delete every file with this spot's prefix (admin-added photos included),
    // not only the ones recorded at submission time.
    let imagePaths = Array.isArray(submission.imagePaths) ? submission.imagePaths.slice() : [];
    if (deleteImages) {
      try {
        const listed = spotImagePathsFromList(await listAllSpotImages(), id);
        listed.forEach(pth => { if (!imagePaths.includes(pth)) imagePaths.push(pth); });
      } catch (_) { /* fall back to the recorded paths */ }
    }
    const deletionResult = deleteImages ? await deleteSubmissionImages(imagePaths) : [];

    const spotUpdate = {
      submissionStatus: 'rejected',
      archived: true,
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
      notificationStatus: submission.contactEmail ? 'rejection_pending' : (submission.notificationStatus || 'not_requested')
    };

    await Promise.all([
      spotRef.set(spotUpdate, { merge: true }),
      submissionRef.set(submissionUpdate, { merge: true }),
      // A rejected spot must not keep a cached score around.
      db.collection('paddle_score_cache').doc(id).delete().catch(() => {})
    ]);

    let notification = { success: true, status: 'not_requested' };
    if (submission.contactEmail) {
      try {
        const r = await notifySubmissionRejected(submission, reason);
        notification = { success: r.success !== false, status: 'rejection_sent', provider: r.provider || null, messageId: r.messageId || null };
      } catch (emailErr) {
        console.warn('paddlingOut rejection email failed:', emailErr.message);
        notification = { success: false, status: 'rejection_failed', error: emailErr.message };
      }
      await submissionRef.set({ notificationStatus: notification.status, notificationResult: notification, notificationUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    return res.json({
      success: true,
      id,
      status: 'rejected',
      imagesDeleted: deletionResult.filter(item => item.deleted).length,
      notification
    });
  } catch (err) {
    console.error(`paddlingOut POST /admin/submissions/${id}/reject error:`, err.message, err.stack);
    return res.status(500).json({ success: false, error: 'Failed to reject submission' });
  }
});

// ── Admin spot catalogue (curated + community) ───────────────────────────

function adminSpotPayload(docSnap, images, cachedScore) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    lakeName: data.lakeName || '',
    title: data.title || data.lakeName || '',
    subtitle: data.subtitle || '',
    text: data.text || '',
    launchHint: data.launchHint || '',
    city: data.city || '',
    region: data.region || '',
    country: data.country || '',
    location: data.location || {},
    parkingAvl: data.parkingAvl || 'N',
    restroomsAvl: data.restroomsAvl || 'N',
    youtubeURL: data.youtubeURL || '',
    waterType: data.waterType || null,
    tags: normalizeTags(data.tags),
    archived: data.archived === true,
    communitySubmission: data.communitySubmission === true,
    submissionStatus: data.submissionStatus || null,
    isPublic: isPublicPaddlingSpot(data),
    images: images.map(path => ({ path, url: publicStorageUrl(path) })),
    hasCachedScore: !!cachedScore,
    rating: cachedScore?.rating ?? null,
    updatedAt: data.updatedAt || null,
    updatedBy: data.updatedBy || null,
    validatedAt: data.validatedAt || null
  };
}

/**
 * GET /paddlingOut/admin/spots
 *
 * Every spot in the catalogue — curated, community, archived, pending — with
 * the public-visibility verdict, photos and whether a score is cached. This
 * is the only listing that bypasses isPublicPaddlingSpot.
 */
router.get('/admin/spots', ...adminGuard, async (req, res) => {
  try {
    const [snapshot, names, scores] = await Promise.all([
      db.collection('paddlingSpots').get(),
      listAllSpotImages().catch(() => []),
      new PaddleScoreCache().getAll()
    ]);
    const spots = snapshot.docs.map(docSnap =>
      adminSpotPayload(docSnap, spotImagePathsFromList(names, docSnap.id), scores.get(docSnap.id) || null)
    );
    spots.sort((a, b) => a.title.localeCompare(b.title));
    return res.json({ success: true, spots, tags: SPOT_TAGS });
  } catch (err) {
    console.error('paddlingOut GET /admin/spots error:', err.message, err.stack);
    return res.status(500).json({ success: false, error: 'Failed to load spots' });
  }
});

/**
 * GET /paddlingOut/admin/spots/:id — one spot, same shape, regardless of visibility.
 */
router.get('/admin/spots/:id', ...adminGuard, async (req, res) => {
  const id = req.params.id;
  if (!id || !SPOT_ID_RE.test(id)) return res.status(400).json({ success: false, error: 'Invalid spot ID' });
  try {
    const [docSnap, images, cached] = await Promise.all([
      db.collection('paddlingSpots').doc(id).get(),
      fetchSpotImagePaths(id),
      new PaddleScoreCache().get(id)
    ]);
    if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Spot not found' });
    return res.json({ success: true, spot: adminSpotPayload(docSnap, images, cached), tags: SPOT_TAGS });
  } catch (err) {
    console.error(`paddlingOut GET /admin/spots/${id} error:`, err.message);
    return res.status(500).json({ success: false, error: 'Failed to load spot' });
  }
});

async function fetchSpotImagePaths(spotId) {
  try {
    return spotImagePathsFromList(await listAllSpotImages(), spotId);
  } catch (err) {
    console.error(`fetchSpotImagePaths failed for ${spotId}:`, err.message);
    return [];
  }
}

// Which fields an admin may change, and how each is cleaned. Anything not
// listed (submissionStatus, communitySubmission, validatedBy, source, …) is
// ignored on write so the moderation trail cannot be rewritten through PATCH.
const SPOT_EDITABLE = {
  lakeName:     v => sanitizeText(v, 120),
  title:        v => sanitizeText(v, 120),
  subtitle:     v => sanitizeText(v, 160),
  text:         v => sanitizeText(v, 800),
  launchHint:   v => sanitizeText(v, 160),
  city:         v => sanitizeText(v, 80),
  region:       v => sanitizeText(v, 80),
  country:      v => sanitizeText(v, 80),
  youtubeURL:   v => {
    const url = sanitizeText(v, 300);
    if (!url) return '';
    return /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url) ? url : null;
  },
  parkingAvl:   v => sanitizeYesNo(v),
  restroomsAvl: v => sanitizeYesNo(v),
  waterType:    v => {
    const t = sanitizeText(v, 20).toLowerCase();
    if (!t) return null;
    return ['lake', 'reservoir', 'river', 'coastal', 'bay', 'canal'].includes(t) ? t : undefined;
  },
  tags:         v => normalizeTags(v),
  archived:     v => parseBoolean(v)
};

/**
 * PATCH /paddlingOut/admin/spots/:id
 *
 * Edit any spot's data (name, copy, location, amenities, tags, published
 * flag). Location edits invalidate and re-warm the cached score. Edits to a
 * community spot are mirrored into its review record so the Submissions tab
 * shows the corrected values.
 */
router.patch('/admin/spots/:id', ...adminGuard, async (req, res) => {
  const id = req.params.id;
  if (!id || !SPOT_ID_RE.test(id)) return res.status(400).json({ success: false, error: 'Invalid spot ID' });
  const body = req.body || {};

  try {
    const spotRef = db.collection('paddlingSpots').doc(id);
    const spotSnap = await spotRef.get();
    if (!spotSnap.exists) return res.status(404).json({ success: false, error: 'Spot not found' });
    const current = spotSnap.data() || {};

    const update = {};
    const changed = [];
    for (const [field, clean] of Object.entries(SPOT_EDITABLE)) {
      if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
      const value = clean(body[field]);
      if (value === undefined || (value === null && field === 'youtubeURL')) {
        return res.status(400).json({ success: false, error: `Invalid value for ${field}` });
      }
      update[field] = value;
      changed.push(field);
    }

    // Name: keep title and lakeName in step when only one was sent, so the card
    // (title first) and the search index (lakeName) never disagree.
    if (update.lakeName !== undefined && update.title === undefined) update.title = update.lakeName;
    if (update.title !== undefined && update.lakeName === undefined) update.lakeName = update.title;
    if ((update.title !== undefined && !update.title) || (update.lakeName !== undefined && !update.lakeName)) {
      return res.status(400).json({ success: false, error: 'Name cannot be empty' });
    }

    // Location
    let locationChanged = false;
    if (body.lat !== undefined || body.lng !== undefined || body.location) {
      const lat = parseCoordinate(body.lat ?? body.location?.latitude);
      const lng = parseCoordinate(body.lng ?? body.location?.longitude);
      if (lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng) ||
          lat < -85 || lat > 85 || lng < -180 || lng > 180 ||
          (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01)) {
        return res.status(400).json({ success: false, error: 'Invalid coordinates' });
      }
      const prev = current.location || {};
      if (Number(prev.latitude) !== lat || Number(prev.longitude) !== lng) {
        update.location = { latitude: lat, longitude: lng };
        locationChanged = true;
        changed.push('location');
      }
    }

    // Subtitle follows city/region/country unless the admin set it explicitly.
    if (update.subtitle === undefined && (update.city !== undefined || update.region !== undefined || update.country !== undefined)) {
      const pieces = [
        update.city ?? current.city,
        update.region ?? current.region,
        update.country ?? current.country
      ].filter(Boolean);
      if (pieces.length) update.subtitle = pieces.join(', ');
    }

    if (!changed.length) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }

    // Publishing a community spot through the archived toggle must go through
    // validate (it has the photo/coordinate guardrails). Un-archiving a
    // community spot that was never validated stays hidden anyway, so tell the
    // admin instead of silently doing nothing.
    if (update.archived === false && current.communitySubmission === true &&
        String(current.submissionStatus || '').toLowerCase() !== 'validated') {
      return res.status(409).json({ success: false, error: 'This community spot has not been approved. Approve it from Submissions instead.' });
    }

    update.updatedAt = FieldValue.serverTimestamp();
    update.updatedBy = adminActor(req);

    const writes = [spotRef.set(update, { merge: true })];
    const submissionRef = db.collection('paddling_lake_submissions').doc(id);
    if (current.communitySubmission === true) {
      const mirror = {};
      ['lakeName', 'title', 'subtitle', 'text', 'launchHint', 'city', 'region', 'country', 'location', 'parkingAvl', 'restroomsAvl', 'tags']
        .forEach(f => { if (update[f] !== undefined) mirror[f] = update[f]; });
      if (Object.keys(mirror).length) {
        mirror.updatedAt = FieldValue.serverTimestamp();
        mirror.editedBy = update.updatedBy;
        writes.push(submissionRef.set(mirror, { merge: true }));
      }
    }
    if (locationChanged || update.archived === true) {
      writes.push(db.collection('paddle_score_cache').doc(id).delete().catch(() => {}));
    }
    await Promise.all(writes);

    // Audit trail — who changed what. Append-only; never rendered publicly.
    db.collection('paddling_spot_audit').add({
      spotId: id,
      actor: update.updatedBy,
      fields: changed,
      before: Object.fromEntries(changed.map(f => [f, current[f] ?? null])),
      after: Object.fromEntries(changed.map(f => [f, update[f] ?? null])),
      at: FieldValue.serverTimestamp()
    }).catch(err => console.warn('paddling_spot_audit write failed:', err.message));

    const merged = { ...current, ...update };
    const paddleScore = locationChanged && isPublicPaddlingSpot(merged)
      ? await warmScoreNow(id, merged)
      : null;

    const [images, cached] = await Promise.all([fetchSpotImagePaths(id), new PaddleScoreCache().get(id)]);
    const fresh = await spotRef.get();
    return res.json({
      success: true,
      spot: adminSpotPayload(fresh, images, cached),
      changed,
      paddleScore
    });
  } catch (err) {
    console.error(`paddlingOut PATCH /admin/spots/${id} error:`, err.message, err.stack);
    return res.status(500).json({ success: false, error: 'Failed to update spot' });
  }
});

/**
 * POST /paddlingOut/admin/spots/:id/images  (multipart, field `images`)
 *
 * Add 1–5 photos to any spot. Same signature and metadata-strip pipeline as
 * community uploads. Total per spot is capped so a card never carries a
 * runaway carousel.
 */
const MAX_IMAGES_PER_SPOT = 8;

router.post('/admin/spots/:id/images', ...adminGuard, imageUploadMiddleware({ fields: new Set(['note']) }), async (req, res) => {
  const id = req.params.id;
  if (!id || !SPOT_ID_RE.test(id)) return res.status(400).json({ success: false, error: 'Invalid spot ID' });
  try {
    const spotRef = db.collection('paddlingSpots').doc(id);
    const spotSnap = await spotRef.get();
    if (!spotSnap.exists) return res.status(404).json({ success: false, error: 'Spot not found' });

    const images = validateSubmissionImages(req.files || [], { min: 1, max: SUBMISSION_IMAGE_LIMIT });
    const existing = await fetchSpotImagePaths(id);
    if (existing.length + images.length > MAX_IMAGES_PER_SPOT) {
      return res.status(400).json({ success: false, error: `A spot can have at most ${MAX_IMAGES_PER_SPOT} photos (${existing.length} already).` });
    }

    const uploaded = await uploadSubmissionImages(images, id, {
      source: 'admin_spot_photos',
      sequencePrefix: `a${Date.now().toString(36)}-`
    });
    const all = await fetchSpotImagePaths(id);
    await spotRef.set({
      imgSrc: all.map(publicStorageUrl),
      imageCount: all.length,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: adminActor(req)
    }, { merge: true });
    if (spotSnap.data()?.communitySubmission === true) {
      await db.collection('paddling_lake_submissions').doc(id).set({
        imgSrc: all.map(publicStorageUrl),
        imageCount: all.length,
        imagePaths: all,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return res.status(201).json({
      success: true,
      added: uploaded.map(u => ({ path: u.path, url: u.url })),
      images: all.map(path => ({ path, url: publicStorageUrl(path) }))
    });
  } catch (err) {
    if (['IMAGE_REQUIRED', 'TOO_MANY_IMAGES', 'IMAGES_TOO_LARGE', 'INVALID_IMAGE_SIGNATURE'].includes(err.code)) {
      return res.status(400).json({ success: false, error: err.message });
    }
    console.error(`paddlingOut POST /admin/spots/${id}/images error:`, err.message, err.stack);
    return res.status(500).json({ success: false, error: 'Failed to add photos' });
  }
});

/**
 * DELETE /paddlingOut/admin/spots/:id/images?path=images/paddling_out/<file>
 *
 * Remove one photo. The path must sit under the spot prefix AND belong to this
 * spot id, so one spot's route can never delete another spot's file. A public
 * spot keeps at least one photo.
 */
router.delete('/admin/spots/:id/images', ...adminGuard, async (req, res) => {
  const id = req.params.id;
  if (!id || !SPOT_ID_RE.test(id)) return res.status(400).json({ success: false, error: 'Invalid spot ID' });
  const path = String(req.query.path || req.body?.path || '');
  const fileName = path.split('/').pop() || '';
  if (!path.startsWith('images/paddling_out/') || path.includes('..') || path.split('/').length !== 3 ||
      !fileBelongsToSpot(fileName, id)) {
    return res.status(400).json({ success: false, error: 'That photo does not belong to this spot' });
  }
  try {
    const spotRef = db.collection('paddlingSpots').doc(id);
    const spotSnap = await spotRef.get();
    if (!spotSnap.exists) return res.status(404).json({ success: false, error: 'Spot not found' });
    const data = spotSnap.data() || {};
    const existing = await fetchSpotImagePaths(id);
    if (!existing.includes(path)) return res.status(404).json({ success: false, error: 'Photo not found' });
    if (isPublicPaddlingSpot(data) && existing.length <= 1) {
      return res.status(409).json({ success: false, error: 'A published spot needs at least one photo. Add another before removing this one.' });
    }
    const [result] = await deleteSubmissionImages([path]);
    if (!result.deleted) return res.status(500).json({ success: false, error: 'Failed to delete photo' });
    const all = existing.filter(p => p !== path);
    await spotRef.set({
      imgSrc: all.map(publicStorageUrl),
      imageCount: all.length,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: adminActor(req)
    }, { merge: true });
    if (data.communitySubmission === true) {
      await db.collection('paddling_lake_submissions').doc(id).set({
        imgSrc: all.map(publicStorageUrl),
        imageCount: all.length,
        imagePaths: all,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    return res.json({ success: true, images: all.map(p => ({ path: p, url: publicStorageUrl(p) })) });
  } catch (err) {
    console.error(`paddlingOut DELETE /admin/spots/${id}/images error:`, err.message, err.stack);
    return res.status(500).json({ success: false, error: 'Failed to delete photo' });
  }
});

/**
 * POST /paddlingOut/admin/spots/:id/warm-score — recompute the cached score now.
 */
router.post('/admin/spots/:id/warm-score', ...adminGuard, async (req, res) => {
  const id = req.params.id;
  if (!id || !SPOT_ID_RE.test(id)) return res.status(400).json({ success: false, error: 'Invalid spot ID' });
  try {
    const spotSnap = await db.collection('paddlingSpots').doc(id).get();
    if (!spotSnap.exists) return res.status(404).json({ success: false, error: 'Spot not found' });
    const result = await warmScoreNow(id, spotSnap.data() || {});
    return res.json({ success: true, paddleScore: result });
  } catch (err) {
    console.error(`paddlingOut POST /admin/spots/${id}/warm-score error:`, err.message);
    return res.status(500).json({ success: false, error: 'Failed to warm score' });
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

  const ip = getClientIp(req);   // resolved chain, not the client-controlled first hop
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

// ── Reverse geocode proxy (cached) ────────────────────────────────────────
// "Use my location" on the submit form hands back a coordinate; this turns it
// into city / region / country so the submitter does not retype what the pin
// already knows. Same shared identity, throttle and per-IP limiter as /geocode.
// Coordinates are rounded to ~100 m for the cache key; nothing about the caller
// is stored.
const REVERSE_CACHE = new Map(); // "lat,lng" -> { at, data }

function pickPlace(address = {}) {
  return address.city || address.town || address.village || address.hamlet ||
    address.municipality || address.county || address.suburb || '';
}

router.get('/reverse-geocode', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ success: false, error: 'lat and lng are required' });
  }
  const ip = getClientIp(req);
  if (geocodeRateLimited(ip)) {
    return res.status(429).json({ success: false, error: 'Too many lookups. Try again in a minute.' });
  }

  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = REVERSE_CACHE.get(key);
  if (hit && (Date.now() - hit.at) < GEOCODE_TTL_MS) {
    res.set('Cache-Control', 'public, max-age=86400');
    return res.json(hit.data);
  }

  const since = Date.now() - _lastNominatimAt;
  if (since < 1100) await new Promise(r => setTimeout(r, 1100 - since));
  _lastNominatimAt = Date.now();

  try {
    const url = 'https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&zoom=14' +
      '&lat=' + encodeURIComponent(lat.toFixed(5)) + '&lon=' + encodeURIComponent(lng.toFixed(5));
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Kaayko/1.0 (+https://kaayko.com; rohan@kaayko.com)',
        'Accept-Language': 'en'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return res.status(502).json({ success: false, error: 'Lookup unavailable' });
    const raw = await r.json();
    const address = raw?.address || {};
    const data = {
      success: true,
      city: sanitizeText(pickPlace(address), 80),
      region: sanitizeText(address.state || address.region || address.province || address.state_district || '', 80),
      country: sanitizeText(address.country || '', 80),
      countryCode: sanitizeText(address.country_code || '', 2).toUpperCase(),
      // A hint for the name field ONLY when the pin is on named water. Never
      // fall back to raw.name — at zoom 14 that is the suburb ("Dallas").
      water: sanitizeText(address.water || address.river || address.reservoir || address.lake || '', 120),
      displayName: sanitizeText(raw?.display_name || '', 240)
    };
    REVERSE_CACHE.set(key, { at: Date.now(), data });
    if (REVERSE_CACHE.size > GEOCODE_MAX_ENTRIES) {
      REVERSE_CACHE.delete(REVERSE_CACHE.keys().next().value);
    }
    res.set('Cache-Control', 'public, max-age=86400');
    return res.json(data);
  } catch (err) {
    console.error('paddlingOut /reverse-geocode error:', err.message);
    return res.status(504).json({ success: false, error: 'Lookup timed out' });
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
          tags:         normalizeTags(data.tags),
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
      tags:         normalizeTags(data.tags),
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
// Test seams (not part of the HTTP surface).
module.exports._test = { invalidateImageListCache, fileBelongsToSpot, normalizeTags, distanceMetres, SPOT_TAGS };
