#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { resolvePreset } = require('../api/cameras/engine/presetEngine');

const FUNCTIONS_DIR = path.resolve(__dirname, '..');
const CAMERA_DIR = path.join(FUNCTIONS_DIR, 'api', 'cameras');
const OUTPUT_DIR = path.join(FUNCTIONS_DIR, 'docs', 'cameras');
const MARKDOWN_OUTPUT = path.join(OUTPUT_DIR, 'COMMUNITY_REVIEW_PACKET.md');
const JSON_OUTPUT = path.join(OUTPUT_DIR, 'COMMUNITY_REVIEW_PACKET.json');
const CSV_OUTPUT = path.join(OUTPUT_DIR, 'COMMUNITY_REVIEW_LOG_TEMPLATE.csv');

const REVIEW_SCENARIOS = [
  {
    reviewerTrack: 'portrait / wedding',
    brand: 'canon',
    cameraModel: 'Canon EOS R6 Mark III',
    lensName: 'Canon RF 24-70mm f/2.8L IS USM',
    genre: 'portrait',
    condition: 'SUNNY_OUTDOOR',
    mode: 'professional',
  },
  {
    reviewerTrack: 'sports / action',
    brand: 'sony',
    cameraModel: 'Sony Alpha a1 II',
    lensName: 'Sony FE 70-200mm f/2.8 GM OSS II',
    genre: 'sports',
    condition: 'NIGHT_STADIUM',
    mode: 'professional',
  },
  {
    reviewerTrack: 'wildlife / birding',
    brand: 'sony',
    cameraModel: 'Sony Alpha a1 II',
    lensName: 'Sony FE 200-600mm f/5.6-6.3 G OSS',
    genre: 'wildlife',
    condition: 'BIRDS_IN_FLIGHT',
    mode: 'professional',
  },
  {
    reviewerTrack: 'landscape / travel',
    brand: 'canon',
    cameraModel: 'Canon EOS R5 Mark II',
    lensName: 'Canon RF 15-35mm f/2.8L IS USM',
    genre: 'landscape',
    condition: 'GOLDEN_HOUR_TRIPOD',
    mode: 'professional',
  },
  {
    reviewerTrack: 'commercial product / food',
    brand: 'sony',
    cameraModel: 'Sony Alpha a7 V',
    lensName: 'Sony FE 90mm f/2.8 Macro G OSS',
    genre: 'product',
    condition: 'PRODUCT_WHITE_BACKGROUND',
    mode: 'professional',
  },
  {
    reviewerTrack: 'real estate / architecture',
    brand: 'canon',
    cameraModel: 'Canon EOS R5 Mark II',
    lensName: 'Canon RF 15-35mm f/2.8L IS USM',
    genre: 'realestate',
    condition: 'REALESTATE_HDR_BASE_FRAME',
    mode: 'professional',
  },
  {
    reviewerTrack: 'concert / event',
    brand: 'sony',
    cameraModel: 'Sony Alpha a7 V',
    lensName: 'Sony FE 24-70mm f/2.8 GM II',
    genre: 'concert',
    condition: 'CONCERT_LARGE_ARENA',
    mode: 'professional',
  },
  {
    reviewerTrack: 'astro / night',
    brand: 'sony',
    cameraModel: 'Sony Alpha a7 V',
    lensName: 'Sony FE 20mm f/1.8 G',
    genre: 'astro',
    condition: 'MILKY_WAY_WIDE',
    mode: 'professional',
  },
];

function loadData(kind, brand) {
  const payload = require(path.join(CAMERA_DIR, `data_${kind}`, `${brand}.json`));
  return payload[kind];
}

function loadCamera(brand, modelName) {
  return loadData('cameras', brand).find((camera) => camera.modelName === modelName);
}

function loadLens(brand, lensName) {
  return loadData('lenses', brand).find((lens) => lens.lensName === lensName);
}

function summarizePreset(preset) {
  return {
    mode: preset.mode,
    ISO: preset.ISO,
    aperture: `f/${preset.aperture}`,
    shutterSpeed: preset.shutterSpeed,
    metering: preset.metering,
    autofocusMode: preset.sessionOptimization.focus.autofocusMode,
    focusArea: preset.sessionOptimization.focus.focusArea,
    whiteBalance: preset.sessionOptimization.exposure.whiteBalance,
    flashGuidance: preset.sessionOptimization.shutterAndLighting.flashGuidance,
    lensFit: preset.sessionOptimization.lensFit.assessment,
    qualityControls: preset.sessionOptimization.qualityControls,
    composition: preset.sessionOptimization.composition,
    checklist: preset.sessionOptimization.checklist,
    caveats: preset.sessionOptimization.caveats,
    scienceNotes: preset.sessionOptimization.scienceNotes || [],
  };
}

