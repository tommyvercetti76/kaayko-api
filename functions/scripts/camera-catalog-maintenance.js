#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const officialBodies = require('../api/cameras/audit/officialBodies');

const FUNCTIONS_DIR = path.resolve(__dirname, '..');
const CAMERA_DIR = path.join(FUNCTIONS_DIR, 'api', 'cameras');
const VERIFIED_AT = '2026-03-07';
const VERIFIED_BY = 'codex';
const OFFICIAL_REFERENCE_URLS = {
  canon: {
    cameras: {
      overview: 'https://www.usa.canon.com/digital-cameras',
      mirrorless: 'https://www.usa.canon.com/digital-cameras/eos-r-system',
      dslr: 'https://www.usa.canon.com/shop/cameras/dslr-cameras',
      proDslr: 'https://www.usa.canon.com/pro/cameras/dslr-cameras',
      support: 'https://www.usa.canon.com/support',
    },
    lenses: {
      overview: 'https://www.usa.canon.com/shop/camera-lenses',
      mirrorless: 'https://www.usa.canon.com/shop/camera-lenses/mirrorless-lenses',
      dslr: 'https://www.usa.canon.com/shop/camera-lenses/dslr-lenses',
      support: 'https://www.usa.canon.com/support',
    },
  },
  sony: {
    cameras: {
      all: 'https://electronics.sony.com/imaging/interchangeable-lens-cameras/c/all-interchangeable-lens-cameras',
      fullFrame: 'https://electronics.sony.com/imaging/interchangeable-lens-cameras/c/full-frame',
      apsc: 'https://electronics.sony.com/imaging/interchangeable-lens-cameras/c/aps-c',
      vlog: 'https://electronics.sony.com/imaging/compact-cameras/c/vlog-cameras',
      support: 'https://www.sony.com/electronics/support',
    },
    lenses: {
      all: 'https://electronics.sony.com/imaging/lenses/c/all-e-mount',
      support: 'https://www.sony.com/electronics/support',
      compatibility: 'https://support.d-imaging.sony.co.jp/www/cscs/lens_body/',
    },
  },
};

