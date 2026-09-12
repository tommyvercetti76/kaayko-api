require('./helpers/mockSetup');
const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');

// The score pipeline talks to WeatherAPI; stub it so approve/patch can warm a
// score deterministically.
jest.mock('../api/weather/paddleScoreCompute', () => ({
  computePaddleScoreForSpot: jest.fn(async (loc) => ({ rating: 4.0, spotId: loc.id, conditions: {} }))
}));
jest.mock('../services/emailNotificationService', () => ({
  sendRawEmail: jest.fn(async () => ({ success: true, provider: 'mock', messageId: 'm1' }))
}));

const { computePaddleScoreForSpot } = require('../api/weather/paddleScoreCompute');

const pngBuffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d
]);

function validFields(req) {
  return req
    .field('lakeName', 'White Rock Lake')
    .field('city', 'Dallas')
    .field('region', 'Texas')
    .field('country', 'United States')
    .field('lat', '32.8367')
    .field('lng', '-96.7167')
    .field('parkingAvl', 'Y')
    .field('restroomsAvl', 'N')
    .field('contactPreference', 'anonymous')
    .field('anonymous', 'true');
}

function withImages(req, n) {
  for (let i = 0; i < n; i++) {
    req = req.attach('images', pngBuffer, { filename: `lake${i}.png`, contentType: 'image/png' });
  }
  return req;
}

function app() {
  return buildTestApp('/paddlingOut', require('../api/weather/paddlingout'));
}

function useStorageListing() {
  // Make the bucket listing reflect whatever save() wrote (plus any seeds).
  admin._mocks.bucket.getFiles.mockImplementation(async () =>
    [Object.keys(admin._mocks.storageFiles()).map(name => ({ name }))]);
  require('../api/weather/paddlingout')._test.invalidateImageListCache();
}

describe('Paddling Out lake submissions', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSPHRASE = 'test-admin';
    useStorageListing();
  });

  test('requires at least two photos', async () => {
    const res = await withImages(validFields(request(app()).post('/paddlingOut/submitEntry')), 1);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 2 lake photos/i);
  });

  test('rejects more than five photos', async () => {
    const res = await withImages(validFields(request(app()).post('/paddlingOut/submitEntry')), 6);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/5 images or fewer/i);
  });

  test('rejects spoofed image content', async () => {
    const res = await validFields(request(app()).post('/paddlingOut/submitEntry'))
      .attach('images', Buffer.from('not an image'), { filename: 'lake.jpg', contentType: 'image/jpeg' })
      .attach('images', pngBuffer, { filename: 'lake.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid JPEG, PNG, or WebP/i);
  });

  test('rejects Null Island coordinates', async () => {
    const res = await withImages(request(app()).post('/paddlingOut/submitEntry')
      .field('lakeName', 'Nowhere').field('city', 'Xtown').field('region', 'Ystate').field('country', 'Zland')
      .field('lat', '0').field('lng', '0').field('anonymous', 'true'), 2);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a real launch/i);
  });

  test('honeypot: pretends to accept, stores nothing', async () => {
    const res = await withImages(validFields(request(app()).post('/paddlingOut/submitEntry'))
      .field('website', 'http://spam.example'), 2);
    expect(res.status).toBe(201);
    expect(Object.keys(admin._mocks.docData).filter(k => k.startsWith('paddlingSpots/'))).toHaveLength(0);
  });

  test('accepts 2–5 photos, strips nothing it should not, never stores raw IP', async () => {
    const res = await withImages(validFields(request(app()).post('/paddlingOut/submitEntry')), 5);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const publicDoc = admin._mocks.docData[`paddlingSpots/${res.body.id}`];
    const submissionDoc = admin._mocks.docData[`paddling_lake_submissions/${res.body.id}`];

    expect(publicDoc.communitySubmission).toBe(true);
    expect(publicDoc.submissionStatus).toBe('pending');
    expect(publicDoc.archived).toBe(false);
    expect(publicDoc.tags).toEqual([]);
    expect(publicDoc.imgSrc).toHaveLength(5);
    expect(publicDoc.imageCount).toBe(5);
    expect(submissionDoc.ip).toBeUndefined();
    expect(submissionDoc.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(submissionDoc.imagePaths).toHaveLength(5);
    expect(submissionDoc.possibleDuplicateOf).toBeNull();
  });

  test('flags a near-duplicate of an existing spot for the reviewer', async () => {
    admin._mocks.docData['paddlingSpots/whiterock'] = {
      title: 'White Rock Lake', lakeName: 'White Rock Lake',
      location: { latitude: 32.8370, longitude: -96.7170 }
    };
    const res = await withImages(validFields(request(app()).post('/paddlingOut/submitEntry')), 2);
    expect(res.status).toBe(201);
    const submissionDoc = admin._mocks.docData[`paddling_lake_submissions/${res.body.id}`];
    expect(submissionDoc.possibleDuplicateOf).toMatchObject({ id: 'whiterock', lakeName: 'White Rock Lake' });
    expect(submissionDoc.possibleDuplicateOf.distanceMetres).toBeLessThan(400);
  });
});

