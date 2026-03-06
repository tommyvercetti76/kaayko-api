const express = require('express');
const router = express.Router();
const path = require('path');
const { validate, ClassicPresetSchema, VALID_GENRES } = require('./validate');
const { resolvePreset, validateCompatibility } = require('./engine/presetEngine');

function loadCameraData(brand, modelName) {
  const data = require(path.join(__dirname, 'data_cameras', `${brand}.json`));
  return data.cameras.find(c => c.modelName.toLowerCase() === modelName.toLowerCase());
}

function loadLensData(brand, lensName) {
  const data = require(path.join(__dirname, 'data_lenses', `${brand}.json`));
  return data.lenses.find(l => l.lensName.toLowerCase() === lensName.toLowerCase());
}

const allPresets = require('./data_presets/index');

// GET /presets/meta — returns available conditions per genre
// The web and CLI call this to populate the condition selector
router.get('/meta', (req, res) => {
  const meta = {};
  for (const [genreKey, genreData] of Object.entries(allPresets)) {
    meta[genreKey] = Object.entries(genreData.conditions).map(([key, cond]) => ({
      key,
      displayName: cond.displayName,
    }));
  }
  res.json(meta);
});

// POST /presets/classic — core preset resolution
router.post('/classic', validate(ClassicPresetSchema), (req, res) => {
  const { brand, cameraModel, lensName, genre, condition, mode } = req.body;

  let camera;
  try {
    camera = loadCameraData(brand, cameraModel);
  } catch (e) {
    return res.status(404).json({
      error: { code: 'BRAND_NOT_FOUND', message: `No camera data for brand: ${brand}` }
    });
  }
  if (!camera) {
    return res.status(404).json({
      error: { code: 'CAMERA_NOT_FOUND', message: `Camera not found: ${cameraModel}` }
    });
  }

  let lens;
  try {
    lens = loadLensData(brand, lensName);
  } catch (e) {
    return res.status(404).json({
      error: { code: 'BRAND_NOT_FOUND', message: `No lens data for brand: ${brand}` }
    });
  }
  if (!lens) {
    return res.status(404).json({
      error: { code: 'LENS_NOT_FOUND', message: `Lens not found: ${lensName}` }
    });
  }

  if (!validateCompatibility(camera, lens)) {
    return res.status(400).json({
      error: {
        code: 'INCOMPATIBLE_GEAR',
        message: `${lensName} is not compatible with ${cameraModel}`
      }
    });
  }

  const result = resolvePreset(camera, lens, genre, condition, mode);
  if (result.error) {
    const status = result.error.code === 'GENRE_NOT_FOUND' ? 404 :
                   result.error.code === 'PRESET_NOT_FOUND' ? 404 : 400;
    return res.status(status).json(result);
  }

  res.json(result);
});

module.exports = router;