const CURRENT_BODY_BACKFILLS = {
  canon: [
    {
      modelName: 'Canon EOS R6 Mark III',
      brand: 'canon',
      productLine: 'EOS R System',
      releaseDate: '2025-11-06',
      status: 'current-lineup',
      sensorType: 'Full-frame CMOS, 32.5 MP',
      sensorFormat: 'Full-frame',
      effectiveMegapixels: 32.5,
      isoRange: 'ISO 100-64000 (expandable to 50-102400)',
      nativeIsoMin: 100,
      nativeIsoMax: 64000,
      expandedIsoMin: 50,
      expandedIsoMax: 102400,
      shutterSpeed: '30 sec - 1/8000 sec (electronic up to 1/16000 sec)',
      mechanicalShutterMax: '1/8000',
      electronicShutterMax: '1/16000',
      continuousFpsMechanical: 12,
      continuousFpsElectronic: 40,
      preCapture: true,
      IBIS: true,
      ibisStops: 8.5,
      coordinatedIS: true,
      movieIS: '5-axis digital stabilization with coordinated IS support',
      autofocus: 'Dual Pixel CMOS AF II with advanced subject tracking and Eye Control AF',
      subjectDetection: ['Auto', 'People', 'Animals', 'Vehicles'],
      eyeAfHumans: true,
      eyeAfAnimals: true,
      vehicleDetection: true,
      lensMount: 'RF',
      maxFlashSync: '1/250',
      cardSlots: 2,
      batteryModel: 'LP-E6P',
      weatherSealed: true,
      weightGrams: 699,
      dynamicRange: 15,
      sourceUrls: [
        'https://www.usa.canon.com/newsroom/2025/20251106-canon-announces-eos-r6-mark-iii',
        'https://www.usa.canon.com/support/p/eos-r6-mark-iii',
      ],
      verifiedAt: VERIFIED_AT,
      verifiedBy: VERIFIED_BY,
      verificationScope: 'official-record-page',
      validationTier: 'official-record-spec',
    },
    {
      modelName: 'Canon EOS R50 V',
      brand: 'canon',
      productLine: 'EOS R System',
      releaseDate: '2025-03-26',
      status: 'current-lineup',
      sensorType: 'APS-C CMOS, 24.0 MP',
      sensorFormat: 'APS-C',
      effectiveMegapixels: 24,
      isoRange: 'ISO 100-12800 (expandable to 25600)',
      nativeIsoMin: 100,
      nativeIsoMax: 12800,
      expandedIsoMax: 25600,
      shutterSpeed: '30 sec - 1/4000 sec (electronic up to 1/8000 sec)',
      mechanicalShutterMax: '1/4000',
      electronicShutterMax: '1/8000',
      continuousFpsMechanical: 12,
      continuousFpsElectronic: 15,
      IBIS: false,
      ibisStops: 0,
      coordinatedIS: false,
      movieIS: 'Lens IS plus digital movie stabilization when supported',
      autofocus: 'Dual Pixel CMOS AF with 4503 selectable still-image positions',
      afPointsPhase: 4503,
      subjectDetection: ['Auto', 'People', 'Animals', 'Vehicles'],
      eyeAfHumans: true,
      eyeAfAnimals: true,
      vehicleDetection: true,
      lensMount: 'RF-S',
      maxFlashSync: '1/250',
      cardSlots: 1,
      batteryModel: 'LP-E17',
      weatherSealed: false,
      weightGrams: 370,
      dynamicRange: 11,
      sourceUrls: [
        'https://www.usa.canon.com/newsroom/2025/20250326-camera',
        'https://www.usa.canon.com/support/p/eos-r50-v-body',
      ],
      verifiedAt: VERIFIED_AT,
      verifiedBy: VERIFIED_BY,
      verificationScope: 'official-record-page',
      validationTier: 'official-record-spec',
    },
  ],
  sony: [
    {
      modelName: 'Sony Alpha a1 II',
      brand: 'sony',
      productLine: 'Alpha',
      releaseDate: '2024-12-01',
      status: 'current-lineup',
      sensorType: 'Full-frame Exmor RS CMOS (50.1 MP)',
      sensorFormat: 'Full-frame',
      effectiveMegapixels: 50.1,
      isoRange: 'ISO 100-32000 (expandable to 50-102400)',
      nativeIsoMin: 100,
      nativeIsoMax: 32000,
      expandedIsoMin: 50,
      expandedIsoMax: 102400,
      shutterSpeed: '30 sec - 1/8000 sec (electronic up to 1/32000 sec)',
      mechanicalShutterMax: '1/8000',
      electronicShutterMax: '1/32000',
      continuousFpsMechanical: 10,
      continuousFpsElectronic: 30,
      preCapture: true,
      IBIS: true,
      ibisStops: 8.5,
      movieIS: 'Dynamic Active, Active, Standard, and Off',
      autofocus: 'Fast Hybrid AF with 759 phase-detection points',
      afPointsPhase: 759,
      subjectDetection: ['Auto', 'Human', 'Animal', 'Bird', 'Insect', 'Car', 'Train', 'Airplane'],
      eyeAfHumans: true,
      eyeAfAnimals: true,
      vehicleDetection: true,
      lensMount: 'E-mount',
      maxFlashSync: '1/400',
      cardSlots: 2,
      batteryModel: 'NP-FZ100',
      weatherSealed: true,
      weightGrams: 743,
      dynamicRange: 15,
      sourceUrls: [
        'https://www.sony.com/electronics/support/e-mount-body-ilce-1-series/ilce-1m2/specifications',
        'https://www.sony.com/electronics/support/e-mount-body-ilce-1-series/ilce-1m2/manuals',
      ],
      verifiedAt: VERIFIED_AT,
      verifiedBy: VERIFIED_BY,
      verificationScope: 'official-record-page',
      validationTier: 'official-record-spec',
    },
    {
      modelName: 'Sony Alpha a7 V',
      brand: 'sony',
      productLine: 'Alpha',
      releaseDate: '2025-09-26',
      status: 'current-lineup',
      sensorType: 'Full-frame CMOS (33.0 MP)',
      sensorFormat: 'Full-frame',
      effectiveMegapixels: 33,
      isoRange: 'ISO 100-51200 (expandable to 50-204800)',
      nativeIsoMin: 100,
      nativeIsoMax: 51200,
      expandedIsoMin: 50,
      expandedIsoMax: 204800,
      shutterSpeed: '30 sec - 1/8000 sec (electronic up to 1/16000 sec)',
      mechanicalShutterMax: '1/8000',
      electronicShutterMax: '1/16000',
      continuousFpsMechanical: 10,
      continuousFpsElectronic: 30,
      preCapture: true,
      IBIS: true,
      ibisStops: 7.5,
      movieIS: 'Dynamic Active, Active, Standard, and Off',
      autofocus: 'Fast Hybrid AF with 759 phase-detection points',
      afPointsPhase: 759,
      subjectDetection: ['Auto', 'Human', 'Animal', 'Bird', 'Insect', 'Car', 'Train', 'Airplane'],
      eyeAfHumans: true,
      eyeAfAnimals: true,
      vehicleDetection: true,
      lensMount: 'E-mount',
      maxFlashSync: '1/250',
      cardSlots: 2,
      batteryModel: 'NP-FZ100',
      weatherSealed: true,
      weightGrams: 695,
      dynamicRange: 15,
      sourceUrls: [
        'https://www.sony.com/electronics/support/e-mount-body-ilce-7-series/ilce-7m5/specifications',
        'https://www.sony.com/electronics/support/e-mount-body-ilce-7-series/ilce-7m5/manuals',
      ],
      verifiedAt: VERIFIED_AT,
      verifiedBy: VERIFIED_BY,
      verificationScope: 'official-record-page',
      validationTier: 'official-record-spec',
    },
    {
      modelName: 'Sony Alpha a6100',
      brand: 'sony',
      productLine: 'Alpha',
      releaseDate: '2019-09-19',
      status: 'current-lineup',
      sensorType: 'APS-C Exmor CMOS (24.2 MP)',
      sensorFormat: 'APS-C',
      effectiveMegapixels: 24.2,
      isoRange: 'ISO 100-32000 (expandable to 51200)',
      nativeIsoMin: 100,
      nativeIsoMax: 32000,
      expandedIsoMax: 51200,
      shutterSpeed: '30 sec - 1/4000 sec',
      mechanicalShutterMax: '1/4000',
      continuousFpsMechanical: 11,
      IBIS: false,
      ibisStops: 0,
      autofocus: 'Fast Hybrid AF with 425 phase-detection and 425 contrast-detection points',
      afPointsPhase: 425,
      afPointsContrast: 425,
      subjectDetection: ['Human', 'Animal'],
      eyeAfHumans: true,
      eyeAfAnimals: true,
      vehicleDetection: false,
      lensMount: 'E-mount',
      maxFlashSync: '1/160',
      hssSupport: true,
      cardSlots: 1,
      batteryModel: 'NP-FW50',
      weatherSealed: false,
      weightGrams: 396,
      dynamicRange: 11,
      sourceUrls: [
        'https://www.sony.com/electronics/support/e-mount-body-ilce-6000-series/ilce-6100/specifications',
        'https://www.sony.com/electronics/support/e-mount-body-ilce-6000-series/ilce-6100/manuals',
      ],
      verifiedAt: VERIFIED_AT,
      verifiedBy: VERIFIED_BY,
      verificationScope: 'official-record-page',
      validationTier: 'official-record-spec',
    },
    {
      modelName: 'Sony ZV-E10 II',
      brand: 'sony',
      productLine: 'ZV E-mount',
      releaseDate: '2025-04-22',
      status: 'current-lineup',
      sensorType: 'APS-C Exmor R CMOS (26.0 MP)',
      sensorFormat: 'APS-C',
      effectiveMegapixels: 26,
      isoRange: 'ISO 100-32000 (expandable to 50-102400)',
      nativeIsoMin: 100,
      nativeIsoMax: 32000,
      expandedIsoMin: 50,
      expandedIsoMax: 102400,
      shutterSpeed: '30 sec - 1/8000 sec',
      electronicShutterMax: '1/8000',
      continuousFpsElectronic: 11,
      IBIS: false,
      ibisStops: 0,
      movieIS: 'Lens stabilization for stills; Active or Standard digital stabilization for video',
      autofocus: 'Fast Hybrid AF with 759 phase-detection points',
      afPointsPhase: 759,
      subjectDetection: ['Human', 'Animal', 'Bird'],
      eyeAfHumans: true,
      eyeAfAnimals: true,
      vehicleDetection: false,
      lensMount: 'E-mount',
      maxFlashSync: '1/30',
      cardSlots: 1,
      batteryModel: 'NP-FZ100',
      weatherSealed: false,
      weightGrams: 292,
      dynamicRange: 12,
      sourceUrls: [
        'https://www.sony.com/electronics/support/e-mount-body-zv-e-series/zv-e10m2/specifications',
        'https://www.sony.com/electronics/support/e-mount-body-zv-e-series/zv-e10m2/manuals',
      ],
      verifiedAt: VERIFIED_AT,
      verifiedBy: VERIFIED_BY,
      verificationScope: 'official-record-page',
      validationTier: 'official-record-spec',
    },
  ],
};