describe('Admin moderation', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSPHRASE = 'test-admin';
    useStorageListing();
    computePaddleScoreForSpot.mockClear();
  });

  function seedPending(id = 'community-bad-lake', extra = {}) {
    admin._mocks.docData[`paddlingSpots/${id}`] = {
      lakeName: 'Bad Lake', title: 'Bad Lake',
      communitySubmission: true,
      submissionStatus: 'pending',
      location: { latitude: 32.8, longitude: -96.7 },
      imgSrc: ['https://example.com/bad.jpg'],
      imageCount: 1,
      ...extra
    };
    admin._mocks.docData[`paddling_lake_submissions/${id}`] = {
      spotId: id,
      lakeName: 'Bad Lake',
      status: 'pending',
      submissionStatus: 'pending',
      contactEmail: 'someone@example.com',
      imagePaths: [`images/paddling_out/${id}-1-abcdabcdabcd.jpg`]
    };
    admin._mocks.storageFiles()[`images/paddling_out/${id}-1-abcdabcdabcd.jpg`] = 'x';
    require('../api/weather/paddlingout')._test.invalidateImageListCache();
  }

  test('a self-serve tenant admin cannot moderate (platform admin required)', async () => {
    seedPending();
    admin._mocks.docData['admin_users/admin-uid'] = { role: 'admin', scope: 'tenant', email: 'attacker@gmail.com' };
    const res = await request(app())
      .post('/paddlingOut/admin/submissions/community-bad-lake/validate')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  test('super-admin approves: published, default community tag, score warmed now', async () => {
    seedPending();
    admin._mocks.docData['admin_users/admin-uid'] = { role: 'super-admin', email: 'owner@kaayko.com' };
    const res = await request(app())
      .post('/paddlingOut/admin/submissions/community-bad-lake/validate')
      .set('Authorization', 'Bearer VALID_ADMIN_TOKEN')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('validated');
    expect(res.body.tags).toEqual(['community']);
    expect(res.body.paddleScore).toMatchObject({ warmed: true, rating: 4.0 });
    expect(computePaddleScoreForSpot).toHaveBeenCalledTimes(1);
    expect(admin._mocks.docData['paddle_score_cache/community-bad-lake'].scoreData.rating).toBe(4.0);
    expect(admin._mocks.docData['paddlingSpots/community-bad-lake'].submissionStatus).toBe('validated');
    expect(admin._mocks.docData['paddling_lake_submissions/community-bad-lake'].notificationStatus).toBe('sent');
  });

  test('refuses to publish a spot with no photos', async () => {
    seedPending('community-nophoto');
    delete admin._mocks.storageFiles()['images/paddling_out/community-nophoto-1-abcdabcdabcd.jpg'];
    require('../api/weather/paddlingout')._test.invalidateImageListCache();
    const res = await request(app())
      .post('/paddlingOut/admin/submissions/community-nophoto/validate')
      .set('X-Admin-Key', 'test-admin').send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no photos/i);
    expect(admin._mocks.docData['paddlingSpots/community-nophoto'].submissionStatus).toBe('pending');
  });

  test('refuses to publish a spot with no coordinates', async () => {
    seedPending('community-nocoord', { location: {} });
    const res = await request(app())
      .post('/paddlingOut/admin/submissions/community-nocoord/validate')
      .set('X-Admin-Key', 'test-admin').send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no coordinates/i);
  });

  test('rejection stores the SPA reason key, hides the spot, deletes every prefixed photo', async () => {
    seedPending();
    admin._mocks.storageFiles()['images/paddling_out/community-bad-lake-a1x2-1-0123456789ab.jpg'] = 'x';
    require('../api/weather/paddlingout')._test.invalidateImageListCache();
    const res = await request(app())
      .post('/paddlingOut/admin/submissions/community-bad-lake/reject')
      .set('X-Admin-Key', 'test-admin')
      .send({ rejectionReason: 'unsafe image' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
    expect(res.body.imagesDeleted).toBe(2);
    const spot = admin._mocks.docData['paddlingSpots/community-bad-lake'];
    expect(spot.submissionStatus).toBe('rejected');
    expect(spot.archived).toBe(true);
    expect(spot.imgSrc).toEqual([]);
    const sub = admin._mocks.docData['paddling_lake_submissions/community-bad-lake'];
    expect(sub.status).toBe('rejected');
    expect(sub.rejectionReason).toBe('unsafe image');
  });

  test('a rejected submission cannot be approved afterwards', async () => {
    seedPending();
    admin._mocks.docData['paddling_lake_submissions/community-bad-lake'].status = 'rejected';
    const res = await request(app())
      .post('/paddlingOut/admin/submissions/community-bad-lake/validate')
      .set('X-Admin-Key', 'test-admin').send({});
    expect(res.status).toBe(409);
  });
});

