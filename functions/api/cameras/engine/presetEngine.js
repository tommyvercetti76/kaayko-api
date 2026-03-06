/**
 * presetEngine.js — Core preset resolution logic
 *
 * Given a camera, lens, genre, and condition key, returns a fully resolved
 * preset object with settings adjusted for the specific gear (IBIS, OIS, etc.)
 *
 * The engine reads from data/ files loaded by AGENT-B.
 */

const allPresets = require('../data_presets/index');
const { applyIBISBonus, parseShutterToSeconds, parseMaxShutter } = require('./evCalc');

// Controls which educational fields are included per skill level
const MODE_FIELD_CONFIG = {
  apprentice:   { includeRationale: false, includeProTip: true,  includeCommonMistake: false },
  enthusiast:   { includeRationale: true,  includeProTip: false, includeCommonMistake: false },
  craftsperson: { includeRationale: true,  includeProTip: true,  includeCommonMistake: true  },
  professional: { includeRationale: true,  includeProTip: true,  includeCommonMistake: true  },
};

function resolvePreset(camera, lens, genre, condition, mode) {
  const genreData = allPresets[genre.toLowerCase()];
  if (!genreData) {
    return { error: { code: 'GENRE_NOT_FOUND', message: `Genre not found: ${genre}` } };
  }

  const conditionKey = condition.toUpperCase();
  const base = genreData.conditions[conditionKey];
  if (!base) {
    return { error: { code: 'PRESET_NOT_FOUND', message: `Condition not found: ${condition}` } };
  }

  // Deep clone the preset so we don't mutate cached data
  const preset = Object.assign({}, base);
  preset.genre = genre;
  preset.condition = conditionKey;

  // ── Lens constraint clamping ────────────────────────────────────────────────
  // Ensure aperture doesn't exceed what the lens can physically achieve.
  // In f-number terms: smaller number = wider opening.
  // If preset wants f/2.0 but the lens max is f/4, clamp to f/4.
  if (lens.maxAperture && preset.aperture < lens.maxAperture) {
    preset.warnings = preset.warnings || [];
    preset.warnings.push(
      `Preset recommends f/${preset.aperture} but ${lens.lensName} opens to f/${lens.maxAperture} maximum. Using f/${lens.maxAperture}.`
    );
    preset.aperture = lens.maxAperture;
    preset.apertureAdjusted = true;
  }

  // ── Gear-aware adjustments ──────────────────────────────────────────────────

  // IBIS/OIS bonus — apply if preset benefits from stabilisation
  if (preset.ibisBonus) {
    const cameraIBIS = camera.IBIS ? (camera.ibisStops || 0) : 0;
    const lensOIS    = lens.hasOIS  ? (lens.oisStops || 0)  : 0;
    // Only the better of the two applies (they don't stack for shutter calcs)
    const bestStops  = Math.max(cameraIBIS, lensOIS);
    if (bestStops > 0) {
      const newShutter = applyIBISBonus(preset.shutterSpeed, bestStops);
      preset.shutterSpeedWithIBIS = newShutter;
      preset.ibisStopsApplied     = bestStops;
    }
  }

  // Flash sync check — warn if preset exceeds camera's max flash sync
  if (camera.maxFlashSync) {
    const syncSeconds   = parseShutterToSeconds(camera.maxFlashSync);
    const presetSeconds = parseShutterToSeconds(preset.shutterSpeed);
    if (presetSeconds < syncSeconds && preset.mode !== 'M') {
      preset.warnings = preset.warnings || [];
      preset.warnings.push(
        `Shutter ${preset.shutterSpeed} exceeds flash sync ${camera.maxFlashSync}. Use M mode or HSS flash.`
      );
    }
  }

  // ── Mode-based field stripping ──────────────────────────────────────────────
  // Tailor the educational content to the user's skill level.
  const fieldConfig = MODE_FIELD_CONFIG[mode] || MODE_FIELD_CONFIG.apprentice;
  if (!fieldConfig.includeRationale)    delete preset.rationale;
  if (!fieldConfig.includeProTip)        delete preset.proTip;
  if (!fieldConfig.includeCommonMistake) delete preset.commonMistake;

  // Attach gear info to the response
  preset.camera = {
    modelName:     camera.modelName,
    IBIS:          camera.IBIS,
    ibisStops:     camera.ibisStops || 0,
    weatherSealed: camera.weatherSealed || false,
  };
  preset.lens = {
    lensName: lens.lensName,
    hasOIS:   lens.hasOIS,
    oisStops: lens.oisStops || 0,
  };

  return { preset };
}

// Validate lens is compatible with camera
function validateCompatibility(camera, lens) {
  if (!Array.isArray(lens.compatibleCameras)) return true;
  return lens.compatibleCameras.some(
    c => c.toLowerCase() === camera.modelName.toLowerCase()
  );
}

module.exports = { resolvePreset, validateCompatibility };