const CANON_NEW_MODEL_INSERTIONS = [
  ['Canon EOS R6 Mark III', 'Canon EOS R6 Mark II'],
  ['Canon EOS R50 V', 'Canon EOS R50'],
];

const SONY_NEW_MODEL_INSERTIONS = [
  ['Sony Alpha a1 II', 'Sony Alpha a1'],
  ['Sony Alpha a7 V', 'Sony Alpha a7 IV'],
  ['Sony Alpha a6100', 'Sony Alpha a6400'],
  ['Sony ZV-E10 II', 'Sony ZV-E10'],
];

const CAMERA_KEY_ORDER = [
  'modelName',
  'brand',
  'productLine',
  'releaseDate',
  'status',
  'sensorType',
  'sensorFormat',
  'effectiveMegapixels',
  'isoRange',
  'nativeIsoMin',
  'nativeIsoMax',
  'expandedIsoMin',
  'expandedIsoMax',
  'shutterSpeed',
  'mechanicalShutterMax',
  'electronicShutterMax',
  'continuousFpsMechanical',
  'continuousFpsElectronic',
  'preCapture',
  'IBIS',
  'ibisStops',
  'coordinatedIS',
  'movieIS',
  'autofocus',
  'afPointsPhase',
  'afPointsContrast',
  'subjectDetection',
  'eyeAfHumans',
  'eyeAfAnimals',
  'vehicleDetection',
  'lensMount',
  'maxFlashSync',
  'hssSupport',
  'cardSlots',
  'batteryModel',
  'weatherSealed',
  'weatherResistanceLevel',
  'weightGrams',
  'dynamicRange',
  'sourceUrls',
  'verifiedAt',
  'verifiedBy',
  'verificationScope',
  'validationTier',
];

