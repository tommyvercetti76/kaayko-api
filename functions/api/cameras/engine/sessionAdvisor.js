const { parseShutterToSeconds } = require('./evCalc');

const MODE_DETAIL = {
  apprentice: {
    checklistLimit: 4,
    includeScience: false,
    detailLevel: 'concise',
    watchoutLimit: 2,
    primaryActionLimit: 3,
    advancedSectionLimit: 0,
    includeSettingReasons: false,
    includeValidityBands: false,
  },
  enthusiast: {
    checklistLimit: 6,
    includeScience: false,
    detailLevel: 'guided',
    watchoutLimit: 3,
    primaryActionLimit: 4,
    advancedSectionLimit: 1,
    includeSettingReasons: true,
    includeValidityBands: true,
  },
  craftsperson: {
    checklistLimit: 8,
    includeScience: true,
    detailLevel: 'technical',
    watchoutLimit: 4,
    primaryActionLimit: 5,
    advancedSectionLimit: 3,
    includeSettingReasons: true,
    includeValidityBands: true,
  },
  professional: {
    checklistLimit: 10,
    includeScience: true,
    detailLevel: 'expert',
    watchoutLimit: 5,
    primaryActionLimit: 5,
    advancedSectionLimit: 4,
    includeSettingReasons: true,
    includeValidityBands: true,
  },
};

const ACTION_GENRES = new Set(['wildlife', 'sports', 'automotive', 'concert']);
const WIDE_GENRES = new Set(['landscape', 'architecture', 'realestate', 'travel', 'drone', 'underwater']);
const PORTRAIT_GENRES = new Set(['portrait', 'newborn', 'fashion']);
const PRODUCT_GENRES = new Set(['product', 'food']);
const DOCUMENTATION_GENRES = new Set(['product', 'food', 'architecture', 'realestate']);

function inferBrand(camera, lens) {
  if (camera && camera.brand) return camera.brand;
  if (lens && lens.brand) return lens.brand;

  const name = `${camera?.modelName || ''} ${lens?.lensName || ''}`.toLowerCase();
  if (name.includes('canon')) return 'canon';
  if (name.includes('sony')) return 'sony';
  return 'generic';
}

function parseSensorFormat(camera) {
  if (camera.sensorFormat) return camera.sensorFormat;

  const sensorType = String(camera.sensorType || '').toLowerCase();
  if (sensorType.includes('full-frame') || sensorType.includes('35-mm full frame')) return 'Full-frame';
  if (sensorType.includes('aps-c')) return 'APS-C';
  return 'Unknown';
}

function cropFactor(brand, sensorFormat) {
  if (sensorFormat !== 'APS-C') return 1;
  return brand === 'canon' ? 1.6 : 1.5;
}

function formatFocalRange(lens) {
  if (!lens || !lens.minFocalLength || !lens.maxFocalLength) return undefined;
  return lens.minFocalLength === lens.maxFocalLength
    ? `${lens.minFocalLength}mm`
    : `${lens.minFocalLength}-${lens.maxFocalLength}mm`;
}

function formatEquivalentRange(lens, factor) {
  if (!lens || !lens.minFocalLength || !lens.maxFocalLength || factor === 1) return undefined;
  const min = Number((lens.minFocalLength * factor).toFixed(1));
  const max = Number((lens.maxFocalLength * factor).toFixed(1));
  return min === max ? `${min}mm equivalent` : `${min}-${max}mm equivalent`;
}

function formatShutter(seconds) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  if (seconds >= 1) return `${Number(seconds.toFixed(seconds >= 10 ? 0 : 1))}s`;
  return `1/${Math.max(1, Math.round(1 / seconds))}`;
}

function roundSecondsForShutter(seconds) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const stops = [
    1 / 8000,
    1 / 6400,
    1 / 4000,
    1 / 3200,
    1 / 2000,
    1 / 1600,
    1 / 1250,
    1 / 1000,
    1 / 800,
    1 / 640,
    1 / 500,
    1 / 400,
    1 / 320,
    1 / 250,
    1 / 200,
    1 / 160,
    1 / 125,
    1 / 100,
    1 / 80,
    1 / 60,
    1 / 50,
    1 / 40,
    1 / 30,
    1 / 25,
    1 / 20,
    1 / 15,
    1 / 13,
    1 / 10,
    1 / 8,
    1 / 6,
    1 / 4,
    1 / 2,
    1,
    2,
    4,
  ];

  return stops.reduce((closest, candidate) => {
    if (!closest) return candidate;
    return Math.abs(candidate - seconds) < Math.abs(closest - seconds) ? candidate : closest;
  }, null);
}

