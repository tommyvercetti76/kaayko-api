require('./helpers/mockSetup');
const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');

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

describe('Paddling Out lake submissions', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSPHRASE = 'test-admin';
  });

  test('requires at least one image', async () => {
    const app = buildTestApp('/paddlingOut', require('../api/weather/paddlingout'));
    const res = await validFields(request(app).post('/paddlingOut/submitEntry'));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/image is required/i);
  });

  test('rejects spoofed image content', async () => {
    const app = buildTestApp('/paddlingOut', require('../api/weather/paddlingout'));
    const res = await validFields(request(app).post('/paddlingOut/submitEntry'))
      .attach('images', Buffer.from('not an image'), {
        filename: 'lake.jpg',
        contentType: 'image/jpeg'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid JPEG, PNG, or WebP/i);
  });

  test('accepts valid multipart submissions without storing raw IP', async () => {
    const app = buildTestApp('/paddlingOut', require('../api/weather/paddlingout'));
    const res = await validFields(request(app).post('/paddlingOut/submitEntry'))
      .attach('images', pngBuffer, {
        filename: 'lake.png',
        contentType: 'image/png'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const publicDoc = admin._mocks.docData[`paddlingSpots/${res.body.id}`];
    const submissionDoc = admin._mocks.docData[`paddling_lake_submissions/${res.body.id}`];

    expect(publicDoc.communitySubmission).toBe(true);
    expect(publicDoc.submissionStatus).toBe('pending');
    expect(publicDoc.imgSrc).toHaveLength(1);
    expect(publicDoc.imageCount).toBe(1);
    expect(submissionDoc.ip).toBeUndefined();
    expect(submissionDoc.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(submissionDoc.imagePaths).toHaveLength(1);
  });

  test('admin rejection blocks publication and clears public image fields', async () => {
    const app = buildTestApp('/paddlingOut', require('../api/weather/paddlingout'));
    admin._mocks.docData['paddlingSpots/community-bad-lake'] = {
      lakeName: 'Bad Lake',
      communitySubmission: true,
      submissionStatus: 'pending',
      imgSrc: ['https://example.com/bad.jpg'],
      imageCount: 1
    };
    admin._mocks.docData['paddling_lake_submissions/community-bad-lake'] = {
      spotId: 'community-bad-lake',
      lakeName: 'Bad Lake',
      status: 'pending',
      submissionStatus: 'pending',
      imagePaths: ['images/paddling_out/community-bad-lake-1-abcd.jpg']
    };

    const res = await request(app)
      .post('/paddlingOut/admin/submissions/community-bad-lake/reject')
      .set('X-Admin-Key', 'test-admin')
      .send({ reason: 'unsafe image' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
    expect(admin._mocks.docData['paddlingSpots/community-bad-lake'].submissionStatus).toBe('rejected');
    expect(admin._mocks.docData['paddlingSpots/community-bad-lake'].imgSrc).toEqual([]);
    expect(admin._mocks.docData['paddling_lake_submissions/community-bad-lake'].status).toBe('rejected');
  });
});