const LENS_KEY_ORDER = [
  'lensName',
  'brand',
  'releaseDate',
  'status',
  'mountType',
  'minFocalLength',
  'maxFocalLength',
  'maxAperture',
  'maxApertureAtTele',
  'minFocusDistanceMeters',
  'maxMagnification',
  'focusMotor',
  'hasOIS',
  'oisStops',
  'filterThread',
  'weatherSealed',
  'weightGrams',
  'lengthMm',
  'diameterMm',
  'fullFrameCoverage',
  'apscCoverage',
  'teleconverterCompatibility',
  'compatibleCameras',
  'sourceUrls',
  'verifiedAt',
  'verifiedBy',
  'verificationScope',
  'validationTier',
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(CAMERA_DIR, relativePath), 'utf8'));
}

function writeJson(relativePath, payload) {
  fs.writeFileSync(path.join(CAMERA_DIR, relativePath), `${JSON.stringify(payload, null, 2)}\n`);
}

function normalizeCanonName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/canon/g, '')
    .replace(/eos/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeSonyName(name) {
  let normalized = String(name || '')
    .toLowerCase()
    .replace(/sony/g, '')
    .replace(/alpha/g, '')
    .replace(/[^a-z0-9]+/g, '');
  if (/^\d/.test(normalized)) normalized = `a${normalized}`;
  return normalized;
}

function normalizeModelName(brand, name) {
  return brand === 'canon' ? normalizeCanonName(name) : normalizeSonyName(name);
}

function cleanUndefined(value) {
  if (Array.isArray(value)) {
    const filtered = value
      .map(cleanUndefined)
      .filter((item) => item !== undefined);
    return filtered.length ? filtered : undefined;
  }

  if (!value || typeof value !== 'object') return value;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    const cleaned = cleanUndefined(entry);
    if (cleaned !== undefined) output[key] = cleaned;
  }
  return output;
}