describe('Admin spot catalogue', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSPHRASE = 'test-admin';
    useStorageListing();
    computePaddleScoreForSpot.mockClear();
    admin._mocks.docData['paddlingSpots/whiterock'] = {
      lakeName: 'White Rock Lake', title: 'White Rock Lake', subtitle: 'Dallas, Texas',
      city: 'Dallas', region: 'Texas', country: 'United States',
      location: { latitude: 32.8367, longitude: -96.7167 },
      parkingAvl: 'Y', restroomsAvl: 'Y', communitySubmission: false
    };
    admin._mocks.storageFiles()['images/paddling_out/whiterock1.webp'] = 'x';
    admin._mocks.storageFiles()['images/paddling_out/whiterock2.webp'] = 'x';
    // A different spot whose id shares the prefix — must never leak across.
    admin._mocks.storageFiles()['images/paddling_out/whiterock-north-1-ab.jpg'] = 'x';
    require('../api/weather/paddlingout')._test.invalidateImageListCache();
  });

  test('lists every spot with visibility, photos and tags', async () => {
    admin._mocks.docData['paddlingSpots/community-hidden'] = {
      title: 'Hidden', communitySubmission: true, submissionStatus: 'pending', location: { latitude: 1, longitude: 1 }
    };
    const res = await request(app()).get('/paddlingOut/admin/spots').set('X-Admin-Key', 'test-admin');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.spots.map(s => [s.id, s]));
    expect(byId.whiterock.isPublic).toBe(true);
    expect(byId.whiterock.images.map(i => i.path)).toEqual([
      'images/paddling_out/whiterock1.webp', 'images/paddling_out/whiterock2.webp'
    ]);
    expect(byId['community-hidden'].isPublic).toBe(false);
    expect(res.body.tags).toHaveProperty('community');
  });

  test('PATCH edits fields, keeps title/lakeName in step, drops unknown tags, ignores moderation fields', async () => {
    const res = await request(app())
      .patch('/paddlingOut/admin/spots/whiterock')
      .set('X-Admin-Key', 'test-admin')
      .send({ lakeName: 'White Rock Lake (Dallas)', tags: ['staff-pick', 'bogus', 'new'], submissionStatus: 'validated', city: 'Dallas' });
    expect(res.status).toBe(200);
    const doc = admin._mocks.docData['paddlingSpots/whiterock'];
    expect(doc.title).toBe('White Rock Lake (Dallas)');
    expect(doc.lakeName).toBe('White Rock Lake (Dallas)');
    expect(doc.tags).toEqual(['staff-pick', 'new']);
    expect(doc.submissionStatus).toBeUndefined();
    expect(doc.updatedBy).toBe('admin@kaayko.com');
    expect(res.body.spot.tags).toEqual(['staff-pick', 'new']);
  });

  test('PATCH location invalidates and re-warms the score', async () => {
    admin._mocks.docData['paddle_score_cache/whiterock'] = { scoreData: { rating: 1 }, expiresAt: new Date(Date.now() + 60000) };
    const res = await request(app())
      .patch('/paddlingOut/admin/spots/whiterock')
      .set('X-Admin-Key', 'test-admin')
      .send({ lat: 32.84, lng: -96.72 });
    expect(res.status).toBe(200);
    expect(res.body.paddleScore).toMatchObject({ warmed: true });
    expect(computePaddleScoreForSpot).toHaveBeenCalledTimes(1);
    expect(admin._mocks.docData['paddlingSpots/whiterock'].location).toEqual({ latitude: 32.84, longitude: -96.72 });
  });

  test('PATCH rejects a bad YouTube URL and an empty name', async () => {
    let res = await request(app()).patch('/paddlingOut/admin/spots/whiterock')
      .set('X-Admin-Key', 'test-admin').send({ youtubeURL: 'https://evil.example/x' });
    expect(res.status).toBe(400);
    res = await request(app()).patch('/paddlingOut/admin/spots/whiterock')
      .set('X-Admin-Key', 'test-admin').send({ title: '' });
    expect(res.status).toBe(400);
  });

  test('archived:true unpublishes a curated spot', async () => {
    const res = await request(app()).patch('/paddlingOut/admin/spots/whiterock')
      .set('X-Admin-Key', 'test-admin').send({ archived: true });
    expect(res.status).toBe(200);
    expect(res.body.spot.isPublic).toBe(false);
  });

  test('un-archiving a never-approved community spot is refused', async () => {
    admin._mocks.docData['paddlingSpots/community-x'] = { title: 'X', communitySubmission: true, submissionStatus: 'pending', archived: true };
    const res = await request(app()).patch('/paddlingOut/admin/spots/community-x')
      .set('X-Admin-Key', 'test-admin').send({ archived: false });
    expect(res.status).toBe(409);
  });

  test('adds photos to an existing spot and refreshes imgSrc', async () => {
    let req = request(app()).post('/paddlingOut/admin/spots/whiterock/images').set('X-Admin-Key', 'test-admin');
    req = withImages(req, 1);
    const res = await req;
    expect(res.status).toBe(201);
    expect(res.body.added).toHaveLength(1);
    expect(res.body.added[0].path).toMatch(/^images\/paddling_out\/whiterock-a[0-9a-z]+-1-[0-9a-f]{12}\.png$/);
    expect(res.body.images).toHaveLength(3);
    expect(admin._mocks.docData['paddlingSpots/whiterock'].imageCount).toBe(3);
  });

  test('DELETE refuses a path that belongs to another spot', async () => {
    const res = await request(app())
      .delete('/paddlingOut/admin/spots/whiterock/images')
      .query({ path: 'images/paddling_out/whiterock-north-1-ab.jpg' })
      .set('X-Admin-Key', 'test-admin');
    expect(res.status).toBe(400);
  });

  test('DELETE removes a photo but keeps the last one on a public spot', async () => {
    let res = await request(app()).delete('/paddlingOut/admin/spots/whiterock/images')
      .query({ path: 'images/paddling_out/whiterock2.webp' }).set('X-Admin-Key', 'test-admin');
    expect(res.status).toBe(200);
    expect(res.body.images.map(i => i.path)).toEqual(['images/paddling_out/whiterock1.webp']);
    delete admin._mocks.storageFiles()['images/paddling_out/whiterock2.webp'];
    require('../api/weather/paddlingout')._test.invalidateImageListCache();
    res = await request(app()).delete('/paddlingOut/admin/spots/whiterock/images')
      .query({ path: 'images/paddling_out/whiterock1.webp' }).set('X-Admin-Key', 'test-admin');
    expect(res.status).toBe(409);
  });

  test('public list exposes tags and hides archived spots', async () => {
    admin._mocks.docData['paddlingSpots/whiterock'].tags = ['staff-pick'];
    admin._mocks.docData['paddlingSpots/gone'] = { title: 'Gone', archived: true, location: { latitude: 1, longitude: 1 } };
    const res = await request(app()).get('/paddlingOut');
    expect(res.status).toBe(200);
    const ids = res.body.map(s => s.id);
    expect(ids).toContain('whiterock');
    expect(ids).not.toContain('gone');
    expect(res.body.find(s => s.id === 'whiterock').tags).toEqual(['staff-pick']);
  });
});

