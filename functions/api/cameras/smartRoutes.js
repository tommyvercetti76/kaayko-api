const express = require('express');
const router = express.Router();
const path = require('path');
const { validate, SmartPresetSchema } = require('./validate');
const { resolvePreset, validateCompatibility } = require('./engine/presetEngine');
const allPresets = require('./data_presets/index');

const MODE_CONFIG = {
  apprentice:   { presetsPerInterest: 1, includeRationale: false, includeProTip: false },
  enthusiast:   { presetsPerInterest: 3, includeRationale: true,  includeProTip: false },
  craftsperson: { presetsPerInterest: 5, includeRationale: true,  includeProTip: true  },
  professional: { presetsPerInterest: 5, includeRationale: true,  includeProTip: true  },
};

// Minimal stub used when no gear is supplied — allows gear-agnostic smart calls
const GENERIC_CAMERA = { modelName: 'Generic', IBIS: false, ibisStops: 0, weatherSealed: false };
const GENERIC_LENS   = { lensName: 'Generic', hasOIS: false, oisStops: 0, maxAperture: 0 };

function loadCameraData(brand, modelName) {
  const data = require(path.join(__dirname, 'data_cameras', `${brand}.json`));
  return data.cameras.find(c => c.modelName.toLowerCase() === modelName.toLowerCase());
}

function loadLensData(brand, lensName) {
  const data = require(path.join(__dirname, 'data_lenses', `${brand}.json`));
  return data.lenses.find(l => l.lensName.toLowerCase() === lensName.toLowerCase());
}

// POST /presets/smart
// Gear fields (brand, cameraModel, lensName) are optional.
// When provided, the engine applies IBIS/flash-sync/aperture-clamping adjustments.
// When omitted, generic recommendations are returned without gear-specific tuning.
router.post('/', validate(SmartPresetSchema), (req, res) => {
  const { brand, cameraModel, lensName, mode, interests } = req.body;
  const config = MODE_CONFIG[mode];
  const gearProvided = brand && cameraModel && lensName;

  let camera = GENERIC_CAMERA;
  let lens   = GENERIC_LENS;

  if (gearProvided) {
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
  }

  // Map each interest to a genre (fuzzy match against genre display names and keys)
  const genreKeys = Object.keys(allPresets);

  const presetsByInterest = interests.map(interest => {
    const normalised = interest.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Try to find a matching genre
    const matchedGenre = genreKeys.find(gk => {
      const displayName = (allPresets[gk].displayName || gk).toLowerCase().replace(/[^a-z0-9]/g, '');
      return gk.includes(normalised) || normalised.includes(gk) ||
             displayName.includes(normalised) || normalised.includes(displayName);
    }) || genreKeys[0];

    const genreData = allPresets[matchedGenre];
    const conditionKeys = Object.keys(genreData.conditions);

    // Select a subset of conditions based on mode
    const selected = conditionKeys.slice(0, config.presetsPerInterest);

    const presets = selected.map(condKey => {
      const result = resolvePreset(camera, lens, matchedGenre, condKey, mode);
      if (result.error) return null;

      const p = Object.assign({}, result.preset);

      // Strip fields based on mode (resolvePreset already strips via mode param,
      // but re-apply here for the smart-specific config overrides)
      if (!config.includeRationale) {
        delete p.rationale;
        delete p.commonMistake;
      }
      if (!config.includeProTip) {
        delete p.proTip;
      }

      // Remove generic gear stubs from response when no real gear was supplied
      if (!gearProvided) {
        delete p.camera;
        delete p.lens;
      }

      return p;
    }).filter(Boolean);

    return {
      interest,
      genre:   matchedGenre,
      presets,
    };
  });

  const responseBody = { mode, presetsByInterest };
  if (gearProvided) {
    responseBody.camera = { modelName: camera.modelName, IBIS: camera.IBIS };
    responseBody.lens   = { lensName: lens.lensName, hasOIS: lens.hasOIS };
  }

  res.json(responseBody);
});

module.exports = router;