function parseNativeIsoMax(camera) {
  if (camera.nativeIsoMax) return camera.nativeIsoMax;

  const isoRange = String(camera.isoRange || '');
  const nativeSection = isoRange.split(/\(.*expandable/i)[0];
  const values = [...nativeSection.matchAll(/(\d[\d,]*)/g)].map((match) => Number(match[1].replace(/,/g, '')));
  return values[values.length - 1];
}

function bestStabilizationStops(camera, lens) {
  const cameraStops = camera.IBIS ? Number(camera.ibisStops || 0) : 0;
  const lensStops = lens.hasOIS ? Number(lens.oisStops || 0) : 0;
  return Math.max(cameraStops, lensStops);
}

function sceneFlags(genre, condition, preset) {
  const tags = (preset.tags || []).map((tag) => tag.toLowerCase());
  const normalizedCondition = String(condition || '').replace(/[_-]+/g, ' ').toLowerCase();
  const haystack = `${genre} ${normalizedCondition} ${tags.join(' ')}`.toLowerCase();
  const includes = (...terms) => terms.some((term) => haystack.includes(term));

  const action = ACTION_GENRES.has(genre) || includes('fast movement', 'running', 'panning', 'birds in flight', 'tracking', 'sports', 'dance floor', 'mma', 'jump');
  const portrait = PORTRAIT_GENRES.has(genre);
  const product = PRODUCT_GENRES.has(genre);
  const macro = genre === 'macro' || includes('macro', 'closeup', 'close-up', 'snowflake');
  const astro = genre === 'astro' || includes('milky way', 'star', 'planetary', 'eclipse', 'comet');
  const wideScene = WIDE_GENRES.has(genre) || includes('wide angle', 'cityscape', 'interior', 'landscape', 'mountain', 'coastal', 'reef', 'architecture');
  const tripod = Boolean(preset.requiresTripod) || includes('tripod', 'long exposure', 'waterfall', 'focus stack', 'time-lapse', 'deep sky');
  const lowLight = includes('night', 'low light', 'dim', 'candle', 'ambient', 'concert', 'stage', 'bar', 'restaurant', 'blue hour', 'twilight') || genre === 'indoorlowlight' || genre === 'concert' || astro;
  const flickerRisk = includes('indoor', 'arena', 'gym', 'pool', 'concert', 'stage', 'restaurant', 'bar', 'museum', 'artificial', 'dance floor');
  const bracket = genre === 'realestate' || includes('hdr', 'backlit', 'high contrast', 'twilight', 'sunset', 'storm', 'snow', 'interior');
  const nd = Boolean(preset.requiresNDFilter) || includes('nd filter', 'long exposure', 'waterfall');
  const cpl = includes('reflection', 'water', 'glass', 'beach', 'automotive');
  const silhouette = includes('silhouette');
  const backlit = includes('backlit', 'rim light');
  const snowBeach = includes('snow', 'beach');
  const highKey = includes('high key');
  const lowKey = includes('low key', 'dark', 'moody');
  const blackAndWhite = includes('black and white');
  const silentPriority = includes('candid', 'ceremony', 'wildlife', 'newborn', 'museum', 'acoustic', 'intimate', 'hide');
  const wildlife = genre === 'wildlife';
  const bird = includes('bird');
  const motorsport = genre === 'automotive' || includes('motorsports', 'car', 'track');
  const event = genre === 'event' || genre === 'concert';
  const reflection = includes('reflection');
  const symmetry = includes('symmetrical', 'symmetry');
  const leadingLines = includes('grid', 'road', 'street', 'architecture', 'urban');
  const documentation = DOCUMENTATION_GENRES.has(genre) || includes('white background', 'scale comparison', 'commercial', 'interior', 'detail');
  const colorCritical = documentation || includes('studio', 'product', 'food', 'white background', 'commercial');
  const simpleBackgroundBenefit = portrait || product || macro || genre === 'food';
  const remoteWildlife = wildlife && includes('hide', 'long wait', 'nocturnal');

  return {
    tags,
    action,
    portrait,
    product,
    macro,
    astro,
    wideScene,
    tripod,
    lowLight,
    flickerRisk,
    bracket,
    nd,
    cpl,
    silhouette,
    backlit,
    snowBeach,
    highKey,
    lowKey,
    blackAndWhite,
    silentPriority,
    wildlife,
    bird,
    motorsport,
    event,
    reflection,
    symmetry,
    leadingLines,
    documentation,
    colorCritical,
    simpleBackgroundBenefit,
    remoteWildlife,
  };
}

function lensFitAssessment(genre, lens, equivalentMax, equivalentMin) {
  if (!lens || !lens.maxFocalLength) {
    return {
      assessment: 'No focal-range check available without a lens selection.',
    };
  }

  if (genre === 'wildlife' && equivalentMax < 300) {
    return {
      assessment: 'This lens is short for wildlife.',
      note: 'Expect to crop aggressively or work much closer than usual.',
    };
  }

  if (genre === 'sports' && equivalentMax < 200) {
    return {
      assessment: 'This lens may be short for larger-field sports.',
      note: 'It can still work for courtside, indoor, or close sideline coverage, but field-size sports may demand more reach.',
    };
  }

  if ((genre === 'landscape' || genre === 'architecture' || genre === 'realestate') && equivalentMin > 24) {
    return {
      assessment: 'This setup is not especially wide for interiors or large scenes.',
      note: 'Prioritize stitching or step back when framing allows.',
    };
  }

  if (PORTRAIT_GENRES.has(genre) && (equivalentMax < 50 || equivalentMin > 135)) {
    return {
      assessment: 'The focal range is workable, but it does not cover the classic portrait band cleanly.',
      note: 'Use distance and background separation carefully to keep faces flattering.',
    };
  }

  if (genre === 'macro' && !/macro/i.test(lens.lensName || '')) {
    return {
      assessment: 'This is not a dedicated macro lens.',
      note: 'Close-up work will be limited by magnification and working distance.',
    };
  }

  return {
    assessment: 'The selected lens range fits this session well.',
  };
}

function whiteBalanceStrategy(flags) {
  if (flags.astro) return 'Manual 3800-4300K to keep the night sky neutral and repeatable.';
  if (flags.snowBeach) return 'Daylight or 5600K; add +2/3 to +1 EV instead of warming the file to chase brightness.';
  if (flags.backlit) return 'Daylight or Cloudy to preserve the warm rim light instead of letting AWB neutralize it.';
  if (flags.lowLight && flags.event) return 'Auto WB is fine for mixed event lighting; lock a manual Kelvin value if the room light is stable.';
  if (flags.lowLight) return 'Tungsten/Auto or roughly 3000-4200K depending on how warm you want the scene.';
  return 'Daylight for sun, Cloudy/Shade for overcast; use custom WB when color accuracy matters more than speed.';
}

function exposureCompensation(flags) {
  if (flags.silhouette) return '-1 to -2 EV to protect the sky and keep the subject intentionally dark.';
  if (flags.highKey || flags.snowBeach) return '+2/3 to +1 EV to stop bright scenes from going dull gray.';
  if (flags.lowKey) return '-1/3 to -1 EV to keep blacks rich and avoid flattening the mood.';
  if (flags.backlit && flags.portrait) return '+1/3 to +2/3 EV on skin if highlights are under control.';
  if (flags.bracket) return 'Keep the base frame conservative and recover the range with bracketing instead of one overworked exposure.';
  return 'Start at 0 EV and ride the histogram rather than trusting the rear screen brightness.';
}

function fileFormatAdvice(flags) {
  if (flags.event) return 'RAW+JPEG if delivery speed matters; otherwise stay in RAW for highlight recovery and mixed-light cleanup.';
  if (flags.blackAndWhite) return 'RAW with a monochrome preview if you want black-and-white feedback without losing color data.';
  return 'RAW capture for headroom; add JPEG only if you need rapid review or same-day delivery.';
}

function pictureStyleAdvice(flags) {
  if (flags.blackAndWhite) return 'Use a monochrome preview profile only for monitoring; keep the RAW in color.';
  if (flags.product) return 'Use a neutral preview profile so lighting and color decisions stay honest.';
  return 'Use a neutral or standard preview profile and judge exposure from the histogram, not the LCD look.';
}

function processingDisciplineAdvice(flags) {
  if (flags.colorCritical || flags.documentation) {
    return 'Treat in-camera HDR, scene optimization, and heavy JPEG rendering as previews, not ground truth. Hidden tone and color decisions are fine for convenience but weak for repeatable work.';
  }

  return 'Use picture styles and auto tone intentionally. The camera is always interpreting the scene for you unless you keep the master capture in RAW.';
}

function resolutionPolicyAdvice(flags) {
  if (flags.documentation || flags.wildlife || flags.macro || flags.astro) {
    return 'Use the highest practical capture quality and full resolution. Crop or downsample later after you confirm detail is truly surplus.';
  }

  return 'Full resolution is the safe default. Step down only when storage, transfer speed, or delivery workflow genuinely requires it.';
}

function colorAccuracyAdvice(flags) {
  if (flags.colorCritical) {
    return 'For color-critical work, lock white balance and record a neutral gray or color target whenever the lighting setup changes.';
  }

  if (flags.event || flags.lowLight) {
    return 'Mixed lighting makes perfect color control unrealistic. Prioritize skin or subject color over background lighting gimmicks.';
  }

  return 'If color consistency matters across a set, avoid letting Auto WB drift from frame to frame.';
}

function repeatabilityAdvice(flags) {
  if (flags.documentation) {
    return 'For repeatable deliverable sets, keep focal length, camera height, camera-to-subject distance, background, aperture, exposure, and white balance fixed across the sequence.';
  }

  return 'When building a series, change one variable at a time so you can trace what improved or degraded the result.';
}

function compositionPlacementAdvice(flags) {
  if (flags.symmetry || flags.reflection) {
    return 'Centered placement is a feature here, not a mistake. Let symmetry or the reflection axis carry the frame cleanly.';
  }

  if (flags.leadingLines || flags.wideScene) {
    return 'Start with thirds or an offset horizon, but let strong leading lines or a vanishing point dictate the final placement if they read more clearly.';
  }

  if (flags.portrait || flags.product) {
    return 'Default to slightly off-center placement unless the face or object is intentionally formal, frontal, or symmetric.';
  }

  return 'Rule-of-thirds placement is a good starting point, but do not force it if the scene becomes weaker.';
}

function compositionRuleBreakingAdvice(flags) {
  if (flags.symmetry || flags.reflection || flags.leadingLines) {
    return 'Aesthetic studies show that centered horizons, eyes, or vanishing points can outperform default thirds when symmetry, framing, or leading lines dominate the composition.';
  }

  return 'Treat composition rules as priors, not laws. Break them when the frame gains clarity, balance, or emphasis.';
}

function backgroundStrategyAdvice(flags) {
  if (flags.simpleBackgroundBenefit) {
    return 'Reduce background clutter and hue count. Cleaner separation and selective blur usually improve perceived quality when the subject is the story.';
  }

  if (flags.wideScene) {
    return 'Use layering, scale, and directional lines before relying on shallow depth of field to create depth.';
  }

  return 'Keep the background intentional. Every bright edge or extra color competes with the main subject.';
}

function depthOfFieldAdvice(flags) {
  if (flags.simpleBackgroundBenefit) {
    return 'Use depth of field as a subject-isolation tool, not a default aesthetic. Blur helps when it removes distractions without sacrificing critical detail.';
  }

  if (flags.documentation || flags.wideScene) {
    return 'Bias toward enough depth of field to preserve informative detail. Add blur only when it serves the story more than the information.';
  }

  return 'Choose depth of field based on what must stay legible in the frame, not because a wide aperture is automatically better.';
}

function buildSubjectDetection(flags, camera) {
  const supported = Array.isArray(camera.subjectDetection) ? camera.subjectDetection.join(', ') : '';
  if (flags.wildlife || flags.bird) return supported ? `Animal/Bird detection if available (${supported}).` : 'Animal/Bird detection if your body offers it.';
  if (flags.motorsport) return supported ? `Vehicle detection if available (${supported}).` : 'Vehicle detection if your body offers it.';
  if (flags.portrait || flags.event) return supported ? `Human eye detection if available (${supported}).` : 'Human eye detection if your body offers it.';
  return supported ? `Use subject detection only when it helps; this body supports ${supported}.` : 'Use subject detection when it is stable, otherwise fall back to a fixed AF area.';
}

function buildShutterChoice(flags, camera) {
  const globalShutter = /a9 iii/i.test(camera.modelName || '');

  if (flags.flickerRisk || flags.event || flags.product) {
    return 'Prefer mechanical or EFCS under LED, fluorescent, or flash-driven lighting to avoid banding and flash limitations.';
  }

  if (flags.silentPriority) {
    if (globalShutter) return 'Electronic shutter is safe here; the global shutter avoids rolling-shutter distortion.';
    return 'Electronic shutter is useful for silence, but switch back to mechanical if banding or skew appears.';
  }

  if (flags.action) return 'Mechanical or EFCS is the safer default unless you have already checked rolling-shutter behavior on fast motion.';
  return 'Mechanical or EFCS is the safest default; use electronic only when the scene benefits from silence.';
}

function driveModeAdvice(flags, preset) {
  if (flags.tripod || flags.product) return 'Single shot or a 2-second timer keeps framing and micro-vibration under control.';
  if (flags.action || preset.requiresTracking) return 'High continuous drive is justified here; cull later instead of missing the peak moment.';
  if (flags.event || flags.portrait) return 'Low or medium continuous drive gives you expression insurance without flooding the card.';
  return 'Single shot is usually enough unless the subject expression or gesture changes quickly.';
}

function supportGearAdvice(flags) {
  const gear = [];

  if (flags.tripod) gear.push('Tripod');
  if (flags.action || flags.wildlife) gear.push('Monopod if the lens is heavy');
  if (flags.portrait || flags.product) gear.push('Reflector or small diffuser');
  if (flags.nd) gear.push('ND filter');
  if (flags.cpl) gear.push('Circular polarizer when glare control matters');
  if (flags.macro) gear.push('Diffused flash or LED panel');
  if (flags.astro) gear.push('Sturdy tripod, remote release, headlamp');

  return gear;
}

function scienceNotes(flags, camera, lens, factor, bestStops, preset) {
  const notes = [];
  const maxFocal = lens.maxFocalLength;

  if (maxFocal) {
    const staticFloorSeconds = roundSecondsForShutter(1 / (maxFocal * factor));
    notes.push(`A static handheld starting floor with this lens is about ${formatShutter(staticFloorSeconds)} before stabilization or subject motion changes the equation.`);

    if (bestStops > 0) {
      const stabilized = roundSecondsForShutter(staticFloorSeconds * Math.pow(2, bestStops));
      notes.push(`The best available stabilization gives roughly ${bestStops} stops of buffer, so static subjects may hold around ${formatShutter(stabilized)} if your technique is clean.`);
    }
  }

  if (factor > 1) {
    notes.push(`This APS-C body applies roughly a ${factor.toFixed(1)}x crop, so the lens frames tighter than it would on full-frame.`);
  }

  if (flags.astro && lens.maxFocalLength) {
    const astroSeconds = Math.max(1, Math.floor(500 / (lens.minFocalLength * factor)));
    notes.push(`For untracked astro, a simple 500-rule start point is about ${astroSeconds}s at the wide end before star trailing becomes obvious.`);
  }

  const presetSeconds = parseShutterToSeconds(preset.shutterSpeed);
  if (flags.action && presetSeconds > 0.001) {
    notes.push('Stabilization does not freeze subject motion; once people, animals, or vehicles move, shutter speed matters more than IBIS or OIS.');
  }

  if (parseSensorFormat(camera) === 'APS-C') {
    notes.push('On APS-C, diffraction starts to soften files noticeably past about f/11, so stop down only when depth of field is worth the trade.');
  } else {
    notes.push('On full-frame, f/16 and smaller apertures are a depth-of-field tool, not a default choice, because diffraction builds quickly there too.');
  }

  if (flags.simpleBackgroundBenefit) {
    notes.push('Photo-quality studies consistently reward clearer subject isolation, simpler backgrounds, and lower color clutter when the image depends on one primary subject.');
  }

  return notes;
}

function buildChecklist(flags, preset, camera, lens) {
  const checklist = [
    `Set the camera to ${preset.mode} with RAW capture and highlight warnings enabled.`,
    `Use ${preset.metering} metering and confirm exposure from the histogram before the session starts.`,
    `Confirm ${preset.afMode} autofocus behavior and your focus area before the key moment begins.`,
    `Check card space, battery status, and front-element cleanliness before shooting.`,
  ];

  if (flags.flickerRisk) checklist.push('Enable anti-flicker or variable shutter if the venue is LED-heavy.');
  if (flags.tripod) checklist.push('Use a timer or remote release and turn stabilization off only if tripod-induced drift appears.');
  if (flags.bracket) checklist.push('Bracket the first high-contrast frame set before the light changes.');
  if (flags.silentPriority) checklist.push('Test electronic shutter for banding or skew before trusting it for the whole session.');
  if (flags.macro) checklist.push('Recheck focus after every meaningful camera or subject movement; depth of field is razor-thin.');
  if (flags.action) checklist.push('Pre-focus, keep both eyes open, and start tracking before the peak action enters the frame.');
  if (flags.astro) checklist.push('Disable long-exposure NR if cadence matters and shoot a separate dark frame set instead.');
  if (flags.colorCritical) checklist.push('Photograph a gray card or color target when the lighting setup changes and lock white balance for the actual series.');
  if (flags.documentation) checklist.push('Lock camera position, focal length, and background before shooting the sequence so the set stays comparable frame to frame.');
  if (flags.remoteWildlife) checklist.push('If you are using hide-based or remote capture, test trigger distance and short burst behavior in the actual environment before relying on it.');
  checklist.push('Use full-resolution capture for the master files and create smaller derivatives only after review.');
  if (camera.maxFlashSync) checklist.push(`Keep flash work at or below ${camera.maxFlashSync} unless you intentionally switch to HSS.`);
  if (lens.lensName) checklist.push(`Use the strengths of ${lens.lensName} instead of forcing it into a role it does not naturally cover.`);

  return checklist;
}

function buildCaveats(flags, camera, lens, lensFit, preset) {
  const caveats = [...(preset.warnings || [])];

  if (flags.lowLight && !camera.IBIS && !lens.hasOIS) {
    caveats.push('This setup has no stabilization safety net for handheld low-light work, so raise shutter speed or add support sooner.');
  }

  if (flags.lowLight && flags.flickerRisk) {
    caveats.push('Indoor LED and discharge lighting can break otherwise good-looking presets; always test for banding at the real venue.');
  }

  if (flags.documentation) {
    caveats.push('Auto white balance, auto exposure drift, and casual recomposition can quietly destroy cross-frame consistency in a deliverable series.');
  }

  if (lensFit.note) caveats.push(lensFit.note);
  return caveats;
}

function titleCaseWords(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim();
}

function firstSentence(value) {
  if (!value) return undefined;
  const match = String(value).trim().match(/^.+?[.!?](?:\s|$)/);
  return match ? match[0].trim() : String(value).trim();
}

function joinDefined(parts, separator = ' · ') {
  return parts.filter(Boolean).join(separator);
}

function cleanEdgePunctuation(value) {
  return value ? String(value).trim().replace(/[. ]+$/, '') : value;
}

function briefLensAssessment(assessment) {
  const text = String(assessment || '');
  if (!text) return 'Unknown fit';
  if (text.includes('fits this session well')) return 'Good fit';
  if (text.includes('short for wildlife')) return 'Short for wildlife';
  if (text.includes('not especially wide')) return 'Limited width for large scenes';
  if (text.includes('classic portrait band')) return 'Workable, not classic portrait framing';
  if (text.includes('not a dedicated macro lens')) return 'Limited macro capability';
  return firstSentence(text);
}

function shortWhiteBalance(flags) {
  if (flags.astro) return 'Manual 3800-4300K';
  if (flags.snowBeach) return 'Daylight / 5600K';
  if (flags.backlit) return 'Daylight or Cloudy';
  if (flags.lowLight && flags.event) return 'Auto WB unless the room stays stable';
  if (flags.lowLight) return 'Auto or 3000-4200K';
  return flags.colorCritical ? 'Locked WB with a gray target' : 'Daylight / Auto as needed';
}

function exposureReason(flags) {
  if (flags.action) return 'Freeze subject motion first and let ISO climb sooner than shutter drops.';
  if (flags.portrait) return 'Protect skin tone and keep enough shutter speed for subject movement, not just camera shake.';
  if (flags.product || flags.documentation) return 'Repeatability matters more than creative drift, so keep the baseline fixed.';
  if (flags.astro) return 'Keep stars from trailing and avoid needless color drift between frames.';
  if (flags.macro) return 'Critical sharpness depends more on focus placement and stability than extreme stop-down.';
  return 'Start from a safe baseline and adjust from the histogram, not the LCD brightness.';
}

function focusReason(flags) {
  if (flags.action || flags.wildlife) return 'Tracking earns its keep only if it stays glued to the subject through a short test burst.';
  if (flags.portrait || flags.event) return 'Bias the system toward eyes or faces, but verify that it is landing on the near eye.';
  if (flags.product || flags.macro || flags.astro) return 'Precision beats automation here, so use the smallest controllable focus area.';
  return 'Use the least-complex focus mode that stays reliable for the subject.';
}

function supportReason(flags, stabilization) {
  if (flags.tripod) return 'A tripod solves the actual problem here more cleanly than trying to lean on stabilization.';
  if (stabilization && stabilization.stabilizedStaticFloor) {
    return 'Stabilization helps only with camera shake; once the subject moves, shutter speed still wins.';
  }
  return 'Handheld limits are real, so treat the shutter floor as a guardrail rather than a target to flirt with.';
}

function lightReason(flags) {
  if (flags.product || flags.documentation) return 'Lighting shape and color control matter more than tiny third-stop exposure changes.';
  if (flags.portrait) return 'Let the subject set the exposure priority, not the brightness of the background.';
  if (flags.event) return 'Keep the room ambience alive instead of flattening it with brute-force flash.';
  if (flags.astro) return 'Control any added light carefully so the sky stays believable.';
  return 'Solve light direction and quality before you start chasing settings.';
}

function confidenceHeadline(checks) {
  const gear = checks.find((check) => check.label === 'Gear limits');
  const style = checks.find((check) => check.label === 'Composition and aesthetics');
  return joinDefined([
    gear ? `Gear ${gear.confidence}` : null,
    style ? `Style ${style.confidence}` : null,
  ], ' / ');
}

function buildValidity(flags, detail) {
  const checks = [
    {
      label: 'Gear limits',
      confidence: 'high',
      note: 'Driven by official camera and lens fields such as aperture limits, stabilization flags, crop format, and flash sync where present.',
    },
    {
      label: 'Exposure baseline',
      confidence: 'medium-high',
      note: 'Built from preset data plus shutter, crop-factor, and stabilization heuristics. It is a strong starting point, not a scene meter reading.',
    },
    {
      label: flags.colorCritical || flags.documentation ? 'Color and repeatability' : 'Color control',
      confidence: flags.colorCritical || flags.documentation ? 'medium-high' : 'medium',
      note: flags.colorCritical || flags.documentation
        ? 'Backed by documentation and technical-photography standards when the scene and lighting are controlled.'
        : 'Useful guidance, but mixed lighting and uncontrolled environments can move this from precise to approximate quickly.',
    },
    {
      label: 'Composition and aesthetics',
      confidence: 'medium',
      note: 'Research-backed tendencies help, but framing rules are not universal and must yield to the actual scene.',
    },
    {
      label: 'Genre field advice',
      confidence: 'medium',
      note: 'Rule-based recommendations are practical, but the final validation layer is still real photographer review on live sessions.',
    },
  ];

  return {
    summary: 'Reliable on gear limits, strong as an exposure starting point, and less absolute on aesthetics or genre-specific style choices.',
    action: flags.action
      ? 'Validate the first burst for motion blur, tracking accuracy, and clipping before trusting the preset for the full session.'
      : 'Treat the first few frames as calibration: check blur, highlights, and color, then adjust one variable at a time.',
    checks: detail.includeValidityBands ? checks : [],
    headline: confidenceHeadline(checks),
  };
}

function buildPrimaryActions(detail, flags, preset, optimization, camera) {
  const actions = [
    `Start with ${joinDefined([preset.mode, `f/${preset.aperture}`, preset.shutterSpeed, `ISO ${preset.ISO}`])}.`,
    `Set focus to ${joinDefined([
      cleanEdgePunctuation(optimization.focus.autofocusMode),
      cleanEdgePunctuation(optimization.focus.focusArea),
    ], ' / ')}.`,
    flags.colorCritical
      ? 'Lock white balance and capture a gray or color target before the real sequence.'
      : 'Shoot three test frames and read the histogram before the real sequence starts.',
    flags.tripod
      ? 'Use a timer or remote release and verify that stabilization is not fighting the tripod.'
      : optimization.stabilization.staticHandheldFloor
        ? `Treat ${optimization.stabilization.staticHandheldFloor} as the rough handheld floor for static subjects.`
        : 'Raise shutter speed before blaming focus if the first frames look soft.',
    camera.maxFlashSync
      ? `Keep flash work at or below ${camera.maxFlashSync} unless you intentionally switch to HSS.`
      : null,
  ];

  if (flags.action) {
    actions.push('Run a short test burst before the decisive moment and confirm that motion is actually frozen.');
  }

  return actions.filter(Boolean).slice(0, detail.primaryActionLimit);
}

function buildCoreSettings(detail, flags, optimization, lensFit, validity) {
  const settings = [
    {
      label: 'Exposure baseline',
      value: joinDefined([
        optimization.exposure.mode,
        optimization.exposure.aperture,
        optimization.exposure.shutterSpeed,
        optimization.exposure.ISO ? `ISO ${optimization.exposure.ISO}` : null,
        optimization.exposure.autoIsoCeiling ? `Auto ISO to ${optimization.exposure.autoIsoCeiling}` : null,
      ]),
      reason: detail.includeSettingReasons ? exposureReason(flags) : undefined,
    },
    {
      label: 'Focus setup',
      value: joinDefined([
        cleanEdgePunctuation(optimization.focus.autofocusMode),
        cleanEdgePunctuation(optimization.focus.focusArea),
        cleanEdgePunctuation(optimization.focus.subjectDetection),
      ]),
      reason: detail.includeSettingReasons ? focusReason(flags) : undefined,
    },
    {
      label: 'Support and shutter floor',
      value: joinDefined([
        optimization.stabilization.support,
        optimization.stabilization.staticHandheldFloor ? `Static floor ${optimization.stabilization.staticHandheldFloor}` : null,
        optimization.stabilization.stabilizedStaticFloor ? `Stabilized ${optimization.stabilization.stabilizedStaticFloor}` : null,
      ]),
      reason: detail.includeSettingReasons ? supportReason(flags, optimization.stabilization) : undefined,
    },
    {
      label: 'Light and color',
      value: joinDefined([
        shortWhiteBalance(flags),
        titleCaseWords(optimization.exposure.metering),
        briefLensAssessment(lensFit.assessment),
      ]),
      reason: detail.includeSettingReasons ? lightReason(flags) : undefined,
    },
  ];

  return settings.map((setting) => ({
    ...setting,
    confidence: validity.headline,
  }));
}

function buildAdvancedSections(detail, optimization, validity) {
  if (!detail.advancedSectionLimit) return [];

  const sections = [
    {
      title: 'Quality control',
      items: [
        optimization.qualityControls.colorAccuracy,
        optimization.qualityControls.repeatability,
        optimization.qualityControls.hiddenChoiceAwareness,
      ].filter(Boolean),
    },
    {
      title: 'Composition',
      items: [
        optimization.composition.placement,
        optimization.composition.ruleBreaking,
        optimization.composition.backgroundStrategy,
        optimization.composition.depthOfFieldUse,
      ].filter(Boolean),
    },
    {
      title: 'Lens fit',
      items: [
        optimization.lensFit.focalRange ? `Lens range: ${optimization.lensFit.focalRange}` : null,
        optimization.lensFit.equivalentRange ? `Equivalent framing: ${optimization.lensFit.equivalentRange}` : null,
        optimization.lensFit.assessment,
      ].filter(Boolean),
    },
    {
      title: 'Reliability notes',
      items: [
        validity.summary,
        ...validity.checks.map((check) => `${titleCaseWords(check.label)}: ${check.confidence}. ${check.note}`),
      ].filter(Boolean),
    },
  ];

  if (Array.isArray(optimization.scienceNotes) && optimization.scienceNotes.length) {
    sections.splice(3, 0, {
      title: 'Science notes',
      items: optimization.scienceNotes,
    });
  }

  return sections
    .filter((section) => Array.isArray(section.items) && section.items.length)
    .slice(0, detail.advancedSectionLimit);
}

function buildCoachTip(mode, preset, flags) {
  if (mode === 'apprentice') {
    return firstSentence(preset.proTip) || 'If the first frames fail, change one variable at a time so you can see what actually fixed the shot.';
  }

  if (mode === 'enthusiast') {
    return firstSentence(preset.proTip) || 'Shoot a short safety sequence, review it at 100%, and then decide whether the shutter, focus mode, or light is the first thing to change.';
  }

  if (flags.documentation || flags.colorCritical) {
    return 'Lock the repeatable variables first. Creative variation comes after the deliverable set is secure.';
  }

  return firstSentence(preset.proTip) || 'Use the preset as a baseline, but let the first controlled test sequence tell you where the real risk sits.';
}

function buildBriefing(mode, detail, flags, preset, optimization, lensFit, validity) {
  return {
    audienceMode: mode,
    detailLevel: detail.detailLevel,
    heading: `${titleCaseWords(preset.genre)} Session Brief`,
    summary: flags.action
      ? 'Prioritize motion control and tracking reliability first. If the subject is moving, protect shutter speed before almost everything else.'
      : flags.portrait
        ? 'Bias toward clean subject separation, reliable eye focus, and consistent skin exposure instead of chasing dramatic settings for their own sake.'
        : flags.documentation || flags.product
          ? 'Keep the setup repeatable and color-stable. Locked variables beat clever improvisation for deliverable work.'
          : flags.astro
            ? 'Build the frame around stability, star control, and consistent color. Small setup errors compound quickly in night work.'
            : 'Use the preset as a disciplined starting point, confirm it on the first frames, and then refine from the actual light.',
    scorecard: [
      { label: 'Audience', value: titleCaseWords(mode) },
      { label: 'Lens fit', value: briefLensAssessment(lensFit.assessment) },
      { label: 'Confidence', value: validity.headline },
    ],
    primaryActions: buildPrimaryActions(detail, flags, preset, optimization, preset.camera || {}),
    coreSettings: buildCoreSettings(detail, flags, optimization, lensFit, validity),
    watchouts: optimization.caveats.slice(0, detail.watchoutLimit),
    coachTip: buildCoachTip(mode, preset, flags),
    advancedSections: buildAdvancedSections(detail, optimization, validity),
  };
}

function buildSessionOptimization(camera, lens, preset, mode) {
  const detail = MODE_DETAIL[mode] || MODE_DETAIL.apprentice;
  const brand = inferBrand(camera, lens);
  const sensorFormat = parseSensorFormat(camera);
  const factor = cropFactor(brand, sensorFormat);
  const equivalentRange = formatEquivalentRange(lens, factor);
  const flags = sceneFlags(preset.genre, preset.condition, preset);
  const maxFocal = lens.maxFocalLength;
  const minFocal = lens.minFocalLength;
  const equivalentMin = minFocal ? minFocal * factor : undefined;
  const equivalentMax = maxFocal ? maxFocal * factor : undefined;
  const lensFit = lensFitAssessment(preset.genre, lens, equivalentMax, equivalentMin);
  const nativeIsoMax = parseNativeIsoMax(camera);
  const bestStops = bestStabilizationStops(camera, lens);
  const staticFloor = maxFocal ? roundSecondsForShutter(1 / (maxFocal * factor)) : undefined;
  const stabilizedFloor = staticFloor && bestStops > 0
    ? roundSecondsForShutter(staticFloor * Math.pow(2, bestStops))
    : undefined;

  const optimization = {
    meta: {
      audienceMode: mode,
      detailLevel: detail.detailLevel,
    },
    foundation: {
      fileFormat: fileFormatAdvice(flags),
      pictureStyle: pictureStyleAdvice(flags),
      colorWorkflow: 'Keep JPEG color space on sRGB unless you manage Adobe RGB end-to-end; RAW capture keeps that decision flexible.',
      processingDiscipline: processingDisciplineAdvice(flags),
      resolutionPolicy: resolutionPolicyAdvice(flags),
      monitoring: 'Enable histogram and highlight alert. Add zebras if your body offers them and you already know how to use them.',
      lensCorrections: 'Leave lens corrections on for JPEG previews, but make the final correction decision in post from RAW when possible.',
    },
    exposure: {
      mode: preset.mode,
      shutterSpeed: preset.shutterSpeed,
      aperture: `f/${preset.aperture}`,
      ISO: preset.ISO,
      autoIsoCeiling: nativeIsoMax ? Math.min(nativeIsoMax, flags.lowLight || flags.action ? 6400 : 3200) : undefined,
      metering: preset.metering,
      exposureCompensation: exposureCompensation(flags),
      whiteBalance: whiteBalanceStrategy(flags),
      bracketing: flags.bracket
        ? 'Use a 3-5 frame bracket when highlights and shadows cannot both fit in one frame.'
        : 'Bracket only if the histogram shows you cannot hold both highlights and shadows cleanly.',
    },
    focus: {
      autofocusMode: preset.afMode === 'single' ? 'AF-S / One Shot' : 'AF-C / Servo',
      focusArea: flags.macro || flags.product || flags.astro
        ? 'Single point or small flexible spot for precise placement.'
        : flags.action || flags.portrait || preset.requiresTracking
          ? 'Wide or zone area with tracking.'
          : 'Use the smallest area that stays fast enough for the subject.',
      subjectDetection: buildSubjectDetection(flags, camera),
      driveMode: driveModeAdvice(flags, preset),
      manualAssist: flags.macro || flags.product || flags.astro
        ? 'Use focus magnification and peaking only as confirmation, not as a substitute for critical checking.'
        : 'Use manual focus assist only when autofocus is clearly struggling.',
    },
    stabilization: {
      support: bestStops > 0
        ? `Best available stabilization buffer: about ${bestStops} stops.`
        : 'No meaningful stabilization buffer available from this body-lens pair.',
      staticHandheldFloor: formatShutter(staticFloor),
      stabilizedStaticFloor: formatShutter(stabilizedFloor),
      tripodAdvice: flags.tripod
        ? 'A tripod is the correct tool here; leave stabilization on only if testing shows the system stays stable.'
        : 'Stay above the handheld floor whenever the subject itself is moving, even if stabilization is strong.',
    },
    shutterAndLighting: {
      shutterChoice: buildShutterChoice(flags, camera),
      flashGuidance: camera.maxFlashSync
        ? `Stay at or below ${camera.maxFlashSync} for conventional flash sync unless you intentionally move into HSS.`
        : 'Assume flash timing needs testing on this setup before the session starts.',
      lighting: flags.product
        ? 'Control the light before touching the camera settings. Small changes in diffusion, flags, and card fill matter more than one third-stop camera tweaks.'
        : flags.portrait
          ? 'Use reflector or subtle fill flash when the face falls too deep into shadow; do not let the background dictate skin exposure.'
          : flags.event
            ? 'Bounce flash if permitted and keep room ambience alive instead of flattening the space.'
            : flags.astro
              ? 'Keep artificial light off the scene unless you are intentionally adding controlled foreground light.'
              : 'Shape the light first, then lock in exposure from the result.',
      filtersAndSupportGear: supportGearAdvice(flags),
    },
    qualityControls: {
      colorAccuracy: colorAccuracyAdvice(flags),
      repeatability: repeatabilityAdvice(flags),
      hiddenChoiceAwareness: 'Exposure, focal length, viewpoint, processing, and tone mapping all change the meaning of the image. Treat them as deliberate decisions rather than invisible defaults.',
    },
    composition: {
      placement: compositionPlacementAdvice(flags),
      ruleBreaking: compositionRuleBreakingAdvice(flags),
      backgroundStrategy: backgroundStrategyAdvice(flags),
      depthOfFieldUse: depthOfFieldAdvice(flags),
    },
    lensFit: {
      focalRange: formatFocalRange(lens),
      equivalentRange,
      assessment: lensFit.assessment,
    },
    checklist: buildChecklist(flags, preset, camera, lens).slice(0, detail.checklistLimit),
    caveats: buildCaveats(flags, camera, lens, lensFit, preset),
  };

  if (detail.includeScience) {
    optimization.scienceNotes = scienceNotes(flags, camera, lens, factor, bestStops, preset);
  }

  optimization.validity = buildValidity(flags, detail);
  optimization.briefing = buildBriefing(mode, detail, flags, preset, optimization, lensFit, optimization.validity);

  return optimization;
}

module.exports = {
  buildSessionOptimization,
};