function buildReviewEntries() {
  return REVIEW_SCENARIOS.map((scenario) => {
    const camera = loadCamera(scenario.brand, scenario.cameraModel);
    const lens = loadLens(scenario.brand, scenario.lensName);

    if (!camera) throw new Error(`Missing camera for review packet: ${scenario.cameraModel}`);
    if (!lens) throw new Error(`Missing lens for review packet: ${scenario.lensName}`);

    const result = resolvePreset(camera, lens, scenario.genre, scenario.condition, scenario.mode);
    if (result.error) {
      throw new Error(`Failed to resolve ${scenario.genre}/${scenario.condition}: ${result.error.message}`);
    }

    return {
      ...scenario,
      presetSummary: summarizePreset(result.preset),
    };
  });
}

function toMarkdown(entries) {
  const lines = [
    '# Community Review Packet',
    '',
    'Generated review packet for working photographers to score the current camera recommendation engine.',
    '',
    'Scoring options:',
    '',
    '- usable',
    '- usable with caveat',
    '- incorrect',
    '',
    'Review guidance:',
    '',
    '- Judge the settings as a starting point for a real session, not as the only correct creative choice.',
    '- Note whether the failure is exposure, focus behavior, shutter/flash behavior, lens fit, color control, or composition guidance.',
    '- If you would change the recommendation, say what you would change first and why.',
    '',
  ];

  entries.forEach((entry, index) => {
    lines.push(`## Scenario ${index + 1}: ${entry.reviewerTrack}`);
    lines.push('');
    lines.push(`- Brand: ${entry.brand}`);
    lines.push(`- Camera: ${entry.cameraModel}`);
    lines.push(`- Lens: ${entry.lensName}`);
    lines.push(`- Genre: ${entry.genre}`);
    lines.push(`- Condition: ${entry.condition}`);
    lines.push(`- Core exposure: ${entry.presetSummary.mode}, ISO ${entry.presetSummary.ISO}, ${entry.presetSummary.aperture}, ${entry.presetSummary.shutterSpeed}`);
    lines.push(`- AF: ${entry.presetSummary.autofocusMode}; ${entry.presetSummary.focusArea}`);
    lines.push(`- White balance: ${entry.presetSummary.whiteBalance}`);
    lines.push(`- Lens fit: ${entry.presetSummary.lensFit}`);
    lines.push('');
    lines.push('Checklist highlights:');
    entry.presetSummary.checklist.slice(0, 5).forEach((item) => lines.push(`- ${item}`));
    lines.push('');
    lines.push('Caveats:');
    if (entry.presetSummary.caveats.length) {
      entry.presetSummary.caveats.forEach((item) => lines.push(`- ${item}`));
    } else {
      lines.push('- none');
    }
    lines.push('');
    lines.push('Reviewer response:');
    lines.push('');
    lines.push('- Verdict: ');
    lines.push('- What would you change first?: ');
    lines.push('- Field notes / failure mode: ');
    lines.push('');
  });

  return `${lines.join('\n')}\n`;
}

function toCsvTemplate(entries) {
  const rows = [
    'reviewer_name,review_date,reviewer_track,brand,camera_model,lens_name,genre,condition,verdict,first_change,failure_mode,notes',
  ];

  for (const entry of entries) {
    rows.push([
      '',
      '',
      entry.reviewerTrack,
      entry.brand,
      entry.cameraModel,
      entry.lensName,
      entry.genre,
      entry.condition,
      '',
      '',
      '',
      '',
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','));
  }

  return `${rows.join('\n')}\n`;
}

function main() {
  const entries = buildReviewEntries();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(MARKDOWN_OUTPUT, toMarkdown(entries));
  fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(entries, null, 2)}\n`);
  fs.writeFileSync(CSV_OUTPUT, toCsvTemplate(entries));

  process.stdout.write(
    `${JSON.stringify({
      packetScenarios: entries.length,
      markdown: path.relative(FUNCTIONS_DIR, MARKDOWN_OUTPUT),
      json: path.relative(FUNCTIONS_DIR, JSON_OUTPUT),
      csv: path.relative(FUNCTIONS_DIR, CSV_OUTPUT),
    }, null, 2)}\n`
  );
}

main();