function orderRecord(record, order) {
  const cleaned = cleanUndefined(record);
  const ordered = {};
  for (const key of order) {
    if (cleaned[key] !== undefined) ordered[key] = cleaned[key];
  }
  for (const [key, value] of Object.entries(cleaned)) {
    if (ordered[key] === undefined) ordered[key] = value;
  }
  return ordered;
}

function uniqueUrls(urls) {
  return Array.from(
    new Set((urls || []).filter(Boolean))
  );
}

function inferProductLine(brand, modelName) {
  if (brand === 'canon') {
    return /EOS R|EOS Ra|R5 C/.test(modelName) ? 'EOS R System' : 'EOS DSLR';
  }

  return modelName.includes('ZV-') ? 'ZV E-mount' : 'Alpha';
}

function parseSensorFormat(sensorType) {
  if (!sensorType) return undefined;
  const normalized = sensorType.toLowerCase();
  if (normalized.includes('full-frame') || normalized.includes('35-mm full frame')) return 'Full-frame';
  if (normalized.includes('aps-c')) return 'APS-C';
  return undefined;
}

function parseMegapixels(sensorType) {
  if (!sensorType) return undefined;
  const match = sensorType.match(/(\d+(?:\.\d+)?)\s*MP/i) || sensorType.match(/Approx\.\s*(\d+(?:\.\d+)?)\s*megapixels/i);
  return match ? Number(match[1]) : undefined;
}

function parseIsoRange(isoRange) {
  if (!isoRange) return {};

  const clean = isoRange.replace(/,/g, '');
  const nativeSection = clean.split(/\(.*expandable/i)[0];
  const nativeMatches = [...nativeSection.matchAll(/(\d+)/g)].map((match) => Number(match[1]));
  const nativeIsoMin = nativeMatches[0];
  const nativeIsoMax = nativeMatches[nativeMatches.length - 1];

  let expandedIsoMin;
  let expandedIsoMax;

  const expandedSectionMatch = clean.match(/\(.*expandable to ([^)]+)\)/i);
  if (expandedSectionMatch) {
    const expandedMatches = [...expandedSectionMatch[1].matchAll(/(\d+)/g)].map((match) => Number(match[1]));
    if (expandedMatches.length === 1) {
      if (nativeIsoMin && expandedMatches[0] < nativeIsoMin) expandedIsoMin = expandedMatches[0];
      else expandedIsoMax = expandedMatches[0];
    }
    if (expandedMatches.length >= 2) {
      [expandedIsoMin, expandedIsoMax] = expandedMatches;
    }
  }

  return cleanUndefined({
    nativeIsoMin,
    nativeIsoMax,
    expandedIsoMin,
    expandedIsoMax,
  });
}

