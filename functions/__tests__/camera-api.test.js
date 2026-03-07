require('./helpers/mockSetup');
const request = require('supertest');
const admin = require('firebase-admin');
const { buildTestApp } = require('./helpers/testApp');

const CANON_CAMERA_MODEL = 'Canon EOS-1D X Mark II';
const CANON_LENS_NAME = 'Canon EF 16-35mm f/2.8L III USM';

describe('Camera API', () => {
  test('camera catalog backfills current Canon and Sony bodies', () => {
    const canon = require('../api/cameras/data_cameras/canon.json');
    const sony = require('../api/cameras/data_cameras/sony.json');

    expect(canon.cameras.some((camera) => camera.modelName === 'Canon EOS R6 Mark III')).toBe(true);
    expect(canon.cameras.some((camera) => camera.modelName === 'Canon EOS R50 V')).toBe(true);
    expect(sony.cameras.some((camera) => camera.modelName === 'Sony Alpha a1 II')).toBe(true);
    expect(sony.cameras.some((camera) => camera.modelName === 'Sony Alpha a7 V')).toBe(true);
    expect(sony.cameras.some((camera) => camera.modelName === 'Sony Alpha a6100')).toBe(true);
    expect(sony.cameras.some((camera) => camera.modelName === 'Sony ZV-E10 II')).toBe(true);
  });

  test('camera and lens records carry provenance metadata', () => {
    const canonCameras = require('../api/cameras/data_cameras/canon.json').cameras;
    const sonyLenses = require('../api/cameras/data_lenses/sony.json').lenses;

    expect(canonCameras.every((camera) => Array.isArray(camera.sourceUrls) && camera.sourceUrls.length > 0)).toBe(true);
    expect(canonCameras.every((camera) => typeof camera.validationTier === 'string')).toBe(true);
    expect(sonyLenses.every((lens) => Array.isArray(lens.sourceUrls) && lens.sourceUrls.length > 0)).toBe(true);
    expect(sonyLenses.every((lens) => typeof lens.verificationScope === 'string')).toBe(true);
  });

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
    expect(res.body.preset.sessionOptimization).toBeDefined();
    expect(res.body.preset.sessionOptimization.exposure.whiteBalance).toBeDefined();
    expect(res.body.preset.sessionOptimization.qualityControls).toBeDefined();
    expect(res.body.preset.sessionOptimization.composition).toBeDefined();
    expect(Array.isArray(res.body.preset.sessionOptimization.checklist)).toBe(true);
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
    expect(res.body.presetsByInterest[0].presets[0].sessionOptimization).toBeDefined();
  });
});