describe('reverse-geocode', () => {
  test('validates coordinates before touching Nominatim', async () => {
    const res = await request(app()).get('/paddlingOut/reverse-geocode?lat=abc&lng=1');
    expect(res.status).toBe(400);
  });
});

describe('helpers', () => {
  const { fileBelongsToSpot, normalizeTags } = require('../api/weather/paddlingout')._test;
  test('fileBelongsToSpot respects id boundaries', () => {
    expect(fileBelongsToSpot('jenny1.webp', 'jenny')).toBe(true);
    expect(fileBelongsToSpot('jenny-1-0123456789ab.jpg', 'jenny')).toBe(true);
    expect(fileBelongsToSpot('jenny-a1x2y3-2-0123456789ab.png', 'jenny')).toBe(true);
    expect(fileBelongsToSpot('jenny-lake-1-0123456789ab.jpg', 'jenny')).toBe(false);
    expect(fileBelongsToSpot('jennylake1.webp', 'jenny')).toBe(false);
    expect(fileBelongsToSpot('community-jenny-lake-ab12cd34-1-0123456789ab.jpg', 'community-jenny-lake-ab12cd34')).toBe(true);
    expect(fileBelongsToSpot('WhiteRock1.webp', 'whiterock')).toBe(true);
  });
  test('normalizeTags whitelists, dedupes and caps', () => {
    expect(normalizeTags(['New', 'new', 'x', 'verified', 'river', 'seasonal', 'staff-pick'])).toEqual(['new', 'verified', 'river', 'seasonal']);
    expect(normalizeTags('community, bogus')).toEqual(['community']);
    expect(normalizeTags(null)).toEqual([]);
  });
});