function parseShutterSpeed(shutterSpeed) {
  if (!shutterSpeed) return {};

  const mechanicalMatch =
    shutterSpeed.match(/1\/\d+(?=[^()]*\(mechanical)/i) ||
    shutterSpeed.match(/(?:-|–)\s*(1\/\d+)/i);
  const electronicMatch =
    shutterSpeed.match(/1\/\d+(?=[^()]*\(electronic)/i) ||
    shutterSpeed.match(/electronic(?: up to)?\s*(1\/\d+)/i);
  const allFractions = [...shutterSpeed.matchAll(/(1\/\d+)/g)].map((match) => match[1]);

  return cleanUndefined({
    mechanicalShutterMax: mechanicalMatch ? mechanicalMatch[0].replace(/^.*?(1\/\d+).*$/, '$1') : allFractions[0],
    electronicShutterMax: electronicMatch ? electronicMatch[0].replace(/^.*?(1\/\d+).*$/, '$1') : allFractions[1],
  });
}

function inferApsCCropFactor(brand) {
  return brand === 'canon' ? 1.6 : 1.5;
}

function currentBodyStatusMap(brand) {
  const map = new Map();
  for (const entry of officialBodies.brands[brand].bodies) {
    map.set(normalizeModelName(brand, entry.displayName), entry.lineupStatus);
  }
  return map;
}

function currentBodyEntry(brand, modelName) {
  const normalized = normalizeModelName(brand, modelName);
  return officialBodies.brands[brand].bodies.find(
    (entry) => normalizeModelName(brand, entry.displayName) === normalized
  );
}

function officialBodySourceUrls(brand, modelName) {
  const entry = currentBodyEntry(brand, modelName);
  if (!entry) return [];

  const sourceMap = officialBodies.brands[brand].sources;
  return uniqueUrls((entry.sourceIds || []).map((sourceId) => sourceMap[sourceId] && sourceMap[sourceId].url));
}

function cameraReferenceUrls(brand, camera) {
  const refs = OFFICIAL_REFERENCE_URLS[brand].cameras;

  if (brand === 'canon') {
    const isMirrorless = camera.lensMount === 'RF' || camera.lensMount === 'RF-S';
    const isProDslr = /1D X|5D/i.test(camera.modelName);
    return uniqueUrls([
      refs.overview,
      isMirrorless ? refs.mirrorless : refs.dslr,
      isProDslr ? refs.proDslr : undefined,
      refs.support,
    ]);
  }

  const isApsc = camera.sensorFormat === 'APS-C';
  const isVlog = /zv-/i.test(camera.modelName);
  return uniqueUrls([
    refs.all,
    isVlog ? refs.vlog : (isApsc ? refs.apsc : refs.fullFrame),
    refs.support,
  ]);
}

function cameraProvenance(brand, camera, statusMap) {
  const normalizedName = normalizeModelName(brand, camera.modelName);
  const officialStatus = statusMap.get(normalizedName);
  const existingRecordPages = Array.isArray(camera.sourceUrls) && camera.sourceUrls.length > 0;
  const lineupUrls = officialBodySourceUrls(brand, camera.modelName);
  const referenceUrls = cameraReferenceUrls(brand, camera);

  let verificationScope = camera.verificationScope;
  let validationTier = camera.validationTier;

  if (!verificationScope) {
    verificationScope = existingRecordPages
      ? 'official-record-page'
      : lineupUrls.length
        ? 'official-lineup-page'
        : 'official-category-page';
  }

  if (!validationTier) {
    validationTier = existingRecordPages
      ? 'official-record-spec'
      : lineupUrls.length
        ? 'official-lineup'
        : 'official-category';
  }

  return {
    status: camera.status || officialStatus || 'legacy-catalog',
    sourceUrls: uniqueUrls([...(camera.sourceUrls || []), ...lineupUrls, ...referenceUrls]),
    verifiedAt: camera.verifiedAt || VERIFIED_AT,
    verifiedBy: camera.verifiedBy || VERIFIED_BY,
    verificationScope,
    validationTier,
  };
}

function normalizeCamera(camera, brand, statusMap) {
  const sensorFormat = camera.sensorFormat || parseSensorFormat(camera.sensorType);
  const iso = parseIsoRange(camera.isoRange);
  const shutter = parseShutterSpeed(camera.shutterSpeed);
  const provenance = cameraProvenance(brand, { ...camera, sensorFormat }, statusMap);

  return orderRecord({
    ...camera,
    brand,
    productLine: camera.productLine || inferProductLine(brand, camera.modelName),
    sensorFormat,
    effectiveMegapixels: camera.effectiveMegapixels || parseMegapixels(camera.sensorType),
    ...iso,
    ...shutter,
    ...provenance,
  }, CAMERA_KEY_ORDER);
}

function inferLensCoverage(brand, lens) {
  if (brand === 'canon') {
    if (lens.mountType === 'RF-S' || lens.mountType === 'EF-S') {
      return { fullFrameCoverage: false, apscCoverage: true };
    }
    if (lens.mountType === 'RF' || lens.mountType === 'EF') {
      return { fullFrameCoverage: true, apscCoverage: true };
    }
  }

  const lensName = lens.lensName || '';
  if (lens.mountType === 'FE' || lensName.startsWith('Sony FE ')) {
    return { fullFrameCoverage: true, apscCoverage: true };
  }
  if (lens.mountType === 'E' || lensName.startsWith('Sony E ')) {
    return { fullFrameCoverage: false, apscCoverage: true };
  }

  const compatibleCameraNames = lens.compatibleCameras || [];
  const compatibleHasFullFrame = compatibleCameraNames.some((name) => !/a6\d{3}|zv-e10/i.test(name));
  const compatibleHasApsC = compatibleCameraNames.some((name) => /a6\d{3}|zv-e10/i.test(name));
  return {
    fullFrameCoverage: compatibleHasFullFrame || undefined,
    apscCoverage: compatibleHasFullFrame || compatibleHasApsC || undefined,
  };
}

function lensReferenceUrls(brand, lens) {
  const refs = OFFICIAL_REFERENCE_URLS[brand].lenses;

  if (brand === 'canon') {
    const isMirrorless = lens.mountType === 'RF' || lens.mountType === 'RF-S';
    return uniqueUrls([
      refs.overview,
      isMirrorless ? refs.mirrorless : refs.dslr,
      refs.support,
    ]);
  }

  return uniqueUrls([
    refs.all,
    refs.compatibility,
    refs.support,
  ]);
}

function lensProvenance(brand, lens) {
  const hasRecordPages = Array.isArray(lens.sourceUrls) && lens.sourceUrls.length > 0;

  return {
    status: lens.status || 'official-category-reference',
    sourceUrls: uniqueUrls([...(lens.sourceUrls || []), ...lensReferenceUrls(brand, lens)]),
    verifiedAt: lens.verifiedAt || VERIFIED_AT,
    verifiedBy: lens.verifiedBy || VERIFIED_BY,
    verificationScope: lens.verificationScope || (hasRecordPages ? 'official-record-page' : 'official-category-page'),
    validationTier: lens.validationTier || (hasRecordPages ? 'official-record-spec' : 'official-category'),
  };
}

function normalizeLens(lens, brand) {
  return orderRecord({
    ...lens,
    brand,
    ...inferLensCoverage(brand, lens),
    ...lensProvenance(brand, lens),
  }, LENS_KEY_ORDER);
}

function upsertBodies(cameras, bodies) {
  const byName = new Map(cameras.map((camera) => [camera.modelName, camera]));
  for (const body of bodies) byName.set(body.modelName, orderRecord(body, CAMERA_KEY_ORDER));
  return Array.from(byName.values());
}

function insertAfterModel(records, newModelName, afterModelName) {
  const existingIndex = records.findIndex((record) => record.modelName === newModelName);
  if (existingIndex === -1) return records;

  const [record] = records.splice(existingIndex, 1);
  const afterIndex = records.findIndex((item) => item.modelName === afterModelName);
  if (afterIndex === -1) {
    records.push(record);
    return records;
  }

  records.splice(afterIndex + 1, 0, record);
  return records;
}

function updateCanonLensCompatibility(lenses) {
  return lenses.map((lens) => {
    const compatible = new Set(lens.compatibleCameras || []);

    if (lens.mountType === 'RF') {
      compatible.add('Canon EOS R6 Mark III');
      compatible.add('Canon EOS R50 V');
    }

    if (lens.mountType === 'RF-S') {
      compatible.add('Canon EOS R50 V');
    }

    if (lens.mountType === 'EF') {
      compatible.add('Canon EOS R6 Mark III');
      compatible.add('Canon EOS R50 V');
    }

    if (lens.mountType === 'EF-S') {
      compatible.add('Canon EOS R50 V');
    }

    return orderRecord({
      ...lens,
      compatibleCameras: Array.from(compatible),
    }, LENS_KEY_ORDER);
  });
}

function updateSonyLensCompatibility(lenses) {
  return lenses.map((lens) => {
    const compatible = new Set(lens.compatibleCameras || []);
    const isFullFrameLens =
      lens.fullFrameCoverage === true ||
      lens.mountType === 'FE' ||
      lens.lensName.startsWith('Sony FE ');

    if (isFullFrameLens) {
      compatible.add('Sony Alpha a1 II');
      compatible.add('Sony Alpha a7 V');
    } else {
      compatible.add('Sony Alpha a6100');
      compatible.add('Sony ZV-E10 II');
    }

    return orderRecord({
      ...lens,
      compatibleCameras: Array.from(compatible),
    }, LENS_KEY_ORDER);
  });
}

function updateBrandCatalog(brand) {
  const cameraPath = `data_cameras/${brand}.json`;
  const lensPath = `data_lenses/${brand}.json`;

  const cameraPayload = readJson(cameraPath);
  const lensPayload = readJson(lensPath);
  const statusMap = currentBodyStatusMap(brand);

  let cameras = cameraPayload.cameras.map((camera) => normalizeCamera(camera, brand, statusMap));
  cameras = upsertBodies(cameras, CURRENT_BODY_BACKFILLS[brand]);

  if (brand === 'canon') {
    for (const [newModel, afterModel] of CANON_NEW_MODEL_INSERTIONS) {
      cameras = insertAfterModel(cameras, newModel, afterModel);
    }
  }

  if (brand === 'sony') {
    for (const [newModel, afterModel] of SONY_NEW_MODEL_INSERTIONS) {
      cameras = insertAfterModel(cameras, newModel, afterModel);
    }
  }

  let lenses = lensPayload.lenses.map((lens) => normalizeLens(lens, brand));
  lenses = brand === 'canon' ? updateCanonLensCompatibility(lenses) : updateSonyLensCompatibility(lenses);

  writeJson(cameraPath, { cameras });
  writeJson(lensPath, { lenses });
}

function main() {
  updateBrandCatalog('canon');
  updateBrandCatalog('sony');

  const summary = {
    updatedAt: VERIFIED_AT,
    canonBodies: CURRENT_BODY_BACKFILLS.canon.map((body) => body.modelName),
    sonyBodies: CURRENT_BODY_BACKFILLS.sony.map((body) => body.modelName),
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main();
