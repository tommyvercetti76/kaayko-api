require('./helpers/mockSetup');
const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');

const CANON_CAMERA_MODEL = 'Canon EOS-1D X Mark II';
const CANON_LENS_NAME = 'Canon EF 16-35mm f/2.8L III USM';

describe('Camera API', () => {
  test('GET /cameras/:brand returns Firestore-backed camera data', async () => {
    const cameraData = require('../api/cameras/data_cameras/canon.json');
    const lensData = require('../api/cameras/data_lenses/canon.json');
    admin._mocks.docData['Kameras/canon'] = {
      cameras: cameraData.cameras,
      lenses: lensData.lenses,
    };

    const app = buildTestApp('/cameras', require('../api/cameras/camerasRoutes'));
    const res = await request(app).get('/cameras/canon');

    expect(res.status).toBe(200);
    expect(res.body.brand).toBe('canon');
    expect(Array.isArray(res.body.cameras)).toBe(true);
    expect(res.body.cameras[0].modelName).toBeDefined();
  });

  test('POST /presets/classic resolves a preset with bundled camera data', async () => {
    const app = buildTestApp('/presets', require('../api/cameras/presetsRoutes'));
    const res = await request(app)
      .post('/presets/classic')
      .send({
        brand: 'canon',
        cameraModel: CANON_CAMERA_MODEL,
        lensName: CANON_LENS_NAME,
        genre: 'portrait',
        condition: 'SUNNY_OUTDOOR',
        mode: 'enthusiast',
      });

    expect(res.status).toBe(200);
    expect(res.body.preset.genre).toBe('portrait');
    expect(res.body.preset.condition).toBe('SUNNY_OUTDOOR');
    expect(res.body.preset.camera.modelName).toBe(CANON_CAMERA_MODEL);
    expect(res.body.preset.lens.lensName).toBe(CANON_LENS_NAME);
  });

  test('POST /presets/smart resolves gear-aware presets', async () => {
    const app = buildTestApp('/presets/smart', require('../api/cameras/smartRoutes'));
    const res = await request(app)
      .post('/presets/smart')
      .send({
        brand: 'canon',
        cameraModel: CANON_CAMERA_MODEL,
        lensName: CANON_LENS_NAME,
        mode: 'enthusiast',
        interests: ['portrait', 'travel'],
      });

    expect(res.status).toBe(200);
    expect(res.body.camera.modelName).toBe(CANON_CAMERA_MODEL);
    expect(res.body.lens.lensName).toBe(CANON_LENS_NAME);
    expect(Array.isArray(res.body.presetsByInterest)).toBe(true);
    expect(res.body.presetsByInterest.length).toBe(2);
    expect(res.body.presetsByInterest[0].presets.length).toBeGreaterThan(0);
  });
});
