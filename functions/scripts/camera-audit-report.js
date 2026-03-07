#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const officialBodies = require('../api/cameras/audit/officialBodies');
const {
  BODY_CAPABILITY_SCHEMA,
  LENS_CAPABILITY_SCHEMA,
} = require('../api/cameras/audit/capabilitySchema');

const FUNCTIONS_DIR = path.resolve(__dirname, '..');
const CAMERA_DIR = path.join(FUNCTIONS_DIR, 'api', 'cameras');
const OUTPUT_PATH = path.join(FUNCTIONS_DIR, 'docs', 'cameras', 'CAMERA_AUDIT_BASELINE.md');

function loadBrandDataset(kind, brand) {
  const filename = path.join(CAMERA_DIR, `data_${kind}`, `${brand}.json`);
  const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
  return data[kind];
}

function isPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function flattenSchema(schema) {
  return Object.values(schema).flat();
}

function normalizeCanonName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/canon/g, '')
    .replace(/eos/g, '')
    .replace(/alpha/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function normalizeSonyName(name) {
  let normalized = String(name || '')
    .toLowerCase()
    .replace(/sony/g, '')
    .replace(/alpha/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

  if (/^\d/.test(normalized)) normalized = `a${normalized}`;
  return normalized;
}

function normalizeModelName(brand, name) {
  if (brand === 'canon') return normalizeCanonName(name);
  if (brand === 'sony') return normalizeSonyName(name);
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function summarizeCoverage(records, schema) {
  return Object.entries(schema).map(([category, fields]) => {
    const filled = fields.reduce((count, field) => {
      return count + records.reduce((recordCount, record) => recordCount + (isPresent(record[field]) ? 1 : 0), 0);
    }, 0);
    const total = records.length * fields.length;
    return {
      category,
      fields: fields.length,
      filled,
      total,
      coverage: total === 0 ? 0 : filled / total,
    };
  });
}

function fieldPresence(records, fields) {
  return fields.map((field) => {
    const count = records.reduce((total, record) => total + (isPresent(record[field]) ? 1 : 0), 0);
    return {
      field,
      count,
      total: records.length,
      coverage: records.length === 0 ? 0 : count / records.length,
    };
  });
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function countBy(records, field) {
  const counts = new Map();
  for (const record of records) {
    const key = record[field] || 'missing';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
}

function allowedCanonLensMounts(cameraMount) {
  switch (cameraMount) {
    case 'EF':
      return new Set(['EF']);
    case 'EF-S':
      return new Set(['EF', 'EF-S']);
    case 'RF':
      return new Set(['RF', 'RF-S', 'EF', 'EF-S']);
    default:
      return new Set();
  }
}

function allowedSonyLensMounts(cameraMount) {
  if (cameraMount === 'E-mount') return new Set(['E-mount', 'FE', 'E']);
  return new Set();
}

function findCompatibilityProblems(brand, cameras, lenses) {
  const cameraMap = new Map(cameras.map((camera) => [camera.modelName, camera]));
  const missingCameraRefs = [];
  const impossibleMountPairs = [];

  for (const lens of lenses) {
    for (const cameraName of lens.compatibleCameras || []) {
      const camera = cameraMap.get(cameraName);
      if (!camera) {
        missingCameraRefs.push({
          lensName: lens.lensName,
          cameraName,
        });
        continue;
      }

      const allowedLensMounts =
        brand === 'canon'
          ? allowedCanonLensMounts(camera.lensMount)
          : allowedSonyLensMounts(camera.lensMount);

      if (allowedLensMounts.size && !allowedLensMounts.has(lens.mountType)) {
        impossibleMountPairs.push({
          lensName: lens.lensName,
          lensMount: lens.mountType,
          cameraName,
          cameraMount: camera.lensMount,
        });
      }
    }
  }

  return { missingCameraRefs, impossibleMountPairs };
}

function findDuplicates(records, key, brand) {
  const counts = new Map();
  for (const record of records) {
    const normalized = normalizeModelName(brand, record[key]);
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return records
    .map((record) => record[key])
    .filter((value, index, all) => all.indexOf(value) === index)
    .filter((value) => counts.get(normalizeModelName(brand, value)) > 1);
}

function auditBrand(brand) {
  const cameras = loadBrandDataset('cameras', brand);
  const lenses = loadBrandDataset('lenses', brand);
  const official = officialBodies.brands[brand].bodies;

  const localByNormalizedName = new Map(
    cameras.map((camera) => [normalizeModelName(brand, camera.modelName), camera.modelName])
  );
  const officialByNormalizedName = new Map(
    official.map((body) => [normalizeModelName(brand, body.displayName), body.displayName])
  );

  const missingCurrentBodies = official
    .filter((body) => !localByNormalizedName.has(normalizeModelName(brand, body.displayName)))
    .map((body) => body.displayName);

  const localOnlyBodies = cameras
    .filter((camera) => !officialByNormalizedName.has(normalizeModelName(brand, camera.modelName)))
    .map((camera) => camera.modelName);

  const compatibility = findCompatibilityProblems(brand, cameras, lenses);

  return {
    brand,
    cameras,
    lenses,
    official,
    matchedCurrentBodies: official.length - missingCurrentBodies.length,
    missingCurrentBodies,
    localOnlyBodies,
    duplicateCameraNames: findDuplicates(cameras, 'modelName', brand),
    duplicateLensNames: findDuplicates(lenses, 'lensName', brand),
    compatibility,
  };
}

function topMissingFields(records, schema, limit) {
  return fieldPresence(records, flattenSchema(schema))
    .filter((item) => item.coverage < 0.25)
    .sort((left, right) => left.coverage - right.coverage || left.field.localeCompare(right.field))
    .slice(0, limit);
}

function renderCoverageTable(title, coverageRows) {
  const lines = [
    `### ${title}`,
    '',
    '| Category | Populated slots | Coverage |',
    '| --- | ---: | ---: |',
  ];

  for (const row of coverageRows) {
    lines.push(`| ${row.category} | ${row.filled}/${row.total} | ${formatPercent(row.coverage)} |`);
  }

  return lines.join('\n');
}

function renderList(items) {
  if (!items.length) return '- none';
  return items.map((item) => `- ${item}`).join('\n');
}

function renderSourceList(sourceMap, bodyNames) {
  const usedSourceIds = new Set();
  for (const bodyName of bodyNames) {
    const body = Object.values(officialBodies.brands)
      .flatMap((brand) => brand.bodies)
      .find((entry) => entry.displayName === bodyName);
    if (!body) continue;
    for (const sourceId of body.sourceIds || []) usedSourceIds.add(sourceId);
  }

  return Array.from(usedSourceIds)
    .map((sourceId) => {
      const source = sourceMap[sourceId];
      return `- ${source.label}: ${source.url}`;
    })
    .join('\n');
}

function buildReport() {
  const brandAudits = ['canon', 'sony'].map(auditBrand);
  const allCameras = brandAudits.flatMap((audit) => audit.cameras);
  const allLenses = brandAudits.flatMap((audit) => audit.lenses);
  const bodyCoverage = summarizeCoverage(allCameras, BODY_CAPABILITY_SCHEMA);
  const lensCoverage = summarizeCoverage(allLenses, LENS_CAPABILITY_SCHEMA);
  const bodyFieldGaps = topMissingFields(allCameras, BODY_CAPABILITY_SCHEMA, 12);
  const lensFieldGaps = topMissingFields(allLenses, LENS_CAPABILITY_SCHEMA, 10);
  const currentCoverageComplete = brandAudits.every((audit) => audit.missingCurrentBodies.length === 0);
  const bodyCoveragePercent =
    bodyCoverage.reduce((sum, row) => sum + row.filled, 0) /
    bodyCoverage.reduce((sum, row) => sum + row.total, 0);
  const lensCoveragePercent =
    lensCoverage.reduce((sum, row) => sum + row.filled, 0) /
    lensCoverage.reduce((sum, row) => sum + row.total, 0);
  const bodyValidationTiers = countBy(allCameras, 'validationTier');
  const lensValidationTiers = countBy(allLenses, 'validationTier');

  const keyFindings = [];
  for (const audit of brandAudits) {
    keyFindings.push(
      `- ${audit.brand.toUpperCase()}: ${audit.matchedCurrentBodies}/${audit.official.length} current baseline bodies covered; missing ${audit.missingCurrentBodies.length}; local-only ${audit.localOnlyBodies.length}.`
    );
  }
  keyFindings.push(
    `- Internal consistency: ${brandAudits.reduce((count, audit) => count + audit.compatibility.missingCameraRefs.length, 0)} dangling lens-to-camera references and ${brandAudits.reduce((count, audit) => count + audit.compatibility.impossibleMountPairs.length, 0)} impossible mount pairings.`
  );
  keyFindings.push(
    `- Capability depth: body coverage ${formatPercent(bodyCoveragePercent)}, lens coverage ${formatPercent(lensCoveragePercent)}.`
  );

  const report = [
    '# Camera Audit Baseline',
    '',
    `Baseline source set dated ${officialBodies.auditedAt}. Generated from \`functions/scripts/camera-audit-report.js\`.`,
    '',
    '## Key Findings',
    '',
    ...keyFindings,
    '',
    '## Current-Body Coverage',
    '',
  ];

  for (const audit of brandAudits) {
    const sourceMap = officialBodies.brands[audit.brand].sources;
    report.push(`### ${audit.brand.toUpperCase()}`);
    report.push('');
    report.push(`Official current baseline: ${audit.official.length} bodies`);
    report.push(`Local Kaayko dataset: ${audit.cameras.length} bodies`);
    report.push(`Matched current baseline: ${audit.matchedCurrentBodies}/${audit.official.length}`);
    report.push('');
    report.push('Missing current bodies');
    report.push(renderList(audit.missingCurrentBodies));
    report.push('');
    report.push('Local-only bodies');
    report.push(renderList(audit.localOnlyBodies));
    report.push('');
    report.push('Primary official sources used by this baseline');
    report.push(renderSourceList(sourceMap, audit.official.map((body) => body.displayName)));
    report.push('');
  }

  report.push('## Data Quality Checks');
  report.push('');

  for (const audit of brandAudits) {
    report.push(`### ${audit.brand.toUpperCase()}`);
    report.push('');
    report.push(`Dangling lens compatibility references: ${audit.compatibility.missingCameraRefs.length}`);
    report.push(renderList(audit.compatibility.missingCameraRefs.map((item) => `${item.lensName} -> ${item.cameraName}`)));
    report.push('');
    report.push(`Impossible mount pairings: ${audit.compatibility.impossibleMountPairs.length}`);
    report.push(
      renderList(
        audit.compatibility.impossibleMountPairs.map(
          (item) => `${item.lensName} (${item.lensMount}) -> ${item.cameraName} (${item.cameraMount})`
        )
      )
    );
    report.push('');
    report.push(`Duplicate camera names: ${audit.duplicateCameraNames.length}`);
    report.push(renderList(audit.duplicateCameraNames));
    report.push('');
    report.push(`Duplicate lens names: ${audit.duplicateLensNames.length}`);
    report.push(renderList(audit.duplicateLensNames));
    report.push('');
  }

  report.push('## Capability Coverage');
  report.push('');
  report.push(renderCoverageTable('Body Schema Coverage', bodyCoverage));
  report.push('');
  report.push(renderCoverageTable('Lens Schema Coverage', lensCoverage));
  report.push('');
  report.push('### Lowest-Coverage Body Fields');
  report.push('');
  report.push(renderList(bodyFieldGaps.map((item) => `${item.field} (${formatPercent(item.coverage)})`)));
  report.push('');
  report.push('### Lowest-Coverage Lens Fields');
  report.push('');
  report.push(renderList(lensFieldGaps.map((item) => `${item.field} (${formatPercent(item.coverage)})`)));
  report.push('');
  report.push('### Body Validation Tiers');
  report.push('');
  report.push(renderList(bodyValidationTiers.map(([tier, count]) => `${tier}: ${count}`)));
  report.push('');
  report.push('### Lens Validation Tiers');
  report.push('');
  report.push(renderList(lensValidationTiers.map(([tier, count]) => `${tier}: ${count}`)));
  report.push('');
  report.push('## What This Means');
  report.push('');
  if (currentCoverageComplete) {
    report.push('- The current Canon and Sony baseline is now fully covered, so lineup completeness is no longer the primary gap.');
  } else {
    report.push('- The catalog still misses current Canon or Sony bodies, so lineup completeness remains the first blocker.');
  }
  report.push('- The schema is materially stronger than the initial baseline, but it is still too thin for fully body-specific advice around video ceilings, connectivity, media redundancy, and some flash edge cases.');
  report.push('- Provenance is now present across the catalog, but much of the legacy catalog is still validated at official category-page level rather than record-specific spec-page level.');
  report.push('- The repository now includes generated community-review artifacts, so the human validation phase is operationalized even though it still requires real photographers to complete.');
  report.push('');
  report.push('## Next Phases');
  report.push('');
  if (!currentCoverageComplete) {
    report.push(`- Close the remaining current-lineup gaps first: ${brandAudits.flatMap((audit) => audit.missingCurrentBodies).join(', ')}.`);
  }
  report.push('- Move legacy bodies and lenses from category-level provenance to record-specific spec/support provenance as time allows.');
  report.push('- Expand the body schema to include display, connectivity, video, and flash-behavior fields that are still mostly empty.');
  report.push('- Expand the lens schema to include minimum focus distance, maximum magnification, focus motor, weather sealing, and physical dimensions.');
  report.push('- Execute the review packet with working photographers and log the results before treating genre advice as field-validated.');
  report.push('');

  return `${report.join('\n')}\n`;
}

function main() {
  const markdown = buildReport();

  if (process.argv.includes('--stdout')) {
    process.stdout.write(markdown);
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, markdown);
  process.stdout.write(`Wrote ${path.relative(FUNCTIONS_DIR, OUTPUT_PATH)}\n`);
}

main();
